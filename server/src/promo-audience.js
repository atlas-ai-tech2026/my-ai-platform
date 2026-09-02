// ─── promo-audience.js ───────────────────────────────────────────────────────
// Who is allowed to redeem a promo code.
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────────
// Until now a promo code was a bearer token: any signed-in account that knew
// the string could spend one of its uses. The redemption path checked five
// things — the code exists, is active, is unexpired, is under its cap, and has
// not been used by this person — and not one of them was about WHO.
//
// These codes are not gifts. They are how an organisation's paid seats are
// handed out. So a hundred-use workshop code that gets forwarded, screenshotted
// into a group chat, or posted anywhere is spent by a hundred strangers, and
// the attendees the customer PAID for hit "invalid, expired, or already used"
// in the middle of a live session. Revenue gone and the workshop broken at the
// same moment.
//
// The owner asked for it plainly on 2026-08-20: "nobody can use this promo code
// except these emails, and each email can use it only for one time."
//
// ── THE ERROR MESSAGE IS PART OF THE FEATURE ───────────────────────────────
// A refusal must NOT say "you are not on the list". That phrasing confirms the
// code is real and merely mis-addressed, which is precisely the signal someone
// probing a leaked code is looking for. It returns the same words as every
// other refusal — the existing message already refuses to distinguish
// "unknown", "expired" and "used up" for the same reason.
//
// ── OPT-IN, ALWAYS ─────────────────────────────────────────────────────────
// A code with NO list keeps behaving exactly as it does today. There are live
// codes in production; silently restricting them would break redemptions
// nobody asked to change.

/**
 * Characters that are IN an address but cannot be typed.
 *
 * Arabic-language Excel inserts direction marks silently. A sheet titled
 * بيانات الطلاب gave us "\u200fosama.himselff@gmail.com" — a RIGHT-TO-LEFT
 * MARK in front of the address, invisible in Excel, invisible in the invites
 * drawer, invisible in an email. Only the bytes differ, and the person can
 * never type their way past it.
 *
 * Zero-width and direction marks, the word joiner, the byte-order mark, and
 * the non-breaking space — all of which survive a copy-paste and none of which
 * belong in an email address.
 */
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060\uFEFF\u00A0]/g;

/**
 * Normalised for comparison. Emails are case-insensitive in practice.
 *
 * ── STRIPPING THE INVISIBLES IS WHAT REPAIRS LISTS ALREADY UPLOADED ────────
 * Both sides of the comparison go through here, so a code whose list was
 * imported months ago with a stray mark starts working the moment this ships —
 * no re-upload, no editing anybody's row.
 */
export const normalizeEmail = (e) => String(e ?? '').replace(INVISIBLE, '').trim().toLowerCase();

/**
 * May this person redeem this code?
 *
 * `invited` is the code's allow-list — null or empty means the code is open,
 * which is every code that exists today.
 *
 * Deliberately takes the ALREADY-REDEEMED flag rather than looking it up:
 * once-per-person is enforced by a UNIQUE(code_id, user_id) index inside the
 * redemption transaction, and that index is the real guarantee. Two people
 * clicking at the same instant is settled by the database, not by a check that
 * ran a moment earlier. This function decides eligibility; the index decides
 * the race.
 */
export function mayRedeem({ email, invited, alreadyRedeemed = false }) {
  if (alreadyRedeemed) {
    return { allowed: false, reason: 'already-redeemed' };
  }
  // No list = open code. Unchanged behaviour for everything already issued.
  //
  // Counted through BOTH .length and .size. An empty Set has no .length, so
  // `invited.length === 0` was false for one, and the empty list fell through
  // to the lookup and refused everybody. A code carrying an empty allow-list
  // would have locked out every single person — which is the worst direction
  // for this bug to fail in, and invisible until someone passed a Set.
  const size = invited == null ? 0 : (invited.size ?? invited.length ?? 0);
  if (!size) return { allowed: true, reason: 'open-code' };
  const mine = normalizeEmail(email);
  if (!mine) return { allowed: false, reason: 'not-invited' };
  // ☠ NORMALISE BOTH SIDES, INCLUDING A SET.
  //
  // This read `invited instanceof Set ? invited : …`, so a Set was trusted as
  // already normalised — and the redeem route builds one straight from the
  // database rows: `new Set(rows.map((r) => r.email))`. The typed address was
  // lowercased and trimmed; the STORED address never was.
  //
  // So every stored address that was not already lower-case and clean could
  // not be redeemed by the person it belonged to. In the SPA New Academy list
  // of 84 that was NINE addresses with capital letters plus one carrying an
  // invisible mark — ten people, not one, and every one of them looked like
  // "you were not invited".
  //
  // Cheap: these lists are at most a few hundred entries, built once per
  // redemption attempt.
  const set = new Set([...invited].map(normalizeEmail));
  return set.has(mine)
    ? { allowed: true, reason: 'invited' }
    : { allowed: false, reason: 'not-invited' };
}

/**
 * The words a refused redemption gets.
 *
 * One string for every reason a code is unusable. "You are not on the list"
 * would tell someone holding a leaked code that the code itself is good.
 */
export const REFUSAL = 'This code is invalid, expired, or already used.';

/**
 * How many uses a list-restricted code should allow.
 *
 * The owner's description was "one hundred emails, one hundred uses" — so the
 * list IS the cap, and deriving it removes the way those two drift apart. An
 * explicit smaller cap is still honoured (fifty seats released to a list of a
 * hundred is a real thing to want); a LARGER one is meaningless, because the
 * list can never satisfy it.
 */
export function capForInvites({ inviteCount, requested = null }) {
  if (!inviteCount) return requested;
  if (requested == null || requested === '') return inviteCount;
  const n = Math.max(1, parseInt(requested, 10) || 1);
  return Math.min(n, inviteCount);
}

/**
 * Who has not turned up yet.
 *
 * The screen that earns its keep before a workshop. The predictable failure is
 * not fraud — it is someone invited as ahmed@company.com signing up with
 * ahmed.k@gmail.com. A list that only shows redemptions cannot surface that;
 * one that shows who is still outstanding lets it be fixed in seconds.
 */
export function splitInvites(rows = []) {
  const redeemed = rows.filter((r) => r.redeemed_at);
  const waiting = rows.filter((r) => !r.redeemed_at);
  return {
    total: rows.length,
    redeemed,
    waiting,
    redeemedCount: redeemed.length,
    waitingCount: waiting.length,
  };
}
