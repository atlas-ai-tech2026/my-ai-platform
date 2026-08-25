// ─── edit-ops.test.js ────────────────────────────────────────────────────────
// The tool layer is a CONTRACT — three surfaces will implement it (the edit
// tab's buttons, the chat panel, and MCP). A contract nobody checks is a
// suggestion, so the things that must never drift are pinned here.
//
// The one that matters most: a FREE operation must never become chargeable.
// Every free/paid decision in this product was made once, deliberately, with the
// owner. If a pricing table can quietly overrule that, then the price a customer
// was shown and the price they paid can differ — and nothing on screen would say
// so. That is the failure this file exists to prevent.

import { describe, it, expect } from 'vitest';

import {
  OPERATIONS, FREE, METERED, RATIOS, PLAN_LIMITS,
  isFree, isMetered, freeOperations, meteredOperations,
  creditCost, planCost, validate, validatePlan, checkLimits,
} from './edit-ops.js';

describe('the free/paid line', () => {
  it('classifies every operation — none may be left undecided', () => {
    for (const [name, spec] of Object.entries(OPERATIONS)) {
      expect([FREE, METERED], `${name} has no billing decision`).toContain(spec.billing);
    }
  });

  it('keeps arranging free and making metered', () => {
    // Pinned by name on purpose. If someone moves one of these across the line,
    // that is a PRICING CHANGE to a live product and it should require editing
    // this list and explaining why — not slip through as a refactor.
    expect(freeOperations().sort()).toEqual([
      'addText', 'concat', 'mixAudio', 'overlay', 'resize', 'speed', 'trim', 'volume',
    ]);
    expect(meteredOperations().sort()).toEqual([
      'generateMusic', 'generateVoice', 'generativeResize', 'omniEdit',
      'removeBackground', 'upscale',
    ]);
  });

  // ── TRAP 1 — the most confusable point in the product ──────────────────
  it('separates ADDING audio you have from MAKING audio with AI', () => {
    expect(isFree('mixAudio')).toBe(true);
    expect(isMetered('generateMusic')).toBe(true);
    expect(isMetered('generateVoice')).toBe(true);
  });

  // ── TRAP 2 — both are "change the size" to a customer ──────────────────
  it('separates cropping to a new shape from AI filling the new space', () => {
    expect(isFree('resize')).toBe(true);
    expect(isMetered('generativeResize')).toBe(true);
  });
});

describe('creditCost', () => {
  it('charges nothing for free operations', () => {
    for (const name of freeOperations()) {
      expect(creditCost(name)).toBe(0);
    }
  });

  // ── THE GUARANTEE THE WHOLE DESIGN RESTS ON ──────────────────────────────
  // Deliberately hostile: a pricing table that has grown an entry for every
  // free operation. This is not far-fetched — a future pricing import keyed by
  // operation name would do exactly this by accident.
  it('IGNORES a pricing entry that tries to charge for a free operation', () => {
    const hostile = Object.fromEntries(freeOperations().map((n) => [n, 99]));
    for (const name of freeOperations()) {
      expect(creditCost(name, hostile), `${name} was charged despite being free`).toBe(0);
    }
    expect(planCost(freeOperations().map((op) => ({ op })), hostile).credits).toBe(0);
  });

  it('prices metered operations from the table it is given', () => {
    // 1 credit is what an audio generation costs today
    // (server/src/credits.js — CREDIT_COST_AUDIO defaults to '1').
    expect(creditCost('generateMusic', { generateMusic: 1 })).toBe(1);
    expect(creditCost('generateVoice', { generateVoice: 1 })).toBe(1);
  });

  it('returns null — never 0 — when a metered price is unknown', () => {
    // 0 would give the work away silently; a default would overcharge silently.
    // Refusing to answer is the only honest option, and callers must handle it.
    expect(creditCost('omniEdit', {})).toBeNull();
    expect(creditCost('upscale', { somethingElse: 5 })).toBeNull();
  });

  it('returns null for an operation that does not exist', () => {
    expect(creditCost('teleport')).toBeNull();
  });
});

describe('planCost', () => {
  it("reports the owner's own scenario: 3 clips → a reel, 2 credits", () => {
    // Their exact example: three generated videos cut and joined into one 30s
    // reel with generated music, a generated voice-over, a watermark, and three
    // platform exports. Everything except the two generations is free.
    const plan = [
      { op: 'trim', start: 0, end: 10 },
      { op: 'trim', start: 0, end: 10 },
      { op: 'trim', start: 0, end: 10 },
      { op: 'concat', clips: ['a', 'b', 'c'] },
      { op: 'generateMusic', prompt: 'upbeat electronic' },
      { op: 'generateVoice', text: 'Welcome to Voxel' },
      { op: 'mixAudio', audio: 'music' },
      { op: 'overlay', image: 'logo' },
      { op: 'resize', ratio: '9:16' },
      { op: 'resize', ratio: '1:1' },
      { op: 'resize', ratio: '16:9' },
    ];
    const cost = planCost(plan, { generateMusic: 1, generateVoice: 1 });
    expect(cost.credits).toBe(2);
    expect(cost.unknown).toEqual([]);
    expect(cost.allFree).toBe(false);
  });

  it('costs nothing when the customer brings their own music and voice', () => {
    const plan = [
      { op: 'trim', start: 0, end: 10 },
      { op: 'concat', clips: ['a', 'b'] },
      { op: 'mixAudio', audio: 'their-own-track.mp3' },
      { op: 'overlay', image: 'logo' },
      { op: 'resize', ratio: '9:16' },
    ];
    const cost = planCost(plan);
    expect(cost.credits).toBe(0);
    expect(cost.allFree).toBe(true);
  });

  it('keeps an unpriced step OUT of the total and names it', () => {
    // A total that quietly swallows a line it could not price is a number the
    // customer would be right to dispute after the fact.
    const cost = planCost(
      [{ op: 'trim', start: 0, end: 5 }, { op: 'omniEdit', prompt: 'make it night' }],
      {},
    );
    expect(cost.credits).toBe(0);
    expect(cost.unknown).toEqual(['omniEdit']);
    expect(cost.allFree).toBe(false); // unknown ≠ free
  });
});

