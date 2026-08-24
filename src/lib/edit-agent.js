// ─── edit-agent.js ───────────────────────────────────────────────────────────
// The layer between "cut the first three seconds" and the timeline.
//
// This is the ChatCut idea itself, and it is the one part of the editor where
// something that cannot be trusted gets to touch a customer's work. So the
// design is not "let the model edit the project" — it is:
//
//     instruction → COMMANDS → validate → apply → one undo step
//
// The model proposes. It never mutates. Every command is checked against the
// real project before anything is applied, so the worst a bad answer can do is
// get REFUSED WITH A REASON. That is the whole point of this file existing
// instead of the chat calling timeline.js directly.
//
// ── WHY VALIDATION IS NOT OPTIONAL HERE ────────────────────────────────────
// Most of timeline.js is forgiving by design, because a human drags things:
//
//     removeClip  = clips.filter(c => c.id !== clipId)
//     splitClip   = returns the track unchanged if the cut lands on an edge
//
// Ask either of those for a clip that does not exist and you get the project
// back, unchanged, with NO error. For a person clicking a clip they can see,
// that is correct. For a model naming an id it invented, "done" would be a
// lie — the customer is told the edit happened and it did not. Every command
// below therefore states its preconditions and is refused if they do not hold.
//
// ── AND WHY A BATCH IS ALL-OR-NOTHING ──────────────────────────────────────
// "Split at 10s, delete the second half, close the gap" is one instruction. If
// the split works and the delete is refused, the customer is left holding a
// timeline that matches neither what they had nor what they asked for — and
// they have to work out which half happened. A refusal they can read and
// retry is strictly better than a half-edit they have to diagnose.

import {
  splitClip, removeClip, trimClip, moveClip, updateClip,
  closeGap, addTrack, setProjectRatio,
  locateClip, clipDuration, clipEnd, projectDuration, trackGaps,
  MIN_CLIP, TRACK_KINDS, whyNoMoreTracks,
} from './timeline';
import { RATIOS, RESIZE_MODES } from './edit-ops';
import { allows, defaults as defaultPermissions } from './edit-permissions';

/** A runaway guard. No sane instruction needs more edits than this, and a
 *  model that returns 400 commands has misunderstood rather than been
 *  ambitious. */
export const MAX_COMMANDS = 40;

const round = (n) => Math.round(n * 1000) / 1000;
const num = (v) => (typeof v === 'number' && Number.isFinite(v));

/** Find a clip by id anywhere in the project, or null. */
const find = (project, clipId) => {
  const at = locateClip(project, clipId);
  return at ? at.clip : null;
};

/** The track a clip sits on, or null. */
const trackOf = (project, clipId) => {
  const at = locateClip(project, clipId);
  return at ? at.track : null;
};

/**
 * A locked track is the OTHER silent no-op, and the easiest one to miss.
 * splitClip skips locked tracks, closeGap returns the project unchanged, and
 * addClip bails — all without a word. Somebody who locked a track and then
 * asked the agent to cut it would be told the cut happened.
 */
const lockedReason = (project, clipId) => {
  const track = trackOf(project, clipId);
  return track?.locked ? `The ${track.name || track.kind} track is locked — unlock it first.` : null;
};

