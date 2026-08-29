// ─── media-sync.test.js ──────────────────────────────────────────────────────
// 66.1 GiB across 11,320 customer files has existed in exactly one place since
// this platform started. This is the job that changes that.
//
// The tests worth having are about the awkward cases, not the happy path:
// a half-uploaded object from an interrupted run, a Backblaze account with no
// payment method refusing every single upload, and the absolute requirement
// that a backup job never takes the web process down with it.

import { describe, it, expect, vi } from 'vitest';
import {
  planSync, runSync, isFatalFailure, destKeyFor, sourceKeyFor,
  MEDIA_PREFIX, MAX_CONSECUTIVE_FAILURES, syncMediaOffsite, syncEnabled,
  verifyCopies, chooseSample, copyObject, COPY_TIMEOUT_MS, RUN_WATCHDOG_MS,
} from './media-sync.js';

const src = (key, size) => ({ key, size });
const dst = (key, size) => ({ key: destKeyFor(key), size });
const MB = 1024 ** 2;

describe('key mapping', () => {
  it('prefixes so media can never collide with the database archives', () => {
    expect(destKeyFor('generations/image/a.png')).toBe(`${MEDIA_PREFIX}generations/image/a.png`);
  });

  it('maps back, so the two sides can be compared', () => {
    const k = 'generations/video/b.mp4';
    expect(sourceKeyFor(destKeyFor(k))).toBe(k);
  });

  // The offsite bucket also holds encrypted database backups. Reading one of
  // those as if it were a media file would make the diff nonsense.
  it('ignores objects that are not ours', () => {
    expect(sourceKeyFor('backups/2026-08-19.json.gz.enc')).toBeNull();
  });
});

describe('deciding what to copy', () => {
  it('copies everything when the destination is empty', () => {
    const p = planSync([src('a', 10), src('b', 20)], []);
    expect(p.toCopy.map((o) => o.key).sort()).toEqual(['a', 'b']);
    expect(p.missing).toBe(2);
    expect(p.alreadyThere).toBe(0);
  });

  it('skips what is already there at the same size', () => {
    const p = planSync([src('a', 10), src('b', 20)], [dst('a', 10)]);
    expect(p.toCopy.map((o) => o.key)).toEqual(['b']);
    expect(p.alreadyThere).toBe(1);
  });

  // THE ONE THAT MATTERS MOST. A destination object of the wrong size is a
  // TRUNCATED upload from a run that was interrupted — which will happen,
  // because this runs inside a web process that gets redeployed daily. Treating
  // it as "present" would leave a corrupt file standing in for a customer's
  // work, and the count would say everything was protected.
  it('re-copies an object whose size does not match — a half-finished upload', () => {
    const p = planSync([src('a', 1000)], [dst('a', 400)]);
    expect(p.toCopy.map((o) => o.key), 'a truncated copy was accepted as complete').toEqual(['a']);
    expect(p.alreadyThere).toBe(0);
  });

  it('does nothing when both sides already agree', () => {
    const p = planSync([src('a', 10)], [dst('a', 10)]);
    expect(p.toCopy).toEqual([]);
    expect(p.remainingAfter).toBe(0);
  });
});

describe('staying inside one slice of work', () => {
  // The first run has 66 GiB to move, inside a process that is redeployed
  // several times a day. Uncapped it would never finish a run at all.
  it('stops at the object cap and says how many are left', () => {
    const source = Array.from({ length: 50 }, (_, i) => src(`k${i}`, 10));
    const p = planSync(source, [], { maxObjects: 20 });
    expect(p.toCopy).toHaveLength(20);
    expect(p.missing).toBe(50);
    expect(p.remainingAfter).toBe(30);
  });

  it('stops at the byte cap even when the object count allows more', () => {
    const source = Array.from({ length: 10 }, (_, i) => src(`k${i}`, 100 * MB));
    const p = planSync(source, [], { maxObjects: 100, maxBytes: 250 * MB });
    expect(p.toCopy).toHaveLength(2);
    expect(p.plannedBytes).toBeLessThanOrEqual(250 * MB);
  });

  // Smallest first: more customer files get protected per minute than if a run
  // opens with the videos.
  it('takes the smallest objects first', () => {
    const p = planSync([src('big', 900), src('small', 1), src('mid', 50)], [], { maxObjects: 2 });
    expect(p.toCopy.map((o) => o.key)).toEqual(['small', 'mid']);
  });

  // One enormous file must not consume an entire run and starve everything
  // else — but it is REPORTED, never silently dropped.
  it('sets aside anything over the size limit, and names it', () => {
    const p = planSync([src('huge', 900 * MB), src('ok', 10)], [], { maxObjectBytes: 100 * MB });
    expect(p.toCopy.map((o) => o.key)).toEqual(['ok']);
    expect(p.tooBig.map((o) => o.key)).toEqual(['huge']);
    expect(p.missing, 'the oversized object vanished from the count entirely').toBe(2);
  });
});

