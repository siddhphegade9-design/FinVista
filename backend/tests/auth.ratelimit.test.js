'use strict';
/** Own process so the low limits can be set before config loads. */
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || '';
process.env.AUTH_RATE_LIMIT_MAX = '3';
const { createApp } = require('../src/app');
const { migrate } = require('../src/db/migrate');
const { closePool } = require('../src/db/pool');
const { hasTestDb, createTestPool, resetDatabase } = require('./helpers/testDb');
const { createClient, startApp } = require('./helpers/client');

test('auth rate limiting (real PostgreSQL)', { skip: !hasTestDb && 'TEST_DATABASE_URL not set' }, async (t) => {
  const pool = createTestPool();
  await resetDatabase(pool);
  await migrate({ pool });
  const { server, base } = await startApp(createApp);
  t.after(async () => { server.close(); await closePool(); await pool.end(); });

  await t.test('failed logins are limited per IP with Retry-After; legitimate login resumes after reset is not required for other emails', async () => {
    const c = createClient(base);
    await c.post('/api/auth/register', { email: 'rl@example.com', fullName: 'Rate Limit', password: 'a-long-enough-password' });
    await c.post('/api/auth/logout');
    const attempt = (email) => createClient(base).post('/api/auth/login', { email, password: 'wrong-password-1' });
    for (let i = 0; i < 3; i++) assert.equal((await attempt(`victim${i}@example.com`)).status, 401);
    const blocked = await attempt('victim9@example.com');
    assert.equal(blocked.status, 429);
    assert.equal(blocked.json.error.code, 'RATE_LIMITED');
    assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  });

  await t.test('registration is limited per IP', async () => {
    // One registration used above (success counts for register). Two more fit, the next is blocked.
    const r = (n) => createClient(base).post('/api/auth/register', { email: `new${n}@example.com`, fullName: 'New User', password: 'a-long-enough-password' });
    assert.equal((await r(1)).status, 201);
    assert.equal((await r(2)).status, 201);
    assert.equal((await r(3)).status, 429);
  });
});
