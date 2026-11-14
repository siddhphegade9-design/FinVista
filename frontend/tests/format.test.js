import test from 'node:test';
import assert from 'node:assert/strict';
import { formatCurrency, formatCompact, formatPercent, formatDate, formatDateShort, parseAmount } from '../js/core/format.js';

test('formatCurrency uses Indian digit grouping', () => {
  assert.equal(formatCurrency(123456.5).replace(/\s/g, ' '), '₹1,23,456.50');
  assert.equal(formatCurrency(1234567, { whole: true }), '₹12,34,567');
  assert.equal(formatCurrency('abc'), '—');
});
test('formatCurrency handles negatives and zero', () => {
  assert.match(formatCurrency(-250), /^-₹250\.00$/);
  assert.equal(formatCurrency(0), '₹0.00');
});
test('formatCompact', () => {
  assert.equal(formatCompact(1500000), '15L');
  assert.equal(formatCompact(NaN), '—');
});
test('formatPercent takes a ratio', () => {
  assert.equal(formatPercent(0.2534), '25.3%');
  assert.equal(formatPercent(undefined), '—');
});
test('formatDate does not shift date-only strings by timezone', () => {
  assert.equal(formatDate('2026-11-14'), '14 Nov 2026');
  assert.equal(formatDate('not a date'), '—');
});
test('parseAmount accepts valid money and rejects junk', () => {
  assert.equal(parseAmount('1,234.5'), 1234.5);
  assert.equal(parseAmount('₹ 500'), 500);
  assert.equal(parseAmount('12.345'), null);
  assert.equal(parseAmount('-5'), null);
  assert.equal(parseAmount(''), null);
});

test('formatDateShort drops the year', () => {
  assert.equal(formatDateShort('2026-11-14'), '14 Nov');
  assert.equal(formatDateShort('nope'), '—');
});
