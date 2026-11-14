'use strict';
/** Validation for budget and simulator input. Validators return { value } or { errors }. */
const { isUuid, parseAmountPaise, paiseToString } = require('./transactions');

const MONTH_RE = /^(\d{4})-(\d{2})$/;
const result = (errors, value) => (Object.keys(errors).length ? { errors } : { value });

/** 'YYYY-MM' within 2000 .. two years ahead of `now`. */
function checkMonth(text, now = new Date()) {
  const m = typeof text === 'string' ? MONTH_RE.exec(text) : null;
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return 'Use the format YYYY-MM.';
  const limit = `${now.getUTCFullYear() + 2}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  if (Number(m[1]) < 2000 || text > limit) return 'Choose a month between 2000 and two years from now.';
  return null;
}

function validateBudgetInput(body = {}, now = new Date()) {
  const errors = {};
  const monthError = checkMonth(body.month, now);
  if (monthError) errors.month = monthError;
  const hasCat = body.categoryId !== undefined && body.categoryId !== null && body.categoryId !== '';
  if (hasCat && !isUuid(body.categoryId)) errors.categoryId = 'Choose a category.';
  const paise = parseAmountPaise(body.limit);
  if (paise === null) errors.limit = 'Enter a limit greater than 0 with at most 2 decimal places.';
  return result(errors, { month: body.month, categoryId: hasCat ? body.categoryId : null, limit: paise === null ? null : paiseToString(paise) });
}

function validateCopy(body = {}, now = new Date()) {
  const errors = {};
  for (const k of ['fromMonth', 'toMonth']) { const e = checkMonth(body[k], now); if (e) errors[k] = e; }
  if (!errors.fromMonth && !errors.toMonth && body.fromMonth === body.toMonth) errors.toMonth = 'Choose a different month to copy into.';
  return result(errors, { fromMonth: body.fromMonth, toMonth: body.toMonth });
}

/* ------------------------------------------------------------------ simulator */

/** A number with at most `decimals` decimals in [min, max], or null. Accepts numbers and numeric text. */
function parseNumber(raw, min, max, decimals = 2) {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const text = String(raw).replace(/[₹$€£¥,%\s]/g, '');
  if (!new RegExp(`^-?\\d{1,12}(\\.\\d{1,${decimals}})?$`).test(text)) return null;
  const n = Number(text);
  return n >= min && n <= max ? n : null;
}
/** Money that may be 0, as paise, or undefined when blank, or null when invalid. */
function parseMoney(raw) {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (String(raw).replace(/[₹$€£¥,\s]/g, '') === '0') return 0;
  return parseAmountPaise(raw);
}

function validateSimulation(body = {}) {
  const errors = {};
  let months = 12;
  if (body.months !== undefined && body.months !== '') {
    months = Number(body.months);
    if (!Number.isInteger(months) || months < 1 || months > 60) errors.months = 'Choose 1 to 60 months.';
  }
  const starting = parseMoney(body.startingSavings);
  if (starting === null) errors.startingSavings = 'Enter an amount, or leave blank.';
  const ret = body.returnPercent === undefined || body.returnPercent === '' ? 0 : parseNumber(body.returnPercent, 0, 30);
  if (ret === null) errors.returnPercent = 'Enter a yearly return from 0 to 30 percent, or leave blank.';

  let incomeChange = null;
  if (body.incomeChange && body.incomeChange.value !== undefined && body.incomeChange.value !== '') {
    const mode = body.incomeChange.mode;
    if (mode !== 'percent' && mode !== 'amount') errors.incomeChange = 'Choose percent or amount.';
    else {
      const value = mode === 'percent' ? parseNumber(body.incomeChange.value, -100, 1000) : parseNumber(body.incomeChange.value, -100_000_000, 100_000_000);
      if (value === null || value === undefined) errors.incomeChange = mode === 'percent' ? 'Enter a percentage from -100 to 1000.' : 'Enter an amount (negative for a drop).';
      else incomeChange = { mode, value };
    }
  }
  const spendingChange = body.spendingChangePercent === undefined || body.spendingChangePercent === '' ? 0 : parseNumber(body.spendingChangePercent, -100, 500);
  if (spendingChange === null) errors.spendingChangePercent = 'Enter a percentage from -100 to 500.';

  const cuts = [];
  if (body.categoryCuts !== undefined) {
    if (!Array.isArray(body.categoryCuts) || body.categoryCuts.length > 20) errors.categoryCuts = 'Provide up to 20 category cuts.';
    else {
      const seen = new Set();
      for (const c of body.categoryCuts) {
        const percent = parseNumber(c?.percent, 0, 100);
        const category = typeof c?.category === 'string' ? c.category.trim() : '';
        if (!category || category.length > 80 || percent === null || percent === undefined) { errors.categoryCuts = 'Each cut needs a category and a percentage from 0 to 100.'; break; }
        if (seen.has(category)) { errors.categoryCuts = 'Each category can be cut once.'; break; }
        seen.add(category);
        if (percent > 0) cuts.push({ category, percent });
      }
    }
  }

  let oneOff = null;
  if (body.oneOff && (body.oneOff.amount !== undefined && body.oneOff.amount !== '')) {
    const p = parseAmountPaise(body.oneOff.amount);
    const at = Number(body.oneOff.atMonth);
    if (p === null) errors.oneOffAmount = 'Enter an amount greater than 0.';
    else if (!Number.isInteger(at) || at < 1 || at > months) errors.oneOffMonth = `Choose a month from 1 to ${months}.`;
    else oneOff = { amount: paiseToString(p), atMonth: at };
  }
  let goalAmount = null;
  if (body.goalAmount !== undefined && body.goalAmount !== '') {
    const g = parseAmountPaise(body.goalAmount);
    if (g === null) errors.goalAmount = 'Enter a goal greater than 0, or leave blank.'; else goalAmount = paiseToString(g);
  }
  const bi = parseMoney(body.baselineIncome);
  const be = parseMoney(body.baselineExpenses);
  if (bi === null) errors.baselineIncome = 'Enter a monthly income, or leave blank.';
  if (be === null) errors.baselineExpenses = 'Enter monthly spending, or leave blank.';
  if ((bi === undefined) !== (be === undefined)) errors.baselineIncome = errors.baselineIncome || 'Enter both monthly income and monthly spending, or neither.';
  if (bi !== undefined && be !== undefined && cuts.length) errors.categoryCuts = 'Category cuts need your recorded history. Use the overall spending change with a manual baseline.';

  return result(errors, {
    months, startingSavings: paiseToString(starting || 0), returnPercent: ret, incomeChange, spendingChangePercent: spendingChange, categoryCuts: cuts, oneOff, goalAmount,
    manualBaseline: bi === undefined || be === undefined ? null : { incomePaise: bi, expensesPaise: be },
  });
}

module.exports = { checkMonth, validateBudgetInput, validateCopy, validateSimulation, parseNumber };
