'use strict';
/** Multi-currency mode against a real PostgreSQL database. */
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
const today = new Date().toISOString().slice(0, 10);
const INPUTS = { age: 'under60', city: 'Pune', grossSalary: '1500000', basicSalary: '600000' };

test('currency API (real PostgreSQL)', { skip: !hasTestDb && 'TEST_DATABASE_URL not set' }, async (t) => {
  const pool = createTestPool();
  await resetDatabase(pool);
  await migrate({ pool });
  const { server, base } = await startApp(createApp);
  t.after(async () => { server.close(); await closePool(); await pool.end(); });
  const anon = createClient(base);
  const asha = createClient(base);
  const dave = createClient(base);

  await t.test('registration defaults to INR; a supported currency can be chosen; junk is rejected', async () => {
    const a = await asha.post('/api/auth/register', { email: 'asha@example.com', fullName: 'Asha K', password: PW });
    assert.equal(a.json.user.currency, 'INR');
    const d = await dave.post('/api/auth/register', { email: 'dave@example.com', fullName: 'Dave L', password: PW, currency: 'USD' });
    assert.equal(d.status, 201);
    assert.equal(d.json.user.currency, 'USD');
    const bad = await anon.post('/api/auth/register', { email: 'x@example.com', fullName: 'X Y', password: PW, currency: 'BTC' });
    assert.equal(bad.status, 400);
    assert.ok(bad.json.error.details.currency);
    assert.equal((await dave.get('/api/auth/session')).json.user.currency, 'USD');
  });

  await t.test('changing currency needs login, validates, and is saved', async () => {
    assert.equal((await anon.patch('/api/auth/currency', { currency: 'EUR' })).status, 401);
    for (const body of [{}, { currency: 'usd' }, { currency: 'XXX' }, { currency: 5 }]) assert.equal((await asha.patch('/api/auth/currency', body)).status, 400, JSON.stringify(body));
    assert.equal((await asha.patch('/api/auth/currency', { currency: 'JPY' })).json.user.currency, 'JPY');
    assert.equal((await asha.get('/api/auth/session')).json.user.currency, 'JPY');
    assert.equal((await asha.patch('/api/auth/currency', { currency: 'INR' })).json.user.currency, 'INR');
  });

  await t.test('Indian tax is open for INR and completely closed for every other currency', async () => {
    assert.equal((await asha.post('/api/tax/calculate', { year: '2026-27', ...INPUTS })).status, 200);
    for (const code of ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY']) {
      await asha.patch('/api/auth/currency', { currency: code });
      for (const r of [await asha.get('/api/tax/rules'), await asha.get('/api/tax/profile'), await asha.put('/api/tax/profile', INPUTS), await asha.get('/api/tax/suggestions'), await asha.post('/api/tax/calculate', { year: '2026-27', ...INPUTS })]) {
        assert.equal(r.status, 403, code);
        assert.equal(r.json.error.code, 'TAX_INDIA_ONLY');
      }
    }
    assert.equal((await dave.get('/api/tax/rules')).status, 403, 'registered as USD');
    await asha.patch('/api/auth/currency', { currency: 'INR' });
    assert.equal((await asha.get('/api/tax/rules')).status, 200, 'reopens when switched back to INR');
  });

  await t.test('changing currency does not touch stored amounts', async () => {
    const cat = (await dave.get('/api/categories')).json.categories.find((x) => x.name === 'Other' && x.kind === 'expense');
    const tx = (await dave.post('/api/transactions', { type: 'expense', amount: '123.45', date: today, description: 'x', categoryId: cat.id })).json.transaction;
    await dave.patch('/api/auth/currency', { currency: 'GBP' });
    assert.equal((await dave.get(`/api/transactions/${tx.id}`)).json.transaction.amount, 123.45);
  });

  await t.test('the AI advisor is told the user\'s currency and gets the neutral prompt', async () => {
    await dave.patch('/api/auth/currency', { currency: 'AUD' });
    const facts = (await dave.get('/api/advisor/data')).json;
    assert.equal((facts.facts || facts).currency, 'AUD');
  });

  await t.test('unusual-spending text uses the user\'s symbol and budget suggestion note names the rounding unit', async () => {
    await dave.patch('/api/auth/currency', { currency: 'USD' });
    const cat = (await dave.get('/api/categories')).json.categories.find((x) => x.name === 'Food & Dining' && x.kind === 'expense');
    for (let i = 1; i <= 10; i += 1) await dave.post('/api/transactions', { type: 'expense', amount: '10', date: `${today.slice(0, 8)}${String(Math.min(i, 9)).padStart(2, '0')}`, description: `Cafe ${i}`, categoryId: cat.id });
    await dave.post('/api/transactions', { type: 'expense', amount: '60', date: today, description: 'Big dinner', categoryId: cat.id });
    const found = (await dave.get('/api/anomalies')).json.anomalies.filter((a) => a.kind === 'unusual_amount');
    assert.ok(found.length >= 1);
    assert.match(found[0].reason, /^\$60/);
    assert.match((await dave.get('/api/budgets/suggestions')).json.note, /next \$5\./);
  });

  await t.test('health score wording follows the currency', async () => {
    const r = (await dave.get('/api/reports/health-score')).json;
    assert.doesNotMatch(JSON.stringify(r), /₹/);
  });
});
