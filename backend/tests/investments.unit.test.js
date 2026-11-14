'use strict';
/** Pure tests for SIP maths, insurance maths and the validators (no database). */
const test = require('node:test');
const assert = require('node:assert/strict');
const sip = require('../src/investments/sip');
const ins = require('../src/investments/insurance');
const v = require('../src/validation/investments');

const mk = (o = {}) => ({ startDate: '2026-01-15', durationMonths: 12, monthlyPaise: 100000, stepUpPercent: 0, expectedReturnPercent: 0, isActive: true, ...o });
const close = (a, b, eps) => assert.ok(Math.abs(a - b) <= eps, `${a} is not within ${eps} of ${b}`);

test('instalment dates are clamped to the end of short months', () => {
  assert.deepEqual(sip.instalmentDate('2026-01-31', 1), { y: 2026, m: 2, d: 28 });
  assert.deepEqual(sip.instalmentDate('2026-01-31', 2), { y: 2026, m: 3, d: 31 });
  assert.deepEqual(sip.instalmentDate('2028-01-31', 1), { y: 2028, m: 2, d: 29 }, 'leap year');
  assert.deepEqual(sip.instalmentDate('2026-11-15', 3), { y: 2027, m: 2, d: 15 }, 'rolls over the year');
});

test('whole months between dates, including month-end clamps', () => {
  const d = (s) => { const [y, m, dd] = s.split('-').map(Number); return { y, m, d: dd }; };
  assert.equal(sip.wholeMonths(d('2026-01-15'), d('2026-02-14')), 0);
  assert.equal(sip.wholeMonths(d('2026-01-15'), d('2026-02-15')), 1);
  assert.equal(sip.wholeMonths(d('2026-01-31'), d('2026-02-28')), 1);
  assert.equal(sip.wholeMonths(d('2026-01-15'), d('2027-01-15')), 12);
});

test('instalments due: counts by date, respects duration and future starts', () => {
  const s = mk({ durationMonths: 6 });
  assert.equal(sip.instalmentsDue(s, '2026-01-14'), 0);
  assert.equal(sip.instalmentsDue(s, '2026-01-15'), 1);
  assert.equal(sip.instalmentsDue(s, '2026-03-14'), 2);
  assert.equal(sip.instalmentsDue(s, '2026-03-15'), 3);
  assert.equal(sip.instalmentsDue(s, '2040-01-01'), 6, 'capped at the duration');
  assert.equal(sip.instalmentsDue(mk({ durationMonths: null }), '2027-01-15'), 13, 'ongoing has no cap');
});

test('zero return: value equals what was invested', () => {
  const p = sip.positionAt(mk(), '2027-01-15');
  assert.equal(p.instalments, 12);
  assert.equal(p.investedPaise, 1_200_000);
  assert.equal(p.valuePaise, 1_200_000);
});

test('yearly step-up raises the instalment every 12 months', () => {
  const s = mk({ durationMonths: 24, stepUpPercent: 10 });
  assert.equal(sip.instalmentPaise(s, 11), 100000);
  assert.equal(sip.instalmentPaise(s, 12), 110000);
  assert.equal(sip.positionAt(s, '2028-06-01').investedPaise, 12 * 100000 + 12 * 110000);
  assert.equal(sip.currentInstalmentPaise(mk({ durationMonths: null, stepUpPercent: 10 }), '2027-01-15'), 110000, 'next instalment after 12 paid');
});

test('compounding: 12% a year on 1,000 a month for a year is about 12,766.6', () => {
  const p = sip.positionAt(mk({ expectedReturnPercent: 12 }), '2027-01-15');
  close(p.valuePaise / 100, 12766.6, 1);
  assert.equal(p.investedPaise, 1_200_000);
  const i = sip.monthlyRate(12);
  close(((1 + i) ** 12), 1.12, 1e-12);
});

