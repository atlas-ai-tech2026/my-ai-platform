// ─── timeline-history.js ─────────────────────────────────────────────────────
// Undo and redo for the project document.
//
// ── WHY THIS COMES BEFORE THE UI ───────────────────────────────────────────
// Undo cannot be added to an editor afterwards. Every operation has to hand its
// result to the history at the moment it happens, and a UI written without that
// habit has a hundred places that quietly change state without recording it.
// Retrofitting means finding all hundred. So the history exists first, and the
// UI is written into it.
//
// ── THE THING THAT MAKES UNDO USABLE OR USELESS ────────────────────────────
// Dragging a clip fires a change on every mouse move — two hundred of them for
// one gesture. Recorded naively, the customer drags a clip once and then presses
// Cmd+Z two hundred times to get back. That is not a small annoyance; it makes
// undo worthless, and undo is the feature that lets people experiment at all.
//
// So a commit can carry a COALESCE KEY. Consecutive commits sharing that key
// replace each other instead of stacking: one drag, one undo step.
//
// Coalescing by a key rather than by a timer is deliberate. A 300ms window
// merges two deliberate edits made quickly and splits one slow drag — the
// behaviour depends on how fast somebody moves their hand, which is not a rule
// anyone can hold in their head. The gesture knows when it starts and ends; it
// says so.
//
// ── WHY WHOLE SNAPSHOTS AND NOT A DIFF ─────────────────────────────────────
// The document is small — tracks, clips, numbers — and every operation in
// timeline.js already returns a new object without mutating the old one. That
// makes snapshots nearly free: unchanged tracks are the SAME objects, shared by
// reference, so a hundred steps of history do not cost a hundred documents.
//
// A diff/inverse-operation scheme is smaller still, and every operation has to
// implement its own inverse correctly. One wrong inverse corrupts the document
// silently in a way that only appears several undos later. Not worth it at this
// size.

/** Beyond this, the oldest step is dropped. Deep enough to recover a session. */
export const MAX_STEPS = 100;

export function createHistory(present) {
  return { past: [], present, future: [], lastKey: null };
}

export const canUndo = (h) => h.past.length > 0;
export const canRedo = (h) => h.future.length > 0;

/**
 * Record a new state.
 *
 * `coalesce` is a key identifying the gesture — 'move:c3', 'trim:c7:start'.
 * Consecutive commits with the SAME key replace the present rather than pushing
 * a step, so a drag is one undo. Pass nothing for a discrete action.
 *
 * A commit that changes nothing is IGNORED. Without that, clicking a clip
 * without moving it leaves a dead step, and the customer presses undo and
 * watches nothing happen — which reads as undo being broken.
 */
export function commit(history, next, { coalesce = null } = {}) {
  if (next === history.present) return history;

  if (coalesce && coalesce === history.lastKey) {
    // Same gesture still running: replace the present, do not deepen the stack.
    return { ...history, present: next, future: [] };
  }

  const past = [...history.past, history.present];
  return {
    past: past.length > MAX_STEPS ? past.slice(past.length - MAX_STEPS) : past,
    present: next,
    // A new action makes the redo branch unreachable. Keeping it would let
    // redo jump to a state that never followed from what is on screen.
    future: [],
    lastKey: coalesce,
  };
}

/** Explicitly end a gesture, so the next commit starts a fresh step. */
export const endGesture = (history) => ({ ...history, lastKey: null });

export function undo(history) {
  if (!canUndo(history)) return history;
  const previous = history.past[history.past.length - 1];
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
    // Undo always closes the gesture. Otherwise the next drag would coalesce
    // INTO the state we just undid to, and quietly destroy the redo branch.
    lastKey: null,
  };
}

export function redo(history) {
  if (!canRedo(history)) return history;
  const [next, ...rest] = history.future;
  return {
    past: [...history.past, history.present],
    present: next,
    future: rest,
    lastKey: null,
  };
}

/**
 * How deep the history goes — for the UI to grey out its buttons, and for a
 * test to prove the cap holds.
 */
export const depth = (h) => ({ undo: h.past.length, redo: h.future.length });
