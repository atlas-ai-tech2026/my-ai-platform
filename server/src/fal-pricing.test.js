import { describe, it, expect } from 'vitest';
import { estimateFalCost, backfillFalEstimate } from './fal-pricing.js';

// Workbook cross-checks (Voxel_Plans_and_Credits.xlsx → "Model Credits",
// fal cost column, USD).
describe('estimateFalCost', () => {
  it('prices images by quality tier', () => {
    expect(estimateFalCost({ kind: 'image', model: 'Nano Banana Pro', quality: '1K' })).toBe(0.15);
    expect(estimateFalCost({ kind: 'image', model: 'Nano Banana Pro', quality: '4K' })).toBe(0.30);
    expect(estimateFalCost({ kind: 'image', model: 'GPT Image 2', quality: '2K' })).toBe(0.234);
  });

  it('prices per-second video with audio tiers', () => {
    // Seedance 2.0 @720p $0.3024/s × 5s
    expect(estimateFalCost({ kind: 'video', model: 'Seedance 2.0', resolution: '720p', duration: 5 })).toBe(1.512);
    // Kling 3.0 audio $0.112/s × 5s, no-audio $0.084/s × 5s
    expect(estimateFalCost({ kind: 'video', model: 'Kling 3.0', resolution: '1080p', duration: 5, audio: true })).toBe(0.56);
    expect(estimateFalCost({ kind: 'video', model: 'Kling 3.0', resolution: '1080p', duration: 5, audio: false })).toBe(0.42);
  });

  it('prices TTS per 1,000 characters', () => {
    expect(estimateFalCost({ kind: 'audio', model: 'TTS', chars: 500 })).toBe(0.05);
    expect(estimateFalCost({ kind: 'audio', model: 'TTS', chars: 2000 })).toBe(0.2);
  });

  it('returns null for models without a fal price on file', () => {
    expect(estimateFalCost({ kind: 'video', model: 'Kling 2.1', duration: 5 })).toBeNull();
    expect(estimateFalCost({ kind: 'image', model: 'Soul 2.0' })).toBeNull();
  });
});

describe('backfillFalEstimate (historical rows)', () => {
  it('fills FAL-era rows of models that later switched to kie', () => {
    // Nano Banana Pro on 2026-07-15 ran on FAL: -4 = 1K/2K → $0.15
    expect(backfillFalEstimate({ reason: 'image: Nano Banana Pro', amount: '-4.00', createdAt: '2026-07-15' })).toBe(0.15);
    expect(backfillFalEstimate({ reason: 'image: Nano Banana Pro', amount: '-8.00', createdAt: '2026-07-15' })).toBe(0.30);
    // Kling 3.0 pre-switch: voxel 12.5 × 0.032 → $0.40
    expect(backfillFalEstimate({ reason: 'video: Kling 3.0', amount: '-12.50', createdAt: '2026-07-15' })).toBe(0.4);
  });

  it('refuses kie-era rows (the kie backfill owns those)', () => {
    expect(backfillFalEstimate({ reason: 'image: Nano Banana Pro', amount: '-4.00', createdAt: '2026-07-25' })).toBeNull();
    expect(backfillFalEstimate({ reason: 'video: Kling 3.0', amount: '-12.50', createdAt: '2026-07-25' })).toBeNull();
  });

  it('fills never-switched FAL models at any pre-tracking date, TTS flat', () => {
    expect(backfillFalEstimate({ reason: 'audio: TTS', amount: '-1.00', createdAt: '2026-07-25' })).toBe(0.1);
  });

  it('refuses unlabeled and unpriced rows', () => {
    expect(backfillFalEstimate({ reason: null, amount: '-4', createdAt: '2026-07-15' })).toBeNull();
    expect(backfillFalEstimate({ reason: 'video: Kling 2.1', amount: '-8', createdAt: '2026-07-15' })).toBeNull();
  });
});
