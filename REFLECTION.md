# Project Reflection — Urja Meter Ops API Service

---

### 1. What assumptions did you make?
* **Timezone Normalization**: The portal manages meters in Rajasthan, India (Jaipur Zone, Malviya Nagar DT). Timestamps arrive in local Indian format (`DD/MM/YYYY HH:mm`) without a timezone indicator. I assumed **Indian Standard Time (IST = UTC+05:30)** and converted them to standardized UTC ISO-8601 (`YYYY-MM-DDTHH:mm:ssZ`) so downstream consumers don't face timezone bugs.
* **Cumulative Register Counters**: The `kwh` and `kvah` numbers strictly increase over time; they represent cumulative meter registers (odometer-style), not individual 30-minute interval usage.
* **Read-Only Invariant**: The upstream portal is strictly treated as read-only; no state-modifying requests are ever dispatched.
* **Session Lifecycle**: The legacy portal issues an auth cookie with `Max-Age=3600` (1 hour). I assumed sessions can expire or be invalidated at any time, requiring on-demand reactive re-authentication rather than a fixed timer.

---

### 2. Which part was the most difficult, and how did you get unstuck?
* Crawling 403 individual meter pages one-by-one would have required over 400 separate HTTP requests, taking 30+ seconds and risking rate limits.
* While inspecting the JavaScript bundle in DevTools (`nodes/4.2Bgc2kUI.js`), I found an export function that fetched a secret key from `/portal/keys` and signed the request using HMAC-SHA256.
* Replicating that signature in Node.js (joining `[method, path, query, timestamp]` with newlines) unlocked the entire 403-meter dataset with complete 7-tier hierarchy and GPS coordinates in a single ~400ms request.

---

### 3. If you had another day, what would you improve?
* **In-Memory Caching**: Add a 5-minute memory cache with stale-while-revalidate for the 403-meter list so we don't hit the legacy portal on every user request.
* **Interval Delta Calculation**: Compute the actual energy consumed between consecutive 30-minute intervals (`kwh_now - kwh_previous`) so downstream frontends don't have to calculate step differences manually.
* **Fallback for Detail Endpoint**: The detail endpoint currently uses the fast bulk export path. If that endpoint ever failed, add an automated fallback to fetch `/geo` and `__data.json` directly.

---

### 4. What mistake did you make while solving this?
* **Missing CSRF Origin Header on Login**: When I first tested `/login` with `curl`, SvelteKit rejected the request with `403 Forbidden: Cross-site POST form submissions are forbidden`. I initially thought my credentials or URL were wrong, before realizing that SvelteKit's CSRF defense strictly checks the `Origin` header. Adding `Origin: https://urja-ops.flockenergy.tech` resolved it immediately.
* **The "Sanitized HAR" Misdirection**: In Chrome DevTools, I downloaded the HAR log with "Sanitize" checked. Chrome stripped all `Cookie` and `Set-Cookie` headers. I spent time searching `sessionStorage` (finding only SvelteKit scroll state) before realizing the cookies were just hidden, which I confirmed right away using `curl -i`.
* **Expecting 401 on Bad Credentials**: When testing login failure cases, SvelteKit returned `200 OK` with `{"type": "failure", "status": 401}` in the JSON body instead of a native HTTP 401 status. My client initially thought login succeeded because the HTTP status was 200, until I added JSON body checking.

---

### 5. If you were reviewing your own submission, what would you criticise?
* **In-Memory Slicing for Energy Readings**: The portal doesn't support query parameters for energy data; it returns all 337 readings. My API downloads the array and slices it in memory based on `limit`. For 337 items (~27 KB) this is fine, but for multi-year utility datasets with 50,000+ readings, it would cause Node heap memory pressure. In production, I'd use streaming or database queries.
* **Single Operator Account**: All downstream requests share a single operator account session token, which risks rate-limiting on the legacy portal under heavy concurrent traffic.
