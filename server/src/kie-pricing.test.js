import { describe, it, expect } from 'vitest';
import { estimateKieCredits, KIE_USD_PER_CREDIT } from './kie-pricing.js';

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
