// ─── Navbar.breakpoint.test.jsx ──────────────────────────────────────────────
// The header may never reach a width where NEITHER the desktop nav NOR the
// hamburger is usable.
//
// ── WHY THIS EXISTS, MEASURED 2026-08-24 ───────────────────────────────────
// The header was `hidden lg:flex` for the nav and `lg:hidden` for the burger.
// Tailwind's lg: is 1024px, so at exactly 1024 the desktop layout switched on
// and the burger switched off — but the desktop layout does not fit in 1024.
//
// Measured in a real browser at 1024px: the nav ended at x=1040 and the
// "Login / Sign Up" group ran from x=1040 to x=1218 — 194px past the edge,
// with the header at overflow-x: visible and the page not scrolling. The
// buttons were not clipped-but-reachable. They were gone.
//
// The 1024 measurement UNDERSTATES the requirement, which is worth spelling
// out because I nearly wrote it down as the answer. At 1024 the nav was
// already being squeezed by flex, so it measured 898px; given room at 1280 it
// takes its natural 919px and the auth group ends at x=1240. So the header
// needs 1240px, not the 1219 the cramped measurement implied. A layout under
// pressure reports the size it was forced into, not the size it wants.
//
// Every iPad in landscape falls in that dead band: 1080 (iPad), 1180 (Air,
// 10.9"), 1194 (Pro 11"). On all of them a visitor could not sign in or sign
// up, and had no menu button to fall back to. The owner asked for exactly
// this — "not only for the mobile eleven inches, for all sizes, like tablets,
// like iPads" — and it took measuring at 1024 to find it, because 390 and 768
// were both completely clean.
//
// ── WHAT THIS TEST CAN AND CANNOT DO ───────────────────────────────────────
// jsdom has no layout engine, so it cannot re-measure 1219px. What it CAN do
// is hold the two halves of the swap together: the nav, the auth group, the
// burger button and the mobile panel must all agree on ONE breakpoint. The
// original bug is the shape where they disagree, and a future edit that moves
// one back to lg: without the others is the same bug returning.
//
// The 1219px measurement is why the breakpoint is xl: and not lg:. That
// number is recorded here because no test can rediscover it.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'Navbar.jsx'), 'utf8');

/** Tailwind's default breakpoints, in px. */
const BP = { sm: 640, md: 768, lg: 1024, xl: 1280, '2xl': 1536 };

/** The width the desktop header actually needs, measured in a real browser at
 *  1280px where nothing is being compressed: the auth group's right edge lands
 *  at x=1240. Not a guess and not a preference — see the header of this file.
 *  xl: (1280) clears it by 40px. lg: (1024) missed it by 216. */
const DESKTOP_HEADER_NEEDS = 1240;

/** Pull the breakpoint prefix off the four classes that do the swap. */
const prefixOf = (re) => {
  const m = SRC.match(re);
  return m ? m[1] : null;
};

const parts = {
  'desktop nav':  prefixOf(/hidden (\w+):flex items-center gap-1/),
  'auth buttons': prefixOf(/hidden (\w+):flex items-center gap-3/),
  'burger button': prefixOf(/(\w+):hidden p-2 text-foreground-secondary/),
  'mobile panel': prefixOf(/(\w+):hidden border-t border-border/),
};

describe('the header always offers a way in', () => {
  it('finds all four halves of the swap', () => {
    // If a rename breaks these matchers the test must fail loudly rather than
    // pass on null === null, which would assert nothing at all.
    for (const [name, bp] of Object.entries(parts)) {
      expect(bp, `could not find the ${name} in Navbar.jsx — update this matcher`).toBeTruthy();
    }
  });

  it('swaps nav and hamburger at ONE breakpoint, not two', () => {
    // The bug shape: desktop turns on before the burger turns off, or after.
    // Either way there is a band of widths with no working navigation.
    const distinct = [...new Set(Object.values(parts))];
    expect(distinct, `mismatched breakpoints: ${JSON.stringify(parts)}`).toHaveLength(1);
  });

  it('does not turn the desktop header on before it fits', () => {
    const bp = parts['desktop nav'];
    expect(BP[bp], `unknown breakpoint "${bp}:"`).toBeDefined();
    expect(
      BP[bp],
      `the desktop header measures ${DESKTOP_HEADER_NEEDS}px but turns on at ${BP[bp]}px — `
      + 'every width in between shows a nav with the Login and Sign Up buttons off screen '
      + 'and no hamburger to fall back to',
    ).toBeGreaterThanOrEqual(DESKTOP_HEADER_NEEDS);
  });

  it('keeps Login and Sign Up in the mobile panel', () => {
    // Moving the breakpoint UP is only safe because the hamburger panel
    // carries the auth buttons too. If someone strips them out of it, the
    // dead band comes back — wider, and for the same reason.
    const panel = SRC.slice(SRC.indexOf('hidden border-t border-border'));
    expect(panel).toMatch(/Login/);
    expect(panel).toMatch(/Sign Up/);
  });
});
