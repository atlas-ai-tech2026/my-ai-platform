// ─── credit-lots.test.js ─────────────────────────────────────────────────────
// This is the money path. Every rule here was stated by the owner on
// 2026-08-20, in their own words, and the first test in this file is their
// worked example — the one they described twice to make sure it was understood:
//
//   "If he have ten credits from the promo code, the expiration until first of
//    September, and I add one hundred credit for the same user from bulk...
//    when he started to generate the picture, he will start use from the oldest
//    expiration as promo code. Then after he finished the ten credit, he will
//    start for the next generation of one hundred."
//
// If that scenario ever stops behaving exactly as written below, this file has
// failed at the only job it has.

import { describe, it, expect } from 'vitest';
import {
  spendOrder, liveBalance, planSpend, planRefund, describeBalance,
  expiredLots, isExpired, round2,
} from './credit-lots.js';

const D = (iso) => new Date(`${iso}T00:00:00.000Z`);
const AUG20 = D('2026-08-20').getTime();
const SEP02 = D('2026-09-02').getTime();
const SEP16 = D('2026-09-16').getTime();

/** The owner's case: promo credits that die first, bulk credits behind them. */
const promoLot = (remaining = 10) => ({
  id: 1, remaining, granted: 10, expires_at: D('2026-09-01'),
  created_at: D('2026-08-10'), source: 'promo',
});
const bulkLot = (remaining = 100) => ({
  id: 2, remaining, granted: 100, expires_at: D('2026-09-15'),
  created_at: D('2026-08-20'), source: 'bulk',
});

