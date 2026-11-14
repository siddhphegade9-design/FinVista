'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { hashPassword, verifyPassword, needsRehash, PARAMS } = require('../src/auth/password');

test('hashes are salted, self-describing and never contain the password', async () => {
  const a = await hashPassword('correct horse battery');
  const b = await hashPassword('correct horse battery');
  assert.notEqual(a, b, 'random salt makes every hash different');
  assert.match(a, /^scrypt\$32768\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  assert.ok(!a.includes('correct horse'));
});

test('verifyPassword accepts the right password and rejects wrong ones', async () => {
  const h = await hashPassword('s3cret-passphrase');
  assert.equal(await verifyPassword('s3cret-passphrase', h), true);
  assert.equal(await verifyPassword('s3cret-passphrasE', h), false);
  assert.equal(await verifyPassword('', h), false);
});

test('unicode passwords are normalised consistently (NFKC)', async () => {
  const h = await hashPassword('pässwörd-lang-genug');
  assert.equal(await verifyPassword('pässwörd-lang-genug', h), true); // decomposed form
});

test('verifyPassword fails closed on malformed or non-string input', async () => {
  assert.equal(await verifyPassword('x', 'not-a-hash'), false);
  assert.equal(await verifyPassword('x', 'scrypt$a$b$c$d$e'), false);
  assert.equal(await verifyPassword('x', ''), false);
  assert.equal(await verifyPassword(undefined, await hashPassword('abc')), false);
  assert.equal(await verifyPassword({}, await hashPassword('abc')), false);
});

test('needsRehash flags weaker parameters only', async () => {
  assert.equal(needsRehash(await hashPassword('pw')), false);
  const weakSalt = crypto.randomBytes(16);
  const weakKey = crypto.scryptSync('pw', weakSalt, 64, { N: 1024, r: 8, p: 1 });
  const weak = `scrypt$1024$8$1$${weakSalt.toString('base64')}$${weakKey.toString('base64')}`;
  assert.equal(needsRehash(weak), true);
  assert.equal(await verifyPassword('pw', weak), true, 'old hashes still verify so users can log in and be upgraded');
  assert.equal(needsRehash('garbage'), true);
  assert.equal(PARAMS.N, 32768);
});
