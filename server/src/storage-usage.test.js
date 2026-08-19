// ─── storage-usage.test.js ───────────────────────────────────────────────────
// "Tell me I will start or become to exceed the limit to start" — the owner,
// 2026-08-19. Not "you are over". "You are ABOUT to be over."
//
// That distinction is the feature. A quota discovered by exceeding it is an
// outage: the offsite copy stops, and the first symptom is a customer noticing
// broken history weeks later. A quota discovered 40 days out is a diary entry.
//
// So the tests that matter are the ones about honesty — refusing to project
// from thin data, and never rendering an unmeasurable bucket as healthy.

import { describe, it, expect, vi } from 'vitest';
import {
  measureBucket, growthPerDay, projectCrossing, judgeUsage,
  ALLOWANCES, MIN_POINTS, WARN_AT, CRITICAL_AT, GIB, GB,
} from './storage-usage.js';

const ListObjectsV2Command = vi.fn(function (args) { Object.assign(this, args); });

/** An S3 that pages, like the real one does past 1000 objects. */
function pagedClient(pages) {
  return {
    send: vi.fn(async (cmd) => {
      const i = cmd.ContinuationToken ? Number(cmd.ContinuationToken) : 0;
      const page = pages[i] || [];
      const more = i + 1 < pages.length;
      return {
        Contents: page,
        IsTruncated: more,
        NextContinuationToken: more ? String(i + 1) : undefined,
      };
    }),
  };
}

const obj = (size) => ({ Key: `k${Math.random()}`, Size: size });
const day = (n) => new Date(Date.UTC(2026, 7, n));

describe('measuring a bucket', () => {
  // THE BUG THIS AVOIDS. storage.js listKeys() caps at MaxKeys 1000 and never
  // follows the continuation token — correct for listing a few backups, and
  // silently wrong for 11,320 objects. Measuring 8% of a bucket and calling it
  // the size is the confidently-wrong number this whole file exists to prevent.
  it('follows every page instead of stopping at the first 1000', async () => {
    const pages = [
      Array.from({ length: 1000 }, () => obj(1_000_000)),
      Array.from({ length: 1000 }, () => obj(1_000_000)),
      Array.from({ length: 320 }, () => obj(1_000_000)),
    ];
    const r = await measureBucket(pagedClient(pages), 'b', { ListObjectsV2Command });
    expect(r.objects, 'pagination stopped early — the bucket was under-counted').toBe(2320);
    expect(r.bytes).toBe(2_320_000_000);
    expect(r.truncated).toBe(false);
  });

  it('handles an empty bucket without pretending it failed', async () => {
    const r = await measureBucket(pagedClient([[]]), 'b', { ListObjectsV2Command });
    expect(r).toMatchObject({ bytes: 0, objects: 0, truncated: false });
  });

  // A capped count presented as a total is a lie with a plausible face.
  it('reports truncation rather than returning a partial total as if complete', async () => {
    const pages = Array.from({ length: 10 }, () => [obj(100)]);
    const r = await measureBucket(pagedClient(pages), 'b', { ListObjectsV2Command, maxPages: 3 });
    expect(r.truncated).toBe(true);
  });
});

describe('refusing to invent a trend', () => {
  // One measurement is a number, not a trend. Two hours apart extrapolate to
  // nonsense. A confident wrong date is worse than "still learning", because
  // someone can act on it.
  it('will not compute growth from a single reading', () => {
    expect(growthPerDay([{ bytes: 10, at: day(1) }])).toBeNull();
  });

  it('will not compute growth from fewer than the minimum readings', () => {
    const h = Array.from({ length: MIN_POINTS - 1 }, (_, i) => ({ bytes: i * 100, at: day(i + 1) }));
    expect(growthPerDay(h)).toBeNull();
  });

  it('will not extrapolate a daily rate from readings hours apart', () => {
    const t = Date.UTC(2026, 7, 19, 9);
    const h = [0, 1, 2].map((i) => ({ bytes: i * 1e9, at: new Date(t + i * 36e5) }));
    expect(growthPerDay(h), 'a daily rate was invented from three hours of data').toBeNull();
  });

  it('computes a real rate once there is enough spread', () => {
    const h = [
      { bytes: 10 * GIB, at: day(1) },
      { bytes: 14 * GIB, at: day(3) },
      { bytes: 20 * GIB, at: day(5) },
    ];
    expect(growthPerDay(h) / GIB).toBeCloseTo(2.5, 1);   // 10 GiB over 4 days
  });

  it('reports shrinking storage as negative, not as an error', () => {
    const h = [
      { bytes: 20 * GIB, at: day(1) },
      { bytes: 15 * GIB, at: day(3) },
      { bytes: 10 * GIB, at: day(5) },
    ];
    expect(growthPerDay(h)).toBeLessThan(0);
  });
});

