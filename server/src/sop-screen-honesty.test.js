// ─── sop-screen-honesty.test.js ──────────────────────────────────────────────
// Six defects found by the owner photographing the whole SOP screen on
// production, 2026-08-20, and asking "is there any mistake here".
//
// Not one of them was a broken check. Every check was reading the right thing.
// They were all failures of what the screen SAID about what it read — a green
// line above the words "never checked", a header counting eleven above a list
// of six, one number rounded two ways in a single sentence, and a security note
// describing a live exposure as already handled.
//
// That is the harder class of bug, and the reason it is worth its own file: a
// wrong number gets challenged, whereas a line that quietly disagrees with
// itself just erodes belief in the whole screen until nobody reads it.

import { describe, it, expect } from 'vitest';
import { backupLine, failureRateLine } from './sop-engine.js';
import { judgeUsage, GIB } from './storage-usage.js';

const NOW = Date.UTC(2026, 7, 20, 12, 0, 0);

describe('a line must not contradict itself', () => {
  // "Daily backup · both copies fresh" in green, and directly beneath it,
  // "never checked". The freshness came from listing BOTH buckets on that very
  // page load; only the timestamp was missing.
  it('says when it looked, because it looked just now', () => {
    const l = backupLine({
      backupFreshness: { state: 'ok', detail: 'Spaces 3.7 h ago · Backblaze 3.7 h ago' },
      now: NOW,
    });
    expect(l.value).toBe('both copies fresh');
    expect(l.checked_at, 'a freshly-read line reported "never checked"').toBeTruthy();
    expect(new Date(l.checked_at).getTime()).toBe(NOW);
  });
});

describe('the detail slot holds data, never an illustration', () => {
  // The detail read "3 failures out of 4 is 75% and means nothing" — a fixed
  // sentence, in the position every other line uses for real numbers, beside a
  // value of "0 attempts". It read as though three requests had just failed.
  it('with no attempts, says there were none', () => {
    const l = failureRateLine({ spends: 0, failures: 0, accountDry: 0, now: NOW });
    expect(l.value).toBe('0 attempts');
    expect(l.detail, 'an example was printed where the data goes').not.toMatch(/3 failures out of 4/);
    expect(l.detail).toMatch(/nothing to judge/);
  });

  it('with a few attempts, reports the real ones', () => {
    const l = failureRateLine({ spends: 7, failures: 3, accountDry: 0, now: NOW });
    expect(l.detail).toMatch(/3 of 10 failed/);
    expect(l.detail).toMatch(/above 25/);          // says where a rate starts
    expect(l.state).toBe('ok');                     // still too few to judge
  });
});

describe('a bounded list says it is bounded', () => {
  // The header said 11 and the detail listed 6, with nothing to mark the gap —
  // so it read as a complete list disagreeing with its own count.
  const many = Array.from({ length: 11 }, (_, i) => `col_${i + 1} (602 rows)`);

  it('names what it hid', () => {
    const shown = many.slice(0, 6).join(' · ')
      + (many.length > 6 ? ` … and ${many.length - 6} more` : '');
    expect(shown).toMatch(/… and 5 more/);
    expect(shown.split(' · ')).toHaveLength(6);
  });

  it('stays silent about a gap when there is none', () => {
    const few = many.slice(0, 4);
    const shown = few.slice(0, 6).join(' · ')
      + (few.length > 6 ? ` … and ${few.length - 6} more` : '');
    expect(shown).not.toMatch(/more/);
  });
});

describe('one measurement, one rounding', () => {
  // "Storage used — DigitalOcean Spaces · 26.6% of 250 GiB" in the heading,
  // "(27%)" in the detail beneath it. Same bytes, two roundings, one line.
  it('the heading percentage and the detail percentage agree', () => {
    const v = judgeUsage({
      provider: 'spaces',
      measurement: { bytes: 66.4 * GIB, objects: 11_386, bucket: 'voxel-ai-store' },
    });
    expect(v.detail).toContain(`(${v.pct}%)`);
    expect(v.detail).toMatch(/\(26\.6%\)/);
    expect(v.detail, 'the detail rounded the same number differently').not.toMatch(/\(27%\)/);
  });
});
