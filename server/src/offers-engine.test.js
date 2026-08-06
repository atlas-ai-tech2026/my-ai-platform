// ─── offers-engine.test.js ───────────────────────────────────────────────────
// The brief states three acceptance numbers at margin_target 0.40. They are the
// first block below and they are checked to the exact decimal, because every
// other behaviour here is downstream of the formulas being right.
//
// The second theme is the floor gate: an offer that would drop a plan under the
// margin floor must not be approvable by accident. The dangerous case is not a
// margin that is too low — it is a margin that is UNKNOWN and gets treated as
// acceptable.

import { describe, it, expect } from 'vitest';
import {
  costShareOf, marginFloorOf, offerMargin, estimatedDaysCost, discountedPrice,
  marginImpact, violatesFloor, validateForApproval, bestOffer, clientBenefit,
  effectiveStatus, requiresCheckout, OFFER_TYPES, TYPES_REQUIRING_CHECKOUT,
} from './offers-engine.js';

const S = { margin_target: 0.40, margin_floor: 0.25 };
const PLANS = [
  { id: 1, name: 'Micro',   price_usd: 5 },
  { id: 2, name: 'Starter', price_usd: 10 },
  { id: 3, name: 'Basic',   price_usd: 19 },
  { id: 4, name: 'Plus',    price_usd: 59 },
  { id: 5, name: 'Pro',     price_usd: 95 },
  { id: 6, name: 'Max',     price_usd: 129 },
];
const pct2 = (v) => Number((v * 100).toFixed(2));

describe("the brief's acceptance numbers, at margin_target 0.40", () => {
  it('15% off ⇒ 29.41%', () => {
    expect(pct2(offerMargin('pct', 15, 59, S))).toBe(29.41);
  });
  it('+25% bonus credits ⇒ 25.0%', () => {
    expect(pct2(offerMargin('bonus', 25, 59, S))).toBe(25.00);
  });
  it('$10 off $59 ⇒ 27.76%', () => {
    expect(pct2(offerMargin('fixed', 10, 59, S))).toBe(27.76);
  });
});

describe('cost share comes from settings, never hardcoded', () => {
  it('is 1 − margin_target', () => {
    expect(costShareOf({ margin_target: 0.40 })).toBeCloseTo(0.60, 12);
    expect(costShareOf({ margin_target: 0.50 })).toBeCloseTo(0.50, 12);
  });

  // If this test fails, someone has pinned 0.60 into the engine and offers have
  // quietly stopped following the Costing screen's margin target.
  it('every formula moves when the target moves', () => {
    const strict = { margin_target: 0.50, margin_floor: 0.25 };
    expect(offerMargin('pct', 15, 59, S)).not.toBeCloseTo(offerMargin('pct', 15, 59, strict), 6);
    expect(offerMargin('bonus', 25, 59, S)).not.toBeCloseTo(offerMargin('bonus', 25, 59, strict), 6);
    expect(offerMargin('fixed', 10, 59, S)).not.toBeCloseTo(offerMargin('fixed', 10, 59, strict), 6);
  });

  it('refuses a nonsensical target rather than inventing one', () => {
    for (const t of [0, 1, -0.2, 1.5, null, undefined, 'x']) {
      expect(costShareOf({ margin_target: t })).toBeNull();
      expect(offerMargin('pct', 15, 59, { margin_target: t })).toBeNull();
    }
  });
});

describe('margin floor', () => {
  it('reads the setting', () => {
    expect(marginFloorOf({ margin_floor: 0.30 })).toBe(0.30);
  });
  // A database predating the column must not behave as "no floor at all".
  it('falls back to 0.25 when the column is missing, never to 0', () => {
    expect(marginFloorOf({})).toBe(0.25);
    expect(marginFloorOf({ margin_floor: null })).toBe(0.25);
    expect(marginFloorOf(undefined)).toBe(0.25);
  });
});

