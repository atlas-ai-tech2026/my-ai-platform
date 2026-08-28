// ─── text-clip.test.js ───────────────────────────────────────────────────────
// The thing worth guarding here is that the VIEWER and the EXPORT agree.
//
// They call one function, textLayout, precisely so a title cannot sit in one
// place on screen and another in the file. A preview that does not predict the
// output is worse than no preview: it is a promise that gets broken after the
// render, when it is too late to move anything.
//
// So most of this is geometry at different frame sizes — the 16:9 preview and
// the 9:16 export of the same project must put the same title in the same
// place, proportionally.

import { describe, it, expect } from 'vitest';
import {
  TEXT_DEFAULTS, TEXT_PRESETS, presetById, textOf, hasText,
  textLayout, applyPreset, setText,
} from './text-clip.js';

const clip = (text) => ({ id: 'c1', kind: 'text', name: 'Title card', text });

describe('a clip that was never given words', () => {
  it('falls back to its NAME rather than rendering nothing', () => {
    // Every text clip that exists today was made before content existed, so
    // this is not a hypothetical — it is the entire current population. The
    // timeline already shows the name, so matching it is the least surprising
    // thing that can happen.
    expect(textOf({ kind: 'text', name: 'Title card' }).text).toBe('Title card');
  });

  it('renders NOTHING when there is genuinely nothing', () => {
    // An empty text clip must not put a black plate over the picture.
    expect(hasText({ kind: 'text', name: '' })).toBe(false);
    expect(hasText({ kind: 'text', name: '   ' })).toBe(false);
  });

  it('never lets a missing field reach the frame as "undefined"', () => {
    const t = textOf({ kind: 'text', name: 'Hi', text: { size: undefined, color: undefined } });
    expect(t.color).toBe(TEXT_DEFAULTS.color);
    expect(t.size).toBe(TEXT_DEFAULTS.size);
    expect(JSON.stringify(t)).not.toMatch(/undefined/);
  });

  it('survives a text field that is not an object', () => {
    // Hand-edited projects and older shapes both exist.
    expect(textOf({ kind: 'text', name: 'Hi', text: 'just a string' }).text).toBe('Hi');
    expect(() => textOf(null)).not.toThrow();
  });
});

describe('the preview must predict the file', () => {
  const c = { kind: 'text', name: 'VOXEL', text: { text: 'VOXEL', size: 0.1, x: 0.5, y: 0.5 } };

  it('puts the title in the same PROPORTIONAL place at any frame size', () => {
    const small = textLayout(c, { width: 640, height: 360 });
    const big = textLayout(c, { width: 1920, height: 1080 });
    expect(small.x / 640).toBeCloseTo(big.x / 1920, 5);
    expect(small.y / 360).toBeCloseTo(big.y / 1080, 5);
  });

  it('scales the TYPE with the frame, so a Reel is not a different design', () => {
    // 32 stored pixels would be a headline on a phone crop and unreadable on
    // 1080p. A fraction of the height is the same title in both.
    const wide = textLayout(c, { width: 1920, height: 1080 });
    const reel = textLayout(c, { width: 1080, height: 1920 });
    expect(wide.fontPx).toBe(108);   // 0.1 × 1080
    expect(reel.fontPx).toBe(192);   // 0.1 × 1920
  });

  it('keeps the anchor inside the frame however silly the numbers are', () => {
    const out = textLayout({ kind: 'text', name: 'x', text: { x: 5, y: -3, size: 99 } },
      { width: 1000, height: 500 });
    expect(out.x).toBeLessThanOrEqual(1000);
    expect(out.y).toBeGreaterThanOrEqual(0);
    expect(out.fontPx).toBeLessThanOrEqual(500);
  });

  it('never returns a zero or negative font size', () => {
    // A 0px font draws nothing, which reads as "the export dropped my title".
    expect(textLayout({ kind: 'text', name: 'x', text: { size: 0 } }, { width: 10, height: 10 }).fontPx)
      .toBeGreaterThan(0);
    expect(textLayout({ kind: 'text', name: 'x' }, { width: 0, height: 0 }).fontPx).toBeGreaterThan(0);
  });

  it('falls back to a centred alignment for a nonsense value', () => {
    expect(textLayout({ kind: 'text', name: 'x', text: { align: 'sideways' } },
      { width: 100, height: 100 }).align).toBe('center');
  });
});

describe('the shadow, which is on by default and should stay that way', () => {
  it('is on unless it is turned off', () => {
    // White text over a bright sky is invisible, and that is the commonest way
    // a title is unreadable in a finished video. It costs nothing.
    expect(textLayout(clip({ text: 'Hi' }), { width: 1920, height: 1080 }).shadowPx).toBeGreaterThan(0);
  });

  it('scales with the type, so it is the same shadow at every output size', () => {
    const a = textLayout(clip({ text: 'Hi', size: 0.05 }), { width: 1920, height: 1080 });
    const b = textLayout(clip({ text: 'Hi', size: 0.05 }), { width: 3840, height: 2160 });
    expect(b.shadowPx / a.shadowPx).toBeCloseTo(2, 0);
  });

  it('can be turned off', () => {
    expect(textLayout(clip({ text: 'Hi', shadow: false }), { width: 1920, height: 1080 }).shadowPx).toBe(0);
  });
});

describe('presets are the words people actually use', () => {
  it('offers Title, Lower third, Caption and Corner note', () => {
    expect(TEXT_PRESETS.map((p) => p.label))
      .toEqual(['Title', 'Lower third', 'Caption', 'Corner note']);
  });

  it('applying one does NOT lose the words already typed', () => {
    // Choosing a placement must never delete the sentence.
    const c = setText({ kind: 'text', name: 'x' }, 'Welcome to the workshop');
    expect(textOf(applyPreset(c, 'caption')).text).toBe('Welcome to the workshop');
  });

  it('a caption gets a plate behind it — that is what makes it readable', () => {
    expect(textOf(applyPreset(clip({}), 'caption')).background).toBeTruthy();
  });

  it('a lower third sits low and left, like every lower third ever made', () => {
    const l = textLayout(applyPreset(clip({}), 'lowerThird'), { width: 1000, height: 1000 });
    expect(l.align).toBe('left');
    expect(l.y).toBeGreaterThan(700);
  });

  it('an unknown preset changes nothing rather than throwing', () => {
    const c = clip({ text: 'Hi' });
    expect(applyPreset(c, 'nope')).toBe(c);
    expect(presetById('nope')).toBeNull();
  });
});

describe('editing', () => {
  it('typing does not disturb the layout', () => {
    const styled = applyPreset(clip({}), 'lowerThird');
    const typed = setText(styled, 'New words');
    expect(textOf(typed).text).toBe('New words');
    expect(textOf(typed).align).toBe('left');
    expect(textOf(typed).size).toBe(textOf(styled).size);
  });

  it('does not mutate the clip it was given', () => {
    const c = clip({ text: 'before' });
    setText(c, 'after');
    expect(textOf(c).text).toBe('before');
  });
});
