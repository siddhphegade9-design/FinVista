# Financial health score and reports

## Health score (`backend/src/health/score.js`)
A transparent 0-100 **guide** computed from the user's own recorded data. Pure JavaScript: no AI, no database access inside the formula.
It is not a credit score and predicts nothing.

| Factor | Points | How it is measured | Full marks |
|---|---|---|---|
| Savings rate | 35 | (income − spending) ÷ income over the last up-to-3 complete months that have recorded income | 20% or more |
| Regular investing | 20 | Active SIP instalments per month ÷ average monthly income | 10% or more |
| Budget discipline | 20 | Category budgets of the latest complete month: on track = 1, close to limit = ½, over = 0 | all on track |
| Health insurance | 15 | An active health policy is recorded | yes |
| Spending stability | 10 | Variation of monthly spending over 3 complete months | 15% or less (0 points at 50%) |

- The current, unfinished month is never used.
- A factor with too little data (no budgets, under 3 months of history, no income) is **left out** and the score is rescaled over the factors
  that could be measured. The page says "Based on N of 5 factors". Fewer than 2 measurable factors, or no income at all, gives
  "not enough data" and no number.
- Every factor shows its points, a plain-language reason and, where useful, a tip.
- Health insurance and SIP points depend on what the user has recorded; an unrecorded policy scores 0, and the text says so.

Bands: 80+ Strong, 60-79 Good, 40-59 Fair, below 40 Needs attention. Targets are common rules of thumb, set in `TARGETS`/`WEIGHTS` and easy to change.

## Monthly report
`GET /api/reports/monthly?month=YYYY-MM`: totals, comparison with the previous calendar month (only for finished months), top spending categories,
budget status, largest expenses, unusual-spending flags for the month (not accusations), and today's SIP and insurance commitments.
An unfinished month is labelled "not finished" and shows no % change. The page has a **Print or save as PDF** button (a print stylesheet hides
navigation) and a link to the existing CSV export scoped to the month.

## API (login required)
- `GET /api/reports/health-score`
- `GET /api/reports/monthly?month=`

## Limitations
- Commitments are today's SIP and policy records, not a per-month history.
- The score uses only what is recorded in FinVista; it cannot see savings balances, debts or investments held elsewhere.
- No emergency-fund or debt factor because the app does not hold balances or loans.
- PDF output relies on the browser's print dialog; there is no server-side PDF.
- Scores are not stored or trended over time.

## Tests
`health.unit.test.js` (8), `reports.api.test.js` (7: login, insufficient data, rescaling, perfect 100, per-user isolation, month report, validation).
Browser e2e: 18 checks including print media and 375px width.
