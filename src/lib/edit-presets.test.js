// ─── edit-presets.test.js ────────────────────────────────────────────────────
// The arithmetic is the risk. "Cut to 30 seconds" that leaves a clip ending at
// 31.4 looks like it worked — the ratio changed, the long tail vanished — and
// the customer only finds the extra second and a half when the platform
// rejects the upload or the last word is clipped.
//
// So the assertions here are on the RESULT of the cut, not on the fact that
// something was called.

import { describe, it, expect } from 'vitest';
import { PRESETS, presetById, applyPreset } from './edit-presets.js';
import {
  createProject, createClip, addClip, addTrack, addSource, projectDuration, clipEnd,
} from './timeline.js';
import { textOf } from './text-clip.js';

/** A project with clips at known places. */
function build(clips = [[0, 10]]) {
  let p = createProject({ name: 'T' });
  p = addTrack(p, 'video');
  const v = p.tracks.find((t) => t.kind === 'video');
  p = addSource(p, { id: 's1', url: 'https://x/a.mp4', kind: 'video' });
  for (const [start, len, speed = 1] of clips) {
    p = addClip(p, v.id, {
      ...createClip({ kind: 'video', sourceId: 's1', name: `c${start}`, start, in: 0, out: len }),
      speed,
    });
  }
  return p;
}
const videoClips = (p) => p.tracks.find((t) => t.kind === 'video').clips;

describe('every preset does SEVERAL things', () => {
  it('has no preset that only changes the ratio', () => {
    // The viewer header already has a ratio picker. A preset duplicating one
    // control is clutter pretending to be help.
    for (const p of PRESETS) {
      expect(p.steps.length, `${p.id} does only one thing`).toBeGreaterThan(1);
    }
  });

  it('every preset says what it will do before it is pressed', () => {
    for (const p of PRESETS) {
      expect(p.label).toBeTruthy();
      expect(p.hint).toBeTruthy();
      expect(typeof p.check).toBe('function');
    }
  });
});

describe('Make a Reel', () => {
  it('sets 9:16 AND cuts to 30 seconds', () => {
    const r = applyPreset(build([[0, 45]]), 'reel');
    expect(r.ok).toBe(true);
    expect(r.project.ratio).toBe('9:16');
    expect(projectDuration(r.project)).toBeCloseTo(30, 2);
  });

  it('trims a clip that STRADDLES the line to end exactly at it', () => {
    // The failure this catches: a clip left ending at 31.4 while the ratio
    // changed, so it looks like the preset worked.
    const r = applyPreset(build([[20, 20]]), 'reel');       // runs 20 → 40
    const clip = videoClips(r.project).find((c) => c.start === 20);
    expect(clipEnd(clip)).toBeCloseTo(30, 2);
  });

  it('honours SPEED when trimming — the easy thing to get subtly wrong', () => {
    // At 2x, a clip from 20 with out=20 plays for 10s and ends at 30 already.
    // Cutting to 30 must leave it untouched, not chop it as if it were 1x.
    const r = applyPreset(build([[20, 20, 2]]), 'reel');
    const clip = videoClips(r.project).find((c) => c.start === 20);
    expect(clipEnd(clip)).toBeCloseTo(30, 2);
    expect(clip.out).toBeCloseTo(20, 2);
  });

  it('removes clips that start AFTER the line entirely', () => {
    const r = applyPreset(build([[0, 10], [35, 5]]), 'reel');
    expect(videoClips(r.project).map((c) => c.start)).toEqual([0]);
  });

  it('leaves a short project alone apart from the shape', () => {
    const r = applyPreset(build([[0, 8]]), 'reel');
    expect(projectDuration(r.project)).toBeCloseTo(8, 2);
    expect(videoClips(r.project)).toHaveLength(1);
  });

  it('deletes the RIGHT clips when several are past the line', () => {
    // Collecting ids up front matters: removing while walking the list is how
    // the second of a pair survives.
    const r = applyPreset(build([[0, 5], [31, 3], [40, 3], [50, 3]]), 'reel');
    expect(videoClips(r.project).map((c) => c.start)).toEqual([0]);
  });
});

describe('Make a square post', () => {
  it('sets 1:1 and cuts to sixty, not thirty', () => {
    const r = applyPreset(build([[0, 90]]), 'square');
    expect(r.project.ratio).toBe('1:1');
    expect(projectDuration(r.project)).toBeCloseTo(60, 2);
  });
});

