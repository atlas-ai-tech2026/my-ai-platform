// ─── timeline-drop.test.js ───────────────────────────────────────────────────
// The one thing a drop must never do is put a clip where it cannot be seen.
//
// `activeAt` takes the FIRST clip covering a moment, and clips are sorted by
// start — so a clip dropped inside a longer one is added, saved, exported, and
// never plays a frame. It is visible on the timeline and absent from the video.
//
// Every assertion below is about the RESULT of a drop, not about a function
// having been called. The overlap test at the bottom is the one that matters:
// it walks the finished project and fails if any two clips on a track touch.

import { describe, it, expect } from 'vitest';
import { planDrop, fitsAt, nearestFreeStart, trackAccepts } from './timeline-drop.js';
import {
  createProject, createClip, addClip, addTrack, addSource, clipEnd, MAX_TRACKS_PER_KIND,
} from './timeline.js';

/** A project whose video track holds clips at known places.
 *
 *  It uses the track `createProject` ALREADY makes — Video 1 and Audio 1 exist
 *  from birth. Calling addTrack here first was my mistake: it left a spare
 *  empty Video 2 lying around, so "every layer is busy" was never true and two
 *  tests failed against a module that was behaving correctly. */
function build(spans = [], { kind = 'video' } = {}) {
  let p = createProject({ name: 'T' });
  let track = p.tracks.find((t) => t.kind === kind);
  if (!track) {                       // text has no default layer
    p = addTrack(p, kind);
    track = p.tracks.at(-1);
  }
  p = addSource(p, { id: 's1', url: 'https://x/a.mp4', kind: 'video' });
  for (const [start, len] of spans) {
    p = addClip(p, track.id, createClip({
      kind, sourceId: 's1', name: `c${start}`, start, in: 0, out: len,
    }));
  }
  return { project: p, trackId: track.id };
}
const trackOf = (p, id) => p.tracks.find((t) => t.id === id);

describe('fitsAt', () => {
  it('is true on an empty stretch', () => {
    const { project, trackId } = build([[0, 5]]);
    expect(fitsAt(trackOf(project, trackId), 10, 4)).toBe(true);
  });

  it('is false when it would sit INSIDE an existing clip', () => {
    // The invisible-clip case, exactly.
    const { project, trackId } = build([[0, 20]]);
    expect(fitsAt(trackOf(project, trackId), 5, 3)).toBe(false);
  });

  it('is false for a partial overlap at either end', () => {
    const { project, trackId } = build([[10, 10]]);
    const t = trackOf(project, trackId);
    expect(fitsAt(t, 8, 4)).toBe(false);    // runs into the front
    expect(fitsAt(t, 18, 4)).toBe(false);   // runs off the back
  });

  it('allows clips that TOUCH exactly — end to start is not an overlap', () => {
    const { project, trackId } = build([[0, 5]]);
    expect(fitsAt(trackOf(project, trackId), 5, 5)).toBe(true);
  });

  it('lets a clip ignore itself, so moving one is not a self-collision', () => {
    const { project, trackId } = build([[10, 5]]);
    const t = trackOf(project, trackId);
    const id = t.clips[0].id;
    expect(fitsAt(t, 11, 5)).toBe(false);
    expect(fitsAt(t, 11, 5, { ignoreId: id })).toBe(true);
  });

  it('refuses a negative start', () => {
    const { project, trackId } = build();
    expect(fitsAt(trackOf(project, trackId), -2, 3)).toBe(false);
  });
});

describe('nearestFreeStart', () => {
  it('finds the gap between two clips', () => {
    const { project, trackId } = build([[0, 5], [15, 5]]);
    expect(nearestFreeStart(trackOf(project, trackId), 7, 4)).toBeCloseTo(5, 2);
  });

  it('goes after the end when that is closer', () => {
    const { project, trackId } = build([[0, 30]]);
    expect(nearestFreeStart(trackOf(project, trackId), 28, 5)).toBeCloseTo(30, 2);
  });

  it('never returns a negative start', () => {
    const { project, trackId } = build([[0, 10]]);
    expect(nearestFreeStart(trackOf(project, trackId), 0, 4)).toBeGreaterThanOrEqual(0);
  });

  it('uses the start of the track when it is free', () => {
    const { project, trackId } = build([[20, 5]]);
    expect(nearestFreeStart(trackOf(project, trackId), 1, 4)).toBeCloseTo(0, 2);
  });
});

describe('a drop lands where you dropped it', () => {
  it('uses the exact moment when the spot is free', () => {
    const { project, trackId } = build([[0, 5]]);
    const p = planDrop(project, { trackId, kind: 'video', length: 4, at: 12 });
    expect(p).toMatchObject({ ok: true, trackId, start: 12 });
    expect(p.note, 'it went where it was dropped, so it should say nothing').toBeUndefined();
  });

  it('clamps a drop before zero to the start', () => {
    const { project, trackId } = build();
    expect(planDrop(project, { trackId, length: 4, at: -30 }).start).toBe(0);
  });

  it('drops exactly against the end of another clip', () => {
    const { project, trackId } = build([[0, 5]]);
    expect(planDrop(project, { trackId, length: 3, at: 5 })).toMatchObject({ start: 5, trackId });
  });
});

