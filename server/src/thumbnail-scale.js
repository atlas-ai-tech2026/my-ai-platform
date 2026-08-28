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
export const SCALE_SQL = `
  SELECT
    count(*) FILTER (WHERE COALESCE(data->>'thumb_url','') = '')          AS need,
    count(*) FILTER (WHERE COALESCE(data->>'thumb_url','') <> '')         AS have,
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
 *  history, and the estimate is for all of it. */
export const SAMPLE_SQL = `
  SELECT data->>'result_url' AS url
  FROM entities
  WHERE name = 'GenerationHistory'
    AND data->>'type' = 'image'
    AND COALESCE(data->>'thumb_url','') = ''
    AND COALESCE(data->>'result_url','') <> ''
    AND data->>'result_url' ~* '^https?://'
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
 * @param opts.perMinute          how many the background job would do a minute
 */
export function summariseScale(counts, sizes, { perPictureSeconds = 1.2, perMinute = 20 } = {}) {
  const need = Number(counts?.need) || 0;
  const have = Number(counts?.have) || 0;

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

    // What a human would otherwise do. This is the number that answers Amr's
    // actual question, so it is computed rather than described.
    presses_by_hand: need ? Math.ceil(need / 50) : 0,

    sampled: measured.length,
    avg_mb: avgBytes === null ? null : round(avgBytes / MB, 2),
    // Downloaded once and re-uploaded once. Stated as an ESTIMATE everywhere
    // because it is one — an average of a sample times a count.
    estimated_gb_moved: avgBytes === null ? null : round((need * avgBytes * 2) / (1024 * MB), 1),
    estimated_hours: need ? round((need * perPictureSeconds) / 3600, 1) : 0,
    // At a deliberately slow pace, so the job never looks like an outage to
    // our own bucket and the bandwidth is spread across days.
    days_at_slow_pace: need ? round(need / (perMinute * 60 * 24), 1) : 0,

    // The sentence the panel shows. Written here so the number and the words
    // about the number can never disagree.
    verdict: verdictFor(need, avgBytes),
  };
}

function verdictFor(need, avgBytes) {
  if (!need) return 'Every picture already has a small version. Nothing to do.';
  const cost = avgBytes === null
    ? 'The data cost could not be measured — treat any estimate below as unknown, not as zero.'
    : `About ${round((need * avgBytes * 2) / (1024 * MB), 1)} GB would be moved, downloaded and re-uploaded once each.`;
  return `${need.toLocaleString('en-US')} pictures still load at full size. ${cost}`;
}
