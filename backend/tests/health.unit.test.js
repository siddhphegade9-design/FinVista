'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { computeScore } = require('../src/health/score');

const m = (month, income, expenses) => ({ month, income, expenses });
const get = (r, key) => r.components.find((c) => c.key === key);

test('no data: insufficient, never a fake score', () => {
  const r = computeScore({});
  assert.equal(r.status, 'insufficient_data');
  assert.equal(r.score, null);
});

test('savings rate: 20% or more earns full points, 10% earns half, negative earns zero', () => {
  assert.equal(get(computeScore({ months: [m('2026-09', 100000, 80000)] }), 'savings').points, 35);
  assert.equal(get(computeScore({ months: [m('2026-09', 100000, 90000)] }), 'savings').points, 17.5);
  assert.equal(get(computeScore({ months: [m('2026-09', 100000, 120000)] }), 'savings').points, 0);
});

test('investing: SIP at 10% of income earns full points; none earns zero but is explained', () => {
  const months = [m('2026-09', 100000, 80000)];
  assert.equal(get(computeScore({ months, sipMonthly: 10000 }), 'investing').points, 20);
  const none = get(computeScore({ months }), 'investing');
  assert.equal(none.points, 0);
  assert.match(none.explanation, /No active SIPs/);
});

test('budgets: ok counts 1, watch counts half, over counts 0; no budgets means unscored', () => {
  const months = [m('2026-09', 100000, 80000)];
  const r = computeScore({ months, budgetRows: [{ status: 'ok' }, { status: 'watch' }, { status: 'over' }, { status: 'ok' }] });
  assert.equal(get(r, 'budgets').points, 20 * (2.5 / 4));
  assert.equal(get(computeScore({ months }), 'budgets').scored, false);
});

test('stability needs 3 months; steady spending scores full, wild spending zero', () => {
  assert.equal(get(computeScore({ months: [m('a', 1, 1), m('b', 1, 1)] }), 'stability').scored, false);
  const steady = [m('a', 100000, 50000), m('b', 100000, 50000), m('c', 100000, 50000)];
  assert.equal(get(computeScore({ months: steady }), 'stability').points, 10);
  const wild = [m('a', 100000, 10000), m('b', 100000, 90000), m('c', 100000, 10000)];
  assert.equal(get(computeScore({ months: wild }), 'stability').points, 0);
});

test('score is rescaled over measurable factors only and says how many were used', () => {
  // savings 35/35 + investing 0/20 + cover 0/15 scored = 35 of 70
  const r = computeScore({ months: [m('2026-09', 100000, 70000)] });
  assert.equal(r.status, 'ok');
  assert.equal(r.scoredWeight, 70);
  assert.equal(r.score, 50);
  assert.equal(r.band, 'Fair');
  assert.match(r.message, /3 of 5/);
});

test('perfect inputs reach 100 and Strong', () => {
  const months = [m('a', 100000, 60000), m('b', 100000, 60000), m('c', 100000, 60000)];
  const r = computeScore({ months, sipMonthly: 15000, hasHealthPolicy: true, budgetRows: [{ status: 'ok' }] });
  assert.equal(r.score, 100);
  assert.equal(r.band, 'Strong');
});

test('months without income are ignored for rates; all-zero income is insufficient', () => {
  assert.equal(computeScore({ months: [m('a', 0, 5000)], hasHealthPolicy: true }).status, 'insufficient_data');
});