describe('knowing when to give up', () => {
  // Backblaze above 10 GB with no payment method refuses EVERY upload. Retrying
  // thousands of times burns API calls and buries the one line that explains it.
  it.each([
    'Cap exceeded for this account',
    'PaymentRequired: add a payment method',
    'Access Denied',
    'not authorized to perform this action',
  ])('treats "%s" as a wall, not a blip', (msg) => {
    expect(isFatalFailure(msg)).toBe(true);
  });

  it.each(['socket hang up', 'ETIMEDOUT', 'connection reset'])(
    'treats "%s" as worth continuing past', (msg) => {
      expect(isFatalFailure(msg)).toBe(false);
    });
});

describe('running a slice', () => {
  const source = Array.from({ length: 6 }, (_, i) => src(`k${i}`, 10));

  it('copies everything planned and reports it', async () => {
    const copy = vi.fn(async ({ key }) => ({ key, bytes: 10 }));
    const r = await runSync({ source, dest: [], copy, log: {} });
    expect(r.copied).toBe(6);
    expect(r.failed).toBe(0);
    expect(r.bytes).toBe(60);
    expect(r.remainingAfter).toBe(0);
  });

  // A single flaky upload is not a reason to abandon the rest.
  it('carries on past one transient failure', async () => {
    const copy = vi.fn(async ({ key }) => {
      if (key === 'k2') throw new Error('socket hang up');
      return { key, bytes: 10 };
    });
    const r = await runSync({ source, dest: [], copy, log: {} });
    expect(r.copied).toBe(5);
    expect(r.failed).toBe(1);
    expect(r.stopped).toBeNull();
  });

  // The payment-method wall. It must stop on the FIRST one.
  it('stops immediately on a refusal that will not fix itself', async () => {
    const copy = vi.fn(async () => { throw new Error('Cap exceeded for this account'); });
    const r = await runSync({ source, dest: [], copy, log: {} });
    expect(copy, 'it kept trying against a wall').toHaveBeenCalledTimes(1);
    expect(r.stopped).toMatch(/will not fix itself/);
    expect(r.copied).toBe(0);
  });

  it('stops after a run of failures even when each looks transient', async () => {
    const copy = vi.fn(async () => { throw new Error('socket hang up'); });
    const r = await runSync({ source, dest: [], copy, log: {} });
    expect(copy).toHaveBeenCalledTimes(MAX_CONSECUTIVE_FAILURES);
    expect(r.stopped).toMatch(/systemic/);
  });

  // A backup job that takes the web process down has made things worse than the
  // gap it was closing.
  it('never throws, whatever the copy does', async () => {
    const copy = vi.fn(async () => { throw new Error('something unexpected'); });
    await expect(runSync({ source, dest: [], copy, log: {} })).resolves.toBeTruthy();
  });

  it('does no work and says so when both sides already agree', async () => {
    const copy = vi.fn();
    const dest = source.map((s) => dst(s.key, s.size));
    const r = await runSync({ source, dest, copy, log: {} });
    expect(copy).not.toHaveBeenCalled();
    expect(r.copied).toBe(0);
    expect(r.remainingAfter).toBe(0);
  });

  it('reports what is still outstanding after a capped run', async () => {
    const many = Array.from({ length: 30 }, (_, i) => src(`k${i}`, 10));
    const copy = vi.fn(async ({ key }) => ({ key, bytes: 10 }));
    const r = await runSync({ source: many, dest: [], copy, log: {}, limits: { maxObjects: 10 } });
    expect(r.copied).toBe(10);
    expect(r.remainingAfter).toBe(20);
  });
});

