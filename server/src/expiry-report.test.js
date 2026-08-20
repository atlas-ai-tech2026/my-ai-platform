// ─── expiry-report.test.js ───────────────────────────────────────────────────
// The owner, 2026-08-20, urgently: accounts created on 21–23 June, "as per our
// standard, all these accounts will expire tomorrow... I need a proper answer."
//
// There was no way to give one. The Users tab shows an access column per row
// and nothing sorts or filters by it, so answering meant scrolling 601 rows —
// which produces a guess, not an answer. And nothing warned in advance, so the
// first sign of an expiry was a customer unable to sign in.
//
// The single most important thing this file encodes: expiry LOCKS THE DOOR, it
// does not demolish the building. Nothing is deleted and it is fully
// reversible. Anyone reading "47 accounts expire tomorrow" needs that clause
// more than any other, so it travels with every response.

import { describe, it, expect } from 'vitest';
import {
  daysUntil, groupByExpiryDay, summarise, actionable, SOON_DAYS,
} from './expiry-report.js';

const NOW = new Date('2026-08-20T12:00:00Z').getTime();
const u = (id, email, expires_at, credits = 0) => ({ id, email, expires_at, credits, package: 'Workshop' });

describe('how long is left', () => {
  it('counts whole days, from the start of each day', () => {
    expect(daysUntil('2026-08-21T00:00:00Z', NOW)).toBe(1);
    expect(daysUntil('2026-08-20T23:59:00Z', NOW)).toBe(0);
    expect(daysUntil('2026-08-27T00:00:00Z', NOW)).toBe(7);
  });

  // An expiry stored as a bare date is MIDNIGHT UTC, which is 3am in Kuwait.
  // "Expires on the 21st" means access ends in the small hours of the 21st,
  // not at the end of that day — a distinction that decides whether a workshop
  // on the 21st works.
  it('an expiry already past reads as negative, not as zero', () => {
    expect(daysUntil('2026-08-18T00:00:00Z', NOW)).toBe(-2);
  });

  it('no expiry is null, never a number', () => {
    expect(daysUntil(null, NOW)).toBeNull();
    expect(daysUntil('nonsense', NOW)).toBeNull();
  });
});

describe('grouped by the day access ends', () => {
  // By day, because the question is never "when does ahmed expire" — it is
  // "who goes tomorrow, and is that a workshop".
  const users = [
    u(1, 'a@x.com', '2026-08-21T00:00:00Z', 100),
    u(2, 'b@x.com', '2026-08-21T00:00:00Z', 50),
    u(3, 'c@x.com', '2026-08-25T00:00:00Z', 10),
    u(4, 'd@x.com', null),                          // open-ended
    u(5, 'e@x.com', '2026-08-01T00:00:00Z', 7),     // already gone
  ];
  const report = groupByExpiryDay(users, NOW);

  it('puts everyone sharing a date together, with their credits', () => {
    const tomorrow = report.days.find((d) => d.day === '2026-08-21');
    expect(tomorrow.accounts).toHaveLength(2);
    expect(tomorrow.credits).toBe(150);
    expect(tomorrow.daysLeft).toBe(1);
  });

  it('counts open-ended accounts separately, and does not call them safe', () => {
    expect(report.openEnded).toBe(1);
  });

  it('counts the ones already past', () => {
    expect(report.alreadyExpired).toBe(1);
  });

  it('orders the days forwards', () => {
    expect(report.days.map((d) => d.day))
      .toEqual(['2026-08-01', '2026-08-21', '2026-08-25']);
  });

  it('keeps the exact moment, not only the date', () => {
    expect(report.days.find((d) => d.day === '2026-08-21').accounts[0].at)
      .toBe('2026-08-21T00:00:00.000Z');
  });

  it('treats an unreadable date as open-ended rather than dropping the account', () => {
    const r = groupByExpiryDay([u(9, 'z@x.com', 'not-a-date')], NOW);
    expect(r.openEnded).toBe(1);
    expect(r.total).toBe(1);
  });
});

