// ─── sop-schedule.test.js ────────────────────────────────────────────────────
// Two failures this file exists to prevent, both of which already happened:
//   · a 30-day setInterval overflowed int32 and ran 294 times in five seconds
//   · an unlabelled clock rendered every expiry date a day early (UTC vs +3)

import { describe, it, expect } from 'vitest';
import {
  JOBS, EVERY_MS, isDue, validate, defaultsFor,
  kuwaitHourToUtc, utcHourToKuwait, KUWAIT_UTC_OFFSET,
} from './sop-schedule.js';

const at = (iso) => new Date(iso);

describe('the clock is labelled — Kuwait in, UTC stored', () => {
  it('converts both ways and round-trips', () => {
    expect(KUWAIT_UTC_OFFSET).toBe(3);
    expect(kuwaitHourToUtc(6)).toBe(3);
    expect(utcHourToKuwait(3)).toBe(6);
    for (let h = 0; h < 24; h++) expect(utcHourToKuwait(kuwaitHourToUtc(h))).toBe(h);
  });

  // The wrap is where an unlabelled clock goes wrong by a whole day.
  it('wraps correctly around midnight', () => {
    expect(kuwaitHourToUtc(1)).toBe(22);
    expect(kuwaitHourToUtc(0)).toBe(21);
    expect(utcHourToKuwait(22)).toBe(1);
    expect(utcHourToKuwait(23)).toBe(2);
  });
});

describe('due-ness is computed from the LAST RUN, never from a timer', () => {
  const row = { enabled: true, every: 'month', hour_utc: 1 };

  it('runs a job that has never run', () => {
    expect(isDue(row, { lastRunIso: null }).due).toBe(true);
  });

  it('does not run again inside its period', () => {
    const v = isDue(row, { lastRunIso: '2026-08-18T01:00:00Z', now: at('2026-08-20T01:00:00Z') });
    expect(v.due).toBe(false);
    expect(v.reason).toMatch(/every month/);
  });

  it('runs once the period has passed and the hour matches', () => {
    expect(isDue(row, { lastRunIso: '2026-07-01T01:00:00Z', now: at('2026-08-18T01:30:00Z') }).due).toBe(true);
  });

  // A long-overdue job must not fire at 3am just because the server restarted.
  it('waits for the chosen hour even when overdue', () => {
    const v = isDue(row, { lastRunIso: '2026-01-01T01:00:00Z', now: at('2026-08-18T03:00:00Z') });
    expect(v.due).toBe(false);
    expect(v.reason).toMatch(/waiting for 1:00 UTC/);
  });

  it('never runs a disabled job', () => {
    expect(isDue({ ...row, enabled: false }, { lastRunIso: null }).due).toBe(false);
  });

  it('refuses an unknown period rather than guessing one', () => {
    expect(isDue({ enabled: true, every: 'fortnight', hour_utc: 1 }, { lastRunIso: null }).due).toBe(false);
  });

  // Every period must be well under the 32-bit millisecond ceiling IF anyone
  // ever hands one to a timer again.
  it('every period is a plain number of days, not a timer value', () => {
    for (const [k, ms] of Object.entries(EVERY_MS)) {
      expect(Number.isFinite(ms), k).toBe(true);
      expect(ms).toBeGreaterThan(0);
    }
    expect(EVERY_MS.month).toBeGreaterThan(2 ** 31 - 1);   // exactly why it is NOT a timer
  });
});

describe('validation', () => {
  it('accepts a sane row and stores the UTC hour', () => {
    const v = validate({ job: 'restore', enabled: true, every: 'month', hourKuwait: 4 });
    expect(v.ok).toBe(true);
    expect(v.row.hour_utc).toBe(1);
  });

  it('rejects an unknown job, period or hour', () => {
    expect(validate({ job: 'nope', every: 'day', hourKuwait: 1 }).ok).toBe(false);
    expect(validate({ job: 'smoke', every: 'hourly', hourKuwait: 1 }).ok).toBe(false);
    for (const h of [-1, 24, 1.5, 'x', null]) {
      expect(validate({ job: 'smoke', every: 'day', hourKuwait: h }).ok, String(h)).toBe(false);
    }
  });
});

describe('the jobs and their cadences', () => {
  it('has the three jobs, each with an explanation for the ⓘ', () => {
    expect(Object.keys(JOBS).sort()).toEqual(['integrity', 'restore', 'smoke']);
    for (const [k, j] of Object.entries(JOBS)) {
      expect(j.info.length, `${k} needs an explanation`).toBeGreaterThan(60);
      expect(EVERY_MS[j.every], `${k} has an unknown period`).toBeTruthy();
    }
  });

  // Cost differs by orders of magnitude, so one shared cadence would be wrong
  // for nearly all of them.
  it('runs the expensive check least often', () => {
    expect(JOBS.restore.every).toBe('month');
    expect(JOBS.smoke.every).toBe('day');
    expect(EVERY_MS[JOBS.restore.every]).toBeGreaterThan(EVERY_MS[JOBS.smoke.every]);
  });

  it('defaults to early-morning Kuwait time, not the middle of a workshop', () => {
    for (const job of Object.keys(JOBS)) {
      const h = JOBS[job].defaultHourKuwait;
      expect(h, job).toBeGreaterThanOrEqual(0);
      expect(h, job).toBeLessThan(8);
      expect(defaultsFor(job).hour_utc).toBe(kuwaitHourToUtc(h));
    }
  });
});

// Number(null) and Number('') are both 0, so an absent hour would have passed
// the range check and scheduled the job for midnight — an hour nobody chose.
// The same shape as every other bug here where a missing value quietly became
// a plausible one.
describe('an absent hour is rejected, not defaulted to midnight', () => {
  it('refuses null, undefined and empty string', () => {
    for (const h of [null, undefined, '']) {
      expect(validate({ job: 'smoke', enabled: true, every: 'day', hourKuwait: h }).ok,
        JSON.stringify(h)).toBe(false);
    }
  });

  it('still accepts a real midnight', () => {
    const v = validate({ job: 'smoke', enabled: true, every: 'day', hourKuwait: 0 });
    expect(v.ok).toBe(true);
    expect(v.row.hour_utc).toBe(21);   // 00:00 Kuwait is 21:00 UTC
  });
});
