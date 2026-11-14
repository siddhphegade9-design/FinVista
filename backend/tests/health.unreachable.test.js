'use strict';
/** Runs in its own process so DATABASE_URL can point at a closed port before config loads. */
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.DATABASE_URL = 'postgresql://nobody:nopass@127.0.0.1:1/none';
const { createApp } = require('../src/app');
const { closePool } = require('../src/db/pool');

test('GET /api/health reports 503 degraded when the configured database is unreachable (and hides details)', async (t) => {
  const server = await new Promise((resolve) => { const s = createApp().listen(0, () => resolve(s)); });
  t.after(async () => { server.close(); await closePool(); });
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/health`);
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.status, 'degraded');
  assert.equal(body.database, 'unreachable');
  assert.doesNotMatch(JSON.stringify(body), /nopass|127\.0\.0\.1|ECONNREFUSED/);
});
