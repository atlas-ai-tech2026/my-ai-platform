// ─── backup-freshness.test.js ────────────────────────────────────────────────
// The SOP screen said "Daily backup — NOT CHECKED · No backup has been recorded
// since this server started" while backups were running perfectly, twice, to
// both destinations. The owner saw it, refused the reassurance, and asked.
//
// The status was a module-level object wiped by every restart, and the backup
// runs five minutes after boot. This app deploys several times a day, so the
// line spent much of its life saying "not checked" — which is indistinguishable
// from "the job is dead". A light that flickers for its own reasons is worse
// than no light: it teaches you to stop looking at it.
//
// So these tests are about the two things that matter — asking the BUCKET
// rather than a variable, and never letting one dead destination hide behind
// the other.

import { describe, it, expect } from 'vitest';
import {
  newest, hoursSince, judgeDestination, judgeBackups,
  STALE_AFTER_HOURS, CRITICAL_AFTER_HOURS,
} from './backup-freshness.js';

const NOW = Date.UTC(2026, 7, 20, 12, 0, 0);
const hoursAgo = (h) => new Date(NOW - h * 36e5).toISOString();
const obj = (key, h) => ({ key, modified: hoursAgo(h), size: 100 });
const listing = (objects) => ({ objects });

describe('finding the newest archive', () => {
  it('picks the most recent, not the first or last in the list', () => {
    const r = newest([obj('old', 50), obj('newest', 2), obj('mid', 20)]);
    expect(r.key).toBe('newest');
  });

  it('returns nothing for an empty bucket', () => {
    expect(newest([])).toBeNull();
  });

  it('ignores entries with an unusable date rather than crashing', () => {
    const r = newest([{ key: 'bad', modified: 'not-a-date' }, obj('good', 1)]);
    expect(r.key).toBe('good');
  });
});

describe('judging one destination', () => {
  it('is happy with a backup from this morning', () => {
    const v = judgeDestination({ label: 'x', listing: listing([obj('b', 3)]), now: NOW });
    expect(v.state).toBe('ok');
    expect(v.detail).toMatch(/3\.0 h ago/);
    expect(v.action).toBeNull();
  });

  it('shows minutes, not a meaningless 0.1 h, for a very recent one', () => {
    const v = judgeDestination({ label: 'x', listing: listing([obj('b', 0.25)]), now: NOW });
    expect(v.detail).toMatch(/15 min ago/);
  });

  // The job runs every 24h, so 36 allows exactly one miss before complaining.
  it('warns after a missed daily run', () => {
    const v = judgeDestination({ label: 'x', listing: listing([obj('b', STALE_AFTER_HOURS + 1)]), now: NOW });
    expect(v.state).toBe('warn');
    expect(v.action).toBeTruthy();
  });

  it('escalates after two missed runs — late is not the same as broken', () => {
    const v = judgeDestination({ label: 'x', listing: listing([obj('b', CRITICAL_AFTER_HOURS + 1)]), now: NOW });
    expect(v.state).toBe('critical');
  });

  it('says CRITICAL when the bucket holds no archive at all', () => {
    const v = judgeDestination({ label: 'x', listing: listing([]), now: NOW });
    expect(v.state).toBe('critical');
    expect(v.detail).toMatch(/no backup archive found/);
  });

  // Not being able to look is not the same as having looked and been satisfied.
  it('reports an unreadable bucket as UNKNOWN, never as ok', () => {
    const v = judgeDestination({ label: 'x', listing: { error: 'AccessDenied' }, now: NOW });
    expect(v.state).toBe('unknown');
    expect(v.state).not.toBe('ok');
    expect(v.action).toBeTruthy();
  });

  // A restart must not be able to make this say anything at all. It reads the
  // bucket; there is no in-process state to wipe.
  it('depends on nothing but the listing it is handed', () => {
    const a = judgeDestination({ label: 'x', listing: listing([obj('b', 2)]), now: NOW });
    const b = judgeDestination({ label: 'x', listing: listing([obj('b', 2)]), now: NOW });
    expect(a).toEqual(b);
  });
});

describe('both destinations', () => {
  it('is happy only when both are', () => {
    const v = judgeBackups({ primary: listing([obj('p', 2)]), offsite: listing([obj('o', 2)]), now: NOW });
    expect(v.state).toBe('ok');
    expect(v.detail).toMatch(/DigitalOcean Spaces/);
    expect(v.detail).toMatch(/Backblaze/);
  });

  // THE ONE THAT MATTERS. The offsite copy exists to survive losing the
  // DigitalOcean account. A combined green light that hides a dead offsite copy
  // defeats the entire reason it is there.
  it('goes red when the OFFSITE half is dead, even with a fresh primary', () => {
    const v = judgeBackups({
      primary: listing([obj('p', 1)]),
      offsite: listing([obj('o', CRITICAL_AFTER_HOURS + 10)]),
      now: NOW,
    });
    expect(v.state, 'a dead offsite copy hid behind a healthy primary').toBe('critical');
    expect(v.action).toBeTruthy();
  });

  it('goes red when the primary is dead but the offsite is fresh', () => {
    const v = judgeBackups({
      primary: listing([]),
      offsite: listing([obj('o', 1)]),
      now: NOW,
    });
    expect(v.state).toBe('critical');
  });

  it('names both destinations even when only one is a problem', () => {
    const v = judgeBackups({
      primary: listing([obj('p', 1)]),
      offsite: { error: 'timeout' },
      now: NOW,
    });
    expect(v.state).toBe('unknown');
    expect(v.parts).toHaveLength(2);
    expect(v.detail).toMatch(/timeout/);
  });
});

describe('the age arithmetic', () => {
  it('measures hours from a timestamp', () => {
    expect(hoursSince(hoursAgo(5), NOW)).toBeCloseTo(5, 5);
  });

  it('returns nothing for a missing timestamp rather than a wrong number', () => {
    expect(hoursSince(null, NOW)).toBeNull();
  });

  it('allows exactly one missed run before warning', () => {
    expect(STALE_AFTER_HOURS).toBeGreaterThan(24);
    expect(CRITICAL_AFTER_HOURS).toBeGreaterThan(STALE_AFTER_HOURS);
  });
});
