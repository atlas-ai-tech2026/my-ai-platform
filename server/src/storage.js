// ─── storage.js ──────────────────────────────────────────────────────────────
// Permanent object storage for GENERATED outputs (images/videos), on
// DigitalOcean Spaces (S3-compatible).
//
// WHY THIS EXISTS: FAL returns generated files as links on ITS OWN CDN, and
// those links expire/get purged over time. If we only store the FAL link in a
// user's history, their old images silently vanish once FAL drops them — the
// history row survives but the image 404s. To make history durable we copy each
// output into our own Spaces bucket at generation time and hand the client OUR
// permanent URL instead of FAL's ephemeral one.
//
// Config is env-driven and OPTIONAL. If Spaces isn't configured, isReady() is
// false and callers fall back to the raw FAL url (old behaviour) — nothing
// breaks, it just isn't durable. Mirrors the db.js "isReady()" pattern.
//
// Required env:
//   SPACES_ENDPOINT   e.g. https://fra1.digitaloceanspaces.com  (region host, NOT the bucket host)
//   SPACES_REGION     e.g. fra1
//   SPACES_BUCKET     e.g. voxel-media
//   SPACES_KEY        Spaces access key
//   SPACES_SECRET     Spaces secret key
// Optional env:
//   SPACES_CDN_BASE   public base to build URLs from, e.g. https://voxel-media.fra1.cdn.digitaloceanspaces.com
//                     (if unset we derive a URL from endpoint + bucket)

import crypto from 'node:crypto';
import { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand,
         GetObjectCommand, GetBucketVersioningCommand, HeadObjectCommand,
         PutBucketVersioningCommand, GetBucketCorsCommand,
         PutBucketCorsCommand } from '@aws-sdk/client-s3';

const ENDPOINT = (process.env.SPACES_ENDPOINT || '').trim();
const REGION = (process.env.SPACES_REGION || '').trim();
const BUCKET = (process.env.SPACES_BUCKET || '').trim();
const KEY = (process.env.SPACES_KEY || '').trim();
const SECRET = (process.env.SPACES_SECRET || '').trim();
const CDN_BASE = (process.env.SPACES_CDN_BASE || '').trim().replace(/\/+$/, '');

const configured = Boolean(ENDPOINT && REGION && BUCKET && KEY && SECRET);

// ─── SERVING OLD FILES FROM THE EDGE, WITHOUT REWRITING ANY RECORD ─────────
// `publicUrl` below builds CDN links for files stored from now on. Every file
// stored BEFORE the CDN existed carries the origin host in its record —
// `voxel-ai-store.nyc3.digitaloceanspaces.com` — and there are tens of
// thousands of those.
//
// A migration would fix them and is the wrong tool: it rewrites customer
// history in place to gain a faster hostname, and if the CDN is ever turned
// off, every one of those records points somewhere that no longer serves.
//
// So the swap happens on the way OUT instead, in rowToItem. Nothing in the
// database changes, the origin keeps working, and removing SPACES_CDN_BASE
// reverts every URL to exactly what it was — no data to undo.
//
// It is a no-op until SPACES_CDN_BASE is set. Deploying this changes nothing
// on its own, which is the property that makes it safe to ship ahead of the
// switch.

/** The prefix existing records already carry — the same string publicUrl
 *  falls back to when there is no CDN. */
function originBase(endpoint = ENDPOINT, bucket = BUCKET) {
  try {
    return `https://${bucket}.${new URL(endpoint).host}`;
  } catch {
    return `${endpoint}/${bucket}`;
  }
}

/**
 * Computed ONCE, at import.
 *
 * cdnifyDeep walks every field of every record, and the first version called
 * originBase() — which parses a URL and builds a string — for EVERY value.
 * A history page of sixty generations is roughly fifteen hundred needless URL
 * parses per request, for a value that cannot change while the process is
 * running. Cheap individually, silly in aggregate, and on the hottest read
 * path in the app.
 */
