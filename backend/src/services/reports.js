'use strict';
/** Financial health score and monthly report. Reads only the signed-in user's data; maths lives in health/score.js. */
const { computeScore } = require('../health/score');
const analytics = require('./analytics');
const budgetsSvc = require('./budgets');
const insights = require('./insights');
const investments = require('./investments');
const users = require('./users');

const monthKey = (y, m0) => `${y + Math.floor(m0 / 12)}-${String((((m0 % 12) + 12) % 12) + 1).padStart(2, '0')}`;
const addMonths = (key, n) => { const [y, m] = key.split('-').map(Number); return monthKey(y, m - 1 + n); };
const monthRange = (key) => {
  const [y, m] = key.split('-').map(Number);
  return { from: `${key}-01`, to: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) };
};
const thisMonth = (now) => now.toISOString().slice(0, 7);

async function healthScore(userId, now = new Date()) {
  const latest = addMonths(thisMonth(now), -1);
  const range = { from: monthRange(addMonths(latest, -2)).from, to: monthRange(latest).to };
  const [a, budgets, pols, commit, currency] = await Promise.all([
    analytics.getAnalytics(userId, range, now),
    budgetsSvc.getBudgets(userId, latest, now),
    investments.listPolicies(userId, now),
    investments.commitments(userId, now),
    users.getCurrency(userId),
  ]);
  const months = a.monthly.filter((m) => m.count > 0).map(({ month, income, expenses }) => ({ month, income, expenses }));
  const result = computeScore({
    months, budgetRows: budgets.rows, sipMonthly: commit.sipMonthly, currency,
    hasHealthPolicy: pols.policies.some((p) => p.isActive && p.policyType === 'health'),
  });
  return {
    ...result,
    basedOn: { months: months.map((m) => m.month), budgetMonth: latest },
    notice: 'A guide built from the figures you have recorded in FinVista. It is not a credit score, does not predict anything and is not financial advice.',
  };
}

async function monthlyReport(userId, month, now = new Date()) {
  const cur = monthRange(month);
  const prevKey = addMonths(month, -1);
  const [a, prev, budgets, anomalies, commit] = await Promise.all([
    analytics.getAnalytics(userId, cur, now),
    analytics.getAnalytics(userId, monthRange(prevKey), now),
    budgetsSvc.getBudgets(userId, month, now),
    insights.getAnomalies(userId, now),
    investments.commitments(userId, now),
  ]);
  const change = (now_, before) => (before > 0 ? Math.round(((now_ - before) / before) * 1000) / 1000 : null);
  return {
    month, from: cur.from, to: cur.to,
    status: month > thisMonth(now) ? 'future' : month === thisMonth(now) ? 'in_progress' : 'complete',
    totals: { income: a.totals.income, expenses: a.totals.expenses, net: a.totals.net, savingsRate: a.totals.savingsRate, count: a.totals.count },
    previousMonth: { month: prevKey, income: prev.totals.income, expenses: prev.totals.expenses, net: prev.totals.net, count: prev.totals.count,
      incomeChange: change(a.totals.income, prev.totals.income), expensesChange: change(a.totals.expenses, prev.totals.expenses) },
    expenseCategories: a.expenseCategories.slice(0, 8),
    incomeCategories: a.incomeCategories.slice(0, 5),
    topExpenses: a.topExpenses,
    budgets: { phase: budgets.phase, rows: budgets.rows, overall: budgets.overall, unbudgeted: budgets.unbudgeted, totals: budgets.totals },
    unusual: anomalies.anomalies.filter((x) => typeof x.date === 'string' && x.date.startsWith(month)),
    unusualNotice: anomalies.notice,
    commitments: commit,
    notice: month === thisMonth(now) ? 'This month is not finished. Figures are what you have recorded so far.' : null,
  };
}

module.exports = { healthScore, monthlyReport, addMonths, monthRange };
