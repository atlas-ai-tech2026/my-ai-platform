// ─── thumbnail-scale.js ──────────────────────────────────────────────────────
// How big is this job across ALL 601 accounts, before anything is switched on?
//
// ── WHY THIS COMES BEFORE THE BACKGROUND JOB ───────────────────────────────
// Amr's question was the right one: "do you need to press it many times?" His
// partner's account alone needs seven presses. Six hundred accounts would be
// thousands. So a background job is clearly correct — but switching one on
// across every customer's history without knowing HOW MANY PICTURES and HOW
// MUCH DATA would be exactly the habit this project keeps having to unlearn.
//
// So: count first. Count exactly, sample for size, and label the estimate as
// an estimate. Then decide.
//
// ── THIS MODULE CANNOT WRITE ───────────────────────────────────────────────
// Same property as thumbnail-survey.js, for the same reason: there is no
// store, update or delete anywhere in it. Not a promise — a fact you can check
// by reading it.
//
// ── AND WHY THE DATA COST MATTERS ──────────────────────────────────────────
// Each picture is downloaded and re-uploaded once. At ~7.6 MB apiece — the
// real figure measured on 20 of Mohaned's — a few thousand of them is real
// bandwidth against a real allowance. A job that races through and lands a
// bill would be a poor trade for a faster grid, which is why the plan is to
// run it SLOWLY on purpose.

/** Exact counts. Cheap: one aggregate, no file access. */
import { BATCH as SWEEP_BATCH, EVERY_MS as SWEEP_EVERY_MS } from './thumbnail-sweep.js';

/** The sweep's real pace, derived rather than typed: 25 every five minutes. */
export const SWEEP_PER_MINUTE = SWEEP_BATCH / (SWEEP_EVERY_MS / 60_000);

export const SCALE_SQL = `
  SELECT
    count(*) FILTER (WHERE COALESCE(data->>'thumb_url','') = '')          AS need,
    count(*) FILTER (WHERE COALESCE(data->>'thumb_url','') <> '')         AS have,
    -- What the background sweep will ACTUALLY take. "need" is the honest
    -- total, but it includes rows the sweep skips on purpose: pictures the
    -- customer deleted, and files the rescue has already declared gone.
    -- Without this the number drains and then stops above zero for ever, and
    -- a progress figure that can never finish reads as a broken job.
    count(*) FILTER (WHERE COALESCE(data->>'thumb_url','') = ''
                       AND data->>'rescue_gone_at' IS NULL
                       AND deleted_at IS NULL)                            AS queued,
    count(DISTINCT user_id) FILTER (WHERE COALESCE(data->>'thumb_url','') = '') AS accounts_waiting,
    count(DISTINCT user_id)                                              AS accounts_total
  FROM entities
  WHERE name = 'GenerationHistory'
    AND data->>'type' = 'image'
    AND COALESCE(data->>'result_url','') <> ''
    AND data->>'result_url' ~* '^https?://'
`;

/** A random handful of the ones still needing a thumbnail, to measure sizes.
 *  Random rather than newest: the newest are not typical of eight months of
 *  history, and the estimate is for all of it.
 *
 *  Sampled from the SAME population the estimate is about — the rows the sweep
 *  will actually take. Measuring deleted or missing files and then multiplying
 *  by the queued count would be an average of one thing applied to another. */
export const SAMPLE_SQL = `
  SELECT data->>'result_url' AS url
  FROM entities
  WHERE name = 'GenerationHistory'
    AND data->>'type' = 'image'
    AND COALESCE(data->>'thumb_url','') = ''
    AND COALESCE(data->>'result_url','') <> ''
    AND data->>'result_url' ~* '^https?://'
    AND data->>'rescue_gone_at' IS NULL
    AND deleted_at IS NULL
  ORDER BY random()
  LIMIT $1
`;

const MB = 1048576;
const round = (n, p = 1) => Math.round(n * 10 ** p) / 10 ** p;

