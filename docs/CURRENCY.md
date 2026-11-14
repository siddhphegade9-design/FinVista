# Currencies

FinVista supports seven currencies: **INR** (default), **USD**, **EUR**, **GBP**, **CAD**, **AUD** and **JPY**. The choice is per user (`users.currency`) and is set at registration or on the Account page.

## What it changes
- How amounts are formatted and typed (symbol, digit grouping, JPY with no decimals). The browser table is `frontend/js/core/format.js`; the server table is `backend/src/config/currencies.js`. A test checks they list the same codes, locales and digits.
- Currency in AI advisor prompts and in reports, so the AI is told the right currency.
- Size of anomaly thresholds and rounding of budget suggestions (see below).

## What it does NOT do
- **It never converts money.** Switching from INR to USD does not turn 50,000 into 600; it shows 50,000 as dollars. The Account page says this in a confirmation dialog. Check your records after switching.
- No exchange rates, no multi-currency accounts: a user has one currency at a time.

## Indian tax is India-only
The tax tool follows Indian income-tax rules. Only INR accounts can use it:
- Every `/api/tax/*` route returns **403 `TAX_INDIA_ONLY`** for other currencies (checked on the server, not just hidden in the UI).
- The Tax item disappears from the menu, and `/tax.html` shows "Tax estimation is only available in India" with a link to Account.
- Saved tax figures are kept, not deleted. Switching back to INR reopens the tool.

## Approximate scaling (not exchange rates)
Anomaly detection ignores small amounts, and budget suggestions round to a tidy figure. Those sizes were set for rupees, so each currency has a rough size factor (`thresholdScale`) and rounding step (`budgetRound`). The factors are rounded rules of thumb, not live or exact exchange rates.

## Known limits
- SIP types ELSS, PPF and NPS, and some wording, are India-oriented regardless of currency.
- Dates stay in the Indian day-month-year format; landing-page copy is unchanged.
- Only the seven listed currencies. Adding one means editing both tables and the migration's CHECK list.

Database: migration `006_user_currency.sql`. Endpoint: `PATCH /api/auth/currency` with `{ "currency": "USD" }`.
