// ─── credit-lots-db.js ───────────────────────────────────────────────────────
// The database half of credit lots. credit-lots.js decides, this file writes.
//
// ── THE MODEL, AND WHO IS THE AUTHORITY ────────────────────────────────────
// `users.credits` REMAINS the number that authorises a spend — chargeCredits'
// conditional UPDATE is untouched, because it is the battle-tested piece and
// this change must not put revenue at risk. Lots run alongside it as the
// dated ledger: born on every addition, drained on every spend
// (soonest-expiring first), and REDUCED TO THE BALANCE by the hourly sweep,
// which is the only writer that touches users.credits from here.
//
// The invariant that keeps both honest: for every non-admin account,
// SUM(remaining of unswept lots) == users.credits. The mirror maintains it,
// the sweep restores it, and drift is LOGGED LOUDLY rather than papered over
// — a mirror bug must never block a customer's generation, and must never
// hide either.
//
// ── TWO INSTANCES ──────────────────────────────────────────────────────────
// Production runs two containers (the 16-copies-of-one-backup lesson, #71).
// Every write here is safe to run twice at once: backfill takes the user row
// lock and re-checks inside the transaction; the sweep claims each lot with
// `expired_at IS NULL` under the same lock, so the second instance finds
// nothing left to take.

import { pool } from './db.js';
import { spendOrder, isExpired, describeBalance, round2 } from './credit-lots.js';
import { planBackfill, CREDIT_LIFE_DAYS } from './credit-backfill.js';

const ACTIVATION_FLAG = 'credit_lots_activated_at';

/** A credit addition becomes a lot with its own life. days=null → never expires. */
export async function addLot(client, { userId, amount, source, reason, days = CREDIT_LIFE_DAYS }) {
  const amt = round2(amount);
  if (!(amt > 0)) return null;
  const { rows } = await client.query(
    `INSERT INTO credit_lots (user_id, amount, remaining, source, reason, granted_at, expires_at)
     VALUES ($1, $2, $2, $3, $4, NOW(),
             CASE WHEN $5::int IS NULL THEN NULL ELSE NOW() + ($5::int || ' days')::INTERVAL END)
     RETURNING id, expires_at`,
    [userId, amt, source, (reason || '').slice(0, 500) || null, days == null ? null : Number(days)]
  );
  return rows[0];
}

/** Unswept lots that still hold credits, locked when the caller will write. */
async function loadUnswept(client, userId, { forUpdate = false } = {}) {
  const { rows } = await client.query(
    `SELECT id, remaining, expires_at, granted_at, created_at, source
       FROM credit_lots
      WHERE user_id = $1 AND remaining > 0 AND expired_at IS NULL
      ORDER BY id${forUpdate ? ' FOR UPDATE' : ''}`,
    [userId]
  );
  return rows.map((r) => ({ ...r, remaining: Number(r.remaining) }));
}

/**
 * Drain lots to mirror a spend users.credits already authorised.
 *
 * Order: live lots soonest-expiring first (the engine's rule), then lots that
 * expired but have not been swept yet — inside the up-to-an-hour grace window
 * the balance still contains them, so a spend the balance allowed must drain
 * them or the mirror drifts. A shortfall beyond that is real drift: taken
 * from nowhere, logged loudly, never thrown — the charge must stand.
 */
export async function mirrorSpend(client, { userId, amount, now = Date.now() }) {
  const want = round2(amount);
  if (!(want > 0)) return { drawn: 0, shortfall: 0 };

  const lots = await loadUnswept(client, userId, { forUpdate: true });
  const live = spendOrder(lots, now);
  const expiredUnswept = lots
    .filter((l) => isExpired(l, now))
    .sort((a, b) => new Date(a.expires_at) - new Date(b.expires_at));

  let left = want;
  for (const lot of [...live, ...expiredUnswept]) {
    if (left <= 0) break;
    const take = round2(Math.min(lot.remaining, left));
    if (take <= 0) continue;
    await client.query('UPDATE credit_lots SET remaining = remaining - $1 WHERE id = $2', [take, lot.id]);
    left = round2(left - take);
  }

  const shortfall = left;
  if (shortfall > 0) {
    console.error(`[credit-lots] DRIFT: spend of ${want} by user ${userId} found only ${round2(want - shortfall)} in lots — short ${shortfall}. An addition path is not creating lots.`);
  }
  return { drawn: round2(want - shortfall), shortfall };
}

