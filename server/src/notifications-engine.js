// ─── notifications-engine.js ─────────────────────────────────────────────────
// Pure logic for the Notifications feature: rendering a template against a real
// client, and deciding whether a client is allowed another message today.
// No database, no HTTP — same shape as costing-engine.js and offers-engine.js.
//
// ── WHAT CAN ACTUALLY FIRE ───────────────────────────────────────────────────
// The brief lists ten automation rules. Seven of them have a real trigger in
// this codebase. Three do not, for the same reason two Offer types cannot be
// redeemed: Voxel has no checkout, no subscriptions and no recurring billing
// (verified 2026-08-07). Those three are still defined here — the owner decided
// to keep them visible, switched off and labelled — so the plan for renewal
// messaging survives and starts working the day a payment flow exists.
//
// The dangerous version of this feature is one that silently never fires. Every
// rule therefore declares whether it CAN fire, and the screen shows it.

/** Variables an admin may use in a title or body. */
export const VARIABLES = ['{name}', '{plan}', '{credits}', '{renewal_date}'];

/** Notification types. `system` types bypass the marketing frequency cap:
 *  a customer must always be told their generation finished or their credits
 *  ran out, however many promotions they were sent today. */
export const TYPES = {
  announce: { label: 'Announcement / news', icon: '📣', color: '#60a5fa', system: false },
  feature:  { label: 'New feature',         icon: '🚀', color: '#a78bfa', system: false },
  promo:    { label: 'Offer / promo code',  icon: '🎁', color: '#34d399', system: false },
  personal: { label: 'Personal message',    icon: '💬', color: '#fb923c', system: false },
  // System / automatic
  welcome:  { label: 'Welcome',             icon: '👋', color: '#60a5fa', system: true },
  renewal:  { label: 'Renewal',             icon: '🔄', color: '#60a5fa', system: true },
  credits:  { label: 'Low credits',         icon: '⚡', color: '#fb923c', system: true },
  gen:      { label: 'Generation',          icon: '🎬', color: '#34d399', system: true },
  payment:  { label: 'Payment',             icon: '💳', color: '#f87171', system: true },
};

export const MANUAL_TYPES = ['announce', 'feature', 'promo', 'personal'];

export function isSystemType(type) {
  return TYPES[type]?.system === true;
}

/**
 * The ten automation rules.
 *
 * `needs_checkout: true` means there is no event in this codebase that could
 * ever fire it. Those ship DISABLED and the screen says why — an automation
 * that looks armed and never fires is worse than one plainly marked dead.
 */
export const AUTOMATIONS = [
  { key: 'renewal_reminder', icon: '🔄', name: 'Renewal reminder',       type: 'renewal',
    trigger: 'days before renewal',             n: 3,    system: true,  needs_checkout: true,
    template: 'Hi {name}, your {plan} plan renews on {renewal_date}.' },
  { key: 'renewed',          icon: '✅', name: 'Renewed successfully',   type: 'renewal',
    trigger: 'on successful renewal',           n: null, system: true,  needs_checkout: true,
    template: 'Thanks {name}! {plan} renewed — {credits} fresh credits added.' },
  { key: 'payment_failed',   icon: '💳', name: 'Payment failed',         type: 'payment',
    trigger: 'on failed charge',                n: null, system: true,  needs_checkout: true,
    template: "We couldn't renew {plan}. Update your card to keep creating." },
  { key: 'low_credits',      icon: '⚡', name: 'Low credits',            type: 'credits',
    trigger: '% credits remaining below',       n: 15,   system: true,  needs_checkout: false,
    template: 'Only {credits} credits left, {name} — top up to keep going.' },
  { key: 'generation',       icon: '🎬', name: 'Generation done / failed', type: 'gen',
    trigger: 'on job completion',               n: null, system: true,  needs_checkout: false,
    template: 'Your generation is ready ▶ (failed jobs are refunded)' },
  { key: 'welcome',          icon: '👋', name: 'Welcome note',           type: 'welcome',
    trigger: 'instantly after registration',    n: null, system: false, needs_checkout: false,
    template: "Welcome to Voxel, {name}! Here's how to create your first video." },
  { key: 'onboarding',       icon: '🌱', name: 'Onboarding nudge',       type: 'announce',
    trigger: 'days after signup with 0 generations', n: 1, system: false, needs_checkout: false,
    template: 'Your free credits are waiting — try a template, {name}.' },
  { key: 'offer_received',   icon: '🎁', name: 'Offer received',         type: 'promo',
    trigger: 'when a targeted offer activates', n: null, system: false, needs_checkout: false,
    template: "You got {offer_name}! It's already applied to your account." },
  { key: 'offer_expiring',   icon: '⏳', name: 'Offer expiring',         type: 'promo',
    trigger: 'days before an offer ends',       n: 2,    system: false, needs_checkout: false,
    template: "Your {offer_name} ends {offer_end} — don't miss it." },
  { key: 'winback',          icon: '😴', name: 'Inactivity win-back',    type: 'announce',
    trigger: 'days without login/generation',   n: 30,   system: false, needs_checkout: false,
    template: 'We miss you {name} — see what’s new since your last visit.' },
];

export function automationByKey(key) {
  return AUTOMATIONS.find((a) => a.key === key) || null;
}

/** Rules that can actually fire on today's platform. */
export function liveAutomations() {
  return AUTOMATIONS.filter((a) => !a.needs_checkout);
}

// ─── variable rendering ──────────────────────────────────────────────────────

