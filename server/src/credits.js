// ─── Credits engine ─────────────────────────────────────────────────────────
//
// Single source of truth for charging/refunding user credits. Every spend
// goes through `chargeCredits()`; every refund (FAL failure, admin reversal)
// goes through `refundCredits()`. Both are atomic — an UPDATE that's
// conditional on sufficient balance, paired with a credits_history INSERT,
// inside a transaction.
//
// Configurable cost per kind via env vars so we can change pricing
// (e.g. image=1.5 once that decision is made) without redeploying code.

import { pool } from './db.js';
import { recordAttempt, settleAttempt, labelFrom } from './generation-events.js';
import { mirrorSpend, mirrorRefund } from './credit-lots-db.js';

/**
 * Keep the dated lots in step with a balance change, without ever letting a
 * lots bug touch the charge itself. A SAVEPOINT — not a bare try/catch —
 * because in Postgres an error poisons the whole transaction: without the
 * savepoint a mirror failure would abort the COMMIT and take the customer's
 * charge down with it. Drift is logged loudly and repaired by the sweep's
 * reconciliation, never silently absorbed.
 */
async function mirrorSafely(client, fn, tag) {
  await client.query('SAVEPOINT lots_mirror');
  try {
    await fn();
    await client.query('RELEASE SAVEPOINT lots_mirror');
  } catch (err) {
    await client.query('ROLLBACK TO SAVEPOINT lots_mirror').catch(() => {});
    console.error(`[credit-lots] ${tag} mirror failed (balance change stands):`, err.message);
  }
}

export const CREDIT_COSTS = {
  image: parseFloat(process.env.CREDIT_COST_IMAGE || '2'),
  video: parseFloat(process.env.CREDIT_COST_VIDEO || '10'),
  // Audio TTS is roughly an order of magnitude cheaper than image at FAL
  // pricing today; default 1 credit per take. Override with CREDIT_COST_AUDIO.
  audio: parseFloat(process.env.CREDIT_COST_AUDIO || '1'),
};

export class InsufficientCreditsError extends Error {
  constructor(balance, required) {
    super('Insufficient credits');
    this.name = 'InsufficientCreditsError';
    this.balance = Number(balance);
    this.required = Number(required);
  }
}

/**
 * Charge a user for a generation. Atomic and race-safe — the UPDATE only
 * fires if `credits >= cost AND banned = FALSE`. If 0 rows updated, we throw
 * `InsufficientCreditsError` with the current balance so the route can
 * return a meaningful 402 response.
 *
 * Wrapped in a transaction so the balance UPDATE and credits_history INSERT
 * either both happen or both don't.
 */
// Provider-cost share of a voxel credit: (1 − 40% margin) × $0.063333.
// Every model is priced so its provider cost is AT MOST this share of the
// sale — used as the fallback estimate when no explicit price is on file.
const PROVIDER_COST_SHARE_USD = 0.038;
const KIE_USD_PER_CREDIT = 0.005;