/**
 * Where a refund lands: the newest live lot — the engine's own fallback rule,
 * chosen here for every refund because charges do not record which lots paid
 * them (a draws table is more machinery than the money justifies today).
 * A customer refunded for OUR failure gets the longest usable window; with no
 * live lot at all they get a fresh one with the standard life, so a refund
 * can never vanish into an expired lot.
 */
export async function mirrorRefund(client, { userId, amount, reason, now = Date.now() }) {
  const amt = round2(amount);
  if (!(amt > 0)) return null;

  const lots = await loadUnswept(client, userId, { forUpdate: true });
  const live = spendOrder(lots, now);
  if (live.length) {
    const newest = live.reduce((a, b) =>
      new Date(b.granted_at ?? b.created_at) > new Date(a.granted_at ?? a.created_at) ? b : a);
    await client.query('UPDATE credit_lots SET remaining = remaining + $1 WHERE id = $2', [amt, newest.id]);
    return { lotId: newest.id, to: 'newest-live' };
  }
  const lot = await addLot(client, { userId, amount: amt, source: 'refund', reason });
  return { lotId: lot?.id, to: 'fresh' };
}

/**
 * Date one user's existing balance from its real addition dates (the ledger).
 * Runs inside the caller's transaction; takes the user row lock so two
 * instances booting together cannot both backfill the same person.
 */
