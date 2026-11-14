'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { compute, slabTax, hraExemption } = require('../src/tax/engine');
const { RULES } = require('../src/tax/rules');

const R = RULES['2026-27'];
const run = (gross, basic, extra = {}) => compute({ age: 'under60', city: 'Pune', grossSalary: gross, basicSalary: basic, ...extra }, R);

test('new regime slab tax on 14.25L taxable is 93,750 and total with cess 97,500', () => {
  const r = run(1500000, 600000);
  assert.equal(r.new.taxableIncome, 1425000);
  assert.equal(r.new.slabTax, 93750);
  assert.equal(r.new.totalTax, 97500);
});

test('old regime slab tax on 10.5L taxable is 1,27,500', () => {
  assert.equal(slabTax(1050000, R.oldRegime.slabs.under60).total, 127500);
});

test('income up to 12L taxable is fully rebated in the new regime', () => {
  const r = run(1275000, 600000);
  assert.equal(r.new.taxableIncome, 1200000);
  assert.equal(r.new.totalTax, 0);
});

test('marginal relief: 12.1L taxable pays only the excess over 12L plus cess', () => {
  const r = run(1285000, 600000);
  assert.equal(r.new.taxableIncome, 1210000);
  assert.equal(r.new.totalTax, 10400);
});

test('old regime deductions and HRA reduce tax; comparison names the cheaper regime', () => {
  const r = run(1500000, 600000, { section80C: 200000, hraReceived: 200000, rentPaid: 300000 });
  assert.equal(r.old.deductions.find((d) => d.label.startsWith('Section 80C')).allowed, 150000);
  assert.equal(r.old.taxableIncome, 1100000);
  assert.equal(r.old.totalTax, 148200);
  assert.equal(r.comparison.better, 'new');
  assert.equal(r.comparison.saving, 50700);
});

test('HRA exemption is the least of three amounts; metro uses 50%, non-metro 40%', () => {
  const base = { hraReceived: 240000, rentPaid: 300000, basic: 600000 };
  assert.equal(hraExemption({ ...base, isMetro: true }, R).exempt, 240000);
  assert.equal(hraExemption({ ...base, isMetro: false }, R).exempt, 240000);
  assert.equal(hraExemption({ hraReceived: 300000, rentPaid: 200000, basic: 600000, isMetro: true }, R).exempt, 140000);
  assert.equal(hraExemption({ hraReceived: 0, rentPaid: 100, basic: 100, isMetro: true }, R).exempt, 0);
});

test('surcharge marginal relief: tax never rises by more than the income above 50L', () => {
  const at = run(5075000, 2000000).new; // taxable exactly 50L
  const above = run(5085000, 2000000).new; // taxable 50.1L
  assert.equal(at.surcharge, 0);
  assert.ok(above.surchargeMarginalRelief > 0);
  assert.ok(above.totalTax - at.totalTax <= 100000 + 10, 'extra tax must not exceed extra income (plus rounding)');
});

test('home loan interest and 80C are ignored in the new regime', () => {
  const a = run(1500000, 600000);
  const b = run(1500000, 600000, { section80C: 150000, homeLoanInterest: 200000 });
  assert.equal(a.new.totalTax, b.new.totalTax);
  assert.ok(b.old.totalTax < a.old.totalTax);
});

test('results are rounded to the nearest ten rupees and always finite', () => {
  for (const g of [0, 300000, 987654, 2345678, 9999999]) {
    const r = run(g, Math.round(g / 2));
    for (const k of ['new', 'old']) {
      assert.ok(Number.isFinite(r[k].totalTax));
      assert.equal(r[k].totalTax % 10, 0);
    }
  }
});

test('result always lists its assumptions and exclusions', () => {
  assert.ok(run(1000000, 400000).assumptions.some((a) => /capital gains/i.test(a)));
});
