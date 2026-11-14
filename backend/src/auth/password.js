'use strict';
/**
 * Password hashing with scrypt (Node built-in, memory-hard, OWASP-recommended).
 * Stored format:  scrypt$N$r$p$<salt b64>$<hash b64>
 * Parameters are stored with each hash so they can be raised later; needsRehash()
 * tells the login flow to upgrade old hashes transparently.
 */
const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);

const PARAMS = Object.freeze({ N: 2 ** 15, r: 8, p: 1, keyLen: 64, saltLen: 16 });
const MAX_MEM = 128 * 1024 * 1024;

async function derive(password, salt, { N, r, p, keyLen }) {
  return scrypt(password.normalize('NFKC'), salt, keyLen, { N, r, p, maxmem: MAX_MEM });
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(PARAMS.saltLen);
  const key = await derive(password, salt, PARAMS);
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), key.toString('base64')].join('$');
}

function parse(stored) {
  const parts = String(stored).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  const [, N, r, p, salt, key] = parts;
  const parsed = { N: Number(N), r: Number(r), p: Number(p), salt: Buffer.from(salt, 'base64'), key: Buffer.from(key, 'base64') };
  if (![parsed.N, parsed.r, parsed.p].every(Number.isInteger) || parsed.key.length === 0) return null;
  return parsed;
}

/** Constant-time comparison of a password against a stored hash. Returns false (never throws) on bad input. */
async function verifyPassword(password, stored) {
  const parsed = parse(stored);
  if (!parsed || typeof password !== 'string') return false;
  try {
    const key = await derive(password, parsed.salt, { ...parsed, keyLen: parsed.key.length });
    return crypto.timingSafeEqual(key, parsed.key);
  } catch {
    return false;
  }
}

/** True if the stored hash used weaker parameters than the current ones. */
function needsRehash(stored) {
  const parsed = parse(stored);
  return !parsed || parsed.N < PARAMS.N || parsed.r < PARAMS.r || parsed.p < PARAMS.p;
}

// A real hash of a random password, used to spend the same time when the email is unknown,
// so response timing does not reveal which emails have accounts.
let dummyHash;
async function verifyAgainstDummy(password) {
  dummyHash ??= await hashPassword(crypto.randomBytes(16).toString('hex'));
  await verifyPassword(password, dummyHash);
  return false;
}

module.exports = { hashPassword, verifyPassword, needsRehash, verifyAgainstDummy, PARAMS };