// ─────────────────────────────────────────────────────────────────────────────
// THE VOCABULARY
//
// Each command declares what it needs (`check`) and what it does (`run`).
// `check` returns a human-readable reason to refuse, or null to proceed — the
// reason is shown to the customer, so it says what was wrong with THEIR
// instruction, not what was wrong with the model's JSON.
// ─────────────────────────────────────────────────────────────────────────────
export const COMMANDS = {
  split: {
    describe: (c) => `Split ${c.clipId} at ${c.at}s`,
    check(project, c) {
      const clip = find(project, c.clipId);
      if (!clip) return `There is no clip called ${c.clipId}.`;
      if (!num(c.at)) return 'Split needs a time in seconds.';
      const locked = lockedReason(project, c.clipId); if (locked) return locked;
      const offset = c.at - clip.start;
      // splitClip silently declines a cut on or past an edge. Say so instead.
      if (offset <= MIN_CLIP || offset >= clipDuration(clip) - MIN_CLIP) {
        return `${c.at}s is not inside that clip — it runs from ${round(clip.start)}s to ${round(clipEnd(clip))}s, and a cut has to land at least a frame inside.`;
      }
      return null;
    },
    run: (project, c) => splitClip(project, c.clipId, c.at),
  },

  /**
   * "Take out everything between 5s and 10s."
   *
   * ── WHY THIS EXISTS AS ONE COMMAND ─────────────────────────────────────
   * It is the most common instruction anybody gives an editor, and until this
   * was added it could not be expressed AT ALL. The obvious spelling is
   * split → split → delete the middle — but the id of the middle piece does
   * not exist until the first split runs, and the model has to write the whole
   * batch before any of it is applied. It cannot name what it has not created.
   *
   * Found by a test asserting the batch could do it. It could not, and the
   * gap was in the vocabulary rather than in the test.
   *
   * `ripple` closes the hole afterwards, which is what "cut this bit out"
   * means to everyone except when they are protecting a beat — one track
   * only, matching closeGap, so removing a hole in the picture never silently
   * slides the music out of sync.
   */
  removeRange: {
    describe: (c) => `Remove ${c.from}s–${c.to}s${c.ripple === false ? ' (leaving a gap)' : ''}`,
    check(project, c) {
      const track = project.tracks?.find((t) => t.id === c.trackId);
      if (!track) return `There is no track called ${c.trackId}.`;
      if (track.locked) return `The ${track.name || track.kind} track is locked — unlock it first.`;
      if (!num(c.from) || !num(c.to)) return 'Removing a range needs a start and an end, in seconds.';
      if (c.to - c.from <= MIN_CLIP) return 'That range is too short to remove.';
      if (c.from < 0) return 'A range cannot start before zero.';
      const touches = track.clips.some((cl) => cl.start < c.to && clipEnd(cl) > c.from);
      if (!touches) return `There is nothing between ${c.from}s and ${c.to}s on that track.`;
      return null;
    },
    run(project, c) {
      let p = project;
      // Cut at both edges first, so a clip crossing a boundary loses only the
      // part inside the range instead of all of it.
      for (const bound of [c.from, c.to]) {
        const track = p.tracks.find((t) => t.id === c.trackId);
        const straddler = track.clips.find(
          (cl) => cl.start < bound - MIN_CLIP && clipEnd(cl) > bound + MIN_CLIP);
        if (straddler) p = splitClip(p, straddler.id, bound);
      }
      const track = p.tracks.find((t) => t.id === c.trackId);
      for (const cl of track.clips.filter(
        (cl) => cl.start >= c.from - 0.001 && clipEnd(cl) <= c.to + 0.001)) {
        p = removeClip(p, cl.id);
      }
      if (c.ripple !== false) {
        // Only if a hole is actually left: nothing after the range means no
        // gap to close, and closeGap would quietly do nothing anyway.
        const after = p.tracks.find((t) => t.id === c.trackId);
        if (trackGaps(after).some((g) => Math.abs(g.start - c.from) < 0.05)) {
          p = closeGap(p, c.trackId, c.from);
        }
      }
      return p;
    },
  },

  delete: {
    describe: (c) => `Delete ${c.clipId}`,
    check: (project, c) => (find(project, c.clipId)
      ? lockedReason(project, c.clipId)
      : `There is no clip called ${c.clipId}.`),
    run: (project, c) => removeClip(project, c.clipId),
  },

  trim: {
    describe: (c) => `Trim ${c.seconds}s off the ${c.edge} of ${c.clipId}`,
    check(project, c) {
      const clip = find(project, c.clipId);
      if (!clip) return `There is no clip called ${c.clipId}.`;
      const locked = lockedReason(project, c.clipId); if (locked) return locked;
      if (c.edge !== 'start' && c.edge !== 'end') return "Trim needs edge 'start' or 'end'.";
      if (!num(c.seconds) || c.seconds === 0) return 'Trim needs a number of seconds.';
      // trimClip clamps rather than refusing, so a request to trim away the
      // whole clip would quietly leave a one-frame sliver. Refuse instead:
      // "it did something, but not what you said" is the failure being avoided.
      if (Math.abs(c.seconds) >= clipDuration(clip) - MIN_CLIP) {
        return `That clip is only ${round(clipDuration(clip))}s long — trimming ${Math.abs(c.seconds)}s would leave nothing. Delete it instead?`;
      }
      return null;
    },
    run: (project, c) => trimClip(project, c.clipId, c.edge, c.edge === 'start' ? c.seconds : -c.seconds),
  },

  move: {
    describe: (c) => `Move ${c.clipId} to ${c.start}s`,
    check(project, c) {
      if (!find(project, c.clipId)) return `There is no clip called ${c.clipId}.`;
      const locked = lockedReason(project, c.clipId); if (locked) return locked;
      if (!num(c.start) || c.start < 0) return 'Move needs a start time of zero or more.';
      return null;
    },
    run: (project, c) => moveClip(project, c.clipId, c.start),
  },

  setSpeed: {
    describe: (c) => `Set ${c.clipId} to ${c.speed}×`,
    check(project, c) {
      if (!find(project, c.clipId)) return `There is no clip called ${c.clipId}.`;
      // 0 would be a still frame of infinite length; negative is not reverse
      // playback, it is a corrupt duration. The ceiling matches what the
      // export's atempo chain can actually hold together.
      if (!num(c.speed) || c.speed <= 0.1 || c.speed > 10) return 'Speed has to be between 0.1× and 10×.';
      return null;
    },
    run: (project, c) => updateClip(project, c.clipId, { speed: c.speed }),
  },

  setVolume: {
    describe: (c) => `Set ${c.clipId} volume to ${Math.round((c.volume ?? 1) * 100)}%`,
    check(project, c) {
      if (!find(project, c.clipId)) return `There is no clip called ${c.clipId}.`;
      if (!num(c.volume) || c.volume < 0 || c.volume > 2) return 'Volume has to be between 0 and 2.';
      return null;
    },
    run: (project, c) => updateClip(project, c.clipId, { volume: c.volume }),
  },

  fade: {
    describe: (c) => `Fade ${c.clipId}`,
    check(project, c) {
      const clip = find(project, c.clipId);
      if (!clip) return `There is no clip called ${c.clipId}.`;
      const fin = c.in ?? 0, fout = c.out ?? 0;
      if (!num(fin) || !num(fout) || fin < 0 || fout < 0) return 'A fade cannot be negative.';
      if (fin + fout > clipDuration(clip)) {
        return `Those fades add up to longer than the clip (${round(clipDuration(clip))}s).`;
      }
      return null;
    },
    run: (project, c) => updateClip(project, c.clipId, { fadeIn: c.in ?? 0, fadeOut: c.out ?? 0 }),
  },

  rename: {
    describe: (c) => `Rename ${c.clipId} to "${c.name}"`,
    check(project, c) {
      if (!find(project, c.clipId)) return `There is no clip called ${c.clipId}.`;
      if (!c.name || !String(c.name).trim()) return 'A name cannot be empty.';
      return null;
    },
    run: (project, c) => updateClip(project, c.clipId, { name: String(c.name).trim().slice(0, 80) }),
  },

  closeGap: {
    describe: (c) => `Close the gap at ${c.at}s`,
    check(project, c) {
      const track = project.tracks?.find((t) => t.id === c.trackId);
      if (!track) return `There is no track called ${c.trackId}.`;
      if (track.locked) return `The ${track.name || track.kind} track is locked — unlock it first.`;
      if (!num(c.at)) return 'Closing a gap needs the time it starts at.';
      const gaps = trackGaps(track);
      if (!gaps.some((g) => Math.abs(g.start - c.at) < 0.05)) {
        return `There is no gap at ${c.at}s on that track.`;
      }
      return null;
    },
    run: (project, c) => closeGap(project, c.trackId, c.at),
  },

  setRatio: {
    describe: (c) => `Set the frame to ${c.ratio}${c.mode ? ` (${c.mode})` : ''}`,
    check(project, c) {
      if (!RATIOS[c.ratio]) return `${c.ratio} is not one of the shapes: ${Object.keys(RATIOS).join(', ')}.`;
      if (c.mode && !RESIZE_MODES.includes(c.mode)) return `${c.mode} is not one of: ${RESIZE_MODES.join(', ')}.`;
      if (c.ratio === project.ratio && (!c.mode || c.mode === project.resizeMode)) {
        return `The project is already ${c.ratio}.`;
      }
      return null;
    },
    run: (project, c) => setProjectRatio(project, c.ratio, c.mode),
  },

  addTrack: {
    describe: (c) => `Add a ${c.kind} layer`,
    // The SAME rule the + row uses — three of a kind, checked by the one
    // function, so the agent and the button can never disagree about the
    // limit or word it differently.
    check: (project, c) => whyNoMoreTracks(project, c.kind),
    run: (project, c) => addTrack(project, c.kind, c.name),
  },
};