// ─── the orchestrator, and its two refusals ──────────────────────────────────
describe('the full slice', () => {
  const ok = (objects) => async () => ({ objects, truncated: false });

  it('is OFF unless explicitly switched on', async () => {
    const r = await syncMediaOffsite({ env: {}, listSource: ok([]), listDest: ok([]) });
    expect(r.skipped).toMatch(/switched off/);
  });

  it.each(['1', 'true', 'TRUE', 'yes', 'on'])('accepts %s as on', (v) => {
    expect(syncEnabled({ MEDIA_SYNC_ENABLED: v })).toBe(true);
  });

  it.each(['', '0', 'false', 'no', undefined])('treats %s as off', (v) => {
    expect(syncEnabled({ MEDIA_SYNC_ENABLED: v })).toBe(false);
  });

  it('runs when switched on', async () => {
    const write = vi.fn();
    const read = vi.fn(async () => ({ body: 'x', contentLength: 10, contentType: 'image/png' }));
    const r = await syncMediaOffsite({
      env: { MEDIA_SYNC_ENABLED: 'true' },
      listSource: ok([src('a', 10)]), listDest: ok([]), read, write, log: {},
    });
    expect(r.copied).toBe(1);
    expect(write.mock.calls[0][0]).toEqual(expect.objectContaining({ key: destKeyFor('a') }));
  });

  // A truncated listing looks EXACTLY like "everything is already copied" — the
  // most dangerous wrong answer a backup job can produce. Refuse, do not guess.
  it('refuses to sync against a truncated source listing', async () => {
    const r = await syncMediaOffsite({
      env: { MEDIA_SYNC_ENABLED: 'true' },
      listSource: async () => ({ objects: [src('a', 1)], truncated: true }),
      listDest: ok([]), log: {},
    });
    expect(r.error, 'it synced against a partial view of the bucket').toMatch(/truncated/);
    expect(r.copied).toBeUndefined();
  });

  it('refuses to sync against a truncated destination listing', async () => {
    const r = await syncMediaOffsite({
      env: { MEDIA_SYNC_ENABLED: 'true' },
      listSource: ok([src('a', 1)]),
      listDest: async () => ({ objects: [], truncated: true }), log: {},
    });
    expect(r.error).toMatch(/truncated/);
  });

  it('reports a listing failure instead of copying everything again', async () => {
    const r = await syncMediaOffsite({
      env: { MEDIA_SYNC_ENABLED: 'true' },
      listSource: ok([src('a', 1)]),
      listDest: async () => ({ error: 'AccessDenied' }), log: {},
    });
    expect(r.error).toMatch(/offsite bucket: AccessDenied/);
  });
});

// ─── proving the copies are real ─────────────────────────────────────────────
// The lesson of #34, applied before it can be forgotten: the platform had a
// daily database backup for months and nobody had ever restored one. When it
// was finally tried, that attempt was the first proof it had ever worked.
//
// An upload returning 200 proves the request was accepted. It does not prove
// the bytes are there, that they are complete, or that they come back. Only
// reading them does.
describe('reading the copies back', () => {
  const source = Array.from({ length: 9 }, (_, i) => src(`k${i}`, 100 + i));

  it('passes when every sampled copy comes back the right size', async () => {
    const readDest = vi.fn(async (key) => {
      const k = sourceKeyFor(key);
      return { contentLength: source.find((s) => s.key === k).size };
    });
    const r = await verifyCopies({ readDest, source, log: {} });
    expect(r.state).toBe('ok');
    expect(r.checked).toBe(3);
    expect(r.bad).toEqual([]);
  });

  // A short copy is the failure mode that matters — it looks present and is
  // useless, and nothing but reading it back would notice.
  it('catches a copy that came back the wrong size', async () => {
    const readDest = vi.fn(async () => ({ contentLength: 1 }));
    const r = await verifyCopies({ readDest, source, log: {} });
    expect(r.state).toBe('bad');
    expect(r.bad[0].why).toMatch(/size does not match/);
  });

  it('catches a copy that is not there at all', async () => {
    const readDest = vi.fn(async () => { throw new Error('NoSuchKey'); });
    const r = await verifyCopies({ readDest, source, log: {} });
    expect(r.state).toBe('bad');
    expect(r.bad[0].why).toMatch(/NoSuchKey/);
  });

  // Evenly spaced, so a failure confined to one era of the bucket is found.
  // Random would find it eventually; "eventually" is not a property to rely on
  // for a backup.
  it('spreads the sample across the list instead of checking the same few', () => {
    const picked = chooseSample(source, 3).map((s) => s.key);
    expect(new Set(picked).size).toBe(3);
    expect(picked).not.toEqual(['k0', 'k1', 'k2']);
  });

  it('says nothing rather than failing when there is nothing to check', async () => {
    const r = await verifyCopies({ readDest: vi.fn(), source: [], log: {} });
    expect(r.state).toBe('quiet');
    expect(r.checked).toBe(0);
  });
});

