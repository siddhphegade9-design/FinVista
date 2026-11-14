'use strict';
const db = require('../db/pool');
const { RULES, CITY_CHOICES } = require('../tax/rules');
const { compute } = require('../tax/engine');
const sipMath = require('../investments/sip');
const { annualPremiumPaise } = require('../investments/insurance');
const investments = require('./investments');

const rules = (year) => RULES[year];

function rulesSummary() {
  return Object.values(RULES).map((r) => ({
    id: r.id, label: r.label, startDate: r.startDate, endDate: r.endDate, act: r.act, verifiedOn: r.verifiedOn,
    limits: r.oldRegime.limits, newRegime: { standardDeduction: r.newRegime.standardDeduction, rebateUpTo: r.newRegime.rebate.maxIncome },
    oldRegime: { standardDeduction: r.oldRegime.standardDeduction },
  }));
}

async function getProfile(userId, year) {
  const { rows } = await db.query('SELECT inputs, updated_at FROM tax_profiles WHERE user_id = $1 AND tax_year = $2', [userId, year]);
  return rows[0] ? { inputs: rows[0].inputs, updatedAt: rows[0].updated_at } : null;
}

async function saveProfile(userId, year, inputs) {
  const { rows } = await db.query(
    `INSERT INTO tax_profiles (user_id, tax_year, inputs) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, tax_year) DO UPDATE SET inputs = EXCLUDED.inputs RETURNING updated_at`,
    [userId, year, JSON.stringify(inputs)]);
  return { inputs, updatedAt: rows[0].updated_at };
}

const dayBefore = (iso) => new Date(Date.parse(`${iso}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);

/**
 * Figures taken from the user's own SIP and insurance records for the tax year. These are suggestions the user can
 * accept or edit; they are scheduled amounts from records the user entered, not proof of payment.
 */
async function suggestions(userId, year) {
  const r = rules(year);
  const [sips, { policies }] = await Promise.all([investments.activeSipModels(userId), investments.listPolicies(userId)]);
  const sum = (types) => sips.filter((m) => types.includes(m.instrumentType)).reduce((a, m) => {
    const invested = sipMath.positionAt(m, r.endDate).investedPaise - sipMath.positionAt(m, dayBefore(r.startDate)).investedPaise;
    return a + invested;
  }, 0) / 100;
  const healthPaise = policies.filter((p) => p.isActive && p.policyType === 'health').reduce((a, p) => a + Math.round(p.annualPremium * 100), 0);
  const items = [];
  const c80 = sum(['elss', 'ppf']);
  if (c80 > 0) items.push({ field: 'section80C', amount: c80, source: 'Your ELSS and PPF SIPs scheduled in this tax year (other 80C items such as EPF and life insurance are not included).' });
  const nps = sum(['nps']);
  if (nps > 0) items.push({ field: 'section80CCD1B', amount: nps, source: 'Your NPS SIPs scheduled in this tax year.' });
  if (healthPaise > 0) items.push({ field: 'section80DSelf', amount: healthPaise / 100, source: 'Annual premium of your active health policies. Check whether a policy covers you or your parents.' });
  return { year, items };
}

function calculate(year, inputs) { return compute(inputs, rules(year)); }

module.exports = { rulesSummary, getProfile, saveProfile, suggestions, calculate, CITY_CHOICES };
