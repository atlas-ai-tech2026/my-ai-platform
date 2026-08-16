// ─── pnl-engine.test.js ──────────────────────────────────────────────────────
// The one thing this screen must never do is flatter you.
//
// 32 of 82 active models have no supplier cost on file. If their spend counts
// as $0, every workshop that used them reports a better margin than it earned
// — and that is the number that would set the next workshop's price. So most
// of what follows is about refusing to state a margin rather than computing
// one, which is the opposite of what a P&L screen is usually tested for.

import { describe, it, expect } from 'vitest';
import {
  modelFromReason, costIndex, pickCost, attributeCost, workshopPnl, summarise,
  MIN_COVERAGE_PCT,
} from './pnl-engine.js';

// Real shapes: spend reasons and pricing_models rows as they exist today.
const MODELS = [
  { model_name: 'Kling 3.0',       fal_cost: 0.28, kie_cost: 0.25 },
  { model_name: 'Kling 3.0',       fal_cost: 0.40, kie_cost: null },  // second resolution
  { model_name: 'Nano Banana Pro', fal_cost: null, kie_cost: 0.032 },
  { model_name: 'Midjourney',      fal_cost: null, kie_cost: null },  // one of the 32
];

describe('reading the model out of a spend row', () => {
  it('strips the kind prefix our rows carry', () => {
    expect(modelFromReason('video: Kling 3.0')).toBe('Kling 3.0');
    expect(modelFromReason('image: Nano Banana Pro')).toBe('Nano Banana Pro');
    expect(modelFromReason('audio: TTS (1k chars)')).toBe('TTS (1k chars)');
  });

  // 13,736 of 22,665 historical spend rows have reason = NULL.
  it('returns null rather than guessing when the reason is missing', () => {
    for (const r of [null, '', 'no prefix here', undefined]) {
      expect(modelFromReason(r)).toBeNull();
    }
  });
});

describe('which cost to use', () => {
  it('takes MAX(fal, kie) — the same rule as the 40% target', () => {
    expect(pickCost({ fal_cost: 0.28, kie_cost: 0.25 })).toBe(0.28);
    expect(pickCost({ fal_cost: 0.10, kie_cost: 0.30 })).toBe(0.30);
  });

  it('uses whichever single provider has a price', () => {
    expect(pickCost({ fal_cost: null, kie_cost: 0.032 })).toBe(0.032);
  });

  // The distinction the whole file rests on: unknown is not free.
  it('returns null — never 0 — when neither provider has a price', () => {
    expect(pickCost({ fal_cost: null, kie_cost: null })).toBeNull();
    expect(pickCost({ fal_cost: 0, kie_cost: 0 })).toBeNull();
    expect(pickCost({})).toBeNull();
  });

  it('keeps the dearest row when one model has several resolutions', () => {
    // Erring high on cost errs LOW on margin, which never talks anyone into a
    // bad price.
    expect(costIndex(MODELS).get('kling30')).toBe(0.40);
  });

  it('leaves an uncosted model out of the index entirely', () => {
    expect(costIndex(MODELS).has('midjourney')).toBe(false);
  });
});

