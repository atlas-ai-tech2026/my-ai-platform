// ─── timeline-snap.test.js ───────────────────────────────────────────────────
// The failure snapping exists to prevent is invisible: a 30-millisecond gap
// between two clips that looks like they are touching, and renders as one black
// frame in the export.
//
// The two tests that matter most are "it works the same at every zoom" and
// "the right edge snaps too". Those are the two things implementations get
// wrong, and neither one throws when it is wrong — it just feels bad.

import { describe, it, expect } from 'vitest';
import { snapTargets, snapStart, snapEdge, SNAP_PX } from './timeline-snap.js';
import { createProject, createClip, addClip, __resetIds } from './timeline.js';

function project() {
  __resetIds();
  let p = createProject({});
  const v = p.tracks[0].id;
  const a = p.tracks[1].id;
  p = addClip(p, v, createClip({ kind: 'video', sourceId: 's', name: 'one', start: 0, in: 0, out: 5 }));
  p = addClip(p, v, createClip({ kind: 'video', sourceId: 's', name: 'two', start: 10, in: 0, out: 4 }));
  p = addClip(p, a, createClip({ kind: 'audio', sourceId: 'm', name: 'bed', start: 2, in: 0, out: 6 }));
  return p;
}

describe('what there is to snap to', () => {
  it('collects every clip edge, on every track', () => {
    // Snapping only within one track is why a music cue never lines up with
    // the picture it is supposed to hit.
    const t = snapTargets(project());
    expect(t).toEqual(expect.arrayContaining([0, 5, 10, 14, 2, 8]));
  });

  it('always includes zero', () => {
    __resetIds();
    expect(snapTargets(createProject({}))).toContain(0);
  });

  it('includes the playhead when there is one', () => {
    expect(snapTargets(project(), { playhead: 7.25 })).toContain(7.25);
  });

  it('EXCLUDES the clip being moved', () => {
    // Without this the clip snaps to its own edges and locks in place the
    // instant you start dragging.
    const p = project();
    const moving = p.tracks[0].clips[1];      // start 10, end 14
    const t = snapTargets(p, { excludeId: moving.id });
    expect(t).not.toContain(10);
    expect(t).not.toContain(14);
    expect(t, 'the other clips stopped being targets too').toContain(5);
  });
});

describe('the threshold is in PIXELS, not seconds', () => {
  // This is the whole design. A fixed time threshold is invisible zoomed out
  // and unusable zoomed in.
  const targets = [10];

  it('catches from the same distance on screen at every zoom', () => {
    for (const pps of [2, 20, 200]) {
      const offBy = (SNAP_PX - 1) / pps;      // just inside, in pixels
      const near = snapStart(10 + offBy, 3, targets, pps);
      expect(near.snappedTo, `did not catch at ${pps} px/s`).toBe(10);

      const tooFar = (SNAP_PX + 4) / pps;     // just outside, in pixels
      expect(snapStart(10 + tooFar, 3, targets, pps).snappedTo,
        `caught from too far at ${pps} px/s`).toBe(null);
    }
  });

  it('a gap that is invisible on screen is exactly what gets closed', () => {
    // Zoomed out at 2 px/s, 0.5s is one pixel. The eye cannot see it; the
    // export turns it into black.
    expect(snapStart(10.5, 3, targets, 2).start).toBe(10);
  });

  it('zoomed IN, that same 0.5s is a real distance and is left alone', () => {
    // At 200 px/s, 0.5s is 100 pixels away. Snapping there would drag the clip
    // somewhere the person did not point.
    expect(snapStart(10.5, 3, targets, 200).snappedTo).toBe(null);
  });
});

describe('both edges snap — the half most editors skip', () => {
  it('snaps the LEFT edge onto a target', () => {
    const r = snapStart(5.05, 3, [5], 100);
    expect(r).toMatchObject({ start: 5, snappedTo: 5, edge: 'start' });
  });

  it('snaps the RIGHT edge onto a target, offsetting the start', () => {
    // A 3s clip whose END should land on 10 must START at 7. Without this,
    // butting a clip up against the one AFTER it is impossible.
    const r = snapStart(6.95, 3, [10], 100);
    expect(r.snappedTo).toBe(10);
    expect(r.edge).toBe('end');
    expect(r.start, 'the start was not offset by the clip length').toBe(7);
  });

  it('picks the NEARER edge when both are in range', () => {
    // A 1s clip between targets 5 and 6: whichever edge is closer wins.
    const r = snapStart(5.02, 1, [5, 6], 100);
    expect(r.start).toBe(5);
  });
});

describe('refusing to snap somewhere impossible', () => {
  it('a clip nudged near zero DOES snap its left edge to zero', () => {
    // The common, correct case, and the reason zero is always a target.
    const r = snapStart(0.02, 5, [0], 100);
    expect(r).toMatchObject({ start: 0, snappedTo: 0, edge: 'start' });
  });

  it('never produces a negative start', () => {
    // Reachable for real: a clip sitting AT zero whose right edge lands near a
    // target shorter than the clip itself. Snapping the right edge would put
    // the start at -0.05. moveClip clamps that to 0 anyway — SILENTLY — so the
    // snap indicator would point at a snap that never happened.
    const r = snapStart(0, 5, [4.95], 100);
    expect(r.start).toBeGreaterThanOrEqual(0);
    expect(r.snappedTo, 'it reported a snap it could not perform').toBe(null);
  });

  it('does nothing when switched off', () => {
    const r = snapStart(10.01, 3, [10], 100, { enabled: false });
    expect(r).toMatchObject({ start: 10.01, snappedTo: null });
  });

  it('does nothing with no targets or no zoom', () => {
    expect(snapStart(10.01, 3, [], 100).snappedTo).toBe(null);
    expect(snapStart(10.01, 3, [10], 0).snappedTo).toBe(null);
  });
});

describe('trimming an edge', () => {
  it('snaps to the nearest target', () => {
    expect(snapEdge(5.03, [0, 5, 10], 100)).toMatchObject({ time: 5, snappedTo: 5 });
  });

  it('leaves it alone out of range', () => {
    expect(snapEdge(7.5, [0, 5, 10], 100).snappedTo).toBe(null);
  });

  it('obeys the switch', () => {
    expect(snapEdge(5.03, [5], 100, { enabled: false }).snappedTo).toBe(null);
  });
});