const ORIGIN_PREFIX = `${originBase()}/`;

/** The edge base actually in force, or '' when files are served from origin.
 *  Exposed so /api/health can answer "is the CDN live" from outside — the
 *  two setup steps live in different DigitalOcean screens, and doing only the
 *  first leaves the CDN switched on and completely idle, which looks exactly
 *  like success. That happened here on 2026-08-27. */
export function mediaCdnBase() {
  return CDN_BASE;
}

/**
 * One URL, pointed at the edge instead of the origin.
 *
 * Rewrites ONLY urls that start with our own bucket's origin. A provider url
 * left behind by a failed re-host, a data: URI, a relative path, someone
 * else's CDN — all pass through untouched. Anything unrecognised is returned
 * exactly as given.
 */
export function toCdn(url, { cdnBase = CDN_BASE, origin = null } = {}) {
  if (!cdnBase || typeof url !== 'string' || !url) return url;
  const prefix = origin ? `${origin}/` : ORIGIN_PREFIX;
  if (!url.startsWith(prefix)) return url;
  return `${cdnBase}/${url.slice(prefix.length)}`;
}

/**
 * Every url inside a record, pointed at the edge.
 *
 * Walks the value rather than naming fields, because a generation carries
 * several: result_url, and on some kinds source_video_url and
 * motion_video_url too. A named list would quietly miss whichever one is
 * added next, and the symptom — one thumbnail slower than its neighbours —
 * is the kind nobody reports.
 *
 * Depth-capped: these are small flat records, and an unbounded walk over
 * arbitrary JSONB is a way to make a read path slow for no reason.
 */
export function cdnifyDeep(value, opts = {}, depth = 0) {
  if (depth > 6) return value;
  if (typeof value === 'string') return toCdn(value, opts);
  if (Array.isArray(value)) return value.map((v) => cdnifyDeep(v, opts, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = cdnifyDeep(v, opts, depth + 1);
    return out;
  }
  return value;
}

let client = null;
if (configured) {
  client = new S3Client({
    endpoint: ENDPOINT,
    region: REGION,
    forcePathStyle: false,
    credentials: { accessKeyId: KEY, secretAccessKey: SECRET },
    // Fail fast on a bad endpoint/creds instead of hanging the generation
    // response. Two attempts max; short connect/socket timeouts.
    maxAttempts: 2,
    requestHandler: { connectionTimeout: 3000, requestTimeout: 8000 },
  });
  // ── WHICH KEY IS ACTUALLY IN USE ────────────────────────────────────────
  // An access key ID is NOT a secret — it is the public half, like a username;
  // the secret is the other value and never appears here. But it is the only
  // way to know which of several keys a running app is holding, and on
  // 2026-08-21 that mattered: three Spaces keys existed, two of them for the
  // same production bucket, and nobody could say which one the app used. The
  // owner was about to delete one.
  //
  // Deleting the live key takes down every customer image and video instantly.
  // "The media sync is working" proves A key works, not WHICH — so the safe
  // answer was not a guess, it was making it observable.
  console.log(`[storage] DO Spaces configured → bucket=${BUCKET} region=${REGION} `
    + `key=${String(process.env.SPACES_KEY || '').slice(0, 8)}… `
    + `media=${CDN_BASE ? 'CDN ' + CDN_BASE : 'ORIGIN (no SPACES_CDN_BASE — the edge is idle)'}`);
} else {
  console.warn('[storage] DO Spaces NOT configured — generated outputs will use raw FAL urls (not durable).');
}

export function isReady() {
  return configured;
}

// ─── Private objects (automated DB backups) ─────────────────────────────────
// Backups contain user emails and full ledgers — ALWAYS private ACL, unlike
// media uploads which are public-read by design.
export async function uploadPrivate(key, body, contentType = 'application/gzip') {
  if (!configured) throw new Error('Spaces not configured');
  await client.send(new PutObjectCommand({
    Bucket: BUCKET, Key: key, Body: body, ContentType: contentType, ACL: 'private',
  }));
  return key;
}

/**
 * Read a private object back. Added for the restore verification: writing a
 * backup and never reading one is how a backup system convinces you it works.
 */
export async function downloadPrivate(key) {
  if (!configured) throw new Error('Spaces not configured');
  const out = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  return Buffer.from(await out.Body.transformToByteArray());
}

/**
 * Does one specific object already exist in the PRIMARY bucket?
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * The daily-backup guard asks "has today's archive already been written?".
 * Its first version asked that of the OFFSITE bucket only — which is correct
 * on production and useless everywhere else. Dev has no offsite bucket by
 * design (#51, so dev cannot spend production's Backblaze allowance), so the
 * check returned "not configured", the guard failed open, and dev backed up on
 * EVERY BOOT. Dev deploys far more often than production, so the environment
 * with the least valuable data was doing the most backing up.
 *
 * A guard that only works in one environment is not a guard. This is the other
 * half: ask the destination this environment actually writes to.
 *
 * Same contract as offsiteObjectExists: true / false / null, where **null means
 * "I could not find out"** and the caller must run the backup anyway. A
 * duplicate archive is waste; a skipped day cannot be recovered.
 */
export async function primaryObjectExists(key) {
  if (!configured) return null;
  try {
    await client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch (err) {
    const status = err?.$metadata?.httpStatusCode;
    if (status === 404 || err?.name === 'NotFound') return false;
    console.error(`[storage] could not check whether ${key} exists: ${err.message}`);
    return null;
  }
}

export async function listKeys(prefix) {
  if (!configured) throw new Error('Spaces not configured');
  const out = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, MaxKeys: 1000 }));
  return (out.Contents || []).map(o => ({ key: o.Key, size: o.Size, modified: o.LastModified }));
}

