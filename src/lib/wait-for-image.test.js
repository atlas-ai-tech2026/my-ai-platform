// ─── wait-for-image.test.js ──────────────────────────────────────────────────
// The browser's half of the hand-off, and the rule it exists to keep:
//
//   GIVING UP MUST NOT LOOK LIKE FAILING.
//
// If this stops asking, the image is still coming — the server's sweeper still
// delivers it into history. Announcing failure here would be the 2026-08-28
// bug again, moved from the server into the front end where it is harder to
// see: six customers told their image failed while it was actually finishing.

import { describe, it, expect, vi } from 'vitest';
import { waitForImage, waitedLabel, ImageFailed, STOP_ASKING_AFTER_MS } from './wait-for-image.js';

/** A clock and a sleep that cost no real time. */
function fakeTime() {
  let t = 0;
  return { now: () => t, sleep: async (ms) => { t += ms; } };
}

const done = (url = 'https://spaces/a.png', already = false) =>
  ({ status: 'COMPLETED', image_url: url, already });
const working = { status: 'IN_PROGRESS' };

describe('THE RULE — giving up is not failing', () => {
  it('running out of patience resolves "not done", it does NOT throw', async () => {
    const t = fakeTime();
    const r = await waitForImage('t1', { poll: async () => working, ...t });
    expect(r).toEqual({ done: false });
  });

  it('it waits LONGER than the server does before it stops asking', async () => {
    // The browser must never reach a verdict the server has not reached. The
    // server gives up at 20 minutes.
    expect(STOP_ASKING_AFTER_MS).toBeGreaterThan(20 * 60 * 1000);
  });

  it('a network blip is not a failure — it keeps asking', async () => {
    const t = fakeTime();
    let n = 0;
    const r = await waitForImage('t1', {
      poll: async () => { n += 1; if (n < 3) throw new Error('offline'); return done(); },
      ...t,
    });
    expect(r.done).toBe(true);
    expect(n).toBe(3);
  });

  it('a malformed answer is not a failure either', async () => {
    const t = fakeTime();
    let n = 0;
    const r = await waitForImage('t1', {
      poll: async () => { n += 1; return n < 3 ? null : done(); },
      ...t,
    });
    expect(r.done).toBe(true);
  });

  it('COMPLETED with no url is not treated as arrival', async () => {
    // Rendering an empty url would show the customer a broken picture and call
    // it a success.
    const t = fakeTime();
    let n = 0;
    const r = await waitForImage('t1', {
      poll: async () => { n += 1; return n === 1 ? { status: 'COMPLETED' } : done(); },
      ...t,
    });
    expect(r.url).toBe('https://spaces/a.png');
  });
});

describe('when it does arrive', () => {
  it('returns the url', async () => {
    const t = fakeTime();
    expect(await waitForImage('t1', { poll: async () => done(), ...t }))
      .toEqual({ done: true, url: 'https://spaces/a.png', thumbUrl: null, already: false });
  });

  it('carries the small version through, so the grid is fast for late ones too', async () => {
    const t = fakeTime();
    const r = await waitForImage('t1', {
      poll: async () => ({ status: 'COMPLETED', image_url: 'u', thumb_url: 'https://spaces/t.jpg' }),
      ...t,
    });
    expect(r.thumbUrl).toBe('https://spaces/t.jpg');
  });

  it('passes on "already" so history is not written twice', async () => {
    // The sweeper or another tab got there first and has written the row.
    const t = fakeTime();
    const r = await waitForImage('t1', { poll: async () => done('u', true), ...t });
    expect(r.already).toBe(true);
  });

  it('the six real production cases all arrive', async () => {
    // 94, 97, 125, 130, 144, 314 seconds — every one refunded on the day.
    for (const secs of [94, 97, 125, 130, 144, 314]) {
      const t = fakeTime();
      const r = await waitForImage('t1', {
        poll: async () => (t.now() >= secs * 1000 ? done() : working),
        ...t,
      });
      expect(r.done, `${secs}s`).toBe(true);
    }
  });
});

