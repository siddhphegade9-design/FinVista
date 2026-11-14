'use strict';
/**
 * Builds the facts the advisor may see. Only aggregates computed by the app are included.
 * Never included: name, email, transaction descriptions (user-typed or imported text that could carry
 * instructions), notes, policy or SIP names, insurer names, or any identifier.
 */
const MAX_HISTORY = 6;
const MAX_CATEGORIES = 6;
const MAX_UNUSUAL = 5;

function buildFacts({ forecast, anomalies, budgets, investments, insurance, now = new Date(), currency = 'INR' }) {
  const facts = {
    generatedOn: now.toISOString().slice(0, 10),
    currency,
    dataNotes: [],
  };
  const ok = forecast.status === 'ok';
  facts.completeMonthsOfHistory = forecast.completeMonths ?? 0;
  if (!ok) facts.dataNotes.push(`Only ${forecast.completeMonths ?? 0} complete month(s) of history; at least ${forecast.neededMonths} are needed for typical-month estimates.`);

  facts.recordedMonths = (forecast.history || []).slice(-MAX_HISTORY).map((h) => ({ month: h.month, income: h.income, expenses: h.expenses, saved: Math.round((h.income - h.expenses) * 100) / 100 }));
  if (forecast.currentMonth) {
    facts.currentMonthSoFar = { month: forecast.currentMonth.month, income: forecast.currentMonth.income, expenses: forecast.currentMonth.expenses, note: 'Month not finished; these are actuals recorded so far.' };
  }
  if (ok) {
    const p = forecast.projections[0];
    facts.typicalMonth = {
      kind: 'ESTIMATE based on recorded history, not a prediction of exact figures',
      income: p.income.expected, expenses: p.expenses.expected, saved: p.net.expected,
      expensesLikelyRange: [p.expenses.low, p.expenses.high],
    };
    facts.topSpendingCategories = (forecast.categories || []).slice(0, MAX_CATEGORIES).map((c) => ({ category: c.category, typicalMonthly: c.expected }));
  }

  facts.budgetsThisMonth = budgets.rows.length || budgets.overall ? {
    month: budgets.month,
    overall: budgets.overall ? { limit: budgets.overall.limit, spent: budgets.overall.spent, status: budgets.overall.status } : null,
    categories: budgets.rows.map((r) => ({ category: r.category, limit: r.limit, spent: r.spent, status: r.status })),
    spentOutsideBudgets: budgets.totals.unbudgetedSpent,
    monthPhase: budgets.phase,
  } : null;
  if (!facts.budgetsThisMonth) facts.dataNotes.push('No budgets are set for this month.');

  facts.unusualSpending = (anomalies.anomalies || []).slice(0, MAX_UNUSUAL).map((a) => ({ kind: a.kind, date: a.date, category: a.category, amount: a.amount, explanation: a.reason }));

  facts.commitments = {
    activeSips: investments.sipCount, sipMonthly: investments.sipMonthly,
    activeInsurancePolicies: insurance.activeCount, insuranceMonthlyEquivalent: insurance.monthlyEquivalent,
    renewalsDueSoon: insurance.dueSoon, renewalsOverdue: insurance.overdue,
  };
  return facts;
}

module.exports = { buildFacts, MAX_HISTORY, MAX_CATEGORIES, MAX_UNUSUAL };