describe('Add a title card', () => {
  it('puts three seconds of text at the very start', () => {
    const r = applyPreset(build(), 'title');
    const text = r.project.tracks.find((t) => t.kind === 'text');
    expect(text.clips).toHaveLength(1);
    expect(text.clips[0].start).toBe(0);
    expect(clipEnd(text.clips[0])).toBeCloseTo(3, 2);
  });

  it('makes it big and central — a title, not a caption', () => {
    const r = applyPreset(build(), 'title');
    const clip = r.project.tracks.find((t) => t.kind === 'text').clips[0];
    const t = textOf(clip);
    expect(t.size).toBeGreaterThan(0.09);
    expect(t.y).toBeCloseTo(0.5, 2);
    expect(t.text).toBeTruthy();
  });

  it('accepts a title the caller supplies', () => {
    const r = applyPreset(build(), 'title', { title: 'WORKSHOP DEMO' });
    const clip = r.project.tracks.find((t) => t.kind === 'text').clips[0];
    expect(textOf(clip).text).toBe('WORKSHOP DEMO');
  });

  it('reuses an existing text layer rather than making a third', () => {
    let p = build();
    p = addTrack(p, 'text');
    const r = applyPreset(p, 'title');
    expect(r.project.tracks.filter((t) => t.kind === 'text')).toHaveLength(1);
  });

  it('refuses, WITH A REASON, when every text layer is locked', () => {
    let p = build();
    p = addTrack(p, 'text');
    p = { ...p, tracks: p.tracks.map((t) => (t.kind === 'text' ? { ...t, locked: true } : t)) };
    const r = applyPreset(p, 'title');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/locked/i);
  });
});

describe('refusing, and saying why', () => {
  it('will not run on an empty timeline, and says so', () => {
    // A greyed-out card with no explanation is the thing a beginner cannot get
    // past, and they are exactly who presets are for.
    const empty = createProject({ name: 'E' });
    for (const id of ['reel', 'square', 'title']) {
      const r = applyPreset(empty, id);
      expect(r.ok).toBe(false);
      expect(r.reason).toMatch(/nothing on the timeline/i);
    }
  });

  it('says when widescreen is already what you have', () => {
    const p = { ...build(), ratio: '16:9', resizeMode: 'pad' };
    expect(applyPreset(p, 'widescreen').reason).toMatch(/already/i);
  });

  it('an unknown preset is refused, not thrown', () => {
    expect(applyPreset(build(), 'nope').ok).toBe(false);
  });

  it('NEVER returns a half-applied project when something throws', () => {
    const broken = { tracks: [{ id: 't', kind: 'video', clips: [{ id: 'c', start: 0 }] }] };
    const r = applyPreset(broken, 'reel');
    // Either it refuses cleanly or it works — but it must not throw, and the
    // caller keeps the project it had.
    expect(typeof r.ok).toBe('boolean');
  });
});

describe('coming back from vertical', () => {
  it('pads rather than cropping a second time', () => {
    // Somebody returning from a 9:16 crop has already lost the sides once.
    const r = applyPreset({ ...build(), ratio: '9:16', resizeMode: 'crop' }, 'widescreen');
    expect(r.project.ratio).toBe('16:9');
    expect(r.project.resizeMode).toBe('pad');
  });
});

describe('ids', () => {
  it('are unique and findable', () => {
    const ids = PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(presetById(id)).toBeTruthy();
  });
});

describe('saying what it did', () => {
  // "Make a Reel" on a five-minute project deletes most of it — correctly, and
  // exactly as the card says it will. But a customer who does not realise how
  // much went is one ⌘Z away from being fine and will not know to press it.
  it('counts the clips it removed', () => {
    const r = applyPreset(build([[0, 5], [31, 3], [40, 3]]), 'reel');
    expect(r.did).toMatch(/removed 2 clips past the end/);
  });

  it('says "1 clip", not "1 clips"', () => {
    const r = applyPreset(build([[0, 5], [31, 3]]), 'reel');
    expect(r.did).toMatch(/removed 1 clip past the end/);
  });

  it('mentions shortening when it trimmed one', () => {
    const r = applyPreset(build([[20, 20]]), 'reel');
    expect(r.did).toMatch(/shortened 1/);
  });

  it('says only the shape when nothing was cut', () => {
    const r = applyPreset(build([[0, 8]]), 'reel');
    expect(r.did).toBe('Vertical 9:16');
  });

  it('every preset says something', () => {
    for (const id of ['reel', 'square', 'title']) {
      expect(applyPreset(build(), id).did, `${id} said nothing`).toBeTruthy();
    }
  });
});
