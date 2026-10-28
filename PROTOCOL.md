# Urja Meter Ops — Portal Protocol & Reverse-Engineering Analysis

This document details the reverse-engineered mechanics, transport protocols, authentication lifecycle, and hidden data paths of the Urja Meter Ops portal (`https://urja-ops.flockenergy.tech`).

---

## 1. Architecture & Framework Under the Hood
* **Application Framework**: Modern SvelteKit application bundled with Vite and Tailwind CSS.
* **Authentication Engine**: Better-Auth (`__Secure-better-auth.session_token`).
* **Transport Protocol**: HTTP/2 and HTTP/3 (QUIC) over TLS.

---

## 2. Authentication & Session Management

### 2.1 Login Handshake
* **Endpoint**: `POST /login`
* **Content-Type**: `application/x-www-form-urlencoded`
* **Mandatory Headers**:
  * `x-sveltekit-action: true`
  * `origin: https://urja-ops.flockenergy.tech`
* **Payload**:
  ```text
  email=<portal_username>&password=<portal_password>
  ```
* **Response Status**: `200 OK`
* **Response Body**:
  ```json
  {"type":"redirect","status":303,"location":"/meters"}
  ```

### 2.2 Session Cookie
* **Cookie Name**: `__Secure-better-auth.session_token`
* **Attributes**: `Max-Age=3600; Path=/; HttpOnly; Secure; SameSite=Lax`
* **Session Lifetime**: 3600 seconds (1 hour). After 1 hour, requests return `401 Unauthorized` or redirect to `/login`.
* **Sign Out**: `POST /api/auth/sign-out`

### 2.3 CSRF Protection Quirk
SvelteKit strictly verifies the `Origin` header for form actions. If the `Origin` header is absent or does not match `https://urja-ops.flockenergy.tech`, the server immediately terminates the request with:
```text
HTTP/2 403 Forbidden
Cross-site POST form submissions are forbidden
```
Any programmatic client must explicitly pass the `Origin` header during login.

---

## 3. Discovered Endpoints & Data Access Paths

| Portal Path | Method | Purpose | Response Format | Parameters / Headers |
|---|---|---|---|---|
| `/login` | `POST` | Authenticate & obtain session cookie | JSON (`type: redirect`) | `origin`, `x-sveltekit-action`, form-data |
| `/portal/meters/search` | `GET` | Paginated search of smart meters | JSON | `q` (search string), `page` (int) |
| `/portal/meters/{id}/geo` | `GET` | Latitude / Longitude coordinates | JSON | None (Cookie required) |
| `/portal/meters/{id}/energy` | `GET` | 30-min interval consumption series | JSON | None (Cookie required) |
| `/meters/{id}/__data.json` | `GET` | SvelteKit SSR state (nameplate & hierarchy) | SvelteKit Devalue JSON | Query: `?x-sveltekit-invalidated=010` |
| `/portal/dts` | `GET` | Distribution Transformers list | JSON | `page` (int) |
| `/portal/keys` | `GET` | Returns HMAC secret for exports | JSON | None (Cookie required) |
| `/portal/export` | `GET` | **Bulk export** of all 403 meters + hierarchy + geo | JSON | `page=1`, `x-timestamp`, `x-signature` |

---

## 4. Hidden & Bulk Endpoints: The HMAC Export Protocol

Inspection of the Distribution Transformers component (`4.2Bgc2kUI.js`) revealed an authenticated export mechanism:

1. **Obtain Secret**: Call `GET /portal/keys` with the session cookie.
   * Returns: `{"data":{"signingSecret":"..."}}`
2. **Build Signature Payload**:
   * Format: `[METHOD, PATH, QUERY, TIMESTAMP].join('\n')`
   * Example:
     ```text
     GET
     /portal/export
     page=1
     1793182898
     ```
3. **Compute HMAC-SHA256**:
   * Key: `signingSecret`
   * Algorithm: `HMAC-SHA256`
   * Output: 64-character lowercase hexadecimal digest.
4. **Send Authenticated Request**:
   * Headers:
     * `x-timestamp: <unix_seconds>`
     * `x-signature: <hex_signature>`
     * `Cookie: __Secure-better-auth.session_token=...`
5. **Bulk Payload**: Returns all 403 meters in a single JSON payload (`data.data`), complete with structured network hierarchy (`zone`, `circle`, `division`, `subdivision`, `substation`, `feeder`, `dt`) and `geo` (`lat`, `lng`).

---

## 5. Data Quirks & Idiosyncrasies

### 5.1 Non-Standard Timestamps in Consumption
* The energy endpoint (`/portal/meters/{id}/energy`) returns timestamps in the local Indian date format: `DD/MM/YYYY HH:mm` (e.g. `"23/06/2026 23:30"`).
* **Fix required in normalizer**: Must be parsed and converted to ISO-8601 UTC (`YYYY-MM-DDTHH:mm:ssZ`).

### 5.2 Numeric Values Encoded as Strings
* Metrics such as `kwh` (`"48438.74"`), `kvah` (`"52313.84"`), `voltR` (`"226"`), `latitude` (`"26.93896..."`), and `longitude` (`"75.83095..."`) are strings in the raw JSON.
* **Fix required in normalizer**: Coerce to clean TypeScript `number` / `float`.

### 5.3 Cumulative vs Incremental Readings
* The `kwh` and `kvah` fields represent cumulative meter register readings that strictly increment over time, sampled every 30 minutes.

### 5.4 Dual Schema in Meter Nameplate Details
* In the `/meters/{id}/__data.json` endpoint, meter detail can arrive in two disparate formats:
  1. An array of objects: `[{ "parameterName": "Serial No", "parameterValue": "SE33962" }, ...]`
  2. A stringified JSON blob under `classData`: `JSON.parse(e.classData).installed_meter`
* **Fix required in normalizer**: Handle both representations gracefully to avoid schema crashes.
