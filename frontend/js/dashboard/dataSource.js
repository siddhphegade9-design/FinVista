/**
 * Where the dashboard gets its data.
 *
 * The real source is the signed-in user's own transactions and budgets from the API. `?preview=1` loads clearly labelled SAMPLE data so the design can
 * be reviewed; the page shows a banner whenever it is active and nothing is stored.
 */
import { api } from '../core/api.js';
import { currentMonthKey, shiftMonth } from './metrics.js';

/** Deterministic sample data, generated relative to the current month. */
export function buildSampleData(now = new Date()) {
  const thisMonth = currentMonthKey(now);
  const last = now.getDate();
  // [monthsAgo, day, description, category, type, amount]
  const plan = [];
  const salary = [82000, 82000, 85000, 85000, 85000, 88000];
  const food = [9800, 11200, 10400, 12600, 10900, 9400];
  const shopping = [4200, 6100, 3800, 5200, 15400, 4900];
  const transport = [3100, 2900, 3400, 3000, 3300, 2800];
  for (let i = 0; i < 6; i++) {
    const ago = 5 - i;
    plan.push([ago, 1, 'Salary credit', 'Salary', 'income', salary[i]]);
    plan.push([ago, 2, 'Rent', 'Housing', 'expense', 24000]);
    plan.push([ago, 4, 'Electricity and internet', 'Bills & Utilities', 'expense', 3600 + i * 120]);
    plan.push([ago, 8, 'Groceries and dining', 'Food & Dining', 'expense', food[i]]);
    plan.push([ago, 12, 'Metro and cabs', 'Transport', 'expense', transport[i]]);
    plan.push([ago, 17, 'Online shopping', 'Shopping', 'expense', shopping[i]]);
    plan.push([ago, 21, 'Streaming and outings', 'Entertainment', 'expense', 2200 + (i % 3) * 400]);
  }
  const transactions = plan
    .map(([ago, day, description, category, type, amount], n) => {
      const month = shiftMonth(thisMonth, -ago);
      // Keep sample entries from the current month in the past.
      const d = ago === 0 ? Math.min(day, last) : day;
      return { id: `sample-${String(n).padStart(3, '0')}`, date: `${month}-${String(d).padStart(2, '0')}`, description, category, type, amount };
    });
  const budgets = [
    { category: 'Housing', limit: 32000 }, { category: 'Food & Dining', limit: 11000 },
    { category: 'Transport', limit: 4000 }, { category: 'Shopping', limit: 4500 },
    { category: 'Entertainment', limit: 4000 },
  ];
  return { transactions, budgets };
}

/** Loads dashboard data. Returns { transactions, budgets, isSample, truncated }. */
export async function loadDashboardData({ preview = false } = {}) {
  if (preview) return { ...buildSampleData(), isSample: true, truncated: false };
  const { transactions, truncated } = await api.get('/transactions/all');
  return { transactions, budgets: [], isSample: false, truncated };
}

/** The signed-in user's category budgets for one month, as [{ category, limit }]. */
export async function loadBudgets(month) {
  const view = await api.get(`/budgets?month=${encodeURIComponent(month)}`);
  return view.rows.map((r) => ({ category: r.category, limit: Number(r.limit) }));
}
