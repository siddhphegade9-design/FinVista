import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSampleData } from '../js/dashboard/dataSource.js';
import { summarizeMonth, currentMonthKey } from '../js/dashboard/metrics.js';

test('sample data never contains future-dated transactions', () => {
  for (const day of [1, 3, 14, 28]) {
    const now = new Date(2026, 10, day);
    const today = `2026-11-${String(day).padStart(2, '0')}`;
    const { transactions } = buildSampleData(now);
    assert.ok(transactions.every((t) => t.date <= today), `future date found when today is ${today}`);
  }
});

test('sample data covers six months with positive amounts and unique ids', () => {
  const now = new Date(2026, 10, 14);
  const { transactions } = buildSampleData(now);
  assert.equal(new Set(transactions.map((t) => t.id)).size, transactions.length);
  assert.ok(transactions.every((t) => t.amount > 0 && ['income', 'expense'].includes(t.type)));
  assert.equal(new Set(transactions.map((t) => t.date.slice(0, 7))).size, 6);
  assert.equal(summarizeMonth(transactions, currentMonthKey(now)).income, 88000);
});
