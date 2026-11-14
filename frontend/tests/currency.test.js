import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { CURRENCIES, CURRENCY_CODES, setCurrency, getCurrency, currencySymbol, localizeLabel, formatCurrency, parseAmount } from '../js/core/format.js';

const require = createRequire(import.meta.url);
const backend = require('../../backend/src/config/currencies.js');

test.afterEach(() => setCurrency('INR'));

test('frontend and backend currency tables list the same codes and locales', () => {
  assert.deepEqual([...CURRENCY_CODES].sort(), [...backend.CODES].sort());
  for (const code of CURRENCY_CODES) {
    assert.equal(CURRENCIES[code].locale, backend.CURRENCIES[code].locale, `${code} locale`);
    assert.equal(CURRENCIES[code].digits, backend.CURRENCIES[code].digits, `${code} digits`);
    assert.equal(CURRENCIES[code].name, backend.CURRENCIES[code].name, `${code} name`);
  }
});

test('INR is the default currency', () => {
  assert.equal(getCurrency(), 'INR');
  assert.equal(currencySymbol(), '₹');
});

test('formatCurrency follows the active currency', () => {
  setCurrency('USD'); assert.equal(formatCurrency(1234.5), '$1,234.50');
  setCurrency('EUR'); assert.match(formatCurrency(1234.5).replace(/\s/g, ' '), /€1,234\.50/);
  setCurrency('GBP'); assert.equal(formatCurrency(1234.5), '£1,234.50');
  setCurrency('JPY'); assert.equal(formatCurrency(1234), '¥1,234');
  setCurrency('CAD'); assert.match(formatCurrency(10), /\$10\.00/);
});

test('an unknown currency falls back to INR', () => {
  setCurrency('XYZ');
  assert.equal(getCurrency(), 'INR');
});

test('labels and typed amounts accept the active symbol', () => {
  setCurrency('GBP');
  assert.equal(localizeLabel('Amount (₹)'), 'Amount (£)');
  assert.equal(parseAmount('£1,250.50'), 1250.5);
  assert.equal(parseAmount('¥500'), 500);
});