describe('attributing a cohort’s spend', () => {
  const idx = costIndex(MODELS);

  it('costs what it can and says so', () => {
    const out = attributeCost([{ model: 'Kling 3.0', credits: 125, uses: 10 }], idx);
    expect(out.costed_usd).toBe(4);           // 10 × $0.40
    expect(out.costed_pct).toBe(100);
  });

  // The heart of it. Midjourney has no cost, so its credits must NOT quietly
  // become $0 of supplier cost.
  it('does not treat an uncosted model as free', () => {
    const out = attributeCost([
      { model: 'Kling 3.0', credits: 100, uses: 10 },
      { model: 'Midjourney', credits: 100, uses: 25 },
    ], idx);
    expect(out.costed_usd).toBe(4);
    expect(out.uncosted_credits).toBe(100);
    expect(out.costed_pct).toBe(50);
    expect(out.missing_models[0].model).toBe('Midjourney');
  });

  // Coverage is by SPEND, not by model count: one uncosted model carrying most
  // of the traffic matters far more than ten nobody used.
  it('measures coverage by spend rather than by number of models', () => {
    const out = attributeCost([
      { model: 'Kling 3.0', credits: 10, uses: 1 },
      { model: 'Midjourney', credits: 990, uses: 200 },
    ], idx);
    expect(out.costed_pct).toBe(1);
  });

  it('puts the blind spot in money, not just credits', () => {
    const out = attributeCost([{ model: 'Midjourney', credits: 1000, uses: 100 }], idx);
    expect(out.uncosted_at_list_usd).toBeCloseTo(63.33, 1);
  });

  it('reports null coverage for a cohort that generated nothing', () => {
    expect(attributeCost([], idx).costed_pct).toBeNull();
  });
});

describe('refusing to state a margin it cannot stand behind', () => {
  const full = { costed_usd: 612, costed_pct: 100, total_credits: 1000 };

  it('states margin when the invoice and the costs are both there', () => {
    const p = workshopPnl({ invoiced_amount: 845 }, full);
    expect(p.gross_profit_usd).toBe(233);
    expect(p.margin_pct).toBe(27.6);
    expect(p.unstated_because).toBeNull();
  });

  // A margin from 40% coverage is not a margin; it is an optimistic guess.
  it('returns null — not a number — when too little spend is costed', () => {
    const p = workshopPnl({ invoiced_amount: 845 }, { costed_usd: 200, costed_pct: 40 });
    expect(p.margin_pct).toBeNull();
    expect(p.gross_profit_usd).toBeNull();
    expect(p.unstated_because).toMatch(/only 40% of their spend/);
  });

  it('says plainly when no invoice has been recorded', () => {
    const p = workshopPnl({ invoiced_amount: null }, full);
    expect(p.margin_pct).toBeNull();
    expect(p.unstated_because).toBe('no invoice amount recorded');
  });

  it('distinguishes "not invoiced" from "nobody generated anything"', () => {
    const p = workshopPnl({ invoiced_amount: 500 }, { costed_usd: 0, costed_pct: null });
    expect(p.unstated_because).toMatch(/has not generated anything/);
  });

  // An empty cell must never be readable as zero profit.
  it('always explains a missing margin in words', () => {
    for (const c of [{ costed_usd: 0, costed_pct: null }, { costed_usd: 1, costed_pct: 10 }]) {
      expect(workshopPnl({ invoiced_amount: null }, c).unstated_because).toBeTruthy();
    }
  });

  it('sets the coverage bar high enough to mean something', () => {
    expect(MIN_COVERAGE_PCT).toBeGreaterThanOrEqual(80);
  });
});

describe('the period total', () => {
  const rows = [
    { invoiced_usd: 845, supplier_cost_usd: 612, margin_pct: 27.6 },
    { invoiced_usd: 825, supplier_cost_usd: 401, margin_pct: 51.4 },
    { invoiced_usd: 585, supplier_cost_usd: 486, margin_pct: null },   // not stateable
  ];

  it('adds up what is there', () => {
    const s = summarise(rows);
    expect(s.invoiced_usd).toBe(2255);
    expect(s.supplier_cost_usd).toBe(1499);
    expect(s.gross_profit_usd).toBe(756);
  });

  // The headline is only as good as its worst row, so it has to admit that.
  it('says how many rows the headline actually rests on', () => {
    expect(summarise(rows).stated_of).toBe('2 of 3');
    expect(summarise(rows).complete).toBe(false);
  });

  it('is marked complete only when every row could be stated', () => {
    expect(summarise(rows.slice(0, 2)).complete).toBe(true);
  });

  it('does not divide by zero on an empty month', () => {
    const s = summarise([]);
    expect(s.margin_pct).toBeNull();
    expect(s.complete).toBe(false);
  });
});
