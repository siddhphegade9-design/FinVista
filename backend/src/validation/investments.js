'use strict';
/** Validation for SIP and insurance records. Validators return { value } or { errors }. */
const { parseAmountPaise, paiseToString, cleanDescription } = require('./transactions');

const INSTRUMENT_TYPES = ['mutual_fund', 'elss', 'ppf', 'nps', 'stock', 'other'];
const POLICY_TYPES = ['health', 'term_life', 'life', 'motor', 'home', 'travel', 'other'];
const FREQUENCIES = ['monthly', 'quarterly', 'half_yearly', 'yearly'];
const MIN_YEAR = 1990;
const MAX_FUTURE_START_DAYS = 366;
const MAX_PER_USER = 100;

const result = (errors, value) => (Object.keys(errors).length ? { errors } : { value });
const isoOf = (d) => d.toISOString().slice(0, 10);
const realDate = (text) => {
  const m = typeof text === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(text) : null;
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] && +m[1] >= MIN_YEAR;
};
const plusDays = (now, n) => isoOf(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + n)));
const minusDays = (now, n) => plusDays(now, -n);

/** A percentage with at most 2 decimals in [0, max]. Returns a number or null. */
function parsePercent(raw, max) {
  if (raw === undefined || raw === null || raw === '') return null;
  const text = String(raw).replace(/[%\s]/g, '');
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(text)) return null;
  const n = Number(text);
  return n >= 0 && n <= max ? n : null;
}
/** Money that may be 0 (current value): paise or null. */
function parseOptionalAmountPaise(raw) {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (String(raw).replace(/[₹$€£¥,\s]/g, '') === '0') return 0;
  const p = parseAmountPaise(raw);
  return p === null ? null : p;
}
const cleanText = (raw, max) => { const t = cleanDescription(raw); return t.length > max ? null : t; };

function validateSip(body = {}, now = new Date()) {
  const errors = {};
  const name = cleanText(body.name, 80);
  if (!name) errors.name = 'Enter a name (1 to 80 characters), for example "Nifty 50 index fund".';
  if (!INSTRUMENT_TYPES.includes(body.instrumentType)) errors.instrumentType = 'Choose a type.';
  const paise = parseAmountPaise(body.monthlyAmount);
  if (paise === null) errors.monthlyAmount = 'Enter the monthly amount, greater than 0, with at most 2 decimals.';
  if (!realDate(body.startDate)) errors.startDate = 'Enter a valid start date.';
  else if (body.startDate > plusDays(now, MAX_FUTURE_START_DAYS)) errors.startDate = 'The start date cannot be more than a year ahead.';

  let durationMonths = null;
  if (body.durationMonths !== undefined && body.durationMonths !== null && body.durationMonths !== '') {
    const n = Number(body.durationMonths);
    if (!Number.isInteger(n) || n < 1 || n > 600) errors.durationMonths = 'Enter whole months from 1 to 600, or leave blank if there is no planned end.';
    else durationMonths = n;
  }
  const stepUp = body.stepUpPercent === undefined || body.stepUpPercent === '' || body.stepUpPercent === null ? 0 : parsePercent(body.stepUpPercent, 50);
  if (stepUp === null) errors.stepUpPercent = 'Enter a yearly step-up from 0 to 50 percent.';
  const ret = parsePercent(body.expectedReturnPercent, 30);
  if (ret === null) errors.expectedReturnPercent = 'Enter the yearly return you assume, from 0 to 30 percent. It is your assumption, not a promise.';

  let currentValue = null;
  let currentValueAsOf = null;
  const cv = parseOptionalAmountPaise(body.currentValue);
  if (cv === null) errors.currentValue = 'Enter an amount, or leave blank.';
  else if (cv !== undefined) {
    currentValue = paiseToString(cv);
    if (!realDate(body.currentValueAsOf)) errors.currentValueAsOf = 'Enter the date this value is from.';
    else if (body.currentValueAsOf > plusDays(now, 1)) errors.currentValueAsOf = 'That date is in the future.';
    else currentValueAsOf = body.currentValueAsOf;
  }
  const notes = body.notes === undefined || body.notes === null || body.notes === '' ? null : cleanText(body.notes, 200);
  if (body.notes && notes === null) errors.notes = 'Notes can be up to 200 characters.';
  if (body.isActive !== undefined && typeof body.isActive !== 'boolean') errors.isActive = 'Must be true or false.';

  return result(errors, {
    name, instrumentType: body.instrumentType, monthlyAmount: paise === null ? null : paiseToString(paise), startDate: body.startDate,
    durationMonths, stepUpPercent: stepUp, expectedReturnPercent: ret, currentValue, currentValueAsOf, isActive: body.isActive !== false, notes,
  });
}

