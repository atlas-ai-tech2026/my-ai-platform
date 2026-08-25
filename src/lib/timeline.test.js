// ─── timeline.test.js ────────────────────────────────────────────────────────
// Every bug this file guards against is one you cannot see while editing.
//
// A split that leaves a rounding gap looks perfect on the timeline and puts a
// one-frame flash between every cut on export. A left-edge trim that forgets to
// move `start` makes the clip crawl backwards under the cursor. A source-time
// calculation that ignores speed drifts picture from sound only after somebody
// changes speed. None of them throw, and none of them are visible until the
// customer has already published.

import { describe, it, expect, beforeEach } from 'vitest';

import {
  createProject, createClip, addClip, removeClip, moveClip, trimClip, splitClip,
  updateClip, addTrack, locateClip, activeAt, sourceTimeAt,
  clipDuration, clipEnd, projectDuration, MIN_CLIP, TRACK_KINDS, __resetIds,
  trackGaps, closeGap, addSource, replaceClipSource, setProjectRatio,
  removeTrack, whyKeepTrack, renameTrack, moveTrack, canMoveTrack,
  MAX_TRACKS_PER_KIND, countKind, whyNoMoreTracks,
  setTrackHeight, clearTrackHeight, MIN_TRACK_H, MAX_TRACK_H,
  migrateAudio,
  AUDIO_SCHEMA,
} from './timeline.js';

beforeEach(__resetIds);

const seed = () => {
  const p = createProject();
  const videoTrack = p.tracks[0].id;
  const clip = createClip({ kind: 'video', sourceId: 's1', start: 0, in: 0, out: 10 });
  return { project: addClip(p, videoTrack, clip), videoTrack, clipId: clip.id };
};

describe('a new project is somewhere to put something', () => {
  it('starts with a video track and an audio track, not empty', () => {
    // An empty project with no tracks renders as a void with nothing to drop
    // onto. The first moment in the editor should be a place, not a blank.
    const p = createProject();
    expect(p.tracks.map((t) => t.kind)).toEqual(['video', 'audio']);
  });

  it('has no stored duration', () => {
    // A stored duration is a second source of truth. It goes stale the moment
    // the last clip is deleted, and then export renders black after the end.
    expect(createProject()).not.toHaveProperty('duration');
    expect(projectDuration(createProject())).toBe(0);
  });
});

describe('split — the one-frame flash', () => {
  it('leaves NO gap and NO overlap: left.out === right.in', () => {
    const { project, clipId } = seed();
    const after = splitClip(project, clipId, 4);
    const [left, right] = after.tracks[0].clips;

    expect(left.out).toBe(right.in);          // exactly, not approximately
    expect(clipEnd(left)).toBe(right.start);  // and no gap on the timeline
  });

  it('the two halves add up to the original, to the millisecond', () => {
    const { project, clipId } = seed();
    const before = projectDuration(project);
    const after = splitClip(project, clipId, 4);
    expect(projectDuration(after)).toBe(before);
    const [l, r] = after.tracks[0].clips;
    expect(round3(clipDuration(l) + clipDuration(r))).toBe(before);
  });

  it('splits correctly on a clip that is NOT at speed 1', () => {
    // At 2x, four seconds of timeline is eight seconds of source. Using the
    // timeline offset directly as a source offset halves the cut point and
    // nobody notices until the export is wrong.
    const { project, clipId } = seed();
    const fast = updateClip(project, clipId, { speed: 2 });
    const after = splitClip(fast, clipId, 2);          // 2s in on the timeline
    const [left] = after.tracks[0].clips;
    expect(left.out, 'the cut must be 4s into the SOURCE, not 2s').toBe(4);
  });

  it('refuses a split that would make a sliver', () => {
    const { project, clipId } = seed();
    expect(splitClip(project, clipId, 0.01).tracks[0].clips).toHaveLength(1);
    expect(splitClip(project, clipId, 9.999).tracks[0].clips).toHaveLength(1);
  });

  it('does not carry a fade into the middle of what was one shot', () => {
    const { project, clipId } = seed();
    const faded = updateClip(project, clipId, { fadeIn: 1, fadeOut: 1 });
    const [left, right] = splitClip(faded, clipId, 5).tracks[0].clips;
    expect(left.fadeIn, 'the opening fade stays on the opening').toBe(1);
    expect(right.fadeIn, 'a fade must not appear mid-shot').toBe(0);
    expect(right.fadeOut, 'the closing fade stays on the closing').toBe(1);
  });
});

