// ─── preflight-routes.js ─────────────────────────────────────────────────────
// GET /api/admin/preflight?code=VOXEL20
//
// Gathers the four facts and hands them to preflight.js, which does all the
// judging. Nothing here decides anything — that separation is what lets the
// judgement be tested without a database, and it is why every threshold on
// this screen lives in one file rather than in a query.
//
// EVERY FACT IS BORROWED, NEVER RE-DERIVED. The alert rows come from the same
// query the Alerts tab runs, the balance from the same balanceFacts() the SOP
// tab's own numbers come from, the model verdicts from the same
// gatherReliability() behind Costing → Reliability, the code from the same
// columns /api/redeem-code checks. If any of them ever disagrees with its own
// tab that is a bug, and this arrangement makes it impossible for the
// disagreement to originate here.
//
// BORROWED IS NOT THE SAME AS "CALL WHATEVER THE OTHER SCREEN CALLS". The
// first version took the balance by calling gatherFacts(), which also counts
// media durability with a full scan of `entities`. It needed two numbers and
// paid for the whole scan: pressed on production it took over two minutes.
// balanceFacts() is the shared piece that is actually shared — same source,
// none of the cost that belongs to a different question.

import { balanceFacts } from './alerts-routes.js';
import { gatherReliability } from './reliability-routes.js';
import { balanceLine } from './sop-engine.js';
import { splitInvites } from './promo-audience.js';
import { judgePreflight } from './preflight.js';

/** The reliability window. 30 days is what the Costing tab shows. */
const WINDOW_DAYS = 30;

/**
 * ☠ HOW LONG ANY ONE SOURCE MAY TAKE BEFORE IT IS CALLED UNKNOWN.
 *
 * Pressed on production the first time, this screen took over two minutes and
 * Amr gave up before it answered. The cause was gatherFacts, which counts
 * media durability with a full scan of `entities` — the pre-flight needed two
 * numbers from it and inherited the whole scan. That is fixed at the source
 * (balanceFacts), but the lesson generalises: THE ONE SCREEN YOU READ WITH A
 * ROOM FILLING UP MUST NOT BE ABLE TO HANG.
 *
 * So every source is raced against a clock. A check that does not answer in
 * time reports UNKNOWN — which this screen already refuses to call ready — and
 * the headline says so. Ten seconds and an honest "could not check the models
 * in time" beats two minutes and a spinner, every time.
 */
export const SOURCE_TIMEOUT_MS = 8_000;

/** Reject after `ms`, so one slow query cannot hold the other three hostage. */
export function withTimeout(promise, ms, what) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} took longer than ${Math.round(ms / 1000)}s`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * Attendees whose credits die TODAY.
 *
 * The quiet failure this screen exists to catch. Credits expire 30 days after
 * they are added, so a cohort that redeemed at an earlier session still has a
 * perfectly valid code and nothing to spend. Nothing else puts those two facts
 * on the same screen.
 *
 * Scoped to people who redeemed THIS code, so it answers "this cohort" rather
 * than "the business".
 */
export const EXPIRING_TODAY_SQL = `
  SELECT COUNT(DISTINCT l.user_id)::int AS n
    FROM credit_lots l
    JOIN promo_redemptions r ON r.user_id = l.user_id
   WHERE r.code_id = $1
     AND l.remaining > 0
     AND l.expires_at IS NOT NULL
     AND l.expires_at::date <= NOW()::date
`;

export const CODE_SQL = `
  SELECT id, code, credits, max_redemptions, redeemed_count, active, expires_at,
         description, access_days
    FROM promo_codes
   WHERE upper(code) = upper($1)
`;

export const INVITES_SQL = `
  SELECT e.email, e.redeemed_at
    FROM promo_code_emails e
   WHERE e.code_id = $1
`;

/** Codes worth offering in the picker: on, unexpired, with uses left. */
export const USABLE_CODES_SQL = `
  SELECT code, description, redeemed_count, max_redemptions, expires_at
    FROM promo_codes
   WHERE active = true
     AND (expires_at IS NULL OR expires_at > NOW())
   ORDER BY created_at DESC
   LIMIT 100
