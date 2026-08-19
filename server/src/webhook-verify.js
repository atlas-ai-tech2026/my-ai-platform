// ─── webhook-verify.js ───────────────────────────────────────────────────────
// Proving a provider callback really came from the provider.
//
// ── WHY THIS IS THE FIRST THING BUILT ──────────────────────────────────────
// A webhook endpoint cannot carry a login. The provider has no session, so the
// URL is open to the internet by definition — and what it does is decide
// whether a customer gets refunded.
//
// Two ways an unverified endpoint loses real money:
//   · POST "job X succeeded" for a job that failed → the refund never happens,
//     and the customer silently keeps the charge for a video they never got.
//   · POST "job X failed" for a job that succeeded → we refund a delivered
//     video. Repeat at will.
//
// So verification is not hardening added later. It is the feature.
//
// ── THE RULE WHEN A SECRET IS MISSING ──────────────────────────────────────
// If we cannot verify, we REJECT. Never "no signature configured, so accept
// everything" — that is the shape of every authentication bypass ever written,
// and it fails open exactly when someone has misconfigured production. The
// endpoint stays inert until its secret exists, the same way the origin guard
// does.
//
// Sources, read on 2026-08-19 rather than remembered:
//   fal — ED25519, JWKS at rest.fal.ai/.well-known/jwks.json, message is
//         requestId\nuserId\ntimestamp\nsha256hex(body), ±5 min skew
//   kie — HMAC-SHA256 base64, message is `taskId.timestamp`, secret from the
//         kie.ai settings page

import crypto from 'node:crypto';

export const FAL_JWKS_URL = 'https://rest.fal.ai/.well-known/jwks.json';

/** Replay window. fal documents ±5 minutes; kie is held to the same bar. */
export const MAX_SKEW_SECONDS = 300;

/** fal asks that the JWKS is cached, but never for longer than a day. */
export const JWKS_MAX_AGE_MS = 12 * 60 * 60 * 1000;

const fail = (reason) => ({ ok: false, reason });
const pass = () => ({ ok: true, reason: null });

/**
 * Is this timestamp close enough to now?
 *
 * Without it a signature captured once is valid forever, and a single logged
 * callback could be replayed to refund the same job repeatedly.
 */
export function withinSkew(timestamp, now = Date.now(), maxSkew = MAX_SKEW_SECONDS) {
  const t = Number(timestamp);
  if (!Number.isFinite(t)) return false;
  return Math.abs(Math.floor(now / 1000) - t) <= maxSkew;
}

/** Constant-time compare that cannot throw on a length mismatch. */
export function safeEqual(a, b) {
  const A = Buffer.from(String(a ?? ''), 'utf8');
  const B = Buffer.from(String(b ?? ''), 'utf8');
  // Different lengths already means "not equal"; comparing anyway keeps the
  // work constant so the answer cannot be timed out of us.
  if (A.length !== B.length) {
    crypto.timingSafeEqual(A, A);
    return false;
  }
  return crypto.timingSafeEqual(A, B);
}

// ── fal ─────────────────────────────────────────────────────────────────────

/** Rebuild an ED25519 public key from a JWKS entry's `x`. Never throws. */
export function keyFromJwk(jwk) {
  try {
    if (!jwk?.x) return null;
    return crypto.createPublicKey({
      key: { kty: 'OKP', crv: 'Ed25519', x: jwk.x }, format: 'jwk',
    });
  } catch { return null; }
}

/**
 * The exact bytes fal signs: four values, newline separated, the last being
 * the SHA-256 of the RAW body.
 *
 * Raw, not re-serialised. `JSON.parse` then `JSON.stringify` reorders keys and
 * drops whitespace, and the hash of that is not the hash fal signed — the
 * verification would fail for every genuine callback, which is the kind of bug
 * that gets "fixed" by turning verification off.
 */
export function falSignedMessage({ requestId, userId, timestamp, rawBody }) {
  const digest = crypto.createHash('sha256')
    .update(Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody ?? ''), 'utf8'))
    .digest('hex');
  return Buffer.from([requestId, userId, timestamp, digest].join('\n'), 'utf8');
}

