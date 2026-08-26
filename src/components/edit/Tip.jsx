// ─── Tip.jsx ─────────────────────────────────────────────────────────────────
// The name of the icon, when you point at it.
//
// ── WHY NOT THE NATIVE `title` ATTRIBUTE ───────────────────────────────────
// Because it is too slow to be a label. The browser waits about a second and a
// half before showing it, which is long enough that anyone scanning a toolbar
// has already moved on and concluded the icon is unlabelled. It also cannot be
// styled, so it arrives as a pale system box that does not belong to the app.
//
// An icon toolbar without fast labels is a memory test. ChatCut's are instant
// and styled, and that is a large part of why theirs reads as learnable — you
// can sweep the row and read it.
//
// ── WHY THIS IS NOT CSS-ONLY ANY MORE ──────────────────────────────────────
// It was, and it looked correct in every source review. Measured in a real
// browser on 2026-08-26: **42 of 68 tooltips were cropped to nothing.**
//
//   "Vertical 9:16 and cut to 30 seconds…"  bubble at x=-201, 581px wide,
//                                            inside a 340px panel
//   "Hide the assistant"                     bubble at y=90, inside a box
//                                            that starts at y=112
//
// An absolutely-positioned element cannot escape an ancestor with
// `overflow: hidden`, and this editor is built from panels that all have it —
// the left assistant column, the library, the timeline. The label was present,
// at opacity 1, with the right text, and physically sliced off. No amount of
// z-index fixes that; the earlier z-50 → z-60 change fixed a DIFFERENT bug
// (the site nav) and left these forty-two exactly as they were.
//
// So the bubble is now PORTALLED to <body> and positioned `fixed`. That is the
// only way out of a clipping ancestor. Radix Tooltip is already a dependency
// and does this properly, but adopting it means putting `asChild` on 68 call
// sites — every one of which must forward a ref — plus a Provider at the app
// root, and its 700ms open delay is the precise thing the note above argues
// against. The wrapper element and the props here are unchanged, so all 68
// call sites and their layout stay exactly as they were.
//
// ── WHAT THIS STILL HAS TO GET RIGHT ───────────────────────────────────────
// 1. NEVER BLOCK THE CLICK. pointer-events are off, always.
// 2. SHOW ON KEYBOARD FOCUS TOO, or the label exists only for mouse users.
// 3. NEVER GET STUCK OPEN. The bubble is a React child of this component even
//    though it paints elsewhere, so a button that unmounts mid-hover takes its
//    tooltip with it. Fixed coordinates also go stale the moment anything
//    scrolls, so scroll and resize close it.
// 4. STAY ON SCREEN. It flips to the other side when there is no room, and is
//    clamped horizontally — that is what makes the x=-201 case impossible now,
//    and it means `side` is a preference rather than something every caller in
//    the header row has to remember.
//
// ── THE LESSON, WRITTEN DOWN ───────────────────────────────────────────────
// The owner reported "no description when I put the mouse on it" TWICE. Both
// times I checked that the labels existed — they did, all 68 of them — and
// both times that was the wrong question. A source scan cannot see a clipping
// ancestor or a stacking context. It took measuring bubbles against their
// containers in a real browser. CLAUDE.md RULE 2: verify the EFFECT.

