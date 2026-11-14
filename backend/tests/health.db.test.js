'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || '';
const { createApp } = require('../src/app');
const { closePool } = require('../src/db/pool');
const { hasTestDb } = require('./helpers/testDb');

test('GET /api/health reports database ok with a working database', { skip: !hasTestDb && 'TEST_DATABASE_URL not set' }, async (t) => {
  const server = await new Promise((resolve) => { const s = createApp().listen(0, () => resolve(s)); });
  t.after(async () => { server.close(); await closePool(); });
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/health`);
  assert.equal(res.status, 200);
  assert.deepEqual([(await res.json()).status], ['ok']);
});
