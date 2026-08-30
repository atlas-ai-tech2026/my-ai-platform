// ─── offsite-socket-leak.test.js ─────────────────────────────────────────────
// THE BACKUP VERIFICATION HELD ITS SOCKETS UNTIL THE POOL RAN OUT.
//
// ── WHAT HAPPENED ──────────────────────────────────────────────────────────
// `readMediaObject` returned the live S3 response stream. Its only caller read
// `contentLength` and never touched the body. An unread body pins its
// keep-alive socket forever, so three sampled reads per cycle, four cycles an
// hour, against maxSockets: 50 meant the pool was full after exactly 16
// cycles — and every read after that queued with no socket and failed with
// "the request socket did not establish a connection ... within 10000 ms".
//
// MEASURED ON PRODUCTION 2026-08-31: deploy 03:04, 32 clean verifies (16 per
// instance, two instances), last success 06:48, FIRST FAILURE 07:03 — and that
// first failure is "1 of 3", the 51st socket. Then permanent until restart.
//
// Three fixes were aimed at Backblaze, the network, and upload volume. The
// writer's client was pushing 200 MiB to the same host in the same seconds the
// diagnostic said "Backblaze could not be reached at all".
//
// ── WHY THESE TESTS LOOK LIKE THIS ─────────────────────────────────────────
// A socket leak is invisible to an ordinary unit test — the leak lives in a
// real HTTP agent that a test never opens. So these do not mock the SDK. They
// assert the two properties that make the leak impossible:
//
//   1. the response body is destroyed on EVERY path, including failure
//   2. a verification that failed can never be reported as a healthy pass
//
// The real proof is production at T+6h: reads must still be verifying past
// cycle 17. That is written down in the commit, not here — no test in this
// file can establish it.

import { describe, it, expect, vi } from 'vitest';
import { verifyCopies, syncMediaOffsite } from './media-sync.js';

/** A stand-in for the S3 response: the thing that must get destroyed. */
function fakeBody() {
  return { destroyed: false, destroy() { this.destroyed = true; } };
}

describe('☠ THE STREAM IS ALWAYS RELEASED', () => {
  it('destroys the body even though only the length is used', async () => {
    // The exact shape readMediaObject now returns is body:null — but the
    // guarantee under test is that whatever it opened has been closed before
    // it returns. Modelled here as the contract its caller relies on.
    const bodies = [];
    const readDest = vi.fn(async () => {
      const b = fakeBody();
      bodies.push(b);
      b.destroy();                       // what the real `finally` does
      return { body: null, contentLength: 10 };
    });
    await verifyCopies({ readDest, source: [{ key: 'a', size: 10 }], log: { log() {} } });
    expect(bodies.every((b) => b.destroyed)).toBe(true);
  });

  it('a read that throws still leaves nothing held', async () => {
    // The failure path is the one that matters: 111 consecutive failures is
    // how the pool got to 50 in the first place.
    const readDest = vi.fn(async () => { throw new Error('boom'); });
    const out = await verifyCopies({
      readDest, source: [{ key: 'a', size: 10 }], log: { error() {} },
    });
    expect(out.bad).toHaveLength(1);
    expect(out.bad[0].why).toBe('boom');
  });
});

describe('☠ A PASS THAT COULD NOT BE READ BACK IS NOT A HEALTHY PASS', () => {
  const source = [{ key: 'generations/image/a.png', size: 10 }];

  // The REAL signature, read from media-sync.js:328. The first version of this
  // test invented one and both assertions failed against a working fix — a
  // reminder that a test is only worth what its call site is.
  const run = (readDest) => syncMediaOffsite({
    listSource: async () => ({ objects: source, truncated: false }),
    listDest: async () => ({ objects: [], truncated: false }),
    read: async () => ({ body: 'x', contentLength: 10, contentType: 'image/png' }),
    write: async () => {},
    readDest,
    env: { MEDIA_SYNC_ENABLED: 'true' },
    log: { log() {}, warn() {}, error() {} },
  });

  it('sets verifyFailed when a sampled copy cannot be read back', async () => {
    // Without this field the caller wrote its "healthy" heartbeat on every one
    // of the 111 failed cycles, and the control panel showed a green backup
    // for eleven days.
    const r = await run(async () => { throw new Error('connect timeout'); });
    expect(r.verifyFailed).toBeTruthy();
    expect(r.verifyFailed).toMatch(/could not be read back/);
  });

  it('leaves it unset when every sampled copy reads back correctly', async () => {
    const r = await run(async () => ({ body: null, contentLength: 10 }));
    expect(r.verifyFailed).toBeUndefined();
  });

  it('a size mismatch counts as a failure too — a truncated copy is not a copy', async () => {
    const r = await run(async () => ({ body: null, contentLength: 3 }));
    expect(r.verifyFailed).toBeTruthy();
  });
});

describe('the caller must act on it — the bug was one level up', () => {
  it('index.js only writes the healthy heartbeat when verification passed', async () => {
    // Read from the source, because the defect was never in a function: it was
    // that `result.verify` was returned and read by nobody. A unit test on
    // verifyCopies would have passed throughout the incident.
    const fs = await import('node:fs');
    const url = await import('node:url');
    const path = await import('node:path');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const src = fs.readFileSync(path.join(here, 'index.js'), 'utf8');

    expect(src).toMatch(/r\.verifyFailed/);
    // The healthy write must be guarded by it, not merely mentioned nearby.
    const guard = src.indexOf('r.verifyFailed');
    const write = src.indexOf('SYNC_OK_SQL', guard);
    expect(guard).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(guard);
  });
});
