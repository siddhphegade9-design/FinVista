# Transactions

Everything on this page requires login and is scoped to the signed-in user. Amounts are in the account's currency (see [CURRENCY.md](CURRENCY.md)) with up to two decimals.

## API

| Method and path | Purpose |
|---|---|
| `GET /api/categories` | `{ categories: [{ id, name, kind, transactionCount, protected }] }` for the user (kind is `income` or `expense`). Category management is in [CATEGORIZATION.md](CATEGORIZATION.md) |
| `GET /api/transactions` | Page of transactions plus totals. Query: `from`, `to` (YYYY-MM-DD), `type`, `categoryId`, `q` (description search), `minAmount`, `maxAmount`, `sort` (`date_desc` default, `date_asc`, `amount_desc`, `amount_asc`), `page`, `pageSize` (1-100, default 20). Returns `{ transactions, pagination: { page, pageSize, total, totalPages }, summary: { income, expenses, net, count } }`; the summary covers every match, not only the page |
| `GET /api/transactions/all` | Every transaction (compact) for the dashboard; `truncated: true` if over 20,000 |
| `GET /api/transactions/export` | CSV download. Takes the same filters (not paging) |
| `POST /api/transactions/import` | `{ rows: [{ date, description, amount, type?, category? }], skipDuplicates? }` (max 500 rows per request; the page sends larger files in batches). Returns `{ imported, skipped: [{ row, message }], categorizedByRules, defaultedToOther }` |
| `POST /api/transactions` | Create `{ type, amount, description, date, categoryId? }`. `categoryId` is optional: when omitted the rules in [CATEGORIZATION.md](CATEGORIZATION.md) choose, falling back to Other / Other income -> 201 `{ transaction }` |
| `GET /api/transactions/:id` | One transaction |
| `PUT /api/transactions/:id` | Replace the editable fields (same body as create) |
| `DELETE /api/transactions/:id` | Delete -> 204 |

A transaction looks like `{ id, date, description, type, amount, categoryId, category, categorySource }`. `categorySource` is `user` (the person chose it), `rule` (a keyword rule chose it), or `default` (nothing matched, so it was placed in Other). `ai` is reserved and not produced yet.

Errors use `{ error: { code, message, details? } }`; `details` maps field names to messages on a 400.

## Rules

- Amount: greater than 0, at most 2 decimals, up to 9,999,999,999.99. Commas and the currency symbols ₹ $ € £ ¥ are accepted.
- Date: a real calendar date from 1990, not in the future (one day of slack for timezones).
- Description: 1 to 200 characters; control characters are removed.
- Category: must belong to you and match the type (an income cannot use an expense category).

## CSV import format

The first row is a header (case-insensitive). Required: `Date`, `Description`, `Amount`. Optional: `Type`, `Category`. Common bank headings such as `Narration`, `Particulars`, `Txn Date` and `CR/DR` are recognised. Comma, semicolon or tab separated.

- **Dates:** `2026-11-14`, or day-first `14/11/2026`, `14-11-2026`, `14.11.2026`. Month-first dates are not accepted.
- **Type:** `income`/`expense` (also `credit`/`debit`, `cr`/`dr`). With no type, a negative amount (`-500` or `(500)`) is an expense and a positive amount is income. The import dialog warns when there is no Type column.
- **Category:** matched by name (case-insensitive) within the type. Blank or unknown categories go to `Other` / `Other income` and the result tells you how many.
- **Duplicates:** rows identical to an existing transaction (date, type, amount, description) are skipped unless you untick the option.
- **Limits:** 5,000 rows and 2 MB per file.

Files exported by FinVista can be imported again (the formula guard added on export is removed on import).

## Not supported

Bulk edit, recurring transactions and attachments. Custom categories and automatic categorisation are covered in [CATEGORIZATION.md](CATEGORIZATION.md).
