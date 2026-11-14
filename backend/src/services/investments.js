'use strict';
/** SIP and insurance records, always scoped to the owning user. Projections come from investments/sip.js. */
const db = require('../db/pool');
const { badRequest } = require('../utils/httpError');
const { paiseToString } = require('../validation/transactions');
const { MAX_PER_USER } = require('../validation/investments');
const sipMath = require('../investments/sip');
const insMath = require('../investments/insurance');

const rupees = (paise) => paise / 100;
const toPaise = (v) => Math.round(Number(v) * 100);
const todayIso = (now) => now.toISOString().slice(0, 10);
const HORIZON_YEARS = 10;

const SIP_COLS = `id, name, instrument_type, monthly_amount::text AS monthly_amount, to_char(start_date, 'YYYY-MM-DD') AS start_date, duration_months,
  step_up_percent::float8 AS step_up_percent, expected_return_percent::float8 AS expected_return_percent, current_value::text AS current_value,
  to_char(current_value_as_of, 'YYYY-MM-DD') AS current_value_as_of, is_active, notes`;

function sipModel(row) {
  return {
    id: row.id, name: row.name, instrumentType: row.instrument_type, monthlyPaise: toPaise(row.monthly_amount), startDate: row.start_date,
    durationMonths: row.duration_months, stepUpPercent: row.step_up_percent, expectedReturnPercent: row.expected_return_percent,
    currentValue: row.current_value === null ? null : Number(row.current_value), currentValueAsOf: row.current_value_as_of, isActive: row.is_active, notes: row.notes,
  };
}

function sipView(m, today) {
  const d = sipMath.describe(m, today, HORIZON_YEARS);
  return {
    id: m.id, name: m.name, instrumentType: m.instrumentType, monthlyAmount: rupees(m.monthlyPaise), startDate: m.startDate, durationMonths: m.durationMonths,
    endDate: sipMath.endDate(m), stepUpPercent: m.stepUpPercent, expectedReturnPercent: m.expectedReturnPercent,
    currentValue: m.currentValue, currentValueAsOf: m.currentValueAsOf, isActive: m.isActive, notes: m.notes,
    instalmentsPaid: d.instalmentsPaid, finished: d.finished,
    nextInstalment: rupees(d.nextInstalmentPaise),
    scheduledInvested: rupees(d.scheduledInvestedPaise),
    modelledValue: rupees(d.modelledValuePaise),
    projection: { date: d.end.date, ongoing: d.end.ongoing, instalments: d.end.instalments, invested: rupees(d.end.investedPaise), value: rupees(d.end.valuePaise), gain: rupees(d.end.gainPaise) },
  };
}

const SIP_NOTE = 'Scheduled amounts assume every instalment was paid. Modelled and projected values use the yearly return you entered, compounded monthly. They are estimates, not statements, and real returns vary and can be negative. If you entered a current value, that is your own figure from your statement.';

async function listSips(userId, now = new Date()) {
  const { rows } = await db.query(`SELECT ${SIP_COLS} FROM sips WHERE user_id = $1 ORDER BY is_active DESC, start_date DESC, id`, [userId]);
  const today = todayIso(now);
  const models = rows.map(sipModel);
  const sips = models.map((m) => sipView(m, today));
  const active = models.filter((m) => m.isActive);
  const monthly = active.reduce((a, m) => a + sipMath.currentInstalmentPaise(m, today), 0);
  const growth = sipMath.growthSeries(models, today, HORIZON_YEARS).map((g) => ({ year: g.year, date: g.date, invested: rupees(g.investedPaise), value: rupees(g.valuePaise) }));
  return {
    sips,
    summary: {
      count: sips.length, activeCount: active.length,
      monthlyCommitment: rupees(monthly),
      scheduledInvested: rupees(models.reduce((a, m) => a + sipMath.positionAt(m, today).investedPaise, 0)),
      recordedValue: sips.filter((s) => s.currentValue !== null).reduce((a, s) => a + s.currentValue, 0),
      recordedValueCount: sips.filter((s) => s.currentValue !== null).length,
    },
    growth, horizonYears: HORIZON_YEARS, note: SIP_NOTE,
  };
}