/**
 * Our own url → the object key. NULL for anything that is not ours.
 *
 * ── WHY NULL AND NOT A GUESS ───────────────────────────────────────────────
 * This feeds the purge, which DELETES. A url we do not recognise — a provider
 * link left behind by a failed re-host, someone else's CDN, a data: URI — must
 * produce nothing at all rather than a key that might match something real.
 * Guessing here deletes the wrong file, and there is no undo below this layer.
 *
 * Both hosts are accepted: files were written to the origin before the CDN
 * existed and are read through the edge now, so history holds both spellings
 * of the same object.
 */
export function keyFromUrl(url, { origin = null, cdnBase = CDN_BASE } = {}) {
  if (!url || typeof url !== 'string') return null;
  // Injectable, like toCdn — the env is not configured under test, and a guard
  // that can only be exercised on its refusal path is one that could match
  // NOTHING in production and delete no files while reporting success.
  for (const base of [origin || originBase(), cdnBase].filter(Boolean)) {
    const prefix = `${base}/`;
    if (url.startsWith(prefix)) {
      const key = url.slice(prefix.length).split('?')[0];
      // A key that escapes its own prefix is not one of ours, whatever the
      // host says.
      return key && !key.includes('..') ? decodeURIComponent(key) : null;
    }
  }
  return null;
}

