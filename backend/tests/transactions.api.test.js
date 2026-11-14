'use strict';
/** End-to-end API tests for transactions and categories against a real PostgreSQL database. */
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
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

test('transactions API (real PostgreSQL)', { skip: !hasTestDb && 'TEST_DATABASE_URL not set' }, async (t) => {
  const pool = createTestPool();
  await resetDatabase(pool);
  await migrate({ pool });
  const { server, base } = await startApp(createApp);
  t.after(async () => { server.close(); await closePool(); await pool.end(); });

  const asha = createClient(base);
  const ravi = createClient(base);
  const anon = createClient(base);
  assert.equal((await asha.post('/api/auth/register', { email: 'asha@example.com', fullName: 'Asha K', password: PW })).status, 201);
  assert.equal((await ravi.post('/api/auth/register', { email: 'ravi@example.com', fullName: 'Ravi S', password: PW })).status, 201);

  const cats = async (c) => (await c.get('/api/categories')).json.categories;
  const ashaCats = await cats(asha);
  const raviCats = await cats(ravi);
  const cat = (list, name, kind) => list.find((c) => c.name === name && c.kind === kind).id;
  const food = cat(ashaCats, 'Food & Dining', 'expense');
  const salary = cat(ashaCats, 'Salary', 'income');
  const rent = cat(ashaCats, 'Housing', 'expense');
  const mk = (o = {}) => ({ type: 'expense', amount: '100.00', description: 'Test', date: today, categoryId: food, ...o });

  await t.test('every transaction and category route requires login', async () => {
    const id = '3f2b1c9e-8a4d-4e6f-9b1a-2c3d4e5f6a7b';
    const calls = [
      anon.get('/api/transactions'), anon.get('/api/transactions/all'), anon.get('/api/transactions/export'),
      anon.post('/api/transactions', mk()), anon.post('/api/transactions/import', { rows: [{}] }),
      anon.get(`/api/transactions/${id}`), anon.put(`/api/transactions/${id}`, mk()), anon.del(`/api/transactions/${id}`),
      anon.get('/api/categories'),
    ];
    for (const res of await Promise.all(calls)) assert.equal(res.status, 401);
  });

  await t.test('categories: user gets their own seeded list, expenses and income', async () => {
    assert.equal(ashaCats.length, 14);
    assert.equal(ashaCats.filter((c) => c.kind === 'income').length, 4);
    const ids = new Set(ashaCats.map((c) => c.id));
    assert.ok(raviCats.every((c) => !ids.has(c.id)), 'categories are per user');
  });

  await t.test('create: returns the stored transaction with a numeric amount and category name', async () => {
    const res = await asha.post('/api/transactions', mk({ amount: '1,250.50', description: '  Lunch   with team ', date: '2026-01-15' }));
    assert.equal(res.status, 201);
    const tx = res.json.transaction;
    assert.equal(tx.amount, 1250.5);
    assert.equal(tx.description, 'Lunch with team');
    assert.equal(tx.date, '2026-01-15', 'date is returned as a plain string, not shifted by timezone');
    assert.equal(tx.category, 'Food & Dining');
    assert.equal(tx.categoryId, food);
    assert.equal(tx.type, 'expense');
    assert.equal(tx.categorySource, 'rule', 'the category matches what the built-in rules suggest ("lunch"), so it is recorded as rule-based');
    const row = (await pool.query('SELECT amount::text AS a, user_id FROM transactions WHERE id = $1', [tx.id])).rows[0];
    assert.equal(row.a, '1250.50', 'stored as exact NUMERIC');
  });

  await t.test('create: validation errors are per field and nothing is stored', async () => {
    const before = (await pool.query('SELECT count(*)::int n FROM transactions')).rows[0].n;
    const res = await asha.post('/api/transactions', { type: 'x', amount: '-5', description: '', date: '2999-01-01', categoryId: 'bad' });
    assert.equal(res.status, 400);
    assert.deepEqual(Object.keys(res.json.error.details).sort(), ['amount', 'categoryId', 'date', 'description', 'type']);
    assert.equal((await pool.query('SELECT count(*)::int n FROM transactions')).rows[0].n, before);
  });

  await t.test('create: category must match the type and belong to the user', async () => {
    const wrongKind = await asha.post('/api/transactions', mk({ type: 'income', categoryId: food }));
    assert.equal(wrongKind.status, 400);
    assert.ok(wrongKind.json.error.details.categoryId);
    const foreign = await asha.post('/api/transactions', mk({ categoryId: cat(raviCats, 'Food & Dining', 'expense') }));
    assert.equal(foreign.status, 400);
    assert.ok(foreign.json.error.details.categoryId);
  });

  // A known data set for list/filter/summary tests.
  const seed = [
    ['income', '50000', 'Salary November', daysAgo(10), salary],
    ['expense', '12000', 'Rent', daysAgo(9), rent],
    ['expense', '450.75', 'Groceries 100% organic', daysAgo(8), food],
    ['expense', '300', 'Cab_ride home', daysAgo(7), food],
    ['expense', '2500', 'Gym membership', daysAgo(6), food],
    ['income', '1500.25', 'Freelance logo', daysAgo(5), cat(ashaCats, 'Freelance', 'income')],
  ];
  const ids = [];
  for (const [type, amount, description, date, categoryId] of seed) {
    const r = await asha.post('/api/transactions', { type, amount, description, date, categoryId });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    ids.push(r.json.transaction.id);
  }
  const TOTAL = seed.length + 1; // plus the January lunch

  await t.test('list: default order is newest first and totals cover all matches', async () => {
    const res = await asha.get('/api/transactions');
    assert.equal(res.status, 200);
    assert.equal(res.json.transactions.length, TOTAL);
    const dates = res.json.transactions.map((x) => x.date);
    assert.deepEqual(dates, [...dates].sort().reverse());
    assert.deepEqual(res.json.summary, { income: 51500.25, expenses: 15250.75 + 1250.5, net: 51500.25 - 15250.75 - 1250.5, count: TOTAL });
    assert.deepEqual(res.json.pagination, { page: 1, pageSize: 20, total: TOTAL, totalPages: 1 });
  });

  await t.test('list: pagination slices rows but the summary still covers everything', async () => {
    const p1 = await asha.get('/api/transactions?pageSize=3&page=1');
    const p3 = await asha.get('/api/transactions?pageSize=3&page=3');
    assert.equal(p1.json.transactions.length, 3);
    assert.equal(p3.json.transactions.length, TOTAL - 6);
    assert.equal(p1.json.pagination.totalPages, Math.ceil(TOTAL / 3));
    assert.equal(p1.json.summary.count, TOTAL);
    const all = [...(await asha.get('/api/transactions?pageSize=3&page=2')).json.transactions, ...p1.json.transactions, ...p3.json.transactions];
    assert.equal(new Set(all.map((x) => x.id)).size, all.length, 'pages never overlap');
    assert.equal((await asha.get('/api/transactions?page=99')).json.transactions.length, 0);
  });

  await t.test('list: filters by type, category, dates, amount range', async () => {
    const q = async (qs) => (await asha.get(`/api/transactions?${qs}`)).json;
    assert.equal((await q('type=income')).summary.count, 2);
    assert.equal((await q(`categoryId=${food}`)).summary.count, 4);
    assert.equal((await q(`from=${daysAgo(8)}&to=${daysAgo(6)}`)).summary.count, 3);
    assert.equal((await q('minAmount=1000&maxAmount=5000')).summary.count, 3, '1250.50, 1500.25 and 2500');
    const combined = await q(`type=expense&categoryId=${food}&minAmount=400`);
    assert.deepEqual(combined.transactions.map((x) => x.description).sort(), ['Gym membership', 'Groceries 100% organic', 'Lunch with team'].sort());
    assert.equal((await q(`from=${today}&to=${today}`)).summary.count, 0);
    assert.deepEqual((await q(`type=income&from=${daysAgo(7)}`)).summary, { income: 1500.25, expenses: 0, net: 1500.25, count: 1 });
  });

  await t.test('list: search is case-insensitive and treats % and _ literally', async () => {
    const q = async (text) => (await asha.get(`/api/transactions?q=${encodeURIComponent(text)}`)).json.transactions.map((x) => x.description);
    assert.deepEqual(await q('RENT'), ['Rent']);
    assert.deepEqual(await q('100%'), ['Groceries 100% organic']);
    assert.deepEqual(await q('%'), ['Groceries 100% organic'], 'a lone % is not a wildcard');
    assert.deepEqual(await q('cab_'), ['Cab_ride home']);
    assert.deepEqual(await q('_'), ['Cab_ride home'], 'a lone _ is not a wildcard');
    assert.deepEqual(await q("'; DROP TABLE transactions; --"), []);
    assert.ok((await pool.query('SELECT 1 FROM transactions LIMIT 1')).rowCount > 0);
  });

  await t.test('list: sorting and validation of query parameters', async () => {
    const desc = (await asha.get('/api/transactions?sort=amount_desc')).json.transactions.map((x) => x.amount);
    assert.deepEqual(desc, [...desc].sort((a, b) => b - a));
    const asc = (await asha.get('/api/transactions?sort=amount_asc')).json.transactions.map((x) => x.amount);
    assert.deepEqual(asc, [...asc].sort((a, b) => a - b));
    for (const bad of ['sort=bogus', 'page=0', 'pageSize=101', 'type=x', 'from=2026-02-30', 'categoryId=zzz', 'minAmount=abc']) {
      assert.equal((await asha.get(`/api/transactions?${bad}`)).status, 400, bad);
    }
  });

  await t.test('update: changes fields, keeps the id, can switch type with a matching category', async () => {
    const id = ids[2];
    const res = await asha.put(`/api/transactions/${id}`, mk({ amount: '500', description: 'Groceries (edited)', date: daysAgo(8), categoryId: rent }));
    assert.equal(res.status, 200);
    assert.equal(res.json.transaction.id, id);
    assert.equal(res.json.transaction.amount, 500);
    assert.equal(res.json.transaction.category, 'Housing');
    const flip = await asha.put(`/api/transactions/${id}`, { type: 'income', amount: '500', description: 'Refund', date: daysAgo(8), categoryId: salary });
    assert.equal(flip.json.transaction.type, 'income');
    const bad = await asha.put(`/api/transactions/${id}`, mk({ type: 'income', categoryId: food }));
    assert.equal(bad.status, 400);
    assert.equal((await asha.get(`/api/transactions/${id}`)).json.transaction.description, 'Refund', 'failed update changes nothing');
    assert.equal((await asha.put('/api/transactions/3f2b1c9e-8a4d-4e6f-9b1a-2c3d4e5f6a7b', mk())).status, 404);
  });

  await t.test('isolation: another user cannot see, edit, delete, filter or list these rows', async () => {
    const id = ids[0];
    assert.equal((await ravi.get(`/api/transactions/${id}`)).status, 404);
    assert.equal((await ravi.put(`/api/transactions/${id}`, mk({ categoryId: cat(raviCats, 'Food & Dining', 'expense') }))).status, 404);
    assert.equal((await ravi.del(`/api/transactions/${id}`)).status, 404);
    const list = await ravi.get('/api/transactions');
    assert.deepEqual(list.json.transactions, []);
    assert.deepEqual(list.json.summary, { income: 0, expenses: 0, net: 0, count: 0 });
    assert.equal((await ravi.get(`/api/transactions?categoryId=${food}`)).json.summary.count, 0);
    assert.deepEqual((await ravi.get('/api/transactions/all')).json.transactions, []);
    assert.ok(!(await ravi.get('/api/transactions/export')).text.includes('Salary November'));
    assert.equal((await asha.get(`/api/transactions/${id}`)).status, 200, 'owner still has it');
  });

  await t.test('delete: removes the row, then 404; malformed ids are 404', async () => {
    const created = (await asha.post('/api/transactions', mk({ description: 'Temp' }))).json.transaction;
    const res = await asha.del(`/api/transactions/${created.id}`);
    assert.equal(res.status, 204);
    assert.equal((await asha.get(`/api/transactions/${created.id}`)).status, 404);
    assert.equal((await asha.del(`/api/transactions/${created.id}`)).status, 404);
    assert.equal((await asha.get('/api/transactions/not-a-uuid')).status, 404);
    assert.equal((await asha.del('/api/transactions/1%20OR%201=1')).status, 404);
  });

  await t.test('all: returns every transaction for the dashboard', async () => {
    const res = await asha.get('/api/transactions/all');
    assert.equal(res.status, 200);
    assert.equal(res.json.transactions.length, TOTAL);
    assert.equal(res.json.truncated, false);
    assert.ok(res.json.transactions.every((x) => typeof x.amount === 'number' && /^\d{4}-\d{2}-\d{2}$/.test(x.date)));
  });

  await t.test('export: CSV with headers, BOM, filters applied, formulas neutralised', async () => {
    const evil = await asha.post('/api/transactions', mk({ description: '=HYPERLINK("http://evil.example","x")', amount: '9.99' }));
    assert.equal(evil.status, 201);
    const res = await asha.get('/api/transactions/export');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /^text\/csv; charset=utf-8/);
    assert.match(res.headers.get('content-disposition'), /^attachment; filename="finvista-transactions-\d{4}-\d{2}-\d{2}\.csv"$/);
    assert.ok(res.text.startsWith('Date,Description,Type,Category,Amount\r\n'), 'header row (text decoding drops the BOM)');
    const raw = new Uint8Array(await (await fetch(`${base}/api/transactions/export`, { headers: { cookie: [...asha.jar].map(([k, val]) => `${k}=${val}`).join('; ') } })).arrayBuffer());
    assert.deepEqual([...raw.slice(0, 3)], [0xef, 0xbb, 0xbf], 'file starts with a UTF-8 byte order mark so Excel reads it correctly');
    assert.ok(res.text.includes(`'=HYPERLINK(""http://evil.example"",""x"")`), 'cell is guarded with a leading apostrophe');
    assert.ok(!/^=/m.test(res.text), 'no line may start a formula');
    const filtered = await asha.get('/api/transactions/export?type=income');
    const rows = filtered.text.trim().split('\r\n');
    assert.equal(rows.length, 1 + 3);
    assert.ok(rows.slice(1).every((r) => r.includes(',income,')));
    assert.equal((await asha.get('/api/transactions/export?type=bad')).status, 400);
  });

  await t.test('import: valid rows are stored, bad rows reported with their row numbers', async () => {
    const res = await asha.post('/api/transactions/import', { rows: [
      { date: '2026-03-01', description: 'Salary March', amount: '60000', type: 'income', category: 'Salary' },
      { date: '05/03/2026', description: 'Rent March', amount: '-15000', category: 'housing' },
      { date: '2026-03-06', description: 'Mystery shop', amount: '(250.00)', category: 'No such category' },
      { date: '2026-03-07', description: 'Bonus', amount: '1000', type: 'income' },
      { date: 'garbage', description: 'Bad date', amount: '5' },
      { date: '2026-03-08', description: 'Bad amount', amount: 'abc' },
    ] });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(res.json.imported, 4);
    assert.deepEqual(res.json.skipped.map((s) => s.row), [5, 6]);
    assert.equal(res.json.defaultedToOther, 2, 'unknown or blank categories are counted');
    const march = (await asha.get('/api/transactions?from=2026-03-01&to=2026-03-31&sort=date_asc')).json.transactions;
    assert.deepEqual(march.map((x) => [x.date, x.type, x.amount, x.category]), [
      ['2026-03-01', 'income', 60000, 'Salary'],
      ['2026-03-05', 'expense', 15000, 'Housing'],
      ['2026-03-06', 'expense', 250, 'Other'],
      ['2026-03-07', 'income', 1000, 'Other income'],
    ]);
  });

  await t.test('import: duplicates of existing rows are skipped unless disabled; atomic insert', async () => {
    const rows = [{ date: '2026-03-01', description: 'salary march', amount: '60000', type: 'income', category: 'Salary' }];
    const dup = await asha.post('/api/transactions/import', { rows });
    assert.equal(dup.json.imported, 0);
    assert.match(dup.json.skipped[0].message, /already exists/i);
    const forced = await asha.post('/api/transactions/import', { rows, skipDuplicates: false });
    assert.equal(forced.json.imported, 1);
    assert.equal((await asha.get('/api/transactions?from=2026-03-01&to=2026-03-01&q=salary')).json.summary.count, 2);
  });

  await t.test('import: limits and isolation', async () => {
    assert.equal((await asha.post('/api/transactions/import', { rows: [] })).status, 400);
    assert.equal((await asha.post('/api/transactions/import', {})).status, 400);
    assert.equal((await asha.post('/api/transactions/import', { rows: new Array(501).fill({ date: '2026-03-01', description: 'x', amount: '1' }) })).status, 400);
    const raviImport = await ravi.post('/api/transactions/import', { rows: [{ date: '2026-03-01', description: 'Salary March', amount: '60000', type: 'income', category: 'Salary' }] });
    assert.equal(raviImport.json.imported, 1, 'duplicates are only checked against your own data');
    const stored = (await pool.query("SELECT user_id FROM transactions WHERE description = 'Salary March' ORDER BY created_at")).rows;
    assert.equal(new Set(stored.map((r) => r.user_id)).size, 2);
    assert.equal((await ravi.get('/api/transactions')).json.summary.count, 1);
  });

  await t.test('security: cross-site writes are blocked; wrong content type rejected', async () => {
    const cross = await asha.post('/api/transactions', mk(), { headers: { 'sec-fetch-site': 'cross-site' } });
    assert.equal(cross.status, 403);
    const form = await asha.request('POST', '/api/transactions', { rawBody: 'type=expense', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    assert.equal(form.status, 415);
    assert.equal((await asha.get('/api/transactions', { headers: { 'sec-fetch-site': 'cross-site' } })).status, 200, 'reads are not blocked by the CSRF guard, only writes');
  });

  await t.test('data safety: money is never stored with more than 2 decimals; DB rejects bad rows directly', async () => {
    assert.equal((await asha.post('/api/transactions', mk({ amount: '1.005' }))).status, 400);
    await assert.rejects(pool.query("INSERT INTO transactions (user_id, category_id, type, amount, description, occurred_on) SELECT user_id, id, 'expense', 0, 'x', now() FROM categories WHERE name = 'Housing' LIMIT 1"), /check|violates/i);
  });

  await t.test('deleting the account removes that user\'s transactions only', async () => {
    const before = (await pool.query('SELECT count(*)::int n FROM transactions')).rows[0].n;
    const raviCount = (await ravi.get('/api/transactions')).json.summary.count;
    assert.equal((await ravi.del('/api/auth/account', { password: PW })).status, 200);
    assert.equal((await pool.query('SELECT count(*)::int n FROM transactions')).rows[0].n, before - raviCount);
    assert.ok((await asha.get('/api/transactions')).json.summary.count > 0);
  });
});
