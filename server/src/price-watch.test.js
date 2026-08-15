// ─── price-watch.test.js ─────────────────────────────────────────────────────
// This module decides whether a customer's price should change. Nothing else in
// the costing code is that close to real money, so the tests are weighted to
// the ways it could quietly do the wrong thing:
//
//   · rounding a sale price DOWN, selling below the 40% margin it exists to hold
//   · acting on a misparsed supplier price and multiplying a price by ten
//   · lowering our price when a supplier gets cheaper, giving away margin the
//     owner explicitly said to keep
//   · raising our price when the OTHER supplier is still the dearer one, so
//     nothing about our cost basis actually moved
//
// The gate itself — that nothing here applies without a human — is asserted in
// the route tests; here the concern is that what it PROPOSES is right.

import { describe, it, expect } from 'vitest';
import {
  pctChange, classify, saleCreditsFor, proposeChange, describe as describeChange,
  MIN_PCT, SUSPECT_PCT,
} from './price-watch.js';

describe('measuring the move', () => {
  it('reports a rise and a fall symmetrically', () => {
    expect(pctChange(0.42, 0.51)).toBeCloseTo(21.43, 2);
    expect(pctChange(0.51, 0.42)).toBeCloseTo(-17.65, 2);
  });

  it('refuses to divide by a zero or missing baseline', () => {
    for (const bad of [0, null, undefined, NaN, -1, 'x']) {
      expect(pctChange(bad, 0.5)).toBeNull();
    }
  });
});

describe('classifying it', () => {
  it('ignores noise below the threshold', () => {
    expect(classify(1.0, 1.005).kind).toBe('none');   // 0.5%
    expect(MIN_PCT).toBe(1);
  });

  it('separates a rise from a fall', () => {
    expect(classify(0.42, 0.51).kind).toBe('increase');
    expect(classify(0.51, 0.42).kind).toBe('decrease');
  });

  // The protection that matters. fal mixes per-second, per-megapixel and token
  // pricing in prose; a unit misread looks exactly like a huge price move.
  it('holds an implausible JUMP for a human', () => {
    expect(classify(0.42, 4.20).kind).toBe('needs_check');   // ×10
    expect(SUSPECT_PCT).toBe(50);
  });

  // Magnitude, not direction: a 90% "drop" is as likely to be a bad parse, and
  // acting on it would give the product away.
  it('holds an implausible COLLAPSE too', () => {
    expect(classify(4.20, 0.42).kind).toBe('needs_check');
  });

  it('says unknown when there is nothing to compare', () => {
    expect(classify(null, 0.5).kind).toBe('unknown');
    expect(classify(0.5, null).kind).toBe('unknown');
  });
});

describe('the sale price it proposes', () => {
  // basis / (1 - 0.4) / 0.063333, rounded UP to the next half credit.
  it('holds the 40% margin', () => {
    const credits = saleCreditsFor(0.09);
    expect(credits).toBe(2.5);
    const saleUsd = credits * 0.063333;
    expect((saleUsd - 0.09) / saleUsd).toBeGreaterThanOrEqual(0.4);
  });

  // Rounding DOWN is the quiet failure: it sells under the margin the rule is
  // there to protect, on every single generation.
  it('always rounds UP, never below the margin', () => {
    for (const basis of [0.01, 0.033, 0.077, 0.15, 0.42, 0.51, 1.23, 4.2]) {
      const credits = saleCreditsFor(basis);
      const saleUsd = credits * 0.063333;
      expect((saleUsd - basis) / saleUsd).toBeGreaterThanOrEqual(0.4 - 1e-9);
      expect(credits * 2).toBe(Math.round(credits * 2));   // half-credit grid
    }
  });

  it('refuses a nonsensical basis or margin instead of inventing a price', () => {
    for (const bad of [0, -1, null, undefined, NaN]) expect(saleCreditsFor(bad)).toBeNull();
    expect(saleCreditsFor(0.09, { marginTarget: 1 })).toBeNull();
    expect(saleCreditsFor(0.09, { marginTarget: -0.1 })).toBeNull();
  });
});

