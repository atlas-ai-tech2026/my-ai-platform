// ─── edit-presets.js ─────────────────────────────────────────────────────────
// One click, several steps — the shapes a workshop attendee actually asks for.
//
// ── WHO THESE ARE FOR ──────────────────────────────────────────────────────
// Everything else in this editor makes it better for somebody who already
// knows what they are doing. A preset is for the person who has just been
// handed a link in a workshop, opens the editor, and does not know what to do
// next. That is the majority of the people this product is for.
//
// ── DELIBERATE: THESE ARE NOT CHAT PROMPTS ─────────────────────────────────
// The assistant already offers "Cut the first 3 seconds" as text you can send.
// A preset is the opposite kind of thing: DETERMINISTIC. It runs with no model,
// no key, no network, no latency and no cost — so it works on a signed-out
// demo, works when the provider is down, does exactly the same thing every
// time, and undoes in one press. A one-click action that sometimes fails and
// sometimes costs money is not a beginner's on-ramp.
//
// ── AND NOT COPIES OF ChatCut's ───────────────────────────────────────────
// Theirs say things like "Talking Head Editing". Ours are the jobs a Voxel
// customer has: they made some clips and need a Reel out of them by lunchtime.
//
// ── A PRESET MUST EARN ITS PLACE ───────────────────────────────────────────
// The viewer header already has a ratio picker. A preset that only sets the
// ratio would be a second control for one thing, which is clutter pretending
// to be help. Each one below does SEVERAL steps — that is the whole point.

import {
  setProjectRatio, projectDuration, clipEnd, removeClip, trimClip,
  createClip, addClip, addTrack,
} from './timeline.js';

const round = (n) => Math.round(n * 1000) / 1000;

/** Plain words for what just happened. Counts, because "shortened" tells
 *  somebody nothing about whether to press ⌘Z. */
function summarise(shape, removed, trimmed) {
  const bits = [shape];
  if (removed) bits.push(`removed ${removed} clip${removed === 1 ? '' : 's'} past the end`);
  if (trimmed) bits.push(`shortened ${trimmed}`);
  return bits.join(' · ');
}

/** Cut everything past `limit`, trimming whatever straddles it.
 *
 *  Clips are removed by ID collected up front — mutating a list while walking
 *  it is how the second clip of a pair survives a delete. */
function cutTo(project, limit) {
  let next = project;
  const doomed = [];
  let trimmed = 0;

  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if (clip.start >= limit - 0.001) { doomed.push(clip.id); continue; }
      const end = clipEnd(clip);
      if (end > limit) {
        // Straddles the line: keep the part before it.
        //
        // trimClip takes an EDGE and a DELTA, not a target — I wrote
        // `{ end: limit }` first and it would have silently done nothing.
        // The delta is derived rather than guessed:
        //   clipEnd = start + (out - in) / speed
        //   want    start + (out' - in) / speed === limit
        //   so      out' = in + (limit - start) * speed
        const speed = clip.speed || 1;
        const wantOut = clip.in + (limit - clip.start) * speed;
        next = trimClip(next, clip.id, 'end', round(wantOut - clip.out));
        trimmed += 1;
      }
    }
  }
  for (const id of doomed) next = removeClip(next, id);
  // Reported, not silent. Pressing "Make a Reel" on a five-minute project
  // deletes most of it — correctly, and exactly as the card says — but a
  // customer who does not realise how much went is one ⌘Z away from being
  // upset and will not know to press it.
  return { project: next, removed: doomed.length, trimmed };
}

/** A title at the very start, on its own text track. */
function addTitle(project, words) {
  let next = project;
  let track = next.tracks.find((t) => t.kind === 'text' && !t.locked);
  if (!track) {
    next = addTrack(next, 'text');
    track = next.tracks[next.tracks.length - 1];
  }
  const clip = createClip({ kind: 'text', name: words, start: 0, in: 0, out: 3 });
  return addClip(next, track.id, {
    ...clip,
    // Big and central — a title card, not a caption. The customer edits it
    // from there; the point of the preset is that something legible exists
    // rather than that it is finished.
    text: { text: words, size: 0.11, x: 0.5, y: 0.5, align: 'center' },
  });
}