describe('trim — the clip that crawls backwards', () => {
  it('dragging the LEFT edge right moves start by the same amount', () => {
    // If `start` does not move with `in`, the clip appears to slide LEFT while
    // the customer drags RIGHT. Editors that get this wrong feel haunted.
    const { project, clipId } = seed();
    const after = trimClip(project, clipId, 'start', 2);
    const [c] = after.tracks[0].clips;
    expect(c.in).toBe(2);
    expect(c.start, 'the visible left edge must stay under the cursor').toBe(2);
    expect(clipDuration(c)).toBe(8);
  });

  it('dragging the RIGHT edge changes only the length', () => {
    const { project, clipId } = seed();
    const [c] = trimClip(project, clipId, 'end', -3).tracks[0].clips;
    expect(c.start).toBe(0);
    expect(c.out).toBe(7);
  });

  it('never lets a clip invert or vanish', () => {
    const { project, clipId } = seed();
    const [a] = trimClip(project, clipId, 'start', 999).tracks[0].clips;
    expect(a.in).toBeLessThan(a.out);
    expect(clipDuration(a)).toBeGreaterThanOrEqual(MIN_CLIP - 1e-6);

    const [b] = trimClip(project, clipId, 'end', -999).tracks[0].clips;
    expect(b.out).toBeGreaterThan(b.in);
  });

  it('never trims a clip to start before zero', () => {
    const { project, clipId } = seed();
    const [c] = trimClip(project, clipId, 'start', -5).tracks[0].clips;
    expect(c.start).toBeGreaterThanOrEqual(0);
    expect(c.in).toBeGreaterThanOrEqual(0);
  });
});

describe('speed — where picture drifts from sound', () => {
  it('halves the timeline length at 2x', () => {
    const { project, clipId } = seed();
    const [c] = updateClip(project, clipId, { speed: 2 }).tracks[0].clips;
    expect(clipDuration(c)).toBe(5);
  });

  it('sourceTimeAt scales with speed', () => {
    // One second on the timeline is two seconds of source at 2x. Off by this
    // factor and the drift only shows after somebody changes speed.
    const clip = createClip({ kind: 'video', sourceId: 's', start: 10, in: 4, out: 20 });
    expect(sourceTimeAt({ ...clip, speed: 1 }, 12)).toBe(6);
    expect(sourceTimeAt({ ...clip, speed: 2 }, 12)).toBe(8);
    expect(sourceTimeAt({ ...clip, speed: 0.5 }, 12)).toBe(5);
  });
});

describe('the document is never mutated', () => {
  it('every operation returns a new project and leaves the old one alone', () => {
    // Undo/redo snapshots this object. One in-place mutation and every stored
    // snapshot silently becomes the present — undo stops working, and the bug
    // looks like "undo is broken" rather than "move mutated its input".
    const { project, clipId, videoTrack } = seed();
    const snapshot = JSON.stringify(project);

    moveClip(project, clipId, 5);
    trimClip(project, clipId, 'end', -2);
    splitClip(project, clipId, 5);
    updateClip(project, clipId, { volume: -6 });
    removeClip(project, clipId);
    addTrack(project, 'text');
    addClip(project, videoTrack, createClip({ kind: 'video', sourceId: 'x', out: 3 }));

    expect(JSON.stringify(project), 'an operation mutated its input').toBe(snapshot);
  });
});

describe('locked tracks', () => {
  it('ignore every edit', () => {
    const { project, clipId, videoTrack } = seed();
    const locked = { ...project, tracks: project.tracks.map((t) => ({ ...t, locked: true })) };
    expect(moveClip(locked, clipId, 9).tracks[0].clips[0].start).toBe(0);
    expect(removeClip(locked, clipId).tracks[0].clips).toHaveLength(1);
    expect(splitClip(locked, clipId, 5).tracks[0].clips).toHaveLength(1);
    expect(addClip(locked, videoTrack, createClip({ kind: 'video', sourceId: 'y', out: 2 }))
      .tracks[0].clips).toHaveLength(1);
  });
});

