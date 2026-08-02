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
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

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
    // SDK ≥3.729 sends aws-chunked bodies with trailing CRC checksums by
    // default; B2 rejects them with "The request body was too small".
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

// Exported for tests.
export const __testing = { MAGIC, deriveKey };
