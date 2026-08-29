// ─── backup-offsite.js ───────────────────────────────────────────────────────
// M3 (security audit 2026-07-28): every backup lived in the SAME
// DigitalOcean account as the database it protects. Losing that account —
// billing failure, compromise, or accidental deletion — loses the data AND
// every copy of it at the same moment. That is not a backup, it's a copy.
//
// This adds the second half of a real backup strategy:
//   1. ENCRYPTION AT REST — archives are encrypted before they leave the
//      process, so neither storage provider ever holds readable customer
//      data. AES-256-GCM with a key derived by scrypt from a passphrase in
//      the environment (node:crypto — no new dependency, and no `age`/`gpg`
//      binary needed on the DO buildpack, which has neither).
//   2. A SECOND DESTINATION in a DIFFERENT provider/account, addressed with
//      plain S3-compatible env vars (Backblaze B2, Cloudflare R2, AWS S3…).
//
// Both destinations must succeed or the job fails LOUDLY — the previous
// behaviour of silently succeeding on one copy is what makes people believe
// they have backups they don't have.
//
// ── ENV VARS (all required to enable the offsite copy) ──────────────────
//   BACKUP_ENCRYPTION_PASSPHRASE   long random string; WITHOUT IT NOTHING
//                                  CAN BE DECRYPTED — store it separately
//                                  from the backups themselves
//   OFFSITE_S3_ENDPOINT            e.g. https://s3.us-west-004.backblazeb2.com
//   OFFSITE_S3_REGION              e.g. us-west-004
//   OFFSITE_S3_BUCKET              e.g. voxel-offsite-backups
//   OFFSITE_S3_KEY                 access key id
//   OFFSITE_S3_SECRET              secret access key
// Optional:
//   OFFSITE_S3_PREFIX              default 'backups/'
//
// Restore procedure: RESTORE.md in the repo root.

import crypto from 'node:crypto';
import { S3Client, PutObjectCommand, ListObjectsV2Command,
         DeleteObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';

// ---- encryption ----------------------------------------------------------

const MAGIC = Buffer.from('VOXBK1');   // format marker + version
const SALT_LEN = 16;
const IV_LEN = 12;                      // GCM standard
const KEY_LEN = 32;                     // AES-256
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };

export function encryptionConfigured(env = process.env) {
  return !!(env.BACKUP_ENCRYPTION_PASSPHRASE || '').trim();
}

function deriveKey(passphrase, salt) {
  return crypto.scryptSync(passphrase, salt, KEY_LEN, SCRYPT_PARAMS);
}

/**
 * Encrypt a buffer with AES-256-GCM.
 * Layout: MAGIC | salt(16) | iv(12) | authTag(16) | ciphertext
 * Everything needed to decrypt (except the passphrase) travels with the
 * file, so a restore needs only the archive and the passphrase.
 */
export function encryptBackup(plaintext, passphrase) {
  if (!passphrase) throw new Error('BACKUP_ENCRYPTION_PASSPHRASE is not set');
  const salt = crypto.randomBytes(SALT_LEN);
  const iv = crypto.randomBytes(IV_LEN);
  const key = deriveKey(passphrase, salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), ciphertext]);
}

/** Reverse of encryptBackup. Throws if the passphrase is wrong or the file
 * was tampered with (GCM authentication). */