describe('offerMargin — edge cases that must not produce a number', () => {
  it('100% off has no margin to report (and must not divide by zero)', () => {
    expect(offerMargin('pct', 100, 59, S)).toBeNull();
    expect(offerMargin('pct', 150, 59, S)).toBeNull();
  });
  it('a fixed amount at or above the price leaves nothing to earn on', () => {
    expect(offerMargin('fixed', 59, 59, S)).toBeNull();
    expect(offerMargin('fixed', 80, 59, S)).toBeNull();
  });
  it('days has no margin by definition', () => {
    expect(offerMargin('days', 14, 59, S)).toBeNull();
  });
  it('zero or negative values are not offers', () => {
    expect(offerMargin('pct', 0, 59, S)).toBeNull();
    expect(offerMargin('pct', -5, 59, S)).toBeNull();
  });

  // A bonus big enough to push cost past the whole price is a real loss, and
  // the engine must say so with a negative number rather than clamping to 0 —
  // clamping would hide that the offer loses money on every redemption.
  it('reports a genuine loss as a negative margin', () => {
    const m = offerMargin('bonus', 100, 59, S);   // cost share 0.60 × 2 = 1.20
    expect(m).toBeCloseTo(-0.20, 10);
    expect(m).toBeLessThan(0);
  });
});

describe('days are a cost, not a discount', () => {
  it('estimates pro-rata on a 30-day month', () => {
    // 0.60 × $59 × 14/30
    expect(estimatedDaysCost(14, 59, S)).toBeCloseTo(16.52, 2);
  });
  it('leaves the price alone', () => {
    expect(discountedPrice('days', 14, 59)).toBeNull();
    expect(discountedPrice('bonus', 25, 59)).toBeNull();
  });
  it('price types do move the price', () => {
    expect(discountedPrice('pct', 15, 59)).toBeCloseTo(50.15, 10);
    expect(discountedPrice('fixed', 10, 59)).toBeCloseTo(49, 10);
    expect(discountedPrice('fixed', 999, 59)).toBe(0);   // never negative
  });
});

describe('marginImpact + the floor gate', () => {
  it('reports before and after for each selected plan', () => {
    const impact = marginImpact({ type: 'pct', value: 15, plans: PLANS.slice(3, 4), settings: S });
    expect(impact).toHaveLength(1);
    expect(impact[0].plan_name).toBe('Plus');
    expect(impact[0].margin_before).toBe(0.40);
    expect(pct2(impact[0].margin_after)).toBe(29.41);
    expect(impact[0].below_floor).toBe(false);       // 29.41% > 25%
  });

  it('flags a plan that drops under the floor', () => {
    // 30% off ⇒ 1 − 0.6/0.7 = 14.29%, under the 25% floor.
    const impact = marginImpact({ type: 'pct', value: 30, plans: PLANS, settings: S });
    expect(impact.every((r) => r.below_floor)).toBe(true);
    expect(violatesFloor(impact)).toBe(true);
  });

  // The subtle one. An unknown margin is not a passing margin.
  it('treats an UNKNOWN margin as below the floor, not as acceptable', () => {
    const impact = marginImpact({ type: 'fixed', value: 999, plans: PLANS, settings: S });
    expect(impact[0].margin_after).toBeNull();
    expect(impact[0].below_floor).toBe(true);
    expect(violatesFloor(impact)).toBe(true);
  });

  it('exempts days, which has no margin to compare', () => {
    const impact = marginImpact({ type: 'days', value: 14, plans: PLANS, settings: S });
    expect(impact.every((r) => r.below_floor)).toBe(false);
    expect(impact[0].estimated_cost).toBeGreaterThan(0);
  });
});

