# Database

PostgreSQL 13 or newer (uses the built-in `gen_random_uuid()`). Schema lives in `backend/migrations/` and is applied by `npm run db:migrate`.

## Entity relationships

```
users 1 ──< categories 1 ──< transactions >── 1 users
  │                │
  │                └──< budgets (category_id optional = overall budget)
  └──< budgets
```
Every table except `users` has a `user_id`. Deleting a user deletes all of their data (`ON DELETE CASCADE`).

## Tables

| Table | Purpose | Key columns |
|---|---|---|
| `users` | Accounts | `email` (unique, case-insensitive), `password_hash`, `full_name` |
| `categories` | Per-user income/expense categories | `name`, `kind` (`income`/`expense`), unique per user + kind + lower(name) |
| `category_rules` | A user's keyword rules (migration 003) | `pattern` (3-60 chars, normalised), `category_id`, `kind`; unique per user + kind + pattern; composite FK to `categories(id, user_id, kind)` so a rule can only point at the user's own category of the same kind; deleted with its category |
| `sips` | SIP / recurring investment records (migration 004) | `monthly_amount`, `start_date`, `duration_months` (NULL = ongoing), `step_up_percent`, `expected_return_percent` (the user's assumption), optional `current_value` + `current_value_as_of` (must be set together), `is_active` |
| `insurance_policies` | Insurance records (migration 004) | `policy_type`, `sum_assured`, `premium`, `premium_frequency`, `next_due_date`, `is_active` |
| `transactions` | Income and expenses | `type`, `amount NUMERIC(12,2) > 0`, `description`, `occurred_on DATE`, `category_id`, `category_source` (`user`/`rule`/`ai`/`default`) |
| `budgets` | Monthly limits | `month` (first day of month), `limit_amount >= 0`, `category_id` (NULL = overall budget) |
| `sessions` | Login sessions | `id_hash` (SHA-256 of the cookie token), `user_id`, `expires_at` |
| `schema_migrations` | Applied migrations + checksums | `name`, `checksum`, `applied_at` |

## Rules enforced by the database (not just the app)

- **Money is exact**: `NUMERIC(12,2)`, never floating point. node-postgres returns it as a string; convert deliberately.
- **Amounts are positive**: direction comes from `type`, not from a negative sign.
- **Users cannot see or reference each other's rows**: `transactions` and `budgets` reference `categories` through composite foreign keys that include `user_id`, so a transaction pointing at another user's category is rejected.
- **Type matches category kind**: an `expense` transaction cannot use an `income` category (composite FK includes `kind`).
- **Dates**: `occurred_on` is a `DATE`. The pool returns it as a `'YYYY-MM-DD'` string so no timezone shift can move a transaction to another day.
- **One budget per category per month** (and one overall budget per month), including the NULL-category case.
- `updated_at` is maintained by a trigger.
- Budgets are for expense categories; that rule lives in the service layer (Milestone 9).

Application-level checks (Milestone 4+) still validate input first; the database is the last line of defence.

## Migrations

- Files `backend/migrations/NNN_description.sql`, applied in order, each in its own transaction.
- Applied files are checksummed. Never edit an applied migration; add a new one. (Line endings are normalised, so Windows checkouts do not trip the check.)
- A PostgreSQL advisory lock prevents two processes migrating simultaneously.
- Commands: `npm run db:migrate`, `npm run db:status`.

## Sessions

Added in migration `002_sessions.sql`. Only a hash of the session token is stored; rows are deleted on logout, password change (other devices), account deletion (cascade) and by an hourly purge of expired rows. See [AUTH.md](AUTH.md).

## tax_profiles (migration 005)
One row per user per tax year (`UNIQUE (user_id, tax_year)`), `inputs jsonb` holding only the figures the user entered. Cascades on user delete.

## users.currency (migration 006)
`currency text NOT NULL DEFAULT 'INR'` with a CHECK limiting it to INR, USD, EUR, GBP, CAD, AUD, JPY. Existing users become INR. Changing it never rewrites stored amounts. See [CURRENCY.md](CURRENCY.md).
