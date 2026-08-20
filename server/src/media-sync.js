// ─── media-sync.js ───────────────────────────────────────────────────────────
// Copy customer images and videos from the Spaces bucket to Backblaze, so they
// survive losing DigitalOcean.
//
// ── WHAT THIS IS FOR ───────────────────────────────────────────────────────
// The daily database backup covers every generation's metadata and the URL it
// points at. It does NOT cover the file. 66.1 GiB across 11,320 objects has
// existed in exactly one place since the platform started; lose the bucket and
// every customer's history points at nothing.
//
// Versioning (enabled 2026-08-19) protects against a mistaken delete INSIDE the
// bucket. It does nothing if the bucket or the account goes. This is the other
// half.
//
// ── WHY IT DIFFS RATHER THAN REMEMBERS ─────────────────────────────────────
// Each run lists both sides and copies the difference. The obvious alternative
// — a table recording what has been copied — is faster and can drift: a row
// saying "copied" while the object is absent is a backup that exists only in a
// database. Listing 11,320 objects is ~12 pages a side and costs almost
// nothing, and it cannot lie about what is actually there.
//
// It also makes the job RESUMABLE for free. Interrupt it at 40%, and the next
// run simply finds 60% still missing. No checkpoint to corrupt.
//
// ── WHY IT IS CAPPED ───────────────────────────────────────────────────────
// The first run has 66 GiB to move. Uncapped, it would run for hours inside a
// web process that gets redeployed several times a day. Each run does a bounded
// amount and reports what is left, so progress is made in slices that survive a
// restart.
//
// ── WHY IT STOPS INSTEAD OF RETRYING ───────────────────────────────────────
// Backblaze gives 10 GB free; above that WITHOUT a payment method every upload
// fails. Retrying thousands of times against a wall would burn API calls and
// fill the log with noise that hides the one line explaining it. Consecutive
// failures stop the run and say why.

/** Everything copied lands under this prefix, so it never collides with the DB archives. */
export const MEDIA_PREFIX = 'media/';

/** A single run moves at most this much, then reports what is left. */
export const MAX_OBJECTS_PER_RUN = 400;
export const MAX_BYTES_PER_RUN = 2 * 1024 ** 3;      // 2 GiB

/** Stop a run after this many consecutive failures — something systemic is wrong. */
export const MAX_CONSECUTIVE_FAILURES = 5;

/** Skip anything larger than this rather than stalling a run on one huge file. */
export const MAX_OBJECT_BYTES = 512 * 1024 ** 2;     // 512 MiB

/** Source key → destination key. Prefixed, never rewritten, so the two can be compared. */
export const destKeyFor = (sourceKey) => `${MEDIA_PREFIX}${sourceKey}`;
export const sourceKeyFor = (destKey) =>
  destKey.startsWith(MEDIA_PREFIX) ? destKey.slice(MEDIA_PREFIX.length) : null;

/**
 * Decide what this run should copy.
 *
 * PURE — no clients, no network. The interesting decisions (what is missing,
 * what is too big, where the cap falls) are all here so they can be tested
 * exactly, instead of being buried in retry loops.
 *
 * An object counts as present only if it is there AND the same size. A
 * destination copy with a different size is a truncated upload from an
 * interrupted run, and re-copying it is the whole point.
 */
export function planSync(source = [], dest = [], {
  maxObjects = MAX_OBJECTS_PER_RUN,
  maxBytes = MAX_BYTES_PER_RUN,
  maxObjectBytes = MAX_OBJECT_BYTES,
} = {}) {
  const have = new Map();
  for (const d of dest) {
    const src = sourceKeyFor(d.key);
    if (src) have.set(src, Number(d.size) || 0);
  }

  const toCopy = [];
  const tooBig = [];
  let plannedBytes = 0;
  let missing = 0;
  let alreadyThere = 0;

  // Smallest first. A run of small files makes visible progress and gets more
  // objects protected per minute than starting with the videos.
  const ordered = [...source].sort((a, b) => (Number(a.size) || 0) - (Number(b.size) || 0));

  for (const s of ordered) {
    const size = Number(s.size) || 0;
    const at = have.get(s.key);
    if (at != null && at === size) { alreadyThere += 1; continue; }
    missing += 1;
    if (size > maxObjectBytes) { tooBig.push({ key: s.key, size }); continue; }
    if (toCopy.length >= maxObjects || plannedBytes + size > maxBytes) continue;
    toCopy.push({ key: s.key, size });
    plannedBytes += size;
  }

  return {
    toCopy,
    tooBig,
    plannedBytes,
    missing,
    alreadyThere,
    remainingAfter: missing - toCopy.length,
    sourceCount: source.length,
  };
}

