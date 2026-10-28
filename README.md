# Urja Meter Ops API Service

A clean, typed REST API service built with **Node.js**, **TypeScript**, and **Fastify** that sits in front of the legacy Urja Meter Ops web portal (`https://urja-ops.flockenergy.tech`). It exposes structured smart-meter information, geographic locations, network hierarchy, and 30-minute interval energy consumption without requiring downstream clients to interact with the legacy portal.

## Documentation Links
* [PROTOCOL.md](./PROTOCOL.md) — Reverse-engineering write-up of the portal (auth, endpoints, HMAC export, quirks).
* [REFLECTION.md](./REFLECTION.md) — 5 retrospective answers on assumptions, obstacles, and trade-offs.
* **OpenAPI 3.0 Specification**: `./openapi.json` (interactive Swagger UI served live at `http://localhost:3000/docs`).

---

## Project Structure
```text
.
├── src/
│   ├── client/       # Legacy portal HTTP client (session management & 401 retry)
│   ├── normalizers/  # Data transformation functions (IST to UTC, float parsing)
│   ├── routes/       # Fastify REST route handlers
│   ├── types/        # Zod schemas & TypeScript definitions
│   ├── config.ts     # Zod-validated environment config
│   └── server.ts     # Fastify app, Swagger UI registration & error envelope
├── tests/            # Vitest unit and integration tests (11 passing offline)
├── fixtures/         # Saved offline JSON responses from legacy portal
├── docs/             # Investigation notes and project assets
├── PROTOCOL.md       # Technical portal analysis
├── REFLECTION.md     # Answers to evaluation questions
└── openapi.json      # Generated OpenAPI 3.0 specification
```

---

## Quick Start

### 1. Configure Environment
```bash
cp .env.example .env
```
Ensure credentials are set in `.env`:
```env
PORT=3000
PORTAL_BASE_URL=https://urja-ops.flockenergy.tech
PORTAL_USERNAME=your_username_here
PORTAL_PASSWORD=your_password_here
```

### 2. Install & Run
```bash
npm install
npm run dev
```

### 3. Run Tests
The test suite runs **100% offline** using real saved portal fixtures, so anyone can clone and verify without credentials or live portal access:
```bash
npm test
```

---

## Sample Requests

```bash
# 1. Health check
curl -X GET http://localhost:3000/health

# 2. List smart meters (paginated search)
curl -X GET "http://localhost:3000/v1/meters?page=1"

# 3. Filter meters by query
curl -X GET "http://localhost:3000/v1/meters?q=J100000"

# 4. Get meter details, GPS coordinates & 7-tier network hierarchy
curl -X GET http://localhost:3000/v1/meters/J100000

# 5. Get recent 30-minute interval consumption readings (kWh, kVAh, Volts)
curl -X GET "http://localhost:3000/v1/meters/J100000/consumption?limit=10"

# 6. Interactive Swagger documentation
# Open http://localhost:3000/docs in your browser
```

---

## Key Learnings

1. **HTTP Probing with `curl`**: Learned to use `curl` as a headless browser to inspect low-level transport details (`-i` for raw response headers, `-c` / `-b` for cookie jars, and `-H` for custom headers).
2. **SvelteKit CSRF Protection**: Discovered that SvelteKit validates the `Origin` header on form submissions. Omitting it caused `403 Forbidden: Cross-site POST form submissions are forbidden`. Adding `Origin: https://urja-ops.flockenergy.tech` resolved it.
3. **Session Cookies vs Tokens**: The portal uses Better-Auth setting an `HttpOnly` cookie (`__Secure-better-auth.session_token`) with a 1-hour lifetime (`Max-Age=3600`).
4. **JS Inspection over HTML Scraping**: Instead of fragile DOM scraping, reading the frontend JavaScript bundles (`5.C4dYcCRt.js`, `4.2Bgc2kUI.js`) revealed native JSON endpoints (`/portal/meters/search`, `/geo`, `/energy`) and a hidden HMAC-SHA256 bulk export endpoint.
5. **Session Resilience**: Understanding why an on-demand 401 retry interceptor is more resilient than a fixed 59-minute timer against unexpected upstream server reboots.

<details>
  <summary><b>notes</b></summary>
  <br/>

  | HTTP & Curl Probing | Deliverables & Investigation Flow |
  | :---: | :---: |
  | <img src="docs/notes-curl.png" width="450" alt="Curl Notes" /> | <img src="docs/notes-investigation.png" width="450" alt="Investigation Notes" /> |
</details>

---

## Notes

### Assumptions
* **Timezone**: The portal operates meters in Rajasthan, India (Jaipur Zone, Malviya Nagar). Energy timestamps arrive in local Indian format (`DD/MM/YYYY HH:mm`) without a timezone indicator. We assumed **Indian Standard Time (IST = UTC+05:30)** and converted all timestamps to ISO-8601 UTC.
* **Cumulative Register Counters**: The `kwh` values continuously increase over time; they represent cumulative meter register readings (like an odometer on a car), rather than individual 30-minute interval usage.
* **Read-Only**: The service strictly reads data and never mutates anything on the portal.
* **Session Lifecycle**: The legacy portal issues an auth cookie with `Max-Age=3600` (1 hour). We assumed sessions can expire or be invalidated at any time, requiring reactive re-authentication.

### Design Decisions & Trade-offs

#### 1. Fastify + Zod over Express
* In my previous projects (like my chat app), I typically built APIs using Express.
* Here, I chose **Fastify** because it pairs natively with Zod via `fastify-type-provider-zod` and `@fastify/swagger`.
* **Benefit**: It validates query parameters and response payloads at runtime and automatically generates the OpenAPI 3.0 specification (`/openapi.json` and `/docs`) directly from code, eliminating manual documentation drift.

#### 2. On-Demand 401 Interceptor over `node-cron`
* **Initial Idea**: Use a `node-cron` job running every 59 minutes to refresh the session token before the 60-minute cookie expiry (a pattern I've used for database maintenance).
* **Why Rejected**: If the server restarts at minute 10, or if the legacy portal restarts and flushes sessions at minute 15, the cron wouldn't run for another 44 minutes, causing all user requests to fail during that blackout window.
* **Solution**: An **on-demand reactive interceptor**. If any request receives a 401, it catches it, executes a silent login to acquire a fresh session cookie, and replays the original request once. It handles restarts naturally and wastes zero requests during idle hours.

#### 3. No Database
* The legacy portal is the single source of truth. Adding a local database (SQLite/Postgres) would add synchronization complexity and state management overhead for a read-only proxy service.

### What Was Left Out & Why
* **User Authentication**: Omitted API keys/JWT auth for this wrapper to keep the focus strictly on proxying and normalizing the legacy portal data.
* **External Caching Systems**: Avoided external Redis dependencies to ensure the service remains zero-dependency and runnable out of the box with `npm install && npm run dev`.

### Improvements With More Time
* **In-Memory TTL Cache**: Add a 5-minute memory cache with stale-while-revalidate for the 403-meter list to reduce upstream portal traffic.
* **Interval Delta Calculation**: Calculate energy consumed between consecutive 30-minute intervals (`kwh_current - kwh_previous`) so downstream frontends don't have to compute step differences manually.
* **Fallback for Detail Endpoint**: The detail endpoint currently uses the fast bulk export path. If that endpoint ever failed, add an automated fallback to fetch `/geo` and `__data.json` directly.
