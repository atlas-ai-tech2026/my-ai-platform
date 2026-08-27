// ─── useNearViewport.js ──────────────────────────────────────────────────────
// "Is this card close enough to the screen to be worth building?"
//
// ── WHY VIDEO GRIDS NEED THIS AND IMAGE GRIDS DO NOT ───────────────────────
// `loading="lazy"` exists for <img> and the browser handles it. There is no
// equivalent for <video>: the element is constructed, a decoder is attached,
// and the media pipeline starts the moment it is in the DOM — on screen or a
// thousand pixels below it.
//
// So a customer with twenty finished videos gets twenty decoders running at
// once. After the preload fix the DOWNLOAD is small, but the decoders are
// still there, and that is what makes a laptop's fan spin and the page stop
// responding to scroll. Bandwidth was the loud problem; this is the quiet one
// underneath it.
//
// ── WHAT IT DELIBERATELY DOES NOT DO ───────────────────────────────────────
// It does not unmount when a card scrolls away. Once a tile has been built,
// it stays — tearing it down would make scrolling back up rebuild the decoder
// and flash the poster frame again, which reads as the page being broken.
// The cost this is protecting against is having ALL of them at once, not
// having a few.
//
// ── AND WHY THE MARGIN IS GENEROUS ─────────────────────────────────────────
// 400px, not 0. Waiting until a tile is exactly on screen means the customer
// watches it appear, which is a worse experience than a slightly warm laptop.
// The tile should already be there by the time they scroll to it.

import { useEffect, useRef, useState } from 'react';

/** How far below the fold a tile starts preparing itself. */
export const NEAR_MARGIN_PX = 400;

/**
 * @returns {[React.RefObject, boolean]} attach the ref to the tile; the flag
 *          turns true once and never goes back to false.
 */
export function useNearViewport({ rootMargin = `${NEAR_MARGIN_PX}px` } = {}) {
  const ref = useRef(null);
  // ── SAFE BY DEFAULT WHEN THE OBSERVER IS MISSING ────────────────────────
  // No IntersectionObserver (an old browser, a test environment, a server
  // render) must mean "show everything", never "show nothing". Failing the
  // other way would hide a customer's entire history behind a feature check
  // — the library would look empty rather than slow, and lost work is a far
  // worse bug than a warm laptop.
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined');

  useEffect(() => {
    if (near) return undefined;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setNear(true); return undefined; }

    const io = new IntersectionObserver((entries) => {
      // Once, then stop watching. A tile that has been built stays built.
      if (entries.some((e) => e.isIntersecting)) {
        setNear(true);
        io.disconnect();
      }
    }, { rootMargin });

    io.observe(el);
    return () => io.disconnect();
  }, [near, rootMargin]);

  return [ref, near];
}