/**
 * Verify a fal webhook against the keys from their JWKS.
 *
 * Any one key validating is enough — fal rotates, so several may be live at
 * once.
 */
export function verifyFal({ headers = {}, rawBody, keys = [], now = Date.now() }) {
  const h = (n) => headers[n] ?? headers[n.toLowerCase()];
  const requestId = h('X-Fal-Webhook-Request-Id');
  const userId = h('X-Fal-Webhook-User-Id');
  const timestamp = h('X-Fal-Webhook-Timestamp');
  const signature = h('X-Fal-Webhook-Signature');

  if (!requestId || !userId || !timestamp || !signature) return fail('missing-headers');
  if (!withinSkew(timestamp, now)) return fail('stale-timestamp');
  if (!keys.length) return fail('no-keys');

  let sig;
  try {
    sig = Buffer.from(String(signature), 'hex');
    if (!sig.length) return fail('bad-signature-encoding');
  } catch { return fail('bad-signature-encoding'); }

  const msg = falSignedMessage({ requestId, userId, timestamp, rawBody });
  for (const jwk of keys) {
    const key = keyFromJwk(jwk);
    if (!key) continue;
    try {
      if (crypto.verify(null, msg, key, sig)) return pass();
    } catch { /* try the next key */ }
  }
  return fail('signature-mismatch');
}

// ── kie ─────────────────────────────────────────────────────────────────────

/** kie signs `taskId.timestamp` with HMAC-SHA256, base64. */
export function kieSignature(taskId, timestamp, secret) {
  return crypto.createHmac('sha256', String(secret))
    .update(`${taskId}.${timestamp}`)
    .digest('base64');
}

export function verifyKie({ headers = {}, taskId, secret, now = Date.now() }) {
  const h = (n) => headers[n] ?? headers[n.toLowerCase()];
  const timestamp = h('X-Webhook-Timestamp');
  const signature = h('X-Webhook-Signature');

  // No secret means we CANNOT verify. Rejecting is the only safe answer — an
  // endpoint that accepts everything when unconfigured is worse than one that
  // does not exist, because it looks like it is protecting something.
  if (!secret) return fail('not-configured');
  if (!timestamp || !signature) return fail('missing-headers');
  if (!taskId) return fail('missing-task-id');
  if (!withinSkew(timestamp, now)) return fail('stale-timestamp');

  return safeEqual(signature, kieSignature(taskId, timestamp, secret))
    ? pass() : fail('signature-mismatch');
}

// ── the JWKS, fetched and cached ────────────────────────────────────────────

let jwksCache = { keys: [], fetchedAt: 0 };

/** Exposed so tests start from a known state. */
export function resetJwksCache() { jwksCache = { keys: [], fetchedAt: 0 }; }

/**
 * fal's public keys, cached.
 *
 * On a fetch failure the LAST GOOD keys are kept and reused rather than
 * returning none: a momentary DNS blip must not turn every genuine callback
 * into a rejection, which would look exactly like an attack and would stop
 * refunds happening. If there are no keys at all, callers reject — never
 * accept.
 */
export async function falKeys({ now = Date.now(), fetchImpl = fetch } = {}) {
  if (jwksCache.keys.length && now - jwksCache.fetchedAt < JWKS_MAX_AGE_MS) {
    return jwksCache.keys;
  }
  try {
    const res = await fetchImpl(FAL_JWKS_URL, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`jwks ${res.status}`);
    const body = await res.json();
    const keys = Array.isArray(body?.keys) ? body.keys.filter((k) => k?.x) : [];
    if (!keys.length) throw new Error('jwks had no usable keys');
    jwksCache = { keys, fetchedAt: now };
    return keys;
  } catch (e) {
    console.error(`[webhook] could not refresh fal signing keys: ${e.message}`
      + (jwksCache.keys.length ? ' — reusing the last good set' : ' — NO keys available, callbacks will be rejected'));
    return jwksCache.keys;
  }
}
