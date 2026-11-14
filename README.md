![FinVista](frontend/assets/brand/finvista-logo-original.png)

# FinVista

**See Your Financial Future.** An AI-powered personal finance intelligence platform for India: transactions and analytics, categorisation, spending forecast and unusual-spending detection, SIP and insurance tracking, budgets and what-if simulation, an AI advisor (Groq free plan), Indian income-tax estimation, and a financial health score with monthly reports.

> **Status: all 13 milestones complete.** See [docs/ROADMAP.md](docs/ROADMAP.md). Free to run: no paid service, billing or subscription is used.

## Stack
| Layer | Technology |
|---|---|
| Frontend | HTML5, pure CSS3, vanilla ES6+ modules, Chart.js (no frameworks, no CSS frameworks) |
| Backend | Node.js (>= 22), Express, REST |
| Database | PostgreSQL 13+ (`pg` driver, forward-only SQL migrations) |
| AI | Groq free plan, model `openai/gpt-oss-120b`, backend-only (`GROQ_API_KEY`). Optional: the app works without it |

## Getting started
1. Install Node.js 22+ and PostgreSQL 13+.
2. Create a database and user (as the `postgres` superuser):
   ```sql
   CREATE USER finvista WITH PASSWORD 'choose-a-password';
   CREATE DATABASE finvista OWNER finvista;
   CREATE DATABASE finvista_test OWNER finvista;   -- optional, only for the database tests
   ```
3. Install and configure:
   ```bash
   npm install
   cp .env.example .env      # Windows: copy .env.example .env
   ```
   Set `DATABASE_URL` in `.env` (e.g. `postgresql://finvista:choose-a-password@localhost:5432/finvista`). Optionally set `GROQ_API_KEY` (free key at console.groq.com/keys).
4. Apply the schema and start (run `npm run db:migrate` again whenever you pull new code):
   ```bash
   npm run db:migrate
   npm start                 # http://localhost:3000
   ```
`npm run dev` restarts on change; `npm run db:status` lists migrations. Without a database the site still starts and `/api/health` reports `"database": "not_configured"`.

Deploying: see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) (free options: Render + Neon, or Docker). Production start is `npm run start:prod`.

## Pages
| URL | What it is |
|---|---|
| `/` , `/login.html`, `/register.html` | Landing page, log in, create an account |
| `/dashboard.html` | Overview of your own data (`?preview=1` shows labelled sample data) |
| `/transactions.html` | Add, edit, delete, search, filter, import and export transactions |
| `/categories.html` | Categories and keyword rules |
| `/analytics.html` | Charts and totals for any date range |
| `/budgets.html` | Monthly category budgets against actual spending |
| `/forecast.html` | Typical-month estimate and unusual spending (estimates, not predictions of exact figures) |
| `/investments.html`, `/insurance.html` | SIP and insurance records (your own entries) |
| `/simulator.html` | What-if simulator (clearly labelled as simulation) |
| `/advisor.html` | AI advisor that explains your computed figures |
| `/tax.html` | Old vs new regime tax estimate (deterministic rules, not AI) |
| `/reports.html` | Financial health score, printable monthly report, CSV link |
| `/account.html` | Profile, password, delete account |
| `/api/health` | Health endpoint |

## Tests
`npm test` runs everything; database tests need `TEST_DATABASE_URL` (a throwaway database whose name contains "test": **its tables are dropped**). Final results and what is not tested: [docs/TESTING.md](docs/TESTING.md).

## Documentation
[ARCHITECTURE](docs/ARCHITECTURE.md), [DATABASE](docs/DATABASE.md), [AUTH](docs/AUTH.md), [SECURITY](docs/SECURITY.md), [TESTING](docs/TESTING.md), [DEPLOYMENT](docs/DEPLOYMENT.md), and per feature: [TRANSACTIONS](docs/TRANSACTIONS.md), [ANALYTICS](docs/ANALYTICS.md), [CATEGORIZATION](docs/CATEGORIZATION.md), [FORECASTING](docs/FORECASTING.md), [INVESTMENTS](docs/INVESTMENTS.md), [BUDGETS](docs/BUDGETS.md), [ADVISOR](docs/ADVISOR.md), [TAX](docs/TAX.md), [REPORTS](docs/REPORTS.md), [CURRENCY](docs/CURRENCY.md).

## Project structure
```
backend/src/     config/, db/, auth/, middleware/, routes/, services/, validation/, utils/ and the pure-logic modules:
                 categorization/, insights/, investments/, budgets/, simulator/, tax/, health/, ai/
backend/migrations/  Versioned SQL schema (001-005)
backend/tests/   Backend tests (node:test)
frontend/        Static site: css/ (tokens -> base -> layout -> components), js/core, js/ui, one folder per page
docs/            Documentation
Dockerfile, docker-compose.yml, render.yaml   Deployment
```

## Principles (what the app does and does not do)
- **Honest data:** nothing is fabricated. Forecasts and simulations are labelled as estimates; anomalies are "unusual", never "fraud"; the health score says which factors it could measure.
- **Tax is code, not AI:** the rules are data in `backend/src/tax/rules.js`; the AI advisor never calculates tax.
- **Privacy:** the app never asks for banking credentials. Only aggregates are sent to the AI (no names, emails, descriptions or IDs). Each user sees only their own data.
- **Not advice:** everything is an estimate for planning, not financial or tax advice.

## Known limitations
- Seven currencies are supported (INR, USD, EUR, GBP, CAD, AUD, JPY). Switching currency never converts stored amounts, and the Indian tax tool works only for INR. See [docs/CURRENCY.md](docs/CURRENCY.md).
- Tax rules were taken from secondary sources; confirm with the Income Tax Department before filing. Capital gains, business income and other cases are not covered.
- Rate limiters are in memory (per process). No email verification, password reset or two-factor login (there is no email service).
- The Groq free plan has shared limits (about 2-3 questions a minute and roughly 60-100 a day across all users). The real Groq API was not called during development; tests use a local fake.
- Month boundaries use UTC. Seasonality is not modelled in forecasts. Anomalies cannot be dismissed. SIP instalments are assumed paid; policy due dates are not rolled forward automatically.
- Dashboard figures are computed in the browser from your transactions.
- Docker and Render deployment were written but not run from the development sandbox. Details: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md), [docs/SECURITY.md](docs/SECURITY.md).

## Brand
The logo files in `frontend/assets/brand/` are the originals supplied by the owner (`finvista-logo-original.png`, `finvista-badge-original.png`) and are used as-is. `finvista-wordmark.png` and `finvista-icon-*.png` are the same images with only the empty margin trimmed and resized for the header and browser tab. The pages blend the logo's dark backdrop into the page with CSS; the image pixels are not edited.