describe('the sentence the owner needs', () => {
  it('leads with TOMORROW when something goes tomorrow', () => {
    const r = groupByExpiryDay([u(1, 'a@x.com', '2026-08-21T00:00:00Z', 10)], NOW);
    expect(summarise(r, NOW).headline).toMatch(/1 lose access TOMORROW/);
  });

  it('says TODAY too, because that is already happening', () => {
    const r = groupByExpiryDay([u(1, 'a@x.com', '2026-08-20T23:00:00Z')], NOW);
    expect(summarise(r, NOW).headline).toMatch(/lose access TODAY/);
  });

  it('when nothing is imminent, says what IS next rather than just "fine"', () => {
    const r = groupByExpiryDay([u(1, 'a@x.com', '2026-08-27T00:00:00Z')], NOW);
    expect(summarise(r, NOW).headline).toMatch(/next is 2026-08-27 \(7 days\)/);
  });

  it('says plainly when nothing is coming at all', () => {
    const r = groupByExpiryDay([u(1, 'a@x.com', null)], NOW);
    expect(summarise(r, NOW).headline).toMatch(/nothing expires in the next 14 days/);
  });

  // THE CLAUSE THAT MATTERS MOST. The fear behind the question is that
  // customers and their work disappear. They do not.
  it('always states that nothing is deleted and it is reversible', () => {
    const r = groupByExpiryDay([u(1, 'a@x.com', '2026-08-21T00:00:00Z')], NOW);
    const s = summarise(r, NOW);
    expect(s.reassurance).toMatch(/blocks sign-in only/);
    expect(s.reassurance).toMatch(/No account, credit or generation is deleted/);
    expect(s.reassurance).toMatch(/restores access immediately/);
  });

  it('totals the credits sitting behind the accounts about to lock', () => {
    const r = groupByExpiryDay([
      u(1, 'a@x.com', '2026-08-21T00:00:00Z', 100),
      u(2, 'b@x.com', '2026-08-22T00:00:00Z', 55.5),
      u(3, 'c@x.com', '2027-01-01T00:00:00Z', 999),   // outside the window
    ], NOW);
    const s = summarise(r, NOW);
    expect(s.withinWindow).toBe(2);
    expect(s.creditsAffected).toBe(155.5);
  });
});

describe('what to act on', () => {
  const r = groupByExpiryDay([
    u(1, 'a@x.com', '2026-08-21T00:00:00Z'),
    u(2, 'b@x.com', '2026-09-30T00:00:00Z'),      // beyond the window
    u(3, 'c@x.com', '2026-08-01T00:00:00Z'),      // already gone
    u(4, 'd@x.com', '2026-08-25T00:00:00Z'),
  ], NOW);

  it('lists only what is still savable, soonest first', () => {
    expect(actionable(r).map((d) => d.day)).toEqual(['2026-08-21', '2026-08-25']);
  });

  it('leaves out what has already passed — that needs a different decision', () => {
    expect(actionable(r).some((d) => d.day === '2026-08-01')).toBe(false);
  });

  it('honours a narrower window when you only care about this week', () => {
    expect(actionable(r, 2).map((d) => d.day)).toEqual(['2026-08-21']);
  });

  it('defaults to a fortnight', () => {
    expect(SOON_DAYS).toBe(14);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("the owner's actual case: accounts created 21-23 June", () => {
  // Their standard was described as roughly two months of access. This is the
  // shape that produces — three consecutive creation days becoming three
  // consecutive expiry days, which is exactly why grouping by day matters.
  const june = [
    u(1, 'attendee1@org.com', '2026-08-21T00:00:00Z', 40),
    u(2, 'attendee2@org.com', '2026-08-21T00:00:00Z', 12),
    u(3, 'attendee3@org.com', '2026-08-22T00:00:00Z', 0),
    u(4, 'attendee4@org.com', '2026-08-23T00:00:00Z', 95),
  ];
  const r = groupByExpiryDay(june, NOW);
  const s = summarise(r, NOW);

  it('says how many go tomorrow, and what is behind them', () => {
    expect(s.headline).toMatch(/2 lose access TOMORROW/);
    expect(s.withinWindow).toBe(4);
    expect(s.creditsAffected).toBe(147);
  });

  it('spreads them across the three days they were created on', () => {
    expect(actionable(r).map((d) => `${d.day}:${d.accounts.length}`))
      .toEqual(['2026-08-21:2', '2026-08-22:1', '2026-08-23:1']);
  });

  it('names them, so they can be extended one by one if that is the decision', () => {
    expect(actionable(r)[0].accounts.map((a) => a.email))
      .toEqual(['attendee1@org.com', 'attendee2@org.com']);
  });
});
