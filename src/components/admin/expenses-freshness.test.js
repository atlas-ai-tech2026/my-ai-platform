// ─── expenses-freshness.test.js ──────────────────────────────────────────────
// The server has always sent `lastFetched` for the DigitalOcean invoice pull,
// and the Expenses tab never rendered it. So a cached cost looked exactly like
// a fresh one.
//
// That went from theoretical to real on 2026-08-23, when DigitalOcean's API
// started returning 504 while I was checking a deploy. The pull would have
// failed, the tab would have shown the cached figure, and nothing on screen
// would have said it was days old.
//
// A cost you believe is current, and is not, is worse than no cost at all —
// because you act on it.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { staleHours, freshnessLine } from './ExpensesTab';

const hoursAgo = (h) => new Date(Date.now() - h * 36e5).toISOString();
afterEach(() => vi.useRealTimers());

describe('how old is this number', () => {
  it('measures the gap in hours', () => {
    expect(staleHours(hoursAgo(5))).toBeCloseTo(5, 1);
  });

  it('treats an unreadable date as STALE, not fresh', () => {
    // Defaulting the other way would present a broken timestamp as "just now".
    expect(staleHours('not a date')).toBe(Infinity);
    expect(staleHours(undefined)).toBe(Infinity);
  });
});

describe('what the screen says', () => {
  it('says WHEN, not "cached"', () => {
    // "Cached" is a word that makes somebody assume it is close enough.
    expect(freshnessLine(hoursAgo(5))).toMatch(/pulled 5 hours ago/);
    expect(freshnessLine(hoursAgo(5))).not.toMatch(/cached/i);
  });

  it('under an hour reads as fresh', () => {
    expect(freshnessLine(hoursAgo(0.2))).toMatch(/less than an hour/);
  });

  it('gets the singular right', () => {
    expect(freshnessLine(hoursAgo(1))).toMatch(/1 hour ago/);
    expect(freshnessLine(hoursAgo(24))).toMatch(/24 hours ago/);
  });

  it('WARNS past a day and a half, and says what to do', () => {
    // The threshold matters: DigitalOcean's preview figure moves daily, so a
    // two-day-old number is a different month's spending story.
    const line = freshnessLine(hoursAgo(72));
    expect(line).toMatch(/⚠/);
    expect(line).toMatch(/3 days old/);
    expect(line, 'a warning must offer a way forward').toMatch(/Refresh|unreachable/);
  });

  it('names the provider being unreachable as a possible cause', () => {
    // Which is exactly what happened: the tab was fine, the API was 504.
    expect(freshnessLine(hoursAgo(100))).toMatch(/unreachable/);
  });

  it('does not crash on a missing timestamp', () => {
    expect(() => freshnessLine(null)).not.toThrow();
    expect(freshnessLine(null)).toMatch(/earlier pull/);
  });
});