// ─── the two bugs the first production run found ─────────────────────────────
// Both were invisible in the unit tests and obvious within two minutes of real
// data. Neither would have been found by reading the code again.
describe('what the first real run taught', () => {
  // BUG 2. The verify sampled the whole SOURCE list, so during the initial seed
  // — 399 copied of 11,374 — it reported "VERIFY FAILED, Key not found" while
  // the sync was working perfectly. A check that cries failure during normal
  // operation is one you learn to ignore, which is worse than not having it.
  it('verifies only what is supposed to be offsite, not the whole backlog', async () => {
    const source = Array.from({ length: 100 }, (_, i) => src(`k${i}`, 10));
    const dest = [];                                   // nothing copied yet
    const readDest = vi.fn(async (key) => {
      // Only the first three were actually written by this run.
      const k = sourceKeyFor(key);
      if (['k0', 'k1', 'k2'].includes(k)) return { contentLength: 10 };
      throw new Error('Key not found');
    });
    const r = await syncMediaOffsite({
      env: { MEDIA_SYNC_ENABLED: 'true' },
      listSource: async () => ({ objects: source, truncated: false }),
      listDest: async () => ({ objects: dest, truncated: false }),
      read: async () => ({ body: 'x', contentLength: 10 }),
      write: vi.fn(),
      readDest,
      limits: { maxObjects: 3 },
      log: {},
    });
    expect(r.copied).toBe(3);
    expect(r.verify.state, 'it verified objects it had never copied').toBe('ok');
  });

  it('also re-checks copies made on earlier runs, not just this run’s', async () => {
    const readDest = vi.fn(async () => ({ contentLength: 10 }));
    const r = await syncMediaOffsite({
      env: { MEDIA_SYNC_ENABLED: 'true' },
      listSource: async () => ({ objects: [src('old', 10)], truncated: false }),
      listDest: async () => ({ objects: [dst('old', 10)], truncated: false }),
      readDest, log: {},
    });
    expect(r.copied).toBe(0);
    expect(r.verify.checked, 'nothing was re-checked when nothing was copied').toBeGreaterThan(0);
  });

  it('reports which objects it actually landed, not just how many', async () => {
    const r = await runSync({
      source: [src('a', 1), src('b', 2)], dest: [],
      copy: async ({ key }) => ({ key, bytes: 1 }), log: {},
    });
    expect(r.copiedObjects.map((o) => o.key).sort()).toEqual(['a', 'b']);
  });
});

