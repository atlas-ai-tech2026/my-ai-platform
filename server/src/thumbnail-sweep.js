// ─── thumbnail-sweep.js ──────────────────────────────────────────────────────
// GIVE EVERY OLD PICTURE A SMALL VERSION, ACROSS EVERY ACCOUNT, UNATTENDED.
//
// ── WHAT WAS MISSING ───────────────────────────────────────────────────────
// New pictures already get a thumbnail as they are saved (`persistWithThumb`,
// index.js). Everything made before that shipped has none, and the only tool
// for those is a control-panel button that takes an EMAIL:
//
//     if (!email) return res.status(400)… 'this runs for one account'
//
// So clearing the backlog meant a person typing one customer address after
// another, for as long as there are customers. It never got done, which means
// the history grid stays slow for exactly the people with the most pictures —
// the heaviest users, the ones most worth keeping.
//
// This is that same work with nobody pressing anything.
//
// ── THE PART THAT IS EASY TO GET WRONG ─────────────────────────────────────
// The sweep takes the NEWEST rows first, so every account improves at the page
// it actually looks at. But "newest first" plus "a row that can never succeed"
// is a deadlock: a picture whose original link is dead would be chosen first,
// fail, and be chosen first again on the very next pass, forever, while
// nothing behind it was ever reached.
//
// So a failure is written down — `thumb_failed_at`, the same idea as the media
// rescue's `rescue_gone_at` — and rows that failed recently are skipped. Not
// permanently: a network blip must not blacklist a perfectly good picture, so
// they come back after RETRY_AFTER_DAYS. A dead row therefore costs one
// attempt a week instead of blocking the entire queue.
//
// ── DELETED PICTURES ARE SKIPPED ───────────────────────────────────────────
// The one-account button does NOT skip them, and deleted-stays-hidden.test.js
// names that exemption as "harmless either way; a thumbnail for a deleted row
// costs one small file". That is true of a button a person presses a few times.
//
// It is not true here. Unattended, across every account, for ever, this would
// systematically fetch and re-upload every picture every customer has ever
// deleted — paying bandwidth and storage on work nobody will ever look at. The
// file itself is still protected: the rescue and the backup both deliberately
// INCLUDE deleted rows, because a picture is recoverable for 30 days. What is
// skipped is only the optimisation, and if the customer restores it the row
// simply comes back into this queue.
//
// ── WHAT IT WILL NOT DO ────────────────────────────────────────────────────
// It does not resize anything itself. `backfillRows` already does that and is
// tested; a second copy of the resizing rules would drift from the first, and
// the two would disagree about a customer's picture. This module is only the
// part the button never had: WHICH rows, HOW MANY at a time, and WHEN TO STOP.

/**
 * Production runs two instances. Both would otherwise pick the same newest
 * rows, download the same originals and upload the same thumbnails — paying
 * twice for one result. Advisory locks share ONE namespace across the whole
 * database, so this number must not collide with the backup's 8_432_119.
 */
export const SWEEP_LOCK_ID = 8_432_121;

/** Small enough to be invisible on a 1-vCPU box that is also serving people. */
export const BATCH = 25;

/** ~300 an hour. A 24,000 backlog clears in about three days, unnoticed. */
export const EVERY_MS = 5 * 60 * 1000;

/** A failure is a delay, not a verdict. */
export const RETRY_AFTER_DAYS = 7;

/**
 * The rows to try next.
 *
 * Every condition here MUST match `isEligible` in thumbnail-survey.js, because
 * `backfillRows` applies that filter again in JavaScript. Anything this query
 * returns that `isEligible` then rejects is a row that silently occupies a slot
 * in every batch for ever — the same deadlock as a dead link, arriving by a
 * quieter route.
 *
 * $1 = how many, $2 = the retry cutoff, as epoch seconds.
 */
export const NEXT_BATCH_SQL = `
  SELECT id, user_id, data
    FROM entities
   WHERE name = 'GenerationHistory'
     AND data->>'type' = 'image'
     AND COALESCE(data->>'status', 'completed') = 'completed'
     AND COALESCE(data->>'thumb_url', '') = ''
     AND COALESCE(data->>'result_url', '') <> ''
     AND data->>'result_url' ~* '^https?://'
     AND data->>'rescue_gone_at' IS NULL
     AND deleted_at IS NULL
     AND COALESCE(data->'thumb_failed_at', 'null'::jsonb) < to_jsonb($2::bigint)
   ORDER BY created_date DESC
   LIMIT $1
`;

/**
 * How many are still waiting. Shown in the control panel and in the log line.
 *
 * Deliberately NOT filtered by thumb_failed_at: a row that keeps failing is
 * still a row without a thumbnail, and hiding it here would let the number
 * reach zero while the work was not done.
 */
