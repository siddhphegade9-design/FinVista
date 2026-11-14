/**
 * Formatting helpers. Money follows the user's currency (default INR with lakh/crore grouping); dates use en-IN.
 * Pure functions with no DOM access so they are unit-testable in Node.
 */

/**
 * Supported currencies. Keep in step with backend/src/config/currencies.js (a test compares them).
 * digits: decimal places shown for exact amounts. Changing currency NEVER converts stored amounts.
 */
export const CURRENCIES = Object.freeze({
  INR: { name: 'Indian rupee', locale: 'en-IN', digits: 2 },
  USD: { name: 'US dollar', locale: 'en-US', digits: 2 },
  EUR: { name: 'Euro', locale: 'en-IE', digits: 2 },
  GBP: { name: 'British pound', locale: 'en-GB', digits: 2 },
  CAD: { name: 'Canadian dollar', locale: 'en-US', digits: 2 },
  AUD: { name: 'Australian dollar', locale: 'en-US', digits: 2 },
  JPY: { name: 'Japanese yen', locale: 'en-US', digits: 0 },
});
export const CURRENCY_CODES = Object.freeze(Object.keys(CURRENCIES));

function build(code) {
  const c = CURRENCIES[code];
  const base = { style: 'currency', currency: code };
  const full = new Intl.NumberFormat(c.locale, { ...base, minimumFractionDigits: c.digits, maximumFractionDigits: c.digits });
  return {
    code,
    full,
    whole: new Intl.NumberFormat(c.locale, { ...base, maximumFractionDigits: 0 }),
    compact: new Intl.NumberFormat(c.locale, { notation: 'compact', maximumFractionDigits: 1 }),
    symbol: full.formatToParts(0).find((p) => p.type === 'currency').value,
  };
}

let active = build('INR');

/** Sets the currency used by every formatter on the page (called once the signed-in user is known). Unknown codes are ignored. */
export function setCurrency(code) {
  if (Object.hasOwn(CURRENCIES, code) && code !== active.code) active = build(code);
}
export const getCurrency = () => active.code;
/** "₹", "$", "CA$", ... for labels like "Amount (₹)". */
export const currencySymbol = () => active.symbol;
/** Swaps the rupee sign in a label written for INR for the active currency's symbol. */
export const localizeLabel = (text) => String(text).replaceAll('₹', active.symbol);

/** 123456.5 -> "₹1,23,456.50" (INR) or "$123,456.50" (USD) */
export function formatCurrency(amount, { whole = false } = {}) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '—';
  return (whole ? active.whole : active.full).format(n);
}

/** 1250000 -> "12.5L" (INR) or "1.3M" (others): compact number for chart axes. */
export function formatCompact(value) {
  const n = Number(value);
  return Number.isFinite(n) ? active.compact.format(n) : '—';
}

/** 0.2534 -> "25.3%" (input is a ratio, not already a percentage). */
export function formatPercent(ratio, digits = 1) {
  const n = Number(ratio);
  return Number.isFinite(n) ? `${(n * 100).toFixed(digits)}%` : '—';
}

/** "2026-11-14" or Date -> "14 Nov 2026". Date-only strings are not shifted by timezone. */
export function formatDate(value) {
  let date = value;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map(Number);
    date = new Date(y, m - 1, d);
  } else if (!(value instanceof Date)) {
    date = new Date(value);
  }
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Compact date without the year, e.g. "14 Nov" (for dense lists where the month/year is shown elsewhere). */
export function formatDateShort(value) {
  const full = formatDate(value);
  return full === '—' ? full : full.replace(/\s\d{4}$/, '');
}

/**
 * Parses user-typed money ("1,234.5", "₹ 500") into a number rounded to 2 dp.
 * Returns null when the input is not a valid non-negative amount.
 */
export function parseAmount(input) {
  const cleaned = String(input ?? '').replace(/[₹$€£¥,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100) / 100;
}
