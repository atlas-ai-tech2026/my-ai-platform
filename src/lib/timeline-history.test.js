// ─── timeline-history.test.js ────────────────────────────────────────────────
// Undo is the feature that lets people experiment. Every bug in here makes them
// stop — and none of them looks like a bug, it looks like the editor being bad.
//
//   200 undo steps for one drag  → "undo doesn't work, it takes forever"
//   a dead step from a stray click → "undo did nothing"
//   redo surviving a new edit     → redo jumps to a state that never followed
//                                    from what is on screen
//
// So the assertions are about how it FEELS, not about the data structure.

import { describe, it, expect, beforeEach } from 'vitest';

import {
  createHistory, commit, undo, redo, canUndo, canRedo, endGesture, depth, MAX_STEPS,
} from './timeline-history.js';
import {
  createProject, createClip, addClip, moveClip, __resetIds,
} from './timeline.js';

beforeEach(__resetIds);

const seed = () => {
  const p = createProject();
  const track = p.tracks[0].id;
  const clip = createClip({ kind: 'video', sourceId: 's1', start: 0, in: 0, out: 10 });
  return { project: addClip(p, track, clip), clipId: clip.id };
};

describe('one drag is one undo', () => {
  it('coalesces two hundred mouse moves into a single step', () => {
    // THE TEST THIS FILE EXISTS FOR. Without coalescing the customer drags a
    // clip once and needs 200 presses of Cmd+Z to get back — which does not
    // read as a bug, it reads as the editor being unusable.
    const { project, clipId } = seed();
    let h = createHistory(project);

    for (let x = 1; x <= 200; x += 1) {
      h = commit(h, moveClip(h.present, clipId, x * 0.05), { coalesce: `move:${clipId}` });
    }

    expect(depth(h).undo, 'one gesture must be one step').toBe(1);
    expect(h.present.tracks[0].clips[0].start).toBe(10);

    h = undo(h);
    expect(h.present.tracks[0].clips[0].start, 'one undo returns to the start').toBe(0);
  });

  it('two separate drags are two steps', () => {
    const { project, clipId } = seed();
    let h = createHistory(project);

    h = commit(h, moveClip(h.present, clipId, 3), { coalesce: `move:${clipId}` });
    h = endGesture(h);                        // mouse released
    h = commit(h, moveClip(h.present, clipId, 7), { coalesce: `move:${clipId}` });

    expect(depth(h).undo).toBe(2);
    expect(undo(h).present.tracks[0].clips[0].start, 'back to the first drag').toBe(3);
  });

  it('different gestures never merge, even back to back', () => {
    const { project, clipId } = seed();
    let h = createHistory(project);
    h = commit(h, moveClip(h.present, clipId, 2), { coalesce: `move:${clipId}` });
    h = commit(h, moveClip(h.present, clipId, 4), { coalesce: `trim:${clipId}:start` });
    expect(depth(h).undo, 'a move and a trim are two different things').toBe(2);
  });
});

describe('the dead step', () => {
  it('a commit that changes nothing is ignored', () => {
    // Clicking a clip without moving it must not leave a step. Otherwise the
    // customer presses undo, watches nothing happen, and concludes it is broken.
    const { project } = seed();
    let h = createHistory(project);
    h = commit(h, project);
    expect(depth(h).undo).toBe(0);
    expect(canUndo(h)).toBe(false);
  });
});

describe('redo', () => {
  it('returns exactly what undo took away', () => {
    const { project, clipId } = seed();
    let h = createHistory(project);
    h = commit(h, moveClip(h.present, clipId, 5));

    h = undo(h);
    expect(h.present.tracks[0].clips[0].start).toBe(0);
    h = redo(h);
    expect(h.present.tracks[0].clips[0].start).toBe(5);
  });

  it('is DISCARDED by a new edit — it must never jump to an orphan state', () => {
    // Undo, then do something else. The old redo branch no longer follows from
    // what is on screen; offering it would take the customer somewhere that
    // never existed.
    const { project, clipId } = seed();
    let h = createHistory(project);
    h = commit(h, moveClip(h.present, clipId, 5));
    h = undo(h);
    expect(canRedo(h)).toBe(true);

    h = commit(h, moveClip(h.present, clipId, 9));
    expect(canRedo(h), 'redo survived a divergent edit').toBe(false);
  });

  it('undo closes the gesture, so the next drag cannot eat the redo branch', () => {
    // Subtle: if lastKey survived an undo, the next commit with the same key
    // would REPLACE the present instead of pushing — silently destroying the
    // step we just undid to.
    const { project, clipId } = seed();
    let h = createHistory(project);
    h = commit(h, moveClip(h.present, clipId, 5), { coalesce: `move:${clipId}` });
    h = undo(h);
    h = commit(h, moveClip(h.present, clipId, 2), { coalesce: `move:${clipId}` });
    expect(depth(h).undo, 'the undone step must still be reachable').toBe(1);
    expect(undo(h).present.tracks[0].clips[0].start).toBe(0);
  });
});

describe('bounds', () => {
  it('undo and redo at the ends do nothing rather than throw', () => {
    const { project } = seed();
    const h = createHistory(project);
    expect(undo(h)).toBe(h);
    expect(redo(h)).toBe(h);
  });

  it('caps the stack and drops the OLDEST, keeping the most recent work', () => {
    const { project, clipId } = seed();
    let h = createHistory(project);
    for (let i = 1; i <= MAX_STEPS + 20; i += 1) {
      h = commit(h, moveClip(h.present, clipId, i));
    }
    expect(depth(h).undo).toBe(MAX_STEPS);

    // Walk all the way back: the reachable floor is a state from partway
    // through, not the original — which is the point of a cap.
    let back = h;
    while (canUndo(back)) back = undo(back);
    expect(back.present.tracks[0].clips[0].start).toBeGreaterThan(0);
  });
});

describe('snapshots are cheap because nothing mutates', () => {
  it('unchanged tracks are shared by reference, not copied', () => {
    // This is why whole snapshots are affordable. If timeline.js ever starts
    // copying untouched tracks, a hundred steps of history starts costing a
    // hundred documents and this assertion is the early warning.
    const p = createProject();
    const track = p.tracks[0].id;
    const clip = createClip({ kind: 'video', sourceId: 's', out: 5 });
    const withClip = addClip(p, track, clip);
    const moved = moveClip(withClip, clip.id, 2);

    expect(moved.tracks[1], 'the untouched audio track was copied').toBe(withClip.tracks[1]);
  });

  it('an undone state is the exact object it was, not a rebuilt one', () => {
    const { project, clipId } = seed();
    let h = createHistory(project);
    h = commit(h, moveClip(h.present, clipId, 5));
    expect(undo(h).present).toBe(project);
  });
});
