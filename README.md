<p align="center">
  <img src="frontend/assets/brand/finvista-logo-original.png" alt="FinVista" width="720">
</p>

<h3 align="center">See your financial future, not just your past.</h3>

<p align="center">
  An AI-powered personal finance platform: track spending, forecast the months ahead, plan budgets, compare Indian tax regimes and ask an AI advisor about your own numbers.
</p>

<p align="center">
  <img alt="Node.js 22+" src="https://img.shields.io/badge/Node.js-22%2B-339933?logo=nodedotjs&logoColor=white">
  <img alt="PostgreSQL 13+" src="https://img.shields.io/badge/PostgreSQL-13%2B-4169E1?logo=postgresql&logoColor=white">
  <img alt="Vanilla JS" src="https://img.shields.io/badge/frontend-vanilla%20JS%20%2B%20CSS-F7DF1E?logo=javascript&logoColor=black">
  <img alt="Free to run" src="https://img.shields.io/badge/cost-free%20to%20run-8B5CF6">
</p>

![FinVista homepage](docs/screenshots/home.png)

## Why FinVista
- **Your numbers, explained.** Dashboards, trends and a health score built only from the transactions you record.
- **Looks ahead.** Transparent spending forecasts, unusual-spending checks and a what-if simulator, always labelled as estimates.
- **AI that doesn't make things up.** The advisor explains figures FinVista has already calculated; it never invents numbers or calculates tax.
- **Private by design.** No bank logins, ever. Each user sees only their own data, and only summaries are sent to the AI.
- **Free to run.** No paid services, no framework lock-in, four runtime dependencies.

## Screenshots

| Dashboard | Transactions |
|---|---|
| ![Dashboard](docs/screenshots/dashboard.png) | ![Transactions](docs/screenshots/transactions.png) |
| **Analytics** | **Budgets** |
| ![Analytics](docs/screenshots/analytics.png) | ![Budgets](docs/screenshots/budgets.png) |
| **Forecast and unusual spending** | **Investments (SIP)** |
| ![Forecast](docs/screenshots/forecast.png) | ![Investments](docs/screenshots/investments.png) |
| **Indian tax: old vs new regime** | **Health score and monthly report** |
| ![Tax](docs/screenshots/tax.png) | ![Reports](docs/screenshots/reports.png) |
| **AI advisor** | **Mobile** |
| ![AI advisor](docs/screenshots/advisor.png) | ![Mobile dashboard and menu](docs/screenshots/mobile.png) |

<sub>Screenshots use a demo account with sample data.</sub>

## Features

| Area | What you get |
|---|---|
| **Dashboard** | Monthly income, spending, savings and savings rate; six-month trend; category breakdown; budget progress; recent activity. A `?preview=1` mode shows clearly labelled sample data. |
| **Transactions** | Add, edit, search, filter and sort; CSV import (common bank formats, duplicate detection) and export (spreadsheet-formula safe). |
| **Smart categories** | Deterministic keyword rules for common Indian merchants, your own rules, and "always categorise this as…" learning from corrections. |
| **Analytics** | Any date range, compared with the previous period: monthly trends, cumulative savings, category and weekday breakdowns, largest expenses. |
| **Forecast** | Next three months from a recency-weighted average with a likely range; unusual amounts, category spikes and possible duplicates, each with a plain-language reason. |
| **Budgets and what-if** | Monthly limits per category or overall, pace warnings, suggestions from your history, and a simulator for income changes, cuts, one-off costs and savings goals. |
| **Investments and insurance** | SIP records with step-up and an assumed-return projection; insurance policies with premiums and renewal dates. |
| **AI advisor** | Ask about your money in plain language (Groq free plan). The advisor sees an aggregated summary only, and you can view exactly what it receives. |
| **Indian tax** | Old vs new regime estimate with every slab, deduction, rebate, surcharge and cess shown; can fill deductions from your SIP and insurance records. Rules are data, not AI. |
| **Reports** | An explainable 0–100 financial health score and a printable monthly report. |
| **Multi-currency** | INR, USD, EUR, GBP, CAD, AUD or JPY per account. Amounts are never converted; the tax tool is available for INR accounts only. |

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | HTML5, CSS3 (custom design system, no CSS framework), vanilla ES modules, Chart.js 4 |
| Backend | Node.js 22+, Express 4, REST API |
| Database | PostgreSQL 13+ via `pg`, hand-written SQL migrations |
| AI | Groq API (free plan), model `openai/gpt-oss-120b`, called only from the server; optional |
| Testing | `node:test` (unit and API tests against real PostgreSQL), Playwright browser checks |
| Deployment | Render + Neon (free), Docker / Docker Compose, or any Node host |

## Quick start

**Requirements:** Node.js 22 or newer and PostgreSQL 13 or newer.

1. **Clone and install**
   ```bash
   git clone https://github.com/<your-username>/finvista.git
   cd finvista
   npm install
   ```
2. **Create a database** (as the `postgres` superuser)
   ```sql
   CREATE USER finvista WITH PASSWORD 'choose-a-strong-password';
   CREATE DATABASE finvista OWNER finvista;
   CREATE DATABASE finvista_test OWNER finvista;   -- optional, only for the database tests
   ```