describe('validateForApproval', () => {
  const base = {
    name: 'National Day 15%', type: 'pct', value: 15, plan_ids: [4],
    audience_mode: 'all', delivery_code: true, code: 'VOXEL15',
    starts_at: '2026-08-10', ends_at: '2026-08-20',
  };
  const ok = (o = {}) => validateForApproval({ ...base, ...o }, { plans: PLANS, settings: S });

  it('passes a well-formed offer', () => {
    expect(ok()).toEqual([]);
  });

  it.each([
    ['a name',            { name: '  ' },                    /name/i],
    ['a valid type',      { type: 'nonsense' },              /type/i],
    ['a value above zero',{ value: 0 },                      /above zero/i],
    ['at least one plan', { plan_ids: [] },                  /at least one plan/i],
    ['a delivery channel',{ delivery_code: false },          /delivery channel/i],
    ['a code when code delivery is on', { code: '' },        /promo code/i],
  ])('requires %s', (_label, patch, re) => {
    expect(ok(patch).join(' · ')).toMatch(re);
  });

  it('refuses an end date before the start date', () => {
    expect(ok({ starts_at: '2026-08-20', ends_at: '2026-08-10' }).join(' · ')).toMatch(/end date/i);
  });

  it('requires a picked client when the audience is hand-picked', () => {
    expect(ok({ audience_mode: 'picked', picked_client_ids: [] }).join(' · ')).toMatch(/pick at least one/i);
  });

  it('refuses a segment that matches nobody', () => {
    expect(ok({ audience_mode: 'segment', audience_count: 0 }).join(' · ')).toMatch(/0 clients/i);
  });

  // Email has no sender behind it. An offer delivered ONLY by email reaches
  // nobody, and would sit in the list looking live.
  it('refuses an offer whose only channel is the on-hold email campaign', () => {
    expect(ok({ delivery_code: false, delivery_auto: false, delivery_email: true }).join(' · '))
      .toMatch(/on hold/i);
  });

  it('blocks approval below the floor without explicit confirmation', () => {
    const errs = validateForApproval({ ...base, value: 30 }, { plans: PLANS, settings: S });
    expect(errs.join(' · ')).toMatch(/below the 25.0% margin floor/i);
  });

  it('allows it once below-floor approval is given', () => {
    const errs = validateForApproval({ ...base, value: 30 },
      { plans: PLANS, settings: S, belowFloorApproved: true });
    expect(errs).toEqual([]);
  });

  it('below-floor approval does NOT excuse any other problem', () => {
    const errs = validateForApproval({ ...base, value: 30, name: '' },
      { plans: PLANS, settings: S, belowFloorApproved: true });
    expect(errs.join(' · ')).toMatch(/name/i);
  });
});

describe('no stacking — exactly one offer applies', () => {
  it('picks the one worth most to the client', () => {
    const offers = [
      { id: 1, type: 'pct',   value: 10 },   // $5.90 on a $59 plan
      { id: 2, type: 'fixed', value: 15 },   // $15.00
      { id: 3, type: 'bonus', value: 20 },   // $11.80
    ];
    expect(bestOffer(offers, { price: 59, settings: S }).id).toBe(2);
  });

  it('never returns two', () => {
    const best = bestOffer([{ id: 1, type: 'pct', value: 10 }, { id: 2, type: 'pct', value: 20 }],
      { price: 59, settings: S });
    expect(best.id).toBe(2);
    expect(Array.isArray(best)).toBe(false);
  });

  it('returns null when nothing applies', () => {
    expect(bestOffer([], { price: 59, settings: S })).toBeNull();
    expect(bestOffer([{ id: 1, type: 'pct', value: 0 }], { price: 59, settings: S })).toBeNull();
  });

  it('a fixed amount is never worth more than the price itself', () => {
    expect(clientBenefit({ type: 'fixed', value: 999 }, { price: 59, settings: S })).toBe(59);
  });
});

describe('effectiveStatus is derived from the dates', () => {
  const at = (d) => new Date(`${d}T12:00:00Z`);
  const o = { starts_at: '2026-08-10', ends_at: '2026-08-20', status: 'active' };

  it('scheduled before the start', () => expect(effectiveStatus(o, at('2026-08-01'))).toBe('scheduled'));
  it('active inside the window',     () => expect(effectiveStatus(o, at('2026-08-15'))).toBe('active'));
  it('expired after the end',        () => expect(effectiveStatus(o, at('2026-08-21'))).toBe('expired'));
  it('active on the first day',      () => expect(effectiveStatus(o, at('2026-08-10'))).toBe('active'));
  it('active on the last day',       () => expect(effectiveStatus(o, at('2026-08-20'))).toBe('active'));

  // The owner's own states must beat the calendar, or pausing a running offer
  // would appear to do nothing.
  it('paused beats the calendar', () => {
    expect(effectiveStatus({ ...o, status: 'paused' }, at('2026-08-15'))).toBe('paused');
  });
  it('draft beats the calendar', () => {
    expect(effectiveStatus({ ...o, status: 'draft' }, at('2026-08-15'))).toBe('draft');
  });
});

describe('which types can actually be redeemed today', () => {
  it('names the two that need a checkout', () => {
    expect(TYPES_REQUIRING_CHECKOUT.sort()).toEqual(['fixed', 'pct']);
    expect(requiresCheckout('pct')).toBe(true);
    expect(requiresCheckout('fixed')).toBe(true);
  });
  it('bonus and days work on today’s platform', () => {
    expect(requiresCheckout('bonus')).toBe(false);
    expect(requiresCheckout('days')).toBe(false);
  });
  it('all four types are still offered', () => {
    expect(OFFER_TYPES.sort()).toEqual(['bonus', 'days', 'fixed', 'pct']);
  });
});
