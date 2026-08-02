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
  createGiftCards: (body) => request('POST', '/api/admin/giftcards', body),
  listGiftCards: (status = 'all') => request('GET', `/api/admin/giftcards?status=${status}`),

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

// N3: getStoredUser() lived here and decoded the localStorage token to decide
// whether to render the admin panel — an UNVERIFIED claim, and the reason the
// token had to be stored at all. It is gone on purpose. Admin identity now
// comes from adminApi.me(), which the server answers from the httpOnly cookie.
// Do not reintroduce a client-side role check: the server is the authority.
