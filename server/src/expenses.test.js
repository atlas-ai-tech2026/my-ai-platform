// ─── expenses.test.js ────────────────────────────────────────────────────────
// Requested 2026-08-19: costs are spread across eight providers and nowhere adds
// them up, so there is no break-even figure and quoting a workshop is a guess.
//
// Two rules run through all of this:
//
//   NEVER ASK FOR WHAT IS ALREADY KNOWN. FAL and kie cost is on every ledger
//   row already; typing it would be stale on arrival and less accurate than
//   what is held. Only the handful that barely moves gets typed.
//
//   BEFORE, NOT ON THE DAY. If voxel-ai.ai lapses, the site AND every email
//   address stop — including the one password resets come from. That is not a
//   missed bill, it is the platform and the means of recovering it, gone
//   together.

import { describe, it, expect } from 'vitest';
import {
  monthlyCost, runRate, byCategory, breakEven, renewals, renewalHeadline,
  monthlySeries, isActive, CYCLES, RENEWAL_WARN_DAYS, round2,
  calendarDay, daysBetween,
} from './expenses.js';

const NOW = new Date('2026-08-21T12:00:00Z').getTime();
const e = (over = {}) => ({
  id: 1, name: 'Thing', amount: 12, cycle: 'monthly',
  category: 'infrastructure', renews_on: null, cancelled_at: null, ...over,
});

describe('reducing everything to a monthly figure', () => {
  it('monthly is itself', () => {
    expect(monthlyCost(e({ amount: 43.22 }))).toBe(43.22);
  });

  it('annual is spread across twelve months', () => {
    expect(monthlyCost(e({ amount: 120, cycle: 'annual' }))).toBe(10);
  });

  // A one-time cost is real money and belongs in its own month's total — but
  // spreading it across the year would inflate the run rate with something that
  // will not happen again, and break-even is exactly what that number feeds.
  it('a one-time cost adds NOTHING to the monthly run rate', () => {
    expect(monthlyCost(e({ amount: 500, cycle: 'one-time' }))).toBe(0);
  });

  it.each([[0], [-5], [null], [undefined], ['abc']])('ignores a nonsense amount: %s', (amount) => {
    expect(monthlyCost(e({ amount }))).toBe(0);
  });

  it('knows only the three cycles that were agreed', () => {
    expect(CYCLES).toEqual(['monthly', 'annual', 'one-time']);
    expect(monthlyCost(e({ cycle: 'weekly' }))).toBe(0);
  });
});

describe('cancelled costs stay in history and stop counting', () => {
  // A cost that disappears from history makes last quarter look wrong.
  const live = e({ id: 1, amount: 10 });
  const dead = e({ id: 2, amount: 99, cancelled_at: '2026-07-01' });

  it('a cancelled entry is not active', () => {
    expect(isActive(live)).toBe(true);
    expect(isActive(dead)).toBe(false);
  });

  it('and is left out of the run rate, but still counted as existing', () => {
    const r = runRate([live, dead]);
    expect(r.fixed).toBe(10);
    expect(r.cancelled).toBe(1);
  });
});

describe('the run rate keeps typed and measured apart', () => {
  // Variable cost rises WITH customers. Folding it into the fixed figure would
  // make break-even move every time somebody generated an image.
  const list = [
    e({ id: 1, name: 'DigitalOcean', amount: 43.22, category: 'infrastructure' }),
    e({ id: 2, name: 'GoDaddy', amount: 96, cycle: 'annual', category: 'domain' }),
    e({ id: 3, name: 'Claude', amount: 100, category: 'tools' }),
  ];

  it('adds the typed ones into a fixed monthly figure', () => {
    expect(runRate(list).fixed).toBe(151.22);        // 43.22 + 8 + 100
  });

  it('keeps the measured supplier cost separate', () => {
    const r = runRate(list, { fal: 30.5, kie: 12.25 });
    expect(r.variable).toBe(42.75);
    expect(r.total).toBe(193.97);
    expect(r.fixed, 'supplier cost leaked into the fixed figure').toBe(151.22);
  });

  it('groups by category, biggest first', () => {
    expect(byCategory(list)).toEqual([
      { category: 'tools', monthly: 100 },
      { category: 'infrastructure', monthly: 43.22 },
      { category: 'domain', monthly: 8 },
    ]);
  });
});

