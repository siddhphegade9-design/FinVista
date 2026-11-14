'use strict';
/** Forecast and anomalies endpoints against a real PostgreSQL database. */
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
const { addMonths } = require('../src/insights/forecast');

const PW = 'correct-horse-battery';
const now = new Date();
const thisMonth = now.toISOString().slice(0, 7);
const dayInMonth = (month, d) => `${month}-${String(d).padStart(2, '0')}`;
const isoDaysAgo = (n) => new Date(now.getTime() - n * 86_400_000).toISOString().slice(0, 10);

test('forecast and anomalies API (real PostgreSQL)', { skip: !hasTestDb && 'TEST_DATABASE_URL not set' }, async (t) => {
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
  const catId = async (c, name, kind = 'expense') => (await c.get('/api/categories')).json.categories.find((x) => x.name === name && x.kind === kind).id;
  const add = async (c, type, category, amount, date, description) => {
    const r = await c.post('/api/transactions', { type, amount: String(amount), date, description, categoryId: await catId(c, category, type) });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    return r.json.transaction;
  };

  await t.test('both endpoints require login', async () => {
    assert.equal((await anon.get('/api/forecast')).status, 401);
    assert.equal((await anon.get('/api/anomalies')).status, 401);
  });

  await t.test('new user: forecast says there is not enough history, anomalies are empty', async () => {
    const f = (await asha.get('/api/forecast')).json;
    assert.equal(f.status, 'insufficient_data');
    assert.equal(f.completeMonths, 0);
    assert.deepEqual(f.projections, []);
    const a = (await asha.get('/api/anomalies')).json;
    assert.deepEqual(a.anomalies, []);
    assert.equal(a.checked, 0);
    assert.match(a.notice, /not accusations of fraud/);
  });

  // Four complete months before this one: expenses 10000, 12000, 14000, 16000; income 50000 each.
  const months = [-4, -3, -2, -1].map((n) => addMonths(thisMonth, n));
  for (const [i, m] of months.entries()) {
    await add(asha, 'income', 'Salary', 50000, dayInMonth(m, 1), `Salary ${m}`);
    await add(asha, 'expense', 'Housing', 8000, dayInMonth(m, 3), `Rent ${m}`);
    await add(asha, 'expense', 'Food & Dining', 2000 + i * 2000, dayInMonth(m, 10), `Food ${m}`);
  }

  await t.test('forecast: projection from recorded months, in rupees, with ranges and category detail', async () => {
    const f = (await asha.get('/api/forecast')).json;
    assert.equal(f.status, 'ok');
    assert.equal(f.completeMonths, 4);
    assert.deepEqual(f.history.map((h) => [h.month, h.income, h.expenses]), months.map((m, i) => [m, 50000, 10000 + i * 2000]));
    // weights 1..4 over 10000, 12000, 14000, 16000 -> (10+24+42+64)/10 thousand = 14000
    assert.equal(f.projections.length, 3);
    assert.deepEqual(f.projections.map((p) => p.month), [1, 2, 3].map((n) => addMonths(thisMonth, n)));
    assert.equal(f.projections[0].expenses.expected, 14000);
    assert.equal(f.projections[0].income.expected, 50000);
    assert.equal(f.projections[0].net.expected, 36000);
    const sd = Math.sqrt(5_000_000); // sqrt(mean((x-13000)^2)) = sqrt(5e6)
    assert.ok(Math.abs(f.projections[0].expenses.low - (14000 - sd)) < 0.02);
    assert.ok(Math.abs(f.projections[0].expenses.high - (14000 + sd)) < 0.02);
    assert.deepEqual(f.categories.map((c) => [c.category, c.expected]), [['Housing', 8000], ['Food & Dining', 6000]]);
    assert.ok(f.method.description && f.currentMonth.note);
  });

  await t.test('forecast ignores other users, and the current month never counts as history', async () => {
    assert.equal((await ravi.get('/api/forecast')).json.status, 'insufficient_data');
    await add(ravi, 'expense', 'Shopping', 999999, dayInMonth(thisMonth, 1) <= now.toISOString().slice(0, 10) ? dayInMonth(thisMonth, 1) : isoDaysAgo(0), 'Big one');
    const r = (await ravi.get('/api/forecast')).json;
    assert.equal(r.status, 'insufficient_data');
    assert.equal(r.currentMonth.expenses, 999999);
    assert.equal((await asha.get('/api/forecast')).json.projections[0].expenses.expected, 14000);
  });

  await t.test('anomalies: an outlier and a duplicate are reported, with reasons and transaction ids', async () => {
    for (let i = 0; i < 9; i += 1) await add(asha, 'expense', 'Transport', 300 + i * 5, isoDaysAgo(20 + i), `Cab ${i}`);
    const big = await add(asha, 'expense', 'Transport', 6000, isoDaysAgo(3), 'Airport transfer');
    const d1 = await add(asha, 'expense', 'Shopping', 1499, isoDaysAgo(6), 'Headphones');
    const d2 = await add(asha, 'expense', 'Shopping', 1499, isoDaysAgo(5), 'Headphones');
    const a = (await asha.get('/api/anomalies')).json;
    const out = a.anomalies.find((x) => x.kind === 'unusual_amount');
    assert.ok(out, JSON.stringify(a.anomalies));
    assert.equal(out.transactionId, big.id);
    assert.equal(out.category, 'Transport');
    assert.equal(out.amount, 6000);
    assert.match(out.reason, /your usual Transport transaction/);
    const dup = a.anomalies.find((x) => x.kind === 'possible_duplicate');
    assert.equal(dup.transactionId, d2.id);
    assert.notEqual(dup.transactionId, d1.id);
    assert.equal(a.anomalies[0].severity, 'high', 'most severe first');
    assert.ok(a.checked >= 20);
  });

  await t.test('anomalies are per user', async () => {
    const a = (await ravi.get('/api/anomalies')).json;
    assert.ok(!a.anomalies.some((x) => x.description === 'Airport transfer'));
  });
});
