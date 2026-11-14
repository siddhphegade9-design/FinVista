'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.DATABASE_URL = '';
const { createApp } = require('../src/app');
const { createClient, startApp } = require('./helpers/client');

test('auth endpoints return a clear 503 when no database is configured (and the server stays up)', async (t) => {
  const { server, base } = await startApp(createApp);
  t.after(() => server.close());
  const c = createClient(base);
  // No cookie -> nothing to look up -> anonymous answer without touching the database.
  assert.deepEqual((await c.get('/api/auth/session')).json, { user: null });
  // A cookie needs a lookup -> clear 503.
  c.jar.set('fv_session', 'A'.repeat(43));
  const session = await c.get('/api/auth/session');
  assert.equal(session.status, 503);
  assert.equal(session.json.error.code, 'DATABASE_NOT_CONFIGURED');
  assert.equal((await c.post('/api/auth/login', { email: 'a@b.co', password: 'x' })).status, 503);
  assert.equal((await c.post('/api/auth/register', { email: 'a@b.co', fullName: 'Aa', password: 'a-long-enough-pass' })).status, 503);
  // A request that fails validation never needs the database.
  assert.equal((await c.post('/api/auth/register', {})).status, 400);
  assert.equal((await c.get('/api/health')).status, 200);
});
