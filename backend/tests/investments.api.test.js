'use strict';
/** SIP and insurance endpoints against a real PostgreSQL database. */
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || '';
process.env.AUTH_RATE_LIMIT_MAX = '100';
process.env.API_RATE_LIMIT_PER_MIN = '5000';
const { createApp } = require('../src/app');
const { migrate } = require('../src/db/migrate');
const { closePool } = require('../src/db/pool');
const { hasTestDb, createTestPool, resetDatabase } = require('./helpers/testDb');
const { createClient, startApp } = require('./helpers/client');

const PW = 'correct-horse-battery';
const now = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const monthsAgo = (n) => iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - n, Math.min(now.getUTCDate(), 28))));
const daysFromNow = (n) => iso(new Date(now.getTime() + n * 86_400_000));
const UUID0 = '3f2b1c9e-8a4d-4e6f-9b1a-2c3d4e5f6a7b';

test('investments and insurance API (real PostgreSQL)', { skip: !hasTestDb && 'TEST_DATABASE_URL not set' }, async (t) => {
  const pool = createTestPool();
  await resetDatabase(pool);
  await migrate({ pool });
  const { server, base } = await startApp(createApp);
  t.after(async () => { server.close(); await closePool(); await pool.end(); });

  const asha = createClient(base);
  const ravi = createClient(base);
  const anon = createClient(base);
  await asha.post('/api/auth/register', { email: 'asha@example.com', fullName: 'Asha K', password: PW });
  await ravi.post('/api/auth/register', { email: 'ravi@example.com', fullName: 'Ravi S', password: PW });

  const sipBody = (o = {}) => ({ name: 'Index fund', instrumentType: 'mutual_fund', monthlyAmount: '1000', startDate: monthsAgo(5), expectedReturnPercent: 0, ...o });
  const polBody = (o = {}) => ({ name: 'Family health plan', insurer: 'Star Health', policyType: 'health', sumAssured: '1000000', premium: '18500', premiumFrequency: 'yearly', nextDueDate: daysFromNow(20), ...o });

  await t.test('every route requires login', async () => {
    const calls = [anon.get('/api/sips'), anon.post('/api/sips', {}), anon.put(`/api/sips/${UUID0}`, {}), anon.del(`/api/sips/${UUID0}`), anon.post('/api/sips/calculate', {}),
      anon.get('/api/insurance'), anon.post('/api/insurance', {}), anon.put(`/api/insurance/${UUID0}`, {}), anon.del(`/api/insurance/${UUID0}`)];
    for (const r of await Promise.all(calls)) assert.equal(r.status, 401);
  });

  await t.test('empty state', async () => {
    const s = (await asha.get('/api/sips')).json;
    assert.deepEqual(s.sips, []);
    assert.equal(s.summary.monthlyCommitment, 0);
    assert.equal(s.growth.length, 11);
    assert.match(s.note, /estimates, not statements/);
    assert.deepEqual((await asha.get('/api/insurance')).json.policies, []);
  });

  let sipA;
  await t.test('create a SIP: scheduled amounts and the next instalment come from the schedule', async () => {
    const res = await asha.post('/api/sips', sipBody());
    assert.equal(res.status, 201, JSON.stringify(res.json));
    sipA = res.json.sip;
    assert.equal(sipA.instalmentsPaid, 6);
    assert.equal(sipA.scheduledInvested, 6000);
    assert.equal(sipA.modelledValue, 6000, 'zero assumed return');
    assert.equal(sipA.nextInstalment, 1000);
    assert.equal(sipA.durationMonths, null);
    assert.equal(sipA.endDate, null);
    assert.equal(sipA.projection.ongoing, true);
    assert.equal(sipA.currentValue, null);
  });

  await t.test('create a fixed-term SIP with step-up and an assumed return', async () => {
    const res = await asha.post('/api/sips', sipBody({ name: 'ELSS plan', instrumentType: 'elss', monthlyAmount: '500', startDate: monthsAgo(3), durationMonths: 12, stepUpPercent: 10, expectedReturnPercent: 12, currentValue: '2000', currentValueAsOf: monthsAgo(0) }));
    assert.equal(res.status, 201, JSON.stringify(res.json));
    const s = res.json.sip;
    assert.equal(s.projection.instalments, 12);
    assert.equal(s.projection.invested, 6000);
    assert.ok(s.projection.value > 6000 && s.projection.gain > 0);
    assert.equal(s.projection.ongoing, false);
    assert.equal(s.currentValue, 2000);
    assert.ok(s.endDate);
    assert.equal(s.nextInstalment, 500);
  });

  await t.test('list: summary adds up active SIPs; recorded values are separate from modelled ones', async () => {
    const s = (await asha.get('/api/sips')).json;
    assert.equal(s.sips.length, 2);
    assert.equal(s.summary.activeCount, 2);
    assert.equal(s.summary.monthlyCommitment, 1500);
    assert.equal(s.summary.scheduledInvested, 6000 + 2000, '6 x 1000 plus 4 x 500');
    assert.equal(s.summary.recordedValue, 2000);
    assert.equal(s.summary.recordedValueCount, 1);
    assert.equal(s.growth[0].year, 0);
    assert.equal(s.growth[0].invested, 8000);
    assert.ok(s.growth[10].value > s.growth[0].value);
  });

  await t.test('validation errors list the fields', async () => {
    const res = await asha.post('/api/sips', { name: '', instrumentType: 'x', monthlyAmount: '-5', startDate: 'nope', expectedReturnPercent: '99' });
    assert.equal(res.status, 400);
    for (const k of ['name', 'instrumentType', 'monthlyAmount', 'startDate', 'expectedReturnPercent']) assert.ok(res.json.error.details[k], k);
    assert.equal((await asha.post('/api/sips', sipBody({ expectedReturnPercent: undefined }))).status, 400, 'return is required');
  });

  await t.test('update and pause: a paused SIP leaves the commitment total', async () => {
    const res = await asha.put(`/api/sips/${sipA.id}`, sipBody({ name: 'Index fund (paused)', isActive: false }));
    assert.equal(res.status, 200);
    assert.equal(res.json.sip.isActive, false);
    assert.equal(res.json.sip.nextInstalment, 0);
    const s = (await asha.get('/api/sips')).json;
    assert.equal(s.summary.monthlyCommitment, 500);
    assert.equal(s.summary.activeCount, 1);
    assert.equal((await asha.put(`/api/sips/${UUID0}`, sipBody())).status, 404);
    assert.equal((await asha.put('/api/sips/not-a-uuid', sipBody())).status, 404);
  });

  await t.test('calculator: no record saved, validated, labelled as an estimate', async () => {
    const res = await asha.post('/api/sips/calculate', { monthlyAmount: '5000', years: 10, expectedReturnPercent: 12 });
    assert.equal(res.status, 200);
    assert.equal(res.json.invested, 600000);
    assert.ok(res.json.value > 1_115_000 && res.json.value < 1_125_000);
    assert.equal(res.json.gain, Math.round((res.json.value - 600000) * 100) / 100);
    assert.match(res.json.note, /not statements/);
    assert.equal((await asha.post('/api/sips/calculate', { monthlyAmount: '5000', years: 0, expectedReturnPercent: 12 })).status, 400);
    assert.equal((await asha.get('/api/sips')).json.sips.length, 2, 'nothing was stored');
  });

  await t.test('SIP isolation between users', async () => {
    assert.deepEqual((await ravi.get('/api/sips')).json.sips, []);
    assert.equal((await ravi.put(`/api/sips/${sipA.id}`, sipBody())).status, 404);
    assert.equal((await ravi.del(`/api/sips/${sipA.id}`)).status, 404);
    assert.equal((await asha.get('/api/sips')).json.sips.length, 2, 'still there');
  });

  await t.test('insurance: premiums are normalised and renewals flagged', async () => {
    const a = await asha.post('/api/insurance', polBody());
    assert.equal(a.status, 201, JSON.stringify(a.json));
    assert.equal(a.json.policy.annualPremium, 18500);
    assert.equal(a.json.policy.monthlyEquivalent, 1541.67);
    assert.equal(a.json.policy.renewalStatus, 'due_soon');
    assert.equal(a.json.policy.daysUntilDue, 20);
    const b = await asha.post('/api/insurance', polBody({ name: 'Term plan', policyType: 'term_life', sumAssured: '10000000', premium: '1000', premiumFrequency: 'monthly', nextDueDate: daysFromNow(90) }));
    assert.equal(b.json.policy.annualPremium, 12000);
    assert.equal(b.json.policy.renewalStatus, 'upcoming');
    const c = await asha.post('/api/insurance', polBody({ name: 'Bike', policyType: 'motor', sumAssured: '50000', premium: '700', premiumFrequency: 'quarterly', nextDueDate: daysFromNow(-3) }));
    assert.equal(c.json.policy.renewalStatus, 'overdue');
    const list = (await asha.get('/api/insurance')).json;
    assert.equal(list.summary.activeCount, 3);
    assert.equal(list.summary.annualPremium, 18500 + 12000 + 2800);
    assert.deepEqual(list.summary.coverByType, { health: 1_000_000, term_life: 10_000_000, motor: 50_000 });
    assert.equal(list.summary.dueSoon, 1);
    assert.equal(list.summary.overdue, 1);
    assert.match(list.note, /does not say how much cover you need/);
    // pause the bike: it leaves every total
    await asha.put(`/api/insurance/${c.json.policy.id}`, polBody({ name: 'Bike', policyType: 'motor', sumAssured: '50000', premium: '700', premiumFrequency: 'quarterly', nextDueDate: daysFromNow(-3), isActive: false }));
    const after = (await asha.get('/api/insurance')).json.summary;
    assert.equal(after.annualPremium, 30500);
    assert.equal(after.overdue, 0);
    assert.equal(after.coverByType.motor, undefined);
  });

  await t.test('insurance validation, 404s and isolation', async () => {
    const bad = await asha.post('/api/insurance', { name: '', policyType: 'pet', sumAssured: '0', premium: 'x', premiumFrequency: 'weekly', nextDueDate: '2031-01-01' });
    assert.equal(bad.status, 400);
    for (const k of ['name', 'policyType', 'sumAssured', 'premium', 'premiumFrequency', 'nextDueDate']) assert.ok(bad.json.error.details[k], k);
    const id = (await asha.get('/api/insurance')).json.policies[0].id;
    assert.equal((await ravi.put(`/api/insurance/${id}`, polBody())).status, 404);
    assert.equal((await ravi.del(`/api/insurance/${id}`)).status, 404);
    assert.deepEqual((await ravi.get('/api/insurance')).json.policies, []);
    assert.equal((await asha.del('/api/insurance/not-a-uuid')).status, 404);
  });

  await t.test('forecast shows planned commitments beside the projection, not inside it', async () => {
    const f = (await asha.get('/api/forecast')).json;
    assert.equal(f.commitments.sipMonthly, 500);
    assert.equal(f.commitments.insuranceMonthlyEquivalent, Math.round((18500 + 12000) / 12 * 100) / 100);
    assert.equal(f.commitments.sipCount, 1);
    assert.match(f.commitments.note, /not added to the projection/);
    assert.equal(f.status, 'insufficient_data', 'adding records does not invent history');
  });

  await t.test('limits and database constraints', async () => {
    const { rows } = await pool.query("SELECT id FROM users WHERE email = 'ravi@example.com'");
    await pool.query(`INSERT INTO sips (user_id, name, instrument_type, monthly_amount, start_date, expected_return_percent)
                      SELECT $1, 'bulk ' || g, 'other', 100, '2025-01-01', 0 FROM generate_series(1, 100) g`, [rows[0].id]);
    const res = await ravi.post('/api/sips', sipBody());
    assert.equal(res.status, 400);
    assert.match(res.json.error.message, /up to 100/);
    await assert.rejects(pool.query("INSERT INTO sips (user_id, name, instrument_type, monthly_amount, start_date, current_value) VALUES ($1, 'x', 'other', 1, '2025-01-01', 5)", [rows[0].id]), /check/);
    await assert.rejects(pool.query("INSERT INTO insurance_policies (user_id, name, policy_type, sum_assured, premium, premium_frequency, next_due_date) VALUES ($1, 'x', 'health', 1, 0, 'yearly', '2026-01-01')", [rows[0].id]), /check/);
  });

  await t.test('delete a SIP; deleting the account removes records', async () => {
    assert.equal((await asha.del(`/api/sips/${sipA.id}`)).status, 204);
    assert.equal((await asha.del(`/api/sips/${sipA.id}`)).status, 404);
    assert.equal((await ravi.del('/api/auth/account', { password: PW })).status, 200);
    assert.equal((await pool.query("SELECT count(*)::int n FROM sips WHERE name LIKE 'bulk %'")).rows[0].n, 0);
  });
});