describe('what plays at a moment', () => {
  it('takes the TOPMOST picture but every audible sound', () => {
    // Track order is z-order for picture. Audio layers; pictures do not.
    let p = createProject();
    const v1 = p.tracks[0].id;
    const a1 = p.tracks[1].id;
    p = addTrack(p, 'video');
    // BY NAME, not by index: a new layer is inserted beside its own kind now,
    // so tracks[2] is the audio track and this quietly built an invalid project.
    const v2 = p.tracks.find((t) => t.name === 'Video 2').id;

    p = addClip(p, v1, createClip({ kind: 'video', sourceId: 'top', start: 0, out: 10 }));
    p = addClip(p, v2, createClip({ kind: 'video', sourceId: 'under', start: 0, out: 10 }));
    p = addClip(p, a1, createClip({ kind: 'audio', sourceId: 'music', start: 0, out: 10 }));

    const at = activeAt(p, 5);
    expect(at.picture.clip.sourceId, 'the first track wins the picture').toBe('top');
    expect(at.audio.map((x) => x.clip.sourceId).sort()).toEqual(['music', 'top', 'under']);
  });

  it('respects hidden and muted', () => {
    let p = createProject();
    p = addClip(p, p.tracks[0].id, createClip({ kind: 'video', sourceId: 'v', out: 10 }));
    const dark = { ...p, tracks: p.tracks.map((t) => ({ ...t, hidden: true, muted: true })) };
    const at = activeAt(dark, 5);
    expect(at.picture).toBeNull();
    expect(at.audio).toHaveLength(0);
  });

  it('a moment past the end has nothing in it', () => {
    const { project } = seed();
    expect(activeAt(project, 99).picture).toBeNull();
  });
});

describe('guards at the door', () => {
  it('refuses a clip with no length', () => {
    expect(() => createClip({ kind: 'video', sourceId: 's', in: 5, out: 5 })).toThrow(/out point/i);
    expect(() => createClip({ kind: 'video', sourceId: 's', in: 5, out: 2 })).toThrow(/out point/i);
  });

  it('refuses an unknown kind', () => {
    expect(() => createClip({ kind: 'hologram', sourceId: 's', out: 1 })).toThrow(/Unknown clip kind/);
    expect(() => addTrack(createProject(), 'hologram')).toThrow(/Unknown track kind/);
  });

  it('refuses audio on a video track', () => {
    const p = createProject();
    expect(() => addClip(p, p.tracks[0].id, createClip({ kind: 'audio', sourceId: 's', out: 5 })))
      .toThrow(/cannot go on a video track/);
  });

  it('allows an image on a video track — that is a real thing to want', () => {
    const p = createProject();
    expect(() => addClip(p, p.tracks[0].id, createClip({ kind: 'image', sourceId: 's', out: 5 })))
      .not.toThrow();
  });

  it('covers every track kind the schema declares', () => {
    // A kind added to TRACK_KINDS and forgotten everywhere else would pass a
    // test suite that only names the ones that already work.
    for (const kind of TRACK_KINDS) {
      expect(() => addTrack(createProject(), kind)).not.toThrow();
    }
  });
});

describe('locateClip', () => {
  it('finds the clip and the track holding it', () => {
    const { project, clipId, videoTrack } = seed();
    const found = locateClip(project, clipId);
    expect(found.track.id).toBe(videoTrack);
    expect(found.clip.id).toBe(clipId);
    expect(locateClip(project, 'nope')).toBeNull();
  });
});

const round3 = (n) => Math.round(n * 1000) / 1000;

