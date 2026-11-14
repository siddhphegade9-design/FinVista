/**
 * Pure dashboard calculations. No DOM, no network: given an array of
 * transactions these functions return numbers. The UI only renders what is
 * computed here, so every figure on screen traces back to real records.
 *
 * Transaction shape (matches the API planned for Milestone 5):
 *   { id, date: 'YYYY-MM-DD', description, category, type: 'income'|'expense', amount: positive number }
 *
 * Money is summed in integer paise to avoid floating-point drift.
 */

const toPaise = (amount) => Math.round(Number(amount) * 100);
const fromPaise = (paise) => paise / 100;

/** 'YYYY-MM-DD' -> 'YYYY-MM' */
export const monthOf = (isoDate) => String(isoDate).slice(0, 7);

/** Shifts a 'YYYY-MM' key by n months (negative = back). */
export function shiftMonth(monthKey, n) {
  const [y, m] = monthKey.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Current month key from a Date (local time). */
export const currentMonthKey = (now = new Date()) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

/** 'YYYY-MM' -> 'Nov 2026' (or 'Nov' when short). */
export function monthLabel(monthKey, { short = false } = {}) {
  const [y, m] = monthKey.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', short ? { month: 'short' } : { month: 'short', year: 'numeric' });
}

/**
 * Income, expenses, savings and savings rate for one month.
 * savingsRate is a ratio (savings / income) or null when there is no income,
 * because a rate against zero income is undefined, not 0%.
 */
export function summarizeMonth(transactions, monthKey) {
  let income = 0;
  let expenses = 0;
  let count = 0;
  for (const t of transactions) {
    if (monthOf(t.date) !== monthKey) continue;
    count += 1;
    if (t.type === 'income') income += toPaise(t.amount);
    else if (t.type === 'expense') expenses += toPaise(t.amount);
  }
  const savings = income - expenses;
  return {
    month: monthKey,
    income: fromPaise(income),
    expenses: fromPaise(expenses),
    savings: fromPaise(savings),
    savingsRate: income > 0 ? savings / income : null,
    transactionCount: count,
  };
}

/** Expense totals per category for a month, largest first. */
export function spendingByCategory(transactions, monthKey) {
  const totals = new Map();
  for (const t of transactions) {
    if (t.type !== 'expense' || monthOf(t.date) !== monthKey) continue;
    totals.set(t.category, (totals.get(t.category) ?? 0) + toPaise(t.amount));
  }
  return [...totals.entries()]
    .map(([category, paise]) => ({ category, amount: fromPaise(paise) }))
    .sort((a, b) => b.amount - a.amount || a.category.localeCompare(b.category));
}

/** Summaries for the `count` months ending at (and including) endMonth, oldest first. */
export function monthlySeries(transactions, endMonth, count = 6) {
  return Array.from({ length: count }, (_, i) => summarizeMonth(transactions, shiftMonth(endMonth, i - (count - 1))));
}

/**
 * Budget utilisation per category.
 * budgets: [{ category, limit }]; spent comes from spendingByCategory().
 * status: 'ok' (<80%), 'warning' (80-100%), 'over' (>100%).
 */
export function budgetUtilization(budgets, spending) {
  const spentMap = new Map(spending.map((s) => [s.category, s.amount]));
  return budgets.map(({ category, limit }) => {
    const spent = spentMap.get(category) ?? 0;
    const ratio = limit > 0 ? spent / limit : null;
    let status = 'ok';
    if (ratio !== null && ratio > 1) status = 'over';
    else if (ratio !== null && ratio >= 0.8) status = 'warning';
    return { category, limit, spent, ratio, remaining: limit - spent, status };
  });
}

/** Overall budget utilisation across all budgeted categories (ratio) or null. */
export function overallBudgetRatio(utilization) {
  const limit = utilization.reduce((s, u) => s + toPaise(u.limit), 0);
  const spent = utilization.reduce((s, u) => s + toPaise(u.spent), 0);
  return limit > 0 ? spent / limit : null;
}

/** Most recent transactions first (date desc, then id desc for stability). */
export function recentTransactions(transactions, limit = 8) {
  return [...transactions]
    .sort((a, b) => (a.date === b.date ? String(b.id).localeCompare(String(a.id)) : b.date.localeCompare(a.date)))
    .slice(0, limit);
}

/** Change between two numbers as a ratio of the previous value, or null if previous is 0. */
export function changeRatio(current, previous) {
  return previous > 0 ? (current - previous) / previous : null;
}

/** All-time net savings (every income minus every expense), i.e. "current savings". */
export function cumulativeSavings(transactions) {
  let paise = 0;
  for (const t of transactions) {
    if (t.type === 'income') paise += toPaise(t.amount);
    else if (t.type === 'expense') paise -= toPaise(t.amount);
  }
  return fromPaise(paise);
}
