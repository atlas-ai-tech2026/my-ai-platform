// ─── timeline.js ─────────────────────────────────────────────────────────────
// The project document: what a Voxel Edit Cut project IS.
//
// ── WHY THIS FILE COMES FIRST ──────────────────────────────────────────────
// Five separate things will read and write this same object, and if they
// disagree about its shape even slightly, they disagree forever:
//
//   the timeline UI     drag a clip           → move()
//   undo / redo         snapshot and restore  → the whole document
//   autosave            persist and reload    → serialise / parse
//   the agent (Stage 3) tool calls on it      → the same functions the UI uses
//   export (Stage 1)    render it             → reads, never writes
//
// So the document is defined ONCE, here, with the operations on it as pure
// functions. Nothing in this file knows about React, ffmpeg, or the network.
// That is deliberate: it makes the part every other part depends on the part
// that is fully testable.
//
// ── WHAT WAS LEARNED FROM THE FIRST ATTEMPT ────────────────────────────────
// A single-clip editor was built first and the owner correctly rejected it as
// a launch: it was about 5% of the product and would have spent the one launch
// moment. What survives from it is the layer BELOW the UI — edit-ops.js (the
// free/paid line, the plan limits) and edit-ffmpeg-args.js (the crop maths,
// the atempo chain). This file sits between them and the screen.
//
// ── TIME IS IN SECONDS, AS A NUMBER, ALWAYS ────────────────────────────────
// Not frames, not milliseconds, not strings. Frames would bake a frame rate
// into the document and break the moment a 24fps clip meets a 30fps one.
// Milliseconds-as-integers look tidy until a 1/3-second crossfade rounds
// differently in two places. Seconds as floats match what ffmpeg takes on the
// command line and what <video>.currentTime reports, so no conversion sits
// between the preview and the export — and a conversion is where drift starts.

/** Tracks render bottom-up in this order; index 0 is the topmost layer. */
export const TRACK_KINDS = ['video', 'audio', 'text', 'image', 'captions'];

/** Every clip carries one of these. Anything else is rejected at the door. */
export const CLIP_KINDS = TRACK_KINDS;

export const SCHEMA_VERSION = 1;

let seq = 0;
/**
 * Ids are generated, never derived from content.
 *
 * Deliberately NOT crypto.randomUUID(): this file is imported by tests that
 * assert on document shape, and a random id makes every snapshot comparison a
 * fight. A counter plus a prefix is enough — ids only have to be unique within
 * one document, and the document lives in one browser tab.
 */
export const newId = (prefix = 'c') => `${prefix}${(seq += 1).toString(36)}`;

/** Reset between tests so ids are predictable. Never called in the app. */
export const __resetIds = () => { seq = 0; };

const round = (n) => Math.round(n * 1000) / 1000;

/**
 * An empty project.
 *
 * A project ALWAYS has at least one video track and one audio track, even
 * before anything is added. An empty project with no tracks renders as a blank
 * screen with no way to drop anything onto it — the customer's first moment in
 * the editor should be a place to put something, not a void.
 */
export function createProject({ name = 'Untitled project', ratio = '16:9' } = {}) {
  return {
    schema: SCHEMA_VERSION,
    name,
    ratio,
    tracks: [
      { id: newId('t'), kind: 'video', name: 'Video 1', clips: [], muted: false, hidden: false, locked: false },
      { id: newId('t'), kind: 'audio', name: 'Audio 1', clips: [], muted: false, hidden: false, locked: false },
    ],
  };
}

/**
 * A clip: a window onto a source, placed at a point on the timeline.
 *
 * `in` and `out` are offsets INTO THE SOURCE. `start` is where it sits on the
 * timeline. Keeping those separate is what makes trimming non-destructive —
 * dragging the left edge changes `in`, and the material outside it is still
 * there to be dragged back. Collapsing them into one pair of numbers is the
 * decision that makes an editor feel disposable.
 */
