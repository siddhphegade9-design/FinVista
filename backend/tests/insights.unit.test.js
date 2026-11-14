'use strict';
/** Pure tests for the forecast and unusual-spending logic (no database). */
const test = require('node:test');
const assert = require('node:assert/strict');
const stats = require('../src/insights/stats');
const { buildForecast, historyWindow, addMonths } = require('../src/insights/forecast');
const { detectAnomalies, CONFIG } = require('../src/insights/anomalies');

const NOW = new Date('2026-11-14T10:00:00Z');
const close = (a, b, eps = 0.011) => assert.ok(Math.abs(a - b) <= eps, `${a} is not within ${eps} of ${b}`);

test('stats: median, MAD, std dev, recency weighting', () => {
  assert.equal(stats.median([3, 1, 2]), 2);
  assert.equal(stats.median([1, 2, 3, 4]), 2.5);
  assert.equal(stats.median([]), 0);
  assert.equal(stats.mad([1, 1, 2, 2, 4, 6, 9]), 1);
  close(stats.stdDev([10, 12, 11, 13, 12, 14]), Math.sqrt(10 / 6), 1e-9);
  assert.equal(stats.stdDev([5]), 0);
  assert.equal(stats.recencyWeightedMean([10, 20, 30]), (10 + 40 + 90) / 6);
});

test('forecast: month helpers and history window', () => {
  assert.equal(addMonths('2026-11', 3), '2027-02');
  assert.equal(addMonths('2026-01', -2), '2025-11');
  assert.deepEqual(historyWindow('2026-05', '2026-11'), ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
  assert.equal(historyWindow('2024-01', '2026-11').length, 6, 'at most 6 months');
  assert.deepEqual(historyWindow('2026-11', '2026-11'), [], 'the current month is never history');
  assert.deepEqual(historyWindow(null, '2026-11'), []);
});

const rows = (type, month0, values) => values.map((v, i) => ({ month: addMonths(month0, i), type, amount: String(v) }));

test('forecast: recency-weighted expectation with a one-sigma range, labelled as a projection', () => {
  const monthly = [...rows('expense', '2026-05', [10000, 12000, 11000, 13000, 12000, 14000]), ...rows('income', '2026-05', Array(6).fill(50000))];
  const f = buildForecast(monthly, [], NOW);
  assert.equal(f.status, 'ok');
  assert.equal(f.completeMonths, 6);
  assert.deepEqual(f.projections.map((p) => p.month), ['2026-12', '2027-01', '2027-02']);
  close(f.projections[0].expenses.expected, 263000 / 21);
  const sd = Math.sqrt(10_000_000 / 6);
  close(f.projections[0].expenses.low, 263000 / 21 - sd, 0.02);
  close(f.projections[0].expenses.high, 263000 / 21 + sd, 0.02);
  assert.equal(f.projections[0].income.expected, 50000);
  assert.equal(f.projections[0].income.low, 50000, 'no variation, so no range');
  close(f.projections[0].net.expected, 50000 - 263000 / 21);
  assert.ok(f.projections[0].net.low < f.projections[0].net.expected && f.projections[0].net.expected < f.projections[0].net.high);
  assert.match(f.method.description, /No trend is assumed/);
});

test('forecast: not enough history says so instead of guessing', () => {
  const f = buildForecast(rows('expense', '2026-09', [5000, 6000]), [], NOW);
  assert.equal(f.status, 'insufficient_data');
  assert.equal(f.completeMonths, 2);
  assert.deepEqual(f.projections, []);
  const none = buildForecast([], [], NOW);
  assert.equal(none.status, 'insufficient_data');
  assert.equal(none.completeMonths, 0);
  const onlyCurrent = buildForecast([{ month: '2026-11', type: 'expense', amount: '900' }], [], NOW);
  assert.equal(onlyCurrent.status, 'insufficient_data');
  assert.equal(onlyCurrent.currentMonth.expenses, 900, 'current month actuals are still reported');
});

test('forecast: months with no activity after the first transaction count as zero, not as missing', () => {
  const f = buildForecast([{ month: '2026-06', type: 'expense', amount: '3000' }, { month: '2026-10', type: 'expense', amount: '3000' }], [], NOW);
  assert.equal(f.status, 'ok');
  assert.equal(f.completeMonths, 5);
  assert.deepEqual(f.history.map((h) => h.expenses), [3000, 0, 0, 0, 3000]);
});

test('forecast: the current month is never projected below what is already recorded', () => {
  const monthly = [...rows('expense', '2026-07', [5000, 5000, 5000, 5000]), { month: '2026-11', type: 'expense', amount: '8000' }, { month: '2026-11', type: 'income', amount: '100' }];
  const f = buildForecast(monthly, [], NOW);
  assert.equal(f.currentMonth.expenses, 8000);
  assert.equal(f.currentMonth.expectedExpenses, 8000);
  const calm = buildForecast([...rows('expense', '2026-07', [5000, 5000, 5000, 5000]), { month: '2026-11', type: 'expense', amount: '1000' }], [], NOW);
  assert.equal(calm.currentMonth.expectedExpenses, 5000);
});

test('forecast: category projections use the same method and sort by size', () => {
  const monthly = rows('expense', '2026-07', [6000, 6000, 6000, 6000]);
  const cats = [
    ...rows('expense', '2026-07', [1000, 1000, 1000, 1000]).map((r) => ({ ...r, category: 'Food' })),
    ...rows('expense', '2026-07', [5000, 5000, 5000, 5000]).map((r) => ({ ...r, category: 'Housing' })),
    { month: '2026-05', category: 'Old', amount: '9' }, // outside the window
  ];
  const f = buildForecast(monthly, cats, NOW);
  assert.deepEqual(f.categories.map((c) => [c.category, c.expected]), [['Housing', 5000], ['Food', 1000]]);
  assert.equal(f.categories[0].monthsWithSpending, 4);
});

/* ------------------------------------------------------------------ anomalies */

let n = 0;
const tx = (date, amount, category, description = `item ${++n}`) => ({ id: `id-${++n}`, date, amount: String(amount), category, description });
const kinds = (list) => list.map((a) => a.kind);

test('anomalies: one amount far above the category norm is flagged with a reason; normal ones are not', () => {
  const base = [310, 320, 330, 340, 350, 360, 370, 380, 390, 400].map((a, i) => tx(`2026-10-${String(i + 1).padStart(2, '0')}`, a, 'Food & Dining'));
  const list = [...base, tx('2026-11-10', 5000, 'Food & Dining', 'Wedding dinner'), tx('2026-11-11', 600, 'Food & Dining', 'Nice lunch')];
  const out = detectAnomalies(list, NOW);
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'unusual_amount');
  assert.equal(out[0].description, 'Wedding dinner');
  assert.equal(out[0].severity, 'high');
  assert.match(out[0].reason, /₹5,000 is about 13\.\d× your usual Food & Dining transaction/);
  assert.doesNotMatch(JSON.stringify(out), /fraud/i, 'never labelled as fraud');
});

