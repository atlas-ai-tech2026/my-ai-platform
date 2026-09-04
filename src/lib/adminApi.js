// ─── Admin API client ───────────────────────────────────────────────────────
//
// Thin fetch wrapper that:
//   1. Authenticates with the httpOnly admin session COOKIE (credentials:
//      'include') — never a token this code can read
//   2. Echoes the readable half of the double-submit CSRF pair
//   3. Throws a typed `ApiError` with `status` and `body` so callers can
//      branch on 401/403/402/etc.
//
// H7 (security audit 2026-07-28) introduced the httpOnly, Secure,
// SameSite=Strict cookie so an XSS bug could not exfiltrate the admin token.
//
// N3 (recheck 2026-08-03) finished the job. H7 left the bearer header being
// sent "during the transition", and the transition never ended — so the admin
// JWT still sat in localStorage for any XSS to read, AND bearer-authenticated
// requests skip CSRF entirely (admin-session.js: `if (!usedCookieAuth) return
// ok`). Both of H7's protections were inert. This client no longer reads or
// sends a token at all, and the server now refuses bearer auth on /api/admin/*.

export const VOXEL_TOKEN_KEY = 'voxel_token';
export const CSRF_COOKIE = 'voxel_csrf';

export class ApiError extends Error {
  constructor(status, body, message) {
    super(message || body?.error || `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

// N3: intentionally NO Authorization header. The admin session travels as an
// httpOnly cookie that this code cannot read — which is the entire point.

/** Read the readable half of the double-submit pair. */
export function readCsrfCookie() {
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${CSRF_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function csrfHeader() {
  const token = readCsrfCookie();
  return token ? { 'X-CSRF-Token': token } : {};
}

async function request(method, path, body) {
  const res = await fetch(path, {
    method,
    // Send the httpOnly admin session cookie.
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...csrfHeader(),
    },
    body: body == null ? undefined : JSON.stringify(body),
  });

  let data = null;
  try { data = await res.json(); } catch { /* non-JSON */ }

  if (!res.ok) throw new ApiError(res.status, data, data?.error);
  return data;
}

// ─── Auth ────────────────────────────────────────────────────────────────
export const adminApi = {
  // N1 (recheck 2026-08-03): `second` carries the TOTP or recovery code.
  // H5 shipped working 2FA on the server, but no client could ever send a
  // code — so enabling it locked the admin out and it stayed off. The server
  // answers a missing/blank code with 401 {totp_required:true}; the caller
  // re-submits the same credentials plus one of these fields.
  login: (email, password, second = {}) => request('POST', '/api/auth/login', {
    email,
    password,
    ...(second.totpCode     ? { totp_code: second.totpCode }         : {}),
    ...(second.recoveryCode ? { recovery_code: second.recoveryCode } : {}),
  }),
  register: (email, password) => request('POST', '/api/auth/register', { email, password }),

  // Server-authoritative identity (N3). Replaces decoding a localStorage
  // token: the cookie is the session, and only the server can read it.
  me:     () => request('GET',  '/api/auth/me'),
  logout: () => request('POST', '/api/auth/logout'),

  // ─── Two-factor enrolment (N1) ────────────────────────────────────
  twoFactorStatus:  ()     => request('GET',  '/api/admin/2fa/status'),
  twoFactorSetup:   ()     => request('POST', '/api/admin/2fa/setup'),
  twoFactorConfirm: (code) => request('POST', '/api/admin/2fa/confirm', { totp_code: code }),
  twoFactorDisable: (code) => request('POST', '/api/admin/2fa/disable', { totp_code: code }),

  // ─── Admin endpoints (require role='admin' on server) ─────────────
  listUsers:   (page = 1, limit = 50) => request('GET', `/api/admin/users?page=${page}&limit=${limit}`),
  searchUsers: (email)               => request('GET', `/api/admin/users/search?email=${encodeURIComponent(email)}`),
  updateCredits: (id, { amount, action, reason }) =>
    request('POST', `/api/admin/users/${id}/credits`, { amount, action, reason }),
  setBan:      (id, banned, reason)  => request('POST', `/api/admin/users/${id}/ban`, { banned, reason }),
  resetPassword: (id, newPassword)   => request('POST', `/api/admin/users/${id}/reset-password`, { new_password: newPassword }),
  history:     (id, limit = 10000)   => request('GET', `/api/admin/users/${id}/history?limit=${limit}`),
  // Close (or reopen) access for a whole cohort. Admin accounts are excluded
  // server-side, so this can never lock the owner out of the panel.
  // mode 'set' + expires_at, or mode 'clear'. scope 'existing' spares anyone
  // who registers after the call.
  setBulkExpiry: ({ mode, expires_at, scope = 'existing', keep_codes, keep_access_days }) =>
    request('POST', '/api/admin/users/expiry',
      { mode, expires_at, scope, keep_codes, keep_access_days }),
  auditRefunds: ()                   => request('GET', '/api/admin/audit/refunds'),
  stats:       ()                    => request('GET', '/api/admin/stats'),

  // ─── Logs + API Usage (kie.ai-style pages) ────────────────────────
  logs: (params = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
    ).toString();
    return request('GET', `/api/admin/logs${qs ? '?' + qs : ''}`);
  },
  // Every ledger row the Logs filters match (not a page) — for the PDF /
  // Excel credit report. Same filter names as logs().
  creditsReport: (params = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
    ).toString();
    return request('GET', `/api/admin/reports/credits${qs ? '?' + qs : ''}`);
  },
  usage: (from, to) => {
    const qs = new URLSearchParams({ ...(from && { from }), ...(to && { to }) }).toString();
    return request('GET', `/api/admin/usage${qs ? '?' + qs : ''}`);
  },
  kieBalance: () => request('GET', '/api/admin/kie-balance'),
  // One supplier's spend, shaped like that supplier's own console so the two
  // can be read side by side. Returns coverage + usd_rate so the screen can
  // say what is estimated rather than implying it is billed.
  providerUsage: ({ provider = 'kie', from, to } = {}) => {
    const qs = new URLSearchParams({ provider, ...(from && { from }), ...(to && { to }) }).toString();
    return request('GET', `/api/admin/usage/provider?${qs}`);
  },

  // ─── Promo codes + gift cards ─────────────────────────────────────
  createPromo: (body)   => request('POST', '/api/admin/promocodes', body),
  listPromos:  ()       => request('GET', '/api/admin/promocodes'),
  togglePromo: (id)     => request('POST', `/api/admin/promocodes/${id}/toggle`),
  // Only description + expiry are editable server-side; credits and the code
  // itself stay locked so the credit ledger cannot disagree with the code.
  updatePromo: (id, body) => request('PATCH', `/api/admin/promocodes/${id}`, body),
  promoRedemptions: (id) => request('GET', `/api/admin/promocodes/${id}/redemptions`),
  // Who the code was ADDRESSED to, and who has actually turned up. Different
  // question from redemptions: this one can show you the people who have NOT.
  promoInvites: (id) => request('GET', `/api/admin/promocodes/${id}/invites`),
  // Add somebody to a list that already exists. Before this, one attendee of
  // 84 who could not redeem meant issuing a whole second code — which is what
  // happened on 2026-09-02, and left nothing on the code's own screen to show
  // for it. The cap follows the list where the list set it.
  promoInvitesAdd: (id, emails) =>
    request('POST', `/api/admin/promocodes/${id}/invites`, { emails }),

  // ── Raise a code's value, and level up everyone who already used it ──────
  // Preview first: 59 people × 92 credits is about $344, and an approval is
  // for a specific headcount — apply sends it back so a code that moved is
  // refused rather than paying somebody twice.
  promoTopUpPreview: (id, credits) =>
    request('GET', `/api/admin/promocodes/${id}/topup-preview?credits=${encodeURIComponent(credits)}`),
  promoTopUpApply: (id, credits, expectPeople) =>
    request('POST', `/api/admin/promocodes/${id}/topup`, { credits, expect_people: expectPeople }),
  // Who loses access, and when. Added urgently 2026-08-20 — the Users tab shows
  // Credit expiry, the 2026-08-25 rule: credits die 30 days after they were
  // added; accounts never expire. Two calls on purpose: one only LOOKS, one
  // acts and carries the exact numbers the admin was shown, so a picture that
  // moved while it was being read is refused.
  creditLotsOverview: (days) => request('GET', `/api/admin/credit-lots/overview?days=${days || 30}`),
  creditLotsActivate: (body) => request('POST', '/api/admin/credit-lots/activate', body),
  // #64 — arrivals counted here, plus the account history reconstructed from
  // dates that were always kept.
  audience: (days) => request('GET', `/api/admin/audience?days=${days || 90}`),
  // #59 — what the business costs. Three sources: typed, measured, pulled.
  expenses: ({ months = 6, margin = '' } = {}) =>
    request('GET', `/api/admin/expenses?months=${months}&margin=${encodeURIComponent(margin)}`),
  addExpense: (body) => request('POST', '/api/admin/expenses', body),
  cancelExpense: (id, body) => request('POST', `/api/admin/expenses/${id}/cancel`, body),
  refreshDigitalOcean: () => request('POST', '/api/admin/expenses/refresh-digitalocean'),
  createGiftCards: (body) => request('POST', '/api/admin/giftcards', body),
  listGiftCards: (status = 'all') => request('GET', `/api/admin/giftcards?status=${status}`),

  // ─── Costing calculator (2026-08-06) ──────────────────────────────
  // Read-and-write for the pricing_* tables only. These never touch what a
  // customer is charged — pricing.js remains the charging authority.
  // Every mutating call returns the FULL recomputed state, so the screen can
  // never drift from the server's numbers.
  costingState:    ()            => request('GET',    '/api/costing/state'),
  costingAudit:    (limit = 100) => request('GET',    `/api/costing/audit?limit=${limit}`),
  costingSettings: (body)        => request('PATCH',  '/api/costing/settings', body),
  costingModel:    (id, body)    => request('PATCH',  `/api/costing/models/${id}`, body),
  // "New models": what a provider offers that the website does not sell yet.
  costingDismissCatalog: (id, dismissed = true) =>
    request('POST', `/api/costing/catalog/${id}/dismiss`, { dismissed }),
  costingSaveDraft:(plans)       => request('PUT',    '/api/costing/plans/draft', { plans }),
  costingApprove:  ()            => request('POST',   '/api/costing/plans/approve'),
  // Run the supplier sweep now rather than waiting for midnight.
  costingSync:     ()            => request('POST',   '/api/costing/sync'),
  // Supplier price moves waiting on the owner. Nothing here has changed a
  // customer's price — approving is what does that.
  priceChanges:    (status = 'open') => request('GET', `/api/costing/price-changes?status=${status}`),
  resolvePriceChange: (id, action)   => request('POST', `/api/costing/price-changes/${id}`, { action }),
  costingDiscard:  ()            => request('DELETE', '/api/costing/plans/draft'),

  // ─── Alerts (Tier 1.1, 2026-08-16) ────────────────────────────────
  // The system telling you, instead of you going to look. Replaces an
  // hourly balance check whose only output was console.error.
  alerts:          ()            => request('GET',  '/api/admin/alerts'),
  alertsCheck:     ()            => request('POST', '/api/admin/alerts/check'),
  // Acknowledge ≠ resolve: the condition is still true and the row still
  // shows. It only stops emailing.
  alertAck:        (id)          => request('POST', `/api/admin/alerts/${id}/ack`),
  alertSettings:   (body)        => request('PUT',  '/api/admin/alerts/settings', body),

  // ─── Workshops + P&L (Tier 1.2, 2026-08-16) ───────────────────────
  // Invoiced revenue against supplier cost. The promo code is the join:
  // attendees are known by the code they redeemed, which is what makes a
  // workshop's supplier cost attributable at all.
  workshops:       ()            => request('GET',    '/api/admin/workshops'),
  workshopCreate:  (body)        => request('POST',   '/api/admin/workshops', body),
  workshopUpdate:  (id, body)    => request('PUT',    `/api/admin/workshops/${id}`, body),
  workshopDelete:  (id)          => request('DELETE', `/api/admin/workshops/${id}`),
  organisations:   ()            => request('GET',    '/api/admin/organisations'),
  organisationCreate: (body)     => request('POST',   '/api/admin/organisations', body),

  // ─── Reliability (Tier 1.3, 2026-08-16) ───────────────────────────
  // How often each model fails. The failure count is INFERRED — refunds
  // never name the model — so the response carries its own confidence.
  reliability:     (days = 30)   => request('GET', `/api/costing/reliability?days=${days}`),

  // ─── Customer lookup (Tier 2.2, 2026-08-16) ───────────────────────
  // Everything about one person, with each charge PAIRED to its outcome.
  // Rows say whether that outcome was recorded or inferred.
  customerOverview: (id)         => request('GET', `/api/admin/customers/${id}/overview`),

  // SOP / daily operations. `sop` is cheap and always recomputed; `sopCheckNow`
  // additionally re-runs the restore verification, which downloads a real
  // archive and is therefore rate limited server-side.
  sop:          ()               => request('GET',  '/api/admin/sop'),
  sopCheckNow:  ()               => request('POST', '/api/admin/sop/check-now', {}),
  // Times cross this boundary in KUWAIT hours. The server stores UTC; an
  // unlabelled clock is how the expiry table once rendered a day early.
  sopSchedule:      ()           => request('GET', '/api/admin/sop/schedule'),
  sopScheduleSave:  (row)        => request('PUT', '/api/admin/sop/schedule', row),

  // The ten minutes before a workshop, on one screen. `code` is the promo code
  // the cohort will use; without it the cohort check reports UNKNOWN rather
  // than passing, because "no cohort chosen" is not the same as "the cohort is
  // fine". See server/src/preflight.js.
  // ── Proving the backup, on demand ──────────────────────────────────────
  // Both endpoints existed and neither had a screen. The answer to "are we
  // safe?" should never be "wait a month and find out" — which is exactly what
  // the route's own comment says, on a route nothing could reach.
  backupVerification: ()  => request('GET',  '/api/admin/backup/verification'),
  backupVerifyNow:    ()  => request('POST', '/api/admin/backup/verify', {}),

  // ── The project board Amr and Mohaned share ────────────────────────────
  // Archiving is what the board's button does; deleting is for a row typed by
  // mistake, and the screen says so before it happens.
  projects:        (opts)        => request('GET', `/api/admin/projects${opts?.archived ? '?archived=true' : ''}`),
  projectCreate:   (body)        => request('POST', '/api/admin/projects', body),
  projectUpdate:   (id, body)    => request('PUT', `/api/admin/projects/${id}`, body),
  projectArchive:  (id, archived) => request('POST', `/api/admin/projects/${id}/archive`, { archived }),
  projectDelete:   (id)          => request('DELETE', `/api/admin/projects/${id}`),

  // The advisory line has said "review them once and accept them" since it
  // shipped, and until now there was no way to accept anything — see
  // server/src/sop-routes.js. Preview first: this list is dismissed for ever.
  advisories:       ()           => request('GET',  '/api/admin/sop/advisories'),
  acceptAdvisories: ()           => request('POST', '/api/admin/sop/advisories/accept', {}),

  preflight:    (code)           => request('GET',
    `/api/admin/preflight${code ? `?code=${encodeURIComponent(code)}` : ''}`),

  // Tasks — the board is the single source of truth for what is outstanding.
  tasks:        ()               => request('GET',   '/api/admin/tasks'),
  taskStatus:   (id, status)     => request('PATCH', `/api/admin/tasks/${id}`, { status }),
  // Up/down rather than a number: the client should not need to know the
  // numbering scheme to change the order.
  taskMove:     (id, move)       => request('PATCH', `/api/admin/tasks/${id}`, { move }),

  // ─── Live monitor (Tier 2.1, 2026-08-16) ──────────────────────────
  // What is happening RIGHT NOW, for use during a session. Short absolute
  // windows, never rolling averages — a fault four minutes old matters.
  // `replay` points the same screen at the busiest past hour — the only way
  // to see it populated when nothing is running, and the natural way to
  // review how a finished workshop actually went.
  live:            (opts = {}) => {
    const q = new URLSearchParams();
    if (opts.replay) q.set('replay', '1');
    if (opts.day) { q.set('replay', '1'); q.set('day', opts.day); }
    if (opts.window) q.set('window', String(opts.window));
    return request('GET', `/api/admin/live${q.toString() ? `?${q}` : ''}`);
  },

  // ─── Offers (2026-08-07) ──────────────────────────────────────────
  // Promotions with margin impact from the Costing engine. Like costing,
  // these never charge a customer — approval writes offers + an audit row.
  offersList:        ()          => request('GET',  '/api/offers'),
  offerCreate:       (body)      => request('POST', '/api/offers', body),
  offerUpdate:       (id, body)  => request('PATCH', `/api/offers/${id}`, body),
  // `below_floor_approved` is the deliberate "yes, I know" — the server
  // refuses a below-floor offer without it, and audits it when used.
  offerApprove:      (id, belowFloor = false) =>
    request('POST', `/api/offers/${id}/approve`, { below_floor_approved: belowFloor }),
  offerPause:        (id)        => request('POST', `/api/offers/${id}/pause`),
  offerResume:       (id)        => request('POST', `/api/offers/${id}/resume`),
  offerStats:        (id)        => request('GET',  `/api/offers/${id}/stats`),
  offerMarginImpact: (body)      => request('POST', '/api/offers/margin-impact', body),
  offerSegmentPreview: (filters) => request('POST', '/api/offers/segment/preview', { filters }),
  offerSettings:     (body)      => request('PATCH', '/api/offers/settings', body),

  // ─── Notifications (2026-08-07) ───────────────────────────────────
  // Admin side. The customer's own bell uses the bearer-authenticated client
  // in src/api/, not this cookie-authenticated admin one.
  notificationsState:   ()        => request('GET',   '/api/admin/notifications'),
  notificationsAudience:(body)    => request('POST',  '/api/admin/notifications/audience', body),
  notificationsPreview: (body)    => request('POST',  '/api/admin/notifications/preview', body),
  notificationsSend:    (body)    => request('POST',  '/api/admin/notifications/send', body),
  notificationsAutomation: (key, body) =>
    request('PATCH', `/api/admin/notifications/automations/${key}`, body),
  notificationsSettings:(body)    => request('PATCH', '/api/admin/notifications/settings', body),
  // Sends one real email to the ADMIN address only — proof the chain works
  // before any customer is involved.
  notificationsTestEmail: (kind)  => request('POST', '/api/admin/notifications/test-email', { kind }),

  // ─── Bulk user provisioning ───────────────────────────────────────
  listModels: () => request('GET', '/api/admin/models'),
  bulkCreateUsers: (body) => request('POST', '/api/admin/users/bulk', body),
  // Which of these addresses already have accounts? Read-only — it creates
  // nothing and moves no credits. Answers the question Bulk and promo codes
  // both answer far too late.
  checkUserList: (emails) => request('POST', '/api/admin/users/check-list', { emails }),

  // ── Bulk: credits for accounts that ALREADY exist ────────────────────────
  // Preview first, always: this spends real money, and a confirm box saying
  // "are you sure?" is not consent to $610. Apply sends back the account count
  // the preview showed and is refused if the list moved.
  bulkCreditsPreview: (body) => request('POST', '/api/admin/users/bulk-credits/preview', body),
  bulkCreditsApply: (body) => request('POST', '/api/admin/users/bulk-credits/apply', body),

  // ── Manual credits ───────────────────────────────────────────────────────
  // The ledger, filtered to what a person did by hand. `source` is structural
  // — it cannot be misspelled the way a typed reason can.
  manualCredits: (q = {}) => request('GET', '/api/admin/logs?' + new URLSearchParams(
    Object.entries(q).filter(([, v]) => v !== '' && v != null)).toString()),
  // Labelling the rows written before `source` existed. The preview only
  // looks; apply writes only the total the preview showed.
  creditBackfillPreview: () => request('GET', '/api/admin/credits/backfill-preview'),
  creditBackfillApply: (expectRows) =>
    request('POST', '/api/admin/credits/backfill-apply', { expect_rows: expectRows }),

  // ─── One-shot maintenance ─────────────────────────────────────────
  // These four endpoints existed for days with NOTHING that could call
  // them. A GET can be run by pasting the url in the address bar while
  // signed in; a POST cannot — it needs the CSRF header this client adds.
  // So "built and deployed" meant "unreachable", which is the same shape
  // of mistake as the task board: correct code that never reached a screen.
  mediaHealth:    (sample = 60)  => request('GET',  `/api/admin/media-health?sample=${sample}`),
  mediaRescue:    (body)         => request('POST', '/api/admin/media-rescue', body),
  mediaCors:      ()             => request('POST', '/api/admin/media-cors', {}),
  ledgerAudit:      ()             => request('POST', '/api/admin/ledger-audit', {}),
  onboardingStats:()           => request('GET',  '/api/admin/onboarding-stats'),
  whisperModel:   (force = false)=> request('POST', '/api/admin/whisper-model', { force }),
  thumbsSurvey:   (email)        => request('GET',  `/api/admin/thumbnails/survey?email=${encodeURIComponent(email)}`),
  thumbsBackfill: (body)         => request('POST', '/api/admin/thumbnails/backfill', body),
  // How big is this job across ALL accounts? Read-only, and the thing that
  // has to exist before a background job is switched on for 601 customers.
  thumbsScale:    ()             => request('GET',  '/api/admin/thumbnails/scale'),
  // Answers "was the backup passphrase ever rotated?" without anyone having to
  // remember, and without the passphrase being shown to anybody. Read-only —
  // it decrypts one old archive in memory and writes nothing.
  passphraseCheck:()             => request('POST', '/api/admin/backup/passphrase-check', {}),
  // Old versions of deleted files. The GET writes NOTHING — it describes what
  // would change, and is read before the POST is ever pressed, because the
  // difference between expiring old versions and deleting every live customer
  // file is one word in a JSON body.
  versionExpiryPlan:()           => request('GET',  '/api/admin/version-expiry'),
  versionExpiryApply:()          => request('POST', '/api/admin/version-expiry', {}),

  // ─── Recovery ─────────────────────────────────────────────────────
  // Putting back a customer's deleted work when they cannot do it themselves.
  recoveryList: ({ email = '', text = '', days = '' } = {}) => request('GET',
    `/api/admin/recovery?email=${encodeURIComponent(email)}&text=${encodeURIComponent(text)}&days=${days}`),
  recoveryRestore: (ids) => request('POST', '/api/admin/recovery/restore', { ids }),
};

// Decode a JWT payload WITHOUT verifying its signature. Used only for
// client-side UX (showing role, expiry) — server is the only authority on
// trust. Never gate security decisions on this output.
export function decodeJwt(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const json = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// N3: getStoredUser() lived here and decoded the localStorage token to decide
// whether to render the admin panel — an UNVERIFIED claim, and the reason the
// token had to be stored at all. It is gone on purpose. Admin identity now
// comes from adminApi.me(), which the server answers from the httpOnly cookie.
// Do not reintroduce a client-side role check: the server is the authority.
