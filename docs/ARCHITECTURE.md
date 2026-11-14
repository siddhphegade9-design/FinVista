# FinVista Architecture

## Principles
1. **Separation of concerns.** Frontend (static, vanilla), backend (REST API), database (PostgreSQL), calculation modules and AI integration are separate.
2. **Deterministic money logic.** All financial calculations (prediction, anomaly detection, budgets, tax, score) are plain JavaScript functions with unit tests. The AI model only *explains* figures supplied by the backend; it never computes tax or invents transactions.
3. **Backend-only secrets.** API keys and DB credentials are read via `backend/src/config/env.js` and never reach the browser.
4. **Per-user data isolation.** Every query will be scoped by the authenticated user's id (Milestone 4+).

## Decisions made in Milestone 1
| Decision | Reason |
|---|---|
| Express serves the frontend and `/api` from one origin | Same-origin cookies for sessions (no CORS, simpler CSRF story) and a strict CSP. |
| Chart.js served from `/vendor/chart.js` (from `node_modules`) | No CDN, so the CSP can stay `script-src 'self'`. |
| Self-hosted Inter variable font (OFL licence) | Premium typography without third-party requests. |
| ES modules in the browser, no bundler | No build step; meets the "no frameworks" rule; easy to read. |
| `createApp()` separated from `listen()` | Lets tests start the app on a random port. |
| Hand-written security headers | One fewer dependency now; revisit `helmet` in Milestone 13. |
| CSP disallows inline styles | Dynamic styles go through the CSSOM / CSS custom properties (e.g. `--value` on progress bars). |
| Amounts will be stored as `NUMERIC(12,2)` | Avoids floating-point drift for money (Milestone 3). |

## Backend layout (`backend/src`)
- `config/env.js` validated environment config.
- `middleware/` security headers, error handling (JSON `{ error: { code, message } }`). Auth, validation and rate limiting arrive in Milestones 4 and 13.
- `routes/` one router per feature, mounted in `routes/index.js` under `/api`.
- Planned: `db/`, `services/` (business logic), `calculations/` (pure financial maths), `ai/` (Groq client and prompts).

## Frontend layout (`frontend`)
- **CSS** layered by responsibility: `tokens.css` (all variables) -> `base.css` -> `layout.css` -> `components.css` -> `utilities.css`. Class names follow `block__element--modifier`.
- **JS** `core/` has framework-free helpers (pure ones are unit-tested); `ui/` has behaviour components; each page has its own entry module.
- **Estimates vs actuals:** predicted/simulated values must use the dashed `badge--estimate` style so they are never confused with real records.

## API conventions
- JSON only; errors use `{ "error": { "code": "...", "message": "..." } }`.
- Currently: `GET /api/health`.

## Milestone 2 additions
| Decision | Reason |
|---|---|
| Dashboard figures come from `js/dashboard/metrics.js`, a pure module | Every number is traceable to transaction records and unit-tested. Money is summed in integer paise to avoid float drift (`0.1 + 0.2`). |
| `dataSource.js` is the only place the dashboard obtains data | Since Milestone 5 it loads `/api/transactions/all`; rendering code did not change. |
| Empty states instead of placeholder data | The real dashboard shows zeros and "nothing yet" messages when there are no records. |
| `?preview=1` sample mode | Lets the design be reviewed. It shows a warning banner, is deterministic, never future-dated, and nothing is stored. |
| Not-yet-built menu items are disabled with a "Soon" badge | No links to missing pages. |
| Login/register pages validate input but do not submit | They state that authentication arrives in Milestone 4 rather than faking sign-in. |
| Savings rate is `null` (shown as "—") when a month has no income | A rate against zero income is undefined, not 0%. |

### Dashboard metric definitions
- **Total income / expenses**: sums for the selected month; delta compares with the previous month (hidden if the previous month has no data).
- **Current savings**: all-time income minus all-time expenses.
- **Savings rate**: (month income - month expenses) / month income.
- **Budget status**: ok below 80% of limit, warning from 80% to 100%, over above 100%.

