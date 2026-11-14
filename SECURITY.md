
## Pre-launch review (14 Nov 2026)
Checked against a server running with `NODE_ENV=production`:
- **Secrets:** no keys or passwords in any tracked file; `.env` is git-ignored; the Groq key is only read on the server.
- **Dependencies:** `npm audit` reports 0 vulnerabilities (express 4.22, pg 8.23, chart.js 4.6, dotenv 16.6).
- **Headers:** strict CSP (own origin only), HSTS, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy, COOP; no X-Powered-By.
- **Session cookie:** HttpOnly, Secure, SameSite=Lax, 7-day expiry; only a hash of the token is stored.
- **Files not served:** `.env`, `.git`, `package*.json`, source code, tests, docs, Docker/Render files, the styleguide, and path-traversal attempts all return 404.
- **Requests:** cross-site and non-JSON writes are rejected; JSON bodies over 256 KB are refused; malformed JSON gives a clean 400; unknown errors never expose details.
- **Brute force:** login locks after 10 failed attempts per IP for 15 minutes (and per email).
- **Access control:** one user cannot read, change or delete another user's records (404); every query is scoped to the signed-in user.
- **Injection:** database queries are parameterised; HTML in descriptions is shown as text and cannot run (no script executed in the browser test); CSV export neutralises spreadsheet formulas.

Still to do by the owner before going public: rotate any key or password that was ever pasted into a chat or committed anywhere, use a fresh strong database password for the hosted database, and set `NODE_ENV=production`, `TRUST_PROXY=true` and `DATABASE_SSL=true` on the host (already in `render.yaml`).
Known limits (not vulnerabilities): no email verification or password reset, in-memory rate limits (fine for one server instance), and the free Groq plan's shared limits.
