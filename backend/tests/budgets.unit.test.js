'use strict';
/** Pure tests for budget maths, the simulator and their validators (no database). */
const test = require('node:test');
const assert = require('node:assert/strict');
const b = require('../src/budgets/calc');
const sim = require('../src/simulator/calc');
const v = require('../src/validation/budgets');

const close = (a, e, eps = 0.011) => assert.ok(Math.abs(a - e) <= eps, `${a} is not within ${eps} of ${e}`);

const budgets = [
  { id: 'b1', categoryId: 'food', name: 'Food & Dining', limit: '5000' },
  { id: 'b2', categoryId: 'shop', name: 'Shopping', limit: '3000' },
  { id: 'b3', categoryId: 'trans', name: 'Transport', limit: '1000' },
  { id: 'b4', categoryId: 'calm', name: 'Education', limit: '2000' },
];
const spent = [
  { categoryId: 'food', name: 'Food & Dining', amount: '3500' }, { categoryId: 'shop', name: 'Shopping', amount: '2500' },
  { categoryId: 'trans', name: 'Transport', amount: '1200' }, { categoryId: 'health', name: 'Health', amount: '700' },
];

test('month phase', () => {
  assert.equal(b.monthPhase('2026-10', '2026-11-15'), 'past');
  assert.equal(b.monthPhase('2026-11', '2026-11-15'), 'current');
  assert.equal(b.monthPhase('2026-12', '2026-11-15'), 'future');
});

test('budget view: used, remaining, status, pace, unbudgeted and totals', () => {
  const view = b.buildBudgetView({ month: '2026-11', budgets, spent, today: '2026-11-15' });
  assert.equal(view.phase, 'current');
  assert.equal(view.elapsedRatio, 0.5);
  const by = Object.fromEntries(view.rows.map((r) => [r.category, r]));
  assert.deepEqual([by['Transport'].status, by['Transport'].remaining], ['over', -200]);
  assert.deepEqual([by['Shopping'].status, by['Shopping'].remaining], ['watch', 500]);
  assert.equal(by['Food & Dining'].status, 'ok');
  assert.equal(by['Food & Dining'].usedRatio, 0.7);
  assert.match(by['Food & Dining'].pace, /70% of the budget is used with 50% of the month gone/);
  assert.equal(by['Education'].spent, 0);
  assert.equal(by['Education'].pace, null);
  assert.deepEqual(view.rows.map((r) => r.category), ['Transport', 'Shopping', 'Food & Dining', 'Education'], 'most used first');
  assert.deepEqual(view.unbudgeted, [{ categoryId: 'health', category: 'Health', spent: 700 }]);
  assert.deepEqual(view.totals, { budgetedCategories: 4, limit: 11000, spentInBudgeted: 7200, remaining: 3800, totalSpent: 7900, unbudgetedSpent: 700, overCount: 1, watchCount: 1 });
  assert.equal(view.overall, null);
});

test('budget view: overall budget compares with all spending; past and future months have no pace', () => {
  const withOverall = [...budgets, { id: 'o', categoryId: null, name: null, limit: '7000' }];
  const view = b.buildBudgetView({ month: '2026-10', budgets: withOverall, spent, today: '2026-11-15' });
  assert.equal(view.phase, 'past');
  assert.equal(view.elapsedRatio, 1);
  assert.equal(view.overall.category, 'All spending');
  assert.equal(view.overall.spent, 7900);
  assert.equal(view.overall.status, 'over');
  assert.ok(view.rows.every((r) => r.pace === null));
  assert.equal(view.totals.budgetedCategories, 4, 'the overall budget is not counted as a category');
  const future = b.buildBudgetView({ month: '2027-01', budgets, spent: [], today: '2026-11-15' });
  assert.equal(future.phase, 'future');
  assert.equal(future.elapsedRatio, 0);
  assert.ok(future.rows.every((r) => r.status === 'ok' && r.spent === 0));
});

test('budget view: a zero limit with spending is over, with no ratio', () => {
  const view = b.buildBudgetView({ month: '2026-10', budgets: [{ id: 'z', categoryId: 'food', name: 'Food', limit: '0' }], spent: [{ categoryId: 'food', name: 'Food', amount: '10' }], today: '2026-11-15' });
  assert.equal(view.rows[0].usedRatio, null);
  assert.equal(view.rows[0].status, 'over');
});

