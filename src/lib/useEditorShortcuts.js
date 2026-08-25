// ─── useEditorShortcuts.js ───────────────────────────────────────────────────
// The keyboard. This is the difference between an editor somebody tries and an
// editor somebody uses.
//
// ── WHY J / K / L SPECIFICALLY ─────────────────────────────────────────────
// Every editor alive has this in their hands: J back, K stop, L forward, and
// pressing L again goes faster. It has been the same since tape, through Avid,
// Premiere and Resolve. It is not a preference — a professional sits down, puts
// three fingers there without looking, and learns in one second whether this is
// a real tool.
//
// ── THE BUG EVERY EDITOR SHIPS ONCE ────────────────────────────────────────
// Typing a clip name, pressing "c", and watching the timeline split. Shortcuts
// fire while the customer is typing because the handler is on window and never
// asks where the keystroke came from. It is infuriating, it destroys work, and
// it is three lines to prevent — so it is prevented here, in one place, rather
// than remembered at each call site.
//
// contentEditable counts too: the agent chat in Stage 3 will be one, and it
// would otherwise be silently unusable.

import { useCallback, useEffect, useRef } from 'react';

/** How many times L (or J) has been pressed → playback rate. Tape speeds. */
export const SHUTTLE_RATES = [1, 2, 4, 8];

/** One frame at 24fps — the smallest step anybody can perceive. */
export const FRAME = 1 / 24;

const isTyping = (el) => {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;

  // Two ways of asking, because neither alone is enough.
  //
  // `isContentEditable` is the property browsers compute — but jsdom does not
  // implement it, so a test asserting this guard would pass in CI and the guard
  // would still be broken. A guard proven only where it cannot fail is not
  // proven.
  //
  // `closest('[contenteditable]')` also catches a keystroke landing on a CHILD
  // inside an editable region — a <b> inside the agent chat is not itself
  // contentEditable, and typing "c" in bold text must not split the timeline.
  if (el.isContentEditable) return true;
  return typeof el.closest === 'function'
    && Boolean(el.closest('[contenteditable]:not([contenteditable="false"])'));
};

/**
 * @param {object} handlers  every one optional; a missing one means that key
 *                           simply does nothing rather than throwing
 * @param {boolean} enabled  false unmounts the listener entirely — a modal or
 *                           a different tab must not be driving the timeline
 */
