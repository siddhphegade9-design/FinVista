# Security

## What is in place
| Area | Measure |
|---|---|
| Passwords | scrypt with per-user salt; constant-time compare; 10-character minimum and a small blocklist of very common passwords (see [AUTH.md](AUTH.md)) |
| Sessions | Random 256-bit token in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` in production); only a SHA-256 hash is stored; rotated on login; deleted on logout; a password change revokes the user's other sessions; deleting the account removes all of them; replaying a logged-out token fails (tested) |
| CSRF | `SameSite=Lax`, rejects cross-site `Sec-Fetch-Site`/`Origin`, and requires `application/json` for bodies |
| Brute force | Per-IP and per-email limiter on login/register/password routes; general API limiter; per-user hourly advisor limiter. Wrong password and unknown email give the same response |
| Tenant isolation | Every route sits behind `requireAuth`; every query filters by `req.user.id`; composite foreign keys stop a record pointing at another user's category. Tested by trying 11 cross-user reads, edits and deletes |
| Injection | Parameterised SQL only; strict validators; all dynamic text rendered with `textContent` (hostile `<img onerror>` descriptions shown literally in a real browser test) |
| Browser hardening | CSP with no inline script/style/eval and same-origin only, `frame-ancestors 'none'`, `nosniff`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, COOP, HSTS in production. Chart.js and fonts are served locally |
| CSV export | Cells starting with `= + - @` are neutralised against spreadsheet formula injection |
| Errors | JSON errors; internal messages and stack traces hidden in production (tested); unknown API paths return JSON 404 |
| Request limits | 256 KB JSON body limit, 413/415/400 handling |
| Files | `frontend/tests`, `package.json`, `node_modules` are never served; the dev styleguide is hidden in production; path-traversal attempts tested |
| Secrets | In `.env` (git-ignored) or host secrets only; read through one config module; `.env` never committed or served; the Groq key never reaches the browser or logs |
| AI | Only aggregates are sent (no names, emails, descriptions or IDs); the model never calculates tax; replies are length-capped and shown as plain text |
| Banking | The app never asks for or stores bank credentials or account numbers |
| Dependencies | 4 runtime dependencies; `npm audit`: 0 vulnerabilities on 14 Nov 2026 |
| Process | Unhandled rejections and exceptions are logged then trigger a clean shutdown; production refuses to start without a database |

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

## Known gaps (not fixed, on purpose or for lack of scope)
- Rate-limit counters are in memory (per process, reset on restart).
- No email verification, password reset or two-factor login: there is no email service (keeping the project free).
- No audit log of account activity; no per-session management screen.
- Passwords are checked for length/common values, not against breach lists.
- UTC month boundaries; the app does not know the user's time zone.
- No automated penetration test or third-party review has been done. Do one before storing real users' data at scale.
- The tax rules come from secondary sources (see [TAX.md](TAX.md)).

## Before going live
Use a fresh, strong database password and a Groq key that has never been shared anywhere. If a key or password was ever pasted into a chat, an issue, a commit or a screenshot, rotate it.

## Reporting a vulnerability
See [SECURITY.md](../SECURITY.md) in the repository root.

## Currency and tax access
The India-only tax rule is enforced on the server (`403 TAX_INDIA_ONLY` on all `/api/tax/*` routes); hiding the menu item is only a convenience. The currency value is validated against a fixed list on registration and on `PATCH /api/auth/currency`.