export async function chargeCredits({ userId, kind, ip, cost: costOverride, note, kieCredits, falCost, provider }) {
  // `cost` MUST be a SERVER-computed value (pricing.js resolveChargeCost)
  // or absent — never a client-supplied number (C1, audit 2026-07-28).
  // Fall back to the flat per-kind cost when it's missing/invalid
  // (e.g. TTS/music/node routes that bill flat per-kind rates).
  let cost = Number(costOverride);
  if (!Number.isFinite(cost) || cost <= 0) {
    cost = CREDIT_COSTS[kind];
  }
  if (cost == null || !Number.isFinite(cost)) {
    throw new Error(`Unknown or invalid credit kind: ${kind}`);
  }
  // Round to 2dp and clamp to a safety ceiling so a malformed request can't
  // charge an absurd amount.
  cost = Math.min(Math.round(cost * 100) / 100, 100000);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const u = await client.query(
      `UPDATE users
         SET credits = credits - $1
       WHERE id = $2 AND credits >= $1 AND banned = FALSE
       RETURNING credits`,
      [cost, userId]
    );

    if (u.rowCount === 0) {
      // Either insufficient balance, banned, or user doesn't exist.
      // Look up the actual balance so the API response is informative.
      const { rows } = await client.query(
        'SELECT credits, banned FROM users WHERE id = $1',
        [userId]
      );
      await client.query('ROLLBACK');

      if (!rows[0]) throw new Error('User no longer exists');
      if (rows[0].banned) {
        const e = new Error('Account is banned');
        e.code = 'BANNED';
        throw e;
      }
      throw new InsufficientCreditsError(rows[0].credits, cost);
    }

    // `note` labels the spend (e.g. "image: Nano Banana Pro") so the admin
    // ledger shows WHAT each charge was for, not just the amount.
    // `kie_credits` is the estimated KIE-credit cost on our kie.ai balance
    // (null for FAL-backed models / models without a kie price on file).
    let kie = Number.isFinite(Number(kieCredits)) && Number(kieCredits) > 0
      ? Math.round(Number(kieCredits) * 100) / 100 : null;
    // `fal_cost` is the FAL twin: estimated USD on our fal.ai bill.
    let fal = Number.isFinite(Number(falCost)) && Number(falCost) > 0
      ? Math.round(Number(falCost) * 10000) / 10000 : null;
    // No explicit price on file but the provider is known → margin-derived
    // fallback, so no billed generation ever shows "—" going forward.
    if (kie == null && provider === 'kie') {
      kie = Math.round(cost * (PROVIDER_COST_SHARE_USD / KIE_USD_PER_CREDIT) * 100) / 100;
    }
    if (fal == null && provider === 'fal') {
      fal = Math.round(cost * PROVIDER_COST_SHARE_USD * 10000) / 10000;
    }
    await client.query(
      `INSERT INTO credits_history (user_id, amount, action, reason, ip_address, kie_credits, fal_cost)
       VALUES ($1, $2, 'spend', $3, $4, $5, $6)`,
      [userId, -cost, (note || '').slice(0, 500) || null, ip || null, kie, fal]
    );

    // Owner's rule 2026-08-25: credits carry their addition date and die 30
    // days after it — so every spend drains the soonest-expiring lots first.
    await mirrorSafely(client, () => mirrorSpend(client, { userId, amount: cost }), 'spend');

    await client.query('COMMIT');

    // Telemetry AFTER the commit, on the pool rather than this client. Inside
    // the transaction a failed insert would abort it and take the customer's
    // charge down with it — a missing analytics row must never cost someone a
    // generation. recordAttempt swallows its own errors for the same reason.
    const eventId = await recordAttempt({ userId, kind, note, provider, credits: cost });

    // The model name, handed back so the caller can record it against an async
    // video job WITHOUT deriving it a second time.
    //
    // `pending_video_charges.model_label` sat NULL in all 3,046 rows because
    // every one of the ten call sites had to work the name out for itself, and
    // none of them bothered. Returning it from the one function that already
    // knows makes the ledger, the telemetry and the video charge agree by
    // construction — three tables that derive the same string separately are
    // three tables that eventually disagree.
    return { newBalance: Number(u.rows[0].credits), cost, eventId, label: labelFrom(note) };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Refund credits — used when a charge succeeded but the FAL call failed
 * after we'd already deducted. Best-effort; logs but doesn't throw on its
 * own failure (the caller is already in an error path; we don't want to
 * mask the original error with a refund failure).
 */
export async function refundCredits({ userId, kind, ip, reason, cost: costOverride }) {
  // Refund the exact amount charged (passed back from the route), falling
  // back to the flat per-kind cost.
  let cost = Number(costOverride);
  if (!Number.isFinite(cost) || cost <= 0) {
    cost = CREDIT_COSTS[kind];
  }
  if (cost == null || !Number.isFinite(cost)) return;
  cost = Math.min(Math.round(cost * 100) / 100, 100000);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'UPDATE users SET credits = credits + $1 WHERE id = $2',
      [cost, userId]
    );
    await client.query(
      `INSERT INTO credits_history (user_id, amount, action, reason, ip_address)
       VALUES ($1, $2, 'refund', $3, $4)`,
      [userId, cost, reason || 'fal call failed', ip || null]
    );
    // The refund lands in the newest live lot (longest usable window), or a
    // fresh 30-day lot when none is live — a refund must never expire on
    // arrival because of a timing accident our own failure caused.
    await mirrorSafely(client, () => mirrorRefund(client, { userId, amount: cost, reason }), 'refund');
    await client.query('COMMIT');

    // A refund IS the failure signal — it is the only moment the platform
    // knows a generation did not deliver. Recorded here so the Reliability
    // screen can stop inferring which model failed from timing and amount.
    await settleAttempt({ userId, outcome: 'failed', reason });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[credits] refund FAILED for user', userId, err.message);
  } finally {
    client.release();
  }
}
