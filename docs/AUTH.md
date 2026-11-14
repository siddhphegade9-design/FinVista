# Authentication and user management

## How it works

1. **Register / login** (`POST /api/auth/register`, `/login`): the server validates input, hashes the password (scrypt) or verifies it, creates a session and sets the `fv_session` cookie.
2. **Session**: the cookie holds a random 256-bit token. The database stores only `SHA-256(token)` in `sessions`, so a database leak cannot be replayed as logins. Sessions expire after `SESSION_TTL_DAYS` (default 7) and are purged hourly.
3. **Protected routes** use the `requireAuth` middleware (`backend/src/middleware/auth.js`). Every route that touches user data uses it and scopes queries by `req.user.id`.
4. **Frontend**: protected pages call `requireLogin()`, which redirects to `/login.html?next=...` when logged out. The server is the real gate; the redirect is for usability.

## API

All bodies are JSON. Errors: `{ "error": { "code", "message", "details?" } }`. Validation failures are `400` with per-field `details`.

| Method and path | Auth | Purpose |
|---|---|---|
| `POST /api/auth/register` `{ fullName, email, password, currency? }` | no | Create account (currency defaults to INR), seed default categories, log in. `201`; `409` if the email exists |
| `POST /api/auth/login` `{ email, password }` | no | Log in. `401 INVALID_CREDENTIALS` (same message for unknown email and wrong password) |
| `POST /api/auth/logout` | no | End the session and clear the cookie. Always `200` |
| `GET /api/auth/session` | no | `{ user }` or `{ user: null }`; always `200` so pages can check quietly |
| `PATCH /api/auth/profile` `{ fullName }` | yes | Update name |
| `PATCH /api/auth/currency` `{ currency }` | yes | Change the display currency (INR, USD, EUR, GBP, CAD, AUD, JPY). Amounts are not converted |
| `POST /api/auth/change-password` `{ currentPassword, newPassword }` | yes | Change password; signs out all other devices |
| `DELETE /api/auth/account` `{ password }` | yes | Permanently delete the user and all their data |
| `GET /api/health` | no | Liveness + database status |

## Security measures

| Threat | Measure |
|---|---|
| Stolen database | Passwords: scrypt (N=32768, r=8, p=1, random salt, parameters stored per hash, auto-upgrade on login). Session tokens stored only as SHA-256 hashes. |
| Brute force / credential stuffing | Rate limits: failed logins per IP and per email, registrations per IP, password-confirming actions per user, plus a general per-IP API limit. `429` with `Retry-After`. |
| Account enumeration at login | Identical `401` for unknown email and wrong password; the server spends equal hashing time for unknown emails. |
| Session theft via XSS | Cookie is `HttpOnly`; strict CSP (no inline scripts). |
| CSRF | `SameSite=Lax` cookie; cross-site `Origin` / `Sec-Fetch-Site` rejected (`403`); bodies must be `application/json` (`415`). |
| Session fixation | Every login issues a new token and deletes any pre-login session. |
| Stale access | Changing the password signs out other devices; deleting the account cascades to sessions. |
| Open redirect | `?next=` accepts same-site paths only (unit tested). |
| Oversized / odd input | Password max 128 chars; JSON body max 256 KB; non-string values rejected, not coerced. |
| Cached secrets | `Cache-Control: no-store` on every API response; HSTS in production. |
| Transport | Cookie gets `Secure` when `NODE_ENV=production`. Deploy behind HTTPS and set `TRUST_PROXY=true` if using a reverse proxy. |

## Known limitations (deliberate, documented)

- **Registration reveals whether an email is registered** (`409`). Preventing that needs email verification, which is out of scope; it is rate limited.
- **No email verification or password reset by email** yet, and email cannot be changed.
- **Rate-limit counters are in memory** (per server process). Use a shared store if you run several instances.
- **No MFA.**
- **`?preview=1` sample dashboard is public** by design: it contains only clearly labelled sample data and no user data.
