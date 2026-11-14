'use strict';
/**
 * Spending and income projection. This is deliberately simple and explainable, not a black box:
 *   expected value = recency-weighted average of the last complete months (newest month counts most)
 *   range          = expected value +/- one standard deviation of those months (never below 0)
 * No trend is extrapolated, and the result is always labelled a projection, not a fact.
 * Needs at least MIN_MONTHS complete months of history; otherwise it says so instead of guessing.
 */
const { toPaise, fromPaise } = require('../analytics/calc');
const { mean, stdDev, recencyWeightedMean } = require('./stats');

const MIN_MONTHS = 3;
const MAX_MONTHS = 6;
const HORIZON = 3;

const monthKey = (y, m0) => `${y + Math.floor(m0 / 12)}-${String((((m0 % 12) + 12) % 12) + 1).padStart(2, '0')}`;
const keyParts = (key) => { const [y, m] = key.split('-').map(Number); return { y, m0: m - 1 }; };
const addMonths = (key, n) => { const { y, m0 } = keyParts(key); return monthKey(y, m0 + n); };
const monthsBetween = (a, b) => { const x = keyParts(a); const y = keyParts(b); return (y.y - x.y) * 12 + (y.m0 - x.m0); };

/**
 * The window of complete months to learn from: starts at the first month with any data, ends at the month
 * before `currentMonth`, and keeps at most the latest MAX_MONTHS. Months in between with no data count as 0.
 */
function historyWindow(firstDataMonth, currentMonth) {
  if (!firstDataMonth || firstDataMonth >= currentMonth) return [];
  const span = monthsBetween(firstDataMonth, currentMonth); // number of complete months available
  const count = Math.min(span, MAX_MONTHS);
  return Array.from({ length: count }, (_, i) => addMonths(currentMonth, -(count - i)));
}

/** Projection for one series of paise values (oldest first). */
function project(values) {
  const expected = recencyWeightedMean(values);
  const spread = stdDev(values);
  return {
    expected: Math.round(expected),
    low: Math.max(0, Math.round(expected - spread)),
    high: Math.round(expected + spread),
  };
}

/**
 * @param monthlyRows   [{ month:'YYYY-MM', type:'income'|'expense', amount }] (amount: string or number, rupees)
 * @param categoryRows  [{ month, category, amount }] expense rows
 * @param now           Date
 */
function buildForecast(monthlyRows, categoryRows, now = new Date()) {
  const currentMonth = now.toISOString().slice(0, 7);
  const rows = monthlyRows.map((r) => ({ ...r, paise: toPaise(r.amount) }));
  const firstDataMonth = rows.length ? rows.map((r) => r.month).sort()[0] : null;
  const window = historyWindow(firstDataMonth, currentMonth);

  const series = (type) => window.map((m) => rows.filter((r) => r.month === m && r.type === type).reduce((a, r) => a + r.paise, 0));
  const income = series('income');
  const expenses = series('expense');

  const history = window.map((month, i) => ({ month, income: fromPaise(income[i]), expenses: fromPaise(expenses[i]) }));
  const method = {
    name: 'Recency-weighted average',
    description: `Average of the last ${window.length || MAX_MONTHS} complete months, with recent months counting more. The range is one standard deviation either side. No trend is assumed.`,
    minMonths: MIN_MONTHS, maxMonths: MAX_MONTHS,
  };

  const so = rows.filter((r) => r.month === currentMonth);
  const currentActual = {
    month: currentMonth,
    income: fromPaise(so.filter((r) => r.type === 'income').reduce((a, r) => a + r.paise, 0)),
    expenses: fromPaise(so.filter((r) => r.type === 'expense').reduce((a, r) => a + r.paise, 0)),
  };

  if (window.length < MIN_MONTHS) {
    return { status: 'insufficient_data', completeMonths: window.length, neededMonths: MIN_MONTHS, method, history, currentMonth: currentActual, projections: [], categories: [] };
  }

  const inc = project(income);
  const exp = project(expenses);
  const projections = Array.from({ length: HORIZON }, (_, i) => ({
    month: addMonths(currentMonth, i + 1),
    income: { expected: fromPaise(inc.expected), low: fromPaise(inc.low), high: fromPaise(inc.high) },
    expenses: { expected: fromPaise(exp.expected), low: fromPaise(exp.low), high: fromPaise(exp.high) },
    net: { expected: fromPaise(inc.expected - exp.expected), low: fromPaise(inc.low - exp.high), high: fromPaise(inc.high - exp.low) },
  }));

  // Where the current (unfinished) month is heading: never less than what is already spent.
  const expectedThisMonth = Math.max(exp.expected, toPaise(currentActual.expenses));
  const current = {
    ...currentActual,
    expectedExpenses: fromPaise(expectedThisMonth),
    expectedIncome: fromPaise(Math.max(inc.expected, toPaise(currentActual.income))),
    note: 'The month is not finished. Expected figures use your usual month, and are never below what is already recorded.',
  };

  // Per-category projection of the same kind, for categories with spending in the window.
  const byCat = new Map();
  for (const r of categoryRows) {
    if (!window.includes(r.month)) continue;
    if (!byCat.has(r.category)) byCat.set(r.category, new Map());
    const m = byCat.get(r.category);
    m.set(r.month, (m.get(r.month) || 0) + toPaise(r.amount));
  }
  const categories = [...byCat.entries()].map(([category, m]) => {
    const values = window.map((mm) => m.get(mm) || 0);
    const p = project(values);
    return { category, expected: fromPaise(p.expected), low: fromPaise(p.low), high: fromPaise(p.high), monthsWithSpending: values.filter((v) => v > 0).length, average: fromPaise(Math.round(mean(values))) };
  }).sort((a, b) => b.expected - a.expected || a.category.localeCompare(b.category));

  return { status: 'ok', completeMonths: window.length, neededMonths: MIN_MONTHS, method, history, currentMonth: current, projections, categories };
}

module.exports = { MIN_MONTHS, MAX_MONTHS, HORIZON, addMonths, historyWindow, project, buildForecast };