test('suggestions: average of the last complete months, rounded up to INR 100; needs 2 months', () => {
  const rows = [
    { month: '2026-08', categoryId: 'food', name: 'Food', amount: '3000' }, { month: '2026-09', categoryId: 'food', name: 'Food', amount: '3500' }, { month: '2026-10', categoryId: 'food', name: 'Food', amount: '4000' },
    { month: '2026-08', categoryId: 'shop', name: 'Shopping', amount: '1001' },
    { month: '2026-11', categoryId: 'food', name: 'Food', amount: '99999' }, // current month is ignored
    { month: '2026-05', categoryId: 'old', name: 'Old', amount: '5000' },   // outside the 3-month window
  ];
  const s = b.suggestBudgets(rows, '2026-11-15');
  assert.equal(s.status, 'ok');
  assert.deepEqual(s.months, ['2026-08', '2026-09', '2026-10']);
  assert.deepEqual(s.suggestions.map((x) => [x.category, x.average, x.suggested]), [['Food', 3500, 3500], ['Shopping', 333.67, 400]]);
  const thin = b.suggestBudgets([{ month: '2026-10', categoryId: 'food', name: 'Food', amount: '3000' }], '2026-11-15');
  assert.equal(thin.status, 'insufficient_data');
  assert.equal(thin.completeMonths, 1);
  assert.equal(b.suggestBudgets([], '2026-11-15').completeMonths, 0);
});

/* ------------------------------------------------------------------ simulator */

const base = { incomePaise: 5_000_000, expensesPaise: 3_000_000, categoryPaise: { Food: 800_000, Shopping: 500_000 } };
const input = (o = {}) => ({ months: 12, startingSavings: '0', returnPercent: 0, incomeChange: null, spendingChangePercent: 0, categoryCuts: [], oneOff: null, goalAmount: null, ...o });

test('simulator: unchanged baseline equals the scenario', () => {
  const r = sim.simulate(base, input());
  assert.equal(r.baseline.monthlyNet, 20000);
  assert.equal(r.baseline.endBalance, 240000);
  assert.equal(r.scenario.endBalance, 240000);
  assert.equal(r.difference.endBalance, 0);
  assert.equal(r.series.length, 12);
  assert.deepEqual(r.series[0], { month: 1, baseline: 20000, scenario: 20000 });
  assert.equal(r.goal, null);
});

test('simulator: income change, category cuts and overall spending change', () => {
  assert.equal(sim.simulate(base, input({ incomeChange: { mode: 'percent', value: 10 } })).scenario.monthlyIncome, 55000);
  assert.equal(sim.simulate(base, input({ incomeChange: { mode: 'amount', value: -5000 } })).scenario.monthlyIncome, 45000);
  const cut = sim.simulate(base, input({ categoryCuts: [{ category: 'Food', percent: 20 }] }));
  assert.equal(cut.scenario.monthlyExpenses, 28400);
  assert.equal(cut.scenario.categoryCutsMonthly, 1600);
  assert.equal(cut.difference.endBalance, 19200, '1,600 a month for 12 months');
  assert.equal(sim.simulate(base, input({ spendingChangePercent: -10 })).scenario.monthlyExpenses, 27000);
  assert.equal(sim.simulate(base, input({ spendingChangePercent: 200 })).scenario.monthlyExpenses, 90000);
  assert.equal(sim.simulate(base, input({ incomeChange: { mode: 'percent', value: -100 } })).scenario.monthlyIncome, 0);
  assert.equal(sim.simulate(base, input({ incomeChange: { mode: 'amount', value: -90000 } })).scenario.monthlyIncome, 0, 'income never goes below 0');
});

test('simulator: a one-off expense hits the chosen month; the baseline is unaffected', () => {
  const r = sim.simulate(base, input({ oneOff: { amount: '12000.00', atMonth: 3 } }));
  assert.equal(r.series[1].scenario, 40000);
  assert.equal(r.series[2].scenario, 60000 - 12000);
  assert.equal(r.series[2].baseline, 60000);
  assert.equal(r.difference.endBalance, -12000);
});

test('simulator: savings growth applies only to a positive balance', () => {
  const flat = { incomePaise: 100, expensesPaise: 100, categoryPaise: {} };
  const r = sim.simulate(flat, input({ months: 1, startingSavings: '100000', returnPercent: 12 }));
  close(r.series[0].baseline, 100948.88);
  const debt = sim.simulate({ incomePaise: 0, expensesPaise: 100_000, categoryPaise: {} }, input({ months: 2, returnPercent: 12 }));
  assert.deepEqual(debt.series.map((s) => s.baseline), [-1000, -2000], 'no interest on a negative balance');
});

