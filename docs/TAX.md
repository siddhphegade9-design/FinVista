# Indian tax intelligence (Milestone 11)

A resident-individual income-tax **estimator** that compares the new and old regimes. All maths is deterministic JavaScript
(`backend/src/tax/engine.js`) driven by data in `backend/src/tax/rules.js`. **The AI advisor never calculates tax.**

## What it does
- Takes yearly figures the user types in (salary, HRA, rent, interest, deductions). Nothing is read from a bank.
- Computes tax in both regimes with a line-by-line breakdown: slab bands, standard deduction, HRA exemption, Chapter VI-A deductions
  (with caps explained), 87A rebate and marginal relief, surcharge with marginal relief, 4% cess, rounding to the nearest ₹10.
- Names the cheaper regime and the saving.
- "Fill from my records": suggests 80C (ELSS and PPF SIPs scheduled in the tax year), 80CCD(1B) (NPS SIPs) and 80D (active health policies)
  from the user's own SIP and insurance records. These are scheduled amounts, not proof of payment, and the user can edit them.
- Saves only the inputs, one row per user per tax year (`tax_profiles`). Tax is recalculated each time, never stored.

## Rules (tax years 2026-27 and 2025-26)
| | New regime | Old regime |
|---|---|---|
| Slabs | 0-4L 0%, 4-8L 5%, 8-12L 10%, 12-16L 15%, 16-20L 20%, 20-24L 25%, above 24L 30% | Under 60: 0-2.5L 0%, 2.5-5L 5%, 5-10L 20%, above 30%. Senior (60-79) and super senior (80+) have higher exemption limits |
| Standard deduction | ₹75,000 | ₹50,000 |
| Rebate (87A) | Taxable up to ₹12L: tax nil; marginal relief just above | Taxable up to ₹5L: up to ₹12,500 |
| Surcharge | 10/15/25% above 50L/1Cr/2Cr, with marginal relief | adds 37% above 5Cr |
| Deductions | Employer NPS only (14% of basic) | 80C ₹1.5L, 80CCD(1B) ₹50k, 80D, 80E, home loan interest ₹2L, 80TTA/TTB, HRA, employer NPS (10%) |

The 2026-27 rule set notes the Income-tax Act, 2025 (in force from 1 April 2026): rates and limits used are unchanged, section numbers differ.
Rules carry a `verifiedOn` date shown on the page.

## Not covered (also shown in the app)
Capital gains and other special-rate income, business income, let-out property, foreign income, perquisites, professional tax, AMT,
TDS or advance tax already paid, and deductions not listed. It estimates tax on income; it is not a return and not tax advice.

## Honest limitations
- Rules were taken from **secondary sources** (published summaries of the Finance Acts and Budget 2026-27), not the statute text.
  Confirm with the Income Tax Department (incometax.gov.in) or a chartered accountant before filing.
- HRA assumes the metro list in `rules.js` (Mumbai, Delhi, Kolkata, Chennai; the 2026-27 set adds Bengaluru, Hyderabad, Pune, Ahmedabad).
- Age affects only slabs, 80D limits and 80TTB. Senior-citizen-specific rules beyond that are not modelled.
- Changing law means editing `rules.js`, adding a new year entry, and updating `verifiedOn`.

## API (all require login; `year` defaults to 2026-27)
- `GET /api/tax/rules` rule summaries, cities, verified dates
- `GET|PUT /api/tax/profile?year=` read or save the inputs
- `GET /api/tax/suggestions?year=` figures derived from the user's SIP and insurance records
- `POST /api/tax/calculate { year, ...inputs }` compares both regimes; saves nothing

## Tests
`tax.unit.test.js` (10): hand-verified slab, rebate, marginal relief, HRA, surcharge relief, regime-only deductions, rounding.
`tax.api.test.js` (7 incl. login, validation, per-user isolation, suggestions). Browser e2e: 20 checks.
