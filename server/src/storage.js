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
         GetObjectCommand } from '@aws-sdk/client-s3';

const ENDPOINT = (process.env.SPACES_ENDPOINT || '').trim();
const REGION = (process.env.SPACES_REGION || '').trim();
const BUCKET = (process.env.SPACES_BUCKET || '').trim();
const KEY = (process.env.SPACES_KEY || '').trim();
const SECRET = (process.env.SPACES_SECRET || '').trim();
const CDN_BASE = (process.env.SPACES_CDN_BASE || '').trim().replace(/\/+$/, '');

const configured = Boolean(ENDPOINT && REGION && BUCKET && KEY && SECRET);

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
  console.log(`[storage] DO Spaces configured → bucket=${BUCKET} region=${REGION}`);
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

export async function listKeys(prefix) {
  if (!configured) throw new Error('Spaces not configured');
  const out = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, MaxKeys: 1000 }));
  return (out.Contents || []).map(o => ({ key: o.Key, size: o.Size, modified: o.LastModified }));
}

export async function deleteKey(key) {
  if (!configured) throw new Error('Spaces not configured');
  await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
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
