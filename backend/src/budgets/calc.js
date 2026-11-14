'use strict';
/**
 * Budget maths. Pure (no database); the date is passed in. Money is integer paise.
 * A budget is a limit the user sets for a category in a month. "Spent" is the sum of recorded expenses
 * in that category and month. Nothing here predicts: pace compares the share of the budget used with the
 * share of the month gone, and says so.
 */
const { toPaise, fromPaise } = require('../analytics/calc');

const WATCH_RATIO = 0.8;      // 80% of the limit used
const PACE_MARGIN = 0.15;     // used share ahead of elapsed share by more than this
const SUGGEST_MONTHS = 3;
const MIN_SUGGEST_MONTHS = 2;
const ROUND_TO_PAISE = 10_000; // suggestions are rounded up to the next INR 100

const daysInMonth = (key) => { const [y, m] = key.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
const addMonths = (key, n) => { const [y, m] = key.split('-').map(Number); const t = y * 12 + (m - 1) + n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; };

/** 'past' | 'current' | 'future' relative to `todayIso`. */
function monthPhase(month, todayIso) {
  const cur = todayIso.slice(0, 7);
  return month < cur ? 'past' : month > cur ? 'future' : 'current';
}

function rowFor({ id, categoryId, name, limitPaise, spentPaise }, phase, elapsed) {
  const remaining = limitPaise - spentPaise;
  const usedRatio = limitPaise > 0 ? spentPaise / limitPaise : null;
  let status = 'ok';
  if (spentPaise > limitPaise) status = 'over';
  else if (limitPaise > 0 && usedRatio >= WATCH_RATIO) status = 'watch';
  let pace = null;
  if (phase === 'current' && status === 'ok' && usedRatio !== null && usedRatio > elapsed + PACE_MARGIN) {
    pace = `${Math.round(usedRatio * 100)}% of the budget is used with ${Math.round(elapsed * 100)}% of the month gone.`;
  }
  return {
    id, categoryId, category: name, limit: fromPaise(limitPaise), spent: fromPaise(spentPaise), remaining: fromPaise(remaining),
    usedRatio: usedRatio === null ? null : Math.round(usedRatio * 1000) / 1000, status, pace,
  };
}

/**
 * @param budgets [{ id, categoryId|null, name|null, limit }]   (limit in rupees)
 * @param spent   [{ categoryId, name, amount }]               expenses in the month by category
 */
function buildBudgetView({ month, budgets, spent, today }) {
  const phase = monthPhase(month, today);
  const elapsed = phase === 'past' ? 1 : phase === 'future' ? 0 : Number(today.slice(8, 10)) / daysInMonth(month);
  const spentBy = new Map(spent.map((s) => [s.categoryId, { name: s.name, paise: toPaise(s.amount) }]));
  const totalSpent = [...spentBy.values()].reduce((a, s) => a + s.paise, 0);

  const catBudgets = budgets.filter((b) => b.categoryId);
  const overall = budgets.find((b) => !b.categoryId) || null;
  const rows = catBudgets.map((b) => rowFor({ id: b.id, categoryId: b.categoryId, name: b.name, limitPaise: toPaise(b.limit), spentPaise: spentBy.get(b.categoryId)?.paise || 0 }, phase, elapsed))
    .sort((a, b) => (b.usedRatio ?? 9) - (a.usedRatio ?? 9) || a.category.localeCompare(b.category));
  const budgeted = new Set(catBudgets.map((b) => b.categoryId));
  const unbudgeted = [...spentBy.entries()].filter(([id, s]) => !budgeted.has(id) && s.paise > 0)
    .map(([categoryId, s]) => ({ categoryId, category: s.name, spent: fromPaise(s.paise) })).sort((a, b) => b.spent - a.spent || a.category.localeCompare(b.category));

  const limitSum = catBudgets.reduce((a, b) => a + toPaise(b.limit), 0);
  const spentInBudgeted = catBudgets.reduce((a, b) => a + (spentBy.get(b.categoryId)?.paise || 0), 0);
  return {
    month, phase, elapsedRatio: Math.round(elapsed * 1000) / 1000,
    rows, unbudgeted,
    overall: overall ? rowFor({ id: overall.id, categoryId: null, name: 'All spending', limitPaise: toPaise(overall.limit), spentPaise: totalSpent }, phase, elapsed) : null,
    totals: {
      budgetedCategories: rows.length, limit: fromPaise(limitSum), spentInBudgeted: fromPaise(spentInBudgeted), remaining: fromPaise(limitSum - spentInBudgeted),
      totalSpent: fromPaise(totalSpent), unbudgetedSpent: fromPaise(totalSpent - spentInBudgeted),
      overCount: rows.filter((r) => r.status === 'over').length, watchCount: rows.filter((r) => r.status === 'watch').length,
    },
  };
}

/**
 * Suggested limits from the user's own recent months: the average of the last (up to) 3 complete months per category,
 * rounded up to the next INR 100. `byMonth`: [{ month, categoryId, name, amount }]. Needs at least 2 complete months.
 */
function suggestBudgets(byMonth, today, roundToPaise = ROUND_TO_PAISE) {
  const cur = today.slice(0, 7);
  const months = [...new Set(byMonth.map((r) => r.month))].filter((m) => m < cur).sort();
  if (!months.length) return { status: 'insufficient_data', completeMonths: 0, neededMonths: MIN_SUGGEST_MONTHS, suggestions: [] };
  const first = months[0];
  let span = 0;
  for (let m = first; m < cur; m = addMonths(m, 1)) span += 1;
  const n = Math.min(span, SUGGEST_MONTHS);
  const window = Array.from({ length: n }, (_, i) => addMonths(cur, -(n - i)));
  if (window.length < MIN_SUGGEST_MONTHS) return { status: 'insufficient_data', completeMonths: window.length, neededMonths: MIN_SUGGEST_MONTHS, suggestions: [] };
  const cats = new Map();
  for (const r of byMonth) {
    if (!window.includes(r.month)) continue;
    if (!cats.has(r.categoryId)) cats.set(r.categoryId, { name: r.name, paise: 0 });
    cats.get(r.categoryId).paise += toPaise(r.amount);
  }
  const suggestions = [...cats.entries()].map(([categoryId, c]) => {
    const avg = c.paise / window.length;
    return { categoryId, category: c.name, average: fromPaise(Math.round(avg)), suggested: fromPaise(Math.ceil(avg / roundToPaise) * roundToPaise) };
  }).filter((s) => s.suggested > 0).sort((a, b) => b.suggested - a.suggested || a.category.localeCompare(b.category));
  return { status: 'ok', completeMonths: window.length, neededMonths: MIN_SUGGEST_MONTHS, months: window, suggestions };
}

module.exports = { WATCH_RATIO, PACE_MARGIN, monthPhase, buildBudgetView, suggestBudgets, addMonths, daysInMonth };
