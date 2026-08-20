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
  ALLOWANCES, MIN_POINTS, WARN_AT, CRITICAL_AT, GIB, GB, judgeMediaBackup,
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

// ─── is customer media actually backed up? ───────────────────────────────────
// The owner asked to be reminded to add a payment method to Backblaze. A
// reminder someone can tick off would then read "done" whether or not a single
// file had ever been copied — which is precisely the failure mode this whole
// project keeps finding. So it COUNTS the objects instead, and goes quiet only
// when the files are genuinely there.
describe('the media backup reminder that cannot be ticked off', () => {
  it('shouts while nothing at all has been copied, and says what to do', () => {
    const v = judgeMediaBackup({ source: { objects: 11320 }, offsite: { objects: 0 } });
    expect(v.state).toBe('critical');
    expect(v.detail).toMatch(/11,320 customer files exist in ONE place/);
    expect(v.action).toMatch(/payment method/i);
    expect(v.action).toMatch(/Backblaze/);
  });

  // The self-clearing property. No flag, no tick box — the count is the truth.
  it('goes quiet once every file is copied', () => {
    const v = judgeMediaBackup({ source: { objects: 11320 }, offsite: { objects: 11320 } });
    expect(v.state).toBe('ok');
    expect(v.action).toBeNull();
  });

  it('warns rather than passing while the copy is behind', () => {
    const v = judgeMediaBackup({ source: { objects: 11320 }, offsite: { objects: 9000 } });
    expect(v.state).toBe('warn');
    expect(v.detail).toMatch(/2,320 not yet protected/);
  });

  // An unverified backup is not a backup. It must never render as healthy.
  it('reports an uncountable offsite bucket as UNKNOWN, never as ok', () => {
    const v = judgeMediaBackup({ source: { objects: 100 }, offsite: { error: 'AccessDenied' } });
    expect(v.state).toBe('unknown');
    expect(v.state).not.toBe('ok');
  });

  it('still says something useful when the source count is unavailable', () => {
    const v = judgeMediaBackup({ source: null, offsite: { objects: 0 } });
    expect(v.state).toBe('critical');
    expect(v.detail).toBeTruthy();
  });
});

// ─── the check that could never go green ─────────────────────────────────────
// Seen on PRODUCTION, 2026-08-20, in the owner's own screenshot:
//
//   Customer media backed up — warn
//   11,372 of 11,386 files copied offsite — 14 not yet protected
//   Do: The sync is behind. Check the last run before assuming it is catching up.
//
// The sync was not behind. Its own log said "0 still to copy" every fifteen
// minutes for two hours, and every sampled read-back succeeded. The line was
// comparing the WHOLE Spaces bucket against the media mirror, so the 14
// encrypted database archives under backups/ — which reach Backblaze by their
// own path and will never appear under media/ — counted as unprotected customer
// files. Permanently, by construction.
//
// A warning that cannot clear is worse than no warning: it is a yellow light
// you learn to walk past, on the one screen whose silence is supposed to mean
// something. The counts must be of the same set.
describe('customer media is compared against customer media', () => {
  it('goes green when every media file is copied, ignoring the DB archives', () => {
    // What production actually had: 11,372 generations, all copied, plus 14
    // database archives that were never part of this comparison.
    const v = judgeMediaBackup({
      source: { objects: 11_372, bytes: 71e9 },     // generations/ ONLY
      offsite: { objects: 11_372, bytes: 71e9 },
    });
    expect(v.state, 'a completed sync still reported files unprotected').toBe('ok');
    expect(v.action).toBeNull();
  });

  it('still reports a genuinely incomplete sync', () => {
    const v = judgeMediaBackup({
      source: { objects: 11_372 }, offsite: { objects: 9_000 },
    });
    expect(v.state).toBe('warn');
    expect(v.detail).toMatch(/2,372 not yet protected/);
  });

  it('and still shouts when nothing at all is offsite', () => {
    const v = judgeMediaBackup({ source: { objects: 11_372 }, offsite: { objects: 0 } });
    expect(v.state).toBe('critical');
  });
});

