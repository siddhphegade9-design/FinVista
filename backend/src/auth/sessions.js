'use strict';
/**
 * Server-side sessions. The cookie carries a random 256-bit token; the database stores only
 * SHA-256(token), so database contents alone cannot be replayed as a login.
 */
const crypto = require('crypto');
const db = require('../db/pool');
const config = require('../config/env');

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const ttlMs = () => config.session.ttlDays * 24 * 60 * 60 * 1000;

/** Creates a session for the user and returns { token, expiresAt }. */
async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + ttlMs());
  await db.query('INSERT INTO sessions (id_hash, user_id, expires_at) VALUES ($1, $2, $3)', [hashToken(token), userId, expiresAt]);
  return { token, expiresAt };
}

/** Returns the user for a valid, unexpired token, or null. Also records activity at most once per 5 minutes. */
async function getSessionUser(token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  const { rows } = await db.query(
    `UPDATE sessions s
        SET last_seen_at = CASE WHEN s.last_seen_at < now() - interval '5 minutes' THEN now() ELSE s.last_seen_at END
       FROM users u
      WHERE s.id_hash = $1 AND s.expires_at > now() AND u.id = s.user_id
  RETURNING u.id, u.email, u.full_name, u.currency, u.created_at`,
    [hashToken(token)],
  );
  if (rows.length === 0) return null;
  const u = rows[0];
  return { id: u.id, email: u.email, fullName: u.full_name, currency: u.currency, createdAt: u.created_at };
}

const deleteSession = (token) => db.query('DELETE FROM sessions WHERE id_hash = $1', [hashToken(token)]);

/** Signs the user out everywhere, optionally keeping the current session. */
const deleteUserSessions = (userId, exceptToken) => (exceptToken
  ? db.query('DELETE FROM sessions WHERE user_id = $1 AND id_hash <> $2', [userId, hashToken(exceptToken)])
  : db.query('DELETE FROM sessions WHERE user_id = $1', [userId]));

const purgeExpired = () => db.query('DELETE FROM sessions WHERE expires_at <= now()');

module.exports = { createSession, getSessionUser, deleteSession, deleteUserSessions, purgeExpired, hashToken };
