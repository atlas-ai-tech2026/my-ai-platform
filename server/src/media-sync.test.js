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
    expect(write).toHaveBeenCalledWith(expect.objectContaining({ key: destKeyFor('a') }));
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