// The other half of the same bug: two places deciding independently what
// "customer media" means. They agreed by luck until one of them didn't.
describe('one definition of what customer media is', () => {
  it('nothing hard-codes the prefix behind the constant\'s back', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(path.join(here, 'storage.js'), 'utf8');

    const declaration = /export const MEDIA_SOURCE_PREFIX = 'generations\/';/;
    expect(src, 'the shared prefix constant is gone').toMatch(declaration);

    // Every OTHER mention must go through the constant. A second literal is how
    // the sync and the check drifted apart in the first place.
    const stray = src.replace(declaration, '').match(/'generations\//g) || [];
    expect(stray,
      'storage.js hard-codes the media prefix somewhere instead of using '
      + 'MEDIA_SOURCE_PREFIX — that is exactly how the sync and the SOP check '
      + 'came to count different sets.').toEqual([]);
  });
});

// ─── being over is a fact about now, not a projection ────────────────────────
// From the owner's production screenshot, 2026-08-20:
//
//   Storage used — Backblaze B2 · 713.6% of 10 GB free
//   71.4 GB of 10 GB free (714%) · 11,394 objects · growing at an unknown rate
//   Do: Add a payment method to Backblaze BEFORE this is crossed.
//
// Two things wrong at once. "ALREADY OVER" lived inside the growth branch, so
// it printed only when a daily rate was known — 714% on screen and not one word
// saying the limit was passed. And the instruction still said "BEFORE this is
// crossed", seven times past crossing, which reads as though there is time.
describe('when the allowance is already passed', () => {
  const over = { bytes: 71.4e9, objects: 11_394, bucket: 'voxel-offsite-backups' };

  it('says so without needing to know the growth rate', () => {
    const v = judgeUsage({ provider: 'offsite', measurement: over, history: [] });
    expect(v.detail).toMatch(/ALREADY OVER the allowance by 61\.4 GB/);
    expect(v.detail).toMatch(/unknown rate/);   // still honest about the rate
  });

  it('stops telling you to act BEFORE something that has happened', () => {
    const v = judgeUsage({ provider: 'offsite', measurement: over });
    expect(v.action, 'the instruction still described a future event')
      .not.toMatch(/BEFORE this is crossed/);
    expect(v.action).toMatch(/ALREADY passed/);
    expect(v.action).toMatch(/payment method/);
  });

  // 714% of a free tier reads like a catastrophe. It is about fifty cents.
  // The difference between those two readings is a decision and a panic.
  it('says what the excess actually costs', () => {
    const v = judgeUsage({ provider: 'offsite', measurement: over });
    expect(v.detail).toMatch(/about \$0\.43 per month at this size/);
  });

  it('never prints a crossing date for something already crossed', () => {
    const at = (d) => new Date(Date.UTC(2026, 7, d));
    const v = judgeUsage({ provider: 'offsite', measurement: over, history: [
      { bytes: 50e9, at: at(15) }, { bytes: 60e9, at: at(16) }, { bytes: 71.4e9, at: at(17) },
    ] });
    expect(v.detail).not.toMatch(/crosses the allowance in/);
    expect(v.detail).toMatch(/ALREADY OVER/);
  });

  // Each provider's consequence is different and the wording must carry it.
  it('a full database says the platform stops, not that it costs more', () => {
    const v = judgeUsage({ provider: 'database', measurement: { bytes: 11 * GIB, objects: 1 } });
    expect(v.action).toMatch(/DISK IS FULL/);
    expect(v.action).toMatch(/refusing writes/);
    // Not a blanket ban on the word — "no invoice warns you" is the point.
    // What it must never do is frame a full disk AS a billing event.
    expect(v.action, 'a full database was framed as something you simply pay for')
      .not.toMatch(/larger invoice|bills automatically|simply bills/i);
  });

  it('over-quota Spaces says nothing breaks, because nothing does', () => {
    const v = judgeUsage({ provider: 'spaces', measurement: { bytes: 260 * GIB, objects: 1 } });
    expect(v.action).toMatch(/Nothing breaks/);
    expect(v.detail).toMatch(/about \$0\.20 per month/);
  });

  it('under the allowance, none of this appears', () => {
    const v = judgeUsage({ provider: 'offsite', measurement: { bytes: 5e9, objects: 10 } });
    expect(v.detail).not.toMatch(/ALREADY OVER|per month at this size/);
    expect(v.state).toBe('ok');
  });
});
