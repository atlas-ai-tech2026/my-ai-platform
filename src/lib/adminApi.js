// ─── Admin API client ───────────────────────────────────────────────────────
//
// Thin fetch wrapper that:
//   1. Reads the JWT from localStorage under VOXEL_TOKEN_KEY
//   2. Attaches `Authorization: Bearer ...` to every request
//   3. Throws a typed `ApiError` with `status` and `body` so callers can
//      branch on 401/403/402/etc.
//
// Storing JWT in localStorage is the standard tradeoff for SPA admin panels:
// CSRF-immune (Bearer header is opt-in JS, not a cookie) but vulnerable to
// XSS. Helmet on the server gives us reasonable XSS defaults — combined
// with React's auto-escaping and the fact that this panel only displays
// strings we control (admin-typed reasons are escaped on render), the XSS
// surface is minimal.

export const VOXEL_TOKEN_KEY = 'voxel_token';

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

async function request(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...authHeader(),
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
  stats:       ()                    => request('GET', '/api/admin/stats'),
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
