// ─── timeline-snap.js ────────────────────────────────────────────────────────
// Why a professional timeline feels different under the hand.
//
// Drag a clip next to another one without snapping and you get a 30-millisecond
// gap you cannot see at this zoom level. It renders as a black flash in the
// export — one frame of nothing — and the person who made it has no idea why,
// because on screen the two clips are touching.
//
// So snapping is not a convenience. It is what makes "put this right after
// that" produce an edit that is actually correct.
//
// ── THE THING EVERY IMPLEMENTATION GETS WRONG ──────────────────────────────
// Snapping in TIME instead of in PIXELS.
//
// A fixed 0.1s threshold is invisible when zoomed out (0.1s is a fraction of a
// pixel — snapping never fires) and unusable when zoomed in (0.1s is 24 pixels
// — the clip jumps away from where you are pointing and refuses to sit where
// you want it).
//
// The threshold has to be a constant number of PIXELS, converted to time using
// the current zoom. Then it feels identical at every zoom level, which is the
// entire point.
//
// ── AND THE SECOND THING ───────────────────────────────────────────────────
// A moving clip has TWO edges. Dragging its left edge near a target snaps the
// left edge; dragging so its RIGHT edge lands on a target has to snap the right
// edge — which means offsetting the start by the clip's own duration. Snapping
// only the left edge is why some editors feel like they only half work.

import { clipEnd } from './timeline.js';

/** How close, in SCREEN PIXELS, before it snaps. Eight is the number most NLEs
 *  land on: close enough not to fight you, far enough to actually catch. */
export const SNAP_PX = 8;

/**
 * Everything worth snapping to, in seconds.
 *
 * The moving clip is excluded — a clip cannot snap to itself, and without this
 * it locks in place the instant you start dragging.
 *
 * Zero is always a target. "Back to the very start" is the most common
 * placement there is, and being one frame off it is the most common way to get
 * a black flash at the top of an export.
 */
export function snapTargets(project, { excludeId = null, playhead = null } = {}) {
  const out = new Set([0]);
  if (typeof playhead === 'number' && playhead >= 0) out.add(round(playhead));

  for (const track of project?.tracks || []) {
    for (const clip of track.clips || []) {
      if (clip.id === excludeId) continue;
      out.add(round(clip.start));
      out.add(round(clipEnd(clip)));
    }
  }
  return [...out].sort((a, b) => a - b);
}

const round = (n) => Math.round(n * 1000) / 1000;

/**
 * Snap a proposed start time, considering BOTH edges of the moving clip.
 *
 * @param {number} start     where the drag wants to put the clip
 * @param {number} duration  the moving clip's length, so its right edge counts
 * @param {number[]} targets from snapTargets
 * @param {number} pps       pixels per second — the CURRENT zoom
 * @returns {{start: number, snappedTo: number|null, edge: 'start'|'end'|null}}
 */
export function snapStart(start, duration, targets, pps, { enabled = true, px = SNAP_PX } = {}) {
  if (!enabled || !pps || !targets?.length) {
    return { start, snappedTo: null, edge: null };
  }
  const tolerance = px / pps;          // pixels → seconds AT THIS ZOOM
  const end = start + duration;

  let best = null;
  for (const t of targets) {
    // The left edge landing on the target.
    const dStart = Math.abs(t - start);
    if (dStart <= tolerance && (!best || dStart < best.distance)) {
      best = { distance: dStart, start: t, snappedTo: t, edge: 'start' };
    }
    // The RIGHT edge landing on it — the half most implementations skip.
    const dEnd = Math.abs(t - end);
    if (dEnd <= tolerance && (!best || dEnd < best.distance)) {
      best = { distance: dEnd, start: t - duration, snappedTo: t, edge: 'end' };
    }
  }

  if (!best) return { start, snappedTo: null, edge: null };
  // Never snap to a negative start. Catching the right edge on zero would put
  // the clip before the beginning of time, which moveClip clamps anyway — but
  // silently, so the snap indicator would point at a snap that did not happen.
  if (best.start < 0) return { start, snappedTo: null, edge: null };
  return { start: round(best.start), snappedTo: best.snappedTo, edge: best.edge };
}

/**
 * Snap a single edge while TRIMMING.
 *
 * Simpler than moving — only one edge is under the cursor — but it matters
 * more: trimming is how you close a gap by hand, and a gap you cannot see is
 * one you cannot close without this.
 */
export function snapEdge(time, targets, pps, { enabled = true, px = SNAP_PX } = {}) {
  if (!enabled || !pps || !targets?.length) return { time, snappedTo: null };
  const tolerance = px / pps;

  let best = null;
  for (const t of targets) {
    const d = Math.abs(t - time);
    if (d <= tolerance && (!best || d < best.distance)) best = { distance: d, t };
  }
  return best ? { time: round(best.t), snappedTo: best.t } : { time, snappedTo: null };
}
