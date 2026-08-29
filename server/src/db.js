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
import { COSTING_SEED as COSTING_MODELS_SEED, SEED_PLANS as COSTING_PLANS_SEED } from './costing-seed.js';
import { SLOW_IMAGE_DDL } from './slow-image.js';
import { SOFT_DELETE_DDL } from './soft-delete.js';
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

    // ─── credit lots (owner's rule, 2026-08-25) ─────────────────────
    // Every credit ADDITION is a lot with its own 30-day life, counted from
    // the day it was added. Credits expire; ACCOUNTS NEVER DO — the lockout
    // model users.expires_at implemented is retired (the column stays for
    // the deliberate manual tool only; nothing writes it automatically).
    //
    //   amount     — what the addition granted
    //   remaining  — what is left of it (spends drain soonest-expiring first)
    //   expires_at — granted_at + 30 days (or a promo code's own access_days);
    //                NULL = never expires (sorts last in spend order)
    //   expired_at — set once the sweep has taken the remainder; doubles as
    //                the claim marker that makes the sweep safe to run from
    //                two instances at once
    await client.query(`
      CREATE TABLE IF NOT EXISTS credit_lots (
        id          SERIAL PRIMARY KEY,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        amount      NUMERIC(10,2) NOT NULL,
        remaining   NUMERIC(10,2) NOT NULL,
        source      VARCHAR(32)   NOT NULL,
        reason      TEXT,
        granted_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        expires_at  TIMESTAMPTZ,
        expired_at  TIMESTAMPTZ,
        created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS credit_lots_user_idx ON credit_lots (user_id, expires_at);`);
    // Partial index: the hourly sweep asks one narrow question — which lots
    // still hold credits past their date — and should not scan spent history.
    await client.query(`
      CREATE INDEX IF NOT EXISTS credit_lots_due_idx ON credit_lots (expires_at)
        WHERE remaining > 0 AND expired_at IS NULL;
    `);

    // One-row-per-key switches that must survive restarts and be shared by
    // both instances. First tenant: credit_lots_activated_at — the sweep
    // takes nothing until the owner has read the preview and pressed once.
    await client.query(`
      CREATE TABLE IF NOT EXISTS app_flags (
        key    VARCHAR(64) PRIMARY KEY,
        value  JSONB       NOT NULL,
        set_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

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
    // ── WHO a code is for (2026-08-20) ────────────────────────────────────
    // Until this, a promo code was a bearer token: know the string, spend a
    // seat. These codes are how an organisation's PAID seats are handed out,
    // so a hundred-use code forwarded into a group chat was spent by a hundred
    // strangers while the customer's own attendees were refused.
    //
    // A code with NO rows here stays open, which is every code already issued.
    await client.query(`
      CREATE TABLE IF NOT EXISTS promo_code_emails (
        id          SERIAL      PRIMARY KEY,
        code_id     INTEGER     NOT NULL REFERENCES promo_codes(id) ON DELETE CASCADE,
        email       VARCHAR(255) NOT NULL,
        redeemed_by INTEGER     REFERENCES users(id) ON DELETE SET NULL,
        redeemed_at TIMESTAMPTZ,
        added_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        -- One seat per address per code, enforced by the database rather than
        -- by a check that ran a moment before two people clicked at once.
        UNIQUE (code_id, email)
      );
    `);
    await client.query(
      `CREATE INDEX IF NOT EXISTS promo_code_emails_lookup ON promo_code_emails (code_id, email)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS promo_redemptions (
        id         SERIAL      PRIMARY KEY,
        code_id    INTEGER     NOT NULL REFERENCES promo_codes(id) ON DELETE CASCADE,
        user_id    INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (code_id, user_id)
      );
    `);
    // Promo code description (CRM 2026-08-06). Free text so the admin can
    // record WHO a code was created for — "Ahmed, Gulf Media campaign" —
    // because a bare code tells you nothing months later.
    //
    // ADDITIVE AND OPTIONAL: existing codes get NULL and keep working exactly
    // as before. Nothing about redemption reads this column.
    await client.query(`ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS description TEXT;`);
    // How long the ACCESS lasts, not how long the code is redeemable.
    //
    // promo_codes.expires_at already existed and controls when a code may be
    // redeemed. It says nothing about the credits, so a "2-week code" granted
    // credits that lived forever — the opposite of what a workshop needs, and
    // the reason 584 of 587 accounts had no expiry at all (2026-08-11).
    //
    // 2026-08-25: a number bounds how long the CODE'S CREDITS live after
    // redemption (a credit_lots row of redemption + N days); NULL means the
    // standard 30-day credit life. It no longer touches users.expires_at —
    // accounts never expire.
    await client.query(`ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS access_days INTEGER;`);
    // Searching by description across a few hundred codes needs no index, but
    // redemption lookups by code_id do — this is what makes the "who redeemed
    // it" list instant rather than a scan.
    await client.query(`CREATE INDEX IF NOT EXISTS promo_redemptions_code_idx ON promo_redemptions (code_id, created_at DESC);`);

    // ─── CRM COSTING (2026-08-06) ───────────────────────────────────
    // Management calculator for what prices SHOULD be. It does NOT charge
    // anybody — server/src/pricing.js remains the single charging authority
    // (finding C1). Moving a number here changes nothing a customer sees.
    // Every table is prefixed so none of it is mistaken for the charge path.
    await client.query(`
      CREATE TABLE IF NOT EXISTS pricing_settings (
        id              SMALLINT      PRIMARY KEY DEFAULT 1,
        margin_target   NUMERIC(6,4)  NOT NULL DEFAULT 0.4000,
        credit_value    NUMERIC(12,8) NOT NULL DEFAULT 0.06333333,
        alert_threshold NUMERIC(6,4)  NOT NULL DEFAULT 0,
        last_fetch_at   TIMESTAMPTZ,
        CONSTRAINT pricing_settings_singleton CHECK (id = 1)
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS pricing_models (
        id               SERIAL        PRIMARY KEY,
        category         VARCHAR(20)   NOT NULL,
        model_name       VARCHAR(80)   NOT NULL,
        variant          VARCHAR(80),
        resolution       VARCHAR(40),
        unit             VARCHAR(20)   NOT NULL,
        -- NULL = found in production, cost not recorded yet. Nullable on
        -- purpose: forcing a value here would mean inventing a supplier cost.
        kie_cost         NUMERIC(12,6),
        fal_cost         NUMERIC(12,6),
        credits_override NUMERIC(8,1),
        margin_override  NUMERIC(6,4),
        kie_source_url   VARCHAR(300),
        kie_match        VARCHAR(200),
        fal_source_url   VARCHAR(300),
        fal_match        VARCHAR(200),
        is_active        BOOLEAN       NOT NULL DEFAULT TRUE,
        sort_order       INT           NOT NULL,
        updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        updated_by       VARCHAR(80)
      );
    `);
    // Identity = model + variant + resolution. This is what makes re-running
    // the seed idempotent instead of duplicating all 50 rows on every boot.
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS pricing_models_identity_idx
        ON pricing_models (model_name, COALESCE(variant,''), COALESCE(resolution,''));
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS pricing_plans (
        id               SERIAL        PRIMARY KEY,
        name             VARCHAR(40)   NOT NULL,
        price_usd        NUMERIC(10,2) NOT NULL,
        credits_override INT,
        sort_order       INT           NOT NULL UNIQUE
      );
    `);
    // Draft edits live apart from the published row, so nothing customer-facing
    // moves until someone approves. One draft per plan.
    await client.query(`
      CREATE TABLE IF NOT EXISTS pricing_plan_drafts (
        plan_id          INT           PRIMARY KEY REFERENCES pricing_plans(id) ON DELETE CASCADE,
        name             VARCHAR(40)   NOT NULL,
        price_usd        NUMERIC(10,2) NOT NULL,
        credits_override INT,
        created_by       VARCHAR(80),
        created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
      );
    `);
    // Every cost, credit, target, plan and setting change lands here. The brief
    // makes this non-negotiable: pricing changes must be attributable.
    await client.query(`
      CREATE TABLE IF NOT EXISTS pricing_audit_log (
        id          BIGSERIAL     PRIMARY KEY,
        entity      VARCHAR(20)   NOT NULL,
        entity_id   INT,
        field       VARCHAR(40)   NOT NULL,
        old_value   VARCHAR(80),
        new_value   VARCHAR(80),
        changed_by  VARCHAR(80)   NOT NULL,
        note        VARCHAR(200),
        changed_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS pricing_audit_time_idx ON pricing_audit_log (changed_at DESC);`);
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='pricing_models' AND column_name='kie_cost'
                     AND is_nullable='NO') THEN
          ALTER TABLE pricing_models ALTER COLUMN kie_cost DROP NOT NULL;
        END IF;
      END $$;
    `);

    // Models a PROVIDER offers that the website does not sell yet. Kept in its
    // own table on purpose: pricing_models means "what we charge for", and
    // mixing in things we have never sold would make every count on the screen
    // ambiguous. Rows here are candidates, not products.
    await client.query(`
      CREATE TABLE IF NOT EXISTS pricing_catalog_models (
        id            SERIAL        PRIMARY KEY,
        provider      VARCHAR(10)   NOT NULL,
        family        VARCHAR(120)  NOT NULL,
        lab           VARCHAR(80),
        category      VARCHAR(40),
        endpoints     INT           NOT NULL DEFAULT 1,
        -- NULL when the provider states a price we refuse to parse (token or
        -- per-megapixel billing). Same rule as pricing_models: unknown is a
        -- legitimate answer, an invented number is not.
        price_usd     NUMERIC(12,6),
        price_unit    VARCHAR(12),
        first_seen    TIMESTAMPTZ,
        discovered_at TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        -- The owner's "not interested" / "we already have this". Name matching
        -- cannot be perfect, so there has to be a way to retire a row for good.
        dismissed     BOOLEAN       NOT NULL DEFAULT FALSE,
        dismissed_at  TIMESTAMPTZ
      );
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS pricing_catalog_identity_idx
        ON pricing_catalog_models (provider, family);
    `);

    // ─── SUPPLIER PRICE CHANGES (2026-08-16) ──────────────────────────
    // Until now the catalogue sweep was insert-only: it discovered NEW models
    // and never noticed an existing one changing price. A supplier raising a
    // price quietly eats the margin, and nothing anywhere would have said so.
    //
    // Every observed price lands here, so a change is provable after the fact
    // rather than being a number that silently became a different number.
    await client.query(`
      CREATE TABLE IF NOT EXISTS pricing_supplier_history (
        id          BIGSERIAL     PRIMARY KEY,
        provider    VARCHAR(10)   NOT NULL,
        family      VARCHAR(120)  NOT NULL,
        price_usd   NUMERIC(12,6),
        price_unit  VARCHAR(12),
        observed_at TIMESTAMPTZ   NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS pricing_supplier_history_idx
      ON pricing_supplier_history (provider, family, observed_at DESC);`);

    // The review queue. A detected rise NEVER changes what a customer pays on
    // its own — it is computed, parked here, and waits for the owner.
    //
    // WHY A GATE AT ALL: fal states prices in prose mixing per-second,
    // per-megapixel and token billing, and it has produced confidently wrong
    // numbers before. An unattended 40%-margin rule would happily multiply a
    // customer's price by ten off one bad parse, overnight, with nobody
    // watching. One click is a small price for that not happening.
    await client.query(`
      CREATE TABLE IF NOT EXISTS pricing_change_queue (
        id             BIGSERIAL     PRIMARY KEY,
        provider       VARCHAR(10)   NOT NULL,
        family         VARCHAR(120)  NOT NULL,
        model_id       INT           REFERENCES pricing_models(id) ON DELETE CASCADE,
        old_price_usd  NUMERIC(12,6),
        new_price_usd  NUMERIC(12,6),
        pct_change     NUMERIC(8,2),
        -- What the 40% rule says the sale price should become. Computed at
        -- detection so the owner reviews a decision, not a maths problem.
        old_credits    NUMERIC(8,1),
        new_credits    NUMERIC(8,1),
        -- 'pending' | 'approved' | 'skipped' | 'needs_check'
        -- needs_check = the jump is too large to trust; almost always a parse
        -- error rather than a real price move.
        status         VARCHAR(16)   NOT NULL DEFAULT 'pending',
        detected_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        resolved_at    TIMESTAMPTZ,
        resolved_by    VARCHAR(120)
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS pricing_change_queue_open_idx
      ON pricing_change_queue (status, detected_at DESC) WHERE status IN ('pending','needs_check');`);

    // When the catalogue sweep last completed, so the screen can show it and
    // a stale sync is visible instead of being assumed fresh.
    await client.query(`ALTER TABLE pricing_settings ADD COLUMN IF NOT EXISTS catalog_synced_at TIMESTAMPTZ;`);

    // ── Alerts (Tier 1.1) ──────────────────────────────────────────────────
    // A hourly kie-balance check already existed before this table; its entire
    // output was console.error. On 8 August 415 generations failed with the
    // provider saying "Credits insufficient" during a live workshop, everyone
    // was auto-refunded, and the only record was a log line that has since
    // rotated away. These two tables are the missing half: a condition that
    // persists, is acknowledgeable, and can email once without nagging.
    await client.query(`
      CREATE TABLE IF NOT EXISTS alerts (
        id          BIGSERIAL    PRIMARY KEY,
        -- Stable identity for "the same problem, still happening". One OPEN
        -- row per key (enforced by the partial unique index below), so a check
        -- running every 5 minutes updates rather than accumulates.
        key         VARCHAR(120) NOT NULL,
        kind        VARCHAR(60)  NOT NULL,
        severity    VARCHAR(16)  NOT NULL,
        title       TEXT         NOT NULL,
        detail      TEXT,
        value       NUMERIC(14,2),
        -- 'open' | 'resolved' | 'acknowledged'
        status      VARCHAR(16)  NOT NULL DEFAULT 'open',
        first_seen  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        last_seen   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        seen_count  INTEGER      NOT NULL DEFAULT 1,
        resolved_at TIMESTAMPTZ,
        -- Last time this alert was emailed. NULL = never; drives the
        -- once-then-daily policy in alerts-engine.shouldEmail.
        notified_at TIMESTAMPTZ
      );
    `);
    // Resolved rows are kept: "it fixed itself" is information, and a
    // recurring-then-resolving alert is a pattern worth seeing.
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS alerts_one_open_per_key
      ON alerts (key) WHERE status <> 'resolved';`);
    await client.query(`CREATE INDEX IF NOT EXISTS alerts_recent_idx
      ON alerts (status, last_seen DESC);`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS alert_settings (
        id                    SMALLINT     PRIMARY KEY DEFAULT 1,
        -- Higher than the 3000 the log-only check used: 3000 was low enough
        -- that a busy workshop could cross it and reach zero between two
        -- hourly runs, which is precisely what appears to have happened.
        kie_balance_min       NUMERIC(12,2) NOT NULL DEFAULT 8000,
        stuck_charge_hours    INTEGER       NOT NULL DEFAULT 2,
        failure_rate_pct      NUMERIC(6,2)  NOT NULL DEFAULT 15,
        -- Below this many attempts no rate is computed at all. 3 failures out
        -- of 4 is 75% and means nothing.
        failure_min_attempts  INTEGER       NOT NULL DEFAULT 25,
        catalogue_stale_hours INTEGER       NOT NULL DEFAULT 30,
        email_enabled         BOOLEAN       NOT NULL DEFAULT TRUE,
        email_to              VARCHAR(255),
        last_check_at         TIMESTAMPTZ,
        updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        CONSTRAINT alert_settings_singleton CHECK (id = 1)
      );
    `);
    await client.query(`INSERT INTO alert_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;`);

    // ── Organisations + workshops (Tier 1.2) ───────────────────────────────
    // The revenue half of the business has never existed in the database.
    // Supplier cost is known to the cent — August's kie bill was $1,559.07 —
    // but what the workshops that consumed it were INVOICED lives only in
    // documents on the owner's laptop. So the panel cannot answer the one
    // question that decides next quarter's pricing: did we make money?
    //
    // Deliberately modelled as organisation → workshop rather than a flat
    // "invoice" row, because the customer is a company that books repeatedly
    // and the promo code is what ties a workshop to the people who attended
    // it. That link is what makes supplier cost attributable per workshop.
    await client.query(`
      CREATE TABLE IF NOT EXISTS organisations (
        id            SERIAL       PRIMARY KEY,
        name          VARCHAR(200) NOT NULL,
        contact_name  VARCHAR(200),
        contact_email VARCHAR(255),
        notes         TEXT,
        created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS organisations_name_key
      ON organisations (lower(name));`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS workshops (
        id              SERIAL        PRIMARY KEY,
        organisation_id INTEGER       REFERENCES organisations(id) ON DELETE SET NULL,
        title           VARCHAR(200),
        workshop_date   DATE,
        seats           INTEGER,
        -- The join to reality. Attendees are identified by the code they
        -- redeemed, so this is what makes "what did this workshop cost us"
        -- answerable at all.
        promo_code      VARCHAR(64),
        invoiced_amount NUMERIC(12,2),
        currency        VARCHAR(8)    NOT NULL DEFAULT 'USD',
        invoice_ref     VARCHAR(64),
        -- 'draft' | 'issued' | 'paid'. Payment is by bank transfer today, so
        -- this is recorded by hand rather than by a gateway callback.
        invoice_status  VARCHAR(16)   NOT NULL DEFAULT 'issued',
        paid_at         DATE,
        notes           TEXT,
        created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS workshops_date_idx
      ON workshops (workshop_date DESC);`);
    await client.query(`CREATE INDEX IF NOT EXISTS workshops_code_idx
      ON workshops (upper(promo_code));`);

    // ── Generation events (Tier 2 groundwork) ──────────────────────────────
    // One row per attempt: which model, whether it worked, how long it took.
    // Nothing has ever recorded any of the three.
    //
    // The Reliability screen currently INFERS which model failed by matching a
    // refund to the generation it probably reverses (91% recoverable, and
    // honest about it). Model Speed has nothing at all — no duration exists
    // anywhere, so that screen would launch empty and stay empty.
    //
    // Written from chargeCredits()/refundCredits() rather than from each
    // route, because instrumenting fifteen routes is exactly how the
    // 124-stuck-charge bug happened: eight of ten call sites silently forgot
    // to pass modelId.
    await client.query(`
      CREATE TABLE IF NOT EXISTS generation_events (
        id             BIGSERIAL    PRIMARY KEY,
        user_id        INTEGER      REFERENCES users(id) ON DELETE CASCADE,
        kind           VARCHAR(24),
        model_label    VARCHAR(160),
        provider       VARCHAR(10),
        -- 'pending' | 'delivered' | 'failed' | 'unknown'
        -- 'unknown' is deliberate: a customer who closed the tab never reports
        -- back, and counting that as either success or failure would be a
        -- guess. "We never found out" is its own answer.
        outcome        VARCHAR(16)  NOT NULL DEFAULT 'pending',
        failure_reason TEXT,
        duration_ms    INTEGER,
        credits        NUMERIC(10,2),
        created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        settled_at     TIMESTAMPTZ
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS generation_events_model_idx
      ON generation_events (model_label, created_at DESC);`);
    await client.query(`CREATE INDEX IF NOT EXISTS generation_events_open_idx
      ON generation_events (user_id, created_at DESC) WHERE outcome = 'pending';`);

    // ── Duplicate-charge protection (Tier 3.2) ─────────────────────────────
    // A double-clicked Generate button, or a network retry on a slow
    // connection, sends the same request twice and both are charged. Against
    // credits that is an annoyance you fix by hand; against a card it is a
    // CHARGEBACK — the customer's bank decides, you pay a fee either way, and
    // it counts against your merchant account. Cheaper to build now than to
    // retrofit after the first dispute, and testable without a gateway.
    //
    // The INSERT on `key` is the lock: whoever wins it does the work, exactly
    // as the video refund uses its status transition.
    await client.query(`
      CREATE TABLE IF NOT EXISTS request_idempotency (
        key         VARCHAR(220) PRIMARY KEY,
        user_id     INTEGER      REFERENCES users(id) ON DELETE CASCADE,
        path        VARCHAR(160),
        -- 'in_flight' | 'done'. A FAILED request deletes its row rather than
        -- marking it done — otherwise the customer is told "already
        -- processing" for the whole window on a request that produced nothing.
        state       VARCHAR(16)  NOT NULL DEFAULT 'in_flight',
        status_code INTEGER,
        response    JSONB,
        created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS request_idempotency_age_idx
      ON request_idempotency (created_at);`);

    // ─── OFFERS (2026-08-07) ──────────────────────────────────────
    // Promotions with live margin impact from the Costing engine.
    //
    // margin_floor: the margin an offer may not cross without an explicit
    // below-floor approval. Lives on pricing_settings because it is a pricing
    // policy, not an offer attribute — one floor governs every offer.
    await client.query(`
      ALTER TABLE pricing_settings
        ADD COLUMN IF NOT EXISTS margin_floor NUMERIC(6,4) NOT NULL DEFAULT 0.25;
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS offers (
        id                   BIGSERIAL     PRIMARY KEY,
        name                 VARCHAR(80)   NOT NULL,
        type                 VARCHAR(10)   NOT NULL,   -- pct | bonus | days | fixed
        value                NUMERIC(10,2) NOT NULL,
        plan_ids             INT[]         NOT NULL,
        audience_mode        VARCHAR(10)   NOT NULL,   -- all | segment | picked
        segment_json         JSONB,
        renewal_rule         VARCHAR(10)   NOT NULL DEFAULT 'first',
        renewal_months       INT,
        delivery_code        BOOLEAN       NOT NULL DEFAULT FALSE,
        delivery_auto        BOOLEAN       NOT NULL DEFAULT FALSE,
        -- Stored so a campaign can be designed now, but NO sender exists.
        -- TODO(email-on-hold): the owner will ask for the email phase once his
        -- mail server is configured. Until then nothing reads this to send.
        delivery_email       BOOLEAN       NOT NULL DEFAULT FALSE,
        starts_at            DATE          NOT NULL,
        ends_at              DATE          NOT NULL,
        max_per_client       INT           NOT NULL DEFAULT 1,
        max_total            INT,
        below_floor_approved BOOLEAN       NOT NULL DEFAULT FALSE,
        status               VARCHAR(10)   NOT NULL DEFAULT 'draft',
        created_by           VARCHAR(80),
        approved_by          VARCHAR(80),
        approved_at          TIMESTAMPTZ,
        created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS offers_status_idx ON offers (status, starts_at);`);

    // client_id is INTEGER with a real foreign key: users.id is SERIAL, not the
    // BIGINT the brief assumed, and an unconstrained id column would happily
    // store references to users who no longer exist.
    await client.query(`
      CREATE TABLE IF NOT EXISTS offer_picked_clients (
        offer_id  BIGINT  NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
        client_id INTEGER NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
        PRIMARY KEY (offer_id, client_id)
      );
    `);

    // NOT `promo_codes`. That table already exists in production with a
    // different shape (code/credits/max_redemptions/redeemed_count) and holds
    // live customer codes behind the Promo Codes CRM. CREATE TABLE IF NOT
    // EXISTS would silently no-op against it and every offer_id/uses query
    // would then fail at runtime. Offers get their own table by the owner's
    // decision (2026-08-07).
    await client.query(`
      CREATE TABLE IF NOT EXISTS offer_codes (
        id       BIGSERIAL   PRIMARY KEY,
        offer_id BIGINT      NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
        code     VARCHAR(30) NOT NULL UNIQUE,
        uses     INT         NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS offer_redemptions (
        id                       BIGSERIAL   PRIMARY KEY,
        offer_id                 BIGINT      NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
        client_id                INTEGER     NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
        subscription_or_order_id BIGINT,
        amount_saved             NUMERIC(10,2),
        bonus_credits_granted    NUMERIC(10,2),
        redeemed_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS offer_redemptions_offer_idx ON offer_redemptions (offer_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS offer_redemptions_client_idx ON offer_redemptions (client_id, offer_id);`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS saved_segments (
        id           SERIAL       PRIMARY KEY,
        name         VARCHAR(60)  NOT NULL,
        segment_json JSONB        NOT NULL,
        created_by   VARCHAR(80),
        created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );
    `);

    // ─── EMAIL: password resets + unsubscribes (2026-08-07) ───────
    // Password reset. The token itself is NEVER stored — only its SHA-256
    // hash, for the same reason passwords are hashed: a leaked backup must
    // not hand someone a working key to every account with a pending reset.
    await client.query(`
      CREATE TABLE IF NOT EXISTS password_resets (
        id         BIGSERIAL   PRIMARY KEY,
        user_id    INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash VARCHAR(64) NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        used_at    TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    // Redemption looks the token up by hash, so this index is the whole
    // lookup path — without it every reset scans the table.
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS password_resets_hash_idx ON password_resets (token_hash);`);
    await client.query(`CREATE INDEX IF NOT EXISTS password_resets_user_idx ON password_resets (user_id) WHERE used_at IS NULL;`);

    // Unsubscribes. Keyed by EMAIL, not user_id, on purpose: someone who never
    // had an account (a forwarded campaign) must still be able to opt out, and
    // deleting an account must not silently resubscribe that address.
    await client.query(`
      CREATE TABLE IF NOT EXISTS email_suppressions (
        email      VARCHAR(255) PRIMARY KEY,
        reason     VARCHAR(40)  NOT NULL DEFAULT 'unsubscribed',
        created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );
    `);

    // Which address each kind of message sends from. Editable in the CRM so
    // changing them needs no deploy. NULL = use the code's fallback.
    for (const col of ['from_system', 'from_announce', 'from_billing', 'from_support', 'from_legal']) {
      await client.query(`ALTER TABLE notification_settings ADD COLUMN IF NOT EXISTS ${col} VARCHAR(120);`);
    }
    // Master switch for the email channel, OFF until the owner has seen a real
    // message arrive. Same rollout shape as the customer bell.
    await client.query(`ALTER TABLE notification_settings ADD COLUMN IF NOT EXISTS email_enabled BOOLEAN NOT NULL DEFAULT FALSE;`);

    // ─── NOTIFICATIONS (2026-08-07) ───────────────────────────────
    // A campaign is what the admin composed ONCE; `notifications` holds one row
    // per recipient. They are separate tables on purpose: read and click rates
    // are per person, and a single row with a recipient array could never
    // answer "did Layla read it?" — which is the whole point of the History tab.
    await client.query(`
      CREATE TABLE IF NOT EXISTS notification_campaigns (
        id            BIGSERIAL    PRIMARY KEY,
        type          VARCHAR(16)  NOT NULL,
        title         VARCHAR(160) NOT NULL,
        body          TEXT         NOT NULL,
        cta_text      VARCHAR(60),
        cta_url       VARCHAR(200),
        offer_id      BIGINT       REFERENCES offers(id) ON DELETE SET NULL,
        spotlight     BOOLEAN      NOT NULL DEFAULT FALSE,
        audience_mode VARCHAR(10)  NOT NULL DEFAULT 'all',
        segment_json  JSONB,
        scheduled_for TIMESTAMPTZ,
        expires_at    TIMESTAMPTZ,
        status        VARCHAR(10)  NOT NULL DEFAULT 'sent',
        delivered     INT          NOT NULL DEFAULT 0,
        skipped_cap   INT          NOT NULL DEFAULT 0,
        created_by    VARCHAR(80),
        created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        sent_at       TIMESTAMPTZ
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id          BIGSERIAL    PRIMARY KEY,
        campaign_id BIGINT       REFERENCES notification_campaigns(id) ON DELETE CASCADE,
        user_id     INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type        VARCHAR(16)  NOT NULL,
        title       VARCHAR(160) NOT NULL,
        body        TEXT         NOT NULL,
        cta_text    VARCHAR(60),
        cta_url     VARCHAR(200),
        code        VARCHAR(30),
        pinned      BOOLEAN      NOT NULL DEFAULT FALSE,
        read_at     TIMESTAMPTZ,
        clicked_at  TIMESTAMPTZ,
        expires_at  TIMESTAMPTZ,
        created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );
    `);
    // The bell asks "my unread, newest first" on every page load, so this index
    // is what keeps that off a sequential scan as the table grows.
    await client.query(`CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, created_at DESC);`);
    await client.query(`CREATE INDEX IF NOT EXISTS notifications_unread_idx ON notifications (user_id) WHERE read_at IS NULL;`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS notification_automations (
        key            VARCHAR(32)  PRIMARY KEY,
        name           VARCHAR(60)  NOT NULL,
        icon           VARCHAR(8),
        type           VARCHAR(16)  NOT NULL,
        trigger_label  VARCHAR(80)  NOT NULL,
        n              INT,
        template       TEXT         NOT NULL,
        is_system      BOOLEAN      NOT NULL DEFAULT FALSE,
        -- TRUE = nothing in this codebase can ever fire it (no checkout, so no
        -- renewals and no charges). Shipped switched off and labelled rather
        -- than looking armed. See notifications-engine.js.
        needs_checkout BOOLEAN      NOT NULL DEFAULT FALSE,
        enabled        BOOLEAN      NOT NULL DEFAULT TRUE,
        updated_by     VARCHAR(80),
        updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS notification_settings (
        id                   INT          PRIMARY KEY DEFAULT 1,
        daily_marketing_cap  INT          NOT NULL DEFAULT 2,
        bell_enabled         BOOLEAN      NOT NULL DEFAULT FALSE,
        updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        CONSTRAINT notification_settings_singleton CHECK (id = 1)
      );
    `);
    await client.query(`
      INSERT INTO notification_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
    `);

    // ── seed, ONCE ────────────────────────────────────────────────
    // Deliberately insert-only. A boot must never overwrite a cost the owner
    // has edited in the CRM, so ON CONFLICT DO NOTHING is the whole point:
    // the seed establishes a starting picture and then gets out of the way.
    await client.query(`
      INSERT INTO pricing_settings (id, margin_target, credit_value)
      VALUES (1, 0.4000, 0.06333333)
      ON CONFLICT (id) DO NOTHING;
    `);
    for (const p of COSTING_PLANS_SEED) {
      await client.query(
        `INSERT INTO pricing_plans (name, price_usd, sort_order)
         VALUES ($1, $2, $3) ON CONFLICT (sort_order) DO NOTHING`,
        [p.name, p.price_usd, p.sort_order]
      );
    }
    for (const m of COSTING_MODELS_SEED) {
      await client.query(
        `INSERT INTO pricing_models
           (category, model_name, variant, resolution, unit, kie_cost, fal_cost, sort_order, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'seed')
         ON CONFLICT (model_name, COALESCE(variant,''), COALESCE(resolution,'')) DO NOTHING`,
        [m.category, m.model_name, m.variant, m.resolution, m.unit, m.kie_cost, m.fal_cost, m.sort]
      );
    }
    {
      const { rows } = await client.query('SELECT COUNT(*)::int AS n FROM pricing_models');
      console.log(`[db] costing: ${rows[0].n} model rows priced`);
    }

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

    // ─── waitlist ────────────────────────────────────────────────────
    // /edit invited people to "be notified when VOXEL Edit launches",
    // validated their address, showed a success toast — and threw the
    // address away. There was no table and no endpoint. Every person who
    // ever asked to hear about it was lost, silently, and the page kept
    // asking.
    //
    // A promise the system does not keep is worse than no promise: these
    // are people declaring interest in a product still being scoped.
    await client.query(`
      CREATE TABLE IF NOT EXISTS waitlist (
        id          SERIAL PRIMARY KEY,
        email       VARCHAR(255) NOT NULL,
        source      VARCHAR(64)  NOT NULL DEFAULT 'edit',
        user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
        ip_address  INET,
        user_agent  TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    // One row per address per source: signing up twice is not two people,
    // and the count must mean "how many are waiting", not "how many clicks".
    await client.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS waitlist_email_source_idx
         ON waitlist (lower(email), source);`);
    await client.query(
      `CREATE INDEX IF NOT EXISTS waitlist_created_idx ON waitlist (created_at DESC);`);

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
    // WHY a failed video needs its REASON, not just its status.
    //
    // The Reliability screen exists to say "do not demonstrate this model in
    // front of a room". Its first run said exactly that about Nano Banana Pro
    // — and 1,234 of the failures it counted were fal and kie refusing because
    // OUR OWN balance was empty, which fails whatever model is running. That
    // is advice to drop your best model over a billing problem.
    //
    // Status alone cannot tell the two apart: 'refunded' is 'refunded'. So the
    // reason is recorded here, letting an EXACT verdict keep the same split
    // the inferred one already makes.
    await client.query(`ALTER TABLE pending_video_charges ADD COLUMN IF NOT EXISTS failure_reason TEXT;`);
    // Serves the per-model reliability rollup: label + status, newest window.
    await client.query(`CREATE INDEX IF NOT EXISTS pending_video_charges_label_idx
      ON pending_video_charges (model_label, created_at DESC) WHERE model_label IS NOT NULL;`);

    // ─── deleted_at on entities (2026-08-28) ────────────────────────
    // Deleting a picture used to remove the row outright: a customer who
    // deleted by mistake had lost it, and nobody could help them. Amr approved
    // a 30-day recovery window, so history is now marked rather than removed.
    //
    // Nullable, no default: every existing row becomes "not deleted" the
    // moment this lands, and not one of them is touched.
    await client.query(SOFT_DELETE_DDL);

    // ─── pending_image_jobs (2026-08-28) ────────────────────────────
    // Images that finish AFTER we stop waiting. The synchronous poll gives up
    // at 90s because Cloudflare cuts a proxied request at about 100 — but on
    // 28 August six customers were refunded for images that finished at 94,
    // 97, 125, 130, 144 and 314 seconds. All six succeeded and all six were
    // paid for. The request has to end; the JOB must not.
    // See server/src/slow-image.js for the hand-off and the exactly-once lock.
    await client.query(SLOW_IMAGE_DDL);

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

    // ─── Sign in with Google ────────────────────────────────────────
    // google_sub is Google's own stable user id. Linking on THIS rather than
    // on the email address matters: a person can change the address on their
    // Google account, and Google can reassign a Workspace address to a new
    // employee. The sub never changes and is never reused.
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub VARCHAR(64);`);
    // Microsoft. Stored separately from google_sub: a person may legitimately
    // hold both, and the two id spaces are unrelated.
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS microsoft_sub VARCHAR(64);`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS users_microsoft_sub_idx ON users (microsoft_sub) WHERE microsoft_sub IS NOT NULL;`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub_idx ON users (google_sub) WHERE google_sub IS NOT NULL;`);
    // Google-only accounts have no password at all. Storing a fake hash would
    // be worse than NULL: it looks like a credential and would quietly become
    // one if anything ever compared against it.
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='users' AND column_name='password_hash'
                     AND is_nullable='NO') THEN
          ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
        END IF;
      END $$;
    `);

    // ─── one-shot admin promotion ───────────────────────────────────
    const promoted = await client.query(
      `UPDATE users SET role = 'admin' WHERE email = $1 AND role <> 'admin' RETURNING id`,
      [ADMIN_EMAIL]
    );
    if (promoted.rowCount > 0) {
      console.log(`[db] promoted ${ADMIN_EMAIL} → role=admin`);
    }

    // Audience counters (#64). Created here so the very first page view after a
    // deploy has somewhere to go — a counter whose table appears lazily loses
    // whatever arrived before someone opened the tab.
    await client.query(`
      CREATE TABLE IF NOT EXISTS page_views (
        day           DATE         NOT NULL,
        path          VARCHAR(200) NOT NULL,
        referrer_host VARCHAR(120) NOT NULL DEFAULT 'direct',
        views         INTEGER      NOT NULL DEFAULT 0,
        PRIMARY KEY (day, path, referrer_host)
      )`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS page_visitors (
        day          DATE        NOT NULL,
        visitor_hash VARCHAR(32) NOT NULL,
        PRIMARY KEY (day, visitor_hash)
      )`);
    // WHEN counting started — what lets the screen say "before this date is
    // unknown" rather than drawing a zero nobody ever measured.
    await client.query(`
      CREATE TABLE IF NOT EXISTS audience_meta (
        id         INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        started_on DATE NOT NULL DEFAULT CURRENT_DATE
      )`);
    await client.query(`INSERT INTO audience_meta (id) VALUES (1) ON CONFLICT DO NOTHING`);

    // Expenses (#59). Created at boot so the tab works the moment it is opened
    // rather than lazily on first write.
    await client.query(`
      CREATE TABLE IF NOT EXISTS expenses (
        id           SERIAL PRIMARY KEY,
        name         VARCHAR(120)  NOT NULL,
        category     VARCHAR(40)   NOT NULL DEFAULT 'other',
        amount       NUMERIC(12,2) NOT NULL,
        cycle        VARCHAR(16)   NOT NULL DEFAULT 'monthly',
        renews_on    DATE,
        critical     BOOLEAN       NOT NULL DEFAULT FALSE,
        note         TEXT,
        cancelled_at TIMESTAMPTZ,
        created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
      )`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS provider_invoices (
        provider   VARCHAR(40)   NOT NULL,
        month      VARCHAR(7)    NOT NULL,
        amount     NUMERIC(12,2) NOT NULL,
        fetched_at TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        PRIMARY KEY (provider, month)
      )`);

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
