'use strict';
/**
 * Minimal forward-only SQL migration runner.
 *
 *   npm run db:migrate   apply pending migrations
 *   npm run db:status    list applied / pending
 *
 * Files in backend/migrations are applied in filename order, each inside its
 * own transaction. Applied files are recorded with a checksum; editing an
 * already-applied file is an error (add a new migration instead).
 * A PostgreSQL advisory lock stops two processes migrating at once.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_DIR = path.join(__dirname, '..', '..', 'migrations');
const LOCK_ID = 727_274; // arbitrary constant, "FINVISTA"-ish

/** Hash with line endings normalised so Windows (CRLF) and Linux (LF) checkouts agree. */
const checksum = (sql) => crypto.createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex');

function readMigrations(dir) {
  return fs.readdirSync(dir)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort()
    .map((name) => {
      const sql = fs.readFileSync(path.join(dir, name), 'utf8');
      return { name, sql, checksum: checksum(sql) };
    });
}

async function ensureTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       text PRIMARY KEY,
      checksum   text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
}

/** Returns { applied: [{name, applied_at}], pending: [name] }. */
async function status({ pool, dir = DEFAULT_DIR }) {
  const client = await pool.connect();
  try {
    await ensureTable(client);
    const { rows } = await client.query('SELECT name, checksum, applied_at FROM schema_migrations ORDER BY name');
    const done = new Map(rows.map((r) => [r.name, r]));
    const files = readMigrations(dir);
    return {
      applied: rows.map(({ name, applied_at }) => ({ name, applied_at })),
      pending: files.filter((f) => !done.has(f.name)).map((f) => f.name),
    };
  } finally {
    client.release();
  }
}

/** Applies all pending migrations; returns the names applied this run. */
async function migrate({ pool, dir = DEFAULT_DIR, log = () => {} }) {
  const client = await pool.connect();
  const applied = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await ensureTable(client);
    const { rows } = await client.query('SELECT name, checksum FROM schema_migrations');
    const done = new Map(rows.map((r) => [r.name, r.checksum]));

    for (const file of readMigrations(dir)) {
      if (done.has(file.name)) {
        if (done.get(file.name) !== file.checksum) {
          throw new Error(`Migration ${file.name} was changed after being applied. Create a new migration instead of editing it.`);
        }
        continue;
      }
      try {
        await client.query('BEGIN');
        await client.query(file.sql);
        await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [file.name, file.checksum]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw new Error(`Migration ${file.name} failed and was rolled back: ${err.message}`);
      }
      applied.push(file.name);
      log(`applied ${file.name}`);
    }
    return applied;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    client.release();
  }
}

module.exports = { migrate, status, checksum };

// CLI entry point
if (require.main === module) {
  const { getPool, closePool } = require('./pool');
  (async () => {
    const pool = getPool();
    if (process.argv[2] === 'status') {
      const s = await status({ pool });
      console.log('Applied:', s.applied.map((a) => a.name).join(', ') || '(none)');
      console.log('Pending:', s.pending.join(', ') || '(none)');
    } else {
      const applied = await migrate({ pool, log: (m) => console.log(m) });
      console.log(applied.length ? `Done. ${applied.length} migration(s) applied.` : 'Database is up to date.');
    }
  })()
    .catch((err) => { console.error(err.message); process.exitCode = 1; })
    .finally(closePool);
}
