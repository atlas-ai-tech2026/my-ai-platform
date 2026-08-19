// ─── webhook-verify.test.js ──────────────────────────────────────────────────
// This is the code that decides whether a customer gets their money back, on an
// endpoint that by definition cannot carry a login. So the tests that matter
// are the attack cases, not the happy path.
//
// Two ways a forged callback takes real money:
//   · "job X succeeded" for a job that failed → no refund ever happens, and the
//     customer keeps a charge for a video they never received
//   · "job X failed" for a job that succeeded → we refund a delivered video,
//     repeatable at will
//
// The single most important test in this file is that a MISSING SECRET rejects.
// "Not configured, so accept everything" is the shape of every authentication
// bypass ever written, and it fails open exactly when production is misconfigured.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import crypto from 'node:crypto';
import {
  verifyFal, verifyKie, kieSignature, falSignedMessage, keyFromJwk, safeEqual,
  withinSkew, falKeys, resetJwksCache, MAX_SKEW_SECONDS, FAL_JWKS_URL,
} from './webhook-verify.js';

// A stand-in for fal: an ed25519 pair whose public half is published as JWKS.
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const JWK = publicKey.export({ format: 'jwk' });
const NOW = 1_755_600_000_000;              // fixed, so nothing depends on the clock
const TS = String(Math.floor(NOW / 1000));

function falCallback({ body = '{"request_id":"r1","status":"OK"}', requestId = 'r1',
  userId = 'u1', timestamp = TS, signWith = privateKey } = {}) {
  const msg = falSignedMessage({ requestId, userId, timestamp, rawBody: body });
  return {
    rawBody: body,
    headers: {
      'X-Fal-Webhook-Request-Id': requestId,
      'X-Fal-Webhook-User-Id': userId,
      'X-Fal-Webhook-Timestamp': timestamp,
      'X-Fal-Webhook-Signature': crypto.sign(null, msg, signWith).toString('hex'),
    },
  };
}

describe('fal — a genuine callback', () => {
  it('accepts one signed by the key in the JWKS', () => {
    const c = falCallback();
    expect(verifyFal({ ...c, keys: [JWK], now: NOW })).toMatchObject({ ok: true });
  });

  it('accepts when several keys are live and only one matches', () => {
    const other = crypto.generateKeyPairSync('ed25519').publicKey.export({ format: 'jwk' });
    const c = falCallback();
    expect(verifyFal({ ...c, keys: [other, JWK], now: NOW }).ok).toBe(true);
  });

  // The body is hashed RAW. Re-serialising reorders keys and drops whitespace,
  // and the hash of that is not what fal signed — every genuine callback would
  // fail, which is the kind of bug that gets "fixed" by disabling verification.
  it('is computed over the raw bytes, not a re-serialised object', () => {
    // Whitespace, not key order — my first attempt at this test used reordered
    // keys and passed for the wrong reason, because JSON.stringify preserves
    // insertion order and the round-trip was byte-identical. Providers do
    // vary their spacing, and Express hands us a parsed object by default, so
    // this is the realistic way to get it wrong.
    const body = '{ "request_id": "r1",  "status": "OK" }';
    const c = falCallback({ body });
    expect(verifyFal({ ...c, keys: [JWK], now: NOW }).ok).toBe(true);

    const reserialised = JSON.stringify(JSON.parse(body));   // spacing gone
    expect(reserialised).not.toBe(body);
    expect(verifyFal({ ...c, rawBody: reserialised, keys: [JWK], now: NOW }).ok,
      'verification passed against a re-serialised body — the raw bytes are not being kept'
    ).toBe(false);
  });
});

describe('fal — the attacks', () => {
  it('rejects a body altered after signing', () => {
    const c = falCallback();
    const tampered = { ...c, rawBody: '{"request_id":"r1","status":"ERROR"}' };
    expect(verifyFal({ ...tampered, keys: [JWK], now: NOW }))
      .toMatchObject({ ok: false, reason: 'signature-mismatch' });
  });

  it('rejects a signature from a key nobody published', () => {
    const attacker = crypto.generateKeyPairSync('ed25519').privateKey;
    const c = falCallback({ signWith: attacker });
    expect(verifyFal({ ...c, keys: [JWK], now: NOW }).ok).toBe(false);
  });

  // Without a skew window a single captured callback is valid forever, and can
  // be replayed to refund the same job again and again.
  it('rejects a replay of an old but perfectly valid callback', () => {
    const c = falCallback();
    const later = NOW + (MAX_SKEW_SECONDS + 60) * 1000;
    expect(verifyFal({ ...c, keys: [JWK], now: later }))
      .toMatchObject({ ok: false, reason: 'stale-timestamp' });
  });

  it('rejects a timestamp from the future', () => {
    const c = falCallback({ timestamp: String(Math.floor(NOW / 1000) + 3600) });
    expect(verifyFal({ ...c, keys: [JWK], now: NOW }).ok).toBe(false);
  });

  it.each(['X-Fal-Webhook-Request-Id', 'X-Fal-Webhook-User-Id',
    'X-Fal-Webhook-Timestamp', 'X-Fal-Webhook-Signature'])(
    'rejects when %s is absent', (missing) => {
      const c = falCallback();
      delete c.headers[missing];
      expect(verifyFal({ ...c, keys: [JWK], now: NOW }))
        .toMatchObject({ ok: false, reason: 'missing-headers' });
    });

  // If the keys could not be fetched we know nothing. Rejecting stops refunds
  // for a while; accepting hands the refund button to the internet.
  it('rejects everything when no keys are available', () => {
    const c = falCallback();
    expect(verifyFal({ ...c, keys: [], now: NOW }))
      .toMatchObject({ ok: false, reason: 'no-keys' });
  });

  it('rejects a signature that is not hex, without throwing', () => {
    const c = falCallback();
    c.headers['X-Fal-Webhook-Signature'] = 'not-hex!!';
    expect(() => verifyFal({ ...c, keys: [JWK], now: NOW })).not.toThrow();
    expect(verifyFal({ ...c, keys: [JWK], now: NOW }).ok).toBe(false);
  });

  it('survives a malformed key in the JWKS instead of crashing', () => {
    const c = falCallback();
    expect(verifyFal({ ...c, keys: [{ x: 'nonsense' }, JWK], now: NOW }).ok).toBe(true);
    expect(keyFromJwk({ x: 'nonsense' })).toBeNull();
    expect(keyFromJwk({})).toBeNull();
  });
});

