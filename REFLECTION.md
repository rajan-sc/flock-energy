# Project Reflection — Urja Meter Ops API Service

---

### 1. What assumptions did you make?
* **Timezone & Calendar Normalization**: The portal manages meters in Rajasthan, India (Jaipur Zone, Malviya Nagar DT). Timestamps arrive in local Indian format (`DD/MM/YYYY HH:mm`) without a timezone indicator. I assumed **Indian Standard Time (IST = UTC+05:30)**, validated actual Gregorian calendar days (rejecting impossible dates like `31/02`), and converted them to standardized UTC ISO-8601 (`YYYY-MM-DDTHH:mm:ssZ`).
* **Cumulative Register Counters**: The `kwh` and `kvah` numbers strictly increase over time; they represent cumulative meter registers (odometer-style), not individual 30-minute interval usage.
* **Domain Data Integrity**: In energy metering, `0 kWh` is a valid physical measurement indicating an idle meter. Corrupt or unparseable upstream strings are preserved as `null` rather than defaulted to `0` to avoid corrupting billing and telemetry.
* **Read-Only Invariant**: The upstream metering endpoints are strictly treated as read-only; no state-modifying requests are ever dispatched.
* **Session Lifecycle**: The legacy portal issues an auth cookie with `Max-Age=3600` (1 hour). I assumed sessions can expire or be invalidated at any time, requiring on-demand reactive re-authentication and redirect recovery rather than a fixed timer.

---

### 2. Which part was the most difficult, and how did you get unstuck?
* Crawling 403 individual meter pages one-by-one would have required over 400 separate HTTP requests, taking 30+ seconds and risking rate limits.
* While inspecting the JavaScript bundle in DevTools (`nodes/4.2Bgc2kUI.js`), I found an export function that fetched a secret key from `/portal/keys` and signed the request using HMAC-SHA256.
* Replicating that signature in Node.js (joining `[method, path, query, timestamp]` with newlines) unlocked the entire 403-meter dataset with complete 7-tier hierarchy and GPS coordinates in a single ~400ms request.

---

### 3. If you had another day, what would you improve?
* **Persistent Ingestion Worker**: While the current 5-minute in-memory TTL cache and request coalescing protect the legacy portal from duplicate detail queries, a production service with hundreds of consumers would benefit from an asynchronous background worker that regularly writes snapshots to a database, completely decoupling caller latency from the legacy portal.
* **Interval Delta Calculation**: Compute the actual energy consumed between consecutive 30-minute intervals (`kwh_now - kwh_previous`) with explicit rollover/reset detection so downstream frontends don't have to calculate step differences manually.
* **Fallback for Detail Endpoint**: The detail endpoint currently uses the fast bulk export path. If that endpoint ever failed, add an automated fallback to fetch `/geo` and `__data.json` directly.

---

### 4. What mistake did you make while solving this?
* **Missing CSRF Origin Header on Login**: When I first tested `/login` with `curl`, SvelteKit rejected the request with `403 Forbidden: Cross-site POST form submissions are forbidden`. I initially thought my credentials or URL were wrong, before discovering that SvelteKit's CSRF defense strictly checks the `Origin` header. Adding `Origin: https://urja-ops.flockenergy.tech` resolved it immediately.
* **The "Sanitized HAR" Misdirection**: In Chrome DevTools, I downloaded the HAR log with "Sanitize" checked. Chrome stripped all `Cookie` and `Set-Cookie` headers. I spent time searching `sessionStorage` (finding only SvelteKit scroll state) before discovering the cookies were stripped by DevTools export, which I confirmed using `curl -i`.
* **Expecting 401 on Bad Credentials**: When testing login failure cases, SvelteKit returned `200 OK` with `{"type": "failure", "status": 401}` in the JSON body instead of a native HTTP 401 status. My client initially thought login succeeded because the HTTP status was 200, until I added JSON body validation.
* **Module-Level Config Execution**: In my initial setup, `config.ts` ran validation on module import, calling `process.exit(1)` when environment variables were absent. This caused the route test suite to exit during import when running in a clean environment without a `.env` file. Refactoring to dependency injection made the test runner truly 100% offline.

---

### 5. If you were reviewing your own submission, what would you criticise?
* **Upstream Amplification on Initial Detail Route**: In the first draft of `/v1/meters/:id`, every request (even for nonexistent IDs) re-fetched the signing keys and downloaded the full 403-meter export. I added in-memory caching and request coalescing, but a full production deployment should use an edge cache or database to eliminate real-time legacy dependency.
* **Single Operator Account**: All downstream requests share a single operator account session token, which risks rate-limiting on the legacy portal under heavy concurrent traffic.
* **Memory Slicing for Energy Readings**: The portal returns all 337 energy readings without pagination parameters. My API downloads the array and slices it in memory based on `limit`. For 337 items (~27 KB) this is lightweight, but for multi-year utility datasets with 50,000+ readings, streaming or database persistence would be necessary to prevent memory pressure.