export const COMMAND_NAMES = Object.keys(COMMANDS);

/**
 * Apply a batch of commands, all or nothing.
 *
 * Each command is checked against the project AS IT STANDS AFTER the previous
 * one, because "split at 10s then delete the right half" is a real and normal
 * instruction — the second command refers to a clip the first one created.
 * Validating everything up-front against the original would refuse it.
 *
 * If any command is refused, NOTHING is applied and the original project comes
 * back untouched. The working copy is thrown away.
 *
 * Returns { project, ok, applied, error } — `applied` is the human-readable
 * list to show in the chat, so the customer can see what actually happened
 * rather than trusting that it did.
 */
/**
 * The edit-ops operation a command spends on, or null when it spends nothing.
 *
 * Every command in the vocabulary today is a local timeline edit and returns
 * null. The field exists so that the FIRST metered command anybody adds is
 * gated by construction rather than by whoever adds it remembering to ask.
 * That ordering is the whole reason this was built before it was needed.
 */
export const costsOf = (command) => COMMANDS[command?.op]?.costs || null;

export function applyCommands(project, commands, { permissions = defaultPermissions() } = {}) {
  if (!Array.isArray(commands) || commands.length === 0) {
    return { project, ok: false, applied: [], error: 'There was nothing to do.' };
  }
  if (commands.length > MAX_COMMANDS) {
    return {
      project, ok: false, applied: [],
      error: `That came back as ${commands.length} separate edits, which is more than this will apply at once. Try asking for one change at a time.`,
    };
  }

  let working = project;
  const applied = [];

  for (let i = 0; i < commands.length; i++) {
    const c = commands[i];
    const spec = c && COMMANDS[c.op];

    if (!spec) {
      // Named, never silently skipped — an ignored command is an edit the
      // customer thinks happened.
      return {
        project, ok: false, applied: [],
        error: `I don't know how to "${c?.op ?? 'do that'}". Nothing was changed.`,
      };
    }

    // ── MAY IT SPEND? ────────────────────────────────────────────────────
    // Checked BEFORE the command's own preconditions, deliberately: telling
    // somebody their clip id was wrong, when the real answer is that the
    // assistant is not allowed to spend money at all, sends them off fixing
    // the wrong thing.
    if (spec.costs) {
      const permitted = allows(permissions, spec.costs);
      if (!permitted.ok) {
        const prefix = commands.length > 1 ? `Step ${i + 1} of ${commands.length}: ` : '';
        return { project, ok: false, applied: [], error: `${prefix}${permitted.reason}` };
      }
    }

    const why = spec.check(working, c);
    if (why) {
      const prefix = commands.length > 1 ? `Step ${i + 1} of ${commands.length}: ` : '';
      return { project, ok: false, applied: [], error: `${prefix}${why} Nothing was changed.` };
    }

    working = spec.run(working, c);
    applied.push(spec.describe(c));
  }

  return { project: working, ok: true, applied, error: null };
}

