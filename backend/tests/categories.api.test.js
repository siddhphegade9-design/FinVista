'use strict';
/** Categories, rules and auto-categorisation against a real PostgreSQL database. */
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
const UUID0 = '3f2b1c9e-8a4d-4e6f-9b1a-2c3d4e5f6a7b';

test('categories, rules and auto-categorisation (real PostgreSQL)', { skip: !hasTestDb && 'TEST_DATABASE_URL not set' }, async (t) => {
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
  const cats = async (c) => (await c.get('/api/categories')).json.categories;
  const id = async (c, name, kind = 'expense') => (await cats(c)).find((x) => x.name === name && x.kind === kind).id;
  const tx = (c, body) => c.post('/api/transactions', { type: 'expense', amount: '100', date: today, ...body });
  const source = async (txId) => (await pool.query('SELECT category_source s FROM transactions WHERE id = $1', [txId])).rows[0].s;

  await t.test('every route requires login', async () => {
    const calls = [anon.get('/api/categories'), anon.post('/api/categories', {}), anon.patch(`/api/categories/${UUID0}`, {}), anon.del(`/api/categories/${UUID0}`),
      anon.get('/api/categories/rules'), anon.post('/api/categories/rules', {}), anon.del(`/api/categories/rules/${UUID0}`),
      anon.post('/api/categories/suggest', {}), anon.post('/api/categories/reapply', {})];
    for (const r of await Promise.all(calls)) assert.equal(r.status, 401);
  });

  await t.test('list: counts, protected fallbacks, fallbacks last in each group', async () => {
    const list = await cats(asha);
    assert.equal(list.length, 14);
    assert.deepEqual(list.filter((c) => c.protected).map((c) => c.name).sort(), ['Other', 'Other income']);
    assert.equal(list.filter((c) => c.kind === 'expense').at(-1).name, 'Other');
    assert.ok(list.every((c) => c.transactionCount === 0));
  });

  await t.test('create: custom category, trimmed, kind-scoped, duplicates rejected case-insensitively', async () => {
    const res = await asha.post('/api/categories', { name: '  Pets  ', kind: 'expense' });
    assert.equal(res.status, 201);
    assert.equal(res.json.category.name, 'Pets');
    assert.equal(res.json.category.protected, false);
    assert.equal((await asha.post('/api/categories', { name: 'pets', kind: 'expense' })).status, 409);
    assert.equal((await asha.post('/api/categories', { name: 'Pets', kind: 'income' })).status, 201, 'same name is fine in the other kind');
    assert.equal((await asha.post('/api/categories', { name: '', kind: 'expense' })).status, 400);
    assert.equal((await asha.post('/api/categories', { name: 'X', kind: 'nope' })).status, 400);
    assert.equal((await ravi.post('/api/categories', { name: 'Pets', kind: 'expense' })).status, 201, 'names are per user');
  });

  await t.test('rename: works, blocks duplicates, protects the fallbacks, 404 for others', async () => {
    const pets = await id(asha, 'Pets');
    assert.equal((await asha.patch(`/api/categories/${pets}`, { name: 'Pet care' })).json.category.name, 'Pet care');
    assert.equal((await asha.patch(`/api/categories/${pets}`, { name: 'Housing' })).status, 409);
    assert.equal((await asha.patch(`/api/categories/${await id(asha, 'Other')}`, { name: 'Misc' })).status, 400);
    assert.equal((await asha.patch(`/api/categories/${pets}`, { name: 'other' })).status, 400, 'reserved name');
    assert.equal((await ravi.patch(`/api/categories/${pets}`, { name: 'Hacked' })).status, 404);
    assert.equal((await asha.patch('/api/categories/not-a-uuid', { name: 'x' })).status, 404);
  });

  await t.test('auto-categorise on create: built-in rule, fallback, explicit choice', async () => {
    const auto = await tx(asha, { description: 'Swiggy order 123' });
    assert.equal(auto.status, 201, JSON.stringify(auto.json));
    assert.equal(auto.json.transaction.category, 'Food & Dining');
    assert.equal(auto.json.transaction.categorySource, 'rule');

    const unknown = await tx(asha, { description: 'Bolagh purchase' });
    assert.equal(unknown.json.transaction.category, 'Other');
    assert.equal(unknown.json.transaction.categorySource, 'default');

    const income = await asha.post('/api/transactions', { type: 'income', amount: '5', date: today, description: 'Salary Nov' });
    assert.equal(income.json.transaction.category, 'Salary');
    const incomeUnknown = await asha.post('/api/transactions', { type: 'income', amount: '5', date: today, description: 'Birthday gift' });
    assert.equal(incomeUnknown.json.transaction.category, 'Other income');

    const chosen = await tx(asha, { description: 'Swiggy gift card', categoryId: await id(asha, 'Shopping') });
    assert.equal(chosen.json.transaction.category, 'Shopping');
    assert.equal(chosen.json.transaction.categorySource, 'user', 'a choice that differs from the rules is a user choice');
    const agreeing = await tx(asha, { description: 'Swiggy again', categoryId: await id(asha, 'Food & Dining') });
    assert.equal(agreeing.json.transaction.categorySource, 'rule', 'accepting the suggestion keeps it rule-based');
    const pick = await tx(asha, { description: 'Bolagh again', categoryId: await id(asha, 'Other') });
    assert.equal(pick.json.transaction.categorySource, 'user', 'explicitly choosing Other is a user choice');
    assert.equal((await tx(asha, { description: 'x', categoryId: 'bad' })).status, 400);
  });

  await t.test('suggest endpoint: suggestion, source, suggested pattern, validation', async () => {
    const res = await asha.post('/api/categories/suggest', { description: 'UPI payment to Zomato order 77', type: 'expense' });
    assert.equal(res.status, 200);
    assert.equal(res.json.suggestion.category, 'Food & Dining');
    assert.equal(res.json.suggestion.source, 'builtin-rule');
    assert.equal(res.json.suggestedPattern, 'zomato');
    const none = await asha.post('/api/categories/suggest', { description: 'Mystery', type: 'expense' });
    assert.equal(none.json.suggestion, null);
    assert.equal((await asha.post('/api/categories/suggest', { description: '', type: 'expense' })).status, 400);
  });

  await t.test('rules: create, normalise, upsert, validation, listing with built-ins', async () => {
    const shopping = await id(asha, 'Shopping');
    const res = await asha.post('/api/categories/rules', { pattern: '  Big  Bolagh! ', categoryId: shopping });
    assert.equal(res.status, 201);
    assert.equal(res.json.rule.pattern, 'big bolagh');
    assert.equal(res.json.rule.kind, 'expense');
    assert.equal(res.json.updated, 0);
    const again = await asha.post('/api/categories/rules', { pattern: 'big bolagh', categoryId: await id(asha, 'Health') });
    assert.equal(again.status, 201);
    const list = (await asha.get('/api/categories/rules')).json;
    assert.deepEqual(list.rules.map((r) => [r.pattern, r.category]), [['big bolagh', 'Health']], 'same pattern updates the rule instead of duplicating');
    assert.ok(list.builtin.length > 5 && list.builtin.every((b) => Array.isArray(b.keywords)));
    assert.equal((await asha.post('/api/categories/rules', { pattern: 'ab', categoryId: shopping })).status, 400);
    assert.equal((await asha.post('/api/categories/rules', { pattern: 'ok rule', categoryId: UUID0 })).status, 400, 'unknown category');
    assert.equal((await asha.post('/api/categories/rules', { pattern: 'ok rule', categoryId: await id(ravi, 'Housing') })).status, 400, "another user's category");
  });

  await t.test('user rules beat built-ins in new transactions and in suggestions', async () => {
    const shopping = await id(asha, 'Shopping');
    await asha.post('/api/categories/rules', { pattern: 'zomato', categoryId: shopping });
    const res = await tx(asha, { description: 'Zomato gold' });
    assert.equal(res.json.transaction.category, 'Shopping');
    assert.equal(res.json.transaction.categorySource, 'rule');
    assert.equal((await asha.post('/api/categories/suggest', { description: 'Zomato gold', type: 'expense' })).json.suggestion.source, 'user-rule');
    await asha.del(`/api/categories/rules/${(await asha.get('/api/categories/rules')).json.rules.find((r) => r.pattern === 'zomato').id}`);
    assert.equal((await tx(asha, { description: 'Zomato gold' })).json.transaction.category, 'Food & Dining', 'deleting the rule restores the built-in behaviour');
  });

  await t.test('reapply: preview changes nothing; apply moves only automatic categories; user choices are safe', async () => {
    const mk = async (description, extra = {}) => (await tx(asha, { description, ...extra })).json.transaction;
    const autoOne = await mk('Dunzo delivery');           // no rule yet -> Other / default
    const autoTwo = await mk('Dunzo groceries run');      // matches built-in "groceries" -> Food (rule)
    const userPick = await mk('Dunzo pickup', { categoryId: await id(asha, 'Other') }); // user explicitly chose Other
    assert.equal(autoOne.categorySource, 'default');
    assert.equal(autoTwo.category, 'Food & Dining');
    assert.equal(userPick.categorySource, 'user');

    const transport = await id(asha, 'Transport');
    await asha.post('/api/categories/rules', { pattern: 'dunzo', categoryId: transport });

    const preview = (await asha.post('/api/categories/reapply', {})).json;
    assert.equal(preview.applied, 0, 'default is a dry run');
    const previewIds = preview.changes.map((c) => c.description).sort();
    assert.ok(previewIds.includes('Dunzo delivery') && previewIds.includes('Dunzo groceries run'));
    assert.ok(!previewIds.includes('Dunzo pickup'), 'a category the user chose is never touched');
    assert.equal((await asha.get(`/api/transactions/${autoOne.id}`)).json.transaction.category, 'Other', 'preview left the data alone');

    const done = (await asha.post('/api/categories/reapply', { dryRun: false })).json;
    assert.equal(done.applied, done.matchedCount);
    const after = async (t0) => (await asha.get(`/api/transactions/${t0.id}`)).json.transaction;
    assert.equal((await after(autoOne)).category, 'Transport');
    assert.equal((await after(autoOne)).categorySource, 'rule');
    assert.equal((await after(autoTwo)).category, 'Transport', 'auto-assigned rows follow a newer, more specific user rule');
    assert.equal((await after(userPick)).category, 'Other');
    assert.equal((await asha.post('/api/categories/reapply', { dryRun: false })).json.applied, 0, 'idempotent');
  });

  await t.test('creating a rule with applyToExisting updates matching automatic transactions', async () => {
    const one = (await tx(asha, { description: 'Quickcart one' })).json.transaction;
    const two = (await tx(asha, { description: 'QUICKCART two' })).json.transaction;
    const mine = (await tx(asha, { description: 'Quickcart three', categoryId: await id(asha, 'Education') })).json.transaction;
    const res = await asha.post('/api/categories/rules', { pattern: 'quickcart', categoryId: await id(asha, 'Shopping'), applyToExisting: true });
    assert.equal(res.json.updated, 2);
    for (const t0 of [one, two]) assert.equal((await asha.get(`/api/transactions/${t0.id}`)).json.transaction.category, 'Shopping');
    assert.equal((await asha.get(`/api/transactions/${mine.id}`)).json.transaction.category, 'Education');
  });

  await t.test('update keeps an automatic source unless the category actually changes', async () => {
    const created = (await tx(asha, { description: 'Uber ride' })).json.transaction;
    assert.equal(created.categorySource, 'rule');
    const edit = await asha.put(`/api/transactions/${created.id}`, { type: 'expense', amount: '250', date: today, description: 'Uber ride airport', categoryId: created.categoryId });
    assert.equal(edit.json.transaction.categorySource, 'rule', 'changing the amount or text does not make it a user choice');
    const corrected = await asha.put(`/api/transactions/${created.id}`, { type: 'expense', amount: '250', date: today, description: 'Uber ride airport', categoryId: await id(asha, 'Travel') });
    assert.equal(corrected.json.transaction.category, 'Travel');
    assert.equal(corrected.json.transaction.categorySource, 'user');
    assert.equal(await source(created.id), 'user');
    const auto = await asha.put(`/api/transactions/${created.id}`, { type: 'expense', amount: '250', date: today, description: 'Uber ride airport' });
    assert.equal(auto.json.transaction.category, 'Transport', 'omitting the category asks the rules again');
  });

  await t.test('import: category from file, then rules, then Other; counts reported', async () => {
    const res = await asha.post('/api/transactions/import', { rows: [
      { date: '2026-01-02', description: 'Swiggy lunch', amount: '-250' },                         // rule
      { date: '2026-01-03', description: 'Mystery thing', amount: '-10' },                         // default
      { date: '2026-01-04', description: 'Swiggy named', amount: '-99', category: 'Health' },      // file wins
      { date: '2026-01-05', description: 'Salary Jan', amount: '1000', type: 'income' },           // income rule
    ] });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(res.json.imported, 4);
    assert.equal(res.json.categorizedByRules, 2);
    assert.equal(res.json.defaultedToOther, 1);
    const rows = (await asha.get('/api/transactions?from=2026-01-02&to=2026-01-05&sort=date_asc')).json.transactions;
    assert.deepEqual(rows.map((r) => [r.category, r.categorySource]), [['Food & Dining', 'rule'], ['Other', 'default'], ['Health', 'user'], ['Salary', 'rule']]);
  });

  await t.test('delete: transactions move to Other as automatic, rules and fallbacks handled', async () => {
    const pets = await id(asha, 'Pet care');
    const kept = (await tx(asha, { description: 'Vet visit', categoryId: pets })).json.transaction;
    await asha.post('/api/categories/rules', { pattern: 'petsmart', categoryId: pets });
    assert.equal((await cats(asha)).find((c) => c.id === pets).transactionCount, 1);
    const res = await asha.del(`/api/categories/${pets}`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { reassigned: 1, movedTo: 'Other' });
    const moved = (await asha.get(`/api/transactions/${kept.id}`)).json.transaction;
    assert.equal(moved.category, 'Other');
    assert.equal(moved.categorySource, 'default', 'so rules can pick it up again');
    assert.ok(!(await asha.get('/api/categories/rules')).json.rules.some((r) => r.pattern === 'petsmart'), "the category's rules are deleted with it");
    assert.equal((await asha.del(`/api/categories/${pets}`)).status, 404);
    assert.equal((await asha.del(`/api/categories/${await id(asha, 'Other')}`)).status, 400);
    assert.equal((await asha.del(`/api/categories/${await id(asha, 'Other income', 'income')}`)).status, 400);
    assert.equal((await ravi.del(`/api/categories/${await id(asha, 'Housing')}`)).status, 404);
  });

  await t.test('deleting a built-in target category makes its keywords stop applying, not crash', async () => {
    await asha.del(`/api/categories/${await id(asha, 'Entertainment')}`);
    const res = await tx(asha, { description: 'Netflix monthly' });
    assert.equal(res.status, 201);
    assert.equal(res.json.transaction.category, 'Other');
  });

  await t.test("isolation: rules and categories are per user and never affect another user's data", async () => {
    assert.deepEqual((await ravi.get('/api/categories/rules')).json.rules, []);
    const r = await tx(ravi, { description: 'Dunzo order' });
    assert.equal(r.json.transaction.category, 'Other', "Asha's dunzo rule does not apply to Ravi");
    const ravisRule = (await ravi.post('/api/categories/rules', { pattern: 'mine only', categoryId: await id(ravi, 'Health') })).json.rule;
    assert.equal((await asha.del(`/api/categories/rules/${ravisRule.id}`)).status, 404);
    assert.equal((await asha.del(`/api/categories/rules/${UUID0}`)).status, 404);
    assert.equal((await asha.del('/api/categories/rules/not-a-uuid')).status, 404);
  });

  await t.test('database constraints: a rule cannot point at another user\'s category or the wrong kind', async () => {
    const { rows: a } = await pool.query("SELECT id, user_id FROM categories WHERE name = 'Housing' ORDER BY user_id LIMIT 2");
    await assert.rejects(pool.query("INSERT INTO category_rules (user_id, pattern, category_id, kind) VALUES ($1, 'sneaky', $2, 'expense')", [a[0].user_id, a[1].id]), /violates foreign key/);
    await assert.rejects(pool.query("INSERT INTO category_rules (user_id, pattern, category_id, kind) VALUES ($1, 'sneaky', $2, 'income')", [a[0].user_id, a[0].id]), /violates foreign key/);
    await assert.rejects(pool.query("INSERT INTO category_rules (user_id, pattern, category_id, kind) VALUES ($1, 'ab', $2, 'expense')", [a[0].user_id, a[0].id]), /check/);
  });

  await t.test('deleting the account removes the rules too', async () => {
    assert.ok((await pool.query('SELECT count(*)::int n FROM category_rules')).rows[0].n > 0);
    assert.equal((await ravi.del('/api/auth/account', { password: PW })).status, 200);
    assert.equal((await pool.query("SELECT count(*)::int n FROM category_rules WHERE pattern = 'mine only'")).rows[0].n, 0);
  });
});
