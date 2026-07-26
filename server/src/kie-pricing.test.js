import { describe, it, expect } from 'vitest';
import { estimateKieCredits, backfillKieEstimate, KIE_USD_PER_CREDIT } from './kie-pricing.js';

// Workbook cross-checks (Voxel_Plans_and_Credits.xlsx → "Model Credits",
// kie cost column): kie credits = kie USD / 0.005.
describe('estimateKieCredits', () => {
  it('prices images by quality tier', () => {
    // Nano Banana Pro: 1K/2K $0.09 → 18 cr, 4K $0.12 → 24 cr
    expect(estimateKieCredits({ kind: 'image', model: 'Nano Banana Pro', quality: '1K' })).toBe(18);
    expect(estimateKieCredits({ kind: 'image', model: 'Nano Banana Pro', quality: '2K' })).toBe(18);
    expect(estimateKieCredits({ kind: 'image', model: 'Nano Banana Pro', quality: '4K' })).toBe(24);
    // Draft falls back to the 1K price
    expect(estimateKieCredits({ kind: 'image', model: 'Nano Banana Pro', quality: 'Draft' })).toBe(18);
  });

  it('prices per-second video by resolution × duration', () => {
    // Seedance 2.0 @720p $0.205/s × 5s = $1.025 → 205 cr
    expect(estimateKieCredits({ kind: 'video', model: 'Seedance 2.0', resolution: '720p', duration: 5 })).toBe(205);
    // Kling 3.0 with audio @1080p $0.135/s × 10s → 270 cr
    expect(estimateKieCredits({ kind: 'video', model: 'Kling 3.0', resolution: '1080p', duration: 10, audio: true })).toBe(270);
    // Kling 3.0 no audio @1080p $0.09/s × 5s → 90 cr
    expect(estimateKieCredits({ kind: 'video', model: 'Kling 3.0', resolution: '1080p', duration: 5, audio: false })).toBe(90);
  });

  it('prices per-clip video regardless of duration', () => {
    // Veo 3.1 quality 1080p $1.275 → 255 cr at any duration
    expect(estimateKieCredits({ kind: 'video', model: 'Veo 3.1', resolution: '1080p', duration: 8 })).toBe(255);
    expect(estimateKieCredits({ kind: 'video', model: 'Veo 3 Fast', resolution: '720p', duration: 8 })).toBe(60);
  });

  it('scales Kling 2.6 per second with the audio tier', () => {
    // no audio $0.055/s × 5s = $0.275 → 55 cr (the sheet's 5s clip price)
    expect(estimateKieCredits({ kind: 'video', model: 'Kling 2.6', duration: 5, audio: false })).toBe(55);
    expect(estimateKieCredits({ kind: 'video', model: 'Kling 2.6', duration: 10, audio: true })).toBe(220);
  });

  it('falls back to a priced resolution tier when the requested one is absent', () => {
    // Seedance 2.0 Fast has no 1080p price → nearest at-or-below = 720p
    expect(estimateKieCredits({ kind: 'video', model: 'Seedance 2.0 Fast', resolution: '1080p', duration: 5 }))
      .toBe(estimateKieCredits({ kind: 'video', model: 'Seedance 2.0 Fast', resolution: '720p', duration: 5 }));
  });

  it('returns null for models without a kie price on file', () => {
    expect(estimateKieCredits({ kind: 'video', model: 'Sora 2', duration: 10 })).toBeNull();
    expect(estimateKieCredits({ kind: 'image', model: 'Midjourney' })).toBeNull();
    expect(estimateKieCredits({ kind: 'video', model: 'Totally Unknown' })).toBeNull();
  });

  it('uses the documented kie credit rate', () => {
    expect(KIE_USD_PER_CREDIT).toBe(0.005);
  });
});

describe('backfillKieEstimate (historical rows)', () => {
  it('infers image quality tier from the voxel amount', () => {
    // Nano Banana Pro: -4 = 1K/2K → 18 kie cr; -8 = 4K → 24 kie cr
    expect(backfillKieEstimate({ reason: 'image: Nano Banana Pro', amount: '-4.00', createdAt: '2026-07-25' })).toBe(18);
    expect(backfillKieEstimate({ reason: 'image: Nano Banana Pro', amount: '-8.00', createdAt: '2026-07-25' })).toBe(24);
  });

  it('scales video estimates from voxel credits by the per-model ratio', () => {
    // Kling 3.0: -12.5 voxel (5s 1080p) × 7.0 → 87.5 kie cr (direct calc: 90)
    expect(backfillKieEstimate({ reason: 'video: Kling 3.0', amount: '-12.50', createdAt: '2026-07-25' })).toBe(87.5);
  });

  it('refuses rows from before the model ran on kie', () => {
    // Kling 3.0 switched FAL→kie on 2026-07-20; earlier rows cost zero kie
    expect(backfillKieEstimate({ reason: 'video: Kling 3.0', amount: '-12.50', createdAt: '2026-07-15' })).toBeNull();
  });

  it('refuses FAL models, unlabeled rows, and unpriced kie models', () => {
    expect(backfillKieEstimate({ reason: 'video: Kling 2.1', amount: '-8', createdAt: '2026-07-25' })).toBeNull();
    expect(backfillKieEstimate({ reason: null, amount: '-4', createdAt: '2026-07-25' })).toBeNull();
    expect(backfillKieEstimate({ reason: 'video: Sora 2', amount: '-10', createdAt: '2026-07-25' })).toBeNull();
    expect(backfillKieEstimate({ reason: 'audio: TTS', amount: '-1', createdAt: '2026-07-25' })).toBeNull();
  });
});