test('simulator: goal months for baseline and scenario', () => {
  const r = sim.simulate(base, input({ spendingChangePercent: -10, goalAmount: '200000' }));
  assert.deepEqual(r.goal, { amount: 200000, baselineMonths: 10, scenarioMonths: 9 });
  assert.equal(sim.simulate(base, input({ goalAmount: '200000', startingSavings: '250000' })).goal.baselineMonths, 0);
  assert.equal(sim.simulate(base, input({ goalAmount: '9999999' })).goal.baselineMonths, null, 'not reached within the horizon');
});

test('validateBudgetInput and validateCopy', () => {
  const now = new Date('2026-11-14T10:00:00Z');
  const ok = v.validateBudgetInput({ month: '2026-11', categoryId: '3f2b1c9e-8a4d-4e6f-9b1a-2c3d4e5f6a7b', limit: '5,000' }, now).value;
  assert.deepEqual(ok, { month: '2026-11', categoryId: '3f2b1c9e-8a4d-4e6f-9b1a-2c3d4e5f6a7b', limit: '5000.00' });
  assert.equal(v.validateBudgetInput({ month: '2026-11', limit: '100' }, now).value.categoryId, null);
  const bad = v.validateBudgetInput({ month: '2026-13', categoryId: 'x', limit: '0' }, now).errors;
  for (const k of ['month', 'categoryId', 'limit']) assert.ok(bad[k], k);
  assert.ok(v.validateBudgetInput({ month: '2029-01', limit: '1' }, now).errors.month, 'too far ahead');
  assert.ok(v.validateCopy({ fromMonth: '2026-10', toMonth: '2026-10' }, now).errors.toMonth);
  assert.deepEqual(v.validateCopy({ fromMonth: '2026-10', toMonth: '2026-11' }, now).value, { fromMonth: '2026-10', toMonth: '2026-11' });
});

test('validateSimulation: defaults, normalisation and errors', () => {
  const d = v.validateSimulation({}).value;
  assert.equal(d.months, 12);
  assert.equal(d.startingSavings, '0.00');
  assert.equal(d.returnPercent, 0);
  assert.deepEqual(d.categoryCuts, []);
  const full = v.validateSimulation({ months: '24', startingSavings: '50,000', returnPercent: '8', incomeChange: { mode: 'percent', value: '10' }, spendingChangePercent: '-5',
    categoryCuts: [{ category: 'Food', percent: '20' }, { category: 'Shopping', percent: '0' }], oneOff: { amount: '12000', atMonth: 6 }, goalAmount: '500000' }).value;
  assert.equal(full.months, 24);
  assert.equal(full.startingSavings, '50000.00');
  assert.deepEqual(full.incomeChange, { mode: 'percent', value: 10 });
  assert.deepEqual(full.categoryCuts, [{ category: 'Food', percent: 20 }], 'a 0% cut is dropped');
  assert.deepEqual(full.oneOff, { amount: '12000.00', atMonth: 6 });
  const bad = v.validateSimulation({ months: 61, startingSavings: '-1', returnPercent: 40, incomeChange: { mode: 'x', value: 1 }, spendingChangePercent: 900, categoryCuts: [{ category: 'Food', percent: 150 }], oneOff: { amount: '5', atMonth: 99 }, goalAmount: '0' }).errors;
  for (const k of ['months', 'startingSavings', 'returnPercent', 'incomeChange', 'spendingChangePercent', 'categoryCuts', 'oneOffMonth', 'goalAmount']) assert.ok(bad[k], k);
  assert.ok(v.validateSimulation({ categoryCuts: [{ category: 'Food', percent: 5 }, { category: 'Food', percent: 6 }] }).errors.categoryCuts, 'duplicate category');
  const manual = v.validateSimulation({ baselineIncome: '50000', baselineExpenses: '30000' }).value.manualBaseline;
  assert.deepEqual(manual, { incomePaise: 5_000_000, expensesPaise: 3_000_000 });
  assert.ok(v.validateSimulation({ baselineIncome: '50000' }).errors.baselineIncome, 'both or neither');
  assert.ok(v.validateSimulation({ baselineIncome: '1', baselineExpenses: '1', categoryCuts: [{ category: 'Food', percent: 5 }] }).errors.categoryCuts, 'cuts need history');
});
