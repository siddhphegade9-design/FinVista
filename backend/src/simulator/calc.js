'use strict';
/**
 * What-if simulator. Pure and deterministic. It does not predict: it applies the user's own changes to a baseline
 * monthly income and spending and shows how the savings balance would move if those numbers held every month.
 *
 *   monthly net     = income - spending
 *   balance(t)      = balance(t-1) + net + interest on a positive balance
 *   interest        = positive balance x (1 + r)^(1/12) - 1   (r is the yearly return the user assumes, default 0)
 *
 * A one-off expense is subtracted in the month the user picks. Rounding is to whole paise each month.
 */
const { toPaise, fromPaise } = require('../analytics/calc');

const MAX_MONTHS = 60;

const monthlyRate = (annualPercent) => (1 + annualPercent / 100) ** (1 / 12) - 1;

/** Applies the changes to a baseline: returns the scenario's monthly income and spending in paise. */
function applyChanges({ incomePaise, expensesPaise, categoryPaise = {} }, changes) {
  let income = incomePaise;
  if (changes.incomeChange) {
    income = changes.incomeChange.mode === 'percent'
      ? Math.round(incomePaise * (1 + changes.incomeChange.value / 100))
      : incomePaise + toPaise(changes.incomeChange.value);
  }
  let expenses = expensesPaise;
  if (changes.spendingChangePercent) expenses = Math.round(expenses * (1 + changes.spendingChangePercent / 100));
  let cutTotal = 0;
  for (const cut of changes.categoryCuts || []) cutTotal += Math.round((categoryPaise[cut.category] || 0) * (cut.percent / 100));
  expenses -= cutTotal;
  return { incomePaise: Math.max(0, income), expensesPaise: Math.max(0, expenses), cutTotalPaise: cutTotal };
}

function runSeries({ incomePaise, expensesPaise }, { months, startingPaise, returnPercent, oneOff }) {
  const i = monthlyRate(returnPercent);
  const out = [];
  let balance = startingPaise;
  for (let m = 1; m <= months; m += 1) {
    const interest = balance > 0 ? Math.round(balance * i) : 0;
    balance += incomePaise - expensesPaise + interest;
    if (oneOff && oneOff.atMonth === m) balance -= toPaise(oneOff.amount);
    out.push(balance);
  }
  return out;
}

const firstReaching = (series, goalPaise, startingPaise) => {
  if (startingPaise >= goalPaise) return 0;
  const idx = series.findIndex((b) => b >= goalPaise);
  return idx === -1 ? null : idx + 1;
};

/**
 * @param baseline { incomePaise, expensesPaise, categoryPaise: { name: paise } }
 * @param input    validated simulator input (see validation/simulator.js)
 */
function simulate(baseline, input) {
  const opts = { months: input.months, startingPaise: toPaise(input.startingSavings), returnPercent: input.returnPercent };
  const scenarioBase = applyChanges(baseline, input);
  const baseSeries = runSeries(baseline, { ...opts, oneOff: null });
  const scenSeries = runSeries(scenarioBase, { ...opts, oneOff: input.oneOff });
  const goalPaise = input.goalAmount ? toPaise(input.goalAmount) : null;
  const money = (p) => fromPaise(p);
  const last = (a) => a[a.length - 1];
  return {
    months: input.months,
    baseline: { monthlyIncome: money(baseline.incomePaise), monthlyExpenses: money(baseline.expensesPaise), monthlyNet: money(baseline.incomePaise - baseline.expensesPaise), endBalance: money(last(baseSeries)) },
    scenario: {
      monthlyIncome: money(scenarioBase.incomePaise), monthlyExpenses: money(scenarioBase.expensesPaise), monthlyNet: money(scenarioBase.incomePaise - scenarioBase.expensesPaise),
      endBalance: money(last(scenSeries)), categoryCutsMonthly: money(scenarioBase.cutTotalPaise),
    },
    difference: { monthlyNet: money((scenarioBase.incomePaise - scenarioBase.expensesPaise) - (baseline.incomePaise - baseline.expensesPaise)), endBalance: money(last(scenSeries) - last(baseSeries)) },
    series: baseSeries.map((b, idx) => ({ month: idx + 1, baseline: money(b), scenario: money(scenSeries[idx]) })),
    goal: goalPaise === null ? null : { amount: money(goalPaise), baselineMonths: firstReaching(baseSeries, goalPaise, opts.startingPaise), scenarioMonths: firstReaching(scenSeries, goalPaise, opts.startingPaise) },
  };
}

module.exports = { MAX_MONTHS, monthlyRate, applyChanges, runSeries, simulate };