import React, { useState, useRef, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

const GAP = 6;     // between the icon and the bubble
const EDGE = 8;    // smallest gap to the window edge

/**
 * Where the bubble goes. Pure, and exported, because this is the part that was
 * actually wrong — a bubble 581px wide starting at x=-201 — and a component
 * that only positions things inside a layout effect cannot be tested for it
 * (jsdom reports every rect as zero).
 *
 * @param anchor  {cx, top, bottom} of the control, viewport coordinates
 * @param size    {width, height} of the bubble, once measured
 * @param view    {vw, vh}
 * @param side    preferred side; flipped when there is no room
 */
export function placeTip(anchor, size, view, side = 'top') {
  const { cx, top, bottom } = anchor;
  const { width, height } = size;
  const { vw, vh } = view;

  let place = side;
  if (place === 'top' && top - height - GAP < EDGE) place = 'bottom';
  if (place === 'bottom' && bottom + height + GAP > vh - EDGE) place = 'top';

  return {
    placement: place,
    // Clamped both ways. Math.max LAST so that a bubble wider than the window
    // pins to the left edge rather than to a negative right-clamp.
    left: Math.max(EDGE, Math.min(cx - width / 2, vw - width - EDGE)),
    top: place === 'top' ? top - height - GAP : bottom + GAP,
  };
}

/**
 * @param {string} label  what the icon does — include the shortcut in it
 * @param {'top'|'bottom'} side  preferred side. It flips automatically when
 *   there is no room, so this is a hint rather than a requirement.
 * @param {boolean} fill  the wrapper must FILL its slot rather than hug its
 *   content. Needed wherever a Tip wraps something that is itself a layout
 *   box — a grid cell, a card. Without it the wrapper is inline-flex and
 *   shrink-to-fit, and the thing inside collapses to its own content width.
 *
 *   ── FOUND THE HARD WAY, 2026-08-23 ─────────────────────────────────────
 *   Wrapping the "New project" tile in a Tip made it about a third of the
 *   width of every other card, because the wrapper — not the card — became
 *   the grid item. The owner spotted it in a screenshot within minutes.
 *   Tooltips are for controls; when one has to wrap a BOX, it must be told.
 */
export default function Tip({ label, side = 'top', children, className = '', fill = false }) {
  const hostRef = useRef(null);
  const bubbleRef = useRef(null);
  // null = closed. The bubble only exists in the tree while it is open, which
  // is what ties its lifetime to the trigger's.
  const [at, setAt] = useState(null);

  const open = useCallback(() => {
    const el = hostRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // First pass: anchor only. Real coordinates need the bubble measured, and
    // it does not exist yet — so it is rendered hidden for one frame below.
    setAt({ cx: r.left + r.width / 2, top: r.top, bottom: r.bottom, placed: false });
  }, []);

  const close = useCallback(() => setAt(null), []);

  // Second pass, before paint: measure the bubble and put it somewhere legible.
  useLayoutEffect(() => {
    if (!at || at.placed) return;
    const b = bubbleRef.current;
    if (!b) return;
    const { width, height } = b.getBoundingClientRect();
    const spot = placeTip(
      at,
      { width, height },
      { vw: window.innerWidth, vh: window.innerHeight },
      side,
    );
    setAt({ ...at, placed: true, left: spot.left, top: spot.top });
  }, [at, side]);

  // Fixed coordinates are a snapshot. The timeline and both side panels scroll,
  // so a bubble left open across a scroll would sit somewhere meaningless.
  useLayoutEffect(() => {
    if (!at) return undefined;
    // capture:true — these fire on the inner scrollers, which do not bubble.
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [at, close]);

  if (!label) return children;

  return (
    <span
      ref={hostRef}
      className={`relative group/tip ${fill ? 'flex w-full h-full' : 'inline-flex'} ${className}`}
      onMouseEnter={open}
      onMouseLeave={close}
      // React's onFocus/onBlur are focusin/focusout — they bubble, so the
      // button inside triggers these without needing a handler of its own.
      onFocus={open}
      onBlur={close}
    >
      {children}
      {at && createPortal(
        <span
          ref={bubbleRef}
          role="tooltip"
          data-testid="tip"
          // aria-hidden because the control itself carries an aria-label; a
          // screen reader announcing both would say the same words twice.
          aria-hidden="true"
          style={{
            position: 'fixed',
            // ── MEASURED AT THE ORIGIN, NOT AT THE ANCHOR ────────────────
            // A fixed element's containing block is the VIEWPORT, so its
            // shrink-to-fit width is limited by the room to the right of
            // wherever it sits. Measuring at the anchor meant an icon near
            // the right edge — "Fit the whole project on screen" at x=1418
            // of 1440 — had 22px to lay out in, so it wrapped into a narrow
            // 5-line column and the clamp then faithfully placed THAT.
            //
            // At left:0 it gets the whole width and max-width does the
            // capping, which is what max-width is for. Seen on dev, on a
            // right-hand icon; every icon I checked locally was on the left
            // and had room to spare, so it measured correctly and looked fine.
            left: at.placed ? at.left : 0,
            top: at.placed ? at.top : 0,
            // Hidden for the one frame before it has been measured, so nobody
            // sees it flash at the wrong place.
            visibility: at.placed ? 'visible' : 'hidden',
            zIndex: 60,
          }}
          className="pointer-events-none max-w-[min(20rem,calc(100vw-1rem))]
            rounded-md bg-neutral-900 px-2 py-1
            text-[11px] font-medium leading-snug text-white shadow-lg ring-1 ring-white/10"
        >
          {label}
        </span>,
        document.body,
      )}
    </span>
  );
}