export const PRESETS = [
  {
    id: 'reel',
    label: 'Make a Reel',
    hint: 'Vertical 9:16 and cut to 30 seconds — the shape Instagram and TikTok want',
    steps: ['Vertical 9:16', 'Cut to 30 seconds'],
    check(project) {
      if (!projectDuration(project)) return 'There is nothing on the timeline yet.';
      return null;
    },
    run(project) {
      const { project: next, removed, trimmed } = cutTo(setProjectRatio(project, '9:16', 'crop'), 30);
      return { project: next, did: summarise('Vertical 9:16', removed, trimmed) };
    },
  },
  {
    id: 'square',
    label: 'Make a square post',
    hint: 'Square 1:1 and cut to 60 seconds — for a feed post',
    steps: ['Square 1:1', 'Cut to 60 seconds'],
    check(project) {
      if (!projectDuration(project)) return 'There is nothing on the timeline yet.';
      return null;
    },
    run(project) {
      const { project: next, removed, trimmed } = cutTo(setProjectRatio(project, '1:1', 'crop'), 60);
      return { project: next, did: summarise('Square 1:1', removed, trimmed) };
    },
  },
  {
    id: 'title',
    label: 'Add a title card',
    hint: 'Three seconds of large text at the very start, ready to edit',
    steps: ['A text layer if there is none', 'Three seconds at the start'],
    check(project) {
      if (!projectDuration(project)) return 'There is nothing on the timeline yet.';
      const text = project.tracks.filter((t) => t.kind === 'text');
      // MAX_TRACKS_PER_KIND is 3 and every text track may be locked.
      if (text.length && text.every((t) => t.locked)) return 'Every text layer is locked.';
      return null;
    },
    run(project, { title = 'Your title here' } = {}) {
      return { project: addTitle(project, title), did: 'Added a title card at the start' };
    },
  },
  {
    id: 'widescreen',
    label: 'Back to widescreen',
    hint: 'Return to 16:9 — for YouTube, or a screen in a room',
    steps: ['Widescreen 16:9', 'Fit the whole frame, no crop'],
    check(project) {
      if ((project?.ratio || '16:9') === '16:9' && project?.resizeMode === 'pad') {
        return 'It is already widescreen and uncropped.';
      }
      return null;
    },
    // `pad` on purpose: somebody coming BACK from a vertical crop has already
    // lost the sides once. Padding shows the whole frame again rather than
    // cropping a second time in the other direction.
    run(project) {
      return { project: setProjectRatio(project, '16:9', 'pad'), did: 'Back to widescreen 16:9' };
    },
  },
];

export const presetById = (id) => PRESETS.find((p) => p.id === id) || null;

/**
 * Run one, safely.
 *
 * @returns {{ok:true, project}} or {{ok:false, reason}} — a preset that cannot
 *          run says WHY. A greyed-out card with no explanation is the thing a
 *          beginner cannot get past, and they are exactly who this is for.
 */
export function applyPreset(project, id, options = {}) {
  const preset = presetById(id);
  if (!preset) return { ok: false, reason: 'That is not a preset.' };
  const why = preset.check(project);
  if (why) return { ok: false, reason: why };
  try {
    const out = preset.run(project, options);
    // Every preset returns { project, did } now. Accepting a bare project too
    // would let a future one forget to say what it did and nobody would notice.
    const next = out?.project;
    if (!next?.tracks) return { ok: false, reason: 'That did not work, and the timeline is unchanged.' };
    return { ok: true, project: next, preset, did: out.did || preset.label };
  } catch (err) {
    // Never leave a half-applied project: the caller keeps the one it had.
    return { ok: false, reason: `That did not work: ${err?.message || 'unknown error'}` };
  }
}
