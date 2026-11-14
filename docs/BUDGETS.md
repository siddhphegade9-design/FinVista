# Budgets and the what-if simulator (Milestone 9)

## Budgets
A budget is a monthly spending limit the user sets for one expense category, or one **overall** limit for all spending. They live in the existing `budgets` table (migration 001: `month` is the first day of the month, `category_id` NULL = overall), so this milestone adds no migration. One budget per user, month and category (enforced by a unique index on `COALESCE(category_id, zero-uuid)`); the category must be an expense category owned by the user; at most 80 budgets per month.

"Spent" is the sum of the user's recorded expenses in that category and month. Nothing is predicted.

| Status | Rule |
|---|---|
| `ok` | spent below 80% of the limit |
| `watch` ("Close to limit") | spent is 80% or more of the limit, not above it |
| `over` | spent above the limit (a zero limit with any spending is also `over`) |

For the current, unfinished month an `ok` budget gets a **pace note** when the share used is more than 15 points ahead of the share of the month that has passed. Past and future months get no pace note. Spending in categories with no budget is listed separately and can be turned into a budget in one click.

Money is handled in integer paise in `backend/src/budgets/calc.js` (pure, unit-tested) and sent to PostgreSQL as exact strings.

### API (all require a session; every query is scoped to `req.user.id`)
- `GET /api/budgets?month=YYYY-MM` – the month's view (rows, overall, unbudgeted spending, totals).
- `PUT /api/budgets` `{month, categoryId|null, limit}` – create or change a limit.
- `POST /api/budgets/copy` `{fromMonth, toMonth}` – copies budgets, skipping ones that already exist; 400 if the source month has none.
- `DELETE /api/budgets/:id`
- `GET /api/budgets/suggestions` – average of the last up to 3 complete months per category (at least 2 needed), rounded up to the next ₹100. This describes what the user spent, not what they should spend; the UI previews it and applies only the rows the user ticks.

## What-if simulator
`POST /api/simulator` returns a **simulation**, labelled as such in the response and the UI. It is not a prediction and not advice, and **nothing is stored**.

Baseline: the forecast's expected monthly income and spending (see FORECASTING.md), or, if there are fewer than 3 complete months, a manual monthly income and spending entered by the user (response `source: "manual"`). Without either the API returns `status: "needs_baseline"`.

Changes: income change (percent or ₹ per month), overall spending change (%), per-category cuts (% of that category's expected monthly spending; recorded-history baseline only), a one-off expense in a chosen month, starting savings, an assumed yearly return (0–30%, the user's own assumption, applied only to a positive balance and compounded monthly), horizon 1–60 months, and an optional savings goal. The result gives baseline vs scenario monthly savings, the balance month by month, and in which month each reaches the goal (`null` = not within the horizon). Logic: `backend/src/simulator/calc.js`.

## Known limitations
- The baseline is an average; seasonality and one-off past events are not modelled.
- Month boundaries and "today" use UTC.
- Budgets are per month; there is no recurring/rollover budget (use "Copy last month's budgets").