describe('kie', () => {
  const SECRET = 'kie-webhook-secret-value';
  const good = (taskId = 'task-1', timestamp = TS, secret = SECRET) => ({
    headers: {
      'X-Webhook-Timestamp': timestamp,
      'X-Webhook-Signature': kieSignature(taskId, timestamp, secret),
    },
    taskId, secret, now: NOW,
  });

  it('accepts a callback signed with our secret', () => {
    expect(verifyKie(good())).toMatchObject({ ok: true });
  });

  // THE ONE THAT MATTERS MOST. An endpoint that accepts everything when
  // unconfigured is worse than one that does not exist — it looks like it is
  // protecting something.
  it('REJECTS when no secret is configured, rather than accepting', () => {
    const c = good();
    expect(verifyKie({ ...c, secret: undefined }))
      .toMatchObject({ ok: false, reason: 'not-configured' });
    expect(verifyKie({ ...c, secret: '' }).ok).toBe(false);
  });

  it('rejects a signature made with a different secret', () => {
    const c = good();
    c.headers['X-Webhook-Signature'] = kieSignature('task-1', TS, 'wrong-secret');
    expect(verifyKie(c)).toMatchObject({ ok: false, reason: 'signature-mismatch' });
  });

  // The signature covers the task id, so pointing a valid signature at someone
  // else's job must not work.
  it('rejects a valid signature replayed against a different job', () => {
    const c = good('task-1');
    expect(verifyKie({ ...c, taskId: 'task-2' }).ok).toBe(false);
  });

  it('rejects a stale callback', () => {
    expect(verifyKie({ ...good(), now: NOW + (MAX_SKEW_SECONDS + 60) * 1000 }))
      .toMatchObject({ ok: false, reason: 'stale-timestamp' });
  });

  it('rejects when the signature header is missing entirely', () => {
    const c = good();
    delete c.headers['X-Webhook-Signature'];
    expect(verifyKie(c)).toMatchObject({ ok: false, reason: 'missing-headers' });
  });

  it('reads headers whatever case they arrive in', () => {
    const c = good();
    const lower = { 'x-webhook-timestamp': TS, 'x-webhook-signature': c.headers['X-Webhook-Signature'] };
    expect(verifyKie({ ...c, headers: lower }).ok).toBe(true);
  });
});

describe('the comparison itself', () => {
  it('does not throw when the lengths differ', () => {
    expect(() => safeEqual('short', 'a-much-longer-value')).not.toThrow();
    expect(safeEqual('short', 'a-much-longer-value')).toBe(false);
  });

  it('handles null and undefined without throwing', () => {
    for (const v of [null, undefined, 0]) expect(() => safeEqual(v, 'x')).not.toThrow();
  });

  it('still returns true for genuinely equal values', () => {
    expect(safeEqual('abc123', 'abc123')).toBe(true);
  });

  it('treats a non-numeric timestamp as stale', () => {
    expect(withinSkew('not-a-number', NOW)).toBe(false);
    expect(withinSkew(undefined, NOW)).toBe(false);
  });
});

describe('fetching fal’s signing keys', () => {
  beforeEach(() => resetJwksCache());

  it('fetches and caches, rather than asking on every callback', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ keys: [JWK] }) });
    expect(await falKeys({ now: NOW, fetchImpl })).toHaveLength(1);
    await falKeys({ now: NOW + 1000, fetchImpl });
    expect(fetchImpl, 'the JWKS was refetched for a callback moments later').toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe(FAL_JWKS_URL);
  });

  // A momentary DNS blip must not turn every genuine callback into a rejection
  // — that looks identical to an attack and stops refunds happening.
  it('keeps the last good keys when a refresh fails', async () => {
    const ok = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ keys: [JWK] }) });
    await falKeys({ now: NOW, fetchImpl: ok });
    const broken = vi.fn().mockRejectedValue(new Error('network down'));
    const later = NOW + 24 * 60 * 60 * 1000;
    expect(await falKeys({ now: later, fetchImpl: broken })).toHaveLength(1);
  });

  // …but with nothing cached it returns none, and verifyFal then rejects.
  it('returns nothing when it has never succeeded, so callbacks are rejected', async () => {
    const broken = vi.fn().mockRejectedValue(new Error('network down'));
    expect(await falKeys({ now: NOW, fetchImpl: broken })).toEqual([]);
    expect(verifyFal({ ...falCallback(), keys: [], now: NOW }).ok).toBe(false);
  });

  it('treats an empty key set as a failure, not as success', async () => {
    const empty = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ keys: [] }) });
    expect(await falKeys({ now: NOW, fetchImpl: empty })).toEqual([]);
  });
});
