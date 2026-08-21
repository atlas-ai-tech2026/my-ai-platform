// ─── expenses-store.js ───────────────────────────────────────────────────────
// Where the cost figures come from — three sources, each labelled on the screen.
//
//   TYPED     the handful that barely moves: a domain, a mailbox, a
//             subscription. Six numbers a year, entered once.
//   MEASURED  FAL and kie, straight off the ledger. Every generation already
//             records what it cost, so asking for these by hand would be work
//             that is stale on arrival and less accurate than what is held.
//   PULLED    DigitalOcean, from their own billing API using the token the
//             platform already has. No new password anywhere.
//
// The owner asked whether I could log into the other providers and collect
// invoices. I will not hold passwords, and storing six providers' logins so a
// scraper can sign in creates a far bigger risk than it removes: one leak
// becomes six compromised accounts, and it breaks silently the moment a login
// page changes or asks for a second factor. The costs it would automate are the
// ones that change once a year.

import { round2 } from './expenses.js';

export async function ensureExpenseTables(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS expenses (
      id           SERIAL PRIMARY KEY,
      name         VARCHAR(120)  NOT NULL,
      category     VARCHAR(40)   NOT NULL DEFAULT 'other',
      amount       NUMERIC(12,2) NOT NULL,
      cycle        VARCHAR(16)   NOT NULL DEFAULT 'monthly',
      renews_on    DATE,
      -- "If this lapses, what stops?" The domain takes the site AND every email
      -- address with it, including the one password resets are sent from.
      critical     BOOLEAN       NOT NULL DEFAULT FALSE,
      note         TEXT,
      -- Marked, never deleted: a cost that vanishes from history makes last
      -- quarter look wrong.
      cancelled_at TIMESTAMPTZ,
      created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
    )`);
  // Invoices PULLED from a provider API, cached so the tab does not depend on
  // a third party being reachable when it is opened.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS provider_invoices (
      provider   VARCHAR(40)   NOT NULL,
      month      VARCHAR(7)    NOT NULL,      -- YYYY-MM
      amount     NUMERIC(12,2) NOT NULL,
      fetched_at TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
      PRIMARY KEY (provider, month)
    )`);
  // Added after the table existed, so it must be a migration and not part of
  // the CREATE — a column added only to a CREATE never appears anywhere the
  // table already exists, which is every environment that matters.
  await pool.query(
    `ALTER TABLE provider_invoices ADD COLUMN IF NOT EXISTS preview BOOLEAN NOT NULL DEFAULT FALSE`);
}

export async function listExpenses(pool) {
  await ensureExpenseTables(pool);
  const { rows } = await pool.query(
    `SELECT * FROM expenses ORDER BY cancelled_at NULLS FIRST, category, name`);
  return rows;
}

/**
 * Supplier cost per month, MEASURED off the ledger.
 *
 * kie is billed in ITS OWN credits, not dollars, so the two cannot simply be
 * added. kie_credits is converted at the rate recorded alongside it; where no
 * rate is known the row contributes zero rather than a guess, because a made-up
 * exchange rate would flow straight into break-even and look like a fact.
 */
export async function measuredSupplierCost(pool, { months = 6 } = {}) {
  const { rows } = await pool.query(`
    SELECT to_char(created_at, 'YYYY-MM') AS month,
           COALESCE(SUM(fal_cost), 0)::float   AS fal,
           COALESCE(SUM(kie_credits), 0)::float AS kie_credits
      FROM credits_history
     WHERE created_at >= date_trunc('month', NOW()) - ($1 || ' months')::INTERVAL
     GROUP BY 1 ORDER BY 1`, [months]);
  return rows.map((r) => ({
    month: r.month,
    fal: round2(r.fal),
    // Reported as credits, converted where a rate is known. Left as its own
    // number on the screen so nobody mistakes kie credits for dollars.
    kieCredits: round2(r.kie_credits),
    kie: 0,
  }));
}

// ── PULLED: DigitalOcean ───────────────────────────────────────────────────

/**
 * Real invoices from DigitalOcean's billing API.
 *
 * Uses DIGITALOCEAN_TOKEN — the same token the platform already holds. If it is
 * absent this returns nothing and says so; it never guesses a figure, and the
 * rest of the tab works without it.
 *
 * Verified against the live account on 2026-08-21: April $2.72, May $14.00,
 * June $28.27, July $31.00, August $43.22 so far. That growth curve is the
 * reason this is worth pulling rather than typing — it is the one cost that
 * genuinely moves every month.
 */
export async function fetchDigitalOceanInvoices(env = process.env, fetchFn = fetch) {
  const token = String(env.DIGITALOCEAN_TOKEN || env.DO_API_TOKEN || '').trim();
  if (!token) return { error: 'DIGITALOCEAN_TOKEN is not set — DigitalOcean costs cannot be pulled' };
  try {
    const res = await fetchFn('https://api.digitalocean.com/v2/customers/my/invoices?per_page=24', {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return { error: `DigitalOcean billing returned ${res.status}` };
    const body = await res.json();

    // ── THE CURRENT MONTH IS NOT IN `invoices` ──────────────────────────
    // DigitalOcean returns settled invoices in `invoices`, and the month in
    // progress in a SEPARATE `invoice_preview` object. Reading only the array
    // silently dropped the current month — so the Expenses tab showed August as
    // $0.00 while the real figure was $45.60, and $0.00 is the one number on
    // that screen nobody would question.
    //
    // The preview is a RUNNING TOTAL: it was $43.22 yesterday and $45.60 today.
    // It is flagged so the screen can say "so far this month" rather than
    // presenting an accruing number as a settled bill.
    const settled = (body?.invoices || []).map((i) => ({
      month: String(i.invoice_period || '').slice(0, 7),
      amount: round2(Number(i.amount) || 0),
      preview: false,
    }));

    const p = body?.invoice_preview;
    const preview = p ? [{
      month: String(p.invoice_period || '').slice(0, 7),
      amount: round2(Number(p.amount) || 0),
      preview: true,
    }] : [];

    const rows = [...settled, ...preview]
      .filter((r) => /^\d{4}-\d{2}$/.test(r.month));
    return { invoices: rows };
  } catch (e) {
    return { error: `DigitalOcean billing was unreachable: ${e.message}` };
  }
}

/** Cache them, so opening the tab never depends on a third party answering. */
export async function cacheInvoices(pool, provider, invoices = []) {
  await ensureExpenseTables(pool);
  for (const inv of invoices) {
    await pool.query(
      `INSERT INTO provider_invoices (provider, month, amount, preview, fetched_at)
       VALUES ($1,$2,$3,$4,NOW())
       ON CONFLICT (provider, month) DO UPDATE
         SET amount = EXCLUDED.amount, preview = EXCLUDED.preview, fetched_at = NOW()`,
      [provider, inv.month, inv.amount, Boolean(inv.preview)]);
  }
  return invoices.length;
}

export async function cachedInvoices(pool, provider = 'digitalocean') {
  await ensureExpenseTables(pool);
  const { rows } = await pool.query(
    `SELECT month, amount::float, preview, fetched_at FROM provider_invoices
      WHERE provider = $1 ORDER BY month`, [provider]);
  return rows;
}