export function decryptBackup(blob, passphrase) {
  if (!passphrase) throw new Error('BACKUP_ENCRYPTION_PASSPHRASE is not set');
  if (!Buffer.isBuffer(blob) || blob.length < MAGIC.length + SALT_LEN + IV_LEN + 16) {
    throw new Error('Not a Voxel backup archive (too short)');
  }
  if (!blob.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('Not a Voxel backup archive (bad magic)');
  }
  let o = MAGIC.length;
  const salt = blob.subarray(o, o += SALT_LEN);
  const iv = blob.subarray(o, o += IV_LEN);
  const tag = blob.subarray(o, o += 16);
  const ciphertext = blob.subarray(o);
  const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(passphrase, salt), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

// ---- second destination --------------------------------------------------

export function offsiteConfigured(env = process.env) {
  return ['OFFSITE_S3_ENDPOINT', 'OFFSITE_S3_REGION', 'OFFSITE_S3_BUCKET',
          'OFFSITE_S3_KEY', 'OFFSITE_S3_SECRET']
    .every((k) => (env[k] || '').trim());
}

/** Names of the env vars that are missing — for a precise startup warning. */
export function missingOffsiteVars(env = process.env) {
  return ['BACKUP_ENCRYPTION_PASSPHRASE', 'OFFSITE_S3_ENDPOINT', 'OFFSITE_S3_REGION',
          'OFFSITE_S3_BUCKET', 'OFFSITE_S3_KEY', 'OFFSITE_S3_SECRET']
    .filter((k) => !(env[k] || '').trim());
}

/**
 * Total size of the offsite bucket, for the daily quota check.
 *
 * Backblaze is the account that can actually STOP working: the first 10 GB are
 * free, and above that WITHOUT a payment method on file the uploads simply
 * fail. So the size of this bucket is not a curiosity — it is the number that
 * says "add a card this week" while there is still time to do it calmly.
 *
 * Lives here so the credentials stay inside this module.
 */
export async function measureOffsiteUsage(env = process.env, { prefix } = {}) {
  if (!offsiteConfigured(env)) return { error: 'offsite storage is not configured in this environment' };
  try {
    const { measureBucket } = await import('./storage-usage.js');
    const bucket = env.OFFSITE_S3_BUCKET.trim();
    const r = await measureBucket(offsiteReader(env), bucket, { ListObjectsV2Command, prefix });
    return { ...r, bucket };
  } catch (e) {
    return { error: e.message };
  }
}

/**
 * How much customer media has actually reached the offsite bucket.
 *
 * COUNTED, not inferred from a setting. The owner asked to be reminded to add
 * a payment method to Backblaze; a reminder someone can tick off would then
 * read "done" whether or not one file had ever been copied. This goes quiet
 * only when the files are genuinely there.
 */
export async function measureOffsiteMedia(env = process.env) {
  const { MEDIA_PREFIX } = await import('./storage-usage.js');
  return measureOffsiteUsage(env, { prefix: MEDIA_PREFIX });
}

/** Every media object already offsite — the DESTINATION side of the sync. */
export async function listOffsiteMedia(env = process.env) {
  if (!offsiteConfigured(env)) return { error: 'offsite storage is not configured in this environment' };
  try {
    const { listAllObjects } = await import('./storage-usage.js');
    const { MEDIA_PREFIX } = await import('./media-sync.js');
    const r = await listAllObjects(offsiteReader(env), env.OFFSITE_S3_BUCKET.trim(), {
      ListObjectsV2Command, prefix: MEDIA_PREFIX,
    });
    return { ...r, bucket: env.OFFSITE_S3_BUCKET.trim() };
  } catch (e) {
    // ── SAY WHICH THING BROKE (2026-08-29) ──
    // Three nights of "could not list the offsite bucket", and that one
    // sentence covers two problems with opposite fixes: Backblaze unreachable,
    // or listing specifically failing. Last night's fix assumed the second and
    // changed nothing.
    //
    // So instead of a fourth guess, ask the cheapest possible question right
    // now — one HEAD for one key — and let the two outcomes separate. It never
    // throws and its only output is a log line.
    try {
      const { probeOffsite, diagnose, diagnosisLine } = await import('./offsite-diagnose.js');
      const probe = await probeOffsite({
        head: (key) => offsiteReader(env).send(new HeadObjectCommand({
          Bucket: env.OFFSITE_S3_BUCKET.trim(), Key: key,
        })),
      });
      console.error(diagnosisLine(diagnose(e, probe)));
    } catch (probeErr) {
      // A diagnostic that breaks the thing it is diagnosing is worse than none.
      console.error(`[offsite-diagnosis] the probe itself failed: ${probeErr?.message || probeErr}`);
    }
    return { error: e.message };
  }
}

/**
 * Read a media object back OUT of the offsite bucket.
 *
 * Only the length is used by the verification — it is what proves a copy is
 * complete — but the body comes back too so a future check can compare content
 * rather than size alone.
 */
export async function readMediaObject(key, env = process.env) {
  if (!offsiteConfigured(env)) throw new Error('offsite storage is not configured');
  const out = await offsiteReader(env).send(new GetObjectCommand({
    Bucket: env.OFFSITE_S3_BUCKET.trim(), Key: key,
  }));
  return { body: out.Body, contentLength: Number(out.ContentLength) || 0 };
}

/**
 * Write one media object offsite.
 *
 * NOT encrypted, unlike the database archives above — and that is deliberate.
 * These are images and videos the customer can already fetch from a public URL,
 * so encrypting them would add a passphrase dependency to 66 GiB of files
 * without protecting anything that is not already public. The database backups
 * contain emails and ledgers and stay encrypted.
 *
 * ContentLength is required: Backblaze's S3 layer will not accept a chunked
 * body, which is why the stream is passed with its length rather than piped
 * blind.
 */
export async function writeMediaObject({ key, body, contentLength, contentType },
  optsOrEnv = {}, maybeEnv = process.env) {
  // Called as (obj, {signal}) by the sync and as (obj, env) by anything older,
  // so both shapes are accepted rather than silently ignoring the signal.
  const signal = optsOrEnv?.signal;
  const env = optsOrEnv?.signal ? maybeEnv : (optsOrEnv && Object.keys(optsOrEnv).length ? optsOrEnv : process.env);
  if (!offsiteConfigured(env)) throw new Error('offsite storage is not configured');
  await offsiteClient(env).send(new PutObjectCommand({
    Bucket: env.OFFSITE_S3_BUCKET.trim(),
    Key: key,
    Body: body,
    ContentLength: contentLength,
    ContentType: contentType || 'application/octet-stream',
  }), signal ? { abortSignal: signal } : undefined);
}

let cachedClient = null;
let cachedReader = null;

/**
 * A SECOND client, used only for LISTING and READING.
 *
 * ── WHY TWO CLIENTS ────────────────────────────────────────────────────────
 * On 2026-08-28, four hours and nineteen minutes after a clean restart, every
 * listing began failing with "the request socket did not establish a
 * connection" — directly behind an upload batch that pushed 235 MiB in one go.
 * Copies then stopped entirely for two and a half hours, because the sync must
 * list the destination before it can know what is missing.
 *
 * That timing killed the theory held since 21 August. We expected it after
 * DAYS of uptime; it returned after HOURS, behind the three heaviest upload
 * batches of the night. So the variable is upload VOLUME, not elapsed time —
 * which points at the connection pool: heavy uploads hold the sockets and a
 * listing cannot get one before its connect timeout expires.
 *
 * Two clients means two pools. A busy upload can no longer starve a listing.
 *
 * This is a HYPOTHESIS with a cheap fix attached, and it says so: if listings
 * still fail on a heavy night after this ships, the cause is elsewhere — most
 * likely Backblaze refusing connections under load — and the next place to
 * look is their side, not ours. Either way it costs one client object and
 * answers a question that has been open for a week.
 */
function offsiteReader(env = process.env) {
  if (cachedReader) return cachedReader;
  cachedReader = buildOffsiteClient(env, {
    // Listing a bucket is not uploading a video to another continent. It
    // should answer quickly or say so.
    connectionTimeout: 10_000, requestTimeout: 30_000, maxAttempts: 3,
  });
  return cachedReader;
}

function offsiteClient(env = process.env) {
  if (cachedClient) return cachedClient;
  cachedClient = buildOffsiteClient(env, {
    connectionTimeout: 10_000, requestTimeout: 120_000, maxAttempts: 3,
  });
  return cachedClient;
}

function buildOffsiteClient(env, { connectionTimeout, requestTimeout, maxAttempts }) {
  return new S3Client({
    endpoint: env.OFFSITE_S3_ENDPOINT.trim(),
    region: env.OFFSITE_S3_REGION.trim(),
    credentials: {
      accessKeyId: env.OFFSITE_S3_KEY.trim(),
      secretAccessKey: env.OFFSITE_S3_SECRET.trim(),
    },
    forcePathStyle: true, // widest compatibility (B2, R2, MinIO…)
    // ── THE ROOT CAUSE OF THE THREE-HOUR SILENCE ────────────────────────
    // This client had NO timeout of any kind. The Spaces client next door has
    // had requestTimeout: 8000 since it was written; this one, added later for
    // the offsite backup, never got one — and nobody noticed because a nightly
    // 5 MB archive upload never stalls long enough to matter.
    //
    // Then the media sync started pushing tens of thousands of objects through
    // it, one stalled on 2026-08-20, and with no deadline it waited forever.
    // The promise never settled, the sync's "already running" guard stayed
    // true, and the job stopped dead in silence for three hours.
    //
    // 120s rather than the 8s used for Spaces: these are uploads of whole
    // videos to a different continent, so slow is normal and forever is not.
    maxAttempts,
    requestHandler: { connectionTimeout, requestTimeout },
    // SDK ≥3.729 defaults to flexible checksums (aws-chunked bodies with
    // trailing CRC), which some S3-compatible providers reject. B2 accepts
    // them today (verified 2026-08-02), but plain signed bodies are the
    // compatibility-safe choice. NB: with a WRONG applicationKey, B2 fails
    // PUTs with the misleading "The request body was too small" instead of
    // SignatureDoesNotMatch — check credentials before blaming the body.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

/**
 * Does one specific object already exist offsite?
 *
 * ── WHY HEAD AND NOT A LISTING ─────────────────────────────────────────────
 * This answers "has today's backup already been written?" and is called on
 * every boot, so it has to be the cheapest and most reliable question
 * available: ONE request for ONE key.
 *
 * Deliberately not `listOffsite('backups/').then(keys => keys.includes(k))`.
 * Listing this bucket is the operation that has been intermittently failing
 * (see the three blind SOP checks) — building the guard on it would mean that
 * whenever listing is unwell, the guard fails open and the duplicate backups
 * come straight back, on exactly the days something is already wrong.
 *
 * UNKNOWN IS NOT FALSE. A 404 means "not there" and is a real answer. Anything
 * else — a timeout, a 500, no credentials — returns null, and the caller must
 * treat null as "I do not know" rather than "go ahead". Guessing "no" here
 * would take a broken connection and turn it into a duplicate backup; guessing
 * "yes" would skip a real one.
 */
export async function offsiteObjectExists(key, env = process.env) {
  if (!offsiteConfigured(env)) return null;
  try {
    await offsiteClient(env).send(new HeadObjectCommand({
      Bucket: env.OFFSITE_S3_BUCKET.trim(),
      Key: key,
    }));
    return true;
  } catch (err) {
    const status = err?.$metadata?.httpStatusCode;
    if (status === 404 || err?.name === 'NotFound') return false;
    console.error(`[offsite] could not check whether ${key} exists: ${err.message}`);
    return null;
  }
}

/** Upload an already-encrypted archive to the offsite bucket. */
export async function uploadOffsite(key, body, env = process.env) {
  const prefix = (env.OFFSITE_S3_PREFIX || 'backups/').replace(/^\/+/, '');
  const fullKey = key.startsWith(prefix) ? key : prefix + key.replace(/^backups\//, '');
  await offsiteClient(env).send(new PutObjectCommand({
    Bucket: env.OFFSITE_S3_BUCKET.trim(),
    Key: fullKey,
    Body: body,
    ContentType: 'application/octet-stream',
  }));
  return fullKey;
}

// ─── retention on the SECOND copy ───────────────────────────────────────────
// Discovered 2026-08-18 from the owner's Backblaze screenshot: 1 GB used where
// ~200 MB was expected. Nothing had ever deleted from the offsite bucket. The
// 14-day retention only ran against DigitalOcean Spaces, so the second copy had
// kept every archive since 2 August and would have filled the 10 GB free tier
// around December — at which point offsite uploads would start failing.
//
// This deletes customer backups, so it is built to be boring and provable:
//   · a prefix is REQUIRED and validated — the bucket is never listed bare
//   · every key is re-checked against that prefix immediately before deletion,
//     so a listing bug cannot reach an unrelated object
//   · a hard ceiling per pass; deleting hundreds of archives at once is never
//     something this should do quietly
//   · dry-run is the DEFAULT, and it logs every filename it would remove

/** Most objects one pass may delete. A larger number means something is wrong. */
export const MAX_PRUNE_PER_PASS = 40;

function requirePrefix(prefix) {
  const p = String(prefix || '').replace(/^\/+/, '');
  if (!p || p === '/' || !p.endsWith('/')) {
    throw new Error(`refusing to prune without a directory prefix (got ${JSON.stringify(prefix)})`);
  }
  return p;
}

/** Every object under one prefix, newest first. */
export async function listOffsite(prefix, env = process.env) {
  const p = requirePrefix(prefix);
  const out = await offsiteReader(env).send(new ListObjectsV2Command({
    Bucket: env.OFFSITE_S3_BUCKET.trim(), Prefix: p,
  }));
  return (out.Contents || [])
    .map((o) => ({ key: o.Key, size: o.Size, modified: o.LastModified }))
    .filter((o) => o.key && o.key.startsWith(p))
    .sort((a, b) => new Date(b.modified) - new Date(a.modified));
}

/**
 * Decide what to remove under a prefix. PURE — no I/O, no deletion — so the
 * decision can be tested exhaustively without touching a real bucket.
 */
export function choosePrunable(objects, { prefix, keep }) {
  const p = requirePrefix(prefix);
  if (!Number.isInteger(keep) || keep < 0) throw new Error(`invalid keep: ${keep}`);
  const mine = objects.filter((o) => o.key.startsWith(p));
  const doomed = mine.slice(keep);
  if (doomed.length > MAX_PRUNE_PER_PASS) {
    return { doomed: doomed.slice(0, MAX_PRUNE_PER_PASS), capped: doomed.length };
  }
  return { doomed, capped: 0 };
}

/**
 * Prune the offsite copy. DRY BY DEFAULT: pass { dryRun: false } to delete.
 * Returns what it did (or would do) either way.
 */
export async function pruneOffsite({ prefix, keep, dryRun = true }, env = process.env) {
  const p = requirePrefix(prefix);
  const objects = await listOffsite(p, env);
  const { doomed, capped } = choosePrunable(objects, { prefix: p, keep });

  console.log(`[offsite-prune] ${p} — ${objects.length} object(s), keeping ${keep}, `
    + `${doomed.length} to remove${capped ? ` (capped from ${capped})` : ''}`
    + `${dryRun ? '  [DRY RUN — nothing deleted]' : ''}`);
  // Name every file BEFORE anything is removed, so the log is a record even if
  // the pass dies halfway through.
  for (const o of doomed) {
    console.log(`[offsite-prune] ${dryRun ? 'would delete' : 'DELETING'}: ${o.key} (${o.size} bytes)`);
  }
  if (dryRun) return { dryRun: true, examined: objects.length, deleted: [], wouldDelete: doomed.map((o) => o.key), capped };

  const deleted = [];
  for (const o of doomed) {
    // Belt and braces: re-check the prefix on the exact key being deleted.
    if (!o.key.startsWith(p)) {
      console.error(`[offsite-prune] REFUSED — ${o.key} is outside ${p}`);
      continue;
    }
    await offsiteClient(env).send(new DeleteObjectCommand({
      Bucket: env.OFFSITE_S3_BUCKET.trim(), Key: o.key,
    }));
    deleted.push(o.key);
  }
  console.log(`[offsite-prune] removed ${deleted.length} object(s) under ${p}`);
  return { dryRun: false, examined: objects.length, deleted, wouldDelete: [], capped };
}

// Exported for tests.
export const __testing = { MAGIC, deriveKey, requirePrefix };


/**
 * Prune the PRIMARY copy in DigitalOcean Spaces.
 *
 * ── THE GAP THIS CLOSES, AND WHAT IT DELIBERATELY DOES NOT DO ──────────────
 * pruneOffsite has always covered Backblaze. Nothing has ever covered Spaces,
 * so the primary copy grows without limit and, worse, without anyone able to
 * SEE that it is growing. The two copies have been quietly diverging: offsite
 * trimmed to a retention, primary unbounded.
 *
 * It reuses choosePrunable, so both copies obey one definition of what may be
 * removed — a second, slightly different rule is how the two would drift.
 *
 * DRY BY DEFAULT, like its sibling. The last time backups were pruned, the
 * owner read the list first and the outcome was to WIDEN retention rather than
 * delete: those archives are the only copies reaching back, and storage is not
 * a constraint here. So this ships able to report and unable to delete until
 * someone deliberately says otherwise.
 */
export async function prunePrimary(
  { prefix, keep, dryRun = true, list, remove } = {}, env = process.env) {
  const p = requirePrefix(prefix);
  const objects = await list(p);
  const { doomed, capped } = choosePrunable(objects, { prefix: p, keep });

  console.log(`[primary-prune] ${p} — ${objects.length} object(s), keeping ${keep}, `
    + `${doomed.length} to remove${capped ? ` (capped from ${capped})` : ''}`
    + `${dryRun ? '  [DRY RUN — nothing deleted]' : ''}`);

  // Name every file BEFORE anything goes, so the log is a record even if the
  // pass dies halfway through.
  for (const o of doomed) {
    console.log(`[primary-prune] ${dryRun ? 'would delete' : 'DELETING'}: ${o.key} (${o.size} bytes)`);
  }
  if (dryRun) return { objects: objects.length, doomed, deleted: 0, dryRun: true, capped };

  let deleted = 0;
  for (const o of doomed) {
    // The same refusal the offsite prune carries: never touch a key that fell
    // outside the prefix we were asked to work in.
    if (!o.key.startsWith(p)) {
      console.error(`[primary-prune] REFUSED — ${o.key} is outside ${p}`);
      continue;
    }
    try { await remove(o.key); deleted += 1; }
    catch (e) { console.error(`[primary-prune] could not delete ${o.key}:`, e.message); }
  }
  return { objects: objects.length, doomed, deleted, dryRun: false, capped };
}
