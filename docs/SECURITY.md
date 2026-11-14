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

## Known gaps (not fixed, on purpose or for lack of scope)
- Rate-limit counters are in memory (per process, reset on restart).
- No email verification, password reset or two-factor login: there is no email service (keeping the project free).
- No audit log of account activity; no per-session management screen.
- Passwords are checked for length/common values, not against breach lists.
- UTC month boundaries; the app does not know the user's time zone.
- No automated penetration test or third-party review has been done. Do one before storing real users' data at scale.
- The tax rules come from secondary sources (see [TAX.md](TAX.md)).

## Rotate anything that was exposed
The development database password and an early AI key were pasted into a chat during development. Rotate them (new Postgres password, new Groq key).

## Reporting
This is a private project. Report problems to the owner.

## Currency and tax access
The India-only tax rule is enforced on the server (`403 TAX_INDIA_ONLY` on all `/api/tax/*` routes); hiding the menu item is only a convenience. The currency value is validated against a fixed list on registration and on `PATCH /api/auth/currency`.