/**
 * What the agent is shown.
 *
 * Compact on purpose: the whole project as JSON would be mostly source urls
 * and base64-adjacent noise, it costs tokens on every message, and none of it
 * helps decide where to cut. Ids are included because they are how a command
 * refers back to something, and times are rounded because a model does not
 * need microseconds to find the third clip.
 */
export function summarise(project) {
  if (!project) return { duration: 0, ratio: null, tracks: [] };
  return {
    duration: round(projectDuration(project)),
    ratio: project.ratio,
    resizeMode: project.resizeMode,
    tracks: (project.tracks || []).map((t) => ({
      id: t.id,
      kind: t.kind,
      name: t.name,
      locked: t.locked || undefined,
      gaps: trackGaps(t).map((g) => ({ start: round(g.start), end: round(g.end) })),
      clips: (t.clips || []).map((c) => ({
        id: c.id,
        name: c.name || undefined,
        start: round(c.start),
        end: round(clipEnd(c)),
        duration: round(clipDuration(c)),
        speed: c.speed && c.speed !== 1 ? c.speed : undefined,
        // The prompt is what makes a shot findable by description — "the
        // castle one" only works if the agent can see it. Truncated because
        // a generation prompt can run to a paragraph.
        prompt: project.sources?.[c.sourceId]?.prompt?.slice(0, 120) || undefined,
      })),
    })),
  };
}

