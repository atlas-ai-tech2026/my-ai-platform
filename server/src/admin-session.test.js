// ─── admin-session.test.js ───────────────────────────────────────────────────
// H7 (security audit 2026-07-28): the admin session moved from localStorage
// (readable by any XSS) into an httpOnly cookie, with double-submit CSRF
// protection on state-changing admin routes.

import { describe, it, expect } from 'vitest';
import {
  checkCsrf, newCsrfToken,
  setAdminSessionCookies, clearAdminSessionCookies,
  ADMIN_COOKIE, CSRF_COOKIE, CSRF_HEADER,
} from './admin-session.js';

// Minimal Express `res` stand-in that records Set-Cookie headers.
function fakeRes() {
  const headers = [];
  return { append: (k, v) => headers.push([k, v]), headers };
}

describe('H7 — the admin session cookie is hardened', () => {
  it('the session cookie is HttpOnly and SameSite=Strict (XSS cannot read it)', () => {
    const res = fakeRes();
    setAdminSessionCookies(res, { token: 'jwt.value.here', csrfToken: 'csrf123' });
    const session = res.headers.find(([, v]) => v.startsWith(`${ADMIN_COOKIE}=`))[1];
    expect(session).toContain('HttpOnly');
    expect(session).toContain('SameSite=Strict');
    expect(session).toContain('Path=/');
    expect(session).toContain('jwt.value.here');
  });

  it('the CSRF cookie is deliberately readable (JS must echo it in a header)', () => {
    const res = fakeRes();
    setAdminSessionCookies(res, { token: 't', csrfToken: 'csrf123' });
    const csrf = res.headers.find(([, v]) => v.startsWith(`${CSRF_COOKIE}=`))[1];
    expect(csrf).not.toContain('HttpOnly');
    expect(csrf).toContain('SameSite=Strict');
  });

  it('cookies are marked Secure in production', () => {
    const prev = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      const res = fakeRes();
      setAdminSessionCookies(res, { token: 't', csrfToken: 'c' });
      expect(res.headers.every(([, v]) => v.includes('Secure'))).toBe(true);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it('logout expires both cookies', () => {
    const res = fakeRes();
    clearAdminSessionCookies(res);
    expect(res.headers).toHaveLength(2);
    expect(res.headers.every(([, v]) => v.includes('Max-Age=0'))).toBe(true);
  });

  it('tokens are long and unique', () => {
    const a = newCsrfToken(), b = newCsrfToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(43); // 32 bytes base64url
  });
});

describe('H7 — CSRF protection on state-changing admin routes', () => {
  const token = newCsrfToken();

  it('REJECTS a cookie-authenticated write with NO token (the forged request)', () => {
    const verdict = checkCsrf({
      method: 'POST', usedCookieAuth: true, csrfCookie: token, csrfHeader: undefined,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/missing csrf/i);
  });

  it('REJECTS a mismatched token (attacker guessed the header)', () => {
    const verdict = checkCsrf({
      method: 'POST', usedCookieAuth: true, csrfCookie: token, csrfHeader: newCsrfToken(),
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/mismatch/i);
  });

  it('rejects every state-changing method without a token', () => {
    ['POST', 'PUT', 'PATCH', 'DELETE'].forEach((method) => {
      expect(checkCsrf({ method, usedCookieAuth: true, csrfCookie: token, csrfHeader: '' }).ok, method)
        .toBe(false);
    });
  });

  it('ACCEPTS a matching token (the real admin panel)', () => {
    expect(checkCsrf({
      method: 'POST', usedCookieAuth: true, csrfCookie: token, csrfHeader: token,
    }).ok).toBe(true);
  });

  it('allows safe reads without a token', () => {
    ['GET', 'HEAD', 'OPTIONS'].forEach((method) => {
      expect(checkCsrf({ method, usedCookieAuth: true, csrfCookie: token, csrfHeader: '' }).ok, method)
        .toBe(true);
    });
  });

  it('does not apply to bearer-authenticated requests (not forgeable cross-site)', () => {
    expect(checkCsrf({
      method: 'POST', usedCookieAuth: false, csrfCookie: undefined, csrfHeader: undefined,
    }).ok).toBe(true);
  });

  it('an empty cookie AND empty header does not accidentally pass', () => {
    expect(checkCsrf({ method: 'POST', usedCookieAuth: true, csrfCookie: '', csrfHeader: '' }).ok)
      .toBe(false);
  });

  it('exports the header name the client must send', () => {
    expect(CSRF_HEADER).toBe('x-csrf-token');
  });
});
