// ─── bulk-provision.js ───────────────────────────────────────────────────────
// What a bulk batch will do to ONE email — decided in one place, so the preview
// and the real run cannot disagree.
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────────
// The owner asked on 2026-08-20, before pressing the button:
//
//   "if some email registered and I generated for this user before promo code
//    and still remaining ten or twenty credits in his account, and now I go to
//    bulk and I add list of emails... the system will collect all of them
//    together? Yes or no?"
//
// The answer was NO. Bulk checked whether the email existed and skipped the row
// before it reached the credit code, so a returning attendee with 20 credits
// received nothing while everyone new in the same list got 100. The batch
// half-worked, which is the dangerous kind: it reads as success.
//
// ── THE PREVIEW IS THE POINT ───────────────────────────────────────────────
// Credits are money. The failure worth designing against is not a wrong sum —
// it is pressing the button twice and quietly granting everyone 200. So this
// module computes an outcome PER EMAIL, the screen shows before → after, and
// the identical function then performs it. A preview produced by second code
// path is not a preview; it is a second opinion that happens to agree today.
//
// ── NEVER SHORTEN AN EXPIRY ────────────────────────────────────────────────
// A batch carries an expiry date. Applied blindly to an existing customer it
// could cut their account short, and the damage would be silent until they
// were locked out. Chosen by the owner on 2026-08-20: extend only when the
// batch date is LATER, and leave an account that never expires alone entirely —
// no date is longer than every date.

/** What a batch may do to an email that already has an account. */
export const EXISTING = {
  /** Leave it completely alone. What bulk has always done. */
  SKIP: 'skip',
  /** Add the credits; extend the expiry only if that lengthens it. */
  TOPUP: 'topup',
};

/** Same ceiling the endpoint clamps to, applied to a top-up as well. */
export const MAX_CREDITS = 100000;

const toDate = (v) => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * The new expiry for an existing account.
 *
 * `null` means "never expires", and it beats every date — returning a date
 * there would convert an unlimited account into a limited one, which is a
 * downgrade nobody asked for.
 */
export function extendExpiry(currentIso, batchIso) {
  const current = toDate(currentIso);
  const batch = toDate(batchIso);
  if (!current) return { value: null, changed: false };      // unlimited stays unlimited
  if (!batch) return { value: current, changed: false };     // batch sets none → keep theirs
  if (batch <= current) return { value: current, changed: false };  // never shorten
  return { value: batch, changed: true };
}

/**
 * What this batch does to one email.
 *
 * `existing` is the current row (or null when the address is new). Returns a
 * plain description — it performs nothing, which is what lets the screen render
 * it and the writer replay it.
 */
export function planBulkUser({ existing, credits = 0, expiresAt = null, mode = EXISTING.SKIP }) {
  const amount = Math.min(Math.max(Number(credits) || 0, 0), MAX_CREDITS);

  if (!existing) {
    return {
      action: 'create',
      creditsBefore: 0,
      creditsAfter: amount,
      creditsDelta: amount,
      expiryBefore: null,
      expiryAfter: toDate(expiresAt),
      expiryChanged: Boolean(toDate(expiresAt)),
    };
  }

  const before = Number(existing.credits) || 0;

  if (mode !== EXISTING.TOPUP) {
    return {
      action: 'skip',
      reason: 'already has an account — this batch was set to skip existing emails',
      creditsBefore: before,
      creditsAfter: before,
      creditsDelta: 0,
      expiryBefore: toDate(existing.expires_at),
      expiryAfter: toDate(existing.expires_at),
      expiryChanged: false,
    };
  }

  const expiry = extendExpiry(existing.expires_at, expiresAt);
  return {
    action: 'topup',
    creditsBefore: before,
    // Additive, exactly as the single-user grant is — the whole reason this
    // mode exists. `set` semantics here would delete the promo credits the
    // owner was specifically trying to preserve.
    creditsAfter: before + amount,
    creditsDelta: amount,
    expiryBefore: toDate(existing.expires_at),
    expiryAfter: expiry.value,
    expiryChanged: expiry.changed,
    // Stated per row so the preview can say plainly what is NOT being touched.
    untouched: ['package', 'allowed_models', 'password'],
  };
}

/** One line a human can check: "amr@x 20 → 120 credits · expiry 25 Sep → 30 Sep". */
export function describePlan(email, plan) {
  const d = (v) => (v ? new Date(v).toISOString().slice(0, 10) : 'never');
  if (plan.action === 'create') {
    return `${email} — NEW account, ${plan.creditsAfter} credits, expires ${d(plan.expiryAfter)}`;
  }
  if (plan.action === 'skip') {
    return `${email} — skipped, keeps ${plan.creditsBefore} credits (no change)`;
  }
  const bits = [`${email} — ${plan.creditsBefore} → ${plan.creditsAfter} credits`];
  if (plan.expiryChanged) bits.push(`expiry ${d(plan.expiryBefore)} → ${d(plan.expiryAfter)}`);
  else bits.push(`expiry ${d(plan.expiryBefore)} unchanged`);
  return bits.join(' · ');
}

/** Totals for the confirm step, so a double-run is visible before it happens. */
export function summarisePlans(plans = []) {
  const by = (a) => plans.filter((p) => p.plan.action === a);
  const created = by('create');
  const toppedUp = by('topup');
  return {
    create: created.length,
    topup: toppedUp.length,
    skip: by('skip').length,
    creditsGranted: [...created, ...toppedUp].reduce((n, p) => n + p.plan.creditsDelta, 0),
    expiriesExtended: toppedUp.filter((p) => p.plan.expiryChanged).length,
  };
}
