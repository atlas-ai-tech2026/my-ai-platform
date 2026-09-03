// ─── seedance-reference.test.js ──────────────────────────────────────────────
// A Seedance job with a reference video is billed on the video's length —
// read from the file, never taken from the browser when the file can be read.

import { describe, it, expect } from 'vitest';
import { referenceVideoBilling } from './seedance-reference.js';

describe('billing seconds for a Seedance job that carries a reference video', () => {
  it('bills the LONGEST reference video, read from the file', () => {
    const v = referenceVideoBilling({ probed: [6.2, 12.6, 9], declared: 12.6, maxSeconds: 30 });
    expect(v).toMatchObject({ unreadable: false, source: 'file', seconds: 13, outOfRange: false, drift: false });
  });

  it('prefers the file over the browser when they disagree, and says so', () => {
    const v = referenceVideoBilling({ probed: [20], declared: 5, maxSeconds: 30 });
    expect(v.seconds).toBe(20);
    expect(v.source).toBe('file');
    expect(v.drift).toBe(true);
    expect(v.declared).toBe(5);
  });

  it('falls back to the browser number only when no file could be read', () => {
    const v = referenceVideoBilling({ probed: [null, null], declared: 8, maxSeconds: 30 });
    expect(v).toMatchObject({ source: 'declared', seconds: 8, drift: false });
  });

  it('is honest when neither the file nor the browser gave a length', () => {
    expect(referenceVideoBilling({ probed: [null], declared: undefined })).toEqual({ unreadable: true });
    expect(referenceVideoBilling({ probed: [], declared: 0 })).toEqual({ unreadable: true });
  });

  it('flags a video outside 4–30 s (Seedance 2.5) as out of range, but still clamps the number', () => {
    expect(referenceVideoBilling({ probed: [45], maxSeconds: 30 })).toMatchObject({ outOfRange: true, longest: 45, seconds: 30 });
    expect(referenceVideoBilling({ probed: [2.2], maxSeconds: 30 })).toMatchObject({ outOfRange: true, longest: 2, seconds: 4 });
  });

  it('uses the 2.0 family ceiling of 15 s when told to', () => {
    expect(referenceVideoBilling({ probed: [20], maxSeconds: 15 })).toMatchObject({ outOfRange: true, seconds: 15 });
    expect(referenceVideoBilling({ probed: [14.4], maxSeconds: 15 })).toMatchObject({ outOfRange: false, seconds: 14 });
  });

  it('rounds to whole seconds the way kie does', () => {
    expect(referenceVideoBilling({ probed: [7.49] }).seconds).toBe(7);
    expect(referenceVideoBilling({ probed: [7.5] }).seconds).toBe(8);
  });
});
