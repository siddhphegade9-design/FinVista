'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.DATABASE_URL = ''; // deterministic: these tests run with no database configured
const { createApp } = require('../src/app');

let server; let base;
test.before(async () => {
  await new Promise((resolve) => { server = createApp().listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

test('GET /api/health returns ok JSON', async () => {
  const res = await fetch(`${base}/api/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.service, 'finvista');
  assert.equal(body.database, 'not_configured');
});

test('unknown API path returns JSON 404', async () => {
  const res = await fetch(`${base}/api/nope`);
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error.code, 'NOT_FOUND');
});

test('security headers are present and X-Powered-By is hidden', async () => {
  const res = await fetch(`${base}/api/health`);
  assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('x-powered-by'), null);
});

test('serves the frontend and vendored Chart.js', async () => {
  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /FinVista/);
  const chart = await fetch(`${base}/vendor/chart.js/chart.umd.js`);
  assert.equal(chart.status, 200);
});

test('invalid JSON body returns a 400 INVALID_JSON error', async () => {
  const res = await fetch(`${base}/api/health`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, 'INVALID_JSON');
});