export async function deleteKey(key) {
  if (!configured) throw new Error('Spaces not configured');
  await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

/**
 * Turn on object versioning, and say what it was.
 *
 * ── WHAT IT ACTUALLY BUYS ─────────────────────────────────────────────────
 * With versioning ON, deleting an object does not remove it — S3 writes a
 * delete marker and the bytes stay recoverable. Overwrites keep the old copy
 * too. That is the entire protection against the exact scenario we spent
 * 2026-08-19 reducing: a credential in the wrong hands, or a mistaken script,
 * wiping 66 GiB of customer work that exists nowhere else.
 *
 * ── WHAT IT DOES NOT BUY, AND THIS MATTERS ────────────────────────────────
 * Versioning lives INSIDE the bucket. Delete the bucket, lose the DigitalOcean
 * account, and every version goes with it. It is protection against a mistake,
 * not against losing the provider — which is why it is only half of #55 and
 * the Backblaze copy is the other half.
 *
 * ── WHY IT RUNS FROM THE SERVER ───────────────────────────────────────────
 * DigitalOcean's console cannot do this; it says so on the settings page —
 * "This feature can only be enabled via the API". And the server is the only
 * place holding current credentials: the Spaces secret is write-only in the
 * app config, so nobody, including the owner, can run this from a laptop.
 *
 * Idempotent. Enabling an already-enabled bucket is a no-op, so this is safe
 * to call on every boot and safe to call by hand.
 */
/**
 * Let OUR OWN pages read a media file with JavaScript.
 *
 * ── WHAT IS BROKEN WITHOUT IT ──────────────────────────────────────────────
 * Voxel Edit Cut's export reads each clip with fetch() to feed it into the
 * video engine. A cross-origin fetch needs the bucket to say who may read it;
 * an <img> or <video> tag does not. So galleries work perfectly while
 * EXPORTING A PROJECT THAT CONTAINS A VOXEL CLIP fails completely — the one
 * thing the editor exists to do, broken for the one input that makes it ours.
 *
 * Measured 2026-08-28 on both the origin and the CDN: no
 * access-control-allow-origin for voxel-ai.ai, dev.voxel-ai.ai or localhost.
 * This is very likely the real cause of "export worked locally then failed for
 * every user on dev", which was put down to CSP at the time.
 *
 * ── WHY IT RUNS HERE AND NOT IN THE PANEL ──────────────────────────────────
 * Same reason as ensureVersioning: the Spaces secret is write-only in the app
 * config, so the server is the only place that holds it. Nobody, including the
 * owner, can do this from a laptop.
 *
 * ── AND WHY THE LIST IS NOT A WILDCARD ─────────────────────────────────────
 * `*` would let any site on the internet read a customer's media with script.
 * These files are already public to anyone holding the url, so it is not a
 * catastrophe — but "already leaky" is a poor reason to open it wider, and a
 * named list costs nothing.
 */
export const MEDIA_CORS_ORIGINS = [
  'https://voxel-ai.ai',
  'https://www.voxel-ai.ai',
  'https://dev.voxel-ai.ai',
  'http://localhost:5173',
];

export const MEDIA_CORS_RULE = {
  AllowedOrigins: MEDIA_CORS_ORIGINS,
  // GET and HEAD only. The browser never WRITES to this bucket — uploads go
  // through our own API, which is where the size and type checks live.
  AllowedMethods: ['GET', 'HEAD'],
  AllowedHeaders: ['*'],
  // Content-Length so the rescue and the surveys can read a size from a
  // browser-side request without downloading the file.
  ExposeHeaders: ['Content-Length', 'Content-Type', 'ETag'],
  MaxAgeSeconds: 3600,
};

export async function ensureMediaCors({ s3 = client, bucket = BUCKET } = {}) {
  if (!s3) return { ok: false, error: 'Spaces not configured' };

  let before = null;
  try {
    const cur = await s3.send(new GetBucketCorsCommand({ Bucket: bucket }));
    before = cur?.CORSRules || [];
  } catch (e) {
    // NoSuchCORSConfiguration is the normal "none set" answer, not a fault.
    before = /NoSuchCORSConfiguration/i.test(e?.name || e?.message || '') ? [] : null;
    if (before === null) return { ok: false, stage: 'read', error: e.message };
  }

  const already = before.some((r) =>
    MEDIA_CORS_ORIGINS.every((o) => (r.AllowedOrigins || []).includes(o))
    && (r.AllowedMethods || []).includes('GET'));
  if (already) return { ok: true, changed: false, rules: before.length };

  try {
    await s3.send(new PutBucketCorsCommand({
      Bucket: bucket, CORSConfiguration: { CORSRules: [MEDIA_CORS_RULE] },
    }));
  } catch (e) {
    return { ok: false, stage: 'write', error: e.message };
  }

  // Read it back. A PUT that returns 200 and leaves the bucket unchanged would
  // otherwise be reported as a fix that does not exist — the precise failure
  // this project keeps finding, and the reason ensureVersioning does the same.
  try {
    const after = await s3.send(new GetBucketCorsCommand({ Bucket: bucket }));
    const rules = after?.CORSRules || [];
    const ok = rules.some((r) => (r.AllowedOrigins || []).includes('https://voxel-ai.ai'));
    return ok
      ? { ok: true, changed: true, rules: rules.length, origins: MEDIA_CORS_ORIGINS }
      : { ok: false, stage: 'verify', error: 'the rule did not stick', rules: rules.length };
  } catch (e) {
    return { ok: false, stage: 'verify', error: e.message };
  }
}

export async function ensureVersioning({ enable = true, s3 = client, bucket = BUCKET } = {}) {
  if (!s3) return { ok: false, error: 'Spaces not configured' };
  let was;
  try {
    const before = await s3.send(new GetBucketVersioningCommand({ Bucket: bucket }));
    was = before?.Status || 'Disabled';
  } catch (e) {
    return { ok: false, stage: 'read', error: e.message };
  }
  if (was === 'Enabled') return { ok: true, was, now: 'Enabled', changed: false };
  if (!enable) return { ok: true, was, now: was, changed: false };

  try {
    await s3.send(new PutBucketVersioningCommand({
      Bucket: bucket, VersioningConfiguration: { Status: 'Enabled' },
    }));
    // Read it back rather than trusting the write. A PUT that returns 200 and
    // leaves the bucket unversioned would otherwise be reported as protection
    // that does not exist — the precise failure this project keeps finding.
    const after = await s3.send(new GetBucketVersioningCommand({ Bucket: bucket }));
    const now = after?.Status || 'Disabled';
    if (now !== 'Enabled') {
      return { ok: false, was, now, changed: false, stage: 'verify',
        error: 'the API accepted the change but the bucket is still unversioned' };
    }
    console.log(`[storage] object versioning ENABLED on ${bucket} (was ${was}) — deletes are now recoverable`);
    return { ok: true, was, now, changed: true };
  } catch (e) {
    // ── THE THING THAT CAUGHT ME OUT ────────────────────────────────────
    // Enabling versioning is a bucket CONFIGURATION call, and DigitalOcean
    // grants configuration only to FULL ACCESS keys. Their own create-key
    // dialog says so: "Full Access … including bucket creation and
    // configuration (lifecycle, bucket policies, versioning, CORS …)".
    //
    // Our production key is deliberately Limited Access, scoped to one bucket
    // with readwrite — which is exactly what we spent 2026-08-19 achieving.
    // So the running app CANNOT and SHOULD NOT be able to do this: making it
    // possible would mean handing the app back the permissions we just took
    // away, permanently, to perform a one-off setting.
    //
    // Versioning is switched on ONCE with a temporary full-access key that is
    // then deleted. See server/scripts/enable-versioning.mjs.
    const denied = /access denied|forbidden/i.test(e.message || '');
    return {
      ok: false, was, stage: 'write', denied, error: e.message,
      hint: denied
        ? 'A Limited Access key cannot change bucket configuration — this needs a temporary '
          + 'Full Access key. Run server/scripts/enable-versioning.mjs once, then delete that key.'
        : undefined,
    };
  }
}

/**
 * Report versioning without changing it.
 *
 * Read separately from the write path because the two need different
 * permissions and fail for different reasons — and a screen that says "not
 * checked" when it means "not allowed to check" teaches you to ignore it.
 */
export async function versioningStatus() {
  if (!configured) return { error: 'Spaces not configured' };
  try {
    const r = await client.send(new GetBucketVersioningCommand({ Bucket: BUCKET }));
    return { status: r?.Status || 'Disabled', bucket: BUCKET };
  } catch (e) {
    const denied = /access denied|forbidden/i.test(e.message || '');
    return { error: e.message, denied, bucket: BUCKET };
  }
}

/**
 * Every object in the media bucket — the SOURCE side of the offsite sync.
 *
 * Truncation is passed through rather than swallowed: a partial list would look
 * to the sync exactly like "everything is already copied", which is the most
 * dangerous possible wrong answer for a backup job.
 */
/**
 * What counts as customer media, in ONE place.
 *
 * The sync copies this prefix and the SOP check must count the same one. When
 * they were written separately the check compared the WHOLE Spaces bucket
 * against the media mirror and reported the 14 database archives in backups/ as
 * unprotected customer files — permanently, since the sync is never going to
 * copy them there. See measureMedia below.
 */
export const MEDIA_SOURCE_PREFIX = 'generations/';

export async function listAllMedia() {
  if (!configured) return { error: 'Spaces not configured' };
  try {
    const { listAllObjects } = await import('./storage-usage.js');
    // ONLY `generations/`. This bucket also holds `backups/` — the encrypted
    // database archives written by uploadPrivate — and those ALREADY go to
    // Backblaze by their own path. Without this prefix the media sync copied
    // them a second time under media/backups/, paying twice to store the same
    // archive and muddying the count of what is actually protected.
    //
    // Found on the FIRST production run, from a log line naming
    // backups/voxel-auto-2026-08-07.ndjson.gz.enc in a media verification.
    const r = await listAllObjects(client, BUCKET, {
      ListObjectsV2Command, prefix: MEDIA_SOURCE_PREFIX,
    });
    return { ...r, bucket: BUCKET };
  } catch (e) {
    return { error: e.message };
  }
}

/**
 * Open an object for streaming.
 *
 * Returns the raw stream, NOT a buffer. A video can be hundreds of megabytes,
 * and holding several in memory inside the web process is how a customer's
 * generation dies of an out-of-memory error while a backup job runs.
 */
export async function readObject(key, { signal } = {}) {
  if (!configured) throw new Error('Spaces not configured');
  // abortSignal, so a hung read cannot stall the sync forever. Without it a
  // single stalled stream silenced the whole job for three hours on 2026-08-20.
  const out = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }),
    signal ? { abortSignal: signal } : undefined);
  return {
    body: out.Body,
    contentLength: Number(out.ContentLength) || 0,
    contentType: out.ContentType || 'application/octet-stream',
  };
}

