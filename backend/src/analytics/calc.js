'use strict';
/**
 * Pure analytics helpers (no database, no clock unless passed in), so every figure is unit-testable.
 * Money is handled as integer paise internally and returned as numbers with two decimals.
 */
const DAY_MS = 86_400_000;
const MAX_RANGE_DAYS = 3660; // about 10 years
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const toPaise = (value) => Math.round(Number(value) * 100);
const fromPaise = (paise) => paise / 100;

const isoOf = (date) => date.toISOString().slice(0, 10);
const parseIso = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const isRealIso = (text) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return false;
  const d = parseIso(text);
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
};
const addDays = (iso, n) => isoOf(new Date(parseIso(iso).getTime() + n * DAY_MS));
const daysBetween = (from, to) => Math.round((parseIso(to) - parseIso(from)) / DAY_MS) + 1; // inclusive

/** 'YYYY-MM' keys for every calendar month touched by [from, to]. */
function monthKeysBetween(from, to) {
  const keys = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    keys.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return keys;
}

/** The equally long period immediately before [from, to]. */
function previousPeriod(from, to) {
  const length = daysBetween(from, to);
  const prevTo = addDays(from, -1);
  return { from: addDays(prevTo, -(length - 1)), to: prevTo };
}

/** Default range: the last 6 calendar months, up to and including today. */
function defaultRange(now = new Date()) {
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));
  return { from: isoOf(first), to: isoOf(now) };
}

/** Validates ?from&to. Returns { value: {from, to} } or { errors }. */
function parseRange(query = {}, now = new Date()) {
  const errors = {};
  const def = defaultRange(now);
  const get = (key) => {
    const v = query[key];
    if (v === undefined || v === '') return undefined;
    if (typeof v !== 'string' || !isRealIso(v)) { errors[key] = 'Use the format YYYY-MM-DD.'; return undefined; }
    return v;
  };
  const from = get('from');
  const to = get('to');
  const range = { from: from ?? def.from, to: to ?? def.to };
  if (Object.keys(errors).length === 0) {
    if (range.from > range.to) errors.to = 'The end date must not be before the start date.';
    else if (daysBetween(range.from, range.to) > MAX_RANGE_DAYS) errors.to = 'Choose a range of at most 10 years.';
    else if (range.from < '1990-01-01') errors.from = 'Dates before 1990 are not supported.';
  }
  return Object.keys(errors).length ? { errors } : { value: range };
}

/** Change from previous to current as a ratio (0.25 = +25%). null when there is nothing to compare against. */
function changeRatio(current, previous) {
  return previous > 0 ? (current - previous) / previous : null;
}

/** Zero-filled monthly series from rows [{ month, type, amount, count }]. */
function buildMonthly(rows, monthKeys) {
  const byMonth = new Map(monthKeys.map((k) => [k, { month: k, income: 0, expenses: 0, count: 0 }]));
  for (const r of rows) {
    const slot = byMonth.get(r.month);
    if (!slot) continue;
    slot[r.type === 'income' ? 'income' : 'expenses'] += toPaise(r.amount);
    slot.count += r.count;
  }
  return monthKeys.map((k) => {
    const s = byMonth.get(k);
    return { month: k, income: fromPaise(s.income), expenses: fromPaise(s.expenses), net: fromPaise(s.income - s.expenses), count: s.count };
  });
}

/** Totals and rates for a set of type rows [{ type, amount, count }]. */
function summarize(rows) {
  let income = 0; let expenses = 0; let count = 0;
  for (const r of rows) {
    if (r.type === 'income') income += toPaise(r.amount); else expenses += toPaise(r.amount);
    count += r.count;
  }
  const net = income - expenses;
  return { incomePaise: income, expensesPaise: expenses, income: fromPaise(income), expenses: fromPaise(expenses), net: fromPaise(net), savingsRate: income > 0 ? net / income : null, count };
}

/** Category totals with their share of the total, largest first. rows: [{ id, name, amount, count }] */
function buildCategories(rows) {
  const items = rows.map((r) => ({ categoryId: r.id, name: r.name, paise: toPaise(r.amount), count: r.count })).filter((r) => r.paise > 0);
  const total = items.reduce((s, r) => s + r.paise, 0);
  return items.sort((a, b) => b.paise - a.paise || a.name.localeCompare(b.name))
    .map((r) => ({ categoryId: r.categoryId, name: r.name, amount: fromPaise(r.paise), share: total ? r.paise / total : 0, count: r.count }));
}

/**
 * Monthly expense series for the biggest `topN` categories plus an "All other categories" remainder, so
 * the stacked chart always adds up to total monthly spending. rows: [{ month, id, name, amount }]
 */
function buildCategoryTrend(rows, monthKeys, topCategories, topN = 5) {
  const top = topCategories.slice(0, topN);
  const topIds = new Set(top.map((c) => c.categoryId));
  const cell = new Map(); // `${id}|${month}` -> paise
  const totals = new Map(monthKeys.map((k) => [k, 0]));
  for (const r of rows) {
    const p = toPaise(r.amount);
    if (totals.has(r.month)) totals.set(r.month, totals.get(r.month) + p);
    if (topIds.has(r.id)) cell.set(`${r.id}|${r.month}`, (cell.get(`${r.id}|${r.month}`) ?? 0) + p);
  }
  const series = top.map((c) => ({ name: c.name, categoryId: c.categoryId, values: monthKeys.map((k) => fromPaise(cell.get(`${c.categoryId}|${k}`) ?? 0)) }));
  const others = monthKeys.map((k) => {
    const inTop = top.reduce((s, c) => s + (cell.get(`${c.categoryId}|${k}`) ?? 0), 0);
    return fromPaise(totals.get(k) - inTop);
  });
  if (others.some((v) => v > 0)) series.push({ name: 'All other categories', categoryId: null, values: others });
  return { months: monthKeys, series };
}

/** Expense totals per weekday, Monday first. rows: [{ dow (0=Sunday), amount, count }] */
function buildWeekdays(rows) {
  const out = WEEKDAYS.map((name) => ({ name, expenses: 0, count: 0 }));
  for (const r of rows) {
    const i = (r.dow + 6) % 7; // Sunday(0) -> index 6, Monday(1) -> 0
    out[i].expenses += toPaise(r.amount);
    out[i].count += r.count;
  }
  return out.map((d) => ({ name: d.name, expenses: fromPaise(d.expenses), count: d.count }));
}

module.exports = {
  MAX_RANGE_DAYS, WEEKDAYS, toPaise, fromPaise, isoOf, addDays, daysBetween, monthKeysBetween, previousPeriod,
  defaultRange, parseRange, changeRatio, buildMonthly, summarize, buildCategories, buildCategoryTrend, buildWeekdays,
};
