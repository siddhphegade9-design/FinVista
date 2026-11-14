'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const v = require('../src/validation/auth');
const { parseCookies } = require('../src/auth/cookies');
const { createRateLimiter } = require('../src/middleware/rateLimit');
const defaultCategories = require('../src/config/defaultCategories');

test('registration validation normalises and reports field errors', () => {
  const ok = v.validateRegistration({ email: '  Asha@Example.COM ', fullName: '  Asha   K ', password: 'a-long-enough-pass' });
  assert.deepEqual(ok.value, { email: 'asha@example.com', fullName: 'Asha K', password: 'a-long-enough-pass', currency: 'INR' });

  const bad = v.validateRegistration({ email: 'nope', fullName: 'A', password: 'short' });
  assert.deepEqual(Object.keys(bad.errors).sort(), ['email', 'fullName', 'password']);
  assert.ok(v.validateRegistration({}).errors.email);
  assert.ok(v.validateRegistration({ email: 'a@b.co', fullName: 'Asha', password: 'password123' }).errors.password, 'common password rejected');
  assert.ok(v.validateRegistration({ email: 'long.email@example.com', fullName: 'Asha', password: 'long.email@example.com' }).errors.password, 'password equal to email rejected');
  assert.ok(v.validateRegistration({ email: 'a@b.co', fullName: 'Asha', password: 'x'.repeat(129) }).errors.password, 'oversized password rejected');
  assert.ok(v.validateRegistration({ email: 'a@b.co', fullName: 'x'.repeat(101), password: 'a-long-enough-pass' }).errors.fullName);
});

test('passwords are never trimmed', () => {
  const r = v.validateRegistration({ email: 'a@b.co', fullName: 'Asha', password: '  spaces inside and out  ' });
  assert.equal(r.value.password, '  spaces inside and out  ');
});

test('non-string inputs (objects, arrays, numbers) are rejected, not coerced', () => {
  const r = v.validateRegistration({ email: { $ne: '' }, fullName: ['x', 'y'], password: 12345678901234 });
  assert.deepEqual(Object.keys(r.errors).sort(), ['email', 'fullName', 'password']);
  assert.ok(v.validateLogin({ email: 'a@b.co', password: { a: 1 } }).errors.password);
});

test('password change requires a different, acceptable new password', () => {
  assert.ok(v.validatePasswordChange({ currentPassword: 'old-password-1', newPassword: 'old-password-1' }).errors.newPassword);
  assert.ok(v.validatePasswordChange({ currentPassword: '', newPassword: 'brand-new-password' }).errors.currentPassword);
  assert.ok(!v.validatePasswordChange({ currentPassword: 'old-password-1', newPassword: 'brand-new-password' }).errors);
});

test('parseCookies handles multiple, quoted, encoded and malformed cookies', () => {
  assert.deepEqual(parseCookies('a=1; fv_session=abc%20d; b="x y"'), { a: '1', fv_session: 'abc d', b: 'x y' });
  assert.deepEqual(parseCookies(undefined), {});
  assert.deepEqual(parseCookies('novalue; =x; ok=%E0%A4%A'), { ok: '%E0%A4%A' });
});

test('rate limiter counts per key, resets after the window, and sends Retry-After', () => {
  let t = 1000;
  const limiter = createRateLimiter({ windowMs: 60_000, max: 2, now: () => t, keyFn: (req) => req.k });
  const run = (k) => {
    const out = { status: 200, headers: {} };
    const res = { setHeader: (n, val) => { out.headers[n] = val; }, status(s) { out.status = s; return this; }, json(b) { out.body = b; return this; }, on() {} };
    let passed = false;
    limiter({ k }, res, () => { passed = true; });
    return { passed, ...out };
  };
  assert.equal(run('a').passed, true);
  assert.equal(run('a').passed, true);
  const blocked = run('a');
  assert.equal(blocked.passed, false);
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.error.code, 'RATE_LIMITED');
  assert.equal(blocked.headers['Retry-After'], '60');
  assert.equal(run('b').passed, true, 'other keys unaffected');
  t += 60_001;
  assert.equal(run('a').passed, true, 'window reset');
});

test('default categories: backend list matches the frontend list (no drift)', async () => {
  const front = await import('../../frontend/js/core/categories.js');
  assert.deepEqual(defaultCategories.expense, front.EXPENSE_CATEGORIES);
  assert.deepEqual(defaultCategories.income, front.INCOME_CATEGORIES);
});
