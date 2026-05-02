// ─── Postgres pool + boot-time schema ───────────────────────────────────────
//
// DigitalOcean Managed Postgres uses a CA-signed cert that Node's default
// trust store doesn't include, so we connect without chain verification.
// The connection is still encrypted (TLS); we're just not checking who
// signed the cert. Same pattern Heroku/Render/Railway PG users follow.
//
// SUBTLE GOTCHA: DO's DATABASE_URL ends with `?sslmode=require`. When `pg`
// parses that, it builds an internal ssl config from the URL parameter that
// can OVERRIDE the `ssl` option we pass below — this manifests as the dread
// "self-signed certificate in certificate chain" error on Node 22+. Fix:
// strip sslmode from the URL before handing it to Pool, so our explicit
// `ssl: { rejectUnauthorized: false }` is the sole source of truth.
//
// If DATABASE_URL is not set, this module exports `pool = null` and `isReady()`
// returns false — the server still boots so local dev (without Postgres) and
// FAL-only deploys keep working. Auth routes check isReady() and return 503.

import pg from 'pg';

const { Pool } = pg;

const DATABASE_URL = (process.env.DATABASE_URL || '').trim();

// Strip ?sslmode=... so our explicit `ssl` config below wins.
function stripSslmode(rawUrl) {
  if (!rawUrl) return rawUrl;
  try {
    const u = new URL(rawUrl);
    u.searchParams.delete('sslmode');
    return u.toString();
  } catch {
    // Not a parseable URL (unlikely); pass through and hope for the best.
    return rawUrl;
  }
}

export const pool = DATABASE_URL
  ? new Pool({
      connectionString: stripSslmode(DATABASE_URL),
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

// Email of the single admin user. Promoted to role='admin' on every boot
// (idempotent — only updates if the row exists and isn't already admin).
// Configurable via env so we can flip admins without a code change.
export const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'info@voxel-ai.ai')
  .trim()
  .toLowerCase();

// Run migrations once at boot. Idempotent — safe to call on every start.
// All wrapped in a single transaction so a partial failure can't leave the
// schema half-migrated.
export async function migrate() {
  if (!pool) {
    console.warn('[db] DATABASE_URL not set — skipping migrations. Auth routes will return 503.');
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ─── users (base table) ─────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id            SERIAL       PRIMARY KEY,
        email         VARCHAR(255) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        credits       INTEGER      NOT NULL DEFAULT 0,
        role          VARCHAR(32)  NOT NULL DEFAULT 'user',
        created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS users_email_idx ON users (email);`);

    // ─── users column upgrades (idempotent) ─────────────────────────
    // Switch credits to NUMERIC(10,2) so future per-image cost of 1.5 works
    // without another migration. Casting via USING is a no-op for existing
    // INTEGER values.
    await client.query(`
      DO $$
      BEGIN
        IF (SELECT data_type FROM information_schema.columns
            WHERE table_name='users' AND column_name='credits') = 'integer' THEN
          ALTER TABLE users ALTER COLUMN credits TYPE NUMERIC(10,2)
            USING credits::NUMERIC(10,2);
        END IF;
      END $$;
    `);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS banned        BOOLEAN     NOT NULL DEFAULT FALSE;`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS package       VARCHAR(64);`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_ip INET;`);
    // credit_limit = the user's "lifetime cap" — sum of all positive grants
    // by an admin. Unlike `credits` (the spendable balance), this only ever
    // grows on `grant`, and is bumped to `max(credit_limit, target)` on a
    // `set` action that lifts the target above the previous max. It's the
    // denominator used by the navbar progress bar / outer ring so the
    // user sees "X of Y granted" rather than a hardcoded package cap.
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS credit_limit NUMERIC(10,2) NOT NULL DEFAULT 0;`);
    // One-shot backfill for users that already had credits before this
    // column existed: floor the limit at their current balance so the bar
    // doesn't render at >100%. Idempotent — only lifts, never lowers.
    await client.query(`UPDATE users SET credit_limit = GREATEST(credit_limit, credits);`);

    // ─── credits_history ────────────────────────────────────────────
    // Append-only audit of every credit movement. amount is signed:
    // positive = grant/refund, negative = spend/revoke.
    await client.query(`
      CREATE TABLE IF NOT EXISTS credits_history (
        id            SERIAL PRIMARY KEY,
        user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        amount        NUMERIC(10,2) NOT NULL,
        action        VARCHAR(32)   NOT NULL,
        admin_email   VARCHAR(255),
        reason        TEXT,
        ip_address    INET,
        created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS credits_history_user_idx ON credits_history (user_id, created_at DESC);`);

    // ─── admin_audit_log ────────────────────────────────────────────
    // Every admin API call is logged here. Used for "who did what / from
    // where / when" investigations and for the "Last admin login" banner.
    await client.query(`
      CREATE TABLE IF NOT EXISTS admin_audit_log (
        id              SERIAL PRIMARY KEY,
        admin_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
        admin_email     VARCHAR(255) NOT NULL,
        route           VARCHAR(255) NOT NULL,
        method          VARCHAR(8)   NOT NULL,
        target_user_id  INTEGER,
        payload_summary JSONB,
        ip_address      INET,
        user_agent      TEXT,
        created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS admin_audit_recent_idx ON admin_audit_log (created_at DESC);`);

    // ─── failed_logins ──────────────────────────────────────────────
    // Per-IP failed login tracking for brute-force throttling.
    await client.query(`
      CREATE TABLE IF NOT EXISTS failed_logins (
        id          SERIAL PRIMARY KEY,
        email       VARCHAR(255),
        ip_address  INET NOT NULL,
        user_agent  TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS failed_logins_ip_recent_idx ON failed_logins (ip_address, created_at DESC);`);

    // ─── one-shot admin promotion ───────────────────────────────────
    const promoted = await client.query(
      `UPDATE users SET role = 'admin' WHERE email = $1 AND role <> 'admin' RETURNING id`,
      [ADMIN_EMAIL]
    );
    if (promoted.rowCount > 0) {
      console.log(`[db] promoted ${ADMIN_EMAIL} → role=admin`);
    }

    await client.query('COMMIT');
    console.log('[db] migrations ok — users + credits_history + admin_audit_log + failed_logins ready');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[db] migration FAILED:', err.message);
    // Don't crash the process — let other routes keep serving. Auth will 503
    // until the DB is reachable.
    throw err;
  } finally {
    client.release();
  }
}