test('projection to the planned end and for an ongoing SIP', () => {
  const fixed = sip.projectToEnd(mk({ expectedReturnPercent: 12 }), '2026-06-01');
  assert.equal(fixed.date, '2027-01-15');
  assert.equal(fixed.ongoing, false);
  assert.equal(fixed.instalments, 12);
  assert.ok(fixed.gainPaise > 0);
  const ongoing = sip.projectToEnd(mk({ durationMonths: null, expectedReturnPercent: 12 }), '2026-01-15', 10);
  assert.equal(ongoing.ongoing, true);
  assert.equal(ongoing.date, '2036-01-15');
  assert.equal(ongoing.instalments, 121, 'includes the instalment falling on the horizon date itself');
  assert.equal(ongoing.investedPaise, 121 * 100000);
});

test('end date, finished and inactive SIPs', () => {
  assert.equal(sip.endDate(mk()), '2026-12-15');
  assert.equal(sip.endDate(mk({ durationMonths: null })), null);
  const done = sip.describe(mk(), '2028-01-01');
  assert.equal(done.finished, true);
  assert.equal(done.nextInstalmentPaise, 0);
  assert.equal(sip.currentInstalmentPaise(mk({ isActive: false }), '2026-03-01'), 0);
  const future = sip.describe(mk({ startDate: '2027-01-01' }), '2026-11-14');
  assert.equal(future.instalmentsPaid, 0);
  assert.equal(future.scheduledInvestedPaise, 0);
});

test('calculator: 5,000 a month for 10 years at 12%', () => {
  const r = sip.calculate({ monthlyPaise: 500000, years: 10, expectedReturnPercent: 12 }, '2026-11-14');
  assert.equal(r.months, 120);
  assert.equal(r.investedPaise, 60_000_000);
  assert.ok(r.valuePaise / 100 > 1_115_000 && r.valuePaise / 100 < 1_125_000, r.valuePaise);
  const stepped = sip.calculate({ monthlyPaise: 500000, years: 10, stepUpPercent: 10, expectedReturnPercent: 12 }, '2026-11-14');
  assert.ok(stepped.valuePaise > r.valuePaise && stepped.investedPaise > r.investedPaise);
});

test('growth series: year 0 is today and the totals never go down while SIPs run', () => {
  const sips = [mk({ durationMonths: null, expectedReturnPercent: 10 }), mk({ monthlyPaise: 50000, isActive: false })];
  const g = sip.growthSeries(sips, '2026-06-15', 5);
  assert.equal(g.length, 6);
  assert.equal(g[0].year, 0);
  assert.equal(g[0].investedPaise, sip.positionAt(sips[0], '2026-06-15').investedPaise, 'inactive SIPs are left out');
  for (let i = 1; i < g.length; i += 1) assert.ok(g[i].valuePaise >= g[i - 1].valuePaise && g[i].investedPaise > g[i - 1].investedPaise);
});

test('insurance: annual premium, days until due and renewal status', () => {
  assert.equal(ins.annualPremiumPaise(100000, 'monthly'), 1_200_000);
  assert.equal(ins.annualPremiumPaise(100000, 'quarterly'), 400_000);
  assert.equal(ins.annualPremiumPaise(100000, 'half_yearly'), 200_000);
  assert.equal(ins.annualPremiumPaise(100000, 'yearly'), 100_000);
  assert.equal(ins.daysUntil('2026-11-20', '2026-11-14'), 6);
  assert.equal(ins.daysUntil('2026-11-10', '2026-11-14'), -4);
  const p = (d, a = true) => ({ nextDueDate: d, isActive: a });
  assert.equal(ins.renewalStatus(p('2026-11-10'), '2026-11-14'), 'overdue');
  assert.equal(ins.renewalStatus(p('2026-11-14'), '2026-11-14'), 'due_soon');
  assert.equal(ins.renewalStatus(p('2026-12-14'), '2026-11-14'), 'due_soon');
  assert.equal(ins.renewalStatus(p('2026-12-15'), '2026-11-14'), 'upcoming');
  assert.equal(ins.renewalStatus(p('2026-11-10', false), '2026-11-14'), 'inactive');
});

