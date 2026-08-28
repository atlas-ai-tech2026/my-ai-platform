// ─── thumb-on-save.js ────────────────────────────────────────────────────────
// Give a picture its small version at the moment it is saved.
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────────
// The grid already READS `thumb_url`. The backfill already WRITES it. Nothing
// created one at generation time — so every picture made after a backfill
// arrived full-size again, and the grid got slower every day.
//
// I told Amr on the control-panel card that "new generations already get one
// automatically". They did not. That sentence was on a production screen for
// several hours and this module is what makes it true.
//
// ── THE CONTRACT, WHICH IS THE WHOLE DESIGN ────────────────────────────────
// THIS CAN NEVER FAIL A GENERATION. It runs between the model finishing and
// the customer receiving their image — the most expensive place in the app to
// throw. A missing thumbnail costs one slow grid cell. A thrown exception here
// would cost the customer the picture they just paid for.
//
// So every failure path returns `thumbUrl: null` and the original url
// unchanged. There is no error to handle upstream, by construction.
//
// ── AND IT MUST NOT MAKE THE WAIT NOTICEABLY LONGER ────────────────────────
// One download, two uploads — the buffer is already in memory from re-hosting,
// so the extra work is a resize and a small PUT. Bounded by a budget: if the
// resize is slow, the customer gets their image and no thumbnail, which is
// exactly the situation we are already in today.

/** Only pictures. Jimp cannot read an mp4, and asking it to would burn the
 *  budget discovering that on every single video. */
export function shouldThumbnail(contentType, kind) {
  if (kind && kind !== 'output' && kind !== 'image') return false;
  const t = String(contentType || '').toLowerCase();
  if (!t.startsWith('image/')) return false;
  // Animated formats resize to a single frame at best and are usually small
  // already. Not worth the budget or the surprise.
  return !t.includes('gif') && !t.includes('svg');
}

/** How long the thumbnail may take before it is abandoned. Generous against a
 *  ~300ms resize, and small against a 30–90 second generation. */
export const THUMB_BUDGET_MS = 8000;

/**
 * Store an image and, if it can be done cheaply, its small version too.
 *
 * @param deps.download   (url) => {buf, contentType}
 * @param deps.store      (buf, contentType, kind) => url
 * @param deps.thumbnail  (buf) => Buffer            the resizer
 * @param deps.budgetMs
 * @returns {{url, thumbUrl}}  thumbUrl is null whenever anything at all went
 *          wrong — there is no third state and no throw.
 */
export async function saveWithThumbnail(sourceUrl, kind, deps) {
  const { download, store, thumbnail, budgetMs = THUMB_BUDGET_MS, onNote } = deps;

  // The original is NOT in the try/catch below. If storing the picture fails
  // that is a real failure and must propagate — the caller already knows how
  // to fall back to the provider's own url. Only the thumbnail is optional.
  const { buf, contentType } = await download(sourceUrl);
  const url = await store(buf, contentType, kind);

  if (!shouldThumbnail(contentType, kind)) return { url, thumbUrl: null };

  try {
    const small = await withBudget(thumbnail(buf), budgetMs, 'resize');
    // A "thumbnail" that is not smaller than its source is not a thumbnail.
    // Flat images encode so well that this genuinely happens, and storing one
    // would cost a bucket object to make the grid no faster.
    if (!small?.length || small.length >= buf.length) {
      onNote?.(`thumbnail skipped — ${small?.length || 0}B is not smaller than ${buf.length}B`);
      return { url, thumbUrl: null };
    }
    const thumbUrl = await withBudget(store(small, 'image/jpeg', 'thumb'), budgetMs, 'upload');
    return { url, thumbUrl };
  } catch (e) {
    // Counted, never raised. The customer has their image.
    onNote?.(`thumbnail skipped — ${e?.message || e}`);
    return { url, thumbUrl: null };
  }
}

/** Reject after `ms` so a hung resize cannot hold a customer's image. */
function withBudget(promise, ms, what) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} took longer than ${ms}ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
