# Responsive sweep — findings log (#72)

> Measured in a real browser at each width by comparing every control's
> position against the viewport, not by reading breakpoints out of the CSS.
> A finding is only listed once it has been MEASURED.
>
> Status: ✅ fixed and verified · ⬜ found, not fixed · ❓ needs the owner

Last swept: 2026-08-24 · **390 · 768 · 1024 · 1194 · 1280** across all 12 routes

---

## /Image — phone (390px)

| Finding | Evidence | Status |
|---|---|---|
| **GENERATE 456px off the right edge** | chip row was `nowrap` + `overflow-x:auto` + `hide-scrollbar`, sized for the 900px bar | ✅ wraps below 640px |
| Cinema / Style / Negative Prompt off screen | 336 / 241 / 168px | ✅ same fix |
| Support bubble covered GENERATE | `elementsFromPoint` returned the bubble across the button's right half | ✅ moved |
| Camera Settings sheet: FOCAL column unusable | four columns measured **128 / 67 / 52 / 58px** at 390px — a 52px column for choosing a focal length | ✅ 2×2 below 640px; every cell now **158px** |

## /Video — phone (390px)

| Finding | Evidence | Status |
|---|---|---|
| **Right column collapsed to width 0** — Creations tab 158px off, Collections 258px | 380px panel with `flex-shrink:0` in a 390px viewport; results container reported width 0 at x=400 | ✅ `.split-row` stacks below 900px |
| Generate button only 28px tall | under the 32px floor, well under Apple's 44 | ⬜ |
| Several 26×26 controls (Back, Enhance prompt, Swap frames) | | ⬜ |

## ❓ The support bubble has nowhere safe on a phone

It breaks something in BOTH corners, measured:

* **bottom-right** — steals clicks from GENERATE on /Image
* **top-right** — steals clicks from the *Motion Control* tab on /Video

Currently top-right, because blocking one tab of three is less harmful than
blocking the product's primary action. **Neither is right.**

There is no Support entry anywhere in the nav, so simply hiding it on phones
would remove support access altogether. The clean answer is to move it INTO
the header beside the menu button on small screens, where it can never overlap
content — but that is a change to the site chrome and the owner has said the
placement is theirs to decide.

## ⚠️ THE HEADER — every iPad in landscape (1024–1279px)

The worst finding of the sweep, and it was on **every page**. Found only
because the owner asked for tablets; 390 and 768 were both completely clean.

| Finding | Evidence | Status |
|---|---|---|
| **Login and Sign Up 194px off screen, with no hamburger to fall back to** | at 1024: nav ended at x=1040, auth group ran x=1040→1218, header `overflow-x: visible`, page did not scroll | ✅ header swaps at `xl:` (1280) not `lg:` (1024) |

The nav was `hidden lg:flex` and the burger `lg:hidden`. Tailwind's `lg:` is
1024px, so the desktop layout switched **on** and the burger switched **off**
at exactly the width where the desktop layout stops fitting. It needs 1240px.

Everything in that band was affected: **iPad 1080 · iPad Air 1180 · iPad Pro
11" 1194.** On all of them a visitor could not sign in, could not sign up, and
had no menu button.

One number in this is worth keeping. Measured at 1024 the nav was 898px, which
implied a 1219px requirement. Measured at 1280, where nothing is squeezed, it
is 919px and the requirement is 1240px. **A layout under pressure reports the
size it was forced into, not the size it wants** — so the first measurement
understated the fix by 21px. `xl:` clears the real number by 40px.

Guarded by `src/components/navigation/Navbar.breakpoint.test.jsx`: the four
classes that do the swap must agree on one breakpoint, that breakpoint must
be ≥ the measured requirement, and the mobile panel must keep the auth
buttons — moving the breakpoint up is only safe because it carries them.

## /Audio — phone (390px)

| Finding | Evidence | Status |
|---|---|---|
| **Script and Voice panels 76px past the edge, clipped** | grid container 334px, its single `1fr` track computed to **438px** | ✅ `min-width: 0` on the grid items |
| Transport row forced the panel to 418px | ~142px of buttons + two 80px readouts + scrubber + meter, one line, 298px available | ✅ `flexWrap` + `minWidth: 200` on the scrubber |

The page already collapsed to one column below 1023px, so it *looked* handled.
It was not: a grid item defaults to `min-width: auto` — never shrink below
your own content — so the `1fr` track floored at the panels' min-content width
and an ancestor's `overflow-x: hidden` silently ate the difference. **Going to
one column does nothing if the one column cannot shrink.**

## Touch targets

| Finding | Evidence | Status |
|---|---|---|
| Explore carousel dots **7×7px** | six of them, unhittable with a thumb | ✅ 28px button, 7px dot drawn inside |
| Image-count stepper **18×18px, and no tooltip** | the only two controls on the prompt bar with no `title` at all | ✅ 28×32, labelled "Fewer images" / "More images" |
| /Video: Back, Enhance prompt 26×26; Generate 28 tall | above the unhittable line, below Apple's 44 | ⬜ |
| /Image: Enhance text, Upload reference, Swap 30×30 | already have tooltips | ⬜ |

The obvious fix for the dots — an oversized invisible hit area — is **wrong**
here and worth recording as a trap: they sit 15px apart, so 44px boxes would
overlap and the last one painted would swallow every tap. Making the button
itself 28px and drawing the 7px dot inside it keeps the look and the spacing.

## What the sweep instrument got wrong (three times)

Recorded because the false positives outnumbered the real findings, and each
one would have produced a "fix" to something that was never broken.

1. **Horizontal carousels.** First pass reported 1646px of overflow on
   /Explore. It was a working carousel. Content past the edge inside an
   `overflow-x: auto` ancestor is the point of a carousel.
2. **`overflow-x: hidden` is not a scroller.** Correcting for (1), I then
   treated `hidden` as "fine, it scrolls". It is the opposite — hidden content
   past the edge is content nobody can reach. That distinction is what found
   /Audio.
3. **Decorative blurred glows.** 700px and 900px unclassed divs on /Image,
   /Video and /Audio, positioned at `-20%`/`-10%` to bleed off-frame on
   purpose, `filter: blur(60px)`, no children, no text. I was one step from
   "fixing" the page background. Now excluded by `filter !== 'none'`.

A fourth near-miss was visual, not instrumental: a screenshot appeared to show
a camera card bleeding into the FOCAL heading. Measuring said content height
equalled cell height and spill was zero — it is a card fading at its own
scroll boundary. **My eyes were wrong and the ruler was right**, which is the
reverse of 1–3.

## Clean at every width swept

/Explore · /Pricing · /Community · /Apps · /Image · /Video · /Audio · /edit ·
/Account · /Templates · /Studio · /node — nothing unreachable off the right
edge at 390, 768, 1024, 1194 or 1280, and no page scrolls sideways.

## Still to sweep

The **control panel** (admin, behind a login — I cannot reach it) and 1440+.
Touch targets in the 26–30px band across /Video.
