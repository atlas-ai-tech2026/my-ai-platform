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

/**
 * Move the counter PAST every id already in a document. Call this immediately
 * after loading a saved project, before anything can add to it.
 *
 * ── WHY THIS EXISTS, AND WHY IT IS NOT OPTIONAL ────────────────────────────
 * `seq` lives in this module, so it restarts at 0 on every page load. Restore
 * a project containing c1 c2 c3, add one clip, and that clip is ALSO c1.
 *
 * Nothing throws. The timeline looks right. But removeClip('c1') now deletes
 * whichever the array reaches first, splitClip patches one and leaves the
 * other, and locateClip answers about the wrong clip. The damage arrives
 * minutes later, on a second session, looking like the editor randomly ate
 * somebody's work — and it is unreportable, because the person cannot say
 * what they did to cause it.
 *
 * Autosave is what makes it reachable at all: without persistence, ids only
 * ever have to be unique within one tab's lifetime, which they are. This is
 * the bug that ships WITH the feature that was supposed to protect the work.
 *
 * Only track and clip ids are scanned. Source keys are caller-supplied
 * ('racing', a generation id) and are not from this counter.
 */
export function seedIdsFrom(project) {
  let max = seq;
  const consider = (id) => {
    if (typeof id !== 'string' || id.length < 2) return;
    const rest = id.slice(1);
    const n = Number.parseInt(rest, 36);
    // Round-trip so a hand-written id like "tXX-2" cannot push the counter to
    // an absurd number on the strength of a partial parse.
    if (Number.isFinite(n) && n.toString(36) === rest && n > max) max = n;
  };
  for (const track of project?.tracks || []) {
    consider(track.id);
    for (const clip of track.clips || []) consider(clip.id);
  }
  seq = max;
  return seq;
}

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
    // ── SOURCES, KEPT ONCE AND REFERENCED BY MANY CLIPS ────────────────────
    // A clip holds a sourceId, never a URL. Split one clip into six and there
    // is still ONE source; copying the url into each would mean six places to
    // update when a signed link is refreshed, and five of them would be missed.
    //
    // ── AND THIS IS WHERE THE DIFFERENTIATOR LIVES ────────────────────────
    // A source carries the PROMPT that made it, plus model, camera, lens,
    // focal length and f-stop — all of which VOXEL already records per
    // generation and no upload-based editor can ever have, because their user
    // arrives with a file and no history.
    //
    // That is what makes "regenerate this shot in place" possible: the clip on
    // the timeline knows the words that produced it, so it can be remade with
    // one changed and dropped back keeping the in/out points and the edit
    // around it. Carried from the start rather than bolted on, because a
    // schema change after projects exist is a migration.
    sources: {},
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

/**
 * Register a source. Everything except id/url is optional — an uploaded file
 * has no prompt, and that is a fact about it, not a gap to be filled with a
 * placeholder that later reads as real.
 */
export function addSource(project, source) {
  if (!source?.id || !source?.url) throw new Error('A source needs an id and a url.');
  return { ...project, sources: { ...project.sources, [source.id]: { ...source } } };
}

/** The source behind a clip, or null. Null is a real answer: a source can be
 *  missing because a link expired, and that must not read as an empty project. */
export const sourceOf = (project, clip) => project.sources?.[clip?.sourceId] || null;

/**
 * Can this shot be remade?
 *
 * Only when the prompt survived. An uploaded file cannot be regenerated at any
 * price — VOXEL never knew how it was made — so the button must not offer it
 * and then fail.
 */
export const canRegenerate = (project, clip) => Boolean(sourceOf(project, clip)?.prompt);

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

/**
 * ── UNTOUCHED TRACKS MUST COME BACK AS THE SAME OBJECT ─────────────────────
 * Every edit used to `.map()` across all tracks and spread each one, so moving
 * a clip on track 1 produced a brand-new object for track 2 as well — even when
 * track 2 was empty.
 *
 * That is invisible until undo exists. History keeps whole snapshots, and it
 * can only afford to because unchanged parts are SHARED BY REFERENCE. Rebuild
 * every track on every edit and a hundred steps of history costs a hundred full
 * documents instead of a hundred pointers.
 *
 * Caught by the test that asserts it, on the first run — a present bug, not the
 * future regression the test was written for.
 *
 * `fn` returns a new clips array. If nothing in it actually changed identity,
 * the original track object is returned untouched.
 */
function mapClips(project, fn) {
  let anyTrackChanged = false;
  const tracks = project.tracks.map((track) => {
    if (track.locked) return track;
    const clips = fn(track);
    const same = clips.length === track.clips.length
      && clips.every((c, i) => c === track.clips[i]);
    if (same) return track;
    anyTrackChanged = true;
    return { ...track, clips };
  });
  return anyTrackChanged ? { ...project, tracks } : project;
}

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
  return mapClips(project, (t) => t.clips.filter((c) => c.id !== clipId));
}