## Milestone 3 additions
| Decision | Reason |
|---|---|
| Plain `pg` + hand-written SQL migrations | No ORM dependency; SQL is explicit and easy to review. Parameterised queries only. |
| Lazy connection pool | The app and `/api/health` still start with no database; features that need one fail with a clear error. |
| `/api/health` returns 503 only when a configured DB is unreachable | Lets a load balancer/monitor detect a broken database without exposing connection details. |
| Constraints in the database (ownership FKs, positive amounts, kind match) | Isolation and money rules hold even if application code has a bug. See [DATABASE.md](DATABASE.md). |
| `HttpError` + `asyncHandler` | One consistent way to raise client-facing errors; async route failures reach the JSON error handler. |
| DB tests need an explicit `TEST_DATABASE_URL` and refuse non-"test" database names | A test run can never wipe real data. |

## Milestone 4 additions
| Decision | Reason |
|---|---|
| Server-side sessions in PostgreSQL (not JWTs) | Sessions can be revoked instantly (logout, password change, deletion); nothing sensitive lives in the browser. |
| Built-in `crypto.scrypt` for passwords | Memory-hard and OWASP-accepted, with no native-module install problems on Windows. |
| Hand-written rate limiter, CSRF guard, cookie parser, validators | Small, fully tested, and avoid several dependencies. Limits are documented in AUTH.md. |
| `requireAuth` middleware + `req.user.id` scoping | The single pattern every later feature (transactions, budgets...) must follow, backed by the DB ownership foreign keys. |
| `GET /api/auth/session` always returns 200 | Public pages can check login state without browser console errors. |
| `?preview=1` stays public | It shows only labelled sample data, never user data. |
| DB tests run serially (`--test-concurrency=1`) | Test files share one test database. |
| One currency per user; amounts are never converted | There are no exchange rates or live data, so switching only changes display and rules. See [CURRENCY.md](CURRENCY.md). |

## Milestone 5 additions
| Decision | Reason |
|---|---|
| Money is parsed from text to integer paise and written as an exact `"123.45"` string | No floating point anywhere between the form and `NUMERIC(12,2)`. Over-precise input (`1.005`) is rejected, never rounded. |
| Every query filters by `user_id`; ids from the URL are checked as UUIDs first | A user can never read or change another user's rows. A foreign or malformed id is a plain 404, so it does not reveal that the row exists. |
| Category must belong to the user and match the transaction type (validated, plus the composite FK) | Friendly 400 in normal use; the database still refuses anything that slips through. |
| Sorting uses a fixed allow-list; search escapes `%` and `_` | No user text reaches the SQL structure; searching for `100%` finds `100%`. |
| List responses carry totals over **all** matches, not just the visible page | The summary strip stays correct while paging. |
| Future dates are rejected (one day of timezone slack) | A transaction records something that happened. Predictions arrive in Milestone 8 and stay visibly separate from actuals. |
| CSV is parsed in the browser, validated and normalised on the server | The server is the only authority on what is valid; the browser only splits text and maps headers. |
| CSV export neutralises formula cells (`=`, `+`, `-`, `@`); import undoes that | Prevents spreadsheet formula injection when exported files are opened in Excel or Sheets. |
| Import: per-row validation, valid rows inserted in one transaction, duplicates skipped by default | A bad row never blocks good ones, results name each skipped row, and re-importing a file does not double your data. |
| `/api/transactions/all` (capped at 20,000, flagged when truncated) feeds the dashboard | Milestone 6 will move aggregation into SQL; until then the dashboard's tested pure functions keep one source of truth. |

## Milestone 6 additions
| Decision | Reason |
|---|---|
| Analytics are computed on the server in SQL (grouped sums), shaped by a pure `analytics/calc.js` | The database does the heavy lifting; every calculation is unit-tested without a database; the browser only draws. |
| Money is summed as integer paise and rounded once | No floating-point drift: the monthly series, category totals and top-level totals always agree (a test checks the totals match the transactions list for the same range). |
| Comparison is always against the equally long period immediately before | A fair like-for-like comparison. When the previous period has no spending, the change is `null` and the UI says so instead of showing a made-up percentage. |
| Savings rate is `null` (not 0%) when there is no income | A rate against zero income is undefined. |
| The monthly series is zero-filled | Charts never skip a month silently. |
| Averages say how many months they cover and flag an unfinished current month | The current month is partial, so an average over it would otherwise be quietly misleading. |
| Only recorded transactions are used; nothing is forecast | Predictions arrive in Milestone 8 and will be visually distinct from these actuals. |
| Charts are rebuilt on each load; canvases have text labels and every chart has a text list or table beside it | Simple and reliable; screen-reader users and anyone who prefers numbers still get the data. |
| The dashboard keeps its client-side calculations for now | It still reads `/transactions/all`. Analytics covers arbitrary ranges server-side. |

