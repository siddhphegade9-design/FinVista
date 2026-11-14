# Deployment

FinVista is one Node.js process (Express serves the API and the static frontend) plus PostgreSQL. Everything below can be run **for free**.
No paid service, billing or subscription is required or added by the app.

> **Not verified here:** the Docker image and the Render blueprint were written but could not be built or deployed from the development sandbox
> (no Docker daemon, no hosting account). What *was* verified: a production-only install (`npm ci --omit=dev`), `npm run start:prod`
> against PostgreSQL (migrations applied, server up, health OK, HSTS and Secure cookie set, dev files hidden, fail-fast without a database).
> Treat the first real deploy as a test and check the steps against the providers' current docs.

## Required settings
| Variable | Production value | Why |
|---|---|---|
| `NODE_ENV` | `production` | Secure cookies, HSTS, hides internal error text and the dev styleguide, refuses to start without a database |
| `DATABASE_URL` | your PostgreSQL connection string | |
| `DATABASE_SSL` | `true` for hosted Postgres | TLS to the database (certificate is verified) |
| `TRUST_PROXY` | `true` behind a proxy/PaaS, otherwise `false` | Correct client IP for rate limiting. Never `true` if the app is directly exposed |
| `GROQ_API_KEY` | optional | Leave empty to disable the AI advisor. Never commit it |
| `PORT` | set by the host, default 3000 | |

`npm run start:prod` applies pending migrations (idempotent, guarded by a database lock) and then starts the server.
Production serves **only over HTTPS**: the session cookie is `Secure`, so logins will not persist over plain HTTP (except `localhost` in Chrome).

## Option A: free hosting (Render web service + Neon Postgres)
Limits checked 14 Nov 2026 against the providers' published pages; they change, so re-check.
- **Render free web service:** no card needed, 750 free instance hours a month, **sleeps after 15 minutes without traffic and takes about a minute to wake**, ephemeral filesystem (FinVista stores nothing on disk).
  Render's *own* free Postgres is deleted after 30 days, so do not use it.
- **Neon free Postgres:** no card, no time limit, 1 GB storage per project, 100 compute-hours a month, compute suspends after 5 minutes idle (the first request after idle is slower).

Steps:
1. Create a Neon project and copy the connection string (it ends in `?sslmode=require`).
2. Push this repository to GitHub (`.env` is git-ignored; never commit it).
3. In Render: New, Blueprint, pick the repo (it reads `render.yaml`), or create a Web Service manually with build `npm ci --omit=dev` and start `npm run start:prod`.
4. Set `DATABASE_URL` (Neon string) and optionally `GROQ_API_KEY` in the Render dashboard. `render.yaml` already sets `NODE_ENV`, `TRUST_PROXY` and `DATABASE_SSL`.
5. Open the Render URL, register, and check `/api/health` shows `"database": "ok"`.

Consequences of the free tier you should expect: slow first load after sleep; the in-memory rate limiter and nothing else resets on restart
(sessions live in the database and survive); the Groq free-plan limits in [ADVISOR.md](ADVISOR.md) are shared by all users.

## Option B: self-host with Docker (free, any machine)
```bash
# .env next to docker-compose.yml:  POSTGRES_PASSWORD=<long random>   GROQ_API_KEY=<optional>
docker compose up --build        # http://localhost:3000
```
The app listens on `127.0.0.1:3000` only and serves plain HTTP. To expose it, put a TLS-terminating reverse proxy (Caddy, nginx, Cloudflare Tunnel) in front
and set `TRUST_PROXY=true`. Data lives in the `finvista-data` volume: back it up (`pg_dump`).

## Option C: no Docker
Install Node 22 and PostgreSQL, set the variables above, run `npm ci --omit=dev` then `npm run start:prod` under a process manager (systemd, pm2).

## Operations
- **Health:** `GET /api/health` (200 when ok, 503 when a configured database is unreachable).
- **Logs:** stdout/stderr only. Errors are logged without request bodies; the Groq key and session tokens are never logged.
- **Updates:** deploy new code; migrations run on start. Migrations are forward-only. Back up the database first.
- **Backups:** free hosted databases may offer none (Render free: none). Export your data from the app (Transactions, Export CSV) or run `pg_dump`.
- **Shutdown:** SIGTERM drains connections and closes the pool; a forced exit follows after 10 seconds.
- **Scaling out:** rate limiters are per process. With more than one instance use a shared store (not implemented).

## Production checklist
- [ ] `NODE_ENV=production`, HTTPS in front, `TRUST_PROXY` set correctly
- [ ] Strong, unique database password; rotated if it was ever pasted anywhere
- [ ] `GROQ_API_KEY` set only in the host's secret settings
- [ ] `/api/health` shows `database: ok`; register, log in, add a transaction
- [ ] Backup plan decided
