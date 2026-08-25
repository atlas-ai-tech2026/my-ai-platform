// ─── credit-backfill.test.js ─────────────────────────────────────────────────
// The retroactive half of the owner's 2026-08-25 rule: existing balances get
// dated from when their credits were actually added. Attribution is
// newest-first because spending drains oldest-first — what remains of a
// balance can only belong to the newest additions.

import { describe, it, expect } from 'vitest';
import { planBackfill, CREDIT_LIFE_DAYS } from './credit-backfill.js';

const DAY = 86400000;
const NOW = Date.parse('2026-08-25T12:00:00Z');
const daysAgo = (n) => new Date(NOW - n * DAY).toISOString();

describe('the standard life is thirty days — the owner corrected "thirteen" themselves', () => {
  it('is 30', () => {
    expect(CREDIT_LIFE_DAYS).toBe(30);
  });
});

describe('attributing a balance to its addition dates', () => {
  it('a balance fully covered by the newest grant maps onto it alone', () => {
    const r = planBackfill({
      balance: 50,
      additions: [
        { amount: 100, action: 'grant', created_at: daysAgo(2) },
        { amount: 200, action: 'grant', created_at: daysAgo(40) },
      ],
      now: NOW,
    });
    expect(r.lots).toHaveLength(1);
    expect(r.lots[0].amount).toBe(50);
    expect(r.lots[0].granted_at.toISOString()).toBe(daysAgo(2));
    expect(r.attributed).toBe(50);
    expect(r.unattributed).toBe(0);
  });

  it('a balance larger than the newest grant spills into the one before it', () => {
    const r = planBackfill({
      balance: 130,
      additions: [
        { amount: 100, action: 'grant', created_at: daysAgo(2) },
        { amount: 200, action: 'promo', created_at: daysAgo(10) },
      ],
      now: NOW,
    });
    expect(r.lots).toHaveLength(2);
    expect(r.lots[0].amount).toBe(100);          // all of the newest
    expect(r.lots[1].amount).toBe(30);           // the remainder from the older
    expect(r.lots[1].granted_at.toISOString()).toBe(daysAgo(10));
    expect(r.attributed).toBe(130);
  });

  it('sorts additions newest-first no matter the order they arrive in', () => {
    const shuffled = [
      { amount: 10, action: 'grant', created_at: daysAgo(20) },
      { amount: 10, action: 'grant', created_at: daysAgo(1) },
      { amount: 10, action: 'grant', created_at: daysAgo(9) },
    ];
    const r = planBackfill({ balance: 15, additions: shuffled, now: NOW });
    expect(r.lots[0].granted_at.toISOString()).toBe(daysAgo(1));
    expect(r.lots[1].granted_at.toISOString()).toBe(daysAgo(9));
    expect(r.lots[1].amount).toBe(5);
  });

  it('every lot expires exactly its life after its OWN addition date', () => {
    const r = planBackfill({
      balance: 40,
      additions: [
        { amount: 20, action: 'grant', created_at: daysAgo(3) },
        { amount: 20, action: 'gift', created_at: daysAgo(45) },
      ],
      now: NOW,
    });
    expect(r.lots[0].expires_at.getTime() - r.lots[0].granted_at.getTime()).toBe(30 * DAY);
    expect(r.lots[1].expires_at.getTime() - r.lots[1].granted_at.getTime()).toBe(30 * DAY);
  });

  it('an addition already past its life produces a lot that is ALREADY expired — the retroactive point', () => {
    const r = planBackfill({
      balance: 20,
      additions: [{ amount: 20, action: 'grant', created_at: daysAgo(45) }],
      now: NOW,
    });
    expect(r.lots[0].expires_at.getTime()).toBeLessThan(NOW);
  });
});

describe('the remainder the ledger cannot explain', () => {
  it('becomes one visible lot dated from the backfill moment, never dropped', () => {
    const r = planBackfill({
      balance: 500,
      additions: [{ amount: 100, action: 'grant', created_at: daysAgo(5) }],
      now: NOW,
    });
    expect(r.attributed).toBe(100);
    expect(r.unattributed).toBe(400);
    const orphan = r.lots[r.lots.length - 1];
    expect(orphan.source).toBe('backfill-unattributed');
    expect(orphan.amount).toBe(400);
    expect(orphan.granted_at.getTime()).toBe(NOW);
    expect(orphan.expires_at.getTime()).toBe(NOW + 30 * DAY);
  });

  it('a balance with NO ledger rows at all is entirely unattributed', () => {
    const r = planBackfill({ balance: 75, additions: [], now: NOW });
    expect(r.lots).toHaveLength(1);
    expect(r.lots[0].source).toBe('backfill-unattributed');
    expect(r.unattributed).toBe(75);
  });
});

describe('nothing is invented', () => {
  it('zero balance plans zero lots', () => {
    const r = planBackfill({ balance: 0, additions: [{ amount: 10, action: 'grant', created_at: daysAgo(1) }], now: NOW });
    expect(r.lots).toHaveLength(0);
  });

  it('a negative balance plans zero lots rather than a negative lot', () => {
    expect(planBackfill({ balance: -5, additions: [], now: NOW }).lots).toHaveLength(0);
  });

  it('negative and zero ledger rows (spends, refund reversals) are ignored as addition sources', () => {
    const r = planBackfill({
      balance: 10,
      additions: [
        { amount: -50, action: 'spend', created_at: daysAgo(1) },
        { amount: 0, action: 'set', created_at: daysAgo(1) },
        { amount: 10, action: 'grant', created_at: daysAgo(2) },
      ],
      now: NOW,
    });
    expect(r.lots).toHaveLength(1);
    expect(r.lots[0].granted_at.toISOString()).toBe(daysAgo(2));
  });

  it('decimal balances allocate to the cent, lots sum exactly to the balance', () => {
    const r = planBackfill({
      balance: 77.5,
      additions: [
        { amount: 50.25, action: 'grant', created_at: daysAgo(1) },
        { amount: 40.1, action: 'grant', created_at: daysAgo(2) },
      ],
      now: NOW,
    });
    const sum = r.lots.reduce((n, l) => n + l.remaining, 0);
    expect(Math.round(sum * 100) / 100).toBe(77.5);
    expect(r.lots[1].amount).toBe(27.25);
  });

  it('a shorter life can be asked for explicitly, but never defaults to it', () => {
    const r = planBackfill({
      balance: 10,
      additions: [{ amount: 10, action: 'grant', created_at: daysAgo(1) }],
      now: NOW,
      days: 7,
    });
    expect(r.lots[0].expires_at.getTime() - r.lots[0].granted_at.getTime()).toBe(7 * DAY);
  });
});
