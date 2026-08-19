// ─── generation-events.js ────────────────────────────────────────────────────
// One row per generation attempt: which model, whether it worked, how long it
// took. The thing nothing has ever recorded.
//
// WHY IT IS NEEDED, twice over:
//
//   · The Reliability screen (Tier 1.3) currently INFERS which model failed, by
//     matching each refund to the generation it probably reverses — same
//     person, same amount, within thirty minutes. That recovers 91%. It is
//     honest, and it is still a deduction.
//   · Model Speed (Tier 2.3) has nothing at all. No table anywhere holds a
//     duration, so a speed screen built today would render empty and stay
//     empty until enough time passed.
//
// WHERE IT HOOKS IN, and why there. Every charge in the platform goes through
// chargeCredits() and every refund through refundCredits(), both in credits.js.
// Recording from those two functions covers all fifteen generation routes at
// once. The alternative — instrumenting each route — is exactly how the
// 124-stuck-charge bug happened: eight of ten call sites forgot to pass
// modelId, silently, for weeks.
//
// NOTHING HERE MAY THROW. A telemetry failure must never fail a customer's
// generation or block their refund. Every function swallows its own errors and
// logs with a tag; the worst case is a missing row, not a broken request.

import { pool } from './db.js';

/**
 * Pull "Nano Banana Pro" out of "image: Nano Banana Pro".
 *
 * ── WHY `node` IS HERE ─────────────────────────────────────────────────────
 * The Node canvas writes its ledger notes as `node: flux-dev` and
 * `node video: Seedance 2.5`. The original pattern anchored on image|video|
 * audio at the START of the string, so both fell straight through to null —
 * meaning EVERY generation made from the canvas was invisible to the
 * Reliability screen and carried no timing at all on the Speed screen.
 *
 * Nothing failed. The rows were written, the column was simply empty, and a
 * screen that silently omits a whole surface reads exactly like one where
 * that surface has no problems. Found while fixing the same class of bug in
 * pending_video_charges — it is the third column this month that was doing
 * precisely what it was told and telling nobody anything.
 *
 * Canvas and direct generations deliberately fold into the SAME label: it is
 * the same model on the same provider, and splitting them would halve both
 * samples to record where the user happened to click.
 */
export function labelFrom(note) {
  const m = String(note || '')
    .match(/^\s*(?:node(?:\s+(?:image|video|audio))?|image|video|audio)\s*:\s*(.+?)\s*$/i);
  return m ? m[1].slice(0, 160) : null;
}

/** Open an attempt. Returns its id, or null if recording failed. */
export async function recordAttempt({ userId, kind, note, provider, credits }, client = pool) {
  try {
    const { rows } = await client.query(
      `INSERT INTO generation_events (user_id, kind, model_label, provider, credits, outcome)
            VALUES ($1,$2,$3,$4,$5,'pending')
         RETURNING id`,
      [userId, (kind || null), labelFrom(note), provider || null, credits ?? null]);
    return rows[0]?.id ?? null;
  } catch (e) {
    console.error('[gen-events] could not open an attempt:', e.message);
    return null;
  }
}

/**
 * Close an attempt.
 *
 * `eventId` is preferred. Without one, the most recent still-open attempt for
 * that person is closed instead — the window here is seconds, not the thirty
 * minutes the Reliability inference has to allow, because this runs inside the
 * same request. It means a route that never learned to pass an id still
 * produces correct data, which is the whole lesson of the stuck-charge bug.
 */
export async function settleAttempt({ eventId, userId, outcome, reason = null }, client = pool) {
  if (!eventId && !userId) return;
  try {
    await client.query(
      eventId
        ? `UPDATE generation_events
              SET outcome = $2, failure_reason = $3, settled_at = NOW(),
                  duration_ms = GREATEST(0, EXTRACT(EPOCH FROM (NOW() - created_at)) * 1000)::int
            WHERE id = $1 AND outcome = 'pending'`
        : `UPDATE generation_events
              SET outcome = $2, failure_reason = $3, settled_at = NOW(),
                  duration_ms = GREATEST(0, EXTRACT(EPOCH FROM (NOW() - created_at)) * 1000)::int
            WHERE id = (SELECT id FROM generation_events
                         WHERE user_id = $1 AND outcome = 'pending'
                         ORDER BY created_at DESC LIMIT 1)`,
      [eventId || userId, outcome, reason ? String(reason).slice(0, 500) : null]);
  } catch (e) {
    console.error('[gen-events] could not close an attempt:', e.message);
  }
}

/**
 * Attempts left open past a cutoff.
 *
 * A generation whose browser tab was closed never settles — the same root
 * cause as the 124 stuck charges. Reported rather than deleted, and NOT
 * counted as a failure: "we never found out" is its own answer, and folding it
 * into either column would be a guess.
 */
export async function sweepStale(hours = 6, client = pool) {
  try {
    const { rowCount } = await client.query(
      `UPDATE generation_events
          SET outcome = 'unknown', settled_at = NOW()
        WHERE outcome = 'pending' AND created_at < NOW() - ($1 || ' hours')::INTERVAL`,
      [hours]);
    if (rowCount) console.log(`[gen-events] ${rowCount} attempt(s) never reported back — marked unknown`);
    return rowCount;
  } catch (e) {
    console.error('[gen-events] stale sweep failed:', e.message);
    return 0;
  }
}