/** Move a clip along its track. Never negative — the timeline starts at zero. */
export function moveClip(project, clipId, newStart) {
  return mapClips(project, (t) => sortClips(t.clips.map((c) => (
    c.id === clipId ? { ...c, start: round(Math.max(0, newStart)) } : c
  ))));
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
  return mapClips(project, (t) => sortClips(t.clips.map((c) => {
      if (c.id !== clipId) return c;
      if (edge === 'start') {
        const maxIn = c.out - MIN_CLIP * (c.speed || 1);
        const nextIn = Math.min(Math.max(0, c.in + deltaSeconds), maxIn);
        const moved = nextIn - c.in;
        return { ...c, in: round(nextIn), start: round(Math.max(0, c.start + moved / (c.speed || 1))) };
      }
      const minOut = c.in + MIN_CLIP * (c.speed || 1);
      return { ...c, out: round(Math.max(minOut, c.out + deltaSeconds)) };
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
  return mapClips(project, (t) => sortClips(
    t.clips.map((c) => (c.id === clipId ? { ...c, ...patch, id: c.id } : c))));
}

/**
 * Point one clip at a NEW source — the operation behind "regenerate this shot".
 *
 * ── WHY A NEW SOURCE AND NOT AN OVERWRITE ──────────────────────────────────
 * Sources are shared. Split a clip in six and all six reference one source, so
 * rewriting that source's url would silently remake five other shots the
 * customer never touched. It also makes undo impossible: the original would be
 * gone from the document, not just unreferenced.
 *
 * ── THE PART THAT IS EASY TO GET WRONG ─────────────────────────────────────
 * The remade shot is rarely the same LENGTH. A model asked for five seconds
 * may return 4.8. If in/out are carried across untouched they now point past
 * the end of the new file, and ffmpeg's trim happily accepts a range that does
 * not exist — the export comes back with black on the end, or the concat
 * lengths stop matching what the timeline showed.
 *
 * So the window is clamped to what the new source actually contains, and when
 * that changes anything a NOTE is returned. It has to be returned rather than
 * logged: the customer chose to remake one shot, and the edit around it just
 * moved. Being told is the difference between a tool and a surprise.
 *
 * The clip keeps its id, its position and its track. Only the material under
 * it changes.
 */
export function replaceClipSource(project, clipId, source, newDuration) {
  const found = locateClip(project, clipId);
  if (!found) return { project, note: null };
  if (!source?.id) return { project, note: null };

  const { clip } = found;
  const withSource = addSource(project, source);

  const available = Number(newDuration);
  const hasLength = Number.isFinite(available) && available > 0;

  let nextIn = clip.in;
  let nextOut = clip.out;
  let note = null;

  if (hasLength) {
    // The in point can also fall off the end — a clip trimmed to start at 4s
    // pointed at a 3-second remake has nothing left at all.
    nextIn = Math.min(clip.in, Math.max(0, available - MIN_CLIP));
    nextOut = Math.min(clip.out, available);
    if (nextOut - nextIn < MIN_CLIP) {
      nextIn = 0;
      nextOut = Math.min(available, Math.max(MIN_CLIP, clip.out - clip.in));
    }

    const was = round((clip.out - clip.in) / (clip.speed || 1));
    const now = round((nextOut - nextIn) / (clip.speed || 1));
    if (Math.abs(was - now) > 0.001) {
      note = `The new shot is ${available.toFixed(1)}s, so this clip is now ${now.toFixed(1)}s instead of ${was.toFixed(1)}s.`;
    }
  }

  return {
    project: mapClips(withSource, (t) => sortClips(t.clips.map((c) => (
      c.id === clipId ? { ...c, sourceId: source.id, in: nextIn, out: nextOut } : c)))),
    note,
  };
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
 * ── THE HOLES NOBODY IS TOLD ABOUT ─────────────────────────────────────────
 * Found by the owner on 2026-08-23, asked as a question about the clock rather
 * than a bug report: drag a clip right and the total duration grows. That part
 * is correct — the total is the furthest point any clip reaches.
 *
 * What it does NOT say is that the extra time is BLACK SILENCE. On their screen
 * the total read 1:24 with a forty-eight second hole in the middle of the video
 * track, and nothing anywhere mentioned it. You find out on export, or when a
 * client watches it.
 *
 * So gaps become visible objects rather than absence. Showing them tells the
 * truth and leaves the decision to the editor — a magnetic timeline that closes
 * them automatically is great for a quick social cut and infuriating when the
 * pause was deliberate, for a title or a beat.
 *
 * Leading gaps count: two seconds of black before the first clip is still two
 * seconds of black. Trailing does not — after the last clip the project ends.
 *
 * `cursor` tracks the furthest END so far, not the previous clip's end, so
 * OVERLAPPING clips do not invent a gap that is actually covered.
 */
export function trackGaps(track, { minGap = MIN_CLIP } = {}) {
  const gaps = [];
  let cursor = 0;
  for (const clip of track.clips) {
    if (clip.start - cursor > minGap) {
      gaps.push({ start: round(cursor), end: round(clip.start), duration: round(clip.start - cursor) });
    }
    cursor = Math.max(cursor, clipEnd(clip));
  }
  return gaps;
}

/** Every gap in the project, tagged with the track it belongs to. */
export const projectGaps = (project) => project.tracks.flatMap(
  (track) => trackGaps(track).map((gap) => ({ ...gap, trackId: track.id })));

/**
 * Close a gap: pull everything after it left by exactly its length.
 *
 * ONE TRACK ONLY, deliberately. Rippling the whole project would mean closing a
 * hole in the video silently shifting the music out of sync with the picture
 * that is still there — a destructive edit disguised as tidying up. Per-track
 * is predictable; an all-tracks ripple can be an explicit second action later.
 */
export function closeGap(project, trackId, gapStart) {
  const track = findTrack(project, trackId);
  if (!track || track.locked) return project;
  const gap = trackGaps(track).find((g) => Math.abs(g.start - gapStart) < 0.001);
  if (!gap) return project;

  return mapClips(project, (t) => (t.id !== trackId ? t.clips : sortClips(
    t.clips.map((c) => (c.start >= gap.end - 0.001
      ? { ...c, start: round(Math.max(0, c.start - gap.duration)) }
      : c)),
  )));
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
