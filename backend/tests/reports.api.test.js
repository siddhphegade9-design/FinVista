'use strict';
/** Health score and monthly report endpoints against a real PostgreSQL database. */
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
const { addMonths } = require('../src/services/reports');

const PW = 'correct-horse-battery';
const now = new Date();
const thisMonth = now.toISOString().slice(0, 7);
const m1 = addMonths(thisMonth, -1);
const m2 = addMonths(thisMonth, -2);
const m3 = addMonths(thisMonth, -3);

test('reports API (real PostgreSQL)', { skip: !hasTestDb && 'TEST_DATABASE_URL not set' }, async (t) => {
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
  const catId = async (c, name, kind) => (await c.get('/api/categories')).json.categories.find((x) => x.name === name && x.kind === kind).id;
  const add = async (c, type, category, amount, date, description) => {
    const r = await c.post('/api/transactions', { type, amount: String(amount), date, description, categoryId: await catId(c, category, type) });
    assert.equal(r.status, 201, JSON.stringify(r.json));
  };

  await t.test('every route requires login', async () => {
    for (const r of await Promise.all([anon.get('/api/reports/health-score'), anon.get('/api/reports/monthly')])) assert.equal(r.status, 401);
  });

  await t.test('a new user gets "insufficient data", not a made-up score', async () => {
    const r = (await asha.get('/api/reports/health-score')).json;
    assert.equal(r.status, 'insufficient_data');
    assert.equal(r.score, null);
    assert.match(r.notice, /not a credit score/);
  });

  await t.test('score uses the last complete months, SIPs, health policy and budgets', async () => {
    for (const mo of [m3, m2, m1]) { await add(asha, 'income', 'Salary', 100000, `${mo}-02`, 'Salary'); await add(asha, 'expense', 'Housing', 60000, `${mo}-05`, 'Rent'); }
    await add(asha, 'income', 'Salary', 999999, `${thisMonth}-01`, 'Current month must be ignored'); // not a complete month
    const before = (await asha.get('/api/reports/health-score')).json;
    assert.equal(before.status, 'ok');
    assert.deepEqual(before.basedOn.months, [m3, m2, m1]);
    const savings = before.components.find((c) => c.key === 'savings');
    assert.equal(savings.points, 35); // 40% saved, full marks
    assert.equal(before.components.find((c) => c.key === 'budgets').scored, false);
    // add SIP (10% of income) and a health policy, then a budget that was kept
    assert.equal((await asha.post('/api/sips', { name: 'Index', instrumentType: 'mutual_fund', monthlyAmount: '10000', startDate: `${m3}-01`, stepUpPercent: '0', expectedReturnPercent: '10' })).status, 201);
    assert.equal((await asha.post('/api/insurance', { name: 'Health', policyType: 'health', sumAssured: '500000', premium: '12000', premiumFrequency: 'yearly', nextDueDate: `${thisMonth}-28` })).status, 201);
    assert.equal((await asha.put('/api/budgets', { month: m1, categoryId: await catId(asha, 'Housing', 'expense'), limit: '80000' })).status, 200);
    const after = (await asha.get('/api/reports/health-score')).json;
    const by = Object.fromEntries(after.components.map((c) => [c.key, c]));
    assert.equal(by.investing.points, 20);
    assert.equal(by.cover.points, 15);
    assert.equal(by.budgets.points, 20);
    assert.equal(by.stability.points, 10);
    assert.equal(after.score, 100);
    assert.match(after.message, /all 5/);
  });

  await t.test('score is per user', async () => {
    assert.equal((await ravi.get('/api/reports/health-score')).json.status, 'insufficient_data');
  });

  await t.test('monthly report: totals, categories, budgets, comparison with the previous month', async () => {
    await add(asha, 'expense', 'Food & Dining', 5000, `${m1}-10`, 'Groceries');
    const r = (await asha.get(`/api/reports/monthly?month=${m1}`)).json;
    assert.equal(r.status, 'complete');
    assert.equal(r.totals.income, 100000);
    assert.equal(r.totals.expenses, 65000);
    assert.equal(r.previousMonth.expenses, 60000);
    assert.equal(r.previousMonth.expensesChange, 0.083);
    assert.equal(r.expenseCategories[0].name, 'Housing');
    assert.equal(r.budgets.rows.length, 1);
    assert.equal(r.budgets.rows[0].status, 'ok');
    assert.equal(r.notice, null);
  });

  await t.test('current month is labelled in progress; bad months are rejected; reports are per user', async () => {
    const cur = (await asha.get('/api/reports/monthly')).json;
    assert.equal(cur.month, thisMonth);
    assert.equal(cur.status, 'in_progress');
    assert.match(cur.notice, /not finished/);
    assert.equal((await asha.get('/api/reports/monthly?month=2026-13')).status, 400);
    assert.equal((await asha.get('/api/reports/monthly?month=abc')).status, 400);
    const other = (await ravi.get(`/api/reports/monthly?month=${m1}`)).json;
    assert.equal(other.totals.income, 0);
    assert.equal(other.expenseCategories.length, 0);
  });
});
