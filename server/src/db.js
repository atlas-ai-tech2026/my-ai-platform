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
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Load .env HERE, not just in index.js: ES imports are hoisted, so this
// module's body runs BEFORE index.js gets to call dotenv.config() — reading
// process.env.DATABASE_URL below would see it unset in local dev and skip
// migrations ("DATABASE_URL not set" with the var sitting in server/.env).
// Same pitfall kie.js documents. Anchored to this file (like index.js) so
// it works from any cwd; dotenv never overrides platform-set vars, so prod
// is unaffected.
dotenv.config({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env'),
});

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

    // kie_credits: estimated KIE credits the transaction consumed from OUR
    // kie.ai balance (server/src/kie-pricing.js). NULL = FAL-backed model,
    // no kie price on file, or a row from before this column existed —
    // the admin UI renders those as "—".
    await client.query(`ALTER TABLE credits_history ADD COLUMN IF NOT EXISTS kie_credits NUMERIC(12,2);`);

    // display_name: shown on the user's account page (higgsfield-style
    // profile). Optional — UI falls back to the email local-part.
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name VARCHAR(80);`);

    // Bulk-provisioned account controls (CRM Bulk tab, 2026-07):
    //   allowed_models — JSONB array of model labels this user may run;
    //                    NULL = unrestricted (every model, the default).
    //   expires_at     — account hard-stop; NULL = never. Expired users
    //                    can't log in or generate (enforced in auth).
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS allowed_models JSONB;`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;`);

    // fal_cost: estimated USD the transaction cost on OUR fal.ai bill
    // (server/src/fal-pricing.js). NULL = kie-backed model, no fal price on
    // file, or pre-tracking row → UI shows "—". FAL bills in dollars, not
    // credits, hence a separate USD column rather than reusing kie_credits.
    await client.query(`ALTER TABLE credits_history ADD COLUMN IF NOT EXISTS fal_cost NUMERIC(12,4);`);
    await client.query(`CREATE INDEX IF NOT EXISTS credits_history_recent_idx ON credits_history (created_at DESC);`);

    // ─── promo codes + gift cards ───────────────────────────────────
    // Promo codes: reusable marketing codes (max_redemptions NULL =
    // unlimited, one redemption per user enforced by promo_redemptions).
    // Gift cards: single-use vouchers generated in batches by the admin.
    // Both grant credits via the same mechanics as an admin grant
    // (credits + credit_limit + credits_history row).
    await client.query(`
      CREATE TABLE IF NOT EXISTS promo_codes (
        id              SERIAL       PRIMARY KEY,
        code            VARCHAR(64)  NOT NULL UNIQUE,
        credits         NUMERIC(10,2) NOT NULL,
        max_redemptions INTEGER,
        redeemed_count  INTEGER      NOT NULL DEFAULT 0,
        expires_at      TIMESTAMPTZ,
        active          BOOLEAN      NOT NULL DEFAULT TRUE,
        created_by      VARCHAR(255),
        created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS promo_redemptions (
        id         SERIAL      PRIMARY KEY,
        code_id    INTEGER     NOT NULL REFERENCES promo_codes(id) ON DELETE CASCADE,
        user_id    INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (code_id, user_id)
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS gift_cards (
        id          SERIAL       PRIMARY KEY,
        code        VARCHAR(64)  NOT NULL UNIQUE,
        credits     NUMERIC(10,2) NOT NULL,
        note        TEXT,
        expires_at  TIMESTAMPTZ,
        redeemed_by INTEGER      REFERENCES users(id) ON DELETE SET NULL,
        redeemed_at TIMESTAMPTZ,
        created_by  VARCHAR(255),
        created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );
    `);

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
    // N2 (recheck 2026-08-03): the account-wide lockout counts every failure
    // for one email inside the window regardless of source address. Without
    // this index that count is a sequential scan of the whole table on every
    // single login attempt.
    await client.query(`CREATE INDEX IF NOT EXISTS failed_logins_email_recent_idx ON failed_logins (email, created_at DESC);`);

    // ─── entities (generation history + any other per-user docs) ─────
    // Replaces the previous server/data/entities.json write-through file
    // store, which got wiped on every container redeploy on DO App
    // Platform. Same shape as that file's items: a uuid `id`, the entity
    // `name` ("GenerationHistory" today, room for more later), an owning
    // `user_id`, a JSONB `data` blob, and timestamps. The /api/entities
    // routes spread `data` over the row so the API response shape stays
    // identical to what the JSON store returned (clients don't change).
    await client.query(`
      CREATE TABLE IF NOT EXISTS entities (
        id            UUID         PRIMARY KEY,
        name          VARCHAR(64)  NOT NULL,
        user_id       INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        data          JSONB        NOT NULL DEFAULT '{}'::jsonb,
        created_date  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_date  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );
    `);
    // Most common query: "all of user X's GenerationHistory rows, newest
    // first, optionally limited". This index covers it directly.
    await client.query(`CREATE INDEX IF NOT EXISTS entities_user_name_created_idx ON entities (user_id, name, created_date DESC);`);
    // Filter route does `data @> $::jsonb` — gin index makes that fast.
    await client.query(`CREATE INDEX IF NOT EXISTS entities_data_gin_idx ON entities USING gin (data);`);

    // ─── node_spaces (Voxel Node canvas graphs) ─────────────────────
    // Each row is one Node Space: the infinite canvas graph for the
    // Voxel Node feature. `graph` holds the React Flow {nodes, edges}
    // blob (node outputs are persisted inline for the P0-P2 slice; a
    // dedicated runs table comes with the async engine in P3).
    await client.query(`
      CREATE TABLE IF NOT EXISTS node_spaces (
        id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_id    INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name        VARCHAR(255) NOT NULL DEFAULT 'Untitled Space',
        graph       JSONB        NOT NULL DEFAULT '{"nodes":[],"edges":[]}'::jsonb,
        created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS node_spaces_owner_idx ON node_spaces (owner_id, updated_at DESC);`);

    // ─── pending_video_charges (H4, audit 2026-07-28) ───────────────
    // Async video jobs are charged at submit but can fail MINUTES later.
    // The record of "who paid what for which job" used to live in an
    // in-memory Map, so a deploy or restart lost every in-flight charge
    // and those users were never refunded. It is now a table, and unresolved
    // rows are reconciled with the provider on boot.
    //   status: 'pending' (charged, job in flight)
    //         | 'settled' (job completed — nothing owed)
    //         | 'refunded' (job failed and the refund was issued)
    // The status transition out of 'pending' is what makes the refund
    // exactly-once, even with concurrent pollers or a restart mid-flight.
    await client.query(`
      CREATE TABLE IF NOT EXISTS pending_video_charges (
        job_id      VARCHAR(255) PRIMARY KEY,
        user_id     INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind        VARCHAR(32)  NOT NULL DEFAULT 'video',
        amount      NUMERIC(10,2) NOT NULL,
        model_id    VARCHAR(255),
        model_label VARCHAR(255),
        status      VARCHAR(16)  NOT NULL DEFAULT 'pending',
        created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        settled_at  TIMESTAMPTZ
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS pending_video_charges_pending_idx ON pending_video_charges (status, created_at) WHERE status = 'pending';`);
    await client.query(`CREATE INDEX IF NOT EXISTS pending_video_charges_user_idx ON pending_video_charges (user_id, created_at DESC);`);

    // ─── ownership-lookup indexes (M5 + download guard) ─────────────
    // Both /api/video-status (M5) and /api/download verify that a job id /
    // media URL belongs to the caller by querying the entities table. The
    // existing gin index serves containment (@>), NOT the `data->>'x' = $1`
    // equality these use — without these expression indexes each check is a
    // SEQUENTIAL SCAN of every generation ever made, and status polling runs
    // every few seconds per in-flight job.
    // Composite (user_id, expression) so the planner can serve the whole
    // WHERE clause from the index. A PARTIAL index (… WHERE data ? 'job_id')
    // is NOT usable here: the planner cannot prove the predicate holds from
    // the query, so it falls back to a sequential scan — verified against a
    // real Postgres with 20k rows.
    await client.query(`CREATE INDEX IF NOT EXISTS entities_user_job_idx ON entities (user_id, (data->>'job_id'));`);
    await client.query(`CREATE INDEX IF NOT EXISTS entities_user_result_url_idx ON entities (user_id, (data->>'result_url'));`);

    // ─── M1: scrub credentials from EXISTING audit rows ─────────────
    // (audit 2026-07-28) adminAudit used to serialize the whole request
    // body, so historical rows for /reset-password hold customers'
    // plaintext passwords. Blank the payload on every row that could
    // contain one, keeping the row itself (the audit trail — who did what,
    // when — stays intact; only the secret value is destroyed).
    //
    // Idempotent: rows already scrubbed no longer match the WHERE clause.
    // NOTE: existing database BACKUPS still contain these values. Rotating
    // or purging those is an operator decision, flagged in the summary.
    // BOUNDED so it can never stall startup: this is a regex scan with no
    // supporting index, and it runs inside the boot transaction. Capping the
    // batch keeps boot fast on a large table; any remainder is picked up on
    // the next boot (deploys restart the app regularly), and the log line
    // says when more is left.
    const M1_SCRUB_BATCH = 5000;
    // payload_summary is JSONB, and ~* / LIKE are TEXT operators — comparing
    // them directly raises "operator does not exist: jsonb ~* unknown",
    // which would abort this whole migration transaction. Cast to text.
    const scrubbed = await client.query(`
      UPDATE admin_audit_log
         SET payload_summary = '{"_scrubbed":"credentials removed by M1 migration"}'::jsonb
       WHERE id IN (
         SELECT id FROM admin_audit_log
          WHERE payload_summary IS NOT NULL
            AND payload_summary::text ~* '(password|passwd|secret|token|api[-_]?key|totp|recovery)'
            AND payload_summary::text NOT LIKE '%_scrubbed%'
          LIMIT ${M1_SCRUB_BATCH}
       )
    `);
    if (scrubbed.rowCount > 0) {
      console.log(`[db] M1: scrubbed credentials from ${scrubbed.rowCount} historical admin_audit_log row(s)`);
      if (scrubbed.rowCount === M1_SCRUB_BATCH) {
        console.warn('[db] M1: batch limit hit — more rows remain, they will be scrubbed on the next boot.');
      }
    }

    // ─── admin TOTP 2FA (H5, audit 2026-07-28) ──────────────────────
    //   totp_secret         base32 secret; NULL = 2FA not set up yet.
    //   totp_enabled        only TRUE after the admin confirms a code, so
    //                       deploying this can never lock anyone out — the
    //                       login gate applies to enabled accounts only.
    //   totp_last_step      last accepted 30s step; blocks replay of the
    //                       same code inside its own window.
    //   totp_recovery_codes JSONB array of SHA-256 HASHES (never plaintext);
    //                       each is deleted as it is used.
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret         VARCHAR(64);`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled        BOOLEAN NOT NULL DEFAULT FALSE;`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_last_step      BIGINT;`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_recovery_codes JSONB;`);

    // ─── N9 (recheck 2026-08-03): session invalidation ──────────────
    // JWTs carry no version and last 7 days for users / 30 min for admins,
    // and nothing anywhere compared them against a password change. So
    // resetting a compromised account's password did NOT evict the attacker:
    // their existing token kept spending credits until it expired naturally.
    //
    // sessions_valid_from is the cutoff. Any token issued before it is
    // refused. Defaults to NULL (= no cutoff), so every token in flight when
    // this deploys stays valid and nobody is logged out by the migration.
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS sessions_valid_from TIMESTAMPTZ;`);

    // ─── one-shot admin promotion ───────────────────────────────────
    const promoted = await client.query(
      `UPDATE users SET role = 'admin' WHERE email = $1 AND role <> 'admin' RETURNING id`,
      [ADMIN_EMAIL]
    );
    if (promoted.rowCount > 0) {
      console.log(`[db] promoted ${ADMIN_EMAIL} → role=admin`);
    }

    await client.query('COMMIT');
    console.log('[db] migrations ok — users + credits_history + admin_audit_log + failed_logins + entities + node_spaces ready');
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
