// ─── video-prompt.test.js ────────────────────────────────────────────────────
// The continuity guard for Kling image-to-video (owner, 2026-08-25): "the
// video must be generated from the same image — one shot."

import { describe, it, expect } from 'vitest';
import { withContinuity, CONTINUITY_SUFFIX } from './video-prompt.js';

describe('a Kling image-to-video request asks for ONE continuous shot', () => {
  it('appends the instruction when an image is uploaded and Multi Shot is off', () => {
    const out = withContinuity('a woman walks through a market', { hasImage: true, multiShots: false, model: 'Kling 3.0' });
    expect(out).toBe(`a woman walks through a market. ${CONTINUITY_SUFFIX}`);
  });

  it('covers every Kling tier — Omni and Turbo included, since they take images too', () => {
    for (const model of ['Kling 3.0 Omni', 'Kling 3.0 Turbo', 'Kling 2.6', 'Kling 2.1']) {
      expect(withContinuity('p', { hasImage: true, multiShots: false, model })).toContain(CONTINUITY_SUFFIX);
    }
  });

  it('does NOT touch a text-to-video request — there is no image to stay on', () => {
    expect(withContinuity('a city at dawn', { hasImage: false, multiShots: false, model: 'Kling 3.0' })).toBe('a city at dawn');
  });

  it('does NOT touch a request where the customer switched Multi Shot ON', () => {
    expect(withContinuity('p', { hasImage: true, multiShots: true, model: 'Kling 3.0' })).toBe('p');
  });

  it('does NOT touch non-Kling models — their semantics are their own', () => {
    for (const model of ['Seedance 2.5', 'Gemini Omni', 'Veo 3.1 Quality', 'Sora 2']) {
      expect(withContinuity('p', { hasImage: true, multiShots: false, model })).toBe('p');
    }
  });

  it('does not double up when the customer already asked for one shot', () => {
    const own = 'slow push-in, one continuous shot, no cuts';
    expect(withContinuity(own, { hasImage: true, multiShots: false, model: 'Kling 3.0' })).toBe(own);
  });

  it('never leaves a stray double full-stop', () => {
    const out = withContinuity('ends with a period.  ', { hasImage: true, multiShots: false, model: 'Kling 3.0' });
    expect(out).toBe(`ends with a period. ${CONTINUITY_SUFFIX}`);
  });

  it('an empty prompt stays empty (the route rejects it anyway)', () => {
    expect(withContinuity('   ', { hasImage: true, multiShots: false, model: 'Kling 3.0' })).toBe('');
  });
});