/**
 * Total size of this bucket, for the daily quota check.
 *
 * Lives here rather than in storage-usage.js so the S3 client stays private to
 * this module — one place holds the credentials. NOTE it does NOT reuse
 * listKeys() above: that caps at 1000 objects and does not paginate, which is
 * fine for listing a handful of backups and would silently report 8% of this
 * bucket as its total.
 */
export async function measureUsage() {
  if (!configured) return { error: 'Spaces not configured in this environment' };
  try {
    const { measureBucket } = await import('./storage-usage.js');
    const r = await measureBucket(client, BUCKET, { ListObjectsV2Command });
    return { ...r, bucket: BUCKET };
  } catch (e) {
    return { error: e.message };
  }
}

/**
 * Size and count of CUSTOMER MEDIA only — the same set the sync copies.
 *
 * measureUsage() measures the whole bucket, which is right for the quota line
 * (the bill covers everything) and wrong for "is customer media backed up":
 * the bucket also holds backups/, the encrypted database archives, which reach
 * Backblaze by their own path and will never appear under media/.
 *
 * Comparing the two produced "11,372 of 11,386 files copied offsite — 14 not
 * yet protected" on production while the sync itself reported "0 still to
 * copy", correctly, every fifteen minutes. A check that cannot reach green is
 * one you stop reading, and this screen's whole value is that its silence means
 * something.
 */