`;

export function registerPreflightRoutes(app, { pool, dbReady, adminGate, getKieCredits }) {
  app.get('/api/admin/preflight', adminGate, async (req, res) => {
    if (!dbReady()) return res.status(503).json({ error: 'Database not configured.' });
    const wanted = String(req.query.code || '').trim();

    // Each fact is gathered independently and its failure is CAPTURED, never
    // thrown. One unreachable supplier must not blank the other three checks —
    // a screen that goes empty when something breaks is a screen that tells you
    // least exactly when you need it most. Each failure becomes an UNKNOWN,
    // which preflight.js refuses to call ready.
    // Each source is timed AND bounded. The timings are logged because the
    // first version of this screen was slow and nothing on the server said
    // which part — a diagnosis by reasoning is not a measurement.
    const timings = {};
    const settle = async (what, fn) => {
      const started = Date.now();
      try {
        const value = await withTimeout(fn(), SOURCE_TIMEOUT_MS, what);
        timings[what] = Date.now() - started;
        return { value };
      } catch (e) {
        timings[what] = Date.now() - started;
        return { error: e?.message || String(e) };
      }
    };

    const [alertsR, factsR, relR, codesR] = await Promise.all([
      settle('alerts', () => pool.query(`SELECT * FROM alerts WHERE status <> 'resolved' ORDER BY last_seen DESC`)),
      settle('balance', () => balanceFacts(pool, { getKieCredits })),
      settle('models', () => gatherReliability(pool, WINDOW_DAYS)),
      settle('codes', () => pool.query(USABLE_CODES_SQL)),
    ]);

    // The cohort, only if one was asked for.
    let cohort = { code: null };
    if (wanted) {
      const found = await settle('cohort', () => pool.query(CODE_SQL, [wanted]));
      const row = found.value?.rows?.[0] || null;
      if (row) {
        const [inv, exp] = await Promise.all([
          settle('invites', () => pool.query(INVITES_SQL, [row.id])),
          settle('credits-alive', () => pool.query(EXPIRING_TODAY_SQL, [row.id])),
        ]);
        cohort = {
          code: row,
          invites: inv.value ? splitInvites(inv.value.rows) : null,
          // null, not 0, when the query failed: a zero here would say
          // "everybody's credits are fine" on the strength of not having looked.
          expiringToday: exp.value ? (exp.value.rows[0]?.n || 0) : null,
        };
      }
    }

    const facts = factsR.value || {};
    const bl = factsR.error
      ? null
      : balanceLine({
        credits: facts.credits, burnPerDay: facts.burnPerDay,
        providerError: facts.providerError, now: new Date().toISOString(),
      });
    const days = (Number.isFinite(facts.credits) && facts.burnPerDay > 0)
      ? facts.credits / facts.burnPerDay : null;

    const verdict = judgePreflight({
      alerts: { open: alertsR.value?.rows || [], error: alertsR.error },
      balance: { balanceLine: bl, days },
      models: { summary: relR.value?.summary, models: relR.value?.models, error: relR.error },
      cohort,
    });

    // One line, so a slow press is diagnosable from the log instead of from a
    // theory about which query it must have been.
    const slowest = Object.entries(timings).sort((a, b) => b[1] - a[1])[0];
    console.log(`[preflight] ${verdict.state} in ${Object.values(timings).reduce((a, b) => a + b, 0)}ms — `
      + Object.entries(timings).map(([k, v]) => `${k} ${v}ms`).join(' · ')
      + (slowest && slowest[1] > 3000 ? `  ⚠ ${slowest[0]} is slow` : ''));

    res.json({
      ...verdict,
      timings,
      checked_at: new Date().toISOString(),
      window_days: WINDOW_DAYS,
      // The picker's options, so choosing a cohort needs no second request.
      codes: (codesR.value?.rows || []).map((c) => ({
        code: c.code, description: c.description,
        used: c.redeemed_count, cap: c.max_redemptions,
      })),
      chosen: cohort.code?.code || null,
    });
  });
}
