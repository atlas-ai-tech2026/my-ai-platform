// ─── edit-permissions.js ─────────────────────────────────────────────────────
// What the assistant may do WITHOUT asking.
//
// ChatCut has this and their defaults are exactly right: the free local thing
// is on, and both of the things that call a paid model are off. It is the most
// important control in their whole settings panel and it is easy to mistake
// for a preference. It is not a preference — it decides whether software can
// spend a customer's money while they are looking somewhere else.
//
// ── THE RULE, AND WHY IT IS SHAPED THIS WAY ────────────────────────────────
// Voxel already separates FREE from METERED in edit-ops.js: cutting, trimming,
// resizing and rearranging call no model and cost nothing, while generating
// music, a voice-over, an upscale or a remade shot all bill. That line is
// where this gate sits. It is not a new concept, it is a switch on one that
// already exists.
//
// A HUMAN CLICKING A BUTTON IS ALWAYS ALLOWED. They clicked it, the price was
// on it, and asking twice is the kind of confirmation people learn to dismiss
// without reading. This governs the ASSISTANT only — the one actor that can
// decide to spend on its own.
//
// ── WHAT IS AND IS NOT GUARDED TODAY, STATED PLAINLY ───────────────────────
// Nothing in the agent's current vocabulary is metered — every command it can
// issue is a local timeline edit. So today this is a GUARANTEE rather than a
// restriction: the moment a metered command is added, it is refused by default
// instead of being allowed by omission. That is the whole point of building
// the gate before the thing it gates, rather than after.

import { OPERATIONS, FREE, METERED } from './edit-ops';

export const PERMISSION_KEY = 'voxel-edit-cut:auto-allow';

/**
 * The categories a customer decides about, and their defaults.
 *
 * Grouped by WHAT IT SPENDS, not by which model does it. "Video generation"
 * is a thing somebody has an opinion about; "omniEdit versus generativeResize"
 * is not, and offering both would be asking them to police an implementation.
 */
export const CATEGORIES = {
  localEdits: {
    label: 'Editing',
    hint: 'Cut, trim, resize, reorder, speed. Calls no model and costs nothing.',
    // ON by default. Refusing free local edits would make the assistant
    // useless while protecting nobody from anything.
    default: true,
    billing: FREE,
  },
  videoGeneration: {
    label: 'Video generation',
    hint: 'Remaking a shot, or AI edits inside the frame. Spends credits.',
    default: false,
    billing: METERED,
  },
  imageGeneration: {
    label: 'Image generation',
    hint: 'Upscaling, background removal, smart resize. Spends credits.',
    default: false,
    billing: METERED,
  },
  audioGeneration: {
    label: 'Music and voice',
    hint: 'Composing a track or speaking a script. Spends credits.',
    default: false,
    billing: METERED,
  },
};

export const CATEGORY_IDS = Object.keys(CATEGORIES);

/** Which category an operation from edit-ops.js falls into. */
const KIND_TO_CATEGORY = { video: 'videoGeneration', image: 'imageGeneration', audio: 'audioGeneration' };

export function categoryOf(opName) {
  const spec = OPERATIONS[opName];
  if (!spec) return null;                       // unknown — the caller refuses
  if (spec.billing === FREE) return 'localEdits';
  return KIND_TO_CATEGORY[spec.kind] || 'videoGeneration';
}

/** The safe starting point: free on, everything that bills off. */
export const defaults = () =>
  Object.fromEntries(CATEGORY_IDS.map((id) => [id, CATEGORIES[id].default]));

/**
 * Read what was saved, and refuse to be surprised by it.
 *
 * Anything missing, damaged or unrecognised falls back to the DEFAULT rather
 * than to allowed. A corrupted settings blob must never be the reason
 * something started spending money — that is the failure mode worth designing
 * against, because it is silent and it only shows up on a bill.
 */
export function readPermissions(storage) {
  const base = defaults();
  try {
    const raw = storage?.getItem?.(PERMISSION_KEY);
    if (!raw) return base;
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== 'object') return base;
    for (const id of CATEGORY_IDS) {
      // Strictly true — not truthy. "yes", 1 and {} are not a decision
      // somebody made, they are a file that went wrong.
      if (saved[id] === true) base[id] = true;
      if (saved[id] === false) base[id] = false;
    }
    return base;
  } catch {
    return base;
  }
}

export function writePermissions(storage, permissions) {
  const clean = Object.fromEntries(CATEGORY_IDS.map((id) => [id, permissions?.[id] === true]));
  try { storage?.setItem?.(PERMISSION_KEY, JSON.stringify(clean)); } catch { /* storage off */ }
  return clean;
}

/**
 * May the assistant run this without asking? Returns a REASON when not, so the
 * chat can say what happened instead of the command quietly disappearing.
 *
 * Defaults to refusing. An operation nobody has classified is not a free one,
 * and treating unknown as permitted is how a gate stops being a gate.
 */
export function allows(permissions, opName) {
  const category = categoryOf(opName);
  if (!category) {
    return { ok: false, reason: `I don't know what “${opName}” costs, so I have not run it.` };
  }
  if (permissions?.[category] === true) return { ok: true, category };
  return {
    ok: false,
    category,
    reason: `${CATEGORIES[category].label} is switched off for the assistant, so I have not run it. `
      + 'You can turn it on in the assistant settings, or do it yourself from the panel.',
  };
}

/** True when a set of permissions lets the assistant spend money. Used to show
 *  the warning next to the settings, because "on" reads harmless until
 *  somebody tells you what it means. */
export const canSpend = (permissions) =>
  CATEGORY_IDS.some((id) => CATEGORIES[id].billing === METERED && permissions?.[id] === true);
