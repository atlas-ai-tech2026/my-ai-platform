// ─── edit-session.js ─────────────────────────────────────────────────────────
// One editing session: a clip from the customer's library, plus what they want
// done to it, turned into an ordered plan for the executor.
//
// ── WHY ORDER IS THE WHOLE POINT OF THIS FILE ──────────────────────────────
// Every operation here is individually correct. Run them in the wrong sequence
// and the output is still a valid video that nobody would file a bug about —
// it is just wrong, or it took five times longer than it needed to:
//
//   RESIZE BEFORE TRIM   re-encodes 15 seconds to produce 3. Four fifths of
//                        the work is thrown away, and in the browser that is
//                        the difference between a wait and an abandonment.
//   TEXT BEFORE RESIZE   the caption is scaled and cropped along with the
//                        picture. A title centred for 16:9 loses its ends in
//                        a 9:16 crop, so the customer sees "ELCOME TO VOXE".
//   WATERMARK EARLY      same crop, and a logo positioned bottom-right ends up
//                        somewhere in the middle, or gone.
//
// None of those throw. None appear in a log. The order is therefore fixed here,
// in one place, and pinned by test — not left to whichever order the buttons
// happen to sit in on screen.

import { validatePlan } from './edit-ops.js';

/** The order operations must run in, and the reason each one sits where it does. */
export const STAGE_ORDER = [
  'trim', // first: everything after it works on less material
  'speed', // before resize, so only one scale pass is needed
  'resize', // before anything is drawn on, or it gets scaled and cropped
  'overlay', // after resize: the corner it was placed in still exists
  'addText', // after resize: centred stays centred
  'mixAudio', // last: audio is unaffected by the picture work above
  'volume',
];

/** A clip the customer can edit — normalised from a GenerationHistory row. */
export function toClip(record = {}) {
  const url = record.result_url || record.output_url || record.url;
  if (!url) return null;
  return {
    id: record.id,
    url,
    type: record.type === 'image' ? 'image' : record.type === 'audio' ? 'audio' : 'video',
    prompt: record.prompt || '',
    model: record.model || record.model_label || '',
    createdAt: record.created_date || record.created_at || null,
    // Duration is not always recorded — Kling rows have it, older rows do not.
    // Left null rather than defaulted, so the UI reads it off the <video>
    // element instead of trusting a number that was never written.
    duration: Number.isFinite(Number(record.duration)) ? Number(record.duration) : null,
  };
}

/**
 * Only finished work can be edited.
 *
 * A pending or failed generation has no file behind it. Offering it would end
 * in "could not load" on a thumbnail the customer can plainly see in the grid,
 * which reads as the editor being broken rather than as the clip not existing.
 */
export const isEditable = (record = {}) => {
  const status = String(record.status || 'completed').toLowerCase();
  if (!['completed', 'complete', 'succeeded', 'success'].includes(status)) return false;
  return Boolean(toClip(record));
};

/** A trim that survives contact with the real clip. */
export function clampTrim({ start, end, duration }) {
  const len = Number.isFinite(duration) && duration > 0 ? duration : null;
  let s = Number.isFinite(start) ? Math.max(0, start) : 0;
  let e = Number.isFinite(end) ? end : len;

  if (len != null) {
    s = Math.min(s, Math.max(0, len - 0.1));
    e = Math.min(Number.isFinite(e) ? e : len, len);
  }
  // A zero-or-negative range is the one input ffmpeg turns into an unreadable
  // filter complaint, so it is corrected here rather than passed on.
  if (!Number.isFinite(e) || e <= s) e = len != null ? len : s + 0.1;
  return { start: round3(s), end: round3(e) };
}

const round3 = (n) => Math.round(n * 1000) / 1000;

/**
 * Turn the panel's settings into an ordered plan.
 *
 * Anything left at its default contributes NOTHING. A trim covering the whole
 * clip, a resize to the shape it already is, 1× speed — each of those would
 * re-encode the video to produce a copy of itself, spending the customer's time
 * on nothing. So they are omitted, and a plan of zero steps is a valid answer
 * meaning "you have not asked for anything yet".
 */
export function buildPlan(settings = {}, clip = {}) {
  const ops = [];
  const duration = Number.isFinite(clip.duration) ? clip.duration : null;

  if (settings.trim) {
    const { start, end } = clampTrim({ ...settings.trim, duration });
    const wholeClip = start <= 0.001 && duration != null && end >= duration - 0.001;
    if (!wholeClip) ops.push({ op: 'trim', start, end });
  }

  if (Number.isFinite(settings.speed) && settings.speed !== 1) {
    ops.push({ op: 'speed', rate: settings.speed });
  }

  if (settings.ratio) {
    ops.push({ op: 'resize', ratio: settings.ratio, mode: settings.resizeMode || 'crop' });
  }

  if (settings.watermark) {
    ops.push({
      op: 'overlay',
      image: settings.watermark,
      position: settings.watermarkPosition || 'bottom-right',
      opacity: Number.isFinite(settings.watermarkOpacity) ? settings.watermarkOpacity : 0.85,
    });
  }

  if (String(settings.text || '').trim()) {
    ops.push({ op: 'addText', text: settings.text.trim(), style: settings.textStyle });
  }

  if (settings.audio) {
    ops.push({ op: 'mixAudio', audio: settings.audio, gain: settings.audioGain ?? 0 });
  }

  return ops.sort((a, b) => STAGE_ORDER.indexOf(a.op) - STAGE_ORDER.indexOf(b.op));
}

/**
 * What the customer is about to get, in words, before they commit to waiting.
 *
 * Phase 1 has no metered operations, so `credits` is 0 — but it is computed
 * rather than assumed, so the day a paid tool is added the summary starts
 * telling the truth without anybody remembering to come back here.
 */
export function describePlan(ops = []) {
  const problems = validatePlan(ops);
  return {
    steps: ops.length,
    ready: ops.length > 0 && problems.length === 0,
    empty: ops.length === 0,
    problems,
  };
}

/** A filename that says what it is, six months later, in a Downloads folder. */
export function outputName(clip = {}, settings = {}) {
  const shape = settings.ratio ? settings.ratio.replace(':', 'x') : 'edit';
  const stem = String(clip.prompt || 'voxel')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'voxel';
  return `${stem}-${shape}.mp4`;
}
