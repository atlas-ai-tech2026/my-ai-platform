// ─── timeline-drop.js ────────────────────────────────────────────────────────
// Where a dragged clip is allowed to land.
//
// ── THE PROBLEM THIS EXISTS TO PREVENT ─────────────────────────────────────
// `addClip` and `moveClip` do not check for overlap — two clips may sit on top
// of each other on one track, and nothing complains. That is survivable for a
// drag of something already on the timeline, because you can see it happen and
// drag it back.
//
// It is NOT survivable for a drop from the library, because of what `activeAt`
// does with an overlap:
//
//     for (const clip of track.clips) { if (covers(clip) && !picture) picture = clip }
//     …and sortClips orders by start
//
// The EARLIER clip wins for the whole overlap. So a clip dropped inside the
// span of a longer one is added, appears in the project, is saved, is exported
// — and never plays a single frame. The customer sees it on the timeline and
// cannot see it in the video. That is the same shape as the recording that
// landed off-screen and the history that pointed at expired URLs: it works
// exactly as written and helps nobody.
//
// ── SO: A DROP NEVER OVERLAPS ──────────────────────────────────────────────
// Clicking a library card appends to the END, which is the one placement that
// can never displace anything. Dragging has to let you choose the moment —
// that is the entire point of it — so it keeps the same promise a different
// way: it puts the clip at the time you chose, and if that time is occupied it
// goes on another layer rather than on top. Nothing already cut is moved,
// shortened, or covered, ever.
//
// The order of preference is deliberate:
//   1. the layer you dropped on, at the time you dropped        (what you meant)
//   2. another layer of the same kind, at the SAME time         (time > layer)
//   3. a new layer, at the same time                            (still that time)
//   4. the nearest free moment on the layer you dropped on      (last resort)
//   5. refuse, with a reason
//
// Steps 2–4 all say what they did. A clip that quietly appears somewhere other
// than where it was dropped is worse than one that refuses.

import { clipEnd, whyNoMoreTracks } from './timeline.js';

/** Floating-point slack. Clips that touch exactly do not overlap. */
const EPS = 0.001;

const round = (n) => Math.round(n * 1000) / 1000;

/** m:ss, for saying WHERE something went. Deliberately not imported from
 *  Timeline.jsx — that is a component, and a pure module should not pull one
 *  in for four lines of arithmetic. */
function clock(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Can a video/image/audio/text clip of this kind live on this track? */
export function trackAccepts(track, kind) {
  if (!track) return false;
  // The same rule addClip enforces: an image is welcome on a video track.
  return track.kind === kind || (track.kind === 'video' && kind === 'image');
}

/**
 * Is [start, start + length) clear on this track?
 *
 * @param ignoreId  a clip that does not count — for moving something that is
 *                  already on this track, which must not collide with itself.
 */
export function fitsAt(track, start, length, { ignoreId = null } = {}) {
  if (start < -EPS) return false;
  const end = start + length;
  return !track.clips.some((c) => (
    c.id !== ignoreId && start < clipEnd(c) - EPS && end > c.start + EPS
  ));
}

/**
 * The free moment closest to the one that was wanted, or null if the track has
 * no room at all.
 *
 * Only the edges are considered — the start of the track, the end of each clip,
 * and the point at which a clip would finish exactly as the next one begins.
 * Anywhere that is free at all is free at one of those.
 */
export function nearestFreeStart(track, wanted, length, { ignoreId = null } = {}) {
  const others = track.clips.filter((c) => c.id !== ignoreId);
  const candidates = [0];
  for (const c of others) {
    candidates.push(clipEnd(c));         // straight after it
    candidates.push(c.start - length);   // ending exactly as it begins
  }
  const usable = candidates
    .map(round)
    .filter((s) => s >= -EPS && fitsAt(track, Math.max(0, s), length, { ignoreId }))
    .map((s) => Math.max(0, s));

  if (!usable.length) return null;
  // Closest to what was asked for; earlier wins a tie, because a clip that
  // jumps backwards is easier to find than one that jumps forwards past the
  // end of everything.
  return usable.sort((a, b) => Math.abs(a - wanted) - Math.abs(b - wanted) || a - b)[0];
}

/**
 * Decide where a dropped clip goes. Pure — it changes nothing.
 *
 * @returns {{ok:true, trackId:string|null, start:number, newTrack?:string, note?:string}}
 *          `trackId: null` with `newTrack` set means the caller must add that
 *          layer first. A `note` is a plain sentence for the customer, present
 *          only when the clip did NOT land exactly where it was dropped.
 * @returns {{ok:false, reason:string}}
 */
export function planDrop(project, { trackId, kind = 'video', length, at }) {
  if (!project?.tracks) return { ok: false, reason: 'There is no timeline to drop onto.' };
  if (!(length > 0)) return { ok: false, reason: 'That clip has no length, so it has not been added.' };

  const wanted = round(Math.max(0, Number(at) || 0));
  const target = project.tracks.find((t) => t.id === trackId) || null;

  if (target && !trackAccepts(target, kind)) {
    return { ok: false, reason: `A ${kind} clip cannot go on ${target.name}.` };
  }

  // 1 — exactly where it was dropped.
  if (target && !target.locked && fitsAt(target, wanted, length)) {
    return { ok: true, trackId: target.id, start: wanted };
  }

  // 2 — same moment, a different layer of the same kind. Keeping the TIME is
  //     more important than keeping the layer: the time is what was aimed at.
  const siblings = project.tracks.filter((t) => (
    t.id !== trackId && !t.locked && trackAccepts(t, kind)
  ));
  for (const t of siblings) {
    if (fitsAt(t, wanted, length)) {
      const why = target?.locked ? `${target.name} is locked` : `${target?.name || 'that layer'} was busy there`;
      return { ok: true, trackId: t.id, start: wanted, note: `Put on ${t.name} — ${why}.` };
    }
  }

  // 3 — still that moment, on a layer that does not exist yet.
  if (!whyNoMoreTracks(project, kind)) {
    return {
      ok: true, trackId: null, newTrack: kind, start: wanted,
      note: 'Added a new layer — every other one was busy at that moment.',
    };
  }

  // 4 — the nearest free moment on the layer that was aimed at. Only now is
  //     the TIME given up, and it says so.
  if (target && !target.locked) {
    const snapped = nearestFreeStart(target, wanted, length);
    if (snapped !== null) {
      return {
        ok: true, trackId: target.id, start: snapped,
        note: `Moved to ${clock(snapped)} — ${clock(wanted)} was taken and every layer is full.`,
      };
    }
  }

  // 5 — nowhere. Say which limit was hit rather than "cannot".
  return {
    ok: false,
    reason: whyNoMoreTracks(project, kind)
      || 'There is no free space for that clip on any layer.',
  };
}
