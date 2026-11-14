'use strict';
const express = require('express');
const config = require('../config/env');
const asyncHandler = require('../utils/asyncHandler');
const { badRequest, unauthorized, HttpError } = require('../utils/httpError');
const { createRateLimiter } = require('../middleware/rateLimit');
const { loadSession, requireAuth, cookieOptions } = require('../middleware/auth');
const { hashPassword, verifyPassword, needsRehash, verifyAgainstDummy } = require('../auth/password');
const sessions = require('../auth/sessions');
const users = require('../services/users');
const v = require('../validation/auth');

const router = express.Router();

const { authMax, authWindowMs } = config.rateLimit;
const tooMany = 'Too many attempts. Please wait a few minutes and try again.';
// Registration: per IP. Login: per IP and per email (failed attempts only count). Password checks: per user.
const registerLimiter = createRateLimiter({ windowMs: authWindowMs, max: authMax, message: tooMany });
const loginIpLimiter = createRateLimiter({ windowMs: authWindowMs, max: authMax, skipSuccessful: true, message: tooMany });
const loginEmailLimiter = createRateLimiter({
  windowMs: authWindowMs, max: authMax * 2, skipSuccessful: true, message: tooMany,
  keyFn: (req) => (typeof req.body?.email === 'string' ? `email:${req.body.email.trim().toLowerCase().slice(0, 254)}` : null),
});
const accountLimiter = createRateLimiter({ windowMs: authWindowMs, max: authMax, skipSuccessful: true, message: tooMany, keyFn: (req) => req.user?.id ?? req.ip });

/** Validation failures -> 400 with per-field messages. */
function validated({ errors, value }) {
  if (errors) throw badRequest('Please correct the highlighted fields.', errors);
  return value;
}

async function startSession(res, userId) {
  const { token, expiresAt } = await sessions.createSession(userId);
  res.cookie(config.session.cookieName, token, { ...cookieOptions(), expires: expiresAt });
}

const clearSessionCookie = (res) => res.clearCookie(config.session.cookieName, cookieOptions());

/** POST /api/auth/register  { fullName, email, password } -> 201 { user } and logs the user in. */
router.post('/register', registerLimiter, asyncHandler(async (req, res) => {
  const { email, fullName, password, currency } = validated(v.validateRegistration(req.body));
  const user = await users.createUser({ email, fullName, currency, passwordHash: await hashPassword(password) });
  await startSession(res, user.id);
  res.status(201).json({ user });
}));

/** POST /api/auth/login  { email, password } -> { user }. Same message for unknown email and wrong password. */
router.post('/login', loginIpLimiter, loginEmailLimiter, loadSession, asyncHandler(async (req, res) => {
  const { email, password } = validated(v.validateLogin(req.body));
  const found = await users.findByEmail(email);
  const ok = found ? await verifyPassword(password, found.passwordHash) : await verifyAgainstDummy(password);
  if (!ok) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password.');

  if (needsRehash(found.passwordHash)) await users.updatePasswordHash(found.id, await hashPassword(password));
  if (req.sessionToken) await sessions.deleteSession(req.sessionToken); // never reuse a pre-login session
  await startSession(res, found.id);
  const { passwordHash, ...user } = found; // eslint-disable-line no-unused-vars
  res.json({ user });
}));

/** POST /api/auth/logout -> 200. Always succeeds, even if already logged out. */
router.post('/logout', loadSession, asyncHandler(async (req, res) => {
  if (req.sessionToken) await sessions.deleteSession(req.sessionToken);
  clearSessionCookie(res);
  res.json({ ok: true });
}));

/** GET /api/auth/session -> { user } or { user: null }. Always 200 so pages can check login state quietly. */
router.get('/session', loadSession, (req, res) => {
  res.json({ user: req.user });
});

/** PATCH /api/auth/profile  { fullName } -> { user } */
router.patch('/profile', requireAuth, asyncHandler(async (req, res) => {
  const { fullName } = validated(v.validateProfile(req.body));
  res.json({ user: await users.updateName(req.user.id, fullName) });
}));

/**
 * PATCH /api/auth/currency  { currency } -> { user }. Changes how amounts are labelled and which country tools are open.
 * Stored amounts are NOT converted. Switching away from INR closes the Indian tax tool for the account.
 */
router.patch('/currency', requireAuth, asyncHandler(async (req, res) => {
  const { currency } = validated(v.validateCurrency(req.body));
  res.json({ user: await users.updateCurrency(req.user.id, currency) });
}));

/** POST /api/auth/change-password  { currentPassword, newPassword } -> ok. Signs out all other devices. */
router.post('/change-password', requireAuth, accountLimiter, asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = validated(v.validatePasswordChange(req.body, req.user.email));
  const account = await users.findAuthById(req.user.id);
  if (!(await verifyPassword(currentPassword, account.passwordHash))) {
    throw badRequest('Please correct the highlighted fields.', { currentPassword: 'Current password is incorrect.' });
  }
  await users.updatePasswordHash(req.user.id, await hashPassword(newPassword));
  await sessions.deleteUserSessions(req.user.id, req.sessionToken);
  res.json({ ok: true });
}));

/** DELETE /api/auth/account  { password } -> ok. Permanently deletes the user and all their data. */
router.delete('/account', requireAuth, accountLimiter, asyncHandler(async (req, res) => {
  const { password } = validated(v.validatePasswordConfirm(req.body));
  const account = await users.findAuthById(req.user.id);
  if (!(await verifyPassword(password, account.passwordHash))) throw unauthorized('Incorrect password.');
  await users.deleteUser(req.user.id);
  clearSessionCookie(res);
  res.json({ ok: true });
}));

module.exports = router;
