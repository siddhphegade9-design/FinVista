# Expense categorization (Milestone 7)

Transactions are categorised by **fixed, deterministic keyword rules**. There is no AI and no network call involved: the same description always produces the same category, and the reason is shown ("matched keyword swiggy" or "matched your rule dunzo").

## How a category is chosen

1. **Your rules** (`category_rules`), then the **built-in keywords** (`backend/src/categorization/builtinRules.js`). The longest matching keyword wins; ties go to the alphabetically first. A user rule beats a built-in one.
2. Matching works on normalised text (lower case, `&` becomes "and", punctuation becomes spaces) and needs **whole words**: "rent" matches "Rent Jan" but not "parental" or "rental".
3. Rules only match transactions of the same kind: income rules do not apply to expenses and vice versa.
4. No match: the transaction goes to **Other** (expense) or **Other income**, with source `default`, and the list marks it "unmatched".
5. A built-in keyword whose target category you deleted is ignored.

## category_source

| Value | Meaning | May rules change it later? |
| --- | --- | --- |
| `user` | You chose the category (form, import file, or you edited it) | Never |
| `rule` | A rule chose it | Yes |
| `default` | Nothing matched | Yes |
| `ai` | Reserved, not produced yet | n/a |

Choosing the category the rules would have suggested keeps the source as `rule`. Editing only the amount or text of an automatic transaction keeps its source; changing the category makes it `user`.

## Learning from corrections

After you pick a category yourself (or change one), the app offers "Always categorise *pattern* as *Category*?". The suggested pattern is the first meaningful word of the description (3+ letters, not only digits, not a filler word such as "payment" or "upi"). You can also update earlier automatically categorised transactions in the same step. Saving a rule for a pattern that already has one re-points it.

## API (all require login; all data is per user)

| Endpoint | Purpose |
| --- | --- |
| `GET /api/categories` | Categories with `transactionCount` and `protected` |
| `POST /api/categories` `{ name, kind }` | Create (max 60 per user; duplicate names are 409, case-insensitive) |
| `PATCH /api/categories/:id` `{ name }` | Rename (Other / Other income cannot be renamed; neither name can be taken) |
| `DELETE /api/categories/:id` | Moves its transactions to Other / Other income as `default`, deletes its rules and budgets. Returns `{ reassigned, movedTo }` |
| `GET /api/categories/rules` | `{ rules, builtin }` (built-in keyword lists are read-only) |
| `POST /api/categories/rules` `{ pattern, categoryId, applyToExisting? }` | Create or re-point a rule (pattern 3-60 chars, not digits only). Returns `{ rule, updated }` |
| `DELETE /api/categories/rules/:id` | Delete a rule. Existing transactions keep their categories |
| `POST /api/categories/suggest` `{ description, type }` | `{ suggestion\|null, suggestedPattern }` |
| `POST /api/categories/reapply` `{ dryRun? }` | Dry run by default. `{ checked, matchedCount, applied, changes[<=100] }`. Only `default` and `rule` transactions are considered (latest 5,000) |

## Import

Each CSV row is categorised in this order: a category named in the file that exists (source `user`), then the rules (`rule`), then Other (`default`). The result reports `categorizedByRules` and `defaultedToOther`.

## Limits and known behaviour

- Keywords cover common Indian merchants and bill types, not everything. Unmatched items are expected; add a rule.
- Rows imported before this milestone that fell back to Other have source `user`, so "Apply rules" will not touch them.
- Re-applying considers the most recent 5,000 automatic transactions per run.
