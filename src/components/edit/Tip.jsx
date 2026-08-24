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
// ── THE THREE THINGS THIS HAS TO GET RIGHT ─────────────────────────────────
// 1. NEVER BLOCK THE CLICK. A tooltip that appears under the cursor and eats
//    the pointer makes the button it is describing unusable. pointer-events
//    are off, always.
// 2. SHOW ON KEYBOARD FOCUS TOO, or the label exists only for people using a
//    mouse — and the aria-label alone is not visible to a sighted person
//    tabbing through.
// 3. NOT WRAP. A two-word label broken across three lines in a 40px box is
//    worse than no label.
//
// CSS-only, driven by group-hover/group-focus. No JavaScript, no timers, no
// state — so it cannot get stuck open when a button unmounts mid-hover, which
// is the classic failure of hand-rolled tooltips.

import React from 'react';

/**
 * @param {string} label  what the icon does — include the shortcut in it
 * @param {'top'|'bottom'} side  'bottom' for anything in the top bar, or the
 *                               tip is drawn off the top of the window
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
  if (!label) return children;
  return (
    <span className={`relative group/tip ${fill ? 'flex w-full h-full' : 'inline-flex'} ${className}`}>
      {children}
      <span
        role="tooltip"
        data-testid="tip"
        // aria-hidden because the control itself carries an aria-label; a
        // screen reader announcing both would say the same words twice.
        aria-hidden="true"
        className={`pointer-events-none absolute left-1/2 -translate-x-1/2 z-50
          whitespace-nowrap rounded-md bg-neutral-900 px-2 py-1
          text-[11px] font-medium text-white shadow-lg ring-1 ring-white/10
          opacity-0 group-hover/tip:opacity-100 group-focus-within/tip:opacity-100
          transition-opacity duration-100
          ${side === 'bottom' ? 'top-full mt-1.5' : 'bottom-full mb-1.5'}`}
      >
        {label}
      </span>
    </span>
  );
}
