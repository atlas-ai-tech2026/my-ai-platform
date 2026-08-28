// ─── thumbnail-backfill.js ───────────────────────────────────────────────────
// Makes a small copy of an image and records where it went. Nothing else.
//
// ── WHAT THE SURVEY FOUND, AND WHY THIS EXISTS ─────────────────────────────
// One account: 349 images, 2,500.9 MB, largest single file 23.9 MB, and NOT
// ONE of them under 60 KB. They are drawn in a grid at 160×96 pixels. The
// average image is about 7.5 MB to paint a tile the size of a postage stamp.
//
// ── THE FOUR PROMISES, AND HOW EACH IS KEPT ────────────────────────────────
// The owner's condition was that nothing happens to customer data. These are
// mechanisms, not intentions:
//
//   1. THE ORIGINAL IS NEVER TOUCHED. It is fetched over HTTP and read. There
//      is no PutObject, no DeleteObject and no key derived from it — the
//      thumbnail gets its own fresh uuid, so it cannot collide with or
//      overwrite anything that exists.
//
//   2. `result_url` CANNOT BE CHANGED. The write is `jsonb_set` on the single
//      path {thumb_url}. Not a merge, not a spread. There is no statement in
//      this module capable of reaching any other key.
//
//   3. `updated_date` IS LEFT ALONE. Deliberate: bumping it would make every
//      row in a customer's history look modified today, which would reorder
//      and re-sort things that must not move. A backfill should be invisible.
//
//   4. IT IS RESUMABLE AND IDEMPOTENT. A row that already has a thumb_url is
//      skipped, so re-running costs nothing and repeats nothing. A crash
//      halfway leaves a consistent half — some rows done, the rest exactly as
//      they were.
//
// And the failure mode is chosen too: a row that cannot be read, decoded or
// uploaded is COUNTED and SKIPPED, never written and never fatal. The grid
// falls back to the original, so the worst outcome for that customer is the
// speed they have today.

import { Jimp } from 'jimp';
import { isEligible } from './thumbnail-survey.js';

/** Twice the 160px the grid draws, so it stays sharp on a retina screen. */
export const THUMB_WIDTH = 320;

/** Enough to be quick; low enough that three 24 MB originals in flight cannot
 *  starve a 1 GB container. */
const CONCURRENCY = 3;

/** Refuse anything absurd before decoding it — a malformed or hostile file
 *  should cost a rejected request, not a heap. */
export const MAX_SOURCE_BYTES = 60 * 1024 * 1024;

/**
 * The ONLY write this module performs.
 *
 * `jsonb_set` on one path. `result_url` is unreachable from here, and so is
 * every other key. `updated_date` is deliberately absent from the SET clause.
 */
export const SET_THUMB_SQL = `
  UPDATE entities
     SET data = jsonb_set(data, '{thumb_url}', $1::jsonb, true)
   WHERE id = $2
     AND user_id = $3
     AND name = 'GenerationHistory'
`;

/** Small JPEG from any image buffer. Throws on anything it cannot decode —
 *  the caller counts it and moves on. */
export async function makeThumbnail(buf, { width = THUMB_WIDTH } = {}) {
  if (!buf?.length) throw new Error('empty source');
  if (buf.length > MAX_SOURCE_BYTES) throw new Error(`source too large (${buf.length} bytes)`);
  const img = await Jimp.read(buf);
  // Never UPSCALE. A source narrower than the thumbnail is already small;
  // enlarging it would waste bytes to make it blurrier.
  const target = Math.min(width, img.bitmap.width || width);
  const small = img.resize({ w: target });
  return small.getBuffer('image/jpeg', { quality: 72 });
}

/** Run `fn` over `items`, `limit` at a time. */
async function mapLimit(items, limit, fn) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next; next += 1;
      if (i >= items.length) return;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}

/**
 * Give one account's images thumbnails.
 *
 * Every dependency is injected so the whole thing is testable without a
 * database, a bucket, or a network.
 *
 * @param rows     the account's GenerationHistory rows
 * @param deps.fetchImpl  fetch, for reading the original
 * @param deps.persist    (buf, contentType, kind) => Promise<publicUrl>
 * @param deps.setThumb   (id, url) => Promise<void>  — the guarded UPDATE
 * @param deps.limit      stop after this many, so a first run can be small
 */
export async function backfillRows(rows, {
  fetchImpl = fetch, persist, setThumb, limit = Infinity, onProgress = null,
} = {}) {
  const eligible = (Array.isArray(rows) ? rows : []).filter(isEligible).slice(0, limit);

  let done = 0; let failed = 0; let sourceBytes = 0; let thumbBytes = 0;
  const problems = [];

  await mapLimit(eligible, CONCURRENCY, async (row) => {
    const d = row.data || row;
    try {
      const resp = await fetchImpl(d.result_url);
      if (!resp.ok) throw new Error(`source responded ${resp.status}`);
      const src = Buffer.from(await resp.arrayBuffer());
      const thumb = await makeThumbnail(src);
      const url = await persist(thumb, 'image/jpeg', 'thumb');
      await setThumb(row.id, url);

      done += 1; sourceBytes += src.length; thumbBytes += thumb.length;
      onProgress?.({ id: row.id, from: src.length, to: thumb.length });
    } catch (e) {
      // Counted and named, never fatal and never written. The grid falls back
      // to the original, so this row simply stays as fast as it is today.
      failed += 1;
      if (problems.length < 20) problems.push({ id: row.id, why: e?.message || String(e) });
    }
  });

  const mb = (b) => Math.round((b / 1048576) * 10) / 10;
  return {
    attempted: eligible.length,
    done,
    failed,
    // Named so nobody reads it as "everything is fine". These rows kept their
    // original and lost nothing; they just did not get faster.
    problems,
    originalsMB: mb(sourceBytes),
    thumbnailsMB: mb(thumbBytes),
    savedMB: mb(Math.max(0, sourceBytes - thumbBytes)),
  };
}
