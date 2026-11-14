# Architecture

FinVista is a single Node.js process: Express serves the REST API under `/api` and the static frontend from the same origin, backed by PostgreSQL. There is no frontend framework and no build step.

```
Browser (HTML + CSS + ES modules + Chart.js)
   │  same-origin fetch, JSON, session cookie
   ▼
Express app (backend/src/app.js)
   ├─ security headers · JSON body limit · rate limit · CSRF guard
   ├─ /api routers ──► services (SQL, scoped to req.user.id) ──► PostgreSQL
   │                     └─► pure calculation modules (no I/O, unit-tested)
   │                     └─► ai/groq.js ──► Groq API (optional, server-side only)
   └─ static files from frontend/ (tests, package files and dev pages blocked)
```

## Principles
1. **Deterministic money logic.** Forecasts, anomaly checks, budgets, the simulator, tax and the health score are plain JavaScript functions with unit tests. The AI model only *explains* figures the server already computed; it never calculates tax or sees raw transactions.
2. **Exact money.** Amounts are `NUMERIC(12,2)` in the database and integer paise (minor units) in code. Input with more than two decimals is rejected, never rounded.
3. **Per-user isolation.** Every protected route uses `requireAuth`; every query filters by `req.user.id`; composite foreign keys stop a row from pointing at another user's data.
4. **Secrets stay on the server.** All configuration is read once in `backend/src/config/env.js`. Keys never reach the browser or the logs.
5. **Honest output.** Estimates and simulations are labelled and styled differently from recorded actuals; anomalies are "worth a look", never "fraud"; empty accounts show empty states, not sample data.

## Backend (`backend/src`)
| Folder | Contents |
|---|---|
| `app.js`, `server.js` | App factory (used by tests) and the process entry: fail-fast config, graceful shutdown, hourly session purge |
| `config/` | `env.js` (validated settings), `currencies.js` (supported currencies), default categories |
| `middleware/` | Security headers and CSP, CSRF guard, rate limiter, `requireAuth`, JSON error handler |
| `routes/` | One router per feature, mounted in `routes/index.js` |
| `services/` | Database access and orchestration for each feature |
| `db/` | Connection pool and the migration runner |
| `auth/` | scrypt password hashing, session tokens, cookie parsing |
| `validation/` | Input validators returning per-field errors |
| `analytics/`, `insights/`, `budgets/`, `simulator/`, `investments/`, `tax/`, `health/`, `categorization/` | Pure calculation modules |
| `ai/` | Groq client, prompt rules and the aggregated facts snapshot sent to the model |
| `utils/` | `HttpError`, async route wrapper, CSV helpers |

Migrations live in `backend/migrations/` (see [DATABASE.md](DATABASE.md)).

## API
JSON only. Errors are `{ "error": { "code", "message", "details?" } }`; validation failures are `400` with per-field `details`.

| Prefix | Purpose | Details |
|---|---|---|
| `/api/health` | Liveness and database status | [DEPLOYMENT.md](DEPLOYMENT.md) |
| `/api/auth` | Register, login, logout, session, profile, currency, password, delete account | [AUTH.md](AUTH.md) |
| `/api/transactions` | CRUD, filters, CSV import/export | [TRANSACTIONS.md](TRANSACTIONS.md) |
| `/api/categories` | Categories and keyword rules | [CATEGORIZATION.md](CATEGORIZATION.md) |
| `/api/analytics` | Totals, trends and breakdowns for a date range | [ANALYTICS.md](ANALYTICS.md) |
| `/api/forecast`, `/api/anomalies` | Spending forecast and unusual-spending checks | [FORECASTING.md](FORECASTING.md) |
| `/api/sips`, `/api/insurance` | Investment and insurance records | [INVESTMENTS.md](INVESTMENTS.md) |
| `/api/budgets`, `/api/simulator` | Monthly budgets and the what-if simulator | [BUDGETS.md](BUDGETS.md) |
| `/api/advisor` | AI advisor | [ADVISOR.md](ADVISOR.md) |
| `/api/tax` | Indian income-tax estimator (INR accounts only) | [TAX.md](TAX.md) |
| `/api/reports` | Health score and monthly report | [REPORTS.md](REPORTS.md) |

## Frontend (`frontend`)
- **Pages:** one HTML file per page (`index`, `login`, `register`, `dashboard`, `transactions`, `categories`, `analytics`, `budgets`, `forecast`, `investments`, `insurance`, `simulator`, `advisor`, `tax`, `reports`, `account`), each with its own entry module in `js/<page>/`.
- **Shared JS:** `js/core/` (API client, auth helpers, formatting per currency, DOM helpers, chart theme) and `js/ui/` (app shell and sidebar, dialogs, record forms, navigation).
- **CSS layers:** `tokens.css` (every colour, size and timing) → `base.css` → `layout.css` → `components.css` → `utilities.css`; then `home.css` / `landing.css` for public pages, or `dashboard.css` → `app.css` (shared app theme) → page files for signed-in pages. Class names follow `block__element--modifier`.
- **Charts:** Chart.js 4, served from `node_modules` at `/vendor/chart.js` (no CDN), themed once in `js/core/chartTheme.js`.
- **Branding:** the wordmark and icons in `assets/brand/` are the owner's supplied artwork; `assets/favicon.svg` is the browser-tab icon.

## Key decisions
| Decision | Why |
|---|---|
| Same origin for API and site | Session cookies without CORS; a strict CSP (`script-src 'self'`, no inline scripts or styles). |
| Server-side sessions in PostgreSQL, not JWTs | Instant revocation on logout, password change or account deletion. Only a SHA-256 hash of the token is stored. |
| Hand-written CSRF guard, rate limiter, validators, security headers | Four runtime dependencies in total (`express`, `pg`, `dotenv`, `chart.js`); every piece is small and tested. |
| Plain `pg` with hand-written SQL migrations | No ORM; parameterised queries only; migrations are checksummed and run under an advisory lock. |
| Server-side analytics in SQL, shaped by pure modules | The database aggregates; the maths is unit-tested without a database; the browser only draws. |
| Dashboard metrics computed in the browser from `/api/transactions/all` (capped at 20,000 rows, flagged when truncated) | One tested pure module (`js/dashboard/metrics.js`) serves both real data and the `?preview=1` sample mode. Budgets come from `/api/budgets`. |
| Rule-based categorisation, statistical forecasting and anomaly rules, no AI | Same input, same output, with a visible reason. Nothing leaves the server. |
| Tax rules as data (`tax/rules.js`), engine as a pure function | A law change is a data edit; results are reproducible and tested against hand-worked cases. |
| AI sees an aggregated snapshot only (`ai/context.js`) | No names, emails, descriptions or ids are sent; this also closes the main prompt-injection channel (imported text). |
| One currency per user; amounts never converted | No exchange rates are involved; the tax tool is enforced as INR-only on the server. See [CURRENCY.md](CURRENCY.md). |
| `start:prod` migrates then starts; production refuses to start without a database | Safe, repeatable deploys. See [DEPLOYMENT.md](DEPLOYMENT.md). |

History of how the project was built, milestone by milestone: [ROADMAP.md](ROADMAP.md).