describe('break-even — the number that makes a workshop quotable', () => {
  it('is fixed cost divided by margin, rounded UP', () => {
    // 151.22 / 20 = 7.56 → eight customers, because seven do not cover it.
    expect(breakEven(151.22, 20).subscriptions).toBe(8);
  });

  it('uses FIXED cost only, so the answer does not move with usage', () => {
    expect(breakEven(151.22, 20).fixedMonthly).toBe(151.22);
  });

  // "∞" on a screen reads as a bug, and a made-up margin reads as a fact.
  it.each([[0], [-5], [null], [undefined], [NaN], ['abc']])(
    'returns null rather than inventing an answer when margin is %s', (margin) => {
      expect(breakEven(151.22, margin)).toBeNull();
    });

  it('a business with no fixed costs breaks even at zero customers', () => {
    expect(breakEven(0, 20).subscriptions).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('renewals warn BEFORE, never on the day', () => {
  const inDays = (d) => new Date(NOW + d * 86400000).toISOString().slice(0, 10);

  it('warns at the three agreed distances', () => {
    expect(RENEWAL_WARN_DAYS).toEqual([60, 30, 7]);
  });

  it.each([
    [90, 'ok'],
    [45, 'soon'],
    [20, 'warn'],
    [5, 'critical'],
    [0, 'critical'],
    [-3, 'overdue'],
  ])('%s days away reads as %s', (days, state) => {
    const [r] = renewals([e({ renews_on: inDays(days) })], NOW);
    expect(r.state).toBe(state);
    expect(r.daysLeft).toBe(days);
  });

  it('orders them by what happens first', () => {
    const list = renewals([
      e({ id: 1, name: 'far', renews_on: inDays(200) }),
      e({ id: 2, name: 'near', renews_on: inDays(3) }),
      e({ id: 3, name: 'past', renews_on: inDays(-10) }),
    ], NOW);
    expect(list.map((r) => r.name)).toEqual(['past', 'near', 'far']);
  });

  it('ignores costs with no renewal date, and cancelled ones entirely', () => {
    const list = renewals([
      e({ id: 1, renews_on: null }),
      e({ id: 2, renews_on: inDays(5), cancelled_at: '2026-01-01' }),
    ], NOW);
    expect(list).toEqual([]);
  });

  it('survives an unreadable date rather than throwing', () => {
    expect(renewals([e({ renews_on: 'not-a-date' })], NOW)).toEqual([]);
  });
});

describe('the renewal headline', () => {
  const inDays = (d) => new Date(NOW + d * 86400000).toISOString().slice(0, 10);

  it('leads with anything already overdue', () => {
    const h = renewalHeadline(renewals([
      e({ id: 1, name: 'GoDaddy', renews_on: inDays(-2), critical: true }),
      e({ id: 2, name: 'Resend', renews_on: inDays(5) }),
    ], NOW));
    expect(h.state).toBe('overdue');
    expect(h.text).toMatch(/GoDaddy renewal date has passed/);
  });

  // THE ONE THAT TAKES EVERYTHING WITH IT. If the domain lapses the site and
  // every email address stop, including the address password resets come from.
  it('names the critical one first when several are overdue', () => {
    const h = renewalHeadline(renewals([
      e({ id: 1, name: 'Resend', renews_on: inDays(-5) }),
      e({ id: 2, name: 'GoDaddy', renews_on: inDays(-1), critical: true }),
    ], NOW));
    expect(h.text).toMatch(/^GoDaddy/);
    expect(h.text).toMatch(/and 1 more/);
  });

  it('otherwise names what is coming next', () => {
    const h = renewalHeadline(renewals([e({ name: 'GoDaddy', renews_on: inDays(6) })], NOW));
    expect(h.state).toBe('critical');
    expect(h.text).toMatch(/GoDaddy renews in 6 days/);
  });

  it('says plainly when nothing is coming', () => {
    expect(renewalHeadline(renewals([e({ renews_on: inDays(120) })], NOW)).text)
      .toBe('nothing renews in the next 30 days');
  });

  it('and when there are no renewal dates at all', () => {
    expect(renewalHeadline([]).state).toBe('ok');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('month by month, so a rising bill is seen coming', () => {
  // Real DigitalOcean invoices, read from their API on 2026-08-21.
  const invoices = [
    { month: '2026-04', amount: 2.72 },
    { month: '2026-05', amount: 14.00 },
    { month: '2026-06', amount: 28.27 },
    { month: '2026-07', amount: 31.00 },
    { month: '2026-08', amount: 43.22 },
  ];
  const measured = [
    { month: '2026-07', fal: 12.5, kie: 4 },
    { month: '2026-08', fal: 20, kie: 6.75 },
  ];
  const series = monthlySeries({ invoices, measured, months: 6, now: NOW });

  it('covers the months asked for, oldest first, none missing', () => {
    expect(series.map((r) => r.month)).toEqual(
      ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08']);
  });

  it('a month with no data is zero, not absent', () => {
    expect(series[0]).toEqual({ month: '2026-03', infrastructure: 0, suppliers: 0, total: 0 });
  });

  // Separate lines on purpose: a jump in SUPPLIERS means customers generated
  // more, which is good news. A jump in INFRASTRUCTURE means a subscription
  // changed, which is not.
  it('keeps infrastructure and supplier cost on separate lines', () => {
    const aug = series.find((r) => r.month === '2026-08');
    expect(aug.infrastructure).toBe(43.22);
    expect(aug.suppliers).toBe(26.75);
    expect(aug.total).toBe(69.97);
  });

  it('shows the real growth that is actually happening', () => {
    const infra = series.map((r) => r.infrastructure).filter(Boolean);
    expect(infra).toEqual([2.72, 14, 28.27, 31, 43.22]);
  });
});

describe('the arithmetic', () => {
  it('rounds to cents, because money does', () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(monthlyCost(e({ amount: 100, cycle: 'annual' }))).toBe(8.33);
  });
});

// ─── a renewal date is a CALENDAR DAY, not a moment ──────────────────────────
// Found on 2026-08-21 by a check that expected 5 days and got 4.
//
// node-postgres hands back a DATE column as LOCAL midnight. In Kuwait (UTC+3)
// the 26th arrives as 2026-08-25T21:00Z, so flooring it in UTC produced the
// 25th. Every renewal would have displayed a day early — and said OVERDUE a day
// before it was, which on a screen about money is exactly the kind of wrongness
// that stops the screen being believed.
describe('renewal dates survive the timezone', () => {
  it('reads a plain YYYY-MM-DD verbatim', () => {
    expect(calendarDay('2026-08-26')).toBe('2026-08-26');
    expect(calendarDay('2026-08-26T00:00:00Z')).toBe('2026-08-26');
  });

  // THE CASE THAT WAS WRONG. This is exactly what pg produces for DATE
  // '2026-08-26' when the server clock is east of UTC.
  it('reads a Date that pg built at LOCAL midnight as the day it was written', () => {
    const fromPg = new Date(2026, 7, 26, 0, 0, 0);      // local midnight, 26 Aug
    expect(calendarDay(fromPg),
      'a DATE column was shifted back a day by UTC flooring').toBe('2026-08-26');
  });

  it('counts whole days with no timezone in the arithmetic', () => {
    expect(daysBetween('2026-08-21', '2026-08-26')).toBe(5);
    expect(daysBetween('2026-08-21', '2026-08-21')).toBe(0);
    expect(daysBetween('2026-08-21', '2026-08-18')).toBe(-3);
    expect(daysBetween('2026-08-28', '2026-09-02')).toBe(5);   // across a month
    expect(daysBetween('2026-12-30', '2027-01-02')).toBe(3);   // across a year
  });

  it('a renewal five days out reports five, not four', () => {
    const inFive = new Date(2026, 7, 26, 0, 0, 0);            // as pg would give it
    const [r] = renewals([e({ renews_on: inFive })], new Date(2026, 7, 21, 12).getTime());
    expect(r.daysLeft).toBe(5);
    expect(r.renews_on).toBe('2026-08-26');
    expect(r.state).toBe('critical');
  });

  it('and is not called OVERDUE on the day before it is due', () => {
    const tomorrow = new Date(2026, 7, 22, 0, 0, 0);
    const [r] = renewals([e({ renews_on: tomorrow })], new Date(2026, 7, 21, 23, 30).getTime());
    expect(r.daysLeft).toBe(1);
    expect(r.state, 'a renewal due tomorrow was reported as overdue').not.toBe('overdue');
  });
});