describe('only the SERVER can say it failed', () => {
  it('FAILED throws, carrying the server’s words', async () => {
    const t = fakeTime();
    await expect(waitForImage('t1', {
      poll: async () => ({ status: 'FAILED', error: 'content was flagged' }), ...t,
    })).rejects.toThrow(/content was flagged/);
  });

  it('the failure is a typed error, so the caller can tell it from a bug', async () => {
    const t = fakeTime();
    await expect(waitForImage('t1', { poll: async () => ({ status: 'FAILED' }), ...t }))
      .rejects.toBeInstanceOf(ImageFailed);
  });

  it('and it always says something, never an empty message', async () => {
    const t = fakeTime();
    await waitForImage('t1', { poll: async () => ({ status: 'FAILED' }), ...t })
      .catch((e) => expect(e.message.length).toBeGreaterThan(10));
  });
});

describe('telling the customer how long it has been', () => {
  it('ticks with the elapsed seconds', async () => {
    const t = fakeTime();
    const ticks = [];
    await waitForImage('t1', {
      poll: async () => (t.now() >= 12_000 ? done() : working),
      onTick: (s) => ticks.push(s),
      ...t,
    });
    expect(ticks[0]).toBe(0);
    expect(ticks.at(-1)).toBeGreaterThan(0);
  });

  it('reads as a real duration, not a spinner', () => {
    expect(waitedLabel(9)).toBe('9s');
    expect(waitedLabel(59)).toBe('59s');
    expect(waitedLabel(60)).toBe('1m 00s');
    expect(waitedLabel(130)).toBe('2m 10s');
    expect(waitedLabel(-5)).toBe('0s');
  });
});

// ─── THE COUNTER MUST NOT RESTART AT ZERO ───────────────────────────────────
// Amr, 2026-09-05, with a screenshot: the banner read "Still working — 1s" for
// an image the server had already been waiting on for ninety seconds. The
// browser's timer started when the hand-off arrived, not when he pressed
// Generate, so the one number on screen was wrong in the one situation it
// exists for.
//
// A wrong number is worse than no number: it tells someone a long generation
// has just begun, which is the opposite of what the message is trying to say.
describe('the wait continues the server\'s clock', () => {
  const completed = { status: 'COMPLETED', image_url: 'https://x/i.png' };

  it('counts from when the REQUEST started, not from the hand-off', async () => {
    const ticks = [];
    let t = 0;
    await waitForImage('job-1', {
      // never finishes on the first poll, so onTick runs
      poll: async () => (t > 12_000 ? completed : null),
      onTick: (s) => ticks.push(s),
      sleep: async (ms) => { t += ms; },
      now: () => t,
      intervalMs: 3000,
      alreadyWaitedMs: 90_000,      // what the server already spent
    });
    expect(ticks.length).toBeGreaterThan(0);
    // The first thing the customer sees must be ~90s, never 0 or 1.
    expect(ticks[0]).toBeGreaterThanOrEqual(90);
  });

  it('still starts at zero when nothing was waited first', async () => {
    const ticks = [];
    let t = 0;
    await waitForImage('job-2', {
      poll: async () => (t > 12_000 ? completed : null),
      onTick: (s) => ticks.push(s),
      sleep: async (ms) => { t += ms; },
      now: () => t,
      intervalMs: 3000,
    });
    expect(ticks[0]).toBeLessThan(10);
  });

  it('keeps counting upward', async () => {
    const ticks = [];
    let t = 0;
    await waitForImage('job-3', {
      poll: async () => (t > 20_000 ? completed : null),
      onTick: (s) => ticks.push(s),
      sleep: async (ms) => { t += ms; },
      now: () => t,
      intervalMs: 3000,
      alreadyWaitedMs: 90_000,
    });
    expect(ticks).toEqual([...ticks].sort((a, b) => a - b));
    expect(ticks[ticks.length - 1]).toBeGreaterThan(ticks[0]);
  });
});
