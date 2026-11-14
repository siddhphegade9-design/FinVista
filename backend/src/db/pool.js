'use strict';
/**
 * PostgreSQL connection pool (lazy: nothing connects until first use, so the
 * app still starts, and the health endpoint still answers, with no database).
 */
const { Pool, types } = require('pg');
const config = require('../config/env');

// DATE columns (OID 1082) stay as 'YYYY-MM-DD' strings. The default parser builds a JS Date at
// local midnight, which shifts the day across timezones. NUMERIC stays a string too (exact money).
types.setTypeParser(1082, (value) => value);

let pool = null;

const isConfigured = () => Boolean(config.databaseUrl);

function getPool() {
  if (!isConfigured()) {
    const err = new Error('DATABASE_URL is not set. Copy .env.example to .env and configure PostgreSQL.');
    err.code = 'DB_NOT_CONFIGURED';
    throw err;
  }
  if (!pool) {
    pool = new Pool({
      connectionString: config.databaseUrl,
      ssl: config.databaseSsl ? { rejectUnauthorized: true } : undefined,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
    // An idle client erroring (e.g. server restart) must not crash the process.
    pool.on('error', (err) => console.error('Unexpected PostgreSQL pool error:', err.message));
  }
  return pool;
}

/** Parameterised query. Always pass values via `params`, never string-concatenate them. */
const query = (text, params) => getPool().query(text, params);

/** Runs fn(client) inside BEGIN/COMMIT, rolling back if it throws. */
async function withTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Resolves true if the database answers a trivial query within `timeoutMs`. Never throws. */
async function checkConnection(timeoutMs = 2000) {
  if (!isConfigured()) return false;
  let timer;
  try {
    await Promise.race([
      query('SELECT 1'),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), timeoutMs); }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function closePool() {
  if (pool) {
    const p = pool;
    pool = null;
    await p.end();
  }
}

module.exports = { getPool, query, withTransaction, checkConnection, closePool, isConfigured };