describe('validate', () => {
  it('accepts well-formed operations', () => {
    expect(validate({ op: 'trim', start: 2, end: 8 })).toEqual([]);
    expect(validate({ op: 'resize', ratio: '9:16', mode: 'crop' })).toEqual([]);
    expect(validate({ op: 'concat', clips: ['a', 'b'] })).toEqual([]);
  });

  it('rejects a backwards or empty trim', () => {
    expect(validate({ op: 'trim', start: 8, end: 2 })[0]).toMatch(/after start/i);
    expect(validate({ op: 'trim', start: 5, end: 5 })[0]).toMatch(/after start/i);
    expect(validate({ op: 'trim', start: -1, end: 5 })[0]).toMatch(/0 or more/i);
  });

  it('rejects a shape nobody publishes to, and says which are allowed', () => {
    const [err] = validate({ op: 'resize', ratio: '3:7' });
    expect(err).toMatch(/9:16/);
    expect(err).toMatch(/16:9/);
  });

  it('refuses to join fewer than two clips', () => {
    expect(validate({ op: 'concat', clips: ['only-one'] })[0]).toMatch(/two clips/i);
  });

  it('bounds speed where audio is still usable', () => {
    expect(validate({ op: 'speed', rate: 2 })).toEqual([]);
    expect(validate({ op: 'speed', rate: 10 })[0]).toMatch(/0\.25/);
  });

  it('requires a description for anything generative', () => {
    expect(validate({ op: 'generateMusic', prompt: '  ' })[0]).toMatch(/describe/i);
    expect(validate({ op: 'omniEdit', prompt: '' })[0]).toMatch(/describe/i);
    expect(validate({ op: 'generateVoice', text: '' })[0]).toMatch(/what the voice/i);
  });

  it('names an unknown operation rather than failing silently', () => {
    expect(validate({ op: 'teleport' })[0]).toMatch(/Unknown operation: teleport/);
  });

  it('keeps each error attached to its step number', () => {
    const bad = validatePlan([
      { op: 'trim', start: 0, end: 5 },
      { op: 'trim', start: 9, end: 1 },
    ]);
    expect(bad).toHaveLength(1);
    expect(bad[0].index).toBe(1);
  });
});

describe('plan limits', () => {
  it('covers every plan that can be sold', () => {
    // The six plans in src/lib/creditPricing.js. A plan with no limits entry
    // would silently fall back to Micro's caps, which reads to a Max customer
    // as the product being broken.
    expect(Object.keys(PLAN_LIMITS).sort())
      .toEqual(['basic', 'max', 'micro', 'plus', 'pro', 'starter']);
  });

  it('never lets a smaller plan out-rank a bigger one', () => {
    const order = ['micro', 'starter', 'basic', 'plus', 'pro', 'max'];
    for (let i = 1; i < order.length; i += 1) {
      const lower = PLAN_LIMITS[order[i - 1]];
      const higher = PLAN_LIMITS[order[i]];
      expect(higher.maxDurationSec).toBeGreaterThanOrEqual(lower.maxDurationSec);
      expect(higher.maxHeight).toBeGreaterThanOrEqual(lower.maxHeight);
      expect(higher.savedProjects).toBeGreaterThanOrEqual(lower.savedProjects);
    }
  });

  it('says which limit was hit and what the plan allows', () => {
    const { ok, problems } = checkLimits({ plan: 'micro', durationSec: 90, height: 1080 });
    expect(ok).toBe(false);
    expect(problems[0].limit).toBe('duration');
    expect(problems[0].allowed).toBe(60);
    expect(problems[0].message).toMatch(/60s/);
    expect(problems[0].message).toMatch(/90s/);
  });

  it('lets the same project through on a bigger plan', () => {
    expect(checkLimits({ plan: 'basic', durationSec: 90, height: 1080 }).ok).toBe(true);
  });

  it('falls back to the tightest limits for an unknown plan', () => {
    // Someone with no plan must not get Max's caps by default.
    expect(checkLimits({ plan: 'nonsense', durationSec: 90 }).limits)
      .toEqual(PLAN_LIMITS.micro);
  });
});

describe('platform shapes', () => {
  it('covers where customers actually publish', () => {
    expect(Object.keys(RATIOS)).toEqual(['9:16', '1:1', '4:5', '16:9']);
    expect(RATIOS['9:16'].label).toMatch(/Reels/);
  });
});