describe('projecting the crossing', () => {
  it('says how many days are left at the current rate', () => {
    const p = projectCrossing(200 * GIB, 5 * GIB, 250 * GIB);
    expect(p).toMatchObject({ daysLeft: 10, already: false });
  });

  // "Never at this rate" is a real answer and must not be dressed as a date.
  it('returns nothing when storage is flat or shrinking', () => {
    expect(projectCrossing(200 * GIB, 0, 250 * GIB)).toBeNull();
    expect(projectCrossing(200 * GIB, -1e9, 250 * GIB)).toBeNull();
    expect(projectCrossing(200 * GIB, null, 250 * GIB)).toBeNull();
  });

  it('says so plainly when the limit is already behind us', () => {
    expect(projectCrossing(300 * GIB, 1e9, 250 * GIB)).toMatchObject({ already: true, daysLeft: 0 });
  });
});

describe('the verdict the owner reads at 6am', () => {
  const measure = (bytes, objects = 100) => ({ bytes, objects, truncated: false });
  const history = (from, to, days = 10) => [0, days / 2, days].map((d) => ({
    bytes: from + ((to - from) * d) / days, at: new Date(day(1).getTime() + d * 864e5),
  }));

  it('is quiet when storage is small and barely moving', () => {
    const v = judgeUsage({ provider: 'spaces', measurement: measure(66 * GIB),
      history: history(65 * GIB, 66 * GIB) });
    expect(v.state).toBe('ok');
    expect(v.action).toBeNull();
  });

  // The whole point: comfortably inside the limit TODAY, but arriving soon.
  it('warns while still well under the limit, if it arrives within a month', () => {
    const v = judgeUsage({ provider: 'spaces', measurement: measure(100 * GIB),
      history: history(50 * GIB, 100 * GIB) });   // 5 GiB/day → 30 days to 250
    expect(v.state, 'a limit a month away was reported as fine').toBe('warn');
    expect(v.detail).toMatch(/crosses the allowance in about \d+ days/);
    expect(v.action).toBeTruthy();
  });

  it('escalates on percentage even when growth is unknown', () => {
    const v = judgeUsage({ provider: 'spaces', measurement: measure(240 * GIB), history: [] });
    expect(v.state).toBe('critical');
  });

  it('says how many readings it still needs, rather than guessing', () => {
    const v = judgeUsage({ provider: 'spaces', measurement: measure(66 * GIB), history: [] });
    expect(v.detail).toMatch(/unknown rate — 0 of 3 daily readings/);
  });

  // Backblaze is the one that can actually STOP, so its advice is different.
  it('tells you to add a payment method BEFORE Backblaze is crossed', () => {
    const v = judgeUsage({ provider: 'offsite', measurement: measure(9 * GB),
      history: history(5 * GB, 9 * GB) });
    expect(v.state).not.toBe('ok');
    expect(v.action).toMatch(/payment method/i);
    expect(v.action).toMatch(/BEFORE/);
  });

  it('measures Backblaze in decimal GB, the unit it actually bills in', () => {
    const v = judgeUsage({ provider: 'offsite', measurement: measure(5 * GB), history: [] });
    expect(v.detail).toMatch(/5\.0 GB of 10 GB free/);
  });

  // A quota check that cannot see the bucket must never render as healthy —
  // that is how a silent failure survives for months.
  it('reports an unreadable bucket as UNKNOWN, never as ok', () => {
    const v = judgeUsage({ provider: 'spaces', measurement: { error: 'AccessDenied' } });
    expect(v.state).toBe('unknown');
    expect(v.detail).toMatch(/could not be measured/);
    expect(v.action).toBeTruthy();
  });

  it('treats a truncated count as unknown, not as a total', () => {
    const v = judgeUsage({ provider: 'spaces',
      measurement: { bytes: 10 * GIB, objects: 200000, truncated: true }, history: [] });
    expect(v.state).toBe('unknown');
    expect(v.detail).toMatch(/TRUNCATED/);
  });

  it('does not silently accept a provider it has no allowance for', () => {
    expect(judgeUsage({ provider: 'made-up', measurement: measure(1) }).state).toBe('unknown');
  });
});

describe('the allowances are stated, not assumed', () => {
  it('every provider carries a limit, a label and an action', () => {
    for (const [k, a] of Object.entries(ALLOWANCES)) {
      expect(a.limitBytes, `${k} has no limit`).toBeGreaterThan(0);
      expect(a.limitLabel, `${k} has no label`).toBeTruthy();
      expect(a.action, `${k} has no action`).toBeTruthy();
    }
  });

  it('matches what the providers charged on 2026-08-19', () => {
    expect(ALLOWANCES.spaces.limitBytes).toBe(250 * GIB);   // $5/mo plan
    expect(ALLOWANCES.offsite.limitBytes).toBe(10 * GB);    // always-free tier
  });

  it('warns before it shouts', () => {
    expect(WARN_AT).toBeLessThan(CRITICAL_AT);
    expect(WARN_AT).toBeGreaterThan(0.5);
  });
});
