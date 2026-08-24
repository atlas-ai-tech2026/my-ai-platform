# Responsive sweep — findings log (#72)

> Measured in a real browser at each width by comparing every control's
> position against the viewport, not by reading breakpoints out of the CSS.
> A finding is only listed once it has been MEASURED.
>
> Status: ✅ fixed and verified · ⬜ found, not fixed · ❓ needs the owner

Last swept: 2026-08-23 · widths 390 (phone) — 768/1024/1440 still to do

---

## /Image — phone (390px)

| Finding | Evidence | Status |
|---|---|---|
| **GENERATE 456px off the right edge** | chip row was `nowrap` + `overflow-x:auto` + `hide-scrollbar`, sized for the 900px bar | ✅ wraps below 640px |
| Cinema / Style / Negative Prompt off screen | 336 / 241 / 168px | ✅ same fix |
| Support bubble covered GENERATE | `elementsFromPoint` returned the bubble across the button's right half | ✅ moved |
| Camera Settings sheet: FOCAL column cut off | owner's phone screenshot — 14mm/18mm sliced, no scroll | ⬜ `CameraSelector.jsx` |

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

## Still to sweep

/Audio (same split layout as /Video — expect the same collapse) · /Explore ·
/Pricing · /Community · /Apps · /Account · /edit · the control panel.
Then 768, 1024 and 1440 for everything.
