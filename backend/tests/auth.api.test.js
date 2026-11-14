'use strict';
/** End-to-end API tests for authentication against a real PostgreSQL database. */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || '';
process.env.AUTH_RATE_LIMIT_MAX = '100'; // rate limiting has its own test file
const { createApp } = require('../src/app');
const { migrate } = require('../src/db/migrate');
const { closePool } = require('../src/db/pool');
const { hasTestDb, createTestPool, resetDatabase } = require('./helpers/testDb');
const { createClient, startApp } = require('./helpers/client');

const PW = 'correct-horse-battery';
const reg = (email, name = 'Asha Kulkarni', password = PW) => ({ email, fullName: name, password });

test('authentication API (real PostgreSQL)', { skip: !hasTestDb && 'TEST_DATABASE_URL not set' }, async (t) => {
  const pool = createTestPool();
  await resetDatabase(pool);
  await migrate({ pool });
  const { server, base } = await startApp(createApp);
  t.after(async () => { server.close(); await closePool(); await pool.end(); });
  const count = async (sql, params) => (await pool.query(sql, params)).rows[0].n;

  await t.test('register: creates the user, sets a secure session cookie, seeds default categories', async () => {
    const c = createClient(base);
    const res = await c.post('/api/auth/register', reg('Asha@Example.com'));
    assert.equal(res.status, 201);
    assert.equal(res.json.user.email, 'asha@example.com');
    assert.equal(res.json.user.fullName, 'Asha Kulkarni');
    assert.ok(res.json.user.id);
    assert.ok(!/password|hash|scrypt/i.test(res.text), 'response must not leak credentials');

    const cookie = res.setCookie.find((l) => l.startsWith('fv_session='));
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
    assert.match(cookie, /Path=\//);
    assert.match(cookie, /Expires=/i);

    // Stored credentials: hashed password, hashed session token.
    const { rows: [row] } = await pool.query('SELECT password_hash FROM users WHERE email = $1', ['asha@example.com']);
    assert.match(row.password_hash, /^scrypt\$/);
    assert.ok(!row.password_hash.includes(PW));
    const token = c.jar.get('fv_session');
    const expected = crypto.createHash('sha256').update(token).digest('hex');
    assert.equal(await count('SELECT count(*)::int AS n FROM sessions WHERE id_hash = $1', [expected]), 1);
    assert.equal(await count('SELECT count(*)::int AS n FROM sessions WHERE id_hash = $1', [token]), 0, 'raw token is never stored');

    assert.equal(await count('SELECT count(*)::int AS n FROM categories WHERE user_id = $1', [res.json.user.id]), 14);
    assert.equal(await count("SELECT count(*)::int AS n FROM categories WHERE user_id = $1 AND kind = 'income'", [res.json.user.id]), 4);
  });

  await t.test('session endpoint: logged in returns the user, anonymous/garbage cookies return null (always 200)', async () => {
    const c = createClient(base);
    assert.deepEqual((await c.get('/api/auth/session')).json, { user: null });
    await c.post('/api/auth/login', { email: 'asha@example.com', password: PW });
    const s = await c.get('/api/auth/session');
    assert.equal(s.status, 200);
    assert.equal(s.json.user.email, 'asha@example.com');
    const forged = createClient(base);
    forged.jar.set('fv_session', 'A'.repeat(43));
    assert.deepEqual((await forged.get('/api/auth/session')).json, { user: null });
    forged.jar.set('fv_session', "'; DROP TABLE users; --");
    assert.equal((await forged.get('/api/auth/session')).status, 200);
    assert.equal(await count("SELECT count(*)::int AS n FROM users WHERE email = 'asha@example.com'"), 1);
  });

  await t.test('register: validation errors are per field (400)', async () => {
    const c = createClient(base);
    const bad = await c.post('/api/auth/register', { email: 'nope', fullName: 'A', password: 'short' });
    assert.equal(bad.status, 400);
    assert.equal(bad.json.error.code, 'BAD_REQUEST');
    assert.deepEqual(Object.keys(bad.json.error.details).sort(), ['email', 'fullName', 'password']);
    assert.equal((await c.post('/api/auth/register', {})).status, 400);
    assert.equal((await c.post('/api/auth/register', reg('weak@example.com', 'Weak Pw', 'password1234'))).status, 400);
    assert.equal(await count("SELECT count(*)::int AS n FROM users WHERE email IN ('nope','weak@example.com')"), 0);
  });

  await t.test('register: duplicate email (any letter case) is a 409 and creates nothing', async () => {
    const before = await count('SELECT count(*)::int AS n FROM users');
    const res = await createClient(base).post('/api/auth/register', reg('ASHA@example.COM', 'Impostor'));
    assert.equal(res.status, 409);
    assert.equal(res.json.error.code, 'CONFLICT');
    assert.equal(await count('SELECT count(*)::int AS n FROM users'), before);
  });

  await t.test('login: wrong password and unknown email give the same 401 (no account enumeration)', async () => {
    const c = createClient(base);
    const wrong = await c.post('/api/auth/login', { email: 'asha@example.com', password: 'not-the-password' });
    const unknown = await c.post('/api/auth/login', { email: 'ghost@example.com', password: 'not-the-password' });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.deepEqual(wrong.json, unknown.json);
    assert.equal(wrong.json.error.code, 'INVALID_CREDENTIALS');
    assert.equal(wrong.setCookie.length, 0, 'no session on failure');
  });

  await t.test('login: succeeds (case-insensitive email), rejects malformed bodies, rotates the session', async () => {
    const c = createClient(base);
    const first = await c.post('/api/auth/login', { email: 'ASHA@example.com', password: PW });
    assert.equal(first.status, 200);
    assert.equal(first.json.user.email, 'asha@example.com');
    assert.ok(!/password|hash|scrypt/i.test(first.text));
    const oldToken = c.jar.get('fv_session');
    const second = await c.post('/api/auth/login', { email: 'asha@example.com', password: PW });
    assert.equal(second.status, 200);
    assert.notEqual(c.jar.get('fv_session'), oldToken);
    assert.equal(await count('SELECT count(*)::int AS n FROM sessions WHERE id_hash = $1', [crypto.createHash('sha256').update(oldToken).digest('hex')]), 0, 'pre-login session removed');

    assert.equal((await c.post('/api/auth/login', { email: 'asha@example.com' })).status, 400);
    assert.equal((await c.post('/api/auth/login', { email: { $gt: '' }, password: { $gt: '' } })).status, 400, 'object injection rejected');
    assert.equal((await c.post('/api/auth/login', {})).status, 400);
  });

  await t.test('logout: invalidates the session server-side, clears the cookie, and is safe when anonymous', async () => {
    const c = createClient(base);
    await c.post('/api/auth/login', { email: 'asha@example.com', password: PW });
    const token = c.jar.get('fv_session');
    const out = await c.post('/api/auth/logout');
    assert.equal(out.status, 200);
    assert.match(out.setCookie.find((l) => l.startsWith('fv_session=')), /Expires=Thu, 01 Jan 1970/i);
    const replay = createClient(base);
    replay.jar.set('fv_session', token); // a copied cookie must no longer work
    assert.deepEqual((await replay.get('/api/auth/session')).json, { user: null });
    assert.equal((await createClient(base).post('/api/auth/logout')).status, 200);
  });

  await t.test('protected routes return 401 without a session', async () => {
    const c = createClient(base);
    assert.equal((await c.patch('/api/auth/profile', { fullName: 'Hacker' })).status, 401);
    assert.equal((await c.post('/api/auth/change-password', { currentPassword: PW, newPassword: 'another-long-pass' })).status, 401);
    assert.equal((await c.del('/api/auth/account', { password: PW })).status, 401);
    const res = await c.patch('/api/auth/profile', { fullName: 'Hacker' });
    assert.equal(res.json.error.code, 'UNAUTHORIZED');
  });

  await t.test('expired sessions are rejected', async () => {
    const c = createClient(base);
    await c.post('/api/auth/login', { email: 'asha@example.com', password: PW });
    assert.ok((await c.get('/api/auth/session')).json.user);
    await pool.query("UPDATE sessions SET expires_at = now() - interval '1 second'");
    assert.deepEqual((await c.get('/api/auth/session')).json, { user: null });
  });

  await t.test('profile: updates the name with validation', async () => {
    const c = createClient(base);
    await c.post('/api/auth/login', { email: 'asha@example.com', password: PW });
    const ok = await c.patch('/api/auth/profile', { fullName: '  Asha   Patil ' });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.user.fullName, 'Asha Patil');
    assert.equal((await c.get('/api/auth/session')).json.user.fullName, 'Asha Patil');
    assert.equal((await c.patch('/api/auth/profile', { fullName: 'x' })).status, 400);
  });

  await t.test('users only ever see their own identity', async () => {
    const bob = createClient(base);
    assert.equal((await bob.post('/api/auth/register', reg('bob@example.com', 'Bob Rao'))).status, 201);
    const alice = createClient(base);
    await alice.post('/api/auth/login', { email: 'asha@example.com', password: PW });
    assert.equal((await bob.get('/api/auth/session')).json.user.email, 'bob@example.com');
    assert.equal((await alice.get('/api/auth/session')).json.user.email, 'asha@example.com');
    // Bob editing his profile never touches Alice.
    await bob.patch('/api/auth/profile', { fullName: 'Bob Changed' });
    assert.equal((await alice.get('/api/auth/session')).json.user.fullName, 'Asha Patil');
  });

  await t.test('change password: checks current password, signs out other devices, keeps this one', async () => {
    const laptop = createClient(base);
    const phone = createClient(base);
    await laptop.post('/api/auth/login', { email: 'asha@example.com', password: PW });
    await phone.post('/api/auth/login', { email: 'asha@example.com', password: PW });

    const wrong = await laptop.post('/api/auth/change-password', { currentPassword: 'wrong-wrong-wrong', newPassword: 'a-new-long-password' });
    assert.equal(wrong.status, 400);
    assert.ok(wrong.json.error.details.currentPassword);
    assert.equal((await laptop.post('/api/auth/change-password', { currentPassword: PW, newPassword: PW })).status, 400, 'must differ');
    assert.equal((await laptop.post('/api/auth/change-password', { currentPassword: PW, newPassword: 'short' })).status, 400);

    const ok = await laptop.post('/api/auth/change-password', { currentPassword: PW, newPassword: 'a-new-long-password' });
    assert.equal(ok.status, 200);
    assert.ok((await laptop.get('/api/auth/session')).json.user, 'current device stays signed in');
    assert.deepEqual((await phone.get('/api/auth/session')).json, { user: null }, 'other device signed out');

    assert.equal((await createClient(base).post('/api/auth/login', { email: 'asha@example.com', password: PW })).status, 401, 'old password dead');
    assert.equal((await createClient(base).post('/api/auth/login', { email: 'asha@example.com', password: 'a-new-long-password' })).status, 200);
  });

  await t.test('CSRF: cross-site origins, cross-site fetch metadata and non-JSON bodies are refused', async () => {
    const creds = { email: 'asha@example.com', password: 'a-new-long-password' };
    const evil = await createClient(base).post('/api/auth/login', creds, { headers: { origin: 'https://evil.example' } });
    assert.equal(evil.status, 403);
    assert.equal(evil.json.error.code, 'CROSS_SITE_BLOCKED');
    assert.equal((await createClient(base).post('/api/auth/login', creds, { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
    assert.equal((await createClient(base).post('/api/auth/login', creds, { headers: { origin: 'null' } })).status, 403);
    const form = await createClient(base).request('POST', '/api/auth/login', { rawBody: 'email=asha@example.com&password=x', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    assert.equal(form.status, 415);
    const plain = await createClient(base).request('POST', '/api/auth/login', { rawBody: JSON.stringify(creds), headers: { 'content-type': 'text/plain' } });
    assert.equal(plain.status, 415);
    const sameOrigin = new URL(base).host;
    assert.equal((await createClient(base).post('/api/auth/login', creds, { headers: { origin: `http://${sameOrigin}`, 'sec-fetch-site': 'same-origin' } })).status, 200);
  });

  await t.test('API responses are never cacheable and carry security headers', async () => {
    const res = await createClient(base).get('/api/auth/session');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  });

  await t.test('delete account: needs the password, then removes the user, their data and sessions', async () => {
    const c = createClient(base);
    const reg1 = await c.post('/api/auth/register', reg('temp@example.com', 'Temp User'));
    const id = reg1.json.user.id;
    await pool.query("INSERT INTO transactions (user_id, category_id, type, amount, description, occurred_on) SELECT $1, id, 'expense', 10, 'x', '2026-11-01' FROM categories WHERE user_id = $1 AND kind = 'expense' LIMIT 1", [id]);
    const bobBefore = await count("SELECT count(*)::int AS n FROM categories WHERE user_id = (SELECT id FROM users WHERE email = 'bob@example.com')");

    assert.equal((await c.del('/api/auth/account', { password: 'wrong-password-here' })).status, 401);
    assert.ok((await c.get('/api/auth/session')).json.user, 'still logged in after a failed delete');
    assert.equal((await c.del('/api/auth/account', {})).status, 400);

    const del = await c.del('/api/auth/account', { password: PW });
    assert.equal(del.status, 200);
    assert.deepEqual((await c.get('/api/auth/session')).json, { user: null });
    for (const table of ['categories', 'transactions', 'sessions']) {
      assert.equal(await count(`SELECT count(*)::int AS n FROM ${table} WHERE user_id = $1`, [id]), 0, table);
    }
    assert.equal(await count('SELECT count(*)::int AS n FROM users WHERE id = $1', [id]), 0);
    assert.equal((await createClient(base).post('/api/auth/login', { email: 'temp@example.com', password: PW })).status, 401);
    assert.equal(await count("SELECT count(*)::int AS n FROM categories WHERE user_id = (SELECT id FROM users WHERE email = 'bob@example.com')"), bobBefore, 'other users untouched');
  });
});
