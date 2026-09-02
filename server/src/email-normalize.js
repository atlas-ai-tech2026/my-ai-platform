// ─── email-normalize.js ──────────────────────────────────────────────────────
// ONE definition of "the same address", used by every path that reads an email.
//
// It lived inside promo-audience.js until 2026-09-02, when fixing the promo bug
// showed the same fault three more times. The lesson of that day was not "strip
// invisible characters" — it was that the SAME comparison must be used
// everywhere an address is matched, or the places that disagree are precisely
// the places nobody tests.
//
// ── WHERE IT CAME FROM ─────────────────────────────────────────────────────
// During the SPA New Academy workshop, osama.himselff@gmail.com could not
// redeem the code he had been invited to; he tried twelve times in twenty
// minutes. His address is stored as "‏osama.himselff@gmail.com" — a
// RIGHT-TO-LEFT MARK sits in front of it. Arabic-language Excel inserts these
// silently (the sheet is titled بيانات الطلاب). It is invisible in Excel,
// invisible in the invites drawer, invisible in an email. Only the bytes
// differ, and no amount of careful typing gets past it.

/**
 * Characters that are IN an address and cannot be typed.
 *
 * Zero-width and direction marks, the word joiner, the byte-order mark, and
 * the non-breaking space — everything that survives a copy-paste out of Excel,
 * Word or a webmail client, and none of which belongs in an email address.
 *
 * ☠ THE LIST STOPS HERE ON PURPOSE. Dots and plus-addressing are NOT removed:
 * a.hmed@ and ahmed@ are different people at most providers, and a
 * normalisation that let the wrong person into an account or a paid seat would
 * be far worse than the bug it fixed.
 */
export const INVISIBLE = /[​-‏‪-‮⁠﻿ ]/g;

/**
 * The address, as the person who owns it would type it.
 *
 * Strip the untypable, trim, lowercase. Apply to BOTH SIDES of any comparison:
 * that is what repairs data already stored, with nobody's row edited and
 * nothing re-uploaded.
 */
export const normalizeEmail = (e) =>
  String(e ?? '').replace(INVISIBLE, '').trim().toLowerCase();
