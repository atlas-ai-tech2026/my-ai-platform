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
         DeleteObjectCommand } from '@aws-sdk/client-s3';

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
    const r = await measureBucket(offsiteClient(env), bucket, { ListObjectsV2Command, prefix });
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
    const r = await listAllObjects(offsiteClient(env), env.OFFSITE_S3_BUCKET.trim(), {
      ListObjectsV2Command, prefix: MEDIA_PREFIX,
    });
    return { ...r, bucket: env.OFFSITE_S3_BUCKET.trim() };
  } catch (e) {
    return { error: e.message };
  }
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
export async function writeMediaObject({ key, body, contentLength, contentType }, env = process.env) {
  if (!offsiteConfigured(env)) throw new Error('offsite storage is not configured');
  await offsiteClient(env).send(new PutObjectCommand({
    Bucket: env.OFFSITE_S3_BUCKET.trim(),
    Key: key,
    Body: body,
    ContentLength: contentLength,
    ContentType: contentType || 'application/octet-stream',
  }));
}

let cachedClient = null;
function offsiteClient(env = process.env) {
  if (cachedClient) return cachedClient;
  cachedClient = new S3Client({
    endpoint: env.OFFSITE_S3_ENDPOINT.trim(),
    region: env.OFFSITE_S3_REGION.trim(),
    credentials: {
      accessKeyId: env.OFFSITE_S3_KEY.trim(),
      secretAccessKey: env.OFFSITE_S3_SECRET.trim(),
    },
    forcePathStyle: true, // widest compatibility (B2, R2, MinIO…)
    // SDK ≥3.729 defaults to flexible checksums (aws-chunked bodies with
    // trailing CRC), which some S3-compatible providers reject. B2 accepts
    // them today (verified 2026-08-02), but plain signed bodies are the
    // compatibility-safe choice. NB: with a WRONG applicationKey, B2 fails
    // PUTs with the misleading "The request body was too small" instead of
    // SignatureDoesNotMatch — check credentials before blaming the body.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
  return cachedClient;
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
  const out = await offsiteClient(env).send(new ListObjectsV2Command({
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
