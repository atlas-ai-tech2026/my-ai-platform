// ─── video-charges.js ────────────────────────────────────────────────────────
// H4 (security audit 2026-07-28): async video charges lived in an in-memory
// Map. Async jobs are charged at SUBMIT but can fail minutes later, so a
// deploy or restart in that window erased the record — the job failed, no
// refund was ever issued, and the user silently lost the credits.
//
// The record now lives in `pending_video_charges` (see db.js migrate()).
// Exactly-once refunding comes from the row's status transition:
//
//     UPDATE ... SET status='refunded' WHERE job_id=$1 AND status='pending'
//
// Only ONE caller can win that UPDATE, so concurrent pollers (two browser
// tabs, rapid polling) and a boot-time reconcile can all race safely — the
// loser gets rowCount 0 and does nothing. This mirrors the existing
// refunded-flag-before-payout pattern the audit verified as correct, moved
// from process memory into the database where it survives a restart.

import { pool, isReady as dbReady } from './db.js';
import { refundCredits } from './credits.js';

/** Record a charge for an in-flight async video job. Never throws — a
 * tracking failure must not fail the user's generation, but it IS logged
 * loudly because it means a later failure could go unrefunded. */
export async function trackVideoCharge(jobId, { userId, kind = 'video', cost, modelId = null, modelLabel = null }) {
  if (!jobId || !dbReady()) return false;
  if (!Number.isFinite(Number(cost)) || Number(cost) <= 0) return false;
  try {
    await pool.query(
      `INSERT INTO pending_video_charges (job_id, user_id, kind, amount, model_id, model_label, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')
       ON CONFLICT (job_id) DO NOTHING`,
      [String(jobId), userId, kind, Number(cost), modelId, modelLabel]
    );
    return true;
  } catch (e) {
    console.error(`[video-charge] FAILED to record charge for job ${jobId} user=${userId}:`, e.message);
    return false;
  }
}

/** Mark a job settled (completed successfully — nothing owed back). */
export async function settleVideoCharge(jobId) {
  if (!jobId || !dbReady()) return false;
  try {
    const { rowCount } = await pool.query(
      `UPDATE pending_video_charges
          SET status = 'settled', settled_at = NOW()
        WHERE job_id = $1 AND status = 'pending'`,
      [String(jobId)]
    );
    return rowCount > 0;
  } catch (e) {
    console.error(`[video-charge] settle failed for job ${jobId}:`, e.message);
    return false;
  }
}

/**
 * Refund a failed async job EXACTLY ONCE. The status transition is the
 * lock: whoever wins the conditional UPDATE performs the refund; everyone
 * else no-ops. If the refund itself throws, the row is put back to
 * 'pending' so a later poll or the boot reconcile retries it.
 * Returns true iff a refund was executed by this call.
 */
export async function refundFailedVideo(jobId, reason) {
  if (!jobId || !dbReady()) return false;
  let rec;
  try {
    const { rows } = await pool.query(
      `UPDATE pending_video_charges
          SET status = 'refunded', settled_at = NOW()
        WHERE job_id = $1 AND status = 'pending'
        RETURNING user_id, kind, amount`,
      [String(jobId)]
    );
    rec = rows[0];
  } catch (e) {
    console.error(`[video-refund] claim failed for job ${jobId}:`, e.message);
    return false;
  }
  if (!rec) return false; // unknown job, or already settled/refunded

  try {
    await refundCredits({
      userId: rec.user_id,
      kind: rec.kind,
      cost: Number(rec.amount),
      reason: `video_failed_async: ${reason}`.slice(0, 500),
    });
    console.log(`[video-refund] refunded job ${jobId} user=${rec.user_id} amount=${rec.amount} (${reason})`);
    return true;
  } catch (e) {
    console.error(`[video-refund] FAILED for job ${jobId} user=${rec.user_id}:`, e.message);
    // Put it back so a later poll / the boot reconcile retries.
    await pool.query(
      `UPDATE pending_video_charges SET status = 'pending', settled_at = NULL WHERE job_id = $1`,
      [String(jobId)]
    ).catch(() => {});
    return false;
  }
}

/** Look up one charge record (any status). Returns
 * { jobId, userId, kind, amount, modelId, status } or null. */
export async function getVideoCharge(jobId) {
  if (!jobId || !dbReady()) return null;
  try {
    const { rows } = await pool.query(
      `SELECT job_id, user_id, kind, amount, model_id, model_label, status
         FROM pending_video_charges WHERE job_id = $1`,
      [String(jobId)]
    );
    if (!rows[0]) return null;
    const r = rows[0];
    return {
      jobId: r.job_id,
      userId: r.user_id,
      kind: r.kind,
      amount: Number(r.amount),
      modelId: r.model_id,
      modelLabel: r.model_label,
      status: r.status,
    };
  } catch (e) {
    console.error(`[video-charge] lookup failed for job ${jobId}:`, e.message);
    return null;
  }
}

