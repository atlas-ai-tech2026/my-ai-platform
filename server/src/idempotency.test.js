// ─── idempotency.test.js ─────────────────────────────────────────────────────
// Duplicate-charge protection has two ways of going wrong, and the second is
// worse than the problem it solves.
//
//   1. It fails to stop a double charge — the bug it exists for.
//   2. It stops a LEGITIMATE request. Refusing someone's generation because a
//      guard misfired, or because a failed attempt left a key stuck, turns a
//      rare double charge into a customer who cannot use what they paid for.
//
// So most of what follows is about (2): failing open when the guard itself is
// broken, freeing the key when a request fails, and keeping the window short
// enough that asking twice for the same prompt still works.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
import {
  fingerprint, stableStringify, explicitKey, claim, complete, release,
  idempotencyGuard, DERIVED_WINDOW_S, EXPLICIT_WINDOW_S,
} from './idempotency.js';

const fakePool = (impl) => ({ query: vi.fn(impl) });
const req = (over = {}) => ({
  user: { id: 7 }, path: '/api/generate', body: { type: 'image', prompt: 'a cat' },
  get: () => null, ...over,
});
const res = () => {
  const r = { statusCode: 200, headers: {}, body: undefined, listeners: {} };
  r.set = (k, v) => { r.headers[k] = v; return r; };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = vi.fn((b) => { r.body = b; return r; });
  r.on = (ev, fn) => { r.listeners[ev] = fn; };
  return r;
};

