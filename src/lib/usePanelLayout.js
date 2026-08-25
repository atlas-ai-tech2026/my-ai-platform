// ─── usePanelLayout.js ───────────────────────────────────────────────────────
// Give the picture the room, and give it back.
//
// The viewer is where judgement happens — whether a cut lands, whether a shot
// is too dark, whether the timing feels right. Three columns leave it about
// 700px on a 1440px screen, which is small for judging a 1080p frame and worse
// for showing a room.
//
// ── THE DETAIL THAT DECIDES WHETHER THIS IS ANNOYING ───────────────────────
// What happens when you come BACK.
//
// The obvious implementation collapses both panels and then restores both. But
// somebody who works with the shot panel already closed, presses the key to
// look at the picture, and presses it again, has just had a panel opened that
// they deliberately closed. The key quietly rearranged their workspace.
//
// So focus() REMEMBERS what was open and restores exactly that. It is four
// extra lines and it is the difference between a control people use and one
// they try twice.
//
// ── AND WHY IT IS PERSISTED ────────────────────────────────────────────────
// Having to re-collapse every session is precisely what stops anyone bothering.
// A layout preference belongs to the person, not to the page load.

import { useCallback, useEffect, useState } from 'react';

export const LAYOUT_KEY = 'voxel-edit-cut:layout';

/** Both panels open — what a first-time visitor should see. */
const DEFAULT = { left: true, middle: true };

/** Read the saved layout, tolerating anything that is not what we expect.
 *  A corrupt value must open the editor normally rather than blank a panel. */
export function readLayout(storage) {
  try {
    const raw = storage?.getItem(LAYOUT_KEY);
    if (!raw) return { ...DEFAULT };
    const v = JSON.parse(raw);
    return {
      left: typeof v?.left === 'boolean' ? v.left : DEFAULT.left,
      middle: typeof v?.middle === 'boolean' ? v.middle : DEFAULT.middle,
    };
  } catch {
    return { ...DEFAULT };
  }
}

/**
 * @returns {{left, middle, toggleLeft, toggleMiddle, focusViewer, focused}}
 */
export function usePanelLayout({ storage } = {}) {
  const store = storage ?? (typeof window !== 'undefined' ? safeStorage() : null);
  const [panels, setPanels] = useState(() => readLayout(store));
  // What was open before the last focus(), so it can be given back exactly.
  const [restore, setRestore] = useState(null);

  useEffect(() => {
    try { store?.setItem(LAYOUT_KEY, JSON.stringify(panels)); } catch { /* a layout is not worth an error */ }
  }, [panels, store]);

  const toggleLeft = useCallback(() => {
    setRestore(null);          // a manual change makes the remembered state stale
    setPanels((p) => ({ ...p, left: !p.left }));
  }, []);

  const toggleMiddle = useCallback(() => {
    setRestore(null);
    setPanels((p) => ({ ...p, middle: !p.middle }));
  }, []);

  /** Collapse everything for the picture — or put back what was there. */
  const focusViewer = useCallback(() => {
    setPanels((p) => {
      if (!p.left && !p.middle) {
        // Coming back. Restore what was open, or both if we never stored it
        // (someone closed both by hand and then pressed the key).
        const back = restore || { ...DEFAULT };
        setRestore(null);
        return back;
      }
      setRestore(p);
      return { left: false, middle: false };
    });
  }, [restore]);

  return {
    ...panels,
    focused: !panels.left && !panels.middle,
    toggleLeft,
    toggleMiddle,
    focusViewer,
  };
}

/**
 * Is the window wide enough for side-by-side panels? (Tailwind's `lg`.)
 *
 * ── WHY THIS EXISTS AT ALL ─────────────────────────────────────────────────
 * The column widths have to be an INLINE style, and an inline style cannot
 * carry a media query — so the breakpoint has to be answered in JavaScript.
 *
 * The obvious approach was Tailwind classes swapped at runtime. It does not
 * work: Tailwind generates CSS by SCANNING SOURCE for class names, so a class
 * assembled at runtime has no rule behind it. The class landed on the element,
 * the layout did not move, and nothing errored — the worst kind of failure,
 * because everything looks correct in the DOM.
 *
 * Found by measuring the viewer's width before and after collapsing and
 * getting the same number twice.
 */
export function useIsWide(query = '(min-width: 1024px)') {
  const [wide, setWide] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia(query).matches
      : true       // assume desktop when we cannot ask — SSR and jsdom
  ));

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia(query);
    const on = (e) => setWide(e.matches);
    setWide(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, [query]);

  return wide;
}

/** localStorage access THROWS outright when cookies are blocked — the property
 *  read itself, before any call. A layout preference must never be the reason
 *  the editor fails to open. */
function safeStorage() {
  try { return window.localStorage; } catch { return null; }
}
