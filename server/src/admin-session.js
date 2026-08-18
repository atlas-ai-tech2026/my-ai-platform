// ─── admin-session.js ────────────────────────────────────────────────────────
// H7 (security audit 2026-07-28): the admin JWT lived in localStorage, where
// any XSS on the page could read it and take over the CRM. The admin session
// now travels in an httpOnly cookie the page's JavaScript cannot read.
//
// Two cookies, the standard "double submit" pair:
//   voxel_admin  httpOnly, Secure, SameSite=Strict — the JWT. Never readable
//                by JS, so XSS cannot exfiltrate it.
//   voxel_csrf   readable by JS, same value as a claim inside the session.
//                State-changing admin routes require it echoed in the
//                X-CSRF-Token header. A cross-site attacker can make the
//                browser SEND the cookie but cannot READ it to set the
//                header, so forged requests fail.
//
// SameSite=Strict alone already blocks nearly all CSRF; the token is the
// belt-and-braces layer the audit asked for.

import crypto from 'node:crypto';

export const ADMIN_COOKIE = 'voxel_admin';
export const CSRF_COOKIE = 'voxel_csrf';
export const CSRF_HEADER = 'x-csrf-token';

// Secure cookies require HTTPS. Allow plain HTTP only for local dev, where
// there is no TLS to attach the cookie to.
const isProd = () => process.env.NODE_ENV === 'production';

export function newCsrfToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function serializeCookie(name, value, { maxAgeSeconds, httpOnly }) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'SameSite=Strict',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (httpOnly) parts.push('HttpOnly');
  if (isProd()) parts.push('Secure');
  return parts.join('; ');
}

/** Attach the admin session + CSRF cookies to a login response. */
export function setAdminSessionCookies(res, { token, csrfToken, maxAgeSeconds = 30 * 60 }) {
  res.append('Set-Cookie', serializeCookie(ADMIN_COOKIE, token, { maxAgeSeconds, httpOnly: true }));
  res.append('Set-Cookie', serializeCookie(CSRF_COOKIE, csrfToken, { maxAgeSeconds, httpOnly: false }));
}

// ─── sliding sessions ───────────────────────────────────────────────────────
// The 30-minute admin session was chosen so a stolen token had a small window.
// The reasoning was sound; the behaviour was not. On 2026-08-17 the owner was
// signed in for over two hours, and the panel answered by rendering an EMPTY
// customer screen — so a routine timeout looked exactly like losing every
// customer record.
//
// A fixed window also protects less than it appears to: an attacker holding a
// live cookie is, by definition, active, so they keep whatever window exists.
// The people a short fixed window reliably logs out are the ones working.
//
// So: the window now measures INACTIVITY. Two hours idle ends the session; an
// admin who keeps working is renewed silently and is never interrupted
// mid-task. Same protection against an abandoned session, without the failure
// mode that started this.
export const ADMIN_SESSION_SECONDS = 2 * 60 * 60;
/** Renew once the token is this far through its life. */
export const RENEW_AFTER_RATIO = 0.5;

/**
 * Should this still-valid admin token be re-issued?
 *
 * Pure, so every boundary below is testable without Express or a clock.
 * @param {{iat:number, exp:number, now?:number}} t  seconds since epoch
 */
export function shouldRenewSession({ iat, exp, now = Math.floor(Date.now() / 1000) }) {
  if (!Number.isFinite(iat) || !Number.isFinite(exp) || exp <= iat) return false;
  if (now >= exp) return false;          // already expired: renewing is re-issuing a dead session
  return (now - iat) >= (exp - iat) * RENEW_AFTER_RATIO;
}

/** Clear both cookies (logout, or a rejected session). */
export function clearAdminSessionCookies(res) {
  res.append('Set-Cookie', serializeCookie(ADMIN_COOKIE, '', { maxAgeSeconds: 0, httpOnly: true }));
  res.append('Set-Cookie', serializeCookie(CSRF_COOKIE, '', { maxAgeSeconds: 0, httpOnly: false }));
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * The CSRF decision, as a pure function so it is testable without Express.
 *
 * Only applies to COOKIE-authenticated requests: a bearer token is not sent
 * automatically by the browser, so a request carrying one cannot be forged
 * cross-site and needs no CSRF token.
 *
 * @returns { ok: true } | { ok: false, reason }
 */
export function checkCsrf({ method, usedCookieAuth, csrfCookie, csrfHeader }) {
  if (!usedCookieAuth) return { ok: true };            // bearer auth — not forgeable
  if (SAFE_METHODS.has(String(method || '').toUpperCase())) return { ok: true };

  const cookie = String(csrfCookie || '');
  const header = String(csrfHeader || '');
  if (!cookie || !header) {
    return { ok: false, reason: 'Missing CSRF token.' };
  }
  const a = Buffer.from(cookie);
  const b = Buffer.from(header);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: 'CSRF token mismatch.' };
  }
  return { ok: true };
}