export function useEditorShortcuts(handlers = {}, { enabled = true } = {}) {
  const ref = useRef(handlers);
  ref.current = handlers;

  // Shuttle position survives between keystrokes but is NOT state: it changes
  // on every press and nothing renders from it directly.
  const shuttle = useRef({ dir: 0, step: 0 });

  const onKey = useCallback((e) => {
    // ── THE GUARD, FIRST, BEFORE ANYTHING ELSE ──────────────────────────
    if (isTyping(e.target)) return;

    const h = ref.current;
    const mod = e.metaKey || e.ctrlKey;

    // Undo/redo before the single-letter keys, or Cmd+Z would also fire "z".
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      (e.shiftKey ? h.onRedo : h.onUndo)?.();
      return;
    }
    // ⌘− and ⌘= zoom the TIMELINE, not the page. Same keys ChatCut uses, and
    // the same ones every editor reaches for. preventDefault matters: without
    // it the browser zooms the whole interface instead, which is jarring and
    // hard to undo.
    if (mod && (e.key === '-' || e.key === '_')) { e.preventDefault(); h.onZoomOut?.(); return; }
    if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); h.onZoomIn?.(); return; }
    if (mod) return;   // leave every other browser shortcut alone

    switch (e.key) {
      case ' ':
        e.preventDefault();          // or the page scrolls under the editor
        shuttle.current = { dir: 0, step: 0 };
        h.onTogglePlay?.();
        break;

      // ── J / K / L ────────────────────────────────────────────────────
      case 'l': case 'L': {
        const s = shuttle.current;
        // Pressing L while already going forward speeds up. Pressing it while
        // going BACKWARD returns to 1x forward first — matching every NLE, and
        // the thing that would feel wrong if it jumped straight to 4x.
        s.step = s.dir === 1 ? Math.min(s.step + 1, SHUTTLE_RATES.length - 1) : 0;
        s.dir = 1;
        h.onShuttle?.(SHUTTLE_RATES[s.step]);
        break;
      }
      case 'j': case 'J': {
        const s = shuttle.current;
        s.step = s.dir === -1 ? Math.min(s.step + 1, SHUTTLE_RATES.length - 1) : 0;
        s.dir = -1;
        h.onShuttle?.(-SHUTTLE_RATES[s.step]);
        break;
      }
      case 'k': case 'K':
        shuttle.current = { dir: 0, step: 0 };
        h.onShuttle?.(0);
        break;

      case 'c': case 'C':
        h.onSplit?.();
        break;
      case '`':
        // Give the picture the room, and give it back. Backtick because that
        // is what ChatCut binds fullscreen to — an editor who has used one
        // reaches for the same key, and it costs nothing to be where they
        // expect.
        e.preventDefault();
        h.onFocusViewer?.();
        break;

      // ── TOOL MODES ───────────────────────────────────────────────────
      // V / N / B, exactly as ChatCut labels them: Selection Mode (V), Trim
      // Edit Mode (N), Blade Edit Mode (B). Premiere uses V and B for the
      // same two, so this is not one product's convention — it is the
      // convention. An editor's hand already knows these.
      case 'z': case 'Z':
        // ⇧Z fits the whole project on screen. Plain Z is left alone — it is
        // undo's neighbour and too easy to hit by accident.
        if (e.shiftKey) { e.preventDefault(); h.onZoomFit?.(); }
        break;

      case 'v': case 'V':
        h.onTool?.('select');
        break;
      case 'n': case 'N':
        h.onTool?.('trim');
        break;
      case 'b': case 'B':
        h.onTool?.('blade');
        break;

      case 's': case 'S':
        // Snapping. Bound to S because that is what every NLE uses and what
        // ChatCut's own tooltip says — matching a binding an editor already
        // has in their hands costs nothing and saves teaching it.
        h.onToggleSnap?.();
        break;
      case 'i': case 'I':
        h.onMarkIn?.();
        break;
      case 'o': case 'O':
        h.onMarkOut?.();
        break;

      case 'ArrowLeft':
        e.preventDefault();
        h.onStep?.(e.shiftKey ? -1 : -FRAME);
        break;
      case 'ArrowRight':
        e.preventDefault();
        h.onStep?.(e.shiftKey ? 1 : FRAME);
        break;

      case 'Home':
        e.preventDefault();
        h.onGoTo?.('start');
        break;
      case 'End':
        e.preventDefault();
        h.onGoTo?.('end');
        break;

      case 'Delete': case 'Backspace':
        // preventDefault matters on Backspace: in some browsers it still
        // navigates back, and losing the whole project to a stray keystroke is
        // not something an undo stack can help with.
        e.preventDefault();
        h.onDelete?.();
        break;

      default:
        break;
    }
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, onKey]);
}

/** What to show in a help panel — one list, so the panel cannot drift from
 *  the handler above by documenting a key that does nothing. */
export const SHORTCUTS = [
  ['Space', 'Play / pause'],
  ['J · K · L', 'Shuttle back · stop · forward (press again to speed up)'],
  ['C', 'Split at the playhead'],
  ['V · N · B', 'Select · trim · blade'],
  ['S', 'Snapping on / off'],
  ['⌘− ⌘=', 'Zoom the timeline'],
  ['⇧Z', 'Fit the whole project on screen'],
  ['`', 'Big picture — hide the side panels'],
  ['I · O', 'Mark in · mark out'],
  ['← →', 'One frame'],
  ['⇧ ← →', 'One second'],
  ['Home · End', 'Start · end'],
  ['Delete', 'Remove the selected clip'],
  ['⌘Z · ⇧⌘Z', 'Undo · redo'],
];