## Milestone 7 additions

| Decision | Why |
| --- | --- |
| Categorisation is deterministic keyword rules, no AI (`backend/src/categorization/`) | Same description, same category, with a visible reason. Cheap, testable, and nothing leaves the server. The `ai` source value is reserved for a later, clearly labelled use. |
| Pure engine (`engine.js`) separate from database code (`services/categoryRules.js`) | The matching rules are unit-tested without a database. |
| `category_source` records who decided | Rules may only re-categorise rows that were not chosen by the user, so a manual choice is never silently overwritten. |
| Re-applying rules defaults to a dry run | The user sees what would change before anything is written. |

## Milestone 8 additions

| Decision | Why |
| --- | --- |
| Forecasting is a transparent statistical method, not AI (`backend/src/insights/forecast.js`) | Recency-weighted average with a one-standard-deviation range. Anyone can recompute it from their own months, and it refuses to guess with too little history. |
| Anomaly rules are separate pure functions with explicit thresholds (`insights/anomalies.js`) | Each flag carries a plain-language reason and the thresholds are in one frozen config object. Wording never says "fraud". |
| Projections are visually distinct (dashed, lighter, tagged "projected") | The spec requires predictions to be distinguishable from actuals. |

## Milestone 8.5 additions

| Decision | Why |
| --- | --- |
| SIPs and policies are user-entered records, with no bank or fund-house connection | The spec forbids requesting banking credentials. Every figure is either entered by the user or an estimate that is labelled as one. |
| SIP maths is a pure module (`investments/sip.js`) with a stated model | Instalment schedule, yearly step-up and monthly compounding of the user's assumed return are documented in docs/INVESTMENTS.md and unit-tested against hand-computed values. |
| A value the user read off a statement is stored separately from modelled values | Actuals and estimates are never mixed. |
| Commitments are reported next to the forecast, not inside it | Avoids double counting when debits are also recorded as transactions. |
| Generic record dialog (`js/ui/recordForm.js`) | One tested form component for both record types, showing server validation per field. |

## Milestone 9 additions
| Decision | Why |
|---|---|
| Budget and simulator maths are pure modules (`budgets/calc.js`, `simulator/calc.js`) working in integer paise | Unit-tested against hand-computed values; no floating-point drift on money. |
| Simulator reuses the forecast baseline and stores nothing | Predictions/simulations stay clearly separate from recorded actuals; the response carries an explicit "simulation" label. |
| No new migration | The `budgets` table from migration 001 already covers the model; a unique index on `COALESCE(category_id, zero-uuid)` makes "one overall budget" enforceable. |

## Milestone 10 additions
| Decision | Why |
|---|---|
| The AI provider (Groq) is called only from `ai/groq.js` on the server; key in env, header auth, injectable `fetch` | The key never reaches the browser or logs; tests run without network. |
| The model receives a fixed, aggregated facts snapshot (`ai/context.js`), never raw rows or descriptions | Minimises personal data sent to a third party and removes the main prompt-injection channel (imported text). |
| Tax rules are data in `tax/rules.js`; engine is pure and AI-free | Law changes are a data edit; results are reproducible and unit-testable. |
| Health score is a pure function that drops unmeasurable factors and rescales | Missing data never counts as good or bad; every point is traceable. |
| Advisor is stateless and rate-limited per user | Nothing sensitive stored; cost and abuse bounded. |
| A local fake Groq server is part of the test helpers | The real client path is exercised over HTTP without a key. |

## Milestone 13 additions
- `blockNonPublicFiles` in `app.js` keeps tests, package metadata and (in production) the styleguide out of the static site.
- `server.js`: production refuses to start without `DATABASE_URL`; unhandled errors log and shut down cleanly; shutdown has a 10 s forced exit.
- `npm run start:prod` = migrate then start. `Dockerfile`, `docker-compose.yml`, `render.yaml` for deployment (see [DEPLOYMENT.md](DEPLOYMENT.md)).
- [SECURITY.md](SECURITY.md) and [TESTING.md](TESTING.md) record the measures, known gaps and final results.
| One shared theme file for signed-in pages (`frontend/css/app.css`) | Loaded after `dashboard.css` and before page files, so every page gets the same sidebar, cards, tables and forms while page files can still adjust their own widgets. |
