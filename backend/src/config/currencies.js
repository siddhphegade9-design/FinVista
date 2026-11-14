'use strict';
/**
 * Supported currencies ("economies"). The user's currency decides how amounts are labelled and formatted and which
 * country-specific tools are open (Indian tax is INR only). Switching currency NEVER converts stored amounts.
 *
 * thresholdScale is the rough size of an everyday amount compared with INR. It only scales the detection thresholds
 * (for example "ignore anything under 500 rupees") so they make sense in other currencies. It is not an exchange rate.
 * Keep this table in step with frontend/js/core/format.js (a test compares them).
 */
const CURRENCIES = Object.freeze({
  INR: { name: 'Indian rupee', locale: 'en-IN', thresholdScale: 1, budgetRound: 100, digits: 2 },
  USD: { name: 'US dollar', locale: 'en-US', thresholdScale: 0.015, budgetRound: 5, digits: 2 },
  EUR: { name: 'Euro', locale: 'en-IE', thresholdScale: 0.015, budgetRound: 5, digits: 2 },
  GBP: { name: 'British pound', locale: 'en-GB', thresholdScale: 0.012, budgetRound: 5, digits: 2 },
  CAD: { name: 'Canadian dollar', locale: 'en-US', thresholdScale: 0.02, budgetRound: 5, digits: 2 },
  AUD: { name: 'Australian dollar', locale: 'en-US', thresholdScale: 0.02, budgetRound: 5, digits: 2 },
  JPY: { name: 'Japanese yen', locale: 'en-US', thresholdScale: 2, budgetRound: 500, digits: 0 },
});
const CODES = Object.freeze(Object.keys(CURRENCIES));
const DEFAULT_CURRENCY = 'INR';

const isSupported = (code) => typeof code === 'string' && Object.hasOwn(CURRENCIES, code);
const info = (code) => CURRENCIES[isSupported(code) ? code : DEFAULT_CURRENCY];

/** 1234.5, 'USD' -> "$1,234.5" (no forced decimals). */
function formatMoney(amount, code = DEFAULT_CURRENCY) {
  const c = info(code);
  const currency = isSupported(code) ? code : DEFAULT_CURRENCY;
  return new Intl.NumberFormat(c.locale, { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: c.digits }).format(amount);
}

module.exports = { CURRENCIES, CODES, DEFAULT_CURRENCY, isSupported, info, formatMoney };