/**
 * M5 (audit 2026-07-28): does this user own this job?
 *
 * Two sources, because not every job has a charge row (a free retry, or a
 * job submitted before H4 shipped):
 *   1. pending_video_charges.job_id → user_id  (written at submit time)
 *   2. the user's own GenerationHistory entity rows, which carry job_id
 *
 * Returns true only on a positive match, so an unknown job id is treated
 * as "not yours" and the route answers 404 — the same shape as the
 * ownership filtering the audit verified as correct elsewhere.
 */
export async function userOwnsJob(userId, jobId) {
  if (!userId || !jobId || !dbReady()) return false;
  try {
    const charge = await pool.query(
      'SELECT 1 FROM pending_video_charges WHERE job_id = $1 AND user_id = $2 LIMIT 1',
      [String(jobId), userId]
    );
    if (charge.rowCount > 0) return true;

    const entity = await pool.query(
      `SELECT 1 FROM entities
        WHERE user_id = $1 AND data->>'job_id' = $2
        LIMIT 1`,
      [userId, String(jobId)]
    );
    return entity.rowCount > 0;
  } catch (e) {
    console.error(`[video-charge] ownership check failed for job ${jobId}:`, e.message);
    return false;
  }
}

/**
 * Does this URL appear in the user's OWN generation history?
 *
 * Used by /api/download (H1). A host allow-list alone kept refusing
 * legitimate downloads, because outputs from different eras live on
 * different providers (FAL, kie, supabase, base44, Spaces…). Ownership is
 * both more permissive for real users AND stricter against SSRF: an
 * attacker cannot put an arbitrary URL into someone else's history, so
 * this can never be pointed at an internal address the user didn't
 * legitimately generate.
 */
export async function userOwnsMediaUrl(userId, url) {
  if (!userId || !url || !dbReady()) return false;
  try {
    const { rowCount } = await pool.query(
      `SELECT 1 FROM entities
        WHERE user_id = $1
          AND (data->>'result_url' = $2 OR data->>'url' = $2)
        LIMIT 1`,
      [userId, String(url)]
    );
    return rowCount > 0;
  } catch (e) {
    console.error('[download] history ownership check failed:', e.message);
    return false;
  }
}

/** Rows still 'pending' and older than `minAgeMinutes` — candidates for
 * boot reconciliation (a job submitted just before a restart). */
export async function listUnresolvedCharges({ minAgeMinutes = 10, limit = 500 } = {}) {
  if (!dbReady()) return [];
  try {
    const { rows } = await pool.query(
      `SELECT job_id, user_id, kind, amount, model_id, model_label, created_at
         FROM pending_video_charges
        WHERE status = 'pending'
          AND created_at < NOW() - ($1 || ' minutes')::INTERVAL
        ORDER BY created_at ASC
        LIMIT $2`,
      [String(minAgeMinutes), limit]
    );
    return rows;
  } catch (e) {
    console.error('[video-charge] listUnresolved failed:', e.message);
    return [];
  }
}

/**
 * Boot reconciliation: for every charge left 'pending' across a restart,
 * ask the provider what actually happened.
 *
 * @param checkStatus  async (row) => 'completed' | 'failed' | 'pending'
 *                     (injected by index.js, which owns the provider clients)
 */
export async function reconcilePendingCharges(checkStatus, { minAgeMinutes = 10 } = {}) {
  const rows = await listUnresolvedCharges({ minAgeMinutes });
  if (!rows.length) return { checked: 0, refunded: 0, settled: 0, stillPending: 0 };

  console.log(`[video-reconcile] ${rows.length} charge(s) unresolved across restart — checking with the provider`);
  let refunded = 0, settled = 0, stillPending = 0;
  for (const row of rows) {
    let verdict = 'pending';
    try {
      verdict = await checkStatus(row);
    } catch (e) {
      console.error(`[video-reconcile] status check failed for ${row.job_id}:`, e.message);
      continue; // leave pending; next boot retries
    }
    if (verdict === 'failed') {
      if (await refundFailedVideo(row.job_id, 'reconciled after restart: provider reports failed')) refunded++;
    } else if (verdict === 'completed') {
      await settleVideoCharge(row.job_id);
      settled++;
    } else {
      stillPending++;
    }
  }
  console.log(`[video-reconcile] done — refunded ${refunded}, settled ${settled}, still pending ${stillPending}`);
  return { checked: rows.length, refunded, settled, stillPending };
}