export function createClip({ kind = 'video', sourceId, start = 0, in: inPoint = 0, out, name = '' }) {
  if (!CLIP_KINDS.includes(kind)) throw new Error(`Unknown clip kind: ${kind}`);
  if (!Number.isFinite(out) || out <= inPoint) {
    throw new Error('A clip needs an out point after its in point.');
  }
  return {
    id: newId(),
    kind,
    sourceId,
    name,
    start: round(Math.max(0, start)),
    in: round(Math.max(0, inPoint)),
    out: round(out),
    speed: 1,
    volume: 0,      // dB, 0 = unchanged
    fadeIn: 0,
    fadeOut: 0,
  };
}

/** How long a clip occupies the timeline — source length divided by speed. */
export const clipDuration = (clip) => round((clip.out - clip.in) / (clip.speed || 1));

/** Where a clip ends on the timeline. */
export const clipEnd = (clip) => round(clip.start + clipDuration(clip));

/**
 * The project's total length: the furthest point any clip reaches.
 *
 * Computed, never stored. A stored duration is a second source of truth that
 * goes stale the first time somebody deletes the last clip — and then the
 * export renders thirty seconds of black after the content ends.
 */
export function projectDuration(project) {
  let end = 0;
  for (const track of project.tracks) {
    for (const clip of track.clips) end = Math.max(end, clipEnd(clip));
  }
  return round(end);
}

const findTrack = (project, trackId) => project.tracks.find((t) => t.id === trackId);

/** Every operation returns a NEW project. Nothing here mutates its input. */
const withTracks = (project, tracks) => ({ ...project, tracks });

const replaceTrack = (project, trackId, fn) => withTracks(
  project,
  project.tracks.map((t) => (t.id === trackId ? fn(t) : t)),
);

/** Clips are kept sorted by start time so rendering never has to sort. */
const sortClips = (clips) => [...clips].sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));

export function addClip(project, trackId, clip) {
  const track = findTrack(project, trackId);
  if (!track) throw new Error(`No such track: ${trackId}`);
  if (track.locked) return project;
  if (track.kind !== clip.kind && !(track.kind === 'video' && clip.kind === 'image')) {
    throw new Error(`A ${clip.kind} clip cannot go on a ${track.kind} track.`);
  }
  return replaceTrack(project, trackId, (t) => ({ ...t, clips: sortClips([...t.clips, clip]) }));
}

export function removeClip(project, clipId) {
  return withTracks(project, project.tracks.map((t) => (
    t.locked ? t : { ...t, clips: t.clips.filter((c) => c.id !== clipId) }
  )));
}

/** Move a clip along its track. Never negative — the timeline starts at zero. */
export function moveClip(project, clipId, newStart) {
  return withTracks(project, project.tracks.map((t) => (t.locked ? t : {
    ...t,
    clips: sortClips(t.clips.map((c) => (
      c.id === clipId ? { ...c, start: round(Math.max(0, newStart)) } : c
    ))),
  })));
}

/**
 * Trim an edge.
 *
 * ── WHY DRAGGING THE LEFT EDGE ALSO MOVES THE CLIP ────────────────────────
 * Pulling the left edge right means "start this clip later in its source".
 * That shortens it — and if `start` did not move by the same amount, the clip
 * would appear to slide left on the timeline while the customer dragged right.
 * Editors that get this wrong feel haunted.
 *
 * Both edges are clamped so a clip can never invert or reach zero length; the
 * minimum is one film frame at 24fps, which is the shortest thing anyone can
 * see.
 */
export const MIN_CLIP = 1 / 24;

