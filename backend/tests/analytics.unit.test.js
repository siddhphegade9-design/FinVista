'use strict';
/** Pure tests for the analytics calculations (no database). */
const test = require('node:test');
const assert = require('node:assert/strict');
const c = require('../src/analytics/calc');

test('monthKeysBetween covers every touched calendar month, including year boundaries', () => {
  assert.deepEqual(c.monthKeysBetween('2026-01-31', '2026-03-01'), ['2026-01', '2026-02', '2026-03']);
  assert.deepEqual(c.monthKeysBetween('2025-11-15', '2026-02-02'), ['2025-11', '2025-12', '2026-01', '2026-02']);
  assert.deepEqual(c.monthKeysBetween('2026-05-10', '2026-05-20'), ['2026-05']);
});

test('previousPeriod is the equally long period right before', () => {
  assert.deepEqual(c.previousPeriod('2026-01-01', '2026-03-31'), { from: '2025-10-03', to: '2025-12-31' });
  assert.deepEqual(c.previousPeriod('2026-03-01', '2026-03-01'), { from: '2026-02-28', to: '2026-02-28' });
  assert.deepEqual(c.previousPeriod('2024-03-01', '2024-03-31'), { from: '2024-01-30', to: '2024-02-29' }, 'leap year');
  assert.equal(c.daysBetween('2026-01-01', '2026-03-31'), 90);
});

test('defaultRange is the last 6 calendar months up to today', () => {
  assert.deepEqual(c.defaultRange(new Date('2026-11-14T10:00:00Z')), { from: '2026-06-01', to: '2026-11-14' });
  assert.deepEqual(c.defaultRange(new Date('2026-02-03T10:00:00Z')), { from: '2025-09-01', to: '2026-02-03' });
});

test('parseRange validates dates, order and size', () => {
  const now = new Date('2026-11-14T10:00:00Z');
  assert.deepEqual(c.parseRange({}, now).value, { from: '2026-06-01', to: '2026-11-14' });
  assert.deepEqual(c.parseRange({ from: '2026-01-01', to: '2026-01-31' }, now).value, { from: '2026-01-01', to: '2026-01-31' });
  for (const bad of [{ from: '2026-1-1' }, { to: '2026-02-30' }, { from: '2026-05-01', to: '2026-04-01' }, { from: '2010-01-01', to: '2026-01-01' }, { from: '1980-01-01', to: '1980-02-01' }, { from: ['2026-01-01'] }]) {
    assert.ok(c.parseRange(bad, now).errors, `should reject ${JSON.stringify(bad)}`);
  }
});

test('changeRatio: null when there is no previous value to compare with', () => {
  assert.equal(c.changeRatio(150, 100), 0.5);
  assert.equal(c.changeRatio(50, 100), -0.5);
  assert.equal(c.changeRatio(50, 0), null);
  assert.equal(c.changeRatio(0, 0), null);
});

test('buildMonthly zero-fills missing months and sums in exact paise', () => {
  const rows = [
    { month: '2026-01', type: 'income', amount: '0.10', count: 1 }, { month: '2026-01', type: 'income', amount: '0.20', count: 1 },
    { month: '2026-03', type: 'expense', amount: '10.05', count: 2 },
  ];
  const out = c.buildMonthly(rows, ['2026-01', '2026-02', '2026-03']);
  assert.deepEqual(out[0], { month: '2026-01', income: 0.3, expenses: 0, net: 0.3, count: 2 });
  assert.deepEqual(out[1], { month: '2026-02', income: 0, expenses: 0, net: 0, count: 0 });
  assert.deepEqual(out[2], { month: '2026-03', income: 0, expenses: 10.05, net: -10.05, count: 2 });
});

test('summarize: savings rate is null with no income, negative when overspending', () => {
  assert.equal(c.summarize([{ type: 'expense', amount: '10.00', count: 1 }]).savingsRate, null);
  const s = c.summarize([{ type: 'income', amount: '100.00', count: 1 }, { type: 'expense', amount: '150.00', count: 2 }]);
  assert.equal(s.net, -50);
  assert.equal(s.savingsRate, -0.5);
  assert.equal(s.count, 3);
});

test('buildCategories: sorted, shares add up to 1, zero amounts dropped', () => {
  const out = c.buildCategories([{ id: 'a', name: 'Food', amount: '25.00', count: 1 }, { id: 'b', name: 'Rent', amount: '75.00', count: 1 }, { id: 'z', name: 'Zero', amount: '0.00', count: 1 }]);
  assert.deepEqual(out.map((x) => x.name), ['Rent', 'Food']);
  assert.equal(out[0].share, 0.75);
  assert.equal(out.reduce((s, x) => s + x.share, 0), 1);
  assert.deepEqual(c.buildCategories([]), []);
});

test('buildCategoryTrend: top N plus an "All other" remainder so the stack equals total spending', () => {
  const months = ['2026-01', '2026-02'];
  const rows = [
    { month: '2026-01', id: 'a', name: 'A', amount: '100.00' }, { month: '2026-01', id: 'b', name: 'B', amount: '40.00' }, { month: '2026-01', id: 'c', name: 'C', amount: '10.00' },
    { month: '2026-02', id: 'a', name: 'A', amount: '50.00' }, { month: '2026-02', id: 'c', name: 'C', amount: '5.50' },
  ];
  const top = [{ categoryId: 'a', name: 'A' }, { categoryId: 'b', name: 'B' }, { categoryId: 'c', name: 'C' }];
  const t = c.buildCategoryTrend(rows, months, top, 2);
  assert.deepEqual(t.series.map((s) => s.name), ['A', 'B', 'All other categories']);
  assert.deepEqual(t.series[0].values, [100, 50]);
  assert.deepEqual(t.series[1].values, [40, 0]);
  assert.deepEqual(t.series[2].values, [10, 5.5]);
  const stackTotals = months.map((_, i) => t.series.reduce((s, x) => s + x.values[i], 0));
  assert.deepEqual(stackTotals, [150, 55.5]);
  const noOther = c.buildCategoryTrend(rows, months, top, 3);
  assert.ok(!noOther.series.some((s) => s.categoryId === null), 'no remainder series when everything is shown');
});

test('buildWeekdays: Monday first, Sunday (DOW 0) last', () => {
  const out = c.buildWeekdays([{ dow: 0, amount: '5.00', count: 1 }, { dow: 1, amount: '7.25', count: 2 }, { dow: 6, amount: '1.00', count: 1 }]);
  assert.deepEqual(out.map((d) => d.name), ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  assert.equal(out[0].expenses, 7.25);
  assert.equal(out[5].expenses, 1);
  assert.equal(out[6].expenses, 5);
});