export async function measureMedia() {
  if (!configured) return { error: 'Spaces not configured in this environment' };
  try {
    const { measureBucket } = await import('./storage-usage.js');
    const r = await measureBucket(client, BUCKET, {
      ListObjectsV2Command, prefix: MEDIA_SOURCE_PREFIX,
    });
    return { ...r, bucket: BUCKET };
  } catch (e) {
    return { error: e.message };
  }
}

// Map a content-type / source url to a file extension. Best-effort; defaults to
// bin so we never throw on an unknown type.
function pickExt(contentType, sourceUrl) {
  const ct = (contentType || '').toLowerCase();
  const map = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp',
    'image/gif': 'gif', 'image/avif': 'avif',
    'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
    'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
  };
  if (map[ct]) return map[ct];
  const m = String(sourceUrl || '').split('?')[0].match(/\.([a-z0-9]{2,4})$/i);
  return m ? m[1].toLowerCase() : 'bin';
}

function publicUrl(key) {
  if (CDN_BASE) return `${CDN_BASE}/${key}`;
  // Derive `https://<bucket>.<endpoint-host>/<key>` from the region endpoint.
  try {
    const host = new URL(ENDPOINT).host; // e.g. fra1.digitaloceanspaces.com
    return `https://${BUCKET}.${host}/${key}`;
  } catch {
    return `${ENDPOINT}/${BUCKET}/${key}`;
  }
}

