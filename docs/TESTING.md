# Testing

Results from the latest full run (14 Nov 2026, Node 22, PostgreSQL 16):

| Suite | Command | Result |
|---|---|---|
| Backend and frontend, with a test database | `TEST_DATABASE_URL=... npm test` | **335 / 335 pass** |
| Same, without a database | `npm test` | 173 pass, 16 skipped (database tests), 0 fail |
| Browser end-to-end (Chrome via Playwright against a local server and database) | scripts kept outside the repository | **359 / 359 checks pass** across 12 suites |
| Production-mode probe | manual, see [SECURITY.md](SECURITY.md) | headers, cookies, hidden files, CSRF, brute force, isolation and injection all as expected |

## What is covered
- **Unit:** money maths, categorisation rules, forecast and anomaly detection, SIP and insurance maths, budget/simulator maths, advisor prompt and context (no personal data), tax engine (hand-verified cases), health score, CSV, formatters.
- **API with real PostgreSQL:** every route requires login, validation, per-user isolation, the full CRUD for each feature, rate limits, AI error mapping with a local fake Groq server.
- **Security** (`security.api.test.js`): headers, non-public files and path traversal, request hardening, production-mode cookie/HSTS/error masking, session replay, tenant isolation sweep, injection and prototype-pollution payloads, CSV formula injection.
- **Browser:** every page (including the redesigned homepage and app shell) loaded at 375, 768 and 1440 px (no horizontal overflow, no console or CSP errors), accessibility basics (labels, names, one `h1`, `main`, language, title, unique ids), mobile drawer with Escape, hostile text shown literally, print view of reports.

## Running them
```bash
npm test                                   # DB tests skipped unless TEST_DATABASE_URL is set
TEST_DATABASE_URL=postgres://user:pw@localhost:5432/finvista_test npm test   # its tables are DROPPED: use a throwaway database
```
The test runner refuses any database whose name does not contain "test".

## Not tested
- The **real Groq API** (no key or network access in the sandbox). The integration is tested against a local fake that mimics its responses and errors. Ask one real question to confirm.
- The **Docker image** and the Render deployment (see [DEPLOYMENT.md](DEPLOYMENT.md)).
- Browsers other than Chrome; real phones (only a 375 px viewport); screen readers; colour contrast measurement (design tokens were chosen for contrast but not audited with a tool).
- Load and concurrency beyond the unit/API tests.

## Multi-currency
Backend: currency unit tests, API tests (register, change, 403 on tax, validation), migration 006. Frontend: formatting per currency and a parity test between the browser and server tables. Browser: `e2e15` (register with a currency, switch with a confirm dialog, tax page closed and reopened, 403 from the API).
