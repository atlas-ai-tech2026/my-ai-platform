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
export async function chargeCredits({ userId, kind, ip, cost: costOverride }) {
  // Prefer the computed per-generation cost sent by the client (model +
  // resolution + duration aware). Fall back to the flat per-kind cost when
  // it's missing/invalid (e.g. a model not yet in the pricing table).
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

    await client.query(
      `INSERT INTO credits_history (user_id, amount, action, ip_address)
       VALUES ($1, $2, 'spend', $3)`,
      [userId, -cost, ip || null]
    );

    await client.query('COMMIT');
    return { newBalance: Number(u.rows[0].credits), cost };
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
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[credits] refund FAILED for user', userId, err.message);
  } finally {
    client.release();
  }
}
