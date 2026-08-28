// ─── media-rescue.js ─────────────────────────────────────────────────────────
// Copy a customer's file out of a provider's temporary storage and into ours,
// before it expires.
//
// ── WHAT THIS IS RACING ────────────────────────────────────────────────────
// Measured on production 2026-08-28: 12,567 generations still point at a
// provider host, almost all tempfile.aiquickdraw.com. A sample of 500 found
// 47.8% already gone — roughly 6,007 files lost across 289 accounts, which is
// close to half the customer base. About 6,560 are still alive.
//
// Nothing here recovers the 6,007. This saves what is left.
//
// ── THE ORDER OF OPERATIONS IS THE WHOLE SAFETY ARGUMENT ───────────────────
// This is the only code in the platform that rewrites `result_url` — the one
// field that decides whether a customer can see their own work. Get the order
// wrong and it destroys exactly what it was written to protect.
//
//   1. FETCH the provider file. Fails → stop, write nothing.
//   2. UPLOAD it to our bucket. Fails → stop, write nothing.
//   3. VERIFY our copy is really there and the right size. Fails → stop,
//      write nothing.
//   4. ONLY NOW write, recording the provider url in `origin_url` first so
//      the old address is never thrown away.
//
// Writing at step 2 would be the disaster: a record pointing at an upload that
// silently failed, replacing a link that still worked. Step 3 exists because
// "the upload call returned" and "the bytes are readable" are different
// claims, and this is not a place to assume the first implies the second.
//
// ── AND IT DOES NOT DELETE ─────────────────────────────────────────────────
// Not the provider copy, not ours, not ever. There is no delete in this file.
// The provider will remove theirs on their own schedule; that is the point.

/** Fields written. Nothing else in the record is reachable from here. */
export const RESCUE_SQL = `
  UPDATE entities
     SET data = jsonb_set(
                  jsonb_set(data, '{origin_url}', $1::jsonb, true),
                  '{result_url}', $2::jsonb, true)
   WHERE id = $3
     AND user_id = $4
     AND name = 'GenerationHistory'
`;

/** Anything larger than this is refused rather than pulled into memory. */
export const MAX_BYTES = 200 * 1024 * 1024;

/** Three at a time. A 24 MB video times three is survivable in a 1 GB
 *  container; ten is not. */
const CONCURRENCY = 3;

/** Is this row one the rescue should touch? */
export function needsRescue(row, { ourHosts = [] } = {}) {
  const d = row?.data || row || {};
  const url = typeof d.result_url === 'string' ? d.result_url.trim() : '';
  if (!url || !/^https?:\/\//i.test(url)) return false;
  let host = '';
  try { host = new URL(url).host.toLowerCase(); } catch { return false; }
  // Already ours — nothing to do, and re-copying would be pure waste.
  if (ourHosts.some((h) => host === h)) return false;
  return true;
}

async function mapLimit(items, limit, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next; next += 1;
      if (i >= items.length) return;
      await fn(items[i]);
    }
  }));
}

/**
 * Rescue what can still be rescued.
 *
 * Every dependency injected, so the whole thing is testable without a network,
 * a bucket or a database.
 *
 * @param deps.fetchImpl  fetch, for reading the provider file
 * @param deps.persist    (buf, contentType, kind) => Promise<publicUrl>
 * @param deps.verify     (url) => Promise<number|null>  bytes readable at url
 * @param deps.setUrls    (id, originUrl, newUrl, userId) => Promise<void>
 * @param deps.limit      stop after this many, so a first run can be small
 */
export async function rescueRows(rows, {
  fetchImpl = fetch, persist, verify, setUrls, ourHosts = [],
  limit = Infinity, onProgress = null,
} = {}) {
  const todo = (Array.isArray(rows) ? rows : [])
    .filter((r) => needsRescue(r, { ourHosts }))
    .slice(0, limit);

  let rescued = 0; let alreadyGone = 0; let failed = 0; let bytes = 0;
  const problems = [];
  const note = (id, why) => { if (problems.length < 25) problems.push({ id, why }); };

  await mapLimit(todo, CONCURRENCY, async (row) => {
    const d = row.data || row;
    const from = d.result_url;
    try {
      // 1 — fetch
      const resp = await fetchImpl(from);
      if (resp.status === 404 || resp.status === 403 || resp.status === 410) {
        // The thing this was racing. Not a failure of the rescue — it simply
        // arrived too late, and that is counted separately so the report can
        // say how much was saved versus how much was already lost.
        alreadyGone += 1;
        return;
      }
      if (!resp.ok) throw new Error(`provider responded ${resp.status}`);

      const buf = Buffer.from(await resp.arrayBuffer());
      if (!buf.length) throw new Error('provider returned an empty body');
      if (buf.length > MAX_BYTES) throw new Error(`too large (${buf.length} bytes)`);

      // 2 — upload
      const kind = /\.(mp4|mov|webm|m4v)(\?|$)/i.test(from) ? 'video' : 'image';
      const contentType = resp.headers?.get?.('content-type')
        || (kind === 'video' ? 'video/mp4' : 'image/png');
      const newUrl = await persist(buf, contentType, kind);
      if (!newUrl) throw new Error('upload returned no url');

      // 3 — verify OUR copy before trusting it. "The call returned" and "the
      //     bytes are readable" are different claims.
      const storedBytes = await verify(newUrl);
      if (storedBytes === null) throw new Error('our copy could not be read back');
      if (storedBytes !== buf.length) {
        throw new Error(`our copy is ${storedBytes} bytes, expected ${buf.length}`);
      }

      // 4 — and only now, the write
      // The ROW's owner, not a scoped one: running across every account there
      // is no single user id, and passing null would make the guarded UPDATE
      // match nothing and silently rescue zero files.
      await setUrls(row.id, from, newUrl, row.user_id);
      rescued += 1;
      bytes += buf.length;
      onProgress?.({ id: row.id, from, to: newUrl, bytes: buf.length });
    } catch (e) {
      // Counted, named, and NOT written. The record keeps the provider link it
      // has, which is exactly what it had a moment ago.
      failed += 1;
      note(row.id, e?.message || String(e));
    }
  });

  const mb = (b) => Math.round((b / 1048576) * 10) / 10;
  return {
    considered: todo.length,
    rescued,
    // Named plainly. These were already lost before this ran; the rescue did
    // not lose them and could not have saved them.
    alreadyGone,
    failed,
    problems,
    movedMB: mb(bytes),
  };
}

/**
 * At-risk rows, NEWEST FIRST.
 *
 * Deliberate: the most recently stranded files are the most likely to still
 * exist, so this order saves the most per unit of work. Oldest-first would
 * spend the run discovering things that died months ago.
 */
export const RESCUE_QUEUE_SQL = `
  SELECT id, user_id, data, created_date
    FROM entities
   WHERE name = 'GenerationHistory'
     AND ($1::int IS NULL OR user_id = $1::int)
     AND COALESCE(data->>'result_url','') <> ''
     AND data->>'result_url' ~* '^https?://'
     AND split_part(split_part(data->>'result_url','://',2),'/',1) <> ALL($2::text[])
   ORDER BY created_date DESC
   LIMIT $3
`;
