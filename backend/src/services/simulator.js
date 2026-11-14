'use strict';
/** What-if simulation on top of the forecast baseline (or a baseline the user types in). */
const { badRequest } = require('../utils/httpError');
const { getForecast } = require('./insights');
const { toPaise } = require('../analytics/calc');
const sim = require('../simulator/calc');

const LABEL = 'Simulation: these figures show what would happen if your income and spending stayed at the baseline every month with the changes you chose. They are not predictions or advice.';

async function run(userId, input, now = new Date()) {
  let baseline;
  let source;
  let categories = [];
  if (input.manualBaseline) {
    baseline = { incomePaise: input.manualBaseline.incomePaise, expensesPaise: input.manualBaseline.expensesPaise, categoryPaise: {} };
    source = 'manual';
  } else {
    const f = await getForecast(userId, now);
    if (f.status !== 'ok') return { status: 'needs_baseline', completeMonths: f.completeMonths, neededMonths: f.neededMonths, message: 'There is not enough recorded history to build a baseline. Enter your usual monthly income and spending to try the simulator.' };
    baseline = { incomePaise: toPaise(f.projections[0].income.expected), expensesPaise: toPaise(f.projections[0].expenses.expected), categoryPaise: Object.fromEntries(f.categories.map((c) => [c.category, toPaise(c.expected)])) };
    source = 'forecast';
    categories = f.categories.map((c) => ({ category: c.category, monthly: c.expected }));
    const unknown = input.categoryCuts.filter((c) => !(c.category in baseline.categoryPaise));
    if (unknown.length) throw badRequest('Please correct the highlighted fields.', { categoryCuts: `No recorded spending to cut in: ${unknown.map((u) => u.category).join(', ')}.` });
  }
  const result = sim.simulate(baseline, input);
  return { status: 'ok', source, label: LABEL, categories, ...result };
}

/** The categories (and baseline) the form can offer, without running anything. */
async function baselineInfo(userId, now = new Date()) {
  const f = await getForecast(userId, now);
  if (f.status !== 'ok') return { status: 'needs_baseline', completeMonths: f.completeMonths, neededMonths: f.neededMonths };
  return { status: 'ok', monthlyIncome: f.projections[0].income.expected, monthlyExpenses: f.projections[0].expenses.expected, categories: f.categories.map((c) => ({ category: c.category, monthly: c.expected })), basis: f.method.description };
}

module.exports = { run, baselineInfo };
