// ─── costing-engine.test.js ──────────────────────────────────────────────────
// The acceptance test the costing brief demands: run the engine over all 50
// seed rows and assert the credits and sale price of every one, plus the six
// plan credit totals and the worst-case plan margins.
//
// This is the guard that makes the engine safe to trust. Pricing arithmetic
// fails silently — a wrong rounding mode does not throw, it just quietly earns
// less on 50 models. Expectations were extracted from the brief, which was
// verified against the source workbook.

import { describe, it, expect } from 'vitest';
import { COSTING_SEED, SEED_PLANS, SEED_SETTINGS } from './costing-seed.js';
import {
  autoCredits, creditsOf, saleOf, basisOf, marginVsBasis, marginVsKie,
  planCredits, planQty, profitMargin, worstMarginForPlan, costForMode,
  belowTarget, targetOf,
} from './costing-engine.js';

const S = SEED_SETTINGS;

/** [sort, expected_credits, expected_sale] straight from the brief. */
const EXPECTED = [
  [1, 1.5, 0.095],
  [2, 1.5, 0.095],
  [3, 4, 0.253333],
  [4, 8, 0.506667],
  [5, 4, 0.253333],
  [6, 4, 0.253333],
  [7, 8, 0.506667],
  [8, 6, 0.38],
  [9, 6.5, 0.411667],
  [10, 11, 0.696667],
  [11, 1.5, 0.095],
  [12, 1.5, 0.095],
  [13, 2, 0.126667],
  [14, 1, 0.063333],
  [15, 2, 0.126667],
  [16, 1, 0.063333],
  [17, 2.5, 0.158333],
  [18, 4.5, 0.285],
  [19, 8.5, 0.538333],
  [20, 4, 0.253333],
  [21, 8, 0.506667],
  [22, 18, 1.14],
  [23, 41.5, 2.628333],
  [24, 3, 0.19],
  [25, 6.5, 0.411667],
  [26, 1.5, 0.095],
  [27, 3, 0.19],
  [28, 2.5, 0.158333],
  [29, 4, 0.253333],
  [30, 9, 0.57],
  [31, 2.5, 0.158333],
  [32, 3, 0.19],
  [33, 1.5, 0.095],
  [34, 1.5, 0.095],
  [35, 2, 0.126667],
  [36, 33, 2.09],
  [37, 34, 2.153333],
  [38, 49, 3.103333],
  [39, 8, 0.506667],
  [40, 9, 0.57],
  [41, 4, 0.253333],
  [42, 11.5, 0.728333],
  [43, 22.5, 1.425],
  [44, 7.5, 0.475],
  [45, 14.5, 0.918333],
  [46, 6, 0.38],
  [47, 11.5, 0.728333],
  [48, 3, 0.19],
  [49, 1.5, 0.095],
  [50, 3, 0.19]
];

const bySort = (n) => COSTING_SEED.find((m) => m.sort === n);

describe('the engine reproduces the workbook for all 50 rows', () => {
  it('has every seed row covered by an expectation', () => {
    expect(COSTING_SEED).toHaveLength(50);
    expect(EXPECTED).toHaveLength(50);
  });

  for (const [sort, credits, sale] of EXPECTED) {
    it(`row ${sort} → ${credits} credits`, () => {
      const m = bySort(sort);
      expect(m, `no seed row with sort ${sort}`).toBeTruthy();
      expect(autoCredits(m, S)).toBeCloseTo(credits, 9);
      expect(saleOf(m, S)).toBeCloseTo(sale, 5);
    });
  }
});

describe('plans', () => {
  it('produce the six credit totals from the brief', () => {
    expect(SEED_PLANS.map((p) => planCredits(p, S))).toEqual([79, 158, 300, 932, 1500, 2037]);
  });
});

describe('worst-case realised margins', () => {
  // The brief's headline guarantee: even spending a whole plan on the single
  // worst model, every tier still clears the 40% target.
  const EXPECTED_WORST = [0.415, 0.412, 0.40789, 0.40339, 0.40368, 0.40310];

  SEED_PLANS.forEach((plan, i) => {
    it(`${plan.name} $${plan.price_usd} → ${(EXPECTED_WORST[i] * 100).toFixed(3)}%`, () => {
      expect(worstMarginForPlan(COSTING_SEED, plan, S)).toBeCloseTo(EXPECTED_WORST[i], 4);
    });
  });

  it('never drops below the 40% target on any model or plan', () => {
    const misses = belowTarget(COSTING_SEED, SEED_PLANS, S);
    expect(misses.map((x) => `${x.model.model_name} ${x.model.resolution} / ${x.plan.name}`)).toEqual([]);
  });
});

