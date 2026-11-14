'use strict';
/** Helpers for tests that need a real PostgreSQL server (set TEST_DATABASE_URL to enable). */
const { Pool } = require('pg');

const TEST_URL = process.env.TEST_DATABASE_URL || '';
const hasTestDb = Boolean(TEST_URL);

/** Refuses to run against anything that does not look like a disposable test database. */
function assertSafeToWipe(url) {
  const dbName = new URL(url).pathname.replace('/', '');
  if (!/test/i.test(dbName)) {
    throw new Error(`Refusing to wipe database "${dbName}": TEST_DATABASE_URL must point at a database whose name contains "test".`);
  }
}

function createTestPool() {
  assertSafeToWipe(TEST_URL);
  return new Pool({ connectionString: TEST_URL, max: 4 });
}

/** Drops everything in the public schema so each test file starts from nothing. */
async function resetDatabase(pool) {
  await pool.query('DROP SCHEMA public CASCADE');
  await pool.query('CREATE SCHEMA public');
}

module.exports = { hasTestDb, TEST_URL, createTestPool, resetDatabase };