/** Does this failure mean "stop", rather than "this one object went wrong"? */
export function isFatalFailure(message = '') {
  return /quota|cap exceeded|payment|billing|not authorized|unauthorized|access denied|forbidden/i
    .test(String(message));
}

/**
 * Stream one object across.
 *
 * Streamed rather than buffered: a video can be hundreds of megabytes, and
 * holding several in memory inside the web process is how a generation request
 * dies of an out-of-memory error at the worst moment. ContentLength is passed
 * through because Backblaze's S3 layer requires it and cannot chunk.
 */
export async function copyObject({ read, write, key }) {
  const got = await read(key);
  await write({
    key: destKeyFor(key),
    body: got.body,
    contentLength: got.contentLength,
    contentType: got.contentType || 'application/octet-stream',
  });
  return { key, bytes: Number(got.contentLength) || 0 };
}

/**
 * Run one slice of the sync.
 *
 * Never throws. A backup job that takes the web process down with it has made
 * things worse than the gap it was closing.
 */
export async function runSync({
  read, write, source, dest, limits = {}, copy = copyObject, log = console,
} = {}) {
  const plan = planSync(source, dest, limits);
  const started = Date.now();

  if (plan.tooBig.length) {
    log.warn?.(`[media-sync] skipping ${plan.tooBig.length} object(s) over the size limit — `
      + plan.tooBig.slice(0, 3).map((o) => o.key).join(', '));
  }
  if (!plan.toCopy.length) {
    return { ...plan, copied: 0, failed: 0, bytes: 0, ms: Date.now() - started, stopped: null };
  }

  let copied = 0;
  let failed = 0;
  let bytes = 0;
  let consecutive = 0;
  let stopped = null;

  for (const o of plan.toCopy) {
    try {
      const r = await copy({ read, write, key: o.key });
      copied += 1;
      bytes += r.bytes || o.size;
      consecutive = 0;
    } catch (e) {
      failed += 1;
      consecutive += 1;
      log.error?.(`[media-sync] ${o.key}: ${e.message}`);
      // A quota or billing refusal will refuse every subsequent object too.
      // Hammering it burns API calls and buries the one line that explains it.
      if (isFatalFailure(e.message)) {
        stopped = `stopped after a refusal that will not fix itself: ${e.message}`;
        break;
      }
      if (consecutive >= MAX_CONSECUTIVE_FAILURES) {
        stopped = `stopped after ${consecutive} failures in a row — something systemic is wrong`;
        break;
      }
    }
  }

  const remainingAfter = plan.missing - copied;
  if (stopped) log.error?.(`[media-sync] ${stopped}`);
  else {
    log.log?.(`[media-sync] copied ${copied} object(s), ${(bytes / 1024 ** 2).toFixed(1)} MiB `
      + `in ${((Date.now() - started) / 1000).toFixed(1)}s — ${remainingAfter} still to copy`);
  }

  return { ...plan, copied, failed, bytes, remainingAfter, ms: Date.now() - started, stopped };
}

/**
 * Pick a sample to prove the copies are really there and really readable.
 *
 * Deterministic-ish by design: `pick` is injected so a test can choose exactly
 * which objects are sampled, and the caller can spread the sample across the
 * whole list rather than always checking the same few.
 */
export function chooseSample(objects = [], size = 3, pick = (list, n) => {
  // Evenly spaced rather than random: the oldest, middle and newest copies get
  // checked, so a failure confined to one era of the bucket is found. Random
  // sampling would eventually find it too — "eventually" is not a property
  // worth relying on for a backup.
  if (list.length <= n) return list;
  const step = Math.floor(list.length / n);
  return Array.from({ length: n }, (_, i) => list[i * step]);
}) {
  return pick(objects, size);
}

