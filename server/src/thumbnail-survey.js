// ─── thumbnail-survey.js ─────────────────────────────────────────────────────
// The DRY RUN. Counts what a thumbnail backfill would do, and does nothing.
//
// ── WHY THIS EXISTS BEFORE THE BACKFILL ────────────────────────────────────
// The owner's condition for touching 601 customers' history was that no data
// changes and nothing breaks. The honest answer was that I could guarantee the
// design and not untested code — so the first thing that ships is the thing
// that CANNOT change anything, and its output is a number he reads himself.
//
// This module has no write path. There is no code here that stores, updates or
// deletes. That is the property, not a promise.
//
// ── AND WHY IT IS SCOPED TO ONE ACCOUNT ────────────────────────────────────
// His idea, and a good one: run it for a single account first — his partner's
// — look at the result, and only then discuss the other 600. Every function
// here takes a user, never "all users". There is no way to invoke it broadly
// because the broad version does not exist yet.
//
// ── SIZES COME FROM HEAD, NOT GET ──────────────────────────────────────────
// Asking Spaces for `content-length` costs a few hundred bytes per file. A
// survey that DOWNLOADED every image to measure it would move gigabytes to
// produce a number, which would be a strange way to investigate a bandwidth
// problem.

/** Below this a thumbnail saves less than it costs to store and serve. */
export const WORTH_IT_BYTES = 60 * 1024;

/** What a 320px-wide JPEG of a typical generation weighs. Used only for the
 *  "what you would save" estimate, and labelled as an estimate wherever it is
 *  reported — nobody should mistake it for a measurement. */
export const ESTIMATED_THUMB_BYTES = 8 * 1024;

/** How many HEAD requests are in flight at once. Enough to be quick, small
 *  enough that a survey cannot look like a denial-of-service to our own
 *  bucket. */
const CONCURRENCY = 8;

/**
 * Is this row one a thumbnail would help?
 *
 * Deliberately strict. Anything unusual is skipped rather than guessed at,
 * because the cost of skipping is "stays as fast as today" and the cost of
 * guessing wrong is a broken picture in somebody's history.
 */
export function isEligible(row) {
  const d = row?.data || row || {};
  if (d.type !== 'image') return false;              // videos are handled by the viewport gate
  if (d.status && d.status !== 'completed') return false;
  if (typeof d.result_url !== 'string' || !d.result_url) return false;
  if (!/^https?:\/\//i.test(d.result_url)) return false;
  if (d.thumb_url) return false;                     // already done — never redo
  return true;
}

/** Run `fn` over `items`, `limit` at a time. Order of results matches input. */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next; next += 1;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Ask the bucket how big a file is, without downloading it.
 * Returns null when the answer cannot be had — a missing file, an expired
 * provider url, a network refusal. Null is reported as "unreadable", never
 * counted as zero, because a zero would quietly shrink the total and make the
 * job look smaller than it is.
 */
export async function headSize(url, { fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetchImpl(url, { method: 'HEAD', signal: ac.signal });
    if (!r.ok) return null;
    const n = Number(r.headers.get('content-length'));
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const mb = (bytes) => Math.round((bytes / 1048576) * 10) / 10;

/**
 * What a backfill WOULD do for one account. Changes nothing.
 *
 * @param rows  the account's GenerationHistory rows, already fetched
 * @returns a plain report, safe to show the owner verbatim
 */
export async function surveyRows(rows, { fetchImpl = fetch } = {}) {
  const all = Array.isArray(rows) ? rows : [];
  const images = all.filter((r) => (r?.data || r || {}).type === 'image');
  const eligible = all.filter(isEligible);
  const already = all.filter((r) => (r?.data || r || {}).thumb_url).length;

  const sizes = await mapLimit(eligible, CONCURRENCY, (r) =>
    headSize((r.data || r).result_url, { fetchImpl }));

  let readable = 0; let unreadable = 0; let totalBytes = 0; let worthIt = 0; let largest = 0;
  for (const s of sizes) {
    if (s === null) { unreadable += 1; continue; }
    readable += 1;
    totalBytes += s;
    largest = Math.max(largest, s);
    if (s >= WORTH_IT_BYTES) worthIt += 1;
  }

  const afterBytes = worthIt * ESTIMATED_THUMB_BYTES;
  return {
    dryRun: true,
    wrote: 'nothing',
    rowsSeen: all.length,
    images: images.length,
    alreadyHaveThumbnail: already,
    wouldProcess: worthIt,
    tooSmallToBother: readable - worthIt,
    // Named honestly. These are files whose size could not be read — an
    // expired provider url is the likeliest cause — and they are NOT part of
    // the totals. Reporting them as zero-byte would make the job look smaller
    // than it is, which is the sort of quiet wrongness that gets believed.
    unreadable,
    currentMB: mb(totalBytes),
    largestFileMB: mb(largest),
    estimatedAfterMB: mb(afterBytes),
    estimatedSavedMB: mb(Math.max(0, totalBytes - afterBytes)),
    note: 'Sizes are measured. The "after" figures assume ~8 KB per thumbnail and are an estimate.',
  };
}

/** The SQL a survey needs. Read-only by construction — one SELECT, no writes
 *  anywhere in this module. */
export const SURVEY_SQL = `
  SELECT id, data
    FROM entities
   WHERE user_id = $1
     AND name = 'GenerationHistory'
   ORDER BY created_date DESC
`;