/**
 * What a variable renders to for a real user row.
 *
 * `{renewal_date}` is the interesting one: NOTHING in this database holds a
 * renewal date, because nothing renews. Rendering today's date, or a blank, or
 * leaving the raw "{renewal_date}" in the message would each put something
 * false or broken in front of a paying customer. It renders to a fixed,
 * honest placeholder instead, and `unresolvedVariables()` lets the compose
 * screen warn the admin BEFORE they send.
 */
export const UNRESOLVED = '—';

export function variableValues(user = {}) {
  const name = String(user.display_name || '').trim()
    || String(user.email || '').split('@')[0]
    || 'there';
  const credits = user.credits == null ? null : Number(user.credits);
  return {
    '{name}': name,
    '{plan}': String(user.package || '').trim() || 'Free',
    // Number(null) is 0 — and telling a customer they have 0 credits when the
    // value is simply unknown would send them to top up for no reason.
    '{credits}': credits == null || !Number.isFinite(credits)
      ? UNRESOLVED
      : (credits % 1 ? credits.toFixed(1) : String(credits)),
    // No renewals exist. See the note above.
    '{renewal_date}': UNRESOLVED,
  };
}

/** Variables in `text` that cannot be resolved for real users. */
export function unresolvedVariables(text) {
  const found = new Set();
  for (const v of VARIABLES) {
    if (String(text || '').includes(v) && RESOLVABLE[v] === false) found.add(v);
  }
  return [...found];
}

/** Which variables map to a real column. Drives the compose-screen warning. */
export const RESOLVABLE = {
  '{name}': true,
  '{plan}': true,
  '{credits}': true,
  // No subscription, no renewal, no date. Never silently substituted.
  '{renewal_date}': false,
};

/**
 * Fill a template for one user. Unknown {tokens} are left EXACTLY as written
 * rather than blanked: a message reading "ends {offer_end}" is obviously a
 * template bug, while one reading "ends " looks like a finished sentence and
 * would ship unnoticed.
 */
export function renderTemplate(text, user = {}, extra = {}) {
  if (text == null) return '';
  const vals = { ...variableValues(user), ...extra };
  return String(text).replace(/\{[a-z_]+\}/g, (token) =>
    Object.prototype.hasOwnProperty.call(vals, token) ? String(vals[token]) : token);
}

// ─── frequency cap ───────────────────────────────────────────────────────────

export const DEFAULT_DAILY_MARKETING_CAP = 2;

/**
 * May this client receive one more message of `type` today?
 *
 * @param sentToday  how many MARKETING notifications they already got today
 * @param cap        the configured cap
 *
 * System notifications are never blocked — a customer whose generation failed
 * must be told, regardless of how many promotions they were sent.
 */
export function canSend(type, sentToday, cap = DEFAULT_DAILY_MARKETING_CAP) {
  if (isSystemType(type)) return true;

  // Number(null) is 0, and a limit of 0 means "send nothing" — so a null or
  // missing cap read through Number() would silence ALL marketing across the
  // whole platform, silently. Reject the empty values BEFORE converting.
  // (0 supplied deliberately is still honoured: that is a real "pause all".)
  if (cap == null || cap === '') return true;
  const limit = Number(cap);
  if (!Number.isFinite(limit) || limit < 0) return true;

  const n = Number(sentToday);
  if (!Number.isFinite(n)) return true;
  return n < limit;
}

/** Split an audience into who gets it now and who is capped out. */
export function applyFrequencyCap(type, recipients = [], sentTodayById = {}, cap = DEFAULT_DAILY_MARKETING_CAP) {
  const send = [];
  const skipped = [];
  for (const r of recipients) {
    const id = r?.id ?? r;
    (canSend(type, sentTodayById[id] || 0, cap) ? send : skipped).push(r);
  }
  return { send, skipped };
}

// ─── validation ──────────────────────────────────────────────────────────────

/** Problems that must be fixed before a manual notification can be sent. */
export function validateCompose(draft = {}, { audienceCount = null } = {}) {
  const errs = [];
  if (!MANUAL_TYPES.includes(draft.type)) errs.push('choose a message type');
  if (!String(draft.title || '').trim()) errs.push('write a title');
  if (!String(draft.body || '').trim()) errs.push('write the message');
  if (draft.audience_mode === 'picked' && !draft.picked_client_ids?.length) {
    errs.push('pick at least one client');
  }
  if (draft.audience_mode === 'segment' && audienceCount === 0) {
    errs.push('segment matches 0 clients');
  }
  // A button with no destination does nothing when clicked.
  //
  // Accepts BOTH namings on purpose. This rule read only `cta`/`url` while
  // every real caller sends `cta_text`/`cta_url`, so it silently never fired
  // and a button with no link would ship to customers. Found 2026-08-07 while
  // auditing the CRM forms; the test below pins both spellings.
  const ctaText = String(draft.cta_text ?? draft.cta ?? '').trim();
  const ctaUrl = String(draft.cta_url ?? draft.url ?? '').trim();
  if (ctaText && !ctaUrl) {
    errs.push('give the button a link, or remove the button text');
  }
  if (draft.scheduled_for && draft.expires_at &&
      String(draft.expires_at) < String(draft.scheduled_for)) {
    errs.push('it expires before it is due to be sent');
  }
  return errs;
}

/** A CTA link must stay inside our own site. */
export function isSafeCtaUrl(url) {
  const u = String(url || '').trim();
  if (!u) return true;
  // Relative paths only. An absolute URL in an admin-composed message shown to
  // every customer is an open redirect waiting to happen, and "//evil.com" is a
  // protocol-relative absolute URL that a naive "starts with /" check lets past.
  return u.startsWith('/') && !u.startsWith('//');
}