describe('what it proposes, end to end', () => {
  const base = { provider: 'fal', family: 'kling3', usdPerCredit: 0.063333 };

  it('queues a rise for review with both prices and both credit figures', () => {
    const c = proposeChange({ ...base, oldUsd: 0.42, newUsd: 0.51, basisBefore: 0.42, basisAfter: 0.51 });
    expect(c.status).toBe('pending');
    expect(c.old_price_usd).toBe(0.42);
    expect(c.new_price_usd).toBe(0.51);
    expect(c.new_credits).toBeGreaterThan(c.old_credits);
  });

  // The owner's explicit rule: a cheaper supplier is kept as extra margin, it
  // does not cut what we charge.
  it('never lowers our price when a supplier gets cheaper', () => {
    const c = proposeChange({ ...base, oldUsd: 0.51, newUsd: 0.42, basisBefore: 0.51, basisAfter: 0.42 });
    expect(c.kind).toBe('decrease');
    expect(c.status).toBe('skipped');       // recorded, never asks for a decision
  });

  // The margin rule is MAX(fal, kie). If fal rises but kie is still dearer, our
  // cost basis has not moved and there is nothing to ask about.
  it('stays silent when the other supplier is still the dearer one', () => {
    const c = proposeChange({
      ...base, oldUsd: 0.20, newUsd: 0.26,   // +30%: real, but below the suspect line
      basisBefore: 0.50, basisAfter: 0.50,   // kie unchanged at 0.50, still higher
    });
    expect(c).toBeNull();
  });

  it('marks an implausible jump for checking, not for approval', () => {
    const c = proposeChange({ ...base, oldUsd: 0.42, newUsd: 4.20, basisBefore: 0.42, basisAfter: 4.20 });
    expect(c.status).toBe('needs_check');
  });

  it('proposes nothing when the move is noise', () => {
    expect(proposeChange({ ...base, oldUsd: 1.0, newUsd: 1.002, basisBefore: 1.0, basisAfter: 1.002 })).toBeNull();
  });

  it('prefers the price actually on file over a recomputed one', () => {
    // The owner may have set a manual override; the "before" must reflect what
    // is really charged, not what the formula would have said. Here the
    // override (12) is BELOW the new formula price, so the rise does matter.
    const c = proposeChange({
      ...base, oldUsd: 0.42, newUsd: 0.51, basisBefore: 0.42, basisAfter: 0.51,
      currentCredits: 12,
    });
    expect(c.old_credits).toBe(12);
    expect(c.new_credits).toBe(13.5);
  });

  // Found by a test I had written wrongly: with an override far ABOVE the
  // formula price, a supplier rise cannot threaten the margin, so asking the
  // owner to approve a price INCREASE would be nonsense — the code is right to
  // stay silent. Pinned here so nobody "fixes" it later.
  it('stays silent when a manual override already covers the new cost', () => {
    const c = proposeChange({
      ...base, oldUsd: 0.42, newUsd: 0.51, basisBefore: 0.42, basisAfter: 0.51,
      currentCredits: 99,          // formula would say 13.5
    });
    expect(c).toBeNull();
  });

  // A wild number is a DATA problem worth surfacing even when our basis did not
  // move — unlike an ordinary rise, which is filtered out as a non-event.
  it('still flags an implausible price even if our basis is unchanged', () => {
    const c = proposeChange({
      ...base, oldUsd: 0.20, newUsd: 2.00,   // ×10
      basisBefore: 5.00, basisAfter: 5.00,   // kie still dearer; basis unmoved
    });
    expect(c.status).toBe('needs_check');
  });

  it('reads back as a sentence a human can check', () => {
    const c = proposeChange({ ...base, oldUsd: 0.42, newUsd: 0.51, basisBefore: 0.42, basisAfter: 0.51 });
    const s = describeChange(c);
    expect(s).toContain('kling3');
    expect(s).toMatch(/\$0\.4200 → \$0\.5100/);
    expect(s).toMatch(/our price .* → .* credits/);
  });
});