// ═══════════════════════════════════════════════════════════════════════════
describe("THE OWNER'S EXAMPLE — 10 promo (1 Sep) + 100 bulk (15 Sep)", () => {
  const lots = [promoLot(), bulkLot()];

  it('the balance reads 110', () => {
    expect(liveBalance(lots, AUG20)).toBe(110);
  });

  it('generating spends the PROMO credits first — they die soonest', () => {
    const plan = planSpend(lots, 4, AUG20);
    expect(plan.ok).toBe(true);
    expect(plan.draws).toEqual([
      { lotId: 1, take: 4, remainingAfter: 6 },
    ]);
    expect(plan.draws.some((d) => d.lotId === 2),
      'the 100 was touched while promo credits were still alive').toBe(false);
  });

  it('once the 10 are gone, generation continues from the 100', () => {
    const plan = planSpend([promoLot(0), bulkLot()], 8, AUG20);
    expect(plan.draws).toEqual([{ lotId: 2, take: 8, remainingAfter: 92 }]);
  });

  // The exact boundary the owner described — a charge that finishes the promo
  // and continues into the bulk credits in the same generation.
  it('a charge larger than the promo lot spills into the bulk lot, in order', () => {
    const plan = planSpend(lots, 25, AUG20);
    expect(plan.draws).toEqual([
      { lotId: 1, take: 10, remainingAfter: 0 },
      { lotId: 2, take: 15, remainingAfter: 85 },
    ]);
    expect(plan.balanceAfter).toBe(85);
  });

  it('on 2 September the unused promo credits are gone and the 100 remain', () => {
    const after = [promoLot(6), bulkLot()];
    expect(liveBalance(after, SEP02), 'expired promo credits were still spendable').toBe(100);
    expect(expiredLots(after, SEP02).map((l) => l.id)).toEqual([1]);
    expect(planSpend(after, 5, SEP02).draws).toEqual([{ lotId: 2, take: 5, remainingAfter: 95 }]);
  });

  it('on 16 September everything has expired and nothing can be spent', () => {
    expect(liveBalance(lots, SEP16)).toBe(0);
    expect(planSpend(lots, 1, SEP16).ok).toBe(false);
  });

  // Today's behaviour, stated as a test so the regression is impossible: one
  // pooled balance would let all 110 survive to 15 September.
  it('the promo credits do NOT inherit the later expiry', () => {
    expect(liveBalance(lots, SEP02),
      'the promo credits were quietly extended to the bulk expiry — the leak this exists to stop')
      .not.toBe(110);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('the spending order', () => {
  it('is soonest-expiring first, whatever order the rows arrive in', () => {
    const lots = [bulkLot(), promoLot()];              // deliberately reversed
    expect(spendOrder(lots, AUG20).map((l) => l.id)).toEqual([1, 2]);
  });

  // Undated credits can wait; dated ones cannot. Spending undated first would
  // let dated credits die untouched — the exact waste this ordering prevents.
  it('puts credits that never expire LAST', () => {
    const forever = { id: 3, remaining: 50, expires_at: null, created_at: D('2026-01-01') };
    expect(spendOrder([forever, bulkLot(), promoLot()], AUG20).map((l) => l.id))
      .toEqual([1, 2, 3]);
  });

  it('breaks a tie on the same expiry by oldest grant, so it is deterministic', () => {
    const a = { id: 7, remaining: 5, expires_at: D('2026-09-01'), created_at: D('2026-08-05') };
    const b = { id: 8, remaining: 5, expires_at: D('2026-09-01'), created_at: D('2026-08-01') };
    expect(spendOrder([a, b], AUG20).map((l) => l.id)).toEqual([8, 7]);
  });

  it('ignores empty and expired lots entirely', () => {
    const empty = { id: 9, remaining: 0, expires_at: D('2026-09-10'), created_at: D('2026-08-01') };
    const dead = { id: 10, remaining: 99, expires_at: D('2026-08-01'), created_at: D('2026-07-01') };
    expect(spendOrder([empty, dead, bulkLot()], AUG20).map((l) => l.id)).toEqual([2]);
  });

  it('expiry is exclusive at the moment it passes', () => {
    const lot = { id: 1, remaining: 5, expires_at: D('2026-09-01'), created_at: D('2026-08-01') };
    expect(isExpired(lot, D('2026-08-31').getTime())).toBe(false);
    expect(isExpired(lot, D('2026-09-01').getTime())).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('a charge that cannot be paid', () => {
  // Charging 30 against 20 must fail WHOLE. Taking what it can and reporting
  // success is how a customer gets a half-finished generation and a balance of
  // zero, with the ledger insisting everything went fine.
  it('is refused entirely, never partially taken', () => {
    const plan = planSpend([promoLot()], 30, AUG20);
    expect(plan.ok).toBe(false);
    expect(plan.reason).toBe('insufficient');
    expect(plan.draws).toEqual([]);
    expect(plan.spent).toBe(0);
  });

  it('says how short it was, so the message can be specific', () => {
    const plan = planSpend([promoLot()], 30, AUG20);
    expect(plan.available).toBe(10);
    expect(plan.shortfall).toBe(20);
  });

  it('refuses a zero or negative charge rather than treating it as free', () => {
    for (const bad of [0, -5, null, undefined, NaN]) {
      expect(planSpend([bulkLot()], bad, AUG20).ok).toBe(false);
    }
  });

  it('will not spend expired credits even when the total would cover it', () => {
    const plan = planSpend([promoLot(10), bulkLot(100)], 105, SEP02);
    expect(plan.ok, 'expired promo credits were counted toward the balance').toBe(false);
    expect(plan.available).toBe(100);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('refunds', () => {
  it('go back to the exact lot they came from, keeping their original expiry', () => {
    const draws = [{ lotId: 1, take: 4 }];
    const r = planRefund([promoLot(6), bulkLot()], draws, AUG20);
    expect(r.returns).toEqual([{ lotId: 1, amount: 4, to: 'original' }]);
    expect(r.refunded).toBe(4);
  });

  it('split across lots, they go back split the same way', () => {
    const draws = [{ lotId: 1, take: 10 }, { lotId: 2, take: 15 }];
    const r = planRefund([promoLot(0), bulkLot(85)], draws, AUG20);
    expect(r.returns).toEqual([
      { lotId: 1, amount: 10, to: 'original' },
      { lotId: 2, amount: 15, to: 'original' },
    ]);
  });

  // The case that matters. The stuck-charge sweeper settles HOURS after the
  // charge — a refund landing in a lot that expired in the gap would mean the
  // customer loses credits to an outage we caused.
  it('never return into a lot that expired since the charge', () => {
    const draws = [{ lotId: 1, take: 4 }];
    const r = planRefund([promoLot(6), bulkLot()], draws, SEP02);
    expect(r.returns).toEqual([
      { lotId: 2, amount: 4, to: 'newest-live', originalLotId: 1 },
    ]);
  });

  it('and the fallback is the lot with the most life left', () => {
    const soon = { id: 4, remaining: 5, expires_at: D('2026-09-20'), created_at: D('2026-08-01') };
    const later = { id: 5, remaining: 5, expires_at: D('2026-12-01'), created_at: D('2026-08-02') };
    const r = planRefund([promoLot(0), soon, later], [{ lotId: 1, take: 3 }], SEP02);
    expect(r.returns[0].lotId).toBe(5);
  });

  // A refund with nowhere to go must be REPORTED. One that quietly evaporates
  // is how a balance and its ledger start disagreeing, and nobody finds out
  // until a customer counts.
  it('report a refund with nowhere live to land, rather than dropping it', () => {
    const r = planRefund([promoLot(6)], [{ lotId: 1, take: 4 }], SEP16);
    expect(r.returns).toEqual([]);
    expect(r.orphaned).toBe(4);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('what the customer is told', () => {
  // A bare "110" is how 1 September becomes "my credits disappeared".
  it('names the total AND the soonest expiry, because that is the one that bites', () => {
    const d = describeBalance([promoLot(), bulkLot()], AUG20);
    expect(d.total).toBe(110);
    expect(d.soonestAmount).toBe(10);
    expect(d.text).toBe('110 credits · 10 expiring 2026-09-01');
  });

  it('adds up several lots sharing the same expiry date', () => {
    const second = { id: 3, remaining: 5, expires_at: D('2026-09-01'), created_at: D('2026-08-12') };
    expect(describeBalance([promoLot(), second, bulkLot()], AUG20).soonestAmount).toBe(15);
  });

  it('says nothing about expiry when nothing expires', () => {
    const forever = { id: 3, remaining: 40, expires_at: null, created_at: D('2026-01-01') };
    const d = describeBalance([forever], AUG20);
    expect(d.text).toBe('40 credits');
    expect(d.soonest).toBeNull();
  });

  it('drops expired lots from the total it shows', () => {
    expect(describeBalance([promoLot(6), bulkLot()], SEP02).total).toBe(100);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('the arithmetic', () => {
  // Credits are NUMERIC(10,2). Floats drift, and a balance that ends in
  // 0.30000000000000004 is a support message.
  it('does not accumulate floating-point dust across many small charges', () => {
    let lots = [{ id: 1, remaining: 1, expires_at: null, created_at: D('2026-01-01') }];
    for (let i = 0; i < 10; i += 1) {
      const plan = planSpend(lots, 0.1, AUG20);
      expect(plan.ok).toBe(true);
      lots = [{ ...lots[0], remaining: plan.draws[0].remainingAfter }];
    }
    expect(lots[0].remaining).toBe(0);
    expect(liveBalance(lots, AUG20)).toBe(0);
  });

  it('handles fractional charges across a lot boundary exactly', () => {
    const plan = planSpend([promoLot(0.5), bulkLot(2)], 1.75, AUG20);
    expect(plan.draws).toEqual([
      { lotId: 1, take: 0.5, remainingAfter: 0 },
      { lotId: 2, take: 1.25, remainingAfter: 0.75 },
    ]);
  });

  it('rounds to two places, like the column it is stored in', () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(10.005)).toBe(10.01);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('nothing here reads the clock on its own', () => {
  // Every function takes `now`. A module that calls Date.now() internally
  // cannot be tested across a September boundary without faking time, and the
  // whole point of this file is that the boundary IS the feature.
  it('the same lots give different answers at different moments', () => {
    const lots = [promoLot(), bulkLot()];
    expect(liveBalance(lots, AUG20)).toBe(110);
    expect(liveBalance(lots, SEP02)).toBe(100);
    expect(liveBalance(lots, SEP16)).toBe(0);
  });

  it('survives lots with no dates at all without throwing', () => {
    const bare = { id: 1, remaining: 5 };
    expect(() => spendOrder([bare])).not.toThrow();
    expect(liveBalance([bare])).toBe(5);
  });
});
