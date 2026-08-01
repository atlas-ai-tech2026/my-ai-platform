// ─── pricing.test.js ─────────────────────────────────────────────────────────
// C1 (security audit 2026-07-28): the server computes every generation
// price. These tests prove the exploit is closed — a client sending
// credit_cost: 0.01 for a premium video is rejected, never charged 0.01 —
// and that server tables and the frontend display fallback stay in lockstep.

import { describe, it, expect } from 'vitest';
import {
  IMAGE_CREDITS,
  VIDEO_CREDITS,
  getImageCredits,
  getVideoCredits,
  resolveChargeCost,
  UnpricedModelError,
  PriceMismatchError,
} from './pricing.js';
import {
  IMAGE_CREDITS as FRONTEND_IMAGE_CREDITS,
  VIDEO_CREDITS as FRONTEND_VIDEO_CREDITS,
} from '../../src/lib/creditPricing.js';

describe('C1 exploit closed — client cannot name its own price', () => {
  it('premium video with credit_cost 0.01 is REJECTED with the correct price (409 path)', () => {
    // Veo 3.1 @ 1080p is 34 credits. The attack from the audit: send 0.01.
    let err;
    try {
      resolveChargeCost({
        kind: 'video', model: 'Veo 3.1', resolution: '1080p',
        duration: 8, audio: true, clientCost: 0.01,
      });
    } catch (e) { err = e; }
    expect(err).toBeInstanceOf(PriceMismatchError);
    expect(err.correctCost).toBe(34);
    expect(err.clientCost).toBe(0.01);
  });

  it('premium image with credit_cost 0.01 is REJECTED with the correct price', () => {
    let err;
    try {
      resolveChargeCost({
        kind: 'image', model: 'Nano Banana Pro', quality: '4K', clientCost: 0.01,
      });
    } catch (e) { err = e; }
    expect(err).toBeInstanceOf(PriceMismatchError);
    expect(err.correctCost).toBe(8);
  });

  it('inflated client price is also rejected (server number always wins)', () => {
    expect(() => resolveChargeCost({
      kind: 'video', model: 'Sora 2', resolution: '1080p', clientCost: 9999,
    })).toThrow(PriceMismatchError);
  });

  it('a normal request without a hint charges the server-computed price', () => {
    expect(resolveChargeCost({
      kind: 'video', model: 'Veo 3.1', resolution: '1080p', duration: 8, audio: true,
    })).toBe(34);
  });

  it('a matching hint (honest UI) passes and charges the server price', () => {
    expect(resolveChargeCost({
      kind: 'video', model: 'Veo 3.1', resolution: '1080p', duration: 8,
      audio: true, clientCost: 34,
    })).toBe(34);
    expect(resolveChargeCost({
      kind: 'image', model: 'GPT Image 2', quality: '2K', clientCost: 6.5,
    })).toBe(6.5);
  });

  it('a model with no price on file is rejected, never guessed (400 path)', () => {
    expect(() => resolveChargeCost({
      kind: 'video', model: 'Luma Dream Machine', resolution: '1080p',
    })).toThrow(UnpricedModelError);
    expect(() => resolveChargeCost({
      kind: 'video', model: 'Nano Banana Pro Video', resolution: '1080p',
    })).toThrow(UnpricedModelError);
    expect(() => resolveChargeCost({
      kind: 'image', model: 'Totally Made Up Model', quality: '1K',
    })).toThrow(UnpricedModelError);
  });
});

describe('server-side price computation (labels → workbook prices)', () => {
  it('image quality tiers', () => {
    expect(getImageCredits('Nano Banana Pro', '1K')).toBe(4);
    expect(getImageCredits('Nano Banana Pro', '4K')).toBe(8);
    expect(getImageCredits('GPT Image 2', '2K')).toBe(6.5);
    expect(getImageCredits('GPT Image 2', '4K')).toBe(11);
    expect(getImageCredits('Seedream 5.0 Lite', '4K')).toBe(1);
    // Missing quality falls back to 1K, like the UI
    expect(getImageCredits('Nano Banana Pro', undefined)).toBe(4);
  });

  it('per-second video with audio tiers (Kling 3.0)', () => {
    expect(getVideoCredits('Kling 3.0', { resolution: '1080p', duration: 5, audio: false })).toBe(12.5);
    expect(getVideoCredits('Kling 3.0', { resolution: '1080p', duration: 5, audio: true })).toBe(20);
    expect(getVideoCredits('Kling 3.0', { resolution: '4K', duration: 8, audio: true })).toBe(72);
  });

  it('per-second video by resolution (Seedance 2.0), string durations', () => {
    expect(getVideoCredits('Seedance 2.0', { resolution: '720p', duration: '5' })).toBe(40);
    expect(getVideoCredits('Seedance 2.0', { resolution: '1080p', duration: '10s' })).toBe(180);
    expect(getVideoCredits('Seedance 2.0 Fast', { resolution: '480p', duration: 4 })).toBe(12);
  });

  it("duration 'auto' prices as the 5s app default (matches the UI estimate)", () => {
    expect(getVideoCredits('Seedance 2.0', { resolution: '720p', duration: 'auto' })).toBe(40);
    expect(getVideoCredits('Seedance 2.0', { resolution: '720p', duration: undefined })).toBe(40);
  });

  it('flat per-clip video is duration-independent (Veo)', () => {
    expect(getVideoCredits('Veo 3.1', { resolution: '720p', duration: 4 })).toBe(33);
    expect(getVideoCredits('Veo 3.1', { resolution: '720p', duration: 8 })).toBe(33);
    expect(getVideoCredits('Veo 3 Fast', { resolution: '1080p' })).toBe(9);
  });

  it('unpriced resolution falls back to the model defaultRes, like the UI', () => {
    expect(getVideoCredits('Veo 3.1', { resolution: 'weird' })).toBe(34); // defaultRes 1080p
    expect(getVideoCredits('Kling 2.6', { resolution: '720p', duration: 5 })).toBe(7.5); // only 1080p priced
  });

  it('Motion Control / Edit panels priced by quality field', () => {
    expect(getVideoCredits('Kling 3.0 Motion Control', { resolution: '720p' })).toBe(8);
    expect(getVideoCredits('Kling 3.0 Motion Control', { resolution: '1080p' })).toBe(11);
    expect(getVideoCredits('Kling Motion Control', { resolution: undefined })).toBe(6); // defaultRes 720p
    expect(getVideoCredits('Kling O1 Video Edit', { resolution: '1080p' })).toBe(10);
    expect(getVideoCredits('Kling 3.0 Omni Edit', {})).toBe(10);
  });
});

describe('server tables and frontend display fallback stay in lockstep', () => {
  it('IMAGE_CREDITS matches src/lib/creditPricing.js', () => {
    expect(IMAGE_CREDITS).toEqual(FRONTEND_IMAGE_CREDITS);
  });

  it('VIDEO_CREDITS matches src/lib/creditPricing.js', () => {
    expect(VIDEO_CREDITS).toEqual(FRONTEND_VIDEO_CREDITS);
  });
});