export function trimClip(project, clipId, edge, deltaSeconds) {
  return withTracks(project, project.tracks.map((t) => (t.locked ? t : {
    ...t,
    clips: sortClips(t.clips.map((c) => {
      if (c.id !== clipId) return c;
      if (edge === 'start') {
        const maxIn = c.out - MIN_CLIP * (c.speed || 1);
        const nextIn = Math.min(Math.max(0, c.in + deltaSeconds), maxIn);
        const moved = nextIn - c.in;
        return { ...c, in: round(nextIn), start: round(Math.max(0, c.start + moved / (c.speed || 1))) };
      }
      const minOut = c.in + MIN_CLIP * (c.speed || 1);
      return { ...c, out: round(Math.max(minOut, c.out + deltaSeconds)) };
    })),
  })));
}

/**
 * Split a clip at a timeline position — the blade.
 *
 * The two halves share the source and meet exactly: the left half's `out`
 * becomes the right half's `in`. No gap, no overlap, no frame lost. Getting
 * this wrong by a rounding error puts a one-frame flash between every cut,
 * which nobody sees while editing and everybody sees on export.
 */
export function splitClip(project, clipId, atSeconds) {
  return withTracks(project, project.tracks.map((t) => {
    if (t.locked) return t;
    const target = t.clips.find((c) => c.id === clipId);
    if (!target) return t;

    const offset = atSeconds - target.start;
    if (offset <= MIN_CLIP || offset >= clipDuration(target) - MIN_CLIP) return t;

    const cutInSource = round(target.in + offset * (target.speed || 1));
    const left = { ...target, out: cutInSource };
    const right = {
      ...target,
      id: newId(),
      in: cutInSource,
      start: round(atSeconds),
      // A fade belongs to the edge it was drawn on. Carrying fadeIn onto the
      // right half would put a fade in the middle of what was one shot.
      fadeIn: 0,
    };
    return { ...t, clips: sortClips([...t.clips.filter((c) => c.id !== clipId), left, { ...right, fadeOut: target.fadeOut }]) };
  }));
}

/** Set any simple property on a clip: speed, volume, fades, name. */
export function updateClip(project, clipId, patch) {
  return withTracks(project, project.tracks.map((t) => (t.locked ? t : {
    ...t,
    clips: sortClips(t.clips.map((c) => (c.id === clipId ? { ...c, ...patch, id: c.id } : c))),
  })));
}

export function addTrack(project, kind, name) {
  if (!TRACK_KINDS.includes(kind)) throw new Error(`Unknown track kind: ${kind}`);
  const n = project.tracks.filter((t) => t.kind === kind).length + 1;
  return withTracks(project, [...project.tracks, {
    id: newId('t'), kind, name: name || `${kind[0].toUpperCase()}${kind.slice(1)} ${n}`,
    clips: [], muted: false, hidden: false, locked: false,
  }]);
}

/** Find a clip and the track holding it, without the caller looping twice. */
export function locateClip(project, clipId) {
  for (const track of project.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return { track, clip };
  }
  return null;
}

/**
 * What plays at a given moment — used by the preview and by export.
 *
 * Returns the topmost non-hidden video/image, plus every audible audio clip,
 * because audio layers and pictures do not. Track order IS z-order, so the
 * first match wins for picture.
 */
export function activeAt(project, seconds) {
  const covers = (c) => seconds >= c.start && seconds < clipEnd(c);
  let picture = null;
  const audio = [];
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if (!covers(clip)) continue;
      if (['video', 'image'].includes(clip.kind) && !track.hidden && !picture) picture = { track, clip };
      if (['video', 'audio'].includes(clip.kind) && !track.muted) audio.push({ track, clip });
    }
  }
  return { picture, audio, seconds: round(seconds) };
}

/**
 * Where in the SOURCE we are, given a timeline position.
 *
 * The one calculation the preview cannot get wrong: at 2× speed, one second on
 * the timeline is two seconds of source. Off by a factor and the picture drifts
 * from the sound the moment anybody changes speed.
 */
export function sourceTimeAt(clip, timelineSeconds) {
  const offset = timelineSeconds - clip.start;
  return round(clip.in + offset * (clip.speed || 1));
}
