'use strict';
/** Analytics API against a real PostgreSQL database, with a hand-checked data set. */
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
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

test('analytics API (real PostgreSQL)', { skip: !hasTestDb && 'TEST_DATABASE_URL not set' }, async (t) => {
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
  const add = async (c, type, categoryName, amount, date, description = 'x') => {
    const res = await c.post('/api/transactions', { type, amount, date, description, categoryId: await catId(c, categoryName, type) });
    assert.equal(res.status, 201, JSON.stringify(res.json));
  };

  // 2026-01-01 is a Thursday. Weekday comments below follow from that.
  await add(asha, 'income', 'Salary', '50000', '2026-01-01', 'Salary Jan');
  await add(asha, 'expense', 'Housing', '12000', '2026-01-05', 'Rent Jan');   // Mon
  await add(asha, 'expense', 'Food & Dining', '3000.25', '2026-01-10');       // Sat
  await add(asha, 'income', 'Salary', '52000', '2026-02-01', 'Salary Feb');   // Sun
  await add(asha, 'expense', 'Housing', '12000', '2026-02-03', 'Rent Feb');   // Tue
  await add(asha, 'expense', 'Food & Dining', '4500.50', '2026-02-14');       // Sat
  await add(asha, 'expense', 'Shopping', '9999.99', '2026-02-20', 'Shoes');   // Fri
  await add(asha, 'expense', 'Housing', '12000', '2026-03-02', 'Rent Mar');   // Mon
  await add(asha, 'expense', 'Food & Dining', '1000', '2026-03-15');          // Sun
  await add(asha, 'income', 'Freelance', '7000.10', '2026-03-31', 'Logo');    // Tue
  // Previous period (2025-10-03 .. 2025-12-31) and one row just outside it.
  await add(asha, 'income', 'Salary', '40000', '2025-12-15');
  await add(asha, 'expense', 'Food & Dining', '20000', '2025-12-15');
  await add(asha, 'expense', 'Food & Dining', '777', '2025-10-02');
  // Another user's data inside the same dates must never leak in.
  await add(ravi, 'income', 'Salary', '999999', '2026-02-02');
  await add(ravi, 'expense', 'Housing', '88888', '2026-02-02');

  const get = async (qs = 'from=2026-01-01&to=2026-03-31') => (await asha.get(`/api/analytics?${qs}`)).json;

  await t.test('requires login; validates the range', async () => {
    assert.equal((await anon.get('/api/analytics')).status, 401);
    for (const bad of ['from=2026-02-30', 'from=2026-05-01&to=2026-04-01', 'to=nope', 'from=2000-01-01&to=2026-01-01']) {
      assert.equal((await asha.get(`/api/analytics?${bad}`)).status, 400, bad);
    }
    const def = await asha.get('/api/analytics');
    assert.equal(def.status, 200, 'default range works with no parameters');
    assert.equal(def.json.months, 6);
  });

  await t.test('totals, net, savings rate and averages are exact', async () => {
    const a = await get();
    assert.deepEqual(a.range, { from: '2026-01-01', to: '2026-03-31' });
    assert.equal(a.months, 3);
    assert.equal(a.totals.income, 109000.10);
    assert.equal(a.totals.expenses, 54500.74);
    assert.equal(a.totals.net, 54499.36);
    assert.equal(a.totals.count, 10);
    close(a.totals.savingsRate, 54499.36 / 109000.10, 'savings rate');
    assert.equal(a.totals.avgMonthlyIncome, 36333.37);
    assert.equal(a.totals.avgMonthlyExpenses, 18166.91);
    assert.equal(a.includesCurrentMonth, false);
  });

  await t.test('monthly series is zero-filled, ordered, and sums to the totals', async () => {
    const a = await get();
    assert.deepEqual(a.monthly, [
      { month: '2026-01', income: 50000, expenses: 15000.25, net: 34999.75, count: 3 },
      { month: '2026-02', income: 52000, expenses: 26500.49, net: 25499.51, count: 4 },
      { month: '2026-03', income: 7000.10, expenses: 13000, net: -5999.90, count: 3 },
    ]);
    assert.deepEqual(a.cumulativeNet.map((x) => x.value), [34999.75, 60499.26, 54499.36]);
    const wide = await get('from=2025-12-01&to=2026-04-30');
    assert.deepEqual(wide.monthly.map((m) => m.month), ['2025-12', '2026-01', '2026-02', '2026-03', '2026-04']);
    assert.equal(wide.monthly[4].count, 0, 'empty months are present with zeros');
  });

  await t.test('category breakdown: amounts, shares and order', async () => {
    const a = await get();
    assert.deepEqual(a.expenseCategories.map((c) => [c.name, c.amount, c.count]), [['Housing', 36000, 3], ['Shopping', 9999.99, 1], ['Food & Dining', 8500.75, 3]]);
    close(a.expenseCategories.reduce((s, c) => s + c.share, 0), 1, 'shares sum');
    close(a.expenseCategories[0].share, 36000 / 54500.74, 'housing share');
    assert.deepEqual(a.incomeCategories.map((c) => [c.name, c.amount]), [['Salary', 102000], ['Freelance', 7000.10]]);
  });

  await t.test('category trend stacks to monthly expenses', async () => {
    const a = await get();
    assert.deepEqual(a.categoryTrend.months, ['2026-01', '2026-02', '2026-03']);
    const byName = Object.fromEntries(a.categoryTrend.series.map((s) => [s.name, s.values]));
    assert.deepEqual(byName.Housing, [12000, 12000, 12000]);
    assert.deepEqual(byName['Food & Dining'], [3000.25, 4500.5, 1000]);
    assert.deepEqual(byName.Shopping, [0, 9999.99, 0]);
    const stack = a.categoryTrend.months.map((_, i) => Math.round(a.categoryTrend.series.reduce((s, x) => s + x.values[i], 0) * 100) / 100);
    assert.deepEqual(stack, a.monthly.map((m) => m.expenses));
  });

  await t.test('weekday spending (Monday first, expenses only)', async () => {
    const a = await get();
    assert.deepEqual(a.weekdays.map((d) => [d.name, d.expenses, d.count]), [
      ['Mon', 24000, 2], ['Tue', 12000, 1], ['Wed', 0, 0], ['Thu', 0, 0], ['Fri', 9999.99, 1], ['Sat', 7500.75, 2], ['Sun', 1000, 1],
    ]);
  });

  await t.test('top expenses are the 5 largest, with stable tie order', async () => {
    const a = await get();
    assert.deepEqual(a.topExpenses.map((x) => [x.date, x.amount]), [['2026-03-02', 12000], ['2026-02-03', 12000], ['2026-01-05', 12000], ['2026-02-20', 9999.99], ['2026-02-14', 4500.5]]);
    assert.equal(a.topExpenses[3].description, 'Shoes');
  });

  await t.test('previous-period comparison uses the equal-length period before', async () => {
    const a = await get();
    assert.deepEqual(a.previousRange, { from: '2025-10-03', to: '2025-12-31' });
    assert.equal(a.comparison.previousIncome, 40000);
    assert.equal(a.comparison.previousExpenses, 20000, 'the 777 row dated 2025-10-02 is outside the previous period');
    close(a.comparison.incomeChange, (109000.10 - 40000) / 40000, 'income change');
    close(a.comparison.expensesChange, (54500.74 - 20000) / 20000, 'expenses change');
    const none = await get('from=2026-03-01&to=2026-03-31'); // 31 days -> previous period is 2026-01-29 .. 2026-02-28
    assert.deepEqual(none.previousRange, { from: '2026-01-29', to: '2026-02-28' });
    assert.equal(none.comparison.previousExpenses, 26500.49, 'February expenses fall in the 31 days before March');
    assert.equal(none.comparison.previousIncome, 52000);
  });

  await t.test('no data in range: zeros and nulls, never NaN', async () => {
    const a = await get('from=2020-01-01&to=2020-02-29');
    assert.equal(a.totals.income, 0);
    assert.equal(a.totals.savingsRate, null);
    assert.equal(a.comparison.incomeChange, null);
    assert.deepEqual(a.expenseCategories, []);
    assert.deepEqual(a.topExpenses, []);
    assert.equal(a.months, 2);
    assert.equal(JSON.stringify(a).includes('NaN'), false);
  });

  await t.test("isolation: another user's transactions never appear, and each user gets only their own", async () => {
    const mine = await get();
    assert.ok(!JSON.stringify(mine).includes('999999') && !JSON.stringify(mine).includes('88888'));
    const theirs = (await ravi.get('/api/analytics?from=2026-01-01&to=2026-03-31')).json;
    assert.equal(theirs.totals.income, 999999);
    assert.equal(theirs.totals.expenses, 88888);
    assert.equal(theirs.totals.count, 2);
  });

  await t.test('analytics agree with the transactions list summary for the same range', async () => {
    const a = await get();
    const list = (await asha.get('/api/transactions?from=2026-01-01&to=2026-03-31')).json.summary;
    assert.equal(a.totals.income, list.income);
    assert.equal(a.totals.expenses, list.expenses);
    assert.equal(a.totals.net, list.net);
    assert.equal(a.totals.count, list.count);
  });
});
