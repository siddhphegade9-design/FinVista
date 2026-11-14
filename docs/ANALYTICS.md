# Analytics

`GET /api/analytics?from=YYYY-MM-DD&to=YYYY-MM-DD` (login required, scoped to the signed-in user). With no parameters it covers the last 6 calendar months up to today. Ranges are limited to 10 years and cannot start before 1990.

## Response

| Field | Meaning |
|---|---|
| `range`, `previousRange` | The requested period and the equally long period right before it |
| `months`, `includesCurrentMonth` | Calendar months touched by the range; whether the unfinished current month is one of them |
| `totals` | `income`, `expenses`, `net`, `count`, `savingsRate` (null when there is no income), `avgMonthlyIncome`, `avgMonthlyExpenses` (total divided by `months`) |
| `comparison` | Previous-period `previousIncome/Expenses/Net/Count`, and `incomeChange`, `expensesChange` as ratios (0.25 = up 25%), or `null` when the previous period has nothing to compare against |
| `monthly` | One entry per month, zero-filled: `{ month, income, expenses, net, count }` |
| `cumulativeNet` | Running total of net savings by month |
| `expenseCategories`, `incomeCategories` | `{ categoryId, name, amount, share, count }`, largest first; shares add up to 1 |
| `categoryTrend` | Monthly expenses for the 5 largest categories plus an "All other categories" remainder, so the stack equals total spending |
| `weekdays` | Expenses per weekday, Monday first |
| `topExpenses` | The 5 largest expenses |

## The page

`/analytics.html` offers presets (last 3, 6 or 12 months, this year so far, last year) and a custom range. It shows four headline figures with a comparison against the previous period, a monthly income/expense/net chart, a category doughnut, cumulative net savings, a stacked category-by-month chart, a weekday chart, ranked category and income lists, and the largest expenses.

## Reading the numbers

- Everything is a total of transactions you recorded. Nothing is estimated or forecast.
- "Average monthly spend" divides by the number of calendar months in the range. When the range includes the current month, the page says the figure is understated because the month is unfinished.
- Expenses going **up** is shown in red and going **down** in green; for income it is the other way round.
- Weekday figures use the transaction date as entered, with no timezone conversion.