// Fetch a generated file from `sourceUrl` and copy it into our Spaces bucket.
// Returns the permanent public URL. Throws on any failure so the caller can
// fall back to the original FAL url — we never want re-hosting to break a
// generation the user already paid for.
//
// `kind` is a folder prefix like 'image' | 'video' | 'audio'.
/**
 * Write to an EXACT key, publicly readable.
 *
 * persistBuffer picks its own uuid under `generations/`, which is right for a
 * customer's output and wrong for anything that has to be found again by name
 * — the speech model, whose files transformers.js requests by path.
 *
 * `uploadPrivate` is the other neighbour and is also wrong here: the model has
 * to be readable by a customer's browser, which a private ACL forbids.
 *
 * Callers pass the key, so this is capable of overwriting. Every use of it is
 * under a `models/` prefix; nothing in the codebase points it at
 * `generations/`, and a test asserts that.
 */
export async function uploadPublicAt(key, body, contentType = 'application/octet-stream') {
  if (!configured) throw new Error('Spaces not configured');
  if (!key || typeof key !== 'string') throw new Error('A key is required');
  await client.send(new PutObjectCommand({
    Bucket: BUCKET, Key: key, Body: body, ContentType: contentType,
    ACL: 'public-read',
    // A model file at a versioned path never changes. Cache it for a year so
    // a customer downloads it once, ever.
    CacheControl: 'public, max-age=31536000, immutable',
  }));
  return publicUrl(key);
}

/** How many bytes are actually stored at this key, or null if it cannot be
 *  read. Used to verify a write rather than trust that it returned. */
export async function objectSize(key) {
  if (!configured) return null;
  try {
    const out = await client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    const n = Number(out?.ContentLength);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export async function persistFromUrl(sourceUrl, kind = 'output', signal) {
  if (!configured) throw new Error('Spaces not configured');
  if (!sourceUrl || typeof sourceUrl !== 'string') throw new Error('No source url');

  const resp = await fetch(sourceUrl, { signal });
  if (!resp.ok) throw new Error(`Fetch source failed: ${resp.status}`);
  const contentType = resp.headers.get('content-type') || '';
  const buf = Buffer.from(await resp.arrayBuffer());

  return persistBuffer(buf, contentType, kind, signal, sourceUrl);
}

// Write a raw buffer straight into the bucket and return its permanent public
// URL. Used by persistFromUrl above and by /api/upload for user reference
// images — those need a public https URL that external providers can fetch
// (kie.ai cannot read data: URIs, and FAL storage rejects keys without the
// storage scope).
export async function persistBuffer(buf, contentType, kind = 'output', signal, sourceUrl = null) {
  if (!configured) throw new Error('Spaces not configured');
  if (!buf?.length) throw new Error('Empty source body');

  const ext = pickExt(contentType, sourceUrl);
  const id = crypto.randomUUID();
  // generations/<kind>/<id>.<ext> — flat and predictable; no per-date fanout
  // needed for a solo-dev scale.
  const objectKey = `generations/${kind}/${id}.${ext}`;

  await client.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: objectKey,
    Body: buf,
    ContentType: contentType || 'application/octet-stream',
    ACL: 'public-read', // history images are shown directly in the browser
    CacheControl: 'public, max-age=31536000, immutable',
  }), { abortSignal: signal });

  return publicUrl(objectKey);
}