/**
 * The shape the model must answer in.
 *
 * Exported rather than written inline at the call site so the vocabulary and
 * the schema cannot drift apart — a command added above without a schema entry
 * is one the model will never be told about, which looks like the feature
 * quietly not working.
 */
export const RESPONSE_SCHEMA = {
  type: 'object',
  required: ['reply'],
  properties: {
    reply: { type: 'string', description: 'One short sentence to the customer, in their language.' },
    commands: {
      type: 'array',
      items: {
        type: 'object',
        required: ['op'],
        properties: {
          op: { type: 'string', enum: COMMAND_NAMES },
          clipId: { type: 'string' },
          trackId: { type: 'string' },
          at: { type: 'number' }, start: { type: 'number' }, seconds: { type: 'number' },
          from: { type: 'number' }, to: { type: 'number' }, ripple: { type: 'boolean' },
          edge: { type: 'string', enum: ['start', 'end'] },
          speed: { type: 'number' }, volume: { type: 'number' },
          in: { type: 'number' }, out: { type: 'number' },
          ratio: { type: 'string', enum: Object.keys(RATIOS) },
          mode: { type: 'string', enum: RESIZE_MODES },
          kind: { type: 'string', enum: TRACK_KINDS },
          name: { type: 'string' },
        },
      },
    },
  },
};

/**
 * Read a model's answer without trusting any of it.
 *
 * Returns { reply, commands } with commands ALWAYS an array. A model that
 * answers with prose, with markdown around its JSON, or with nothing at all
 * is a normal Tuesday — none of those should throw inside a chat panel.
 */
export function parseAgentReply(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return {
      reply: typeof raw.reply === 'string' ? raw.reply : '',
      commands: Array.isArray(raw.commands) ? raw.commands : [],
    };
  }
  if (typeof raw !== 'string') return { reply: '', commands: [] };

  // Models fence JSON in ```json blocks more often than not.
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : raw).trim();
  try {
    return parseAgentReply(JSON.parse(body));
  } catch {
    // Not JSON at all — treat the whole thing as something to say, and do
    // nothing to the timeline. Silence would be worse: the customer typed
    // something and deserves an answer even when it is not an edit.
    return { reply: raw.trim(), commands: [] };
  }
}