export const REMAINING_SQL = `
  SELECT count(*)::int AS remaining
    FROM entities
   WHERE name = 'GenerationHistory'
     AND data->>'type' = 'image'
     AND COALESCE(data->>'status', 'completed') = 'completed'
     AND COALESCE(data->>'thumb_url', '') = ''
     AND COALESCE(data->>'result_url', '') <> ''
     AND data->>'result_url' ~* '^https?://'
     AND data->>'rescue_gone_at' IS NULL
     AND deleted_at IS NULL
`;

/**
 * Remember that this row could not be done, so the queue head can move on.
 * One key, one row. `result_url` is unreachable from here by construction.
 */
export const MARK_FAILED_SQL = `
  UPDATE entities
     SET data = jsonb_set(data, '{thumb_failed_at}', to_jsonb(EXTRACT(EPOCH FROM NOW())::bigint), true)
   WHERE id = $1
     AND name = 'GenerationHistory'
`;

/** The cutoff `NEXT_BATCH_SQL` wants: rows failed before this may be retried. */
export function retryCutoff(now) {
  return Math.floor(now / 1000) - RETRY_AFTER_DAYS * 86_400;
}

/**
 * One pass: take a batch, hand it to the backfill, write down what failed,
 * and count what is left.
 *
 * @param deps.rows       () => Promise<rows>   the batch
 * @param deps.backfill   (rows, { onDone }) => Promise<report>  — normally
 *                        backfillRows, which must call onDone(id) per success.
 *                        Knowing WHICH rows succeeded is what stops a row that
 *                        just got its thumbnail from also being marked failed.
 * @param deps.markFailed (id) => Promise<void>  so the head of the queue moves
 * @param deps.remaining  () => Promise<number>  how many still have none
 */
export async function sweepOnce({
  rows, backfill, markFailed, remaining, log = console,
} = {}) {
  const batch = await rows();
  if (!batch?.length) {
    // Nothing to do is the goal, not an event. Reported as finished so the
    // caller can fall silent instead of announcing itself every five minutes.
    return { attempted: 0, done: 0, failed: 0, savedMB: 0, problems: [], remaining: 0, finished: true };
  }

  const succeeded = new Set();
  const report = await backfill(batch, { onDone: (id) => succeeded.add(id) });

  // A row that came back in the batch but was not attempted was rejected by
  // isEligible — the mismatch described above. It would return in every batch
  // for ever, so it is marked exactly like a failure and the mismatch is said
  // out loud rather than left to be inferred from a stalled counter.
  const attempted = Number(report?.attempted) || 0;
  if (attempted < batch.length) {
    log.warn?.(`[thumb-sweep] ${batch.length - attempted} row(s) the query offered were `
      + 'refused by isEligible — the two filters disagree.');
  }

  // Mark the named failures. `problems` is capped at 20 by backfillRows, so on
  // a batch of 25 this is bounded and cheap.
  const bad = Array.isArray(report?.problems) ? report.problems : [];
  for (const p of bad) {
    try { await markFailed(p.id); } catch { /* it will be tried again; not fatal */ }
  }

  // Then the strays: offered by the query, neither finished nor named as a
  // problem. Nothing tried them, so nothing will ever try them — mark them or
  // the queue never advances past them.
  //
  // A row that SUCCEEDED must never land here. It already has its thumbnail,
  // and stamping a failure on it would be a plain lie in customer data.
  const named = new Set(bad.map((p) => p.id));
  for (const r of batch) {
    if (succeeded.has(r.id) || named.has(r.id)) continue;
    try { await markFailed(r.id); } catch { /* next pass */ }
  }

  // COUNT LAST, AND NEVER GUESS. A failed count must read as "unknown", never
  // as zero: zero is the sentence that ends the job.
  let left = null;
  try {
    const n = await remaining();
    left = Number.isFinite(n) ? n : null;
  } catch (e) {
    log.error?.(`[thumb-sweep] could not count what is left: ${e?.message || e}`);
  }

  return {
    attempted,
    done: Number(report?.done) || 0,
    failed: Number(report?.failed) || 0,
    savedMB: Number(report?.savedMB) || 0,
    problems: bad.slice(0, 5),
    remaining: left,
    finished: left === 0,
  };
}

/** One line for the log. Says "unknown" when it is unknown. */
export function sweepLine(r) {
  if (r.finished && !r.done && !r.failed) return '[thumb-sweep] nothing left to do.';
  const left = r.remaining === null ? 'remaining unknown' : `${r.remaining} left`;
  const saved = r.savedMB ? `, ${r.savedMB} MB saved` : '';
  return `[thumb-sweep] ${r.done} done, ${r.failed} failed${saved} — ${left}.`;
}
