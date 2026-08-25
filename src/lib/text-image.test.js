// ─── text-image.test.js ──────────────────────────────────────────────────────
// A real canvas draws nothing in jsdom, so these run against a RECORDING
// context: every call is captured and the decisions are asserted. That is the
// right level anyway — what matters is which font was set, where the words
// were placed, and whether the plate was measured from the real text or
// guessed. Pixel output is the browser's job, not ours.

import { describe, it, expect, vi } from 'vitest';
import { drawText, renderTextToBlob } from './text-image.js';
import { applyPreset, setText } from './text-clip.js';

/** A 2d context that remembers what it was asked to do. */
function recorder() {
  const calls = [];
  const ctx = {
    font: '', textAlign: '', textBaseline: '', fillStyle: '',
    shadowColor: '', shadowBlur: 0, shadowOffsetY: 0,
    measureText: (t) => ({ width: t.length * 10 }),
    fillText: (t, x, y) => calls.push({ op: 'fillText', t, x, y, font: ctx.font, fill: ctx.fillStyle, blur: ctx.shadowBlur }),
    fillRect: (x, y, w, h) => calls.push({ op: 'fillRect', x, y, w, h, fill: ctx.fillStyle }),
  };
  return { ctx, calls };
}

const clip = (text, style = {}) => ({ id: 'c1', kind: 'text', name: 'n', text: { text, ...style } });
const FRAME = { width: 1920, height: 1080 };

describe('drawing the words', () => {
  it('writes the text at the anchor from textLayout', () => {
    const { ctx, calls } = recorder();
    drawText(ctx, clip('HELLO', { x: 0.5, y: 0.5 }), FRAME);
    const t = calls.find((c) => c.op === 'fillText');
    expect(t.t).toBe('HELLO');
    expect(t.x).toBe(960);
    expect(t.y).toBe(540);
  });

  it('uses the SAME geometry the preview uses', () => {
    // The whole reason position is computed in one place. If this drifts, a
    // title sits somewhere different in the file than on screen, and the
    // customer finds out after the render.
    const { ctx, calls } = recorder();
    const c = clip('HI', { size: 0.1, x: 0.25, y: 0.75 });
    drawText(ctx, c, FRAME);
    const t = calls.find((c2) => c2.op === 'fillText');
    expect(t.x).toBe(480);          // 0.25 × 1920
    expect(t.y).toBe(810);          // 0.75 × 1080
    expect(ctx.font).toMatch(/108px/); // 0.1 × 1080
  });

  it('draws one fillText per line, and centres the BLOCK on the anchor', () => {
    // A two-line title must grow both ways, not drop off the bottom.
    const { ctx, calls } = recorder();
    drawText(ctx, clip('ONE\nTWO', { y: 0.5, size: 0.1 }), FRAME);
    const lines = calls.filter((c) => c.op === 'fillText');
    expect(lines.map((l) => l.t)).toEqual(['ONE', 'TWO']);
    const mid = (lines[0].y + lines[1].y) / 2;
    expect(mid).toBeCloseTo(540, 0);
  });

  it('does not auto-wrap — the preview shows the same line breaks', () => {
    const { ctx, calls } = recorder();
    drawText(ctx, clip('a very long single line that would wrap if we let it'), FRAME);
    expect(calls.filter((c) => c.op === 'fillText')).toHaveLength(1);
  });

  it('draws nothing at all for an empty clip', () => {
    const { ctx, calls } = recorder();
    drawText(ctx, { id: 'x', kind: 'text', name: '', text: { text: '' } }, FRAME);
    expect(calls).toHaveLength(0);
  });
});

describe('the caption plate', () => {
  it('is measured from the REAL text, not guessed', () => {
    // A guessed width clips the last letter of a long line, which is exactly
    // where it is most obvious.
    const { ctx, calls } = recorder();
    drawText(ctx, applyPreset(setText({ id: 'c', kind: 'text', name: 'n' }, 'CAPTION'), 'caption'), FRAME);
    const rect = calls.find((c) => c.op === 'fillRect');
    expect(rect).toBeTruthy();
    // 7 chars × 10 in the fake measurer, plus padding on both sides.
    expect(rect.w).toBeGreaterThan(70);
  });

  it('is drawn BEFORE the words, so it sits behind them', () => {
    const { ctx, calls } = recorder();
    drawText(ctx, applyPreset(setText({ id: 'c', kind: 'text', name: 'n' }, 'HI'), 'caption'), FRAME);
    expect(calls[0].op).toBe('fillRect');
    expect(calls[calls.length - 1].op).toBe('fillText');
  });

  it('is absent when no background was asked for', () => {
    const { ctx, calls } = recorder();
    drawText(ctx, clip('HI'), FRAME);
    expect(calls.some((c) => c.op === 'fillRect')).toBe(false);
  });
});

describe('the shadow', () => {
  it('is a real canvas shadow, not a second copy of the text', () => {
    // Drawing the words twice with an offset gives a hard black duplicate that
    // looks like a printing error at title sizes.
    const { ctx, calls } = recorder();
    drawText(ctx, clip('HI'), FRAME);
    expect(calls.filter((c) => c.op === 'fillText')).toHaveLength(1);
    expect(calls[0].blur).toBeGreaterThan(0);
  });

  it('is RESET afterwards, so one canvas can draw several clips', () => {
    const { ctx } = recorder();
    drawText(ctx, clip('HI'), FRAME);
    expect(ctx.shadowBlur).toBe(0);
    expect(ctx.shadowOffsetY).toBe(0);
  });
});

describe('making the image', () => {
  const fakeCanvas = (w, h) => ({
    width: w, height: h,
    getContext: () => recorder().ctx,
    toBlob: (cb) => cb(new Blob(['png'], { type: 'image/png' })),
  });

  it('returns a PNG the size of the OUTPUT frame', async () => {
    let made = null;
    const blob = await renderTextToBlob(clip('HI'), {
      width: 1080, height: 1920, makeCanvas: (w, h) => { made = { w, h }; return fakeCanvas(w, h); },
    });
    expect(made).toEqual({ w: 1080, h: 1920 });
    expect(blob).toBeInstanceOf(Blob);
  });

  it('returns NULL for an empty clip rather than a blank frame', async () => {
    // A transparent PNG per empty title is an input ffmpeg decodes and
    // overlays for no reason, on every frame it covers.
    const out = await renderTextToBlob({ id: 'x', kind: 'text', name: '', text: { text: '' } },
      { width: 100, height: 100, makeCanvas: fakeCanvas });
    expect(out).toBeNull();
  });

  it('never asks for a zero-sized canvas', async () => {
    let made = null;
    await renderTextToBlob(clip('HI'), {
      width: 0, height: 0, makeCanvas: (w, h) => { made = { w, h }; return fakeCanvas(w, h); },
    });
    expect(made.w).toBeGreaterThan(0);
    expect(made.h).toBeGreaterThan(0);
  });

  it('survives a context it cannot get', async () => {
    const noCtx = (w, h) => ({ width: w, height: h, getContext: () => null });
    await expect(renderTextToBlob(clip('HI'), { width: 10, height: 10, makeCanvas: noCtx }))
      .resolves.toBeNull();
  });
});
