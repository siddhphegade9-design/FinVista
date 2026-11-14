'use strict';
/** Tax estimator endpoints against a real PostgreSQL database. */
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
const INPUTS = { age: 'under60', city: 'Pune', grossSalary: '1500000', basicSalary: '600000', section80C: '200000', hraReceived: '200000', rentPaid: '300000' };

test('tax API (real PostgreSQL)', { skip: !hasTestDb && 'TEST_DATABASE_URL not set' }, async (t) => {
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

  await t.test('every route requires login', async () => {
    const calls = [anon.get('/api/tax/rules'), anon.get('/api/tax/profile'), anon.put('/api/tax/profile', {}), anon.get('/api/tax/suggestions'), anon.post('/api/tax/calculate', {})];
    for (const r of await Promise.all(calls)) assert.equal(r.status, 401);
  });

  await t.test('rules list the tax years, limits and when they were checked', async () => {
    const r = (await asha.get('/api/tax/rules')).json;
    assert.equal(r.defaultYear, '2026-27');
    assert.ok(r.years.every((y) => y.verifiedOn && y.limits.section80C === 150000));
  });

  await t.test('calculate compares both regimes and saves nothing', async () => {
    const r = await asha.post('/api/tax/calculate', { year: '2026-27', ...INPUTS });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.result.new.totalTax, 97500);
    assert.equal(r.json.result.old.totalTax, 148200);
    assert.equal(r.json.result.comparison.better, 'new');
    assert.equal((await asha.get('/api/tax/profile')).json.profile, null);
  });

  await t.test('validation rejects bad figures, years and basic above gross', async () => {
    for (const body of [{ ...INPUTS, grossSalary: '-5' }, { ...INPUTS, section80C: 'abc' }, { ...INPUTS, basicSalary: '2000000' }, { ...INPUTS, age: 'old' }, { ...INPUTS, city: 'Atlantis' }]) {
      const r = await asha.post('/api/tax/calculate', body);
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.ok(r.json.error.details && Object.keys(r.json.error.details).length);
    }
    assert.equal((await asha.post('/api/tax/calculate', { year: '1999-00', ...INPUTS })).status, 400);
    assert.equal((await asha.get('/api/tax/profile?year=nope')).status, 400);
  });

  await t.test('save, update and read a profile; users never see each other\'s', async () => {
    assert.equal((await asha.put('/api/tax/profile', INPUTS)).status, 200);
    assert.equal((await asha.put('/api/tax/profile', { ...INPUTS, section80C: '100000' })).status, 200);
    const mine = (await asha.get('/api/tax/profile')).json.profile;
    assert.equal(mine.inputs.section80C, 100000);
    assert.equal((await ravi.get('/api/tax/profile')).json.profile, null);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM tax_profiles')).rows[0].n, 1);
  });

  await t.test('suggestions come from the user\'s own SIP and health policy records', async () => {
    assert.deepEqual((await asha.get('/api/tax/suggestions')).json.items, []);
    const sip = await asha.post('/api/sips', { name: 'ELSS fund', instrumentType: 'elss', monthlyAmount: '5000', startDate: '2026-04-01', stepUpPercent: '0', expectedReturnPercent: '12' });
    assert.equal(sip.status, 201, JSON.stringify(sip.json));
    const pol = await asha.post('/api/insurance', { name: 'Family floater', policyType: 'health', sumAssured: '1000000', premium: '18000', premiumFrequency: 'yearly', nextDueDate: '2026-12-01' });
    assert.equal(pol.status, 201, JSON.stringify(pol.json));
    const items = (await asha.get('/api/tax/suggestions')).json.items;
    assert.equal(items.find((i) => i.field === 'section80C').amount, 60000);
    assert.equal(items.find((i) => i.field === 'section80DSelf').amount, 18000);
    assert.deepEqual((await ravi.get('/api/tax/suggestions')).json.items, []);
  });
});