3. **Configure**
   ```bash
   cp .env.example .env          # Windows PowerShell: Copy-Item .env.example .env
   ```
   Set `DATABASE_URL` in `.env`, for example `postgresql://finvista:choose-a-strong-password@localhost:5432/finvista`.
   To enable the AI advisor, add a free key from [console.groq.com/keys](https://console.groq.com/keys) as `GROQ_API_KEY`. Everything else works without it.
4. **Create the tables and start**
   ```bash
   npm run db:migrate
   npm start                     # http://localhost:3000
   ```

Run `npm run db:migrate` again after pulling new code. `npm run dev` restarts on file changes; `npm run db:status` lists applied migrations.

### Configuration
All settings are environment variables, documented in [`.env.example`](.env.example). The main ones:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (required) |
| `GROQ_API_KEY` | Enables the AI advisor (optional, server-side only) |
| `NODE_ENV` | `production` turns on secure cookies, HSTS and hidden error details |
| `DATABASE_SSL`, `TRUST_PROXY` | `true` on hosted databases and behind a reverse proxy |
| `API_RATE_LIMIT_PER_MIN`, `AUTH_RATE_LIMIT_MAX` | Request and login limits |

## Running the tests
```bash
npm test                                                     # database tests are skipped
TEST_DATABASE_URL=postgres://user:password@localhost:5432/finvista_test npm test
```
The test database's tables are **dropped**; the runner refuses any database whose name does not contain `test`. Latest results and coverage: [docs/TESTING.md](docs/TESTING.md). GitHub Actions runs the full suite with PostgreSQL on pushes to `main` and on pull requests ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

## Deployment
FinVista is one Node.js process plus PostgreSQL, and can be hosted for free:

- **Render + Neon:** `render.yaml` is included. Create a free Neon database, connect the repository in Render as a Blueprint, and set `DATABASE_URL` (and optionally `GROQ_API_KEY`) in the Render dashboard.
- **Docker:** `docker compose up --build` runs the app and PostgreSQL together (written but not yet tested end-to-end; see the guide).
- **Any Node host:** `npm ci --omit=dev`, then `npm run start:prod` (applies migrations, then starts).

Production must run over HTTPS with `NODE_ENV=production`. Full guide and checklist: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Security and privacy
- Never asks for bank credentials; you enter or import your own records.
- scrypt password hashing; server-side sessions in HttpOnly, Secure, SameSite cookies.
- Strict Content Security Policy, CSRF protection, rate limiting and per-user data isolation, all covered by tests.
- Only aggregated figures are sent to the AI provider: no names, emails, descriptions or ids.
- `npm audit`: 0 known vulnerabilities at release.

Details: [docs/SECURITY.md](docs/SECURITY.md). To report a vulnerability, see [SECURITY.md](SECURITY.md).

## Project structure
```
backend/
  src/
    routes/  services/  middleware/  validation/  db/  auth/  config/  utils/
    analytics/ insights/ budgets/ simulator/ investments/ tax/ health/ categorization/   pure calculation modules
    ai/                    Groq client, prompt rules, aggregated context
  migrations/              versioned SQL schema (001–006)
  tests/                   unit and API tests
frontend/
  *.html                   one page per feature
  css/                     tokens → base → layout → components → page styles
  js/core, js/ui, js/<page> shared helpers, app shell, page modules
  assets/                  brand artwork, favicon, self-hosted Inter font
docs/                      documentation and screenshots
Dockerfile · docker-compose.yml · render.yaml
```

## Documentation
| Topic | Docs |
|---|---|
| Overview | [Architecture](docs/ARCHITECTURE.md) · [Database](docs/DATABASE.md) · [Roadmap](docs/ROADMAP.md) |
| Operations | [Deployment](docs/DEPLOYMENT.md) · [Security](docs/SECURITY.md) · [Testing](docs/TESTING.md) · [Authentication](docs/AUTH.md) |
| Features | [Transactions](docs/TRANSACTIONS.md) · [Categorisation](docs/CATEGORIZATION.md) · [Analytics](docs/ANALYTICS.md) · [Forecasting](docs/FORECASTING.md) · [Budgets](docs/BUDGETS.md) · [Investments](docs/INVESTMENTS.md) · [AI advisor](docs/ADVISOR.md) · [Tax](docs/TAX.md) · [Reports](docs/REPORTS.md) · [Currency](docs/CURRENCY.md) |

## Known limitations
- No email verification, password reset or two-factor login yet (there is no email service, which keeps the project free).
- Rate limits are kept in memory, which suits a single server instance.
- Month boundaries use UTC.
- The Groq free plan has shared limits (roughly 60–100 advisor questions a day across all users).
- Tax rules come from published summaries; confirm with the Income Tax Department or a chartered accountant before filing.

## Disclaimer
FinVista is a planning tool. Forecasts, simulations, tax figures and AI answers are estimates, not financial, investment or tax advice.

## Acknowledgements
[Chart.js](https://www.chartjs.org/) (MIT) · [Inter](https://rsms.me/inter/) typeface (SIL Open Font License) · [Groq](https://groq.com/) for the free inference API.

## License
Copyright © 2026 the FinVista author. All rights reserved. No open-source licence has been granted yet.
