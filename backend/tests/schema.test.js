'use strict';
/** Verifies the database itself enforces money, ownership and uniqueness rules. */
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || ''; // app pool -> test DB (set before requiring pool.js)
const { migrate } = require('../src/db/migrate');
const db = require('../src/db/pool');
const { hasTestDb, createTestPool, resetDatabase } = require('./helpers/testDb');

const skip = !hasTestDb && 'TEST_DATABASE_URL not set';

test('database schema (real PostgreSQL)', { skip }, async (t) => {
  const pool = createTestPool();
  t.after(async () => { await pool.end(); await db.closePool(); });
  await resetDatabase(pool);
  await migrate({ pool });

  const q = (text, params) => pool.query(text, params);
  const addUser = async (email) => (await q('INSERT INTO users (email, password_hash, full_name) VALUES ($1, $2, $3) RETURNING id', [email, 'hash', 'Test User'])).rows[0].id;
  const addCat = async (userId, name, kind = 'expense') => (await q('INSERT INTO categories (user_id, name, kind) VALUES ($1, $2, $3) RETURNING id', [userId, name, kind])).rows[0].id;
  const addTx = (userId, catId, type, amount, day = '2026-11-14') =>
    q('INSERT INTO transactions (user_id, category_id, type, amount, description, occurred_on) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id', [userId, catId, type, amount, 'test', day]);

  const alice = await addUser('alice@example.com');
  const bob = await addUser('bob@example.com');
  const aliceFood = await addCat(alice, 'Food', 'expense');
  const aliceSalary = await addCat(alice, 'Salary', 'income');
  const bobFood = await addCat(bob, 'Food', 'expense');

  await t.test('users: emails are unique ignoring case; bad email and empty name rejected', async () => {
    await assert.rejects(addUser('ALICE@example.com'), { code: '23505' });
    await assert.rejects(addUser('no-at-sign'), { code: '23514' });
    await assert.rejects(q("INSERT INTO users (email, password_hash, full_name) VALUES ('x@y.com', 'h', '')"), { code: '23514' });
  });

  await t.test('categories: unique per user/kind ignoring case, but another user may reuse the name', async () => {
    await assert.rejects(addCat(alice, 'FOOD', 'expense'), { code: '23505' });
    await addCat(alice, 'Food', 'income'); // same name, different kind is fine
  });

  await t.test('transactions: valid rows insert; amount must be > 0', async () => {
    await addTx(alice, aliceFood, 'expense', '250.50');
    await assert.rejects(addTx(alice, aliceFood, 'expense', '0'), { code: '23514' });
    await assert.rejects(addTx(alice, aliceFood, 'expense', '-5'), { code: '23514' });
    await assert.rejects(addTx(alice, aliceFood, 'expense', 'abc'), { code: '22P02' }); // not a number
  });

  await t.test('transactions: a category from ANOTHER user is rejected (isolation)', async () => {
    await assert.rejects(addTx(alice, bobFood, 'expense', '10'), { code: '23503' });
  });

  await t.test('transactions: type must match the category kind', async () => {
    await assert.rejects(addTx(alice, aliceFood, 'income', '10'), { code: '23503' });
    await assert.rejects(addTx(alice, aliceSalary, 'expense', '10'), { code: '23503' });
    await addTx(alice, aliceSalary, 'income', '85000');
  });

  await t.test('transactions: invalid type and category_source rejected', async () => {
    await assert.rejects(addTx(alice, aliceFood, 'transfer', '10'), { code: '23514' });
    await assert.rejects(q("UPDATE transactions SET category_source = 'magic' WHERE user_id = $1", [alice]), { code: '23514' });
  });

  await t.test('money is exact: 0.10 + 0.20 sums to 0.30', async () => {
    const u = await addUser('exact@example.com');
    const c = await addCat(u, 'Misc', 'expense');
    await addTx(u, c, 'expense', '0.10');
    await addTx(u, c, 'expense', '0.20');
    const { rows } = await q('SELECT SUM(amount) AS total FROM transactions WHERE user_id = $1', [u]);
    assert.equal(rows[0].total, '0.30');
  });

  await t.test('budgets: month must be the 1st; limit >= 0; one overall budget per month; cross-user category rejected', async () => {
    const ins = (userId, catId, month, limit) => q('INSERT INTO budgets (user_id, category_id, month, limit_amount) VALUES ($1, $2, $3, $4)', [userId, catId, month, limit]);
    await ins(alice, aliceFood, '2026-11-01', '10000');
    await ins(alice, null, '2026-11-01', '50000'); // overall budget
    await assert.rejects(ins(alice, aliceFood, '2026-11-01', '1'), { code: '23505' });
    await assert.rejects(ins(alice, null, '2026-11-01', '1'), { code: '23505' }); // NULL category still unique
    await ins(alice, null, '2026-12-01', '50000'); // another month is fine
    await assert.rejects(ins(alice, aliceFood, '2026-10-15', '1'), { code: '23514' });
    await assert.rejects(ins(alice, aliceFood, '2026-10-01', '-1'), { code: '23514' });
    await assert.rejects(ins(alice, bobFood, '2026-10-01', '1'), { code: '23503' });
  });

  await t.test('updated_at changes on UPDATE', async () => {
    const { rows: [before] } = await q('SELECT id, updated_at FROM transactions WHERE user_id = $1 LIMIT 1', [alice]);
    await new Promise((r) => setTimeout(r, 20));
    await q("UPDATE transactions SET description = 'changed' WHERE id = $1", [before.id]);
    const { rows: [after] } = await q('SELECT updated_at FROM transactions WHERE id = $1', [before.id]);
    assert.ok(after.updated_at > before.updated_at);
  });

  await t.test('deleting a user removes only that user\'s data', async () => {
    await addTx(bob, bobFood, 'expense', '99');
    await q('DELETE FROM users WHERE id = $1', [alice]);
    for (const table of ['transactions', 'categories', 'budgets']) {
      assert.equal((await q(`SELECT count(*)::int AS n FROM ${table} WHERE user_id = $1`, [alice])).rows[0].n, 0, `${table} of deleted user`);
    }
    assert.equal((await q('SELECT count(*)::int AS n FROM transactions WHERE user_id = $1', [bob])).rows[0].n, 1);
    assert.equal((await q('SELECT count(*)::int AS n FROM categories WHERE user_id = $1', [bob])).rows[0].n, 1);
  });

  await t.test('pool module: DATE stays a plain string, NUMERIC stays exact, transactions roll back, health check works', async () => {
    const u = await addUser('pool@example.com');
    const c = await addCat(u, 'Misc', 'expense');
    await addTx(u, c, 'expense', '12.30', '2026-03-01');
    const { rows } = await db.query('SELECT occurred_on, amount FROM transactions WHERE user_id = $1', [u]);
    assert.equal(rows[0].occurred_on, '2026-03-01');
    assert.equal(rows[0].amount, '12.30');

    await assert.rejects(db.withTransaction(async (client) => {
      await client.query("INSERT INTO categories (user_id, name, kind) VALUES ($1, 'Temp', 'expense')", [u]);
      throw new Error('boom');
    }), /boom/);
    assert.equal((await q("SELECT count(*)::int AS n FROM categories WHERE user_id = $1 AND name = 'Temp'", [u])).rows[0].n, 0);

    assert.equal(await db.checkConnection(), true);
  });
});