describe('cost basis rules', () => {
  it('prices against the HIGHER supplier when both carry a model', () => {
    const m = bySort(3); // Nano Banana Pro 1K/2K — kie 0.09, fal 0.15
    expect(basisOf(m)).toBe(0.15);
  });

  it('uses KIE alone when FAL does not carry it', () => {
    const m = bySort(14); // Seedream 5 Pro 1K — KIE only
    expect(m.fal_cost).toBeNull();
    expect(basisOf(m)).toBe(0.035);
    expect(costForMode(m, 'fal')).toBeNull();
  });

  it('margin vs KIE is never worse than margin vs basis', () => {
    for (const m of COSTING_SEED) {
      expect(marginVsKie(m, S)).toBeGreaterThanOrEqual(marginVsBasis(m, S) - 1e-9);
    }
  });
});

describe('overrides', () => {
  it('a pinned credits value wins over the formula', () => {
    const m = { ...bySort(3), credits_override: 6 };
    expect(creditsOf(m, S)).toBe(6);
    expect(autoCredits(m, S)).toBe(4); // formula unchanged underneath
  });

  it('a per-model margin target overrides the global one', () => {
    const m = { ...bySort(3), margin_override: 0.60 };
    expect(targetOf(m, S)).toBe(0.60);
    // 0.15 / 0.4 = 0.375 → /0.06333 = 5.92 → ceil to half = 6
    expect(autoCredits(m, S)).toBe(6);
  });

  it('rounds UP to the next half credit, never to nearest', () => {
    // Rounding to nearest here would put the realised margin BELOW target.
    const m = { kie_cost: 0.1, fal_cost: null };
    expect(autoCredits(m, S)).toBe(3); // 0.1/0.6/0.06333 = 2.63 → 3, not 2.5
  });
});

describe('plan quantities', () => {
  it('floors — a customer cannot buy a fraction of an image', () => {
    const m = bySort(3);                       // 4 credits each
    const basic = SEED_PLANS[2];               // 300 credits
    expect(planQty(m, basic, S)).toBe(75);
  });

  it('realised margin accounts for unspendable leftover credits', () => {
    const m = bySort(9);                       // 6.5 credits — 300 leaves a remainder
    const basic = SEED_PLANS[2];
    expect(planQty(m, basic, S)).toBe(46);     // 299 credits used, 1 stranded
    expect(profitMargin(m, basic, S, basisOf(m))).toBeGreaterThan(marginVsBasis(m, S));
  });
});

describe('stored precision cannot silently move a price', () => {
  // The engine's anchor is the exact fraction 19/300, but the database column
  // is NUMERIC(12,8), so it round-trips as 0.06333333. With CEILING-to-half
  // rounding a tiny difference CAN flip a row that sits on a boundary — it
  // just does not for the current 50. This test is here so the day someone
  // adds a model on a knife-edge, the build says so instead of the margin
  // quietly moving.
  const exact = { margin_target: 0.40, credit_value: 19 / 300 };
  const stored = { margin_target: 0.40, credit_value: 0.06333333 };

  it('every seed row prices identically at the stored precision', () => {
    const moved = COSTING_SEED
      .filter((m) => autoCredits(m, exact) !== autoCredits(m, stored))
      .map((m) => `${m.model_name} ${m.resolution ?? ''}`.trim());
    expect(moved).toEqual([]);
  });

  it('demonstrates the boundary this protects against', () => {
    // A contrived cost landing exactly on a half-credit line: proof the guard
    // is meaningful rather than vacuous.
    const knifeEdge = { kie_cost: 4 * 0.6 * (19 / 300), fal_cost: null };
    expect(autoCredits(knifeEdge, exact)).toBe(4);          // EPS keeps it at 4
    expect(autoCredits({ kie_cost: knifeEdge.kie_cost + 1e-6, fal_cost: null }, exact)).toBe(4.5);
  });
});
