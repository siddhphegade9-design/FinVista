'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const cur = require('../src/config/currencies');
const { detectAnomalies } = require('../src/insights/anomalies');
const { systemPrompt, SYSTEM } = require('../src/ai/prompt');
const { buildFacts } = require('../src/ai/context');
const { computeScore } = require('../src/health/score');
const { suggestBudgets } = require('../src/budgets/calc');

test('supported currencies are exactly the seven offered; unknown codes are rejected', () => {
  assert.deepEqual([...cur.CODES], ['INR', 'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY']);
  for (const bad of ['usd', 'XYZ', '', null, undefined, 5, '__proto__', 'constructor']) assert.equal(cur.isSupported(bad), false, String(bad));
});

test('formatMoney uses each currency\'s own symbol and grouping', () => {
  assert.equal(cur.formatMoney(1234567, 'INR'), '₹12,34,567');
  assert.equal(cur.formatMoney(1234.5, 'USD'), '$1,234.5');
  assert.equal(cur.formatMoney(1234.5, 'EUR'), '€1,234.5');
  assert.equal(cur.formatMoney(1234.5, 'GBP'), '£1,234.5');
  assert.equal(cur.formatMoney(1234.5, 'CAD'), 'CA$1,234.5');
  assert.equal(cur.formatMoney(1234.5, 'AUD'), 'A$1,234.5');
  assert.equal(cur.formatMoney(1234567, 'JPY'), '¥1,234,567');
  assert.equal(cur.formatMoney(5, 'nonsense'), '₹5', 'falls back to INR');
});

const history = (amount, n = 10) => Array.from({ length: n }, (_, i) => ({ id: `t${i}`, date: `2026-10-${String(i + 1).padStart(2, '0')}`, description: `Cafe ${i}`, amount, category: 'Food' }));
const now = new Date('2026-11-14T10:00:00Z');

test('anomaly thresholds scale with the currency: a 60 purchase is noise in INR but unusual in USD', () => {
  const txs = [...history('10'), { id: 'big', date: '2026-11-10', description: 'Dinner', amount: '60', category: 'Food' }];
  assert.equal(detectAnomalies(txs, now).filter((a) => a.kind === 'unusual_amount').length, 0, 'under the INR 500 floor');
  const usd = detectAnomalies(txs, now, { currency: 'USD' }).filter((a) => a.kind === 'unusual_amount');
  assert.equal(usd.length, 1);
  assert.match(usd[0].reason, /^\$60 is about 6\.0×/);
  assert.doesNotMatch(usd[0].reason, /₹/);
});

test('INR behaviour is unchanged (default) and reasons keep the rupee sign', () => {
  const txs = [...history('1000'), { id: 'big', date: '2026-11-10', description: 'Dinner', amount: '6000', category: 'Food' }];
  const r = detectAnomalies(txs, now).find((a) => a.kind === 'unusual_amount');
  assert.match(r.reason, /^₹6,000 is about 6\.0×/);
});

test('AI prompt: INR keeps the India wording; other currencies are neutral, never convert and refuse tax', () => {
  assert.equal(systemPrompt('INR'), SYSTEM);
  assert.match(SYSTEM, /people in India/);
  const usd = systemPrompt('USD');
  assert.match(usd, /US dollar \(USD\)/);
  assert.match(usd, /Never convert/);
  assert.doesNotMatch(usd, /India|₹/);
  assert.match(usd, /no tax tool for this currency/);
});

test('AI facts carry the user\'s currency code and nothing personal', () => {
  const facts = buildFacts({ forecast: { status: 'insufficient_data', completeMonths: 0, neededMonths: 3, history: [] }, anomalies: { anomalies: [] }, budgets: { rows: [], overall: null, totals: {}, month: '2026-11', phase: 'current' }, investments: { sipCount: 0, sipMonthly: 0 }, insurance: { activeCount: 0, monthlyEquivalent: 0 }, currency: 'GBP', now });
  assert.equal(facts.currency, 'GBP');
});

test('health score text uses the user\'s currency symbol', () => {
  const months = [{ month: '2026-09', income: 3000, expenses: 2900 }];
  const eur = computeScore({ months, currency: 'EUR' });
  const text = eur.components.map((c) => `${c.explanation} ${c.tip || ''}`).join(' ');
  assert.match(text, /€/);
  assert.doesNotMatch(text, /₹/);
});

test('budget suggestions round up to the currency\'s own unit', () => {
  const rows = [{ month: '2026-08', categoryId: 'c', name: 'Food', amount: '123' }, { month: '2026-09', categoryId: 'c', name: 'Food', amount: '123' }, { month: '2026-10', categoryId: 'c', name: 'Food', amount: '123' }];
  const usd = suggestBudgets(rows, '2026-11-14', cur.info('USD').budgetRound * 100).suggestions[0];
  assert.equal(usd.suggested, 125);
  const inr = suggestBudgets(rows, '2026-11-14').suggestions[0];
  assert.equal(inr.suggested, 200);
});