function validateCalculator(body = {}) {
  const errors = {};
  const paise = parseAmountPaise(body.monthlyAmount);
  if (paise === null) errors.monthlyAmount = 'Enter the monthly amount, greater than 0.';
  const years = Number(body.years);
  if (!Number.isFinite(years) || years < 1 || years > 50 || !Number.isInteger(years * 12)) errors.years = 'Enter 1 to 50 years (months allowed, e.g. 7.5).';
  const stepUp = body.stepUpPercent === undefined || body.stepUpPercent === '' ? 0 : parsePercent(body.stepUpPercent, 50);
  if (stepUp === null) errors.stepUpPercent = 'Enter a yearly step-up from 0 to 50 percent.';
  const ret = parsePercent(body.expectedReturnPercent, 30);
  if (ret === null) errors.expectedReturnPercent = 'Enter a yearly return from 0 to 30 percent.';
  return result(errors, { monthlyPaise: paise, years, stepUpPercent: stepUp, expectedReturnPercent: ret });
}

function validatePolicy(body = {}, now = new Date()) {
  const errors = {};
  const name = cleanText(body.name, 80);
  if (!name) errors.name = 'Enter a name (1 to 80 characters), for example "Family floater health plan".';
  const insurer = body.insurer === undefined || body.insurer === null || body.insurer === '' ? null : cleanText(body.insurer, 80);
  if (body.insurer && insurer === null) errors.insurer = 'Insurer can be up to 80 characters.';
  if (!POLICY_TYPES.includes(body.policyType)) errors.policyType = 'Choose a type.';
  const cover = parseAmountPaise(body.sumAssured);
  if (cover === null) errors.sumAssured = 'Enter the cover (sum assured), greater than 0.';
  const premium = parseAmountPaise(body.premium);
  if (premium === null) errors.premium = 'Enter the premium, greater than 0.';
  if (!FREQUENCIES.includes(body.premiumFrequency)) errors.premiumFrequency = 'Choose how often the premium is paid.';
  if (!realDate(body.nextDueDate)) errors.nextDueDate = 'Enter the next premium due date.';
  else if (body.nextDueDate < minusDays(now, 365 * 2) || body.nextDueDate > plusDays(now, 366 * 2)) errors.nextDueDate = 'That date looks wrong. Use the next due date, within the last 2 or next 2 years.';
  const notes = body.notes === undefined || body.notes === null || body.notes === '' ? null : cleanText(body.notes, 200);
  if (body.notes && notes === null) errors.notes = 'Notes can be up to 200 characters.';
  if (body.isActive !== undefined && typeof body.isActive !== 'boolean') errors.isActive = 'Must be true or false.';
  return result(errors, {
    name, insurer, policyType: body.policyType, sumAssured: cover === null ? null : paiseToString(cover), premium: premium === null ? null : paiseToString(premium),
    premiumFrequency: body.premiumFrequency, nextDueDate: body.nextDueDate, isActive: body.isActive !== false, notes,
  });
}

module.exports = { INSTRUMENT_TYPES, POLICY_TYPES, FREQUENCIES, MAX_PER_USER, validateSip, validateCalculator, validatePolicy, parsePercent };
