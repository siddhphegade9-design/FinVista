'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { migrate, status, checksum } = require('../src/db/migrate');
const { hasTestDb, createTestPool, resetDatabase } = require('./helpers/testDb');

test('checksum ignores CRLF vs LF line endings', () => {
  assert.equal(checksum('a\r\nb\r\n'), checksum('a\nb\n'));
  assert.notEqual(checksum('a'), checksum('b'));
});

test('migration runner (real PostgreSQL)', { skip: !hasTestDb && 'TEST_DATABASE_URL not set' }, async (t) => {
  const pool = createTestPool();
  t.after(() => pool.end());

  await t.test('applies the real migrations from scratch, then is idempotent', async () => {
    await resetDatabase(pool);
    const first = await migrate({ pool });
    assert.deepEqual(first, ['001_initial_schema.sql', '002_sessions.sql', '003_category_rules.sql', '004_investments_insurance.sql', '005_tax_profiles.sql', '006_user_currency.sql']);
    assert.deepEqual(await migrate({ pool }), []);
    const s = await status({ pool });
    assert.deepEqual(s.pending, []);
    assert.equal(s.applied.length, 6);
    const { rows } = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY 1");
    assert.deepEqual(rows.map((r) => r.table_name), ['budgets', 'categories', 'category_rules', 'insurance_policies', 'schema_migrations', 'sessions', 'sips', 'tax_profiles', 'transactions', 'users']);
  });

  await t.test('rejects a migration file edited after it was applied', async () => {
    await resetDatabase(pool);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fv-mig-'));
    fs.writeFileSync(path.join(dir, '001_a.sql'), 'CREATE TABLE a (id int);');
    await migrate({ pool, dir });
    fs.writeFileSync(path.join(dir, '001_a.sql'), 'CREATE TABLE a (id int, extra int);');
    await assert.rejects(migrate({ pool, dir }), /changed after being applied/);
  });

  await t.test('a failing migration is rolled back completely and later runs can retry', async () => {
    await resetDatabase(pool);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fv-mig-'));
    fs.writeFileSync(path.join(dir, '001_ok.sql'), 'CREATE TABLE ok_table (id int);');
    fs.writeFileSync(path.join(dir, '002_bad.sql'), 'CREATE TABLE half_done (id int); SELECT 1/0;');
    await assert.rejects(migrate({ pool, dir }), /002_bad\.sql failed and was rolled back/);
    const tables = (await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public'")).rows.map((r) => r.table_name);
    assert.ok(tables.includes('ok_table'), '001 stays applied');
    assert.ok(!tables.includes('half_done'), '002 left nothing behind');
    assert.deepEqual((await status({ pool, dir })).pending, ['002_bad.sql']);
    // Fix the file's content -> not "changed after applied" because it was never applied.
    fs.writeFileSync(path.join(dir, '002_bad.sql'), 'CREATE TABLE fixed_table (id int);');
    assert.deepEqual(await migrate({ pool, dir }), ['002_bad.sql']);
  });
});
