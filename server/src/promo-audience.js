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

// Where "the same address" is defined, for this file and for every other
// path that reads an email. Re-exported because the redeem route imports it
// from here, and because keeping one definition was the whole point.
import { normalizeEmail } from './email-normalize.js';
// Re-exported: the redeem route imports it from here, and keeping ONE
// definition of "the same address" was the whole point of moving it out.
export { normalizeEmail };

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
 * ONE string for every reason a code is unusable, still — naming which door
 * was locked would tell whoever holds a leaked code that the code itself is
 * good and merely mis-addressed.
 *
 * ☠ BUT IT NOW LISTS THE FOURTH REASON, because omitting it cost a real
 * customer twenty minutes. During the SPA workshop on 2026-09-02 the sentence
 * offered three explanations, none of which applied: the code was live, unused
 * and his. So he read "already used", assumed a glitch, and tried TWELVE
 * times. Nothing in the words suggested there was anything to check.
 *
 * Adding the fourth possibility leaks nothing new — the four stay
 * undistinguished, exactly as the three did — and it is the one an actual
 * person can act on, including the commonest innocent case of all: signed in
 * with a different account than the one the code was sent to.
 */
export const REFUSAL =
  'This code is invalid, expired, already used, or was not issued to this account. '
  + 'Check with whoever gave it to you.';

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