const NOW = new Date('2026-11-14T10:00:00Z');
const goodSip = { name: ' Nifty 50 index fund ', instrumentType: 'mutual_fund', monthlyAmount: '5,000', startDate: '2025-04-05', durationMonths: 120, stepUpPercent: 10, expectedReturnPercent: 12 };

test('validateSip: accepts a good record and normalises it', () => {
  const { value, errors } = v.validateSip(goodSip, NOW);
  assert.equal(errors, undefined);
  assert.equal(value.name, 'Nifty 50 index fund');
  assert.equal(value.monthlyAmount, '5000.00');
  assert.equal(value.durationMonths, 120);
  assert.equal(value.currentValue, null);
  assert.equal(value.isActive, true);
  const ongoing = v.validateSip({ ...goodSip, durationMonths: '', stepUpPercent: undefined, currentValue: '0', currentValueAsOf: '2026-11-01' }, NOW).value;
  assert.equal(ongoing.durationMonths, null);
  assert.equal(ongoing.stepUpPercent, 0);
  assert.equal(ongoing.currentValue, '0.00');
});

test('validateSip: rejects bad input with a message per field', () => {
  const bad = v.validateSip({ name: '', instrumentType: 'crypto', monthlyAmount: '0', startDate: '2026-02-30', durationMonths: 601, stepUpPercent: 51, expectedReturnPercent: 31, currentValue: '100' }, NOW).errors;
  for (const k of ['name', 'instrumentType', 'monthlyAmount', 'startDate', 'durationMonths', 'stepUpPercent', 'expectedReturnPercent', 'currentValueAsOf']) assert.ok(bad[k], `missing error for ${k}`);
  assert.ok(v.validateSip({ ...goodSip, expectedReturnPercent: '' }, NOW).errors.expectedReturnPercent, 'the assumed return is required');
  assert.ok(v.validateSip({ ...goodSip, startDate: '2028-01-01' }, NOW).errors.startDate, 'more than a year ahead');
  assert.ok(v.validateSip({ ...goodSip, durationMonths: 1.5 }, NOW).errors.durationMonths);
  assert.ok(v.validateSip({ ...goodSip, currentValue: '5', currentValueAsOf: '2027-01-01' }, NOW).errors.currentValueAsOf, 'a value date in the future');
  assert.ok(v.validateSip({ ...goodSip, isActive: 'yes' }, NOW).errors.isActive);
  assert.ok(v.validateSip({ ...goodSip, notes: 'x'.repeat(201) }, NOW).errors.notes);
});

test('validateCalculator and validatePolicy', () => {
  assert.deepEqual(v.validateCalculator({ monthlyAmount: '5000', years: 10, stepUpPercent: 0, expectedReturnPercent: 12 }).value, { monthlyPaise: 500000, years: 10, stepUpPercent: 0, expectedReturnPercent: 12 });
  assert.ok(v.validateCalculator({ monthlyAmount: '5000', years: 0, expectedReturnPercent: 12 }).errors.years);
  assert.ok(v.validateCalculator({ monthlyAmount: '5000', years: 51, expectedReturnPercent: 12 }).errors.years);
  assert.ok(v.validateCalculator({ monthlyAmount: '5000', years: 7.5 }).errors.expectedReturnPercent);
  const good = { name: 'Family health plan', insurer: 'Star Health', policyType: 'health', sumAssured: '1000000', premium: '18,500', premiumFrequency: 'yearly', nextDueDate: '2027-03-01' };
  const ok = v.validatePolicy(good, NOW).value;
  assert.equal(ok.premium, '18500.00');
  assert.equal(ok.sumAssured, '1000000.00');
  assert.equal(v.validatePolicy({ ...good, insurer: '' }, NOW).value.insurer, null);
  const bad = v.validatePolicy({ name: '', policyType: 'pet', sumAssured: 'abc', premium: '-1', premiumFrequency: 'weekly', nextDueDate: '2031-01-01' }, NOW).errors;
  for (const k of ['name', 'policyType', 'sumAssured', 'premium', 'premiumFrequency', 'nextDueDate']) assert.ok(bad[k], `missing error for ${k}`);
});
