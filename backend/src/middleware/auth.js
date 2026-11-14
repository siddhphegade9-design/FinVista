'use strict';
/** Session loading and route protection. */
const config = require('../config/env');
const { parseCookies } = require('../auth/cookies');
const { getSessionUser } = require('../auth/sessions');
const { unauthorized } = require('../utils/httpError');

/** Reads the session cookie and sets req.user (or null) and req.sessionToken. Never rejects. */
async function loadSession(req, res, next) {
  try {
    const token = parseCookies(req.headers.cookie)[config.session.cookieName] || null;
    req.sessionToken = token;
    req.user = token ? await getSessionUser(token) : null;
    next();
  } catch (err) {
    next(err);
  }
}

/** Protects a route: 401 unless a valid session exists. Use it on every route that touches user data. */
const requireAuth = [
  loadSession,
  (req, res, next) => (req.user ? next() : next(unauthorized('Please log in to continue.'))),
];

/** Cookie attributes shared by set and clear (they must match for clearing to work). */
const cookieOptions = () => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: config.isProduction,
  path: '/',
});

module.exports = { loadSession, requireAuth, cookieOptions };
