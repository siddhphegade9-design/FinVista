# Investments (SIP) and insurance (Milestone 8.5)

These are **records the user enters**. FinVista does not connect to a bank, fund house or insurer, never asks for their credentials, and does not verify anything. Where it works out a figure from a record, the figure is an estimate and is labelled as one. None of this is investment, insurance or tax advice.

## SIPs: `/api/sips`

| Endpoint | Purpose |
| --- | --- |
| `GET /api/sips` | `{ sips[], summary, growth[], horizonYears, note }` |
| `POST /api/sips` | Create (max 100 per user) |
| `PUT /api/sips/:id` | Replace the editable fields (set `isActive: false` to pause) |
| `DELETE /api/sips/:id` | 204 |
| `POST /api/sips/calculate` `{ monthlyAmount, years, stepUpPercent?, expectedReturnPercent }` | What-if calculator. Stores nothing |

Fields: `name`, `instrumentType` (mutual_fund, elss, ppf, nps, stock, other), `monthlyAmount`, `startDate` (up to a year ahead), `durationMonths` (1 to 600, or blank for ongoing), `stepUpPercent` (0 to 50, yearly), `expectedReturnPercent` (0 to 30, required: it is the user's own assumption), optional `currentValue` with `currentValueAsOf` (both or neither), `isActive`, `notes`.

### The model

- Instalment *k* is paid on the start date plus *k* months, clamped to month end (31 Jan then 28 Feb).
- Each year the instalment rises by the step-up: `amount x (1 + step)^floor(k / 12)`, rounded to paise.
- The assumed yearly return *r* compounds monthly at `i = (1 + r)^(1/12) - 1`; an instalment grows by `(1 + i)` for each whole month since it was paid.
- **Scheduled** amounts assume every instalment due so far was paid. They are not bank records.
- **Modelled value now** and the **end projection** apply the assumed return. For an ongoing SIP the projection is 10 years ahead. The summary growth series covers the next 10 years of all active SIPs, assuming each continues until its planned end.
- Worked check: 1,000 a month for 12 months at 12% a year gives about 12,766.60 (invested 12,000).
- `currentValue` is the user's own figure and is shown separately from every estimate. `monthlyCommitment` is the next instalment of each active, unfinished SIP.

## Insurance: `/api/insurance`

Same CRUD shape (`GET`, `POST`, `PUT /:id`, `DELETE /:id`). Fields: `name`, `insurer?`, `policyType` (health, term_life, life, motor, home, travel, other), `sumAssured`, `premium` per payment, `premiumFrequency` (monthly, quarterly, half_yearly, yearly), `nextDueDate` (within 2 years either side of today), `isActive`, `notes`.

Computed: annual premium (premium x payments per year), monthly equivalent, `daysUntilDue`, `renewalStatus` (`overdue`, `due_soon` within 30 days, `upcoming`, `inactive`). The summary totals only active policies and reports total cover by type. FinVista does **not** say how much cover a person needs.

## Where these records are used

- **Forecast:** `GET /api/forecast` includes `commitments` (monthly SIP total and monthly-equivalent premiums). They are shown beside the projection and are not added to it, to avoid double counting debits the user also records as transactions.
- **Planned:** the tax module (Milestone 11) can use ELSS and health-premium records for 80C and 80D, and the health score (Milestone 12) can use them for savings and protection indicators. Neither exists yet.

## Known limitations

- Instalments are assumed paid on schedule; there is no per-instalment log. Missed instalments are handled by editing the SIP.
- Return is one flat yearly assumption: no market volatility, taxes, expense ratios or exit loads.
- Instalment dates use UTC "today". The next due date of a policy is not rolled forward automatically after payment: the user updates it.
- No reminders are sent; renewals are shown on the page and in the forecast notes only.
