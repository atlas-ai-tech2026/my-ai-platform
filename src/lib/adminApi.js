// ─── Admin API client ───────────────────────────────────────────────────────
//
// Thin fetch wrapper that:
//   1. Reads the JWT from localStorage under VOXEL_TOKEN_KEY
//   2. Attaches `Authorization: Bearer ...` to every request
//   3. Throws a typed `ApiError` with `status` and `body` so callers can
//      branch on 401/403/402/etc.
//
// H7 (security audit 2026-07-28): the admin session is now ALSO issued as an
// httpOnly, Secure, SameSite=Strict cookie that page JavaScript cannot read,
// so an XSS bug can no longer exfiltrate the admin token. Because a cookie
// IS sent automatically by the browser, state-changing admin requests carry
// the double-submit CSRF token (readable `voxel_csrf` cookie echoed in the
// X-CSRF-Token header); the server rejects a cookie-authenticated write
// without it.
//
// The bearer header is still sent during the transition so an admin tab
// opened before this deploy keeps working. Once every admin client is on
// cookies, VOXEL_TOKEN_KEY can stop holding the admin token entirely.

export const VOXEL_TOKEN_KEY = 'voxel_token';
export const CSRF_COOKIE = 'voxel_csrf';

export class ApiError extends Error {
  constructor(status, body, message) {
    super(message || body?.error || `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

function authHeader() {
  const token = localStorage.getItem(VOXEL_TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

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
      ...authHeader(),
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
  login:    (email, password) => request('POST', '/api/auth/login', { email, password }),
  register: (email, password) => request('POST', '/api/auth/register', { email, password }),

  // ─── Admin endpoints (require role='admin' on server) ─────────────
  listUsers:   (page = 1, limit = 50) => request('GET', `/api/admin/users?page=${page}&limit=${limit}`),
  searchUsers: (email)               => request('GET', `/api/admin/users/search?email=${encodeURIComponent(email)}`),
  updateCredits: (id, { amount, action, reason }) =>
    request('POST', `/api/admin/users/${id}/credits`, { amount, action, reason }),
  setBan:      (id, banned, reason)  => request('POST', `/api/admin/users/${id}/ban`, { banned, reason }),
  resetPassword: (id, newPassword)   => request('POST', `/api/admin/users/${id}/reset-password`, { new_password: newPassword }),
  history:     (id, limit = 10000)   => request('GET', `/api/admin/users/${id}/history?limit=${limit}`),
  auditRefunds: ()                   => request('GET', '/api/admin/audit/refunds'),
  stats:       ()                    => request('GET', '/api/admin/stats'),

  // ─── Logs + API Usage (kie.ai-style pages) ────────────────────────
  logs: (params = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
    ).toString();
    return request('GET', `/api/admin/logs${qs ? '?' + qs : ''}`);
  },
  usage: (from, to) => {
    const qs = new URLSearchParams({ ...(from && { from }), ...(to && { to }) }).toString();
    return request('GET', `/api/admin/usage${qs ? '?' + qs : ''}`);
  },
  kieBalance: () => request('GET', '/api/admin/kie-balance'),

  // ─── Promo codes + gift cards ─────────────────────────────────────
  createPromo: (body)   => request('POST', '/api/admin/promocodes', body),
  listPromos:  ()       => request('GET', '/api/admin/promocodes'),
  togglePromo: (id)     => request('POST', `/api/admin/promocodes/${id}/toggle`),
  // Only description + expiry are editable server-side; credits and the code
  // itself stay locked so the credit ledger cannot disagree with the code.
  updatePromo: (id, body) => request('PATCH', `/api/admin/promocodes/${id}`, body),
  promoRedemptions: (id) => request('GET', `/api/admin/promocodes/${id}/redemptions`),
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
  costingSaveDraft:(plans)       => request('PUT',    '/api/costing/plans/draft', { plans }),
  costingApprove:  ()            => request('POST',   '/api/costing/plans/approve'),
  costingDiscard:  ()            => request('DELETE', '/api/costing/plans/draft'),

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

  // ─── Bulk user provisioning ───────────────────────────────────────
  listModels: () => request('GET', '/api/admin/models'),
  bulkCreateUsers: (body) => request('POST', '/api/admin/users/bulk', body),
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

export function getStoredUser() {
  const token = localStorage.getItem(VOXEL_TOKEN_KEY);
  const payload = decodeJwt(token);
  if (!payload) return null;
  // exp is seconds-since-epoch
  if (payload.exp && payload.exp * 1000 < Date.now()) {
    localStorage.removeItem(VOXEL_TOKEN_KEY);
    return null;
  }
  return { id: payload.sub, email: payload.email, role: payload.role || 'user', exp: payload.exp };
}