export async function backfillUserLots(client, userId) {
  const u = await client.query('SELECT credits, role FROM users WHERE id = $1 FOR UPDATE', [userId]);
  if (!u.rowCount) return { skipped: 'no-user' };
  const already = await client.query('SELECT 1 FROM credit_lots WHERE user_id = $1 LIMIT 1', [userId]);
  if (already.rowCount) return { skipped: 'has-lots' };

  const { rows: additions } = await client.query(
    `SELECT amount, action, reason, created_at FROM credits_history
      WHERE user_id = $1 AND amount > 0 ORDER BY created_at DESC`,
    [userId]
  );
  const plan = planBackfill({ balance: Number(u.rows[0].credits), additions });
  for (const lot of plan.lots) {
    await client.query(
      `INSERT INTO credit_lots (user_id, amount, remaining, source, reason, granted_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, lot.amount, lot.remaining, lot.source, lot.reason, lot.granted_at, lot.expires_at]
    );
  }
  return { created: plan.lots.length, attributed: plan.attributed, unattributed: plan.unattributed };
}

/** Boot pass: every account with credits and no lots yet gets its dates. */
export async function backfillAllUsers() {
  const { rows } = await pool.query(
    `SELECT u.id FROM users u
      WHERE u.credits > 0 AND NOT EXISTS (SELECT 1 FROM credit_lots l WHERE l.user_id = u.id)
      ORDER BY u.id`
  );
  let users = 0, attributed = 0, unattributed = 0;
  for (const { id } of rows) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const r = await backfillUserLots(client, id);
      await client.query('COMMIT');
      if (!r.skipped) {
        users += 1;
        attributed = round2(attributed + r.attributed);
        unattributed = round2(unattributed + r.unattributed);
      }
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error(`[credit-lots] backfill failed for user ${id}:`, err.message);
    } finally {
      client.release();
    }
  }
  if (users > 0) {
    console.log(`[credit-lots] backfill: dated ${users} account(s) — ${attributed} credits attributed to their addition dates, ${unattributed} unattributed (given ${CREDIT_LIFE_DAYS} days from today)`);
  }
  return { users, attributed, unattributed };
}

/** NULL until the owner has read the preview and pressed Activate. */
export async function activatedAt() {
  const { rows } = await pool.query('SELECT value FROM app_flags WHERE key = $1', [ACTIVATION_FLAG]);
  return rows[0]?.value?.at || null;
}

/**
 * Take what has passed its 30 days, one user per transaction.
 *
 * Per user: claim the due lots (the `expired_at IS NULL` condition is the
 * claim — a second instance finds them already marked), remove the total from
 * users.credits CAPPED AT THE BALANCE (never negative), and write ONE ledger
 * row naming the addition dates, because a balance that changes with no
 * record is how a dispute becomes unanswerable.
 */
export async function sweepDueLots({ label = 'sweep' } = {}) {
  const { rows: due } = await pool.query(
    `SELECT DISTINCT l.user_id FROM credit_lots l JOIN users u ON u.id = l.user_id
      WHERE l.remaining > 0 AND l.expired_at IS NULL AND l.expires_at <= NOW()
        AND u.role <> 'admin'
      ORDER BY l.user_id`
  );

  let users = 0, credits = 0;
  for (const { user_id } of due) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT credits FROM users WHERE id = $1 FOR UPDATE', [user_id]);
      const { rows: taken } = await client.query(
        `WITH due AS (
           SELECT id, remaining, granted_at FROM credit_lots
            WHERE user_id = $1 AND remaining > 0 AND expired_at IS NULL AND expires_at <= NOW()
            FOR UPDATE
         )
         UPDATE credit_lots l SET remaining = 0, expired_at = NOW()
           FROM due WHERE l.id = due.id
         RETURNING due.remaining AS taken, due.granted_at`,
        [user_id]
      );
      if (!taken.length) { await client.query('COMMIT'); continue; }

      const total = round2(taken.reduce((n, r) => n + Number(r.taken), 0));
      const upd = await client.query(
        `UPDATE users SET credits = LEAST(credits, GREATEST(credits - $1, 0))
          WHERE id = $2 RETURNING credits`,
        [total, user_id]
      );
      const days = [...new Set(taken.map((r) => new Date(r.granted_at).toISOString().slice(0, 10)))];
      await client.query(
        `INSERT INTO credits_history (user_id, amount, action, reason, source)
         VALUES ($1, $2, 'expire', $3, 'system')`,
        [user_id, -total,
         `credits expired — ${CREDIT_LIFE_DAYS} days after they were added (added ${days.join(', ')})`.slice(0, 500)]
      );
      await client.query('COMMIT');
      users += 1;
      credits = round2(credits + total);

      const after = Number(upd.rows[0]?.credits ?? 0);
      if (after < 0) console.error(`[credit-lots] DRIFT: user ${user_id} balance ${after} after sweep`);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error(`[credit-lots] ${label} failed for user ${user_id}:`, err.message);
    } finally {
      client.release();
    }
  }
  if (users > 0) console.log(`[credit-lots] ${label}: expired ${credits} credit(s) across ${users} account(s)`);
  return { users, credits };
}

/** The balance line a customer should see: total, and the piece that dies first. */
export async function userCreditSummary(userId) {
  const { rows } = await pool.query(
    `SELECT id, remaining, expires_at, created_at FROM credit_lots
      WHERE user_id = $1 AND remaining > 0 AND expired_at IS NULL`,
    [userId]
  );
  return describeBalance(rows.map((r) => ({ ...r, remaining: Number(r.remaining) })));
}

/**
 * Everything the admin panel needs in one read: whether the rule is live, what
 * the first press would do, and the day-by-day look-ahead after it.
 */
export async function lotsOverview({ aheadDays = 30 } = {}) {
  const activated_at = await activatedAt();

  const { rows: [dueNow] } = await pool.query(
    `SELECT COUNT(DISTINCT l.user_id)::int AS accounts, COALESCE(SUM(l.remaining), 0)::float AS credits
       FROM credit_lots l JOIN users u ON u.id = l.user_id
      WHERE l.remaining > 0 AND l.expired_at IS NULL AND l.expires_at <= NOW()
        AND u.role <> 'admin'`
  );
  const { rows: [locked] } = await pool.query(
    `SELECT COUNT(*)::int AS accounts FROM users
      WHERE expires_at IS NOT NULL AND role <> 'admin'`
  );
  const { rows: [unattributed] } = await pool.query(
    `SELECT COALESCE(SUM(remaining), 0)::float AS credits FROM credit_lots
      WHERE source = 'backfill-unattributed' AND remaining > 0 AND expired_at IS NULL`
  );
  const { rows: upcoming } = await pool.query(
    `SELECT to_char(l.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
            COUNT(DISTINCT l.user_id)::int AS accounts,
            ROUND(SUM(l.remaining), 2)::float AS credits,
            ARRAY_AGG(DISTINCT u.email ORDER BY u.email) AS emails
       FROM credit_lots l JOIN users u ON u.id = l.user_id
      WHERE l.remaining > 0 AND l.expired_at IS NULL
        AND l.expires_at > NOW() AND l.expires_at <= NOW() + ($1::int || ' days')::INTERVAL
        AND u.role <> 'admin'
      GROUP BY 1 ORDER BY 1`,
    [aheadDays]
  );
  const { rows: [swept] } = await pool.query(
    `SELECT MAX(expired_at) AS last FROM credit_lots WHERE expired_at IS NOT NULL`
  );

  return {
    activated_at,
    life_days: CREDIT_LIFE_DAYS,
    due_now: { accounts: dueNow.accounts, credits: round2(dueNow.credits) },
    locked_accounts: locked.accounts,
    unattributed_credits: round2(unattributed.credits),
    last_sweep_at: swept.last,
    upcoming,
  };
}

/**
 * The one press: unlock every account and start the rule, atomically, then
 * run the first sweep. The flag and the unlock share a transaction — if the
 * immediate sweep then fails, the hourly job finishes the same work within
 * the hour, so a half-activated state cannot exist.
 */
export async function activateNow({ adminEmail, expectAccounts, expectCredits }) {
  const fresh = await lotsOverview({ aheadDays: 1 });
  if (fresh.activated_at) return { conflict: 'already-activated', activated_at: fresh.activated_at };
  if (fresh.due_now.accounts !== expectAccounts || round2(fresh.due_now.credits) !== round2(expectCredits)) {
    return { conflict: 'numbers-moved', now: fresh.due_now };
  }

  const client = await pool.connect();
  let unlocked = 0;
  try {
    await client.query('BEGIN');
    const un = await client.query(
      `UPDATE users SET expires_at = NULL WHERE expires_at IS NOT NULL RETURNING id`);
    unlocked = un.rowCount;
    await client.query(
      `INSERT INTO app_flags (key, value) VALUES ($1, jsonb_build_object('at', NOW(), 'by', $2::text))
       ON CONFLICT (key) DO NOTHING`,
      [ACTIVATION_FLAG, adminEmail || null]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  console.log(`[credit-lots] ACTIVATED by ${adminEmail} — ${unlocked} account(s) unlocked`);

  let sweep = null, sweepError = null;
  try {
    sweep = await sweepDueLots({ label: 'first sweep' });
  } catch (err) {
    sweepError = err.message;
    console.error('[credit-lots] first sweep failed (hourly job will finish it):', err.message);
  }
  return { activated: true, unlocked, sweep, sweep_error: sweepError };
}

/** Hourly, both instances, harmless to double-run. Quiet until activated. */
export function scheduleCreditLotSweep({ ready }) {
  const run = async () => {
    try {
      if (!ready()) return;
      if (!(await activatedAt())) return;
      await sweepDueLots({ label: 'hourly sweep' });
    } catch (err) {
      console.error('[credit-lots] hourly sweep failed:', err.message);
    }
  };
  setTimeout(run, 6 * 60 * 1000).unref?.();
  setInterval(run, 60 * 60 * 1000).unref?.();
}