// ─── the bug that silenced the job for three hours ───────────────────────────
// 2026-08-20, first check of the morning: the sync had copied 8,682 files
// overnight and then gone completely quiet at 08:06. The process was alive —
// the alerts tick kept logging every five minutes — but media-sync said nothing
// for nearly three hours.
//
// A copy had hung. A stream that neither resolves nor rejects, so the promise
// never settled, the "already running" flag stayed true, and every later tick
// returned immediately and silently. No error, no log, no progress.
//
// A request with no deadline is a request that can wait forever, and forever is
// longer than anyone is watching.
describe('a hung copy cannot stop the sync forever', () => {
  it('gives up on an object that never responds', async () => {
    const read = vi.fn(() => new Promise(() => {}));      // never settles
    await expect(
      copyObject({ read, write: vi.fn(), key: 'k', timeoutMs: 40 }),
    ).rejects.toBeTruthy();
  });

  it('passes an abort signal to the read, so the request is actually cancelled', async () => {
    const read = vi.fn(async () => ({ body: 'x', contentLength: 1 }));
    const write = vi.fn();
    await copyObject({ read, write, key: 'k' });
    expect(read.mock.calls[0][1]?.signal, 'the read got no signal — a hang could not be cancelled')
      .toBeInstanceOf(AbortSignal);
    expect(write.mock.calls[0][1]?.signal, 'the write got no signal').toBeInstanceOf(AbortSignal);
  });

  it('clears its timer on success, so a long run cannot accumulate thousands', async () => {
    const read = vi.fn(async () => ({ body: 'x', contentLength: 1 }));
    const before = process.getActiveResourcesInfo?.().filter((r) => r === 'Timeout').length ?? 0;
    for (let i = 0; i < 20; i += 1) await copyObject({ read, write: vi.fn(), key: `k${i}` });
    const after = process.getActiveResourcesInfo?.().filter((r) => r === 'Timeout').length ?? 0;
    expect(after - before).toBeLessThan(5);
  });

  // A timed-out copy is a NORMAL failure: the run carries on and the object is
  // simply still missing next time, because the diff makes retries automatic.
  it('treats a timeout as one bad object, not a reason to stop', async () => {
    const source = Array.from({ length: 4 }, (_, i) => src(`k${i}`, 10));
    const copy = vi.fn(async ({ key }) => {
      if (key === 'k1') throw new Error('The operation was aborted due to timeout');
      return { key, bytes: 10 };
    });
    const r = await runSync({ source, dest: [], copy, log: {} });
    expect(r.copied).toBe(3);
    expect(r.stopped, 'a timeout was treated as a wall').toBeNull();
  });

  it('the watchdog is longer than a copy timeout, or it would fire mid-copy', () => {
    expect(RUN_WATCHDOG_MS).toBeGreaterThan(COPY_TIMEOUT_MS);
  });
});

// ─── THE BACKUP SURVIVES A FAILED LISTING (2026-08-29) ──────────────────────
// The offsite listing has failed since 20 August, and when it failed the whole
// backup stopped — seventeen hours on the 29th, while customers generated all
// day. Three fixes assumed three different causes and none held.
//
// So the listing is DEMOTED: the ledger decides what to copy, and a failed
// listing is a warning rather than a full stop. These tests are the difference
// between "the backup keeps running" and "the backup stops for a day".
describe('a failed offsite listing no longer stops the backup', () => {
  const src = [{ key: 'a.png', size: 10 }, { key: 'b.png', size: 20 }];
  const base = (over = {}) => ({
    listSource: async () => ({ objects: src }),
    listDest: async () => ({ error: 'the request socket did not establish a connection' }),
    read: async (k) => ({ body: Buffer.from('x'), size: 1, contentType: 'image/png', key: k }),
    write: async () => {},
    env: { MEDIA_SYNC_ENABLED: '1' },
    log: { warn: () => {}, error: () => {}, log: () => {} },
    ...over,
  });

  it('copies anyway, using the ledger', async () => {
    const recorded = [];
    const r = await syncMediaOffsite(base({
      ledger: {
        missing: async () => [],            // nothing recorded → everything missing
        record: async (k, n) => { recorded.push([k, n]); },
      },
    }));
    expect(r.error, 'it refused to run').toBeUndefined();
    expect(r.copied).toBeGreaterThan(0);
    expect(recorded.length).toBeGreaterThan(0);
  });

  it('but WITHOUT a ledger it still refuses — that is the only honest answer', async () => {
    // No listing and no record means there is genuinely no way to know what is
    // missing, and copying everything blindly is not a backup strategy.
    const r = await syncMediaOffsite(base({ ledger: null }));
    expect(r.error).toMatch(/could not list the offsite bucket/);
  });

  it('a WORKING listing seeds the ledger — this is what avoids re-uploading 72 GB', async () => {
    const seeded = [];
    await syncMediaOffsite(base({
      listDest: async () => ({ objects: [{ key: 'media/a.png', size: 10 }] }),
      ledger: {
        seed: async (rows) => { seeded.push(...rows); },
        missing: async () => [],
        record: async () => {},
      },
    }));
    expect(seeded.map((s) => s.key)).toContain('a.png');
  });

  it('a truncated SOURCE listing still refuses — that half has not changed', () => {
    // Our own bucket, and a partial view of it is indistinguishable from
    // "nothing is missing".
    return expect(syncMediaOffsite(base({
      listSource: async () => ({ objects: src, truncated: true }),
      ledger: { missing: async () => [], record: async () => {} },
    }))).resolves.toMatchObject({ error: expect.stringMatching(/truncated/) });
  });
});