/**
 * Turn the counts and a size sample into the two numbers worth deciding on:
 * how long it would take, and how much data it would move.
 *
 * @param counts  {need, have, accounts_waiting, accounts_total}
 * @param sizes   bytes[] from HEAD requests — may be short, may be empty
 * @param opts.perPictureSeconds  measured: 20 pictures in 24s on production
 * @param opts.perMinute          the sweep's real pace — BATCH every EVERY_MS.
 *                                Taken from thumbnail-sweep.js rather than
 *                                typed here, so an estimate on the screen
 *                                cannot quietly disagree with the job.
 */
export function summariseScale(counts, sizes, { perPictureSeconds = 1.2, perMinute = SWEEP_PER_MINUTE } = {}) {
  const need = Number(counts?.need) || 0;
  const have = Number(counts?.have) || 0;
  // Falls back to `need` so an older caller that does not select `queued`
  // still gets a sensible number rather than zero.
  const queued = Number.isFinite(Number(counts?.queued)) ? Number(counts.queued) : need;

  const measured = (sizes || []).filter((n) => Number.isFinite(n) && n > 0);
  // NULL, never 0, when nothing could be measured. A zero here would read as
  // "this costs nothing", which is the most expensive possible wrong answer.
  const avgBytes = measured.length ? measured.reduce((a, b) => a + b, 0) / measured.length : null;

  return {
    need,
    have,
    done_pct: need + have ? round(((have / (need + have)) * 100)) : null,
    accounts_waiting: Number(counts?.accounts_waiting) || 0,
    accounts_total: Number(counts?.accounts_total) || 0,

    // What the sweep will actually work through, and what it will skip.
    queued,
    skipped: Math.max(0, need - queued),

    // Kept because Amr's original question was "how many times must I press
    // this?" — and the answer is now zero. It stays on the screen as ZERO
    // rather than disappearing, because "the button is gone" and "the work is
    // done without the button" look identical if the number simply vanishes.
    presses_by_hand: 0,

    sampled: measured.length,
    avg_mb: avgBytes === null ? null : round(avgBytes / MB, 2),
    // Downloaded once and re-uploaded once. Stated as an ESTIMATE everywhere
    // because it is one — an average of a sample times a count.
    estimated_gb_moved: avgBytes === null ? null : round((queued * avgBytes * 2) / (1024 * MB), 1),
    estimated_hours: queued ? round((queued * perPictureSeconds) / 3600, 1) : 0,
    // At a deliberately slow pace, so the job never looks like an outage to
    // our own bucket and the bandwidth is spread across days.
    // How long the sweep needs, at its real pace, for the rows it will take.
    days_at_slow_pace: queued ? round(queued / (perMinute * 60 * 24), 1) : 0,

    // The sentence the panel shows. Written here so the number and the words
    // about the number can never disagree.
    verdict: verdictFor(need, queued, avgBytes, perMinute),
  };
}

function verdictFor(need, queued, avgBytes, perMinute) {
  if (!need) return 'Every picture already has a small version. Nothing to do.';
  if (!queued) {
    // Everything left is deleted or gone. The number will never reach zero,
    // and saying so is the difference between a finished job and a stuck one.
    return `${need.toLocaleString('en-US')} pictures have no small version, but every one of them is `
      + 'either deleted or has a missing original. There is nothing left for the sweep to do.';
  }
  const cost = avgBytes === null
    ? 'The data cost could not be measured — treat any estimate below as unknown, not as zero.'
    : `About ${round((queued * avgBytes * 2) / (1024 * MB), 1)} GB will be moved, downloaded and re-uploaded once each.`;
  const days = round(queued / (perMinute * 60 * 24), 1);
  const skipped = need - queued;
  const aside = skipped > 0
    ? ` A further ${skipped.toLocaleString('en-US')} are deleted or gone and will be skipped.`
    : '';
  return `${queued.toLocaleString('en-US')} pictures still load at full size. The background sweep is `
    + `working through them on its own — about ${days} days at its current pace.${aside} ${cost}`;
}