// Convenience wrapper: try to re-host; on ANY failure OR timeout, log and
// return the original url so the caller keeps going. NEVER throws and NEVER
// blocks longer than `timeoutMs` — a misconfigured Spaces must not hang the
// user's generation response. Default 10s (generous for an image; videos may
// fall back more often, which is fine — durability is best-effort).
export async function persistOrFallback(sourceUrl, kind = 'output', { timeoutMs = 10000 } = {}) {
  if (!configured || !sourceUrl) return sourceUrl;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  // TIMED, because this runs BEFORE the user is handed their image — an 8 MB
  // download from the provider plus an 8 MB upload to Spaces is added straight
  // to their wait. The owner noticed a generation felt slow on 2026-08-19 and
  // nothing in the logs could say whether it was the model or this copy. A
  // number nobody records is a question nobody can answer twice.
  const startedAt = Date.now();
  try {
    const url = await persistFromUrl(sourceUrl, kind, ac.signal);
    console.log(`[storage] re-hosted ${kind} in ${Date.now() - startedAt}ms → ${url}`);
    return url;
  } catch (e) {
    console.error(`[storage] re-host failed after ${Date.now() - startedAt}ms (${kind}), keeping provider url:`, e.message);
    return sourceUrl;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The same thing, plus the small version the history grid loads.
 *
 * NEVER THROWS, exactly like persistOrFallback — a thumbnail failure returns
 * `{url, thumbUrl: null}` and a re-host failure returns the provider's own
 * url. The customer's picture is not at risk from either.
 *
 * `makeThumb` is injected so this file does not import the image library: it
 * is loaded on the boot path, and the resizer is only ever needed once a
 * generation has already succeeded.
 *
 * ONE download feeds both uploads. Downloading a 7.5 MB file twice would add
 * the wait straight back onto the customer, which is the thing this whole
 * piece of work exists to remove.
 */
export async function persistWithThumb(sourceUrl, kind = 'output', { timeoutMs = 10000, makeThumb } = {}) {
  if (!configured || !sourceUrl || !makeThumb) {
    return { url: await persistOrFallback(sourceUrl, kind, { timeoutMs }), thumbUrl: null };
  }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const { saveWithThumbnail } = await import('./thumb-on-save.js');
    const out = await saveWithThumbnail(sourceUrl, kind, {
      download: async (u) => {
        const resp = await fetch(u, { signal: ac.signal });
        if (!resp.ok) throw new Error(`Fetch source failed: ${resp.status}`);
        return {
          buf: Buffer.from(await resp.arrayBuffer()),
          contentType: resp.headers.get('content-type') || '',
        };
      },
      store: (buf, contentType, k) => persistBuffer(buf, contentType, k, ac.signal, sourceUrl),
      thumbnail: makeThumb,
      onNote: (note) => console.log(`[storage] ${note}`),
    });
    console.log(`[storage] re-hosted ${kind} in ${Date.now() - startedAt}ms → ${out.url}`
      + `${out.thumbUrl ? ' (+ thumbnail)' : ' (no thumbnail)'}`);
    return out;
  } catch (e) {
    console.error(`[storage] re-host failed after ${Date.now() - startedAt}ms (${kind}), keeping provider url:`, e.message);
    return { url: sourceUrl, thumbUrl: null };
  } finally {
    clearTimeout(timer);
  }
}
