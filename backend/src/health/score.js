'use strict';
/**
 * Financial health score: a transparent 0-100 guide built from the user's own recorded data.
 * Pure functions, no database, no AI. Every point can be traced to one component below.
 *
 * It is NOT a credit score and does not predict anything. Components with too little data are left out and the
 * score is rescaled over the components that could be measured, so missing data never counts as good or bad.
 */
const WEIGHTS = { savings: 35, investing: 20, budgets: 20, cover: 15, stability: 10 };
const TARGETS = { savingsRate: 0.2, investingRate: 0.1, stabilityBest: 0.15, stabilityWorst: 0.5 };
const MIN_SCORED_COMPONENTS = 2;
const BANDS = [[80, 'Strong'], [60, 'Good'], [40, 'Fair'], [0, 'Needs attention']];

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const round1 = (x) => Math.round(x * 10) / 10;
const pct = (x) => `${Math.round(x * 100)}%`;
const currencies = require('../config/currencies');

function band(score) { return BANDS.find(([min]) => score >= min)[1]; }

/**
 * @param {object} d
 * @param {{month:string, income:number, expenses:number}[]} d.months  up to the last 3 COMPLETE months, oldest first
 * @param {{status:string}[]|null} d.budgetRows  category budgets of the latest complete month (null/[] if none set)
 * @param {number} d.sipMonthly  active SIP instalments per month
 * @param {boolean} d.hasHealthPolicy  an active health policy is recorded
 */
function computeScore({ months = [], budgetRows = null, sipMonthly = 0, hasHealthPolicy = false, currency = currencies.DEFAULT_CURRENCY }) {
  const inr = (n) => currencies.formatMoney(Math.round(n), currency);
  const withIncome = months.filter((m) => m.income > 0);
  const income = withIncome.reduce((a, m) => a + m.income, 0);
  const net = withIncome.reduce((a, m) => a + (m.income - m.expenses), 0);
  const avgIncome = withIncome.length ? income / withIncome.length : 0;
  const components = [];
  const add = (key, label, scored, fraction, value, explanation, tip) => components.push({
    key, label, weight: WEIGHTS[key], scored,
    points: scored ? round1(WEIGHTS[key] * fraction) : 0,
    value, explanation, tip: tip || null,
  });

  // 1. Savings rate
  if (withIncome.length) {
    const rate = net / income;
    add('savings', 'Savings rate', true, clamp01(rate / TARGETS.savingsRate), rate,
      `You kept ${pct(Math.max(rate, 0))} of recorded income over the last ${withIncome.length} complete month${withIncome.length === 1 ? '' : 's'}${rate < 0 ? ' (spending was above income)' : ''}. Full marks at ${pct(TARGETS.savingsRate)} or more.`,
      rate < TARGETS.savingsRate ? `Saving ${inr(Math.max(0, TARGETS.savingsRate * avgIncome - Math.max(0, net / withIncome.length)))} more a month would reach ${pct(TARGETS.savingsRate)}.` : null);
  } else add('savings', 'Savings rate', false, 0, null, 'No complete month with recorded income yet.');

  // 2. Investing rate (needs income to compare against)
  if (withIncome.length) {
    const rate = sipMonthly / avgIncome;
    add('investing', 'Regular investing', true, clamp01(rate / TARGETS.investingRate), rate,
      sipMonthly > 0 ? `Your active SIPs are ${inr(sipMonthly)} a month, ${pct(rate)} of your average income. Full marks at ${pct(TARGETS.investingRate)} or more.` : 'No active SIPs are recorded. Add them on the Investments page if you have any.',
      sipMonthly > 0 && rate < TARGETS.investingRate ? `A SIP of about ${inr(TARGETS.investingRate * avgIncome - sipMonthly)} more a month would reach ${pct(TARGETS.investingRate)}.` : null);
  } else add('investing', 'Regular investing', false, 0, null, 'Needs at least one complete month with recorded income.');

  // 3. Budget discipline (latest complete month)
  const rows = Array.isArray(budgetRows) ? budgetRows : [];
  if (rows.length) {
    const earned = rows.reduce((a, r) => a + (r.status === 'ok' ? 1 : r.status === 'watch' ? 0.5 : 0), 0);
    const over = rows.filter((r) => r.status === 'over').length;
    add('budgets', 'Budget discipline', true, earned / rows.length, earned / rows.length,
      `${rows.length - over} of ${rows.length} category budgets were kept last month${over ? `; ${over} went over` : ''}. Budgets close to their limit count half.`,
      over ? 'Open Budgets to see which categories went over.' : null);
  } else add('budgets', 'Budget discipline', false, 0, null, 'No category budgets were set for last month.', 'Set budgets on the Budgets page to include this.');

  // 4. Health insurance cover
  add('cover', 'Health insurance', true, hasHealthPolicy ? 1 : 0, hasHealthPolicy ? 1 : 0,
    hasHealthPolicy ? 'An active health policy is recorded.' : 'No active health policy is recorded. If you have one, add it on the Insurance page.',
    hasHealthPolicy ? null : 'Medical costs are a common cause of financial stress.');

  // 5. Spending stability (needs 3 complete months)
  if (months.length >= 3) {
    const exp = months.map((m) => m.expenses);
    const mean = exp.reduce((a, b) => a + b, 0) / exp.length;
    const sd = Math.sqrt(exp.reduce((a, b) => a + (b - mean) ** 2, 0) / exp.length);
    const cv = mean > 0 ? sd / mean : 0;
    const frac = clamp01((TARGETS.stabilityWorst - cv) / (TARGETS.stabilityWorst - TARGETS.stabilityBest));
    add('stability', 'Spending stability', true, frac, cv,
      `Monthly spending varied by about ${pct(cv)} around its average over the last ${months.length} months. Full marks at ${pct(TARGETS.stabilityBest)} or less.`);
  } else add('stability', 'Spending stability', false, 0, null, 'Needs 3 complete months of history.');

  const scoredList = components.filter((c) => c.scored);
  const base = { weights: WEIGHTS, components };
  if (!withIncome.length || scoredList.length < MIN_SCORED_COMPONENTS) {
    return { status: 'insufficient_data', score: null, band: null, scoredWeight: scoredList.reduce((a, c) => a + c.weight, 0), ...base,
      message: 'Not enough data for a score yet. Record income and spending for at least one complete month.' };
  }
  const weight = scoredList.reduce((a, c) => a + c.weight, 0);
  const earned = scoredList.reduce((a, c) => a + c.points, 0);
  const score = Math.round((earned / weight) * 100);
  return { status: 'ok', score, band: band(score), scoredWeight: weight, scoredCount: scoredList.length, ...base,
    message: scoredList.length < components.length ? `Based on ${scoredList.length} of ${components.length} factors. The others need more data.` : 'Based on all 5 factors.' };
}

module.exports = { computeScore, WEIGHTS, TARGETS, BANDS };