describe('gaps — the black silence nobody is told about', () => {
  it('finds the hole between two clips', () => {
    // The owner's exact shape: a clip ending at 12, the next starting at 60.
    // The total said 1:24 and forty-eight seconds of it was nothing.
    let p = createProject();
    const v = p.tracks[0].id;
    p = addClip(p, v, createClip({ kind: 'video', sourceId: 'a', start: 0, out: 12 }));
    p = addClip(p, v, createClip({ kind: 'video', sourceId: 'b', start: 60, in: 0, out: 24 }));

    const [gap] = trackGaps(p.tracks[0]);
    expect(gap).toMatchObject({ start: 12, end: 60, duration: 48 });
  });

  it('counts a LEADING gap — black before the first clip is still black', () => {
    let p = createProject();
    p = addClip(p, p.tracks[0].id, createClip({ kind: 'video', sourceId: 'a', start: 3, out: 5 }));
    expect(trackGaps(p.tracks[0])[0]).toMatchObject({ start: 0, end: 3 });
  });

  it('does NOT count time after the last clip', () => {
    // The project simply ends there. Reporting it as a gap would mean every
    // project always has one.
    let p = createProject();
    p = addClip(p, p.tracks[0].id, createClip({ kind: 'video', sourceId: 'a', start: 0, out: 5 }));
    expect(trackGaps(p.tracks[0])).toHaveLength(0);
  });

  it('does not invent a gap where clips OVERLAP', () => {
    // Tracking the previous clip's end rather than the furthest end so far
    // reports a hole that is actually covered by the clip on top of it.
    let p = createProject();
    const v = p.tracks[0].id;
    p = addClip(p, v, createClip({ kind: 'video', sourceId: 'long', start: 0, out: 30 }));
    p = addClip(p, v, createClip({ kind: 'video', sourceId: 'short', start: 5, in: 0, out: 5 }));
    expect(trackGaps(p.tracks[0])).toHaveLength(0);
  });

  it('closes a gap by pulling everything after it left, exactly', () => {
    let p = createProject();
    const v = p.tracks[0].id;
    p = addClip(p, v, createClip({ kind: 'video', sourceId: 'a', start: 0, out: 12 }));
    p = addClip(p, v, createClip({ kind: 'video', sourceId: 'b', start: 60, in: 0, out: 24 }));

    const closed = closeGap(p, v, 12);
    expect(closed.tracks[0].clips[1].start, 'b should meet a exactly').toBe(12);
    expect(trackGaps(closed.tracks[0]), 'no gap should remain').toHaveLength(0);
  });

  it('closes ONE track and leaves the others where they are', () => {
    // Rippling every track would silently pull the music out of sync with the
    // picture still on screen — a destructive edit disguised as tidying up.
    let p = createProject();
    const v = p.tracks[0].id;
    const a = p.tracks[1].id;
    p = addClip(p, v, createClip({ kind: 'video', sourceId: 'a', start: 0, out: 10 }));
    p = addClip(p, v, createClip({ kind: 'video', sourceId: 'b', start: 40, in: 0, out: 10 }));
    p = addClip(p, a, createClip({ kind: 'audio', sourceId: 'music', start: 40, in: 0, out: 10 }));

    const closed = closeGap(p, v, 10);
    expect(closed.tracks[0].clips[1].start).toBe(10);
    expect(closed.tracks[1].clips[0].start, 'the music must not move').toBe(40);
  });

  it('refuses to close a gap on a locked track', () => {
    let p = createProject();
    const v = p.tracks[0].id;
    p = addClip(p, v, createClip({ kind: 'video', sourceId: 'a', start: 0, out: 5 }));
    p = addClip(p, v, createClip({ kind: 'video', sourceId: 'b', start: 20, in: 0, out: 5 }));
    const locked = { ...p, tracks: p.tracks.map((t) => ({ ...t, locked: true })) };
    expect(closeGap(locked, v, 5)).toBe(locked);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('replaceClipSource — remaking one shot in place', () => {
  const build = () => {
    __resetIds();
    let p = createProject({ name: 'R' });
    p = addSource(p, { id: 'old', url: 'old.mp4', prompt: 'a car at noon', model_id: 'm1' });
    const v = p.tracks[0].id;
    p = addClip(p, v, createClip({ kind: 'video', sourceId: 'old', name: 'shot', start: 3, in: 1, out: 6 }));
    return { p, clipId: p.tracks[0].clips[0].id };
  };
  const fresh = { id: 'new', url: 'new.mp4', prompt: 'a car at night', model_id: 'm1' };

  it('keeps the clip where it is and only changes the material under it', () => {
    const { p, clipId } = build();
    const { project } = replaceClipSource(p, clipId, fresh, 10);
    const c = project.tracks[0].clips[0];
    expect(c.id, 'the clip was replaced rather than repointed').toBe(clipId);
    expect(c.start).toBe(3);
    expect(c.sourceId).toBe('new');
    expect(c.in).toBe(1);
    expect(c.out).toBe(6);
  });

  it('KEEPS the old source, because other clips may still use it', () => {
    // Splitting a clip six ways leaves six clips on one source. Overwriting it
    // would silently remake five shots nobody touched — and undo could not
    // bring the original back, because it would be gone from the document.
    const { p, clipId } = build();
    const { project } = replaceClipSource(p, clipId, fresh, 10);
    expect(project.sources.old, 'the original source was destroyed').toBeTruthy();
    expect(project.sources.new).toBeTruthy();
  });

  it('a split clip keeps its sibling on the ORIGINAL shot', () => {
    const { p, clipId } = build();
    const split = splitClip(p, clipId, 5);
    const [first, second] = split.tracks[0].clips;
    const { project } = replaceClipSource(split, first.id, fresh, 10);
    expect(project.tracks[0].clips[0].sourceId).toBe('new');
    expect(project.tracks[0].clips[1].sourceId, 'remaking one half remade both').toBe('old');
    expect(second.sourceId).toBe('old');
  });

  it('CLAMPS the window when the remade shot is shorter, and says so', () => {
    // A model asked for 5s may return 4.8. Carried across untouched, in/out
    // point past the end of the new file — ffmpeg accepts the range and the
    // export comes back with black on the end.
    const { p, clipId } = build();          // in 1 → out 6, so 5s of material
    const { project, note } = replaceClipSource(p, clipId, fresh, 4);
    const c = project.tracks[0].clips[0];
    expect(c.out).toBeLessThanOrEqual(4);
    expect(note, 'the edit changed length and nobody was told').toBeTruthy();
    expect(note).toMatch(/4\.0s/);
  });

  it('says NOTHING when the length is unchanged', () => {
    const { p, clipId } = build();
    expect(replaceClipSource(p, clipId, fresh, 10).note).toBe(null);
  });

  it('recovers when even the IN point falls off the end', () => {
    // A clip trimmed to start at 1s, pointed at a 0.5s remake, has nothing
    // left. It must still be a valid clip rather than an inverted range.
    const { p, clipId } = build();
    const { project } = replaceClipSource(p, clipId, fresh, 0.5);
    const c = project.tracks[0].clips[0];
    expect(c.out).toBeGreaterThan(c.in);
    expect(c.in).toBeGreaterThanOrEqual(0);
    expect(c.out).toBeLessThanOrEqual(0.5);
  });

  it('leaves the window alone when the new length is unknown', () => {
    const { p, clipId } = build();
    const { project, note } = replaceClipSource(p, clipId, fresh, null);
    expect(project.tracks[0].clips[0].out).toBe(6);
    expect(note).toBe(null);
  });

  it('an unknown clip changes nothing', () => {
    const { p } = build();
    expect(replaceClipSource(p, 'nope', fresh, 5).project).toBe(p);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('setProjectRatio', () => {
  it('changes the shape', () => {
    __resetIds();
    const p = createProject({ ratio: '16:9' });
    expect(setProjectRatio(p, '9:16').ratio).toBe('9:16');
  });

  it('changes crop/pad independently of the shape', () => {
    __resetIds();
    const p = setProjectRatio(createProject({}), null, 'pad');
    expect(p.resizeMode).toBe('pad');
    expect(p.ratio, 'setting the mode moved the shape').toBe('16:9');
  });

  it('returns the SAME object when nothing changed', () => {
    // Or clicking the ratio you already have records an undo step for nothing,
    // and the undo stack fills with clicks that did not do anything.
    __resetIds();
    const p = createProject({ ratio: '16:9' });
    expect(setProjectRatio(p, '16:9')).toBe(p);
  });

  it('leaves the clips completely alone', () => {
    // Reshaping happens at EXPORT. Changing the ratio must never rewrite the
    // edit — you can switch to Reels and back without losing your cuts.
    __resetIds();
    let p = createProject({});
    p = addClip(p, p.tracks[0].id, createClip({ kind: 'video', sourceId: 's', start: 0, in: 0, out: 5 }));
    const after = setProjectRatio(p, '9:16');
    expect(after.tracks).toBe(p.tracks);
  });
});

// ─── REMOVING A TRACK ────────────────────────────────────────────────────────
// Added 2026-08-23. There was no way to remove a layer at all — `addTrack`
// existed and was called from exactly one place (building the demo), and
// `removeTrack` did not exist. The owner found both gaps by looking at the
// screen and asking where the button was.

describe('removing a track', () => {
  const twoTracks = () => { __resetIds(); return createProject({ name: 'T' }); };

  it('removes the track and everything on it', () => {
    let p = twoTracks();
    p = addTrack(p, 'text');
    const textId = p.tracks[2].id;
    const after = removeTrack(p, textId);

    expect(after.tracks).toHaveLength(2);
    expect(after.tracks.find((t) => t.id === textId)).toBeUndefined();
  });

  it('REFUSES a locked track — a lock that only stops trimming is not a lock', () => {
    let p = twoTracks();
    p = addTrack(p, 'text');
    const id = p.tracks[2].id;
    p = { ...p, tracks: p.tracks.map((t) => (t.id === id ? { ...t, locked: true } : t)) };

    expect(removeTrack(p, id).tracks).toHaveLength(3);
    expect(whyKeepTrack(p, id)).toMatch(/locked/i);
  });

  it('REFUSES the last track — a project with none is a dead end', () => {
    // No tracks means the library has nothing to add to and there is no way
    // back, reachable in one click.
    let p = twoTracks();
    p = removeTrack(p, p.tracks[1].id);
    expect(p.tracks).toHaveLength(1);

    const last = p.tracks[0].id;
    expect(removeTrack(p, last).tracks, 'it deleted the last track').toHaveLength(1);
    expect(whyKeepTrack(p, last)).toMatch(/last track/i);
  });

  it('leaves the project alone when the track is not there', () => {
    const p = twoTracks();
    expect(removeTrack(p, 'nope')).toBe(p);
  });

  it('whyKeepTrack says null when it CAN go', () => {
    let p = twoTracks();
    p = addTrack(p, 'audio');
    expect(whyKeepTrack(p, p.tracks[2].id)).toBe(null);
  });

  it('does not disturb the other tracks or their clips', () => {
    let p = twoTracks();
    p = addSource(p, { id: 's1', url: 'https://x/a.mp4' });
    p = addClip(p, p.tracks[0].id, createClip({ kind: 'video', sourceId: 's1', start: 0, in: 0, out: 5 }));
    p = addTrack(p, 'text');

    const after = removeTrack(p, p.tracks[2].id);
    expect(after.tracks[0].clips).toHaveLength(1);
    expect(after.tracks[1].kind).toBe('audio');
  });
});

// ─── RENAMING AND REORDERING LAYERS ──────────────────────────────────────────
// Both asked for by the owner on 2026-08-23, looking at four tracks called
// "Video 1", "Audio 1", "Text 1", "Video 2" and wanting to say what they are
// and which one sits on top.

describe('renaming a layer', () => {
  const p0 = () => { __resetIds(); return createProject({ name: 'T' }); };

  it('renames it', () => {
    const p = p0();
    const after = renameTrack(p, p.tracks[0].id, 'B-roll');
    expect(after.tracks[0].name).toBe('B-roll');
  });

  it('an EMPTY name is a mistake, not a rename', () => {
    // A header with no label at all is worse than the default "Video 1".
    const p = p0();
    expect(renameTrack(p, p.tracks[0].id, '   ').tracks[0].name).toBe('Video 1');
    expect(renameTrack(p, p.tracks[0].id, '')).toBe(p);
  });

  it('trims and caps the length so the column cannot be blown out', () => {
    const p = p0();
    expect(renameTrack(p, p.tracks[0].id, '  Hero shot  ').tracks[0].name).toBe('Hero shot');
    expect(renameTrack(p, p.tracks[0].id, 'x'.repeat(200)).tracks[0].name).toHaveLength(40);
  });

  it('a LOCKED track can still be renamed — the lock protects the clips, not the label', () => {
    let p = p0();
    p = { ...p, tracks: p.tracks.map((t, i) => (i === 0 ? { ...t, locked: true } : t)) };
    expect(renameTrack(p, p.tracks[0].id, 'Locked but named').tracks[0].name).toBe('Locked but named');
  });

  it('returns the SAME project when the name did not change', () => {
    // Otherwise every click of the name adds an undo step for nothing.
    const p = p0();
    expect(renameTrack(p, p.tracks[0].id, 'Video 1')).toBe(p);
  });
});

describe('moving a layer up and down', () => {
  const p0 = () => { __resetIds(); return createProject({ name: 'T' }); };  // Video 1, Audio 1

  it('swaps with the one above', () => {
    const p = p0();
    const after = moveTrack(p, p.tracks[1].id, -1);
    expect(after.tracks.map((t) => t.name)).toEqual(['Audio 1', 'Video 1']);
  });

  it('swaps with the one below', () => {
    const p = p0();
    expect(moveTrack(p, p.tracks[0].id, 1).tracks.map((t) => t.name)).toEqual(['Audio 1', 'Video 1']);
  });

  it('does nothing at the ends rather than wrapping around', () => {
    const p = p0();
    expect(moveTrack(p, p.tracks[0].id, -1)).toBe(p);
    expect(moveTrack(p, p.tracks[1].id, 1)).toBe(p);
  });

  it('canMoveTrack agrees with what move actually does', () => {
    // The button is disabled from canMoveTrack. If the two disagreed, a
    // button would be clickable and do nothing.
    const p = p0();
    expect(canMoveTrack(p, p.tracks[0].id, -1)).toBe(false);
    expect(canMoveTrack(p, p.tracks[0].id, 1)).toBe(true);
    expect(canMoveTrack(p, p.tracks[1].id, 1)).toBe(false);
  });

  it('carries the clips with the track', () => {
    let p = p0();
    p = addSource(p, { id: 's1', url: 'https://x/a.mp4' });
    p = addClip(p, p.tracks[0].id, createClip({ kind: 'video', sourceId: 's1', start: 0, in: 0, out: 5 }));
    const after = moveTrack(p, p.tracks[0].id, 1);
    expect(after.tracks[1].name).toBe('Video 1');
    expect(after.tracks[1].clips).toHaveLength(1);
  });

  it('ORDER DECIDES WHICH VIDEO LAYER EXPORTS — moving one up changes the file', () => {
    // exportPlan renders the first video track. So this is not cosmetic:
    // promoting a layer is how you choose what ends up in the export.
    let p = p0();
    p = addTrack(p, 'video');                  // Video 2 — now lands directly under Video 1
    const v2 = p.tracks.find((t) => t.name === 'Video 2').id;
    expect(p.tracks.filter((t) => t.kind === 'video')[0].name).toBe('Video 1');

    p = moveTrack(p, v2, -1);                  // one step is enough now
    expect(p.tracks.filter((t) => t.kind === 'video')[0].name).toBe('Video 2');
  });
});

// ─── WHERE A NEW LAYER GOES, AND HOW MANY ────────────────────────────────────
// Both from the owner, 2026-08-23, after using the + row: a new video landed
// at the very bottom under the text track instead of beside Video 1, and they
// asked for a ceiling of three per kind.

describe('a new layer joins its own kind', () => {
  // "when I click new video, it will become under this — the same timeline of
  // video. Don't add it on the last one."
  const base = () => { __resetIds(); let p = createProject({ name: 'T' }); return addTrack(p, 'text'); };

  it('inserts a video DIRECTLY BELOW the existing video, not at the bottom', () => {
    const p = base();                                  // Video 1, Audio 1, Text 1
    expect(addTrack(p, 'video').tracks.map((t) => t.name))
      .toEqual(['Video 1', 'Video 2', 'Audio 1', 'Text 1']);
  });

  it('does the same for audio', () => {
    const p = base();
    expect(addTrack(p, 'audio').tracks.map((t) => t.name))
      .toEqual(['Video 1', 'Audio 1', 'Audio 2', 'Text 1']);
  });

  it('goes to the end when it is the FIRST of its kind', () => {
    const p = base();
    expect(addTrack(p, 'image').tracks.map((t) => t.name))
      .toEqual(['Video 1', 'Audio 1', 'Text 1', 'Image 1']);
  });

  it('follows the kind even after the layers have been reordered', () => {
    // The insert point is found by looking, not remembered from creation.
    let p = base();
    p = moveTrack(p, p.tracks[0].id, 1);               // Audio 1, Video 1, Text 1
    expect(addTrack(p, 'video').tracks.map((t) => t.name))
      .toEqual(['Audio 1', 'Video 1', 'Video 2', 'Text 1']);
  });
});

describe('three of a kind is the limit', () => {
  it('refuses a fourth, and says why', () => {
    __resetIds();
    let p = createProject({ name: 'T' });               // Video 1
    p = addTrack(p, 'video');
    p = addTrack(p, 'video');                           // 3 video now
    expect(countKind(p, 'video')).toBe(MAX_TRACKS_PER_KIND);

    const refused = addTrack(p, 'video');
    expect(refused, 'a fourth was added').toBe(p);
    expect(whyNoMoreTracks(p, 'video')).toMatch(/limit/i);
  });

  it('counts each kind SEPARATELY — three video does not block audio', () => {
    __resetIds();
    let p = createProject({ name: 'T' });
    p = addTrack(p, 'video');
    p = addTrack(p, 'video');
    expect(whyNoMoreTracks(p, 'video')).toBeTruthy();
    expect(whyNoMoreTracks(p, 'audio')).toBe(null);
    expect(countKind(addTrack(p, 'audio'), 'audio')).toBe(2);
  });

  it('deleting one frees a slot again', () => {
    __resetIds();
    let p = createProject({ name: 'T' });
    p = addTrack(p, 'video');
    p = addTrack(p, 'video');
    const third = p.tracks.filter((t) => t.kind === 'video')[2].id;
    p = removeTrack(p, third);
    expect(whyNoMoreTracks(p, 'video')).toBe(null);
  });

  it('names an unknown kind rather than shrugging', () => {
    __resetIds();
    expect(whyNoMoreTracks(createProject({ name: 'T' }), 'hologram')).toMatch(/not a kind/);
  });
});

// ─── PER-LAYER HEIGHT ────────────────────────────────────────────────────────
// I first built this as ONE control that resized every row together. The owner
// came straight back: "to control the height of each layer separately... I
// cannot until now." They were right — the layer being worked on wants to be
// tall and the rest want to be out of the way, and one global size cannot do
// both.

describe('sizing one layer without touching the others', () => {
  const p0 = () => { __resetIds(); return createProject({ name: 'T' }); };

  it('sets a height on ONE track only', () => {
    const p = p0();
    const after = setTrackHeight(p, p.tracks[0].id, 90);
    expect(after.tracks[0].height).toBe(90);
    expect(after.tracks[1].height, 'it resized a track nobody touched').toBeUndefined();
  });

  it('clamps rather than letting a drag produce a useless row', () => {
    // A 4px track cannot show a clip label; a 900px one hides every other
    // layer, which is the problem this was meant to solve.
    const p = p0();
    expect(setTrackHeight(p, p.tracks[0].id, -50).tracks[0].height).toBe(MIN_TRACK_H);
    expect(setTrackHeight(p, p.tracks[0].id, 9999).tracks[0].height).toBe(MAX_TRACK_H);
  });

  it('rounds, because a drag produces fractions', () => {
    const p = p0();
    expect(setTrackHeight(p, p.tracks[0].id, 61.7).tracks[0].height).toBe(62);
  });

  it('survives rubbish without setting NaN as a height', () => {
    const p = p0();
    expect(setTrackHeight(p, p.tracks[0].id, undefined).tracks[0].height).toBe(MIN_TRACK_H);
  });

  it('returns the SAME project when the height did not change', () => {
    // Otherwise every pointermove in a drag adds an undo step.
    let p = setTrackHeight(p0(), p0().tracks[0].id, 90);
    p = setTrackHeight(p, p.tracks[0].id, 90);
    expect(setTrackHeight(p, p.tracks[0].id, 90)).toBe(p);
  });

  it('clearing puts it back to following the global size', () => {
    let p = setTrackHeight(p0(), p0().tracks[0].id, 120);
    expect(p.tracks[0].height).toBe(120);
    p = clearTrackHeight(p, p.tracks[0].id);
    expect('height' in p.tracks[0], 'the key should be gone, not set to undefined').toBe(false);
  });

  it('clearing a track that never had one changes nothing', () => {
    const p = p0();
    expect(clearTrackHeight(p, p.tracks[0].id)).toBe(p);
  });

  it('the height travels with the track when it is reordered', () => {
    let p = setTrackHeight(p0(), p0().tracks[0].id, 100);
    p = moveTrack(p, p.tracks[0].id, 1);
    expect(p.tracks[1].height).toBe(100);
  });
});

describe('clip volume is a LINEAR GAIN, and old projects must not come back mute', () => {
  // Found 2026-08-25 while making the viewer actually play audio. Three
  // consumers already treated volume as a linear multiplier — the agent's
  // setVolume validates 0–2 and reports a percentage, the export multiplies by
  // it, HTMLMediaElement.volume is 0–1 — and createClip defaulted it to 0 with
  // the comment "dB, 0 = unchanged". A fourth unit, in the one place that set
  // the value.
  //
  // It was harmless only because NOTHING READ IT. The moment the viewer did,
  // every clip in the product was silent.
  it('a new clip is at full volume, not zero', () => {
    expect(createClip({ kind: 'audio', sourceId: 's', out: 5 }).volume).toBe(1);
  });

  it('a project made today is already stamped, so migration is a no-op', () => {
    const p = createProject({});
    expect(p.audioSchema).toBe(AUDIO_SCHEMA);
    expect(migrateAudio(p)).toBe(p);
  });

  it('brings a pre-2026-08-25 project up to full volume', () => {
    // A stored 0 cannot have been a deliberate mute — nothing read the field
    // and no control ever set it — so 0 always meant "never touched".
    const old = { tracks: [{ id: 't1', kind: 'audio', clips: [
      { id: 'c1', volume: 0 }, { id: 'c2' },
    ] }] };
    const next = migrateAudio(old);
    expect(next.tracks[0].clips.map((c) => c.volume)).toEqual([1, 1]);
    expect(next.audioSchema).toBe(AUDIO_SCHEMA);
  });

  it('AFTER the stamp, a zero is a real mute and is left alone', () => {
    // The window in which 0 can be reinterpreted closes the moment a project
    // is stamped. Otherwise "mute the music" would be undone on next load.
    const stamped = { audioSchema: AUDIO_SCHEMA, tracks: [{ id: 't1', kind: 'audio', clips: [{ id: 'c1', volume: 0 }] }] };
    expect(migrateAudio(stamped).tracks[0].clips[0].volume).toBe(0);
  });

  it('leaves a deliberate partial volume alone', () => {
    const old = { tracks: [{ id: 't1', kind: 'audio', clips: [{ id: 'c1', volume: 0.4 }] }] };
    expect(migrateAudio(old).tracks[0].clips[0].volume).toBe(0.4);
  });

  it('survives junk', () => {
    expect(migrateAudio(null)).toBeNull();
    expect(migrateAudio({})).toEqual({});
    expect(() => migrateAudio({ tracks: [{ id: 't', kind: 'audio' }] })).not.toThrow();
  });
});
