// ─── offsite-diagnose.test.js ────────────────────────────────────────────────
// The point of this module is to stop a FOURTH guess.
//
// For three nights the log has said one thing — "could not list the offsite
// bucket" — and that sentence covers two problems with opposite fixes:
// Backblaze unreachable, or listing specifically broken. Last night's fix
// assumed the second and made no difference.
//
// So the tests are about the three ways a diagnostic can be worse than none:
//   1. calling "could not ask" one of the two answers
//   2. reading NotFound as a failure, which inverts the whole diagnosis
//   3. hanging, and delaying the sync it is supposed to be explaining

import { describe, it, expect, vi } from 'vitest';
import {
  probeOffsite, diagnose, diagnosisLine, PROBE_KEY, PROBE_TIMEOUT_MS,
} from './offsite-diagnose.js';

const notFound = () => Object.assign(new Error('NotFound'), { name: 'NotFound' });

describe('1 — "could not ask" is never one of the two answers', () => {
  it('no probe at all is unknown', async () => {
    const p = await probeOffsite({ head: undefined });
    expect(p.reachable).toBeNull();
    expect(diagnose(new Error('x'), p).verdict).toBe('unknown');
  });

  it('and the verdict says plainly not to conclude anything', () => {
    const d = diagnose(new Error('socket timeout'), { reachable: null });
    expect(d.action).toMatch(/Do not treat this as either cause/);
  });

  it('a missing probe object is unknown too, not unreachable', () => {
    expect(diagnose(new Error('x'), null).verdict).toBe('unknown');
    expect(diagnose(new Error('x'), undefined).verdict).toBe('unknown');
  });
});

describe('2 — NotFound is PROOF of reachability, not a failure', () => {
  it('a 404 for a key that cannot exist means the round trip worked', async () => {
    // DNS, TCP, TLS, signature, and an answer. Reading this as a failure would
    // invert the entire diagnosis and send us back to fixing listing code.
    const p = await probeOffsite({ head: vi.fn(async () => { throw notFound(); }) });
    expect(p.reachable).toBe(true);
  });

  it('so does an object that happens to exist', async () => {
    expect((await probeOffsite({ head: vi.fn(async () => ({ ContentLength: 5 })) })).reachable).toBe(true);
  });

  it('every spelling of not-found counts', async () => {
    for (const name of ['NotFound', 'NoSuchKey', 'Error: 404']) {
      const p = await probeOffsite({ head: vi.fn(async () => { throw new Error(name); }) });
      expect(p.reachable, name).toBe(true);
    }
  });

  it('a real connection failure is NOT reachable', async () => {
    const p = await probeOffsite({
      head: vi.fn(async () => { throw new Error('the request socket did not establish a connection'); }),
    });
    expect(p.reachable).toBe(false);
    expect(p.error).toMatch(/socket/);
  });

  it('it asks for a key that cannot exist, so it never reads customer data', () => {
    expect(PROBE_KEY).toMatch(/does-not-exist/);
  });
});

describe('3 — it cannot hang the thing it is explaining', () => {
  it('gives up on its own deadline', async () => {
    const p = await probeOffsite({ head: () => new Promise(() => {}), timeoutMs: 20 });
    expect(p.reachable).toBe(false);
    expect(p.error).toMatch(/timed out/);
  });

  it('and that deadline is short — this runs after something already failed', () => {
    expect(PROBE_TIMEOUT_MS).toBeLessThanOrEqual(10_000);
  });
});

describe('the two answers, and what each one means', () => {
  it('reachable + listing failed → LISTING is the problem', async () => {
    const d = diagnose(new Error('socket timeout'), { reachable: true, ms: 140 });
    expect(d.verdict).toBe('listing-only');
    expect(d.detail).toMatch(/ANSWERED a single-object request in 140ms/);
    expect(d.action).toMatch(/tens of thousands of objects/);
  });

  it('unreachable → the NETWORK is the problem, and our listing code is not', async () => {
    const d = diagnose(new Error('socket timeout'), { reachable: false, ms: 8000, error: 'connect timeout' });
    expect(d.verdict).toBe('unreachable');
    expect(d.action).toMatch(/NOT our listing code/);
    // Says out loud that three nights of work assumed the opposite.
    expect(d.action).toMatch(/assumed the opposite/);
  });

  it('both carry the original listing error, so nothing is lost', () => {
    for (const probe of [{ reachable: true, ms: 1 }, { reachable: false, ms: 1, error: 'x' }]) {
      expect(diagnose(new Error('the original words'), probe).detail).toMatch(/the original words/);
    }
  });

  it('the log line is loud and names the verdict first', () => {
    const line = diagnosisLine(diagnose(new Error('x'), { reachable: true, ms: 5 }));
    expect(line).toMatch(/^\[offsite-diagnosis\] LISTING-ONLY —/);
  });
});