describe('a drop NEVER lands on top of something', () => {
  it('moves to another layer rather than overlapping, and says so', () => {
    let { project, trackId } = build([[0, 20]]);
    project = addTrack(project, 'video');
    const p = planDrop(project, { trackId, kind: 'video', length: 4, at: 5 });
    expect(p.ok).toBe(true);
    expect(p.trackId, 'it stayed on the busy layer').not.toBe(trackId);
    expect(p.start, 'the MOMENT is what was aimed at — keep it').toBe(5);
    expect(p.note).toMatch(/Video 2/);
  });

  it('creates a layer when every existing one is busy at that moment', () => {
    const { project, trackId } = build([[0, 20]]);
    const p = planDrop(project, { trackId, kind: 'video', length: 4, at: 5 });
    expect(p).toMatchObject({ ok: true, trackId: null, newTrack: 'video', start: 5 });
    expect(p.note).toMatch(/new layer/i);
  });

  it('gives up the MOMENT only when it has run out of layers', () => {
    // Three video layers is the limit, all covering 0–20.
    let { project, trackId } = build([[0, 20]]);
    for (let i = 1; i < MAX_TRACKS_PER_KIND; i += 1) {
      project = addTrack(project, 'video');
      const t = project.tracks.filter((x) => x.kind === 'video').at(-1);
      project = addClip(project, t.id, createClip({
        kind: 'video', sourceId: 's1', name: `f${i}`, start: 0, in: 0, out: 20,
      }));
    }
    const p = planDrop(project, { trackId, kind: 'video', length: 4, at: 5 });
    expect(p.ok).toBe(true);
    expect(p.trackId).toBe(trackId);
    expect(p.start, 'it must go after everything, not on top of it').toBeGreaterThanOrEqual(20);
    expect(p.note, 'moving somebody 15 seconds silently is unacceptable').toMatch(/Moved to 0:20/);
  });

  it('THE INVARIANT: no drop, anywhere, produces two clips that overlap', () => {
    // Every start from 0 to 40 in half seconds, against a track with gaps.
    let { project, trackId } = build([[0, 6], [10, 6], [30, 6]]);
    project = addTrack(project, 'video');

    for (let at = 0; at <= 40; at += 0.5) {
      const plan = planDrop(project, { trackId, kind: 'video', length: 3, at });
      expect(plan.ok, `refused at ${at}`).toBe(true);

      let next = project;
      let landing = plan.trackId;
      if (plan.newTrack) {
        next = addTrack(next, plan.newTrack);
        landing = next.tracks.at(-1).id;
      }
      next = addClip(next, landing, createClip({
        kind: 'video', sourceId: 's1', name: 'dropped', start: plan.start, in: 0, out: 3,
      }));

      for (const track of next.tracks) {
        const sorted = [...track.clips].sort((a, b) => a.start - b.start);
        for (let i = 1; i < sorted.length; i += 1) {
          expect(
            sorted[i].start,
            `dropping at ${at} overlapped "${sorted[i - 1].name}" on ${track.name} — it would never play`,
          ).toBeGreaterThanOrEqual(clipEnd(sorted[i - 1]) - 0.001);
        }
      }
    }
  });
});

describe('locked layers', () => {
  it('goes elsewhere rather than onto a locked layer', () => {
    let { project, trackId } = build();
    project = addTrack(project, 'video');
    project = {
      ...project,
      tracks: project.tracks.map((t) => (t.id === trackId ? { ...t, locked: true } : t)),
    };
    const p = planDrop(project, { trackId, kind: 'video', length: 4, at: 3 });
    expect(p.ok).toBe(true);
    expect(p.trackId).not.toBe(trackId);
    expect(p.note).toMatch(/locked/i);
  });
});

describe('the wrong kind of layer', () => {
  it('refuses audio onto a video layer, by name', () => {
    const { project, trackId } = build();
    const p = planDrop(project, { trackId, kind: 'audio', length: 4, at: 0 });
    expect(p.ok).toBe(false);
    expect(p.reason).toMatch(/Video 1/);
  });

  it('allows an image onto a video layer — the same rule addClip uses', () => {
    const { project, trackId } = build();
    expect(trackAccepts(trackOf(project, trackId), 'image')).toBe(true);
    expect(planDrop(project, { trackId, kind: 'image', length: 4, at: 2 }).ok).toBe(true);
  });
});

describe('refusing, and saying why', () => {
  it('refuses a clip with no length instead of adding a zero-length one', () => {
    const { project, trackId } = build();
    const p = planDrop(project, { trackId, length: 0, at: 0 });
    expect(p.ok).toBe(false);
    expect(p.reason).toMatch(/no length/i);
  });

  it('refuses when the length could not be measured at all', () => {
    const { project, trackId } = build();
    expect(planDrop(project, { trackId, length: null, at: 0 }).ok).toBe(false);
  });

  it('does not throw on a project that is not one', () => {
    expect(planDrop(null, { trackId: 'x', length: 3, at: 0 }).ok).toBe(false);
    expect(planDrop({}, { trackId: 'x', length: 3, at: 0 }).ok).toBe(false);
  });

  it('handles a layer that has been deleted mid-drag', () => {
    const { project } = build([[0, 5]]);
    // No track matches, so there is nowhere aimed at — it should still find a
    // home rather than throw, because a drag survives a delete.
    const p = planDrop(project, { trackId: 'gone', kind: 'video', length: 4, at: 8 });
    expect(p.ok).toBe(true);
  });
});
