// ─── edit-session.test.js ────────────────────────────────────────────────────
// Order and omission. Both fail silently, and both fail in ways that look like
// the product being bad rather than broken:
//
//   · resize before trim  → the customer waits five times longer for the same
//                           three seconds, and blames the editor for being slow
//   · text before resize  → "ELCOME TO VOXE" — a caption cropped by the very
//                           reshape that came after it
//   · a no-op kept in     → re-encoding a clip into an identical copy of itself
//
// Nothing throws in any of those cases, so this file is the only place they can
// be caught.

import { describe, it, expect } from 'vitest';

import {
  STAGE_ORDER, toClip, isEditable, clampTrim, buildPlan, describePlan, outputName,
} from './edit-session.js';

const clip = { id: 'c1', url: 'https://x/y.mp4', duration: 15, prompt: 'A yellow race car' };

describe('operation order', () => {
  it('always trims FIRST, whatever order the settings arrive in', () => {
    const plan = buildPlan(
      { text: 'Hello', ratio: '9:16', speed: 2, trim: { start: 2, end: 5 } },
      clip,
    );
    expect(plan[0].op).toBe('trim');
  });

  it('resizes BEFORE drawing text, so the caption is not cropped by the reshape', () => {
    const plan = buildPlan({ text: 'WELCOME TO VOXEL', ratio: '9:16' }, clip);
    const names = plan.map((o) => o.op);
    expect(names.indexOf('resize')).toBeLessThan(names.indexOf('addText'));
  });

  it('resizes BEFORE the watermark, so the corner it was placed in still exists', () => {
    const plan = buildPlan({ watermark: 'logo.png', ratio: '1:1' }, clip);
    const names = plan.map((o) => o.op);
    expect(names.indexOf('resize')).toBeLessThan(names.indexOf('overlay'));
  });

  it('produces the full sequence in the documented order', () => {
    const plan = buildPlan({
      trim: { start: 1, end: 6 }, speed: 1.5, ratio: '9:16',
      watermark: 'logo.png', text: 'Hi', audio: 'music.mp3',
    }, clip);
    expect(plan.map((o) => o.op))
      .toEqual(['trim', 'speed', 'resize', 'overlay', 'addText', 'mixAudio']);
  });

  it('lists every buildable operation in STAGE_ORDER', () => {
    // An operation missing from STAGE_ORDER sorts to index -1 and silently
    // jumps to the FRONT of the plan — ahead of the trim, which is the single
    // most expensive place to put anything.
    const plan = buildPlan({
      trim: { start: 1, end: 6 }, speed: 1.5, ratio: '9:16',
      watermark: 'l.png', text: 'Hi', audio: 'm.mp3', audioGain: -3,
    }, clip);
    for (const op of plan) expect(STAGE_ORDER, op.op).toContain(op.op);
  });
});

describe('nothing asked for, nothing done', () => {
  it('returns an empty plan for untouched settings', () => {
    expect(buildPlan({}, clip)).toEqual([]);
    expect(describePlan([]).empty).toBe(true);
    expect(describePlan([]).ready).toBe(false);
  });

  it('drops a trim that covers the whole clip', () => {
    // Re-encoding 15 seconds to produce the same 15 seconds.
    expect(buildPlan({ trim: { start: 0, end: 15 } }, clip)).toEqual([]);
  });

  it('drops 1× speed', () => {
    expect(buildPlan({ speed: 1 }, clip)).toEqual([]);
  });

  it('drops empty or whitespace-only text', () => {
    expect(buildPlan({ text: '   ' }, clip)).toEqual([]);
  });

  it('keeps a trim that actually shortens', () => {
    expect(buildPlan({ trim: { start: 0, end: 3 } }, clip))
      .toEqual([{ op: 'trim', start: 0, end: 3 }]);
  });
});

describe('clampTrim', () => {
  it('keeps the range inside the clip', () => {
    expect(clampTrim({ start: -5, end: 99, duration: 15 })).toEqual({ start: 0, end: 15 });
  });

  it('fixes a backwards range instead of handing ffmpeg an unreadable error', () => {
    const { start, end } = clampTrim({ start: 9, end: 2, duration: 15 });
    expect(end).toBeGreaterThan(start);
  });

  it('copes when the duration was never recorded', () => {
    // Older history rows have no duration. It must not become NaN, which would
    // reach ffmpeg as the literal string "NaN".
    const r = clampTrim({ start: 2, end: 6, duration: null });
    expect(r).toEqual({ start: 2, end: 6 });
    for (const v of Object.values(r)) expect(Number.isFinite(v)).toBe(true);
  });

  it('never returns a zero-length range', () => {
    const r = clampTrim({ start: 5, end: 5, duration: 15 });
    expect(r.end).toBeGreaterThan(r.start);
  });
});

describe('what can be edited', () => {
  it('accepts a finished generation', () => {
    expect(isEditable({ status: 'completed', result_url: 'https://x/y.mp4' })).toBe(true);
  });

  it('refuses pending and failed rows', () => {
    // They are visible in the grid but have no file behind them. Offering them
    // ends in "could not load" on a thumbnail the customer can see.
    expect(isEditable({ status: 'pending', result_url: null })).toBe(false);
    expect(isEditable({ status: 'failed', result_url: 'https://x/y.mp4' })).toBe(false);
  });

  it('refuses a completed row with no file', () => {
    expect(isEditable({ status: 'completed' })).toBe(false);
  });

  it('normalises whichever url field the row happens to use', () => {
    expect(toClip({ id: 1, result_url: 'a.mp4' }).url).toBe('a.mp4');
    expect(toClip({ id: 2, output_url: 'b.mp4' }).url).toBe('b.mp4');
    expect(toClip({ id: 3 })).toBeNull();
  });

  it('leaves a missing duration NULL rather than guessing', () => {
    // A guessed duration reaches ffmpeg as a real trim bound.
    expect(toClip({ id: 1, result_url: 'a.mp4' }).duration).toBeNull();
    expect(toClip({ id: 1, result_url: 'a.mp4', duration: '8' }).duration).toBe(8);
  });
});

describe('outputName', () => {
  it('says what the file is, months later, in a Downloads folder', () => {
    expect(outputName(clip, { ratio: '9:16' })).toBe('a-yellow-race-car-9x16.mp4');
  });

  it('never produces a nameless file', () => {
    expect(outputName({ prompt: '!!!' }, {})).toBe('voxel-edit.mp4');
    expect(outputName({}, {})).toBe('voxel-edit.mp4');
  });
});
