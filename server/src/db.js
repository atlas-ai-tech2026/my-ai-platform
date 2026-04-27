// ─── Postgres pool + boot-time schema ───────────────────────────────────────
//
// DigitalOcean Managed Postgres requires SSL. We use rejectUnauthorized: false
// because DO's CA isn't in the default trust store; the connection is still
// encrypted, we just don't verify the cert chain. Same pattern Heroku uses.
//
// If DATABASE_URL is not set, this module exports `pool = null` and `isReady()`
// returns false — the server still boots so local dev (without Postgres) and
// FAL-only deploys keep working. Auth routes check isReady() and return 503.

import pg from 'pg';

const { Pool } = pg;

const DATABASE_URL = (process.env.DATABASE_URL || '').trim();

export const pool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      // Conservative defaults for a basic-xxs instance.
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    })
  : null;

export function isReady() {
  return pool !== null;
}

// Surface pool errors instead of letting them crash the process silently.
if (pool) {
  pool.on('error', (err) => {
    console.error('[db] pool error:', err.message);
  });
}

// Run migrations once at boot. Idempotent — safe to call on every start.
// Using `IF NOT EXISTS` so deploys never break on already-migrated databases.
export async function migrate() {
  if (!pool) {
    console.warn('[db] DATABASE_URL not set — skipping migrations. Auth routes will return 503.');
    return;
  }

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id            SERIAL       PRIMARY KEY,
        email         VARCHAR(255) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        credits       INTEGER      NOT NULL DEFAULT 0,
        role          VARCHAR(32)  NOT NULL DEFAULT 'user',
        created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );
    `);

    // Lower-case email lookups should hit an index. Email is already UNIQUE,
    // but the unique index is on the exact-case value; we always store lower.
    await pool.query(`CREATE INDEX IF NOT EXISTS users_email_idx ON users (email);`);

    console.log('[db] migrations ok — users table ready');
  } catch (err) {
    console.error('[db] migration FAILED:', err.message);
    // Don't crash the process — let other routes keep serving. Auth will 503
    // until the DB is reachable.
    throw err;
  }
}
