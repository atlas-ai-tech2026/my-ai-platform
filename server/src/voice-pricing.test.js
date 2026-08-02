// ─── voice-pricing.test.js ───────────────────────────────────────────────────
// Voice was the ONLY negative-margin path in the platform. TTS charged a FLAT
// 1 credit per take regardless of length, while the workbook prices voice per
// 1,000 characters. A full 5,000-character take cost us $0.50 and earned
// $0.063 — a margin of −689%. Anything over ~380 characters lost money.
//
// Workbook ("VOICE MODELS — per 1,000 characters"), same formula as every
// other model — basis = MAX(fal, kie) → sale = basis / (1 − 40%) →
// CEILING(sale / $0.063333, 0.5):
//     Multilingual v2  basis $0.10 → 3   credits / 1k chars
//     Eleven v3        basis $0.10 → 3   credits / 1k chars
//     Turbo v2.5       basis $0.05 → 1.5 credits / 1k chars

import { describe, it, expect } from 'vitest';
import { getVoiceCredits, VOICE_CREDITS_PER_1K, VOICE_MIN_CREDITS } from './pricing.js';

const CREDIT_VALUE = 19 / 300;      // $0.063333
const FAL_PER_1K = 0.1;             // Multilingual v2 / Eleven v3 cost basis
const marginOf = (credits, costUsd) => (credits * CREDIT_VALUE - costUsd) / (credits * CREDIT_VALUE);

describe('voice unit rates match the workbook exactly', () => {
  it('1,000 characters costs the sheet rate', () => {
    expect(getVoiceCredits('multilingual-v2', 1000)).toBe(3);
    expect(getVoiceCredits('eleven-v3', 1000)).toBe(3);
    expect(getVoiceCredits('turbo-v2-5', 1000)).toBe(1.5);
  });

  it('the rate table is the sheet’s', () => {
    expect(VOICE_CREDITS_PER_1K).toEqual({
      'multilingual-v2': 3, 'eleven-v3': 3, 'turbo-v2-5': 1.5,
    });
  });
});

describe('billing is PRO-RATED, like video per-second', () => {
  it('scales linearly with character count', () => {
    expect(getVoiceCredits('multilingual-v2', 500)).toBe(1.5);
    expect(getVoiceCredits('multilingual-v2', 1500)).toBe(4.5);
    expect(getVoiceCredits('multilingual-v2', 2500)).toBe(7.5);
    expect(getVoiceCredits('multilingual-v2', 5000)).toBe(15);
  });

  it('the cheaper model costs proportionally less', () => {
    expect(getVoiceCredits('turbo-v2-5', 5000)).toBe(7.5);   // half of v2
  });
});

describe('the negative-margin hole is closed', () => {
  // The regression this file exists for: every length must clear 40%.
  it.each([200, 500, 1000, 1500, 2500, 5000])('%i characters clears the 40%% rule', (chars) => {
    const credits = getVoiceCredits('multilingual-v2', chars);
    const cost = FAL_PER_1K * (chars / 1000);
    expect(marginOf(credits, cost)).toBeGreaterThanOrEqual(0.4);
  });

  it('a full 5,000-char take is now profitable (it used to lose $0.44)', () => {
    const credits = getVoiceCredits('multilingual-v2', 5000);
    const revenue = credits * CREDIT_VALUE;
    expect(revenue).toBeGreaterThan(0.5);          // our cost at 5k chars
    expect(credits).toBe(15);                       // vs 1 credit before
  });

  it('the OLD flat 1-credit charge would have failed this test', () => {
    // Proof the test is meaningful, not vacuous.
    expect(marginOf(1, FAL_PER_1K * 5)).toBeLessThan(0);
  });
});

describe('edge cases', () => {
  it('never charges zero — a tiny take still costs the floor', () => {
    expect(getVoiceCredits('multilingual-v2', 1)).toBe(VOICE_MIN_CREDITS);
    expect(getVoiceCredits('multilingual-v2', 0)).toBe(VOICE_MIN_CREDITS);
    expect(getVoiceCredits('multilingual-v2', 50)).toBe(VOICE_MIN_CREDITS);
  });

  it('an unknown model falls back to the standard rate, never to free', () => {
    expect(getVoiceCredits('something-new', 1000)).toBe(3);
    expect(getVoiceCredits(undefined, 1000)).toBe(3);
  });

  it('handles junk input without returning NaN', () => {
    for (const bad of [null, undefined, 'abc', -100]) {
      const c = getVoiceCredits('eleven-v3', bad);
      expect(Number.isFinite(c)).toBe(true);
      expect(c).toBeGreaterThanOrEqual(VOICE_MIN_CREDITS);
    }
  });

  it('rounds to 2dp so the NUMERIC(10,2) credits column stays exact', () => {
    const c = getVoiceCredits('multilingual-v2', 333);
    expect(c).toBe(Math.round(c * 100) / 100);
  });
});
