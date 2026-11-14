# Forecast and unusual spending (Milestone 8)

Both features are deterministic and explainable. There is no AI involved, and nothing here is a guarantee or financial advice.

## Forecast: `GET /api/forecast`

- **History used:** the last up to 6 *complete* calendar months, starting at the user's first transaction. The current month is never history. Months after the first transaction with no activity count as 0.
- **Minimum:** 3 complete months. With fewer, the response is `{ status: "insufficient_data", completeMonths, neededMonths }` and the page says so instead of showing numbers.
- **Expected value:** recency-weighted average (oldest month weight 1, newest weight n) of monthly income and of monthly expenses. No trend is extrapolated.
- **Range:** expected value plus or minus one population standard deviation of the history (never below 0). Net range = income low minus expense high, to income high minus expense low.
- **Horizon:** the next 3 months. Per-category expected spending uses the same method.
- **Current month:** reported as actual-so-far plus an expected full-month figure that is never below what is already recorded.
- **Response:** `{ status, completeMonths, neededMonths, method, history[], currentMonth, projections[{ month, income|expenses|net: {expected, low, high} }], categories[] }`.

Worked example: expenses of 10,000, 12,000, 14,000, 16,000 give (1x10 + 2x12 + 3x14 + 4x16) / 10 = 14,000 expected; the standard deviation of the four months is about 2,236, so the range is about 11,764 to 16,236.

## Unusual spending: `GET /api/anomalies`

Looks at expenses of the last 12 months and reports items from the last 90 days. Thresholds live in `CONFIG` in `insights/anomalies.js`.

| Kind | Rule | Guards |
| --- | --- | --- |
| `unusual_amount` | Modified z-score (median and MAD) above 3.5 and at least 2x the category median | At least 8 transactions in the category; at least INR 500; if MAD is 0 (identical amounts) the jump must be 5x the median |
| `category_spike` | Last complete month's category total is more than 2 standard deviations and 1.5x above its earlier months, and INR 1,000 or more higher | At least 3 earlier months; the unfinished current month is never judged |
| `possible_duplicate` | Same amount and normalised description within 2 days | At least INR 100 |

Each item carries `severity` (high, medium, low), a `reason` sentence, and a `transactionId` where one transaction is involved. The response notice states these are not accusations of fraud or error. Results are stateless: there is no "dismiss" yet.

## Known limitations

- "Today" and month boundaries use UTC, as in analytics.
- Income projections assume similar months; irregular income (freelance) gives a wide range.
- Seasonal patterns (festivals, annual premiums) are not modelled and may appear as unusual.
- The projection uses history only. Planned SIP and insurance outflows from the Milestone 8.5 records are shown beside it as `commitments` and are deliberately not added in, because if the user also records those debits as transactions they are already in the history (adding them would double count).