/**
 * Read a sample back OUT of the offsite bucket and check it against the source.
 *
 * ── WHY THIS EXISTS AT ALL ─────────────────────────────────────────────────
 * This is the lesson of #34, applied before it can be forgotten: a backup
 * nobody has read is not a backup, it is a hope. The platform had a daily
 * database backup for months and nobody had ever restored one — when it was
 * finally tried, that was the first proof it worked at all.
 *
 * An upload returning 200 proves the request was accepted. It does not prove
 * the bytes are there, that they are complete, or that they can be fetched
 * back. Only reading them does.
 */
export async function verifyCopies({ readDest, source = [], sampleSize = 3, log = console } = {}) {
  const sample = chooseSample(source, sampleSize);
  if (!sample.length) return { checked: 0, ok: 0, bad: [], state: 'quiet' };

  const bad = [];
  let ok = 0;
  for (const s of sample) {
    try {
      const got = await readDest(destKeyFor(s.key));
      const size = Number(got?.contentLength) || 0;
      if (size !== Number(s.size)) {
        bad.push({ key: s.key, expected: s.size, found: size, why: 'size does not match' });
      } else ok += 1;
    } catch (e) {
      bad.push({ key: s.key, expected: s.size, found: null, why: e.message });
    }
  }

  if (bad.length) {
    log.error?.(`[media-sync] VERIFY FAILED on ${bad.length} of ${sample.length}: `
      + bad.map((b) => `${b.key} (${b.why})`).join(' · '));
  } else {
    log.log?.(`[media-sync] verified ${ok} sampled copy/copies readable offsite`);
  }
  return { checked: sample.length, ok, bad, state: bad.length ? 'bad' : 'ok' };
}

/**
 * Is the sync allowed to run?
 *
 * OFF BY DEFAULT, and that is not caution for its own sake. Backblaze gives
 * 10 GB free; the first run pushes ~71 GB. Without a payment method on that
 * account every upload fails, so an eager sync would spend its first night
 * failing thousands of times and filling the log. The switch is the owner
 * saying "the card is on".
 */
export function syncEnabled(env = process.env) {
  return /^(1|true|yes|on)$/i.test(String(env.MEDIA_SYNC_ENABLED || '').trim());
}

/**
 * One full slice: list both sides, copy the difference, report.
 *
 * The modules are injected so this can be tested without a network, and so
 * neither storage module has to know the other exists.
 */
export async function syncMediaOffsite({
  listSource, listDest, read, write, readDest, env = process.env, limits = {}, log = console,
} = {}) {
  if (!syncEnabled(env)) {
    return { skipped: 'MEDIA_SYNC_ENABLED is not set — the offsite media copy is switched off' };
  }

  const [srcList, dstList] = await Promise.all([listSource(), listDest()]);
  if (srcList?.error) return { error: `could not list the media bucket: ${srcList.error}` };
  if (dstList?.error) return { error: `could not list the offsite bucket: ${dstList.error}` };

  // A truncated list on EITHER side looks identical to "everything is already
  // copied", which is the most dangerous wrong answer a backup job can reach.
  // Refuse rather than report a false all-clear.
  if (srcList?.truncated || dstList?.truncated) {
    return { error: 'a bucket listing was truncated — refusing to sync against a partial view '
      + 'of what exists, because that is indistinguishable from "nothing is missing"' };
  }

  const result = await runSync({
    read, write, source: srcList.objects, dest: dstList.objects, limits, log,
  });

  // Read a sample back. An upload returning 200 proves the request was
  // accepted; it proves nothing about whether the bytes are there, complete, or
  // fetchable. This platform ran a daily database backup for MONTHS before
  // anyone tried restoring one — that attempt was the first proof it worked.
  // Not repeating that here, on the copy of every customer's work.
  //
  // Sampled from what is now supposed to BE there, not from what this run
  // happened to copy: a file written correctly last week and corrupted since is
  // exactly as broken, and only re-reading finds it.
  if (readDest && !result.stopped) {
    result.verify = await verifyCopies({
      readDest, source: srcList.objects.filter((s) => s.size > 0), log,
    });
  }
  return result;
}
