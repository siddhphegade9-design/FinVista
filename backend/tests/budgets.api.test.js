'use strict';
/** Budgets and simulator endpoints against a real PostgreSQL database. */
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
const { addMonths } = require('../src/budgets/calc');

const PW = 'correct-horse-battery';
const now = new Date();
const thisMonth = now.toISOString().slice(0, 7);
const today = now.toISOString().slice(0, 10);
const day = (month, d) => `${month}-${String(d).padStart(2, '0')}`;
const UUID0 = '3f2b1c9e-8a4d-4e6f-9b1a-2c3d4e5f6a7b';

test('budgets and simulator API (real PostgreSQL)', { skip: !hasTestDb && 'TEST_DATABASE_URL not set' }, async (t) => {
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
  };
  const setBudget = (c, body) => c.put('/api/budgets', body);

  await t.test('every route requires login', async () => {
    const calls = [anon.get('/api/budgets'), anon.get('/api/budgets/suggestions'), anon.put('/api/budgets', {}), anon.post('/api/budgets/copy', {}), anon.del(`/api/budgets/${UUID0}`), anon.get('/api/simulator/baseline'), anon.post('/api/simulator', {})];
    for (const r of await Promise.all(calls)) assert.equal(r.status, 401);
  });

  await t.test('empty month, default month, bad month', async () => {
    const r = (await asha.get('/api/budgets')).json;
    assert.equal(r.month, thisMonth);
    assert.deepEqual(r.rows, []);
    assert.equal(r.totals.limit, 0);
    assert.equal((await asha.get('/api/budgets?month=2026-13')).status, 400);
    assert.equal((await asha.get('/api/budgets?month=abc')).status, 400);
  });

  let foodBudgetId;
  await t.test('set, update and read budgets with actual spending', async () => {
    await add(asha, 'expense', 'Food & Dining', 3500, today, 'Groceries');
    await add(asha, 'expense', 'Transport', 1200, today, 'Cab');
    await add(asha, 'expense', 'Health', 700, today, 'Pharmacy');
    await add(asha, 'income', 'Salary', 50000, today, 'Salary');
    const food = await catId(asha, 'Food & Dining');
    const res = await setBudget(asha, { month: thisMonth, categoryId: food, limit: '5,000' });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    foodBudgetId = res.json.budget.id;
    assert.equal(res.json.budget.limit, 5000);
    await setBudget(asha, { month: thisMonth, categoryId: await catId(asha, 'Transport'), limit: '1000' });
    const again = await setBudget(asha, { month: thisMonth, categoryId: food, limit: '6000' });
    assert.equal(again.json.budget.id, foodBudgetId, 'same row is updated, not duplicated');
    const v = (await asha.get(`/api/budgets?month=${thisMonth}`)).json;
    assert.equal(v.rows.length, 2);
    const by = Object.fromEntries(v.rows.map((r) => [r.category, r]));
    assert.deepEqual([by['Food & Dining'].limit, by['Food & Dining'].spent, by['Food & Dining'].remaining], [6000, 3500, 2500]);
    assert.equal(by['Transport'].status, 'over');
    assert.equal(by['Transport'].remaining, -200);
    assert.deepEqual(v.unbudgeted.map((u) => [u.category, u.spent]), [['Health', 700]]);
    assert.equal(v.totals.totalSpent, 5400);
    assert.equal(v.totals.limit, 7000);
    assert.equal(v.totals.overCount, 1);
  });

  await t.test('overall budget, and other months are independent', async () => {
    assert.equal((await setBudget(asha, { month: thisMonth, categoryId: null, limit: '5000' })).status, 200);
    const v = (await asha.get(`/api/budgets?month=${thisMonth}`)).json;
    assert.equal(v.overall.spent, 5400);
    assert.equal(v.overall.status, 'over');
    const nextMonth = addMonths(thisMonth, 1);
    const n = (await asha.get(`/api/budgets?month=${nextMonth}`)).json;
    assert.deepEqual(n.rows, []);
    assert.equal(n.overall, null);
    assert.equal(n.phase, 'future');
  });

  await t.test('validation: limit, month, category kind and ownership', async () => {
    const bad = await setBudget(asha, { month: 'x', categoryId: 'y', limit: '0' });
    assert.equal(bad.status, 400);
    for (const k of ['month', 'categoryId', 'limit']) assert.ok(bad.json.error.details[k], k);
    const income = await setBudget(asha, { month: thisMonth, categoryId: await catId(asha, 'Salary', 'income'), limit: '100' });
    assert.equal(income.status, 400);
    assert.match(income.json.error.details.categoryId, /expense categories/);
    assert.equal((await setBudget(asha, { month: thisMonth, categoryId: await catId(ravi, 'Housing'), limit: '100' })).status, 400, "another user's category");
    assert.equal((await setBudget(asha, { month: thisMonth, categoryId: UUID0, limit: '100' })).status, 400);
  });

  await t.test('copy budgets to another month, skipping ones already there', async () => {
    const next = addMonths(thisMonth, 1);
    await setBudget(asha, { month: next, categoryId: await catId(asha, 'Food & Dining'), limit: '123' });
    const r = await asha.post('/api/budgets/copy', { fromMonth: thisMonth, toMonth: next });
    assert.equal(r.status, 200);
    assert.equal(r.json.copied, 2, 'Transport and the overall budget; Food already existed');
    const n = (await asha.get(`/api/budgets?month=${next}`)).json;
    assert.equal(n.rows.find((x) => x.category === 'Food & Dining').limit, 123, 'existing limit kept');
    assert.equal((await asha.post('/api/budgets/copy', { fromMonth: addMonths(thisMonth, 5), toMonth: next })).status, 400, 'nothing to copy');
    assert.equal((await asha.post('/api/budgets/copy', { fromMonth: next, toMonth: next })).status, 400);
  });

  await t.test('isolation and delete', async () => {
    assert.deepEqual((await ravi.get(`/api/budgets?month=${thisMonth}`)).json.rows, []);
    assert.equal((await ravi.del(`/api/budgets/${foodBudgetId}`)).status, 404);
    assert.equal((await asha.del(`/api/budgets/${foodBudgetId}`)).status, 204);
    assert.equal((await asha.del(`/api/budgets/${foodBudgetId}`)).status, 404);
    assert.equal((await asha.del('/api/budgets/not-a-uuid')).status, 404);
  });

  await t.test('deleting a category removes its budgets', async () => {
    const transport = await catId(asha, 'Transport');
    assert.ok((await pool.query('SELECT 1 FROM budgets WHERE category_id = $1', [transport])).rowCount > 0);
    await asha.del(`/api/categories/${transport}`);
    assert.equal((await pool.query('SELECT 1 FROM budgets WHERE category_id = $1', [transport])).rowCount, 0);
  });

  await t.test('suggestions need history, then average recent months rounded up', async () => {
    const s0 = (await ravi.get('/api/budgets/suggestions')).json;
    assert.equal(s0.status, 'insufficient_data');
    const months = [-3, -2, -1].map((n) => addMonths(thisMonth, n));
    for (const [i, m] of months.entries()) {
      await add(ravi, 'expense', 'Food & Dining', 3000 + i * 500, day(m, 10), `Food ${m}`);
      await add(ravi, 'expense', 'Shopping', 1001, day(m, 12), `Shop ${m}`);
    }
    await add(ravi, 'expense', 'Food & Dining', 99999, today, 'Current month ignored');
    const s = (await ravi.get('/api/budgets/suggestions')).json;
    assert.equal(s.status, 'ok');
    assert.equal(s.completeMonths, 3);
    assert.deepEqual(s.suggestions.map((x) => [x.category, x.average, x.suggested]), [['Food & Dining', 3500, 3500], ['Shopping', 1001, 1100]]);
    assert.match(s.note, /not what you should spend/);
  });

  /* ---------------------------------------------------------------- simulator */

  await t.test('simulator: new user needs a baseline; a typed baseline works', async () => {
    const fresh = createClient(base);
    await fresh.post('/api/auth/register', { email: 'new@example.com', fullName: 'New U', password: PW });
    const b = (await fresh.get('/api/simulator/baseline')).json;
    assert.equal(b.status, 'needs_baseline');
    const r = (await fresh.post('/api/simulator', { months: 12 })).json;
    assert.equal(r.status, 'needs_baseline');
    const m = await fresh.post('/api/simulator', { baselineIncome: '50000', baselineExpenses: '30000', spendingChangePercent: -10, goalAmount: '200000' });
    assert.equal(m.status, 200, JSON.stringify(m.json));
    assert.equal(m.json.status, 'ok');
    assert.equal(m.json.source, 'manual');
    assert.equal(m.json.baseline.endBalance, 240000);
    assert.equal(m.json.scenario.monthlyExpenses, 27000);
    assert.deepEqual(m.json.goal, { amount: 200000, baselineMonths: 10, scenarioMonths: 9 });
    assert.match(m.json.label, /not predictions or advice/);
    assert.equal((await fresh.post('/api/simulator', { baselineIncome: '50000', baselineExpenses: '30000', categoryCuts: [{ category: 'Food & Dining', percent: 10 }] })).status, 400);
    assert.equal((await fresh.post('/api/simulator', { baselineIncome: '50000' })).status, 400);
  });

  await t.test('simulator: baseline comes from recorded history, with category cuts', async () => {
    const dan = createClient(base);
    await dan.post('/api/auth/register', { email: 'dan@example.com', fullName: 'Dan', password: PW });
    for (const [i, n] of [-4, -3, -2, -1].entries()) {
      const m = addMonths(thisMonth, n);
      await add(dan, 'income', 'Salary', 50000, day(m, 1), `Salary ${m}`);
      await add(dan, 'expense', 'Housing', 8000, day(m, 3), `Rent ${m}`);
      await add(dan, 'expense', 'Food & Dining', 2000 + i * 2000, day(m, 10), `Food ${m}`);
    }
    const info = (await dan.get('/api/simulator/baseline')).json;
    assert.equal(info.status, 'ok');
    assert.equal(info.monthlyIncome, 50000);
    assert.equal(info.monthlyExpenses, 14000);
    assert.deepEqual(info.categories.map((c) => [c.category, c.monthly]), [['Housing', 8000], ['Food & Dining', 6000]]);
    const r = (await dan.post('/api/simulator', { months: 12, categoryCuts: [{ category: 'Food & Dining', percent: 50 }], oneOff: { amount: '10000', atMonth: 2 }, incomeChange: { mode: 'amount', value: 5000 } })).json;
    assert.equal(r.source, 'forecast');
    assert.equal(r.baseline.monthlyNet, 36000);
    assert.equal(r.scenario.monthlyExpenses, 11000);
    assert.equal(r.scenario.monthlyIncome, 55000);
    assert.equal(r.scenario.monthlyNet, 44000);
    assert.equal(r.baseline.endBalance, 432000);
    assert.equal(r.scenario.endBalance, 44000 * 12 - 10000);
    assert.equal(r.difference.endBalance, 44000 * 12 - 10000 - 432000);
    assert.equal(r.series.length, 12);
    const unknown = await dan.post('/api/simulator', { categoryCuts: [{ category: 'Travel', percent: 10 }] });
    assert.equal(unknown.status, 400);
    assert.match(unknown.json.error.details.categoryCuts, /Travel/);
    const bad = await dan.post('/api/simulator', { months: 99, returnPercent: 50, oneOff: { amount: '1', atMonth: 99 } });
    assert.equal(bad.status, 400);
    assert.ok(bad.json.error.details.months && bad.json.error.details.returnPercent);
  });

  await t.test('simulating stores nothing', async () => {
    const before = (await pool.query('SELECT (SELECT count(*) FROM transactions) t, (SELECT count(*) FROM budgets) b')).rows[0];
    await ravi.post('/api/simulator', { baselineIncome: '1000', baselineExpenses: '500' });
    const after = (await pool.query('SELECT (SELECT count(*) FROM transactions) t, (SELECT count(*) FROM budgets) b')).rows[0];
    assert.deepEqual(after, before);
  });
});
