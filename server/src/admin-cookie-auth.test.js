// ─── admin-cookie-auth.test.js ───────────────────────────────────────────────
// N3 (recheck 2026-08-03): H7 built the httpOnly admin cookie and the CSRF
// pair, then kept accepting `Authorization: Bearer` "during the transition".
// The transition never ended, so both H7 protections were inert:
//
//   • the admin JWT stayed in localStorage, readable by any XSS, and
//   • checkCsrf short-circuits to ok for bearer auth, so an attacker replaying
//     a stolen token skipped CSRF entirely.
//
// These tests pin the two halves of the fix: bearer auth is refused on
// /api/admin/*, and cookie auth still has to pass CSRF.

import { describe, it, expect } from 'vitest';
import { checkCsrf } from './admin-session.js';

/** The middleware added to adminGate, in isolation. */
function requireCookieAuth(req, res, next) {
  if (!req.usedCookieAuth) {
    return res.status(401).json({ error: 'Admin session required. Please sign in again.', reauth: true });
  }
  next();
}

function fakeRes() {
  const res = { statusCode: null, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

/** Mirrors middleware/auth.js: a bearer header wins, and marks the request
 *  as NOT cookie-authenticated. */
function usedCookieAuthFor({ bearer, cookie }) {
  return !bearer && !!cookie;
}

describe('N3 — admin routes accept the cookie session only', () => {
  it('refuses a bearer-authenticated admin request', () => {
    const req = { usedCookieAuth: usedCookieAuthFor({ bearer: 'stolen.jwt.value', cookie: null }) };
    const res = fakeRes();
    let reached = false;
    requireCookieAuth(req, res, () => { reached = true; });

    expect(reached).toBe(false);
    expect(res.statusCode).toBe(401);
    expect(res.body.reauth).toBe(true);
  });

  it('refuses a bearer even when a valid cookie is also present', () => {
    // The old order preferred the bearer, so an attacker could force the
    // bearer path — and with it the CSRF bypass — from a victim's browser.
    const req = { usedCookieAuth: usedCookieAuthFor({ bearer: 'stolen.jwt', cookie: 'real.session' }) };
    const res = fakeRes();
    let reached = false;
    requireCookieAuth(req, res, () => { reached = true; });

    expect(reached).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it('allows a cookie-authenticated admin request through', () => {
    const req = { usedCookieAuth: usedCookieAuthFor({ bearer: null, cookie: 'real.session' }) };
    const res = fakeRes();
    let reached = false;
    requireCookieAuth(req, res, () => { reached = true; });

    expect(reached).toBe(true);
    expect(res.statusCode).toBe(null);
  });

  it('still enforces CSRF on the cookie path that is now the only path', () => {
    const usedCookieAuth = usedCookieAuthFor({ bearer: null, cookie: 'real.session' });

    // Write with no CSRF header → rejected.
    expect(checkCsrf({
      method: 'POST', usedCookieAuth, csrfCookie: 'tok', csrfHeader: undefined,
    }).ok).toBe(false);

    // Write with the matching header → allowed.
    expect(checkCsrf({
      method: 'POST', usedCookieAuth, csrfCookie: 'tok', csrfHeader: 'tok',
    }).ok).toBe(true);
  });

  it('documents why the bearer path had to go: it skipped CSRF outright', () => {
    // This is the pre-fix behaviour, kept as a regression witness. If a future
    // change lets bearer auth reach adminGate again, it will ALSO be skipping
    // CSRF — the two failures are the same failure.
    const bearerReq = { usedCookieAuth: usedCookieAuthFor({ bearer: 'x', cookie: 'y' }) };
    expect(checkCsrf({
      method: 'POST', usedCookieAuth: bearerReq.usedCookieAuth,
      csrfCookie: undefined, csrfHeader: undefined,
    }).ok).toBe(true);

    // …which is exactly why requireCookieAuth must reject it first.
    const res = fakeRes();
    requireCookieAuth(bearerReq, res, () => {});
    expect(res.statusCode).toBe(401);
  });
});