async function countRows(table, userId) {
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM ${table} WHERE user_id = $1`, [userId]);
  return rows[0].n;
}
const limitError = (what) => badRequest(`You can keep up to ${MAX_PER_USER} ${what}. Delete one to add another.`);

async function getSip(userId, id, now = new Date()) {
  const { rows } = await db.query(`SELECT ${SIP_COLS} FROM sips WHERE id = $1 AND user_id = $2`, [id, userId]);
  return rows[0] ? sipView(sipModel(rows[0]), todayIso(now)) : null;
}
const sipParams = (v) => [v.name, v.instrumentType, v.monthlyAmount, v.startDate, v.durationMonths, v.stepUpPercent, v.expectedReturnPercent, v.currentValue, v.currentValueAsOf, v.isActive, v.notes];

async function createSip(userId, v) {
  if (await countRows('sips', userId) >= MAX_PER_USER) throw limitError('investments');
  const { rows } = await db.query(
    `INSERT INTO sips (user_id, name, instrument_type, monthly_amount, start_date, duration_months, step_up_percent, expected_return_percent, current_value, current_value_as_of, is_active, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`, [userId, ...sipParams(v)]);
  return getSip(userId, rows[0].id);
}
async function updateSip(userId, id, v) {
  const { rowCount } = await db.query(
    `UPDATE sips SET name = $3, instrument_type = $4, monthly_amount = $5, start_date = $6, duration_months = $7, step_up_percent = $8,
       expected_return_percent = $9, current_value = $10, current_value_as_of = $11, is_active = $12, notes = $13 WHERE id = $2 AND user_id = $1`, [userId, id, ...sipParams(v)]);
  return rowCount ? getSip(userId, id) : null;
}
async function removeSip(userId, id) {
  return (await db.query('DELETE FROM sips WHERE id = $1 AND user_id = $2', [id, userId])).rowCount > 0;
}

function calculate(v, now = new Date()) {
  const r = sipMath.calculate(v, todayIso(now));
  return { months: r.months, invested: rupees(r.investedPaise), value: rupees(r.valuePaise), gain: rupees(r.gainPaise), note: SIP_NOTE };
}

/* ------------------------------------------------------------------ insurance */

const POL_COLS = `id, name, insurer, policy_type, sum_assured::text AS sum_assured, premium::text AS premium, premium_frequency,
  to_char(next_due_date, 'YYYY-MM-DD') AS next_due_date, is_active, notes`;

function policyView(row, today) {
  const premium = toPaise(row.premium);
  const annual = insMath.annualPremiumPaise(premium, row.premium_frequency);
  const policy = { isActive: row.is_active, nextDueDate: row.next_due_date };
  return {
    id: row.id, name: row.name, insurer: row.insurer, policyType: row.policy_type, sumAssured: Number(row.sum_assured), premium: rupees(premium), premiumFrequency: row.premium_frequency,
    nextDueDate: row.next_due_date, isActive: row.is_active, notes: row.notes,
    annualPremium: rupees(annual), monthlyEquivalent: Math.round(annual / 12) / 100,
    daysUntilDue: insMath.daysUntil(row.next_due_date, today), renewalStatus: insMath.renewalStatus(policy, today),
  };
}

async function listPolicies(userId, now = new Date()) {
  const { rows } = await db.query(`SELECT ${POL_COLS} FROM insurance_policies WHERE user_id = $1 ORDER BY is_active DESC, next_due_date, id`, [userId]);
  const today = todayIso(now);
  const policies = rows.map((r) => policyView(r, today));
  const active = policies.filter((p) => p.isActive);
  const coverByType = {};
  for (const p of active) coverByType[p.policyType] = (coverByType[p.policyType] || 0) + p.sumAssured;
  return {
    policies,
    summary: {
      count: policies.length, activeCount: active.length,
      annualPremium: active.reduce((a, p) => a + toPaise(p.annualPremium), 0) / 100,
      monthlyEquivalent: Math.round(active.reduce((a, p) => a + toPaise(p.annualPremium), 0) / 12) / 100,
      coverByType,
      dueSoon: active.filter((p) => p.renewalStatus === 'due_soon').length,
      overdue: active.filter((p) => p.renewalStatus === 'overdue').length,
    },
    note: 'These are the policies you entered. FinVista does not check them with your insurer and does not say how much cover you need.',
  };
}
async function getPolicy(userId, id, now = new Date()) {
  const { rows } = await db.query(`SELECT ${POL_COLS} FROM insurance_policies WHERE id = $1 AND user_id = $2`, [id, userId]);
  return rows[0] ? policyView(rows[0], todayIso(now)) : null;
}
const polParams = (v) => [v.name, v.insurer, v.policyType, v.sumAssured, v.premium, v.premiumFrequency, v.nextDueDate, v.isActive, v.notes];
async function createPolicy(userId, v) {
  if (await countRows('insurance_policies', userId) >= MAX_PER_USER) throw limitError('policies');
  const { rows } = await db.query(
    `INSERT INTO insurance_policies (user_id, name, insurer, policy_type, sum_assured, premium, premium_frequency, next_due_date, is_active, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`, [userId, ...polParams(v)]);
  return getPolicy(userId, rows[0].id);
}
async function updatePolicy(userId, id, v) {
  const { rowCount } = await db.query(
    `UPDATE insurance_policies SET name = $3, insurer = $4, policy_type = $5, sum_assured = $6, premium = $7, premium_frequency = $8, next_due_date = $9, is_active = $10, notes = $11
      WHERE id = $2 AND user_id = $1`, [userId, id, ...polParams(v)]);
  return rowCount ? getPolicy(userId, id) : null;
}
async function removePolicy(userId, id) {
  return (await db.query('DELETE FROM insurance_policies WHERE id = $1 AND user_id = $2', [id, userId])).rowCount > 0;
}

/** Planned monthly outflows for the forecast page (kept separate: they are not part of the history-based projection). */
async function commitments(userId, now = new Date()) {
  const [sips, pols] = await Promise.all([listSips(userId, now), listPolicies(userId, now)]);
  return { sipMonthly: sips.summary.monthlyCommitment, insuranceMonthlyEquivalent: pols.summary.monthlyEquivalent, sipCount: sips.summary.activeCount, policyCount: pols.summary.activeCount };
}

/** Active SIP models for a user (used by the tax estimator to work out what is scheduled in a tax year). */
async function activeSipModels(userId) {
  const { rows } = await db.query(`SELECT ${SIP_COLS} FROM sips WHERE user_id = $1 AND is_active`, [userId]);
  return rows.map(sipModel);
}

module.exports = { activeSipModels, listSips, getSip, createSip, updateSip, removeSip, calculate, listPolicies, getPolicy, createPolicy, updatePolicy, removePolicy, commitments, paiseToString };
