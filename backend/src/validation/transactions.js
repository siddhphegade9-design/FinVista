'use strict';
/**
 * Input validation for transaction endpoints. Validators return { value } or { errors }.
 * Money is parsed from text into integer paise (never floats), then written to NUMERIC(12,2)
 * as an exact "123.45" string. Dates are real calendar dates in YYYY-MM-DD form.
 */
const TYPES = ['income', 'expense'];
const SORTS = {
  date_desc: 't.occurred_on DESC, t.created_at DESC, t.id DESC',
  date_asc: 't.occurred_on ASC, t.created_at ASC, t.id ASC',
  amount_desc: 't.amount DESC, t.occurred_on DESC, t.id DESC',
  amount_asc: 't.amount ASC, t.occurred_on DESC, t.id DESC',
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AMOUNT_RE = /^\d{1,10}(\.\d{1,2})?$/; // NUMERIC(12,2) holds up to 9,999,999,999.99
const MIN_YEAR = 1990;
const MAX_IMPORT_ROWS = 500;
const MAX_PAGE_SIZE = 100;

const isString = (v) => typeof v === 'string';
const isUuid = (v) => isString(v) && UUID_RE.test(v);
const result = (errors, value) => (Object.keys(errors).length ? { errors } : { value });

/** "1,234.5", "₹ 500", 12.5 -> integer paise, or null when invalid or zero. Never rounds silently. */
function parseAmountPaise(raw) {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const text = String(raw).replace(/[₹$€£¥,\s]/g, '');
  if (!AMOUNT_RE.test(text)) return null;
  const [whole, frac = ''] = text.split('.');
  const paise = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return paise > 0 ? paise : null;
}

/** Integer paise -> exact decimal string for NUMERIC, e.g. 12550 -> "125.50". */
const paiseToString = (paise) => `${Math.floor(paise / 100)}.${String(paise % 100).padStart(2, '0')}`;

/** True for a real calendar date such as 2026-02-28 (rejects 2026-02-30). */
function isRealDate(y, m, d) {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

const isoOf = (y, m, d) => `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** Latest date allowed: today (UTC) plus one day of slack for timezones ahead of UTC (such as IST). */
function latestAllowedDate(now = new Date()) {
  const t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return isoOf(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Checks a YYYY-MM-DD string. Returns an error message or null. */
function checkIsoDate(value, now) {
  const m = isString(value) ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  if (!m || !isRealDate(Number(m[1]), Number(m[2]), Number(m[3]))) return 'Enter a valid date.';
  if (Number(m[1]) < MIN_YEAR) return `Dates before ${MIN_YEAR} are not supported.`;
  if (value > latestAllowedDate(now)) return 'Transactions record what has already happened, so the date cannot be in the future.';
  return null;
}

/** Cleans a description: trims, collapses whitespace, drops control characters. */
const cleanDescription = (raw) => (isString(raw) ? raw.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim() : '');

function validateTransactionInput(body = {}, now = new Date()) {
  const errors = {};
  if (!TYPES.includes(body.type)) errors.type = 'Choose income or expense.';
  const paise = parseAmountPaise(body.amount);
  if (paise === null) errors.amount = 'Enter an amount greater than 0 with at most 2 decimal places (up to 9,999,999,999.99).';
  const description = cleanDescription(body.description);
  if (description.length < 1 || description.length > 200) errors.description = 'Enter a description (1 to 200 characters).';
  const dateError = checkIsoDate(body.date, now);
  if (dateError) errors.date = dateError;
  // categoryId is optional: when it is missing the categorisation rules choose one (see services/transactions.js).
  const hasCategory = body.categoryId !== undefined && body.categoryId !== null && body.categoryId !== '';
  if (hasCategory && !isUuid(body.categoryId)) errors.categoryId = 'Choose a category.';
  return result(errors, { type: body.type, amount: paise === null ? null : paiseToString(paise), description, date: body.date, categoryId: hasCategory ? body.categoryId : null });
}

/** Query-string filters for listing and export. */
function validateFilters(query = {}, { paged = true } = {}) {
  const errors = {};
  const single = (key) => {
    const v = query[key];
    if (v === undefined || v === '') return undefined;
    if (!isString(v)) { errors[key] = 'Invalid value.'; return undefined; }
    return v.trim();
  };
  const date = (key) => {
    const v = single(key);
    if (v === undefined) return undefined;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || !isRealDate(...v.split('-').map(Number))) { errors[key] = 'Use the format YYYY-MM-DD.'; return undefined; }
    return v;
  };
  const amount = (key) => {
    const v = single(key);
    if (v === undefined) return undefined;
    const paise = parseAmountPaise(v);
    if (paise === null) { errors[key] = 'Enter a valid amount.'; return undefined; }
    return paise;
  };
  const from = date('from');
  const to = date('to');
  if (from && to && from > to) errors.to = 'The end date must not be before the start date.';
  const type = single('type');
  if (type !== undefined && !TYPES.includes(type)) errors.type = 'Type must be income or expense.';
  const categoryId = single('categoryId');
  if (categoryId !== undefined && !isUuid(categoryId)) errors.categoryId = 'Invalid category.';
  const q = single('q');
  if (q !== undefined && q.length > 100) errors.q = 'Search text is too long (100 characters max).';
  const minPaise = amount('minAmount');
  const maxPaise = amount('maxAmount');
  if (minPaise !== undefined && maxPaise !== undefined && minPaise > maxPaise) errors.maxAmount = 'The maximum must not be below the minimum.';
  const sort = single('sort') ?? 'date_desc';
  if (!SORTS[sort]) errors.sort = 'Unknown sort order.';
  let page = 1;
  let pageSize = 20;
  if (paged) {
    const rawPage = single('page');
    if (rawPage !== undefined) { page = Number(rawPage); if (!Number.isInteger(page) || page < 1 || page > 100000) errors.page = 'Invalid page.'; }
    const rawSize = single('pageSize');
    if (rawSize !== undefined) { pageSize = Number(rawSize); if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) errors.pageSize = `Page size must be 1 to ${MAX_PAGE_SIZE}.`; }
  }
  return result(errors, { from, to, type, categoryId, q, minPaise, maxPaise, sort, page, pageSize });
}

/* ------------------------------------------------------------- CSV import */

const TYPE_ALIASES = { income: 'income', credit: 'income', cr: 'income', expense: 'expense', debit: 'expense', dr: 'expense' };

/** Accepts YYYY-MM-DD, or DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY (Indian day-first order). Returns ISO or null. */
function parseImportDate(raw) {
  const text = isString(raw) ? raw.trim() : '';
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  let y; let mo; let d;
  if (m) [, y, mo, d] = m.map(Number);
  else if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text))) [, d, mo, y] = m.map(Number);
  else return null;
  return isRealDate(y, mo, d) ? isoOf(y, mo, d) : null;
}

/**
 * Normalises one imported row { date, description, amount, type?, category? }.
 * Returns { value } or { error: 'message' }. When `type` is blank the sign of the amount decides
 * (negative = expense, positive = income), the convention most bank statement exports follow.
 */
function normalizeImportRow(row, now = new Date()) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return { error: 'Row is not valid.' };
  const date = parseImportDate(row.date);
  if (!date) return { error: 'Date must look like 2026-11-14 or 14/11/2026.' };
  const dateError = checkIsoDate(date, now);
  if (dateError) return { error: dateError };

  let amountText = isString(row.amount) || typeof row.amount === 'number' ? String(row.amount).trim() : '';
  let negative = false;
  if (/^\(.*\)$/.test(amountText)) { negative = true; amountText = amountText.slice(1, -1); } // accounting style (500.00)
  if (amountText.startsWith('-')) { negative = true; amountText = amountText.slice(1); } else if (amountText.startsWith('+')) amountText = amountText.slice(1);
  const paise = parseAmountPaise(amountText);
  if (paise === null) return { error: 'Amount must be a number greater than 0 with at most 2 decimals.' };

  const rawType = isString(row.type) ? row.type.trim().toLowerCase() : '';
  let type;
  if (rawType) {
    type = TYPE_ALIASES[rawType];
    if (!type) return { error: 'Type must be income or expense (credit/debit also work).' };
  } else type = negative ? 'expense' : 'income';

  // Undo the apostrophe that CSV export adds in front of =, +, - or @ (spreadsheet formula guard).
  const description = cleanDescription(row.description).replace(/^'(?=[=+\-@])/, '');
  if (description.length < 1 || description.length > 200) return { error: 'Description must be 1 to 200 characters.' };

  const categoryName = isString(row.category) ? cleanDescription(row.category).slice(0, 60) : '';
  return { value: { date, type, amount: paiseToString(paise), description, categoryName } };
}

function validateImportBody(body = {}) {
  if (!Array.isArray(body.rows) || body.rows.length === 0) return { errors: { rows: 'Provide at least one row to import.' } };
  if (body.rows.length > MAX_IMPORT_ROWS) return { errors: { rows: `Import at most ${MAX_IMPORT_ROWS} rows at a time.` } };
  return { value: { rows: body.rows, skipDuplicates: body.skipDuplicates !== false } };
}

module.exports = {
  TYPES, SORTS, MAX_IMPORT_ROWS, MAX_PAGE_SIZE,
  isUuid, parseAmountPaise, paiseToString, latestAllowedDate, checkIsoDate, cleanDescription,
  validateTransactionInput, validateFilters, parseImportDate, normalizeImportRow, validateImportBody,
};