describe('recognising the same request twice', () => {
  it('gives identical requests the same key', () => {
    expect(fingerprint(7, '/api/generate', { a: 1, b: 2 }))
      .toBe(fingerprint(7, '/api/generate', { a: 1, b: 2 }));
  });

  // Otherwise a client that serialises JSON in a different order defeats the
  // whole mechanism, silently.
  it('is not fooled by property order', () => {
    expect(fingerprint(7, '/api/generate', { a: 1, b: 2 }))
      .toBe(fingerprint(7, '/api/generate', { b: 2, a: 1 }));
    expect(stableStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('separates different people, endpoints and prompts', () => {
    const base = fingerprint(7, '/api/generate', { p: 'cat' });
    expect(fingerprint(8, '/api/generate', { p: 'cat' })).not.toBe(base);
    expect(fingerprint(7, '/api/generate-video', { p: 'cat' })).not.toBe(base);
    expect(fingerprint(7, '/api/generate', { p: 'dog' })).not.toBe(base);
  });

  it('handles a missing body without throwing', () => {
    expect(() => fingerprint(7, '/api/generate', undefined)).not.toThrow();
  });
});

describe('a client-supplied key', () => {
  const withHeader = (v) => req({ get: (h) => (h === 'idempotency-key' ? v : null) });

  it('is used when the client sends a sensible one', () => {
    expect(explicitKey(withHeader('abc-123-def-456'))).toBe('c_abc-123-def-456');
  });

  // This value becomes a PRIMARY KEY. An unbounded header string should never
  // reach the database.
  it('refuses anything unbounded or odd, rather than storing it', () => {
    for (const bad of ['', 'short', 'x'.repeat(300), 'has spaces', "drop';--", null]) {
      expect(explicitKey(withHeader(bad))).toBeNull();
    }
  });

  it('is honoured far longer than a derived one', () => {
    expect(EXPLICIT_WINDOW_S).toBeGreaterThan(DERIVED_WINDOW_S * 100);
  });
});

describe('the window is short on purpose', () => {
  // Models are stochastic. Asking twice for the same prompt is a reasonable
  // thing to want, and a long window would refuse it — a worse failure than
  // the double charge being prevented.
  it('is seconds, not minutes', () => {
    expect(DERIVED_WINDOW_S).toBeLessThanOrEqual(15);
    expect(DERIVED_WINDOW_S).toBeGreaterThanOrEqual(5);
  });

  it('lets a key be reused once the window has passed', async () => {
    const old = new Date(Date.now() - (DERIVED_WINDOW_S + 5) * 1000);
    const pool = fakePool(async (sql) => (/INSERT INTO request_idempotency/.test(sql)
      ? { rows: [{ state: 'done', status_code: 200, response: { ok: 1 }, created_at: old, is_new: false }] }
      : { rows: [] }));
    const out = await claim(pool, { key: 'k', userId: 7, path: '/p', windowSeconds: DERIVED_WINDOW_S });
    expect(out.state).toBe('fresh');
  });
});

describe('claiming the right to charge', () => {
  it('lets the first request through', async () => {
    const pool = fakePool(async () => ({ rows: [{ is_new: true, state: 'in_flight' }] }));
    expect((await claim(pool, { key: 'k', userId: 7, path: '/p', windowSeconds: 10 })).state)
      .toBe('fresh');
  });

  it('replays the first answer to a duplicate instead of charging again', async () => {
    const pool = fakePool(async () => ({ rows: [{
      is_new: false, state: 'done', status_code: 200,
      response: { success: true, result_url: 'x' }, created_at: new Date() }] }));
    const out = await claim(pool, { key: 'k', userId: 7, path: '/p', windowSeconds: 10 });
    expect(out.state).toBe('duplicate');
    expect(out.response.result_url).toBe('x');
  });

  // Two clicks a few hundred milliseconds apart: the second must NOT be
  // allowed to charge while the first is still running.
  it('refuses a second attempt while the first is still running', async () => {
    const pool = fakePool(async () => ({ rows: [{
      is_new: false, state: 'in_flight', created_at: new Date() }] }));
    expect((await claim(pool, { key: 'k', userId: 7, path: '/p', windowSeconds: 10 })).state)
      .toBe('in_flight');
  });
});

describe('never locking a customer out', () => {
  beforeEach(() => vi.restoreAllMocks());

  // The failure that would be worse than the bug. A broken guard must not
  // stop people generating.
  it('lets the request through when the guard itself cannot run', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const pool = fakePool(async () => { throw new Error('table is gone'); });
    const next = vi.fn();
    await idempotencyGuard({ pool, dbReady: () => true })(req(), res(), next);
    expect(next).toHaveBeenCalled();
  });

  it('does nothing when there is no database or no signed-in user', async () => {
    const pool = fakePool(async () => ({ rows: [] }));
    const n1 = vi.fn();
    await idempotencyGuard({ pool, dbReady: () => false })(req(), res(), n1);
    expect(n1).toHaveBeenCalled();
    expect(pool.query).not.toHaveBeenCalled();

    const n2 = vi.fn();
    await idempotencyGuard({ pool, dbReady: () => true })(req({ user: null }), res(), n2);
    expect(n2).toHaveBeenCalled();
  });

  // If a failed request kept its claim, the customer would be told "already
  // processing" for the whole window on something that produced nothing.
  it('frees the key when the request FAILS, so it can be retried', async () => {
    const calls = [];
    const pool = fakePool(async (sql, args) => {
      calls.push({ sql, args });
      if (/INSERT INTO request_idempotency/.test(sql)) return { rows: [{ is_new: true }] };
      return { rows: [], rowCount: 1 };
    });
    const r = res();
    await idempotencyGuard({ pool, dbReady: () => true })(req(), r, vi.fn());
    r.statusCode = 500;
    r.json({ error: 'generation failed' });
    await new Promise((done) => setTimeout(done, 0));
    expect(calls.some((c) => /DELETE FROM request_idempotency/.test(c.sql))).toBe(true);
  });

  it('frees the key when the connection drops mid-request', async () => {
    const calls = [];
    const pool = fakePool(async (sql) => {
      calls.push(sql);
      if (/INSERT INTO request_idempotency/.test(sql)) return { rows: [{ is_new: true }] };
      return { rows: [], rowCount: 1 };
    });
    const r = res();
    await idempotencyGuard({ pool, dbReady: () => true })(req(), r, vi.fn());
    r.listeners.close();
    await new Promise((done) => setTimeout(done, 0));
    expect(calls.some((s) => /DELETE FROM request_idempotency/.test(s))).toBe(true);
  });

  it('records the answer when the request SUCCEEDS', async () => {
    const calls = [];
    const pool = fakePool(async (sql) => {
      calls.push(sql);
      if (/INSERT INTO request_idempotency/.test(sql)) return { rows: [{ is_new: true }] };
      return { rows: [], rowCount: 1 };
    });
    const r = res();
    await idempotencyGuard({ pool, dbReady: () => true })(req(), r, vi.fn());
    r.json({ success: true });
    await new Promise((done) => setTimeout(done, 0));
    expect(calls.some((s) => /SET state = 'done'/.test(s))).toBe(true);
  });
});

describe('what a duplicate actually receives', () => {
  it('gets the original result, not an error — the customer sees no difference', async () => {
    const pool = fakePool(async () => ({ rows: [{
      is_new: false, state: 'done', status_code: 200,
      response: { success: true, result_url: 'https://x/y.png' }, created_at: new Date() }] }));
    const r = res();
    const next = vi.fn();
    await idempotencyGuard({ pool, dbReady: () => true })(req(), r, next);
    expect(next).not.toHaveBeenCalled();
    expect(r.body.result_url).toBe('https://x/y.png');
    expect(r.headers['Idempotent-Replay']).toBe('true');
  });

  it('tells a still-in-flight duplicate to wait, rather than charging it', async () => {
    const pool = fakePool(async () => ({ rows: [{
      is_new: false, state: 'in_flight', created_at: new Date() }] }));
    const r = res();
    const next = vi.fn();
    await idempotencyGuard({ pool, dbReady: () => true })(req(), r, next);
    expect(next).not.toHaveBeenCalled();
    expect(r.statusCode).toBe(409);
    expect(r.body.duplicate).toBe(true);
  });
});

describe('housekeeping', () => {
  it('completes and releases without throwing when the database misbehaves', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const pool = fakePool(async () => { throw new Error('nope'); });
    await expect(complete(pool, 'k', 200, {})).resolves.toBeUndefined();
    await expect(release(pool, 'k')).resolves.toBeUndefined();
  });
});

// ─── wiring, checked statically ──────────────────────────────────────────────
// The bug this section exists for: `noDoubleCharge` was first defined AFTER
// the routes that use it. `app.post(...)` evaluates its arguments at module
// load, and a `const` is in the temporal dead zone until its initialiser runs
// — so the server crashed at BOOT, not at request time. `node --check` passes
// on it happily, because it is not a syntax error.
describe('the guard is wired where it can actually run', () => {
  const source = readFileSync(path.join(here, 'index.js'), 'utf8');

  it('is defined BEFORE the first route that uses it', () => {
    const defined = source.indexOf('const noDoubleCharge = idempotencyGuard(');
    const firstUse = source.indexOf('noDoubleCharge,');
    expect(defined).toBeGreaterThan(-1);
    expect(firstUse).toBeGreaterThan(-1);
    expect(defined, 'noDoubleCharge is used before it is defined — the server will not boot')
      .toBeLessThan(firstUse);
  });

  // Every route that takes credits, and nothing that does not.
  it('guards every charging route', () => {
    const CHARGING = ['/api/generate', '/api/generate-video', '/api/generate-video-ref',
      '/api/generate-music', '/api/edit-video-omni', '/api/node/run-node',
      '/api/node/run-node-async'];
    for (const route of CHARGING) {
      const re = new RegExp(`app\\.post\\('${route.replace(/\//g, '\\/')}',[^)]*?noDoubleCharge`);
      expect(re.test(source), `${route} charges but is not guarded`).toBe(true);
    }
  });

  // Guarding a read would refuse a customer polling for their own video.
  it('does NOT guard routes that only read', () => {
    for (const route of ['/api/video-status', '/api/checkStatus']) {
      const m = source.match(new RegExp(`app\\.post\\('${route.replace(/\//g, '\\/')}',[^)]*`));
      if (m) expect(m[0]).not.toMatch(/noDoubleCharge/);
    }
  });

  it('runs after auth, so it always has a user to key on', () => {
    const m = source.match(/app\.post\('\/api\/generate',([^)]*)/);
    expect(m[1].indexOf('requireNotBanned')).toBeLessThan(m[1].indexOf('noDoubleCharge'));
  });
});
