'use strict';
/**
 * Analytics aggregation. Everything is computed in SQL (grouped sums) and shaped by analytics/calc.js,
 * always filtered by user_id. Nothing here estimates or predicts: these are totals of recorded transactions.
 */
const db = require('../db/pool');
const calc = require('../analytics/calc');

const SUM = 'sum(t.amount)::text AS amount, count(*)::int AS count';

async function getAnalytics(userId, { from, to }, now = new Date()) {
  const p = [userId, from, to];
  const range = 't.user_id = $1 AND t.occurred_on BETWEEN $2 AND $3';
  const prev = calc.previousPeriod(from, to);

  const [monthlyQ, categoryQ, trendQ, weekdayQ, topQ, prevQ] = await Promise.all([
    db.query(`SELECT to_char(date_trunc('month', t.occurred_on), 'YYYY-MM') AS month, t.type, ${SUM} FROM transactions t WHERE ${range} GROUP BY 1, 2`, p),
    db.query(`SELECT c.id, c.name, t.type, ${SUM} FROM transactions t JOIN categories c ON c.id = t.category_id AND c.user_id = t.user_id WHERE ${range} GROUP BY c.id, c.name, t.type`, p),
    db.query(`SELECT to_char(date_trunc('month', t.occurred_on), 'YYYY-MM') AS month, c.id, c.name, sum(t.amount)::text AS amount FROM transactions t JOIN categories c ON c.id = t.category_id AND c.user_id = t.user_id WHERE ${range} AND t.type = 'expense' GROUP BY 1, c.id, c.name`, p),
    db.query(`SELECT EXTRACT(DOW FROM t.occurred_on)::int AS dow, ${SUM} FROM transactions t WHERE ${range} AND t.type = 'expense' GROUP BY 1`, p),
    db.query(`SELECT t.id, t.occurred_on AS date, t.description, t.amount::text AS amount, c.name AS category FROM transactions t JOIN categories c ON c.id = t.category_id AND c.user_id = t.user_id WHERE ${range} AND t.type = 'expense' ORDER BY t.amount DESC, t.occurred_on DESC, t.id LIMIT 5`, p),
    db.query(`SELECT t.type, ${SUM} FROM transactions t WHERE t.user_id = $1 AND t.occurred_on BETWEEN $2 AND $3 GROUP BY 1`, [userId, prev.from, prev.to]),
  ]);

  const monthKeys = calc.monthKeysBetween(from, to);
  const monthly = calc.buildMonthly(monthlyQ.rows, monthKeys);
  const totals = calc.summarize(monthlyQ.rows.map((r) => ({ type: r.type, amount: r.amount, count: r.count })));
  const previous = calc.summarize(prevQ.rows);

  const expenseCategories = calc.buildCategories(categoryQ.rows.filter((r) => r.type === 'expense'));
  const incomeCategories = calc.buildCategories(categoryQ.rows.filter((r) => r.type === 'income'));

  // Cumulative net across the range (a running total of recorded income minus expenses).
  let running = 0;
  const cumulative = monthly.map((m) => { running += calc.toPaise(m.net); return { month: m.month, value: calc.fromPaise(running) }; });

  const nowMonth = now.toISOString().slice(0, 7);
  const months = monthKeys.length;
  return {
    range: { from, to },
    previousRange: prev,
    months,
    includesCurrentMonth: monthKeys.includes(nowMonth),
    totals: {
      income: totals.income, expenses: totals.expenses, net: totals.net, savingsRate: totals.savingsRate, count: totals.count,
      avgMonthlyIncome: calc.fromPaise(Math.round(totals.incomePaise / months)),
      avgMonthlyExpenses: calc.fromPaise(Math.round(totals.expensesPaise / months)),
    },
    comparison: {
      previousIncome: previous.income, previousExpenses: previous.expenses, previousNet: previous.net, previousCount: previous.count,
      incomeChange: calc.changeRatio(totals.incomePaise, previous.incomePaise),
      expensesChange: calc.changeRatio(totals.expensesPaise, previous.expensesPaise),
    },
    monthly,
    cumulativeNet: cumulative,
    expenseCategories,
    incomeCategories,
    categoryTrend: calc.buildCategoryTrend(trendQ.rows, monthKeys, expenseCategories),
    weekdays: calc.buildWeekdays(weekdayQ.rows),
    topExpenses: topQ.rows.map((r) => ({ id: r.id, date: r.date, description: r.description, category: r.category, amount: Number(r.amount) })),
  };
}

module.exports = { getAnalytics };