test('anomalies: thin history, small amounts and old transactions are not reported', () => {
  const few = [...Array(6)].map((_, i) => tx(`2026-10-0${i + 1}`, 300, 'Travel'));
  assert.deepEqual(detectAnomalies([...few, tx('2026-11-10', 9000, 'Travel')], NOW), [], 'only 7 transactions in the category');
  const many = [...Array(10)].map((_, i) => tx(`2026-10-${10 + i}`, 20 + i, 'Other'));
  assert.deepEqual(detectAnomalies([...many, tx('2026-11-10', 300, 'Other')], NOW), [], 'below the INR 500 floor');
  const old = [...Array(10)].map((_, i) => tx(`2026-03-0${(i % 9) + 1}`, 300 + i, 'Shopping'));
  assert.deepEqual(detectAnomalies([...old, tx('2026-03-20', 9000, 'Shopping', 'Old splurge')], NOW), [], 'older than 90 days');
});

test('anomalies: identical amounts (zero MAD) need a much bigger jump', () => {
  const same = [...Array(9)].map((_, i) => tx(`2026-10-${10 + i}`, 400, 'Transport'));
  assert.deepEqual(detectAnomalies([...same, tx('2026-11-10', 1100, 'Transport')], NOW), [], '2.75x is not enough');
  const out = detectAnomalies([...same, tx('2026-11-10', 2500, 'Transport', 'Outstation cab')], NOW);
  assert.deepEqual(kinds(out), ['unusual_amount']);
});

test('anomalies: category spike compares the last complete month with the months before it', () => {
  const list = [tx('2026-06-05', 2000, 'Shopping'), tx('2026-07-05', 2000, 'Shopping'), tx('2026-08-05', 2000, 'Shopping'), tx('2026-09-05', 2000, 'Shopping'), tx('2026-10-05', 9000, 'Shopping', 'Festival shopping')];
  const out = detectAnomalies(list, NOW);
  assert.deepEqual(kinds(out), ['category_spike']);
  assert.equal(out[0].month, '2026-10');
  assert.match(out[0].reason, /Shopping spending in 2026-10 was ₹9,000, compared with a usual ₹2,000 a month over the 4 months before/);
  const current = detectAnomalies([...list.slice(0, 4), tx('2026-11-05', 9000, 'Shopping')], NOW);
  assert.deepEqual(current, [], 'the unfinished current month is never called a spike');
  const small = detectAnomalies([...list.slice(0, 4), tx('2026-10-05', 2800, 'Shopping')], NOW);
  assert.deepEqual(small, [], 'a rise under INR 1,000 is not worth flagging');
  assert.deepEqual(detectAnomalies([tx('2026-09-05', 2000, 'Shopping'), tx('2026-10-05', 9000, 'Shopping')], NOW), [], 'needs 3 earlier months');
});

test('anomalies: possible duplicates within two days, not further apart, not tiny amounts', () => {
  const out = detectAnomalies([tx('2026-11-10', 1499, 'Shopping', 'Amazon order'), tx('2026-11-11', 1499, 'Shopping', 'AMAZON  order!'), tx('2026-11-01', 800, 'Bills & Utilities', 'Recharge'), tx('2026-11-09', 800, 'Bills & Utilities', 'Recharge'), tx('2026-11-10', 50, 'Food & Dining', 'Tea'), tx('2026-11-10', 50, 'Food & Dining', 'Tea')], NOW);
  assert.deepEqual(out.map((a) => [a.kind, a.description, a.severity]), [['possible_duplicate', 'AMAZON  order!', 'low']]);
  assert.match(out[0].reason, /may be a repeated entry, or a genuine repeat purchase/);
});

test('anomalies: results are ordered by severity then recency; config is sane', () => {
  assert.ok(CONFIG.modifiedZ >= 3 && CONFIG.minAmountPaise >= 10_000 && CONFIG.lookbackDays === 90);
  const base = [...Array(10)].map((_, i) => tx(`2026-10-${10 + i}`, 300 + i, 'Food & Dining'));
  const out = detectAnomalies([tx('2026-11-11', 1000, 'Shopping', 'Dup'), tx('2026-11-12', 1000, 'Shopping', 'Dup'), ...base, tx('2026-11-01', 4000, 'Food & Dining', 'Party')], NOW);
  assert.equal(out[0].severity, 'high');
  assert.equal(out.at(-1).severity, 'low');
});
