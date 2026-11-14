'use strict';
/** Security checks: headers, non-public files, request hardening, tenant isolation, injection, production mode. */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
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
const month = today.slice(0, 7);
const UUID0 = '3f2b1c9e-8a4d-4e6f-9b1a-2c3d4e5f6a7b';

function rawGet(base, rawPath) {
  const u = new URL(base);
  return new Promise((resolve, reject) => {
    http.get({ host: u.hostname, port: u.port, path: rawPath }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); }).on('error', reject);
  });
}
// Child-process output: keep only the last line and strip any colour codes or tips another tool may have printed.
const prod = (code) => execFileSync(process.execPath, ['-e', code], { cwd: path.join(__dirname, '..', '..'), env: { ...process.env, NODE_ENV: 'production', DATABASE_URL: '', FORCE_COLOR: '0', NO_COLOR: '1', DOTENV_CONFIG_QUIET: 'true' }, encoding: 'utf8' })
  .replace(/\x1b\[[0-9;]*m/g, '').trim().split(/\r?\n/).filter(Boolean).pop();

test('security: headers, public files, request hardening (no database needed)', async (t) => {
  const { server, base } = await startApp(createApp);
  t.after(() => server.close());
  const c = createClient(base);

  await t.test('pages and API carry the security headers; API responses are never cached', async () => {
    for (const p of ['/', '/api/health']) {
      const r = await c.get(p);
      assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
      assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
      assert.doesNotMatch(r.headers.get('content-security-policy'), /unsafe-inline|unsafe-eval/);
      assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(r.headers.get('x-frame-options'), 'DENY');
      assert.equal(r.headers.get('x-powered-by'), null);
    }
    assert.equal((await c.get('/api/health')).headers.get('cache-control'), 'no-store');
  });

  await t.test('tests, package metadata, dotfiles and path traversal are not served', async () => {
    for (const p of ['/tests/csv.test.js', '/package.json', '/.env', '/node_modules/x', '/Tests/csv.test.js']) assert.equal((await c.get(p)).status, 404, p);
    for (const p of ['/..%2f..%2fpackage.json', '/%2e%2e/package.json', '/%2e%2e%2f.env', '/..%5c..%5cpackage.json']) assert.notEqual(await rawGet(base, p), 200, p);
    assert.equal((await c.get('/index.html')).status, 200);
  });

  await t.test('invalid JSON, oversized bodies, wrong content type and cross-site posts are rejected', async () => {
    assert.equal((await c.post('/api/auth/login', undefined, { rawBody: '{bad', headers: { 'content-type': 'application/json' } })).status, 400);
    const big = await c.post('/api/auth/login', undefined, { rawBody: JSON.stringify({ x: 'a'.repeat(300_000) }), headers: { 'content-type': 'application/json' } });
    assert.equal(big.status, 413);
    assert.equal((await c.post('/api/auth/login', undefined, { rawBody: 'email=a', headers: { 'content-type': 'text/plain' } })).status, 415);
    const body = { email: 'a@example.com', password: PW };
    assert.equal((await c.post('/api/auth/login', body, { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
    assert.equal((await c.post('/api/auth/login', body, { headers: { origin: 'https://evil.example' } })).status, 403);
  });

  await t.test('unknown API paths return JSON 404, not HTML or a stack trace', async () => {
    const r = await c.get('/api/nope');
    assert.equal(r.status, 404);
    assert.equal(r.json.error.code, 'NOT_FOUND');
    assert.doesNotMatch(r.text, /at .*\.js:\d+/);
  });
});

test('security: production mode', async () => {
  const out = JSON.parse(prod(`
    const { cookieOptions } = require('./backend/src/middleware/auth');
    const { securityHeaders } = require('./backend/src/middleware/securityHeaders');
    const { errorHandler } = require('./backend/src/middleware/errorHandler');
    const headers = {}; securityHeaders({}, { removeHeader() {}, setHeader: (k, v) => { headers[k] = v; } }, () => {});
    let sent; const res = { status(s) { sent = { status: s }; return this; }, json(b) { sent.body = b; } };
    const origError = console.error; console.error = () => {};
    errorHandler(new Error('secret db password leaked: hunter2'), {}, res, () => {});
    console.log(JSON.stringify({ cookie: cookieOptions(), hsts: headers['Strict-Transport-Security'], sent }));`));
  assert.equal(out.cookie.secure, true);
  assert.equal(out.cookie.httpOnly, true);
  assert.equal(out.cookie.sameSite, 'lax');
  assert.match(out.hsts, /max-age=31536000/);
  assert.equal(out.sent.status, 500);
  assert.equal(out.sent.body.error.message, 'Something went wrong.');
  assert.doesNotMatch(JSON.stringify(out.sent), /hunter2/);
  // The dev styleguide is hidden in production.
  const status = prod(`
    const { createApp } = require('./backend/src/app');
    const s = createApp().listen(0, async () => { const r = await fetch('http://127.0.0.1:' + s.address().port + '/styleguide.html'); console.log(String(r.status)); s.close(); process.exit(0); });`).trim();
  assert.equal(status, '404', `child process printed: ${JSON.stringify(status)}`);
});

test('security: sessions, tenant isolation and injection (real PostgreSQL)', { skip: !hasTestDb && 'TEST_DATABASE_URL not set' }, async (t) => {
  const pool = createTestPool();
  await resetDatabase(pool);
  await migrate({ pool });
  const { server, base } = await startApp(createApp);
  t.after(async () => { server.close(); await closePool(); await pool.end(); });
  const asha = createClient(base);
  const ravi = createClient(base);
  const reg = await asha.post('/api/auth/register', { email: 'asha@example.com', fullName: 'Asha K', password: PW });
  await ravi.post('/api/auth/register', { email: 'ravi@example.com', fullName: 'Ravi S', password: PW });

  await t.test('session cookie is HttpOnly, SameSite=Lax and the token is not in the response body', async () => {
    const line = reg.setCookie.find((l) => l.startsWith('fv_session='));
    assert.match(line, /HttpOnly/i);
    assert.match(line, /SameSite=Lax/i);
    assert.match(line, /Path=\//i);
    assert.doesNotMatch(reg.text, new RegExp(asha.jar.get('fv_session')));
  });

  await t.test('a logged-out session token cannot be replayed', async () => {
    const stolen = createClient(base);
    const login = await stolen.post('/api/auth/login', { email: 'asha@example.com', password: PW });
    assert.equal(login.status, 200);
    const token = stolen.jar.get('fv_session');
    assert.ok([200, 204].includes((await stolen.post('/api/auth/logout')).status));
    const replay = createClient(base);
    replay.jar.set('fv_session', token);
    assert.equal((await replay.get('/api/transactions')).status, 401);
  });

  await t.test('tenant isolation: user B can never read, change or delete user A\'s records by id', async () => {
    const cat = (await asha.get('/api/categories')).json.categories.find((x) => x.name === 'Food & Dining');
    const tx = (await asha.post('/api/transactions', { type: 'expense', amount: '100', date: today, description: 'Private', categoryId: cat.id })).json.transaction;
    const sip = (await asha.post('/api/sips', { name: 'Mine', instrumentType: 'ppf', monthlyAmount: '1000', startDate: today, stepUpPercent: '0', expectedReturnPercent: '7' })).json.sip;
    const pol = (await asha.post('/api/insurance', { name: 'Mine', policyType: 'health', sumAssured: '100000', premium: '5000', premiumFrequency: 'yearly', nextDueDate: today })).json.policy;
    const bud = (await asha.put('/api/budgets', { month, categoryId: cat.id, limit: '5000' })).json.budget;
    const myCat = (await asha.post('/api/categories', { name: 'Hobby', kind: 'expense' })).json.category;
    for (const [what, x] of [['tx', tx], ['sip', sip], ['policy', pol], ['budget', bud], ['category', myCat]]) assert.ok(x && x.id, `${what} created`);

    const attempts = [
      ['get tx', ravi.get(`/api/transactions/${tx.id}`)],
      ['put tx', ravi.put(`/api/transactions/${tx.id}`, { type: 'expense', amount: '1', date: today, description: 'Hacked', categoryId: cat.id })],
      ['delete tx', ravi.del(`/api/transactions/${tx.id}`)],
      ['get sip', ravi.get(`/api/sips/${sip.id}`)],
      ['put sip', ravi.put(`/api/sips/${sip.id}`, { name: 'Hacked', instrumentType: 'ppf', monthlyAmount: '1', startDate: today, stepUpPercent: '0', expectedReturnPercent: '7' })],
      ['delete sip', ravi.del(`/api/sips/${sip.id}`)],
      ['get policy', ravi.get(`/api/insurance/${pol.id}`)],
      ['delete policy', ravi.del(`/api/insurance/${pol.id}`)],
      ['delete budget', ravi.del(`/api/budgets/${bud.id}`)],
      ['patch category', ravi.patch(`/api/categories/${myCat.id}`, { name: 'Hacked' })],
      ['delete category', ravi.del(`/api/categories/${myCat.id}`)],
    ];
    for (const [name, p] of attempts) assert.equal((await p).status, 404, name);
    // B cannot attach A's category to B's own transaction either
    const own = await ravi.post('/api/transactions', { type: 'expense', amount: '5', date: today, description: 'x', categoryId: cat.id });
    assert.equal(own.status, 400);
    // A's data is untouched
    assert.equal((await asha.get(`/api/transactions/${tx.id}`)).json.transaction.description, 'Private');
    assert.equal((await asha.get('/api/sips')).json.sips.length, 1);
    assert.equal((await asha.get('/api/insurance')).json.policies.length, 1);
    assert.equal((await asha.get(`/api/budgets?month=${month}`)).json.rows.length, 1);
    // B's aggregate views contain nothing of A's
    assert.equal((await ravi.get('/api/transactions')).json.total ?? (await ravi.get('/api/transactions')).json.items?.length ?? 0, 0);
    assert.equal((await ravi.get('/api/reports/monthly')).json.totals.count, 0);
    assert.equal((await ravi.get('/api/advisor/data')).status === 200 ? ((await ravi.get('/api/advisor/data')).json.facts?.commitments?.activeSips ?? 0) : 0, 0);
    assert.equal((await ravi.get('/api/tax/suggestions')).json.items.length, 0);
  });

  await t.test('injection strings are stored as plain text and do not break the database', async () => {
    const cat = (await asha.get('/api/categories')).json.categories.find((x) => x.name === 'Other' && x.kind === 'expense');
    const nasty = ["'); DROP TABLE users;--", '<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '=HYPERLINK("http://evil.example","x")'];
    for (const d of nasty) assert.equal((await asha.post('/api/transactions', { type: 'expense', amount: '1', date: today, description: d, categoryId: cat.id })).status, 201, d);
    const list = (await asha.get('/api/transactions?pageSize=100')).json;
    const descriptions = (list.items || list.transactions).map((x) => x.description);
    for (const d of nasty) assert.ok(descriptions.includes(d), `stored verbatim: ${d}`);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM users')).rows[0].n, 2);
    const csv = (await asha.get('/api/transactions/export')).text;
    assert.ok(csv.includes("'=HYPERLINK"), 'formula cells are neutralised in CSV');
    assert.ok(!/(^|,)"?=HYPERLINK/m.test(csv), 'no cell starts with =');
  });

  await t.test('prototype-pollution payloads have no effect', async () => {
    const r = await asha.post('/api/tax/calculate', { year: '2026-27', grossSalary: '1000000', basicSalary: '400000', __proto__: { polluted: true }, constructor: { prototype: { polluted: true } } });
    assert.ok([200, 400].includes(r.status));
    assert.equal({}.polluted, undefined);
    assert.equal((await asha.post('/api/auth/login', JSON.parse('{"__proto__":{"admin":true},"email":"x@example.com","password":"y"}'))).status >= 400, true);
    assert.equal({}.admin, undefined);
  });

  await t.test('credentials never appear in API responses', async () => {
    const me = (await asha.get('/api/auth/me')).text;
    assert.doesNotMatch(me, /password|hash|salt|fv_session/i);
  });
});
