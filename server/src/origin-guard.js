// ─── origin-guard.js ─────────────────────────────────────────────────────────
// Refuses requests that did not come through Cloudflare.
//
// FOUND AND PROVEN 2026-08-18:
//     curl https://voxel-app-8b9z6.ondigitalocean.app/api/health  →  200
// The DigitalOcean origin answers the public internet directly, so Cloudflare's
// WAF, bot management, DDoS protection and rate limiting can all be walked
// around by anyone who learns that hostname.
//
// This was already known in the abstract. client-ip.js carries the note:
// "the DigitalOcean origin firewall must allow ONLY Cloudflare's ranges." That
// advice fits a Droplet. **App Platform has no origin firewall to lock**, which
// is why the item sat open from July — the recommended fix did not exist for
// this hosting. The workable equivalent is a shared secret that only Cloudflare
// knows, added by a Transform Rule and required here.
//
// ── WHY IT FAILS OPEN, DELIBERATELY ────────────────────────────────────────
// With no secret configured this middleware does NOTHING but log. Enforcing
// before the Cloudflare rule exists would take the whole site down, and a
// security control whose first act is an outage gets removed rather than
// fixed. So the order is: ship inert → add the Cloudflare rule → set the
// secret → enforcement begins. Reversible at every step by clearing one
// variable.
//
// ── WHAT IS ALWAYS ALLOWED ─────────────────────────────────────────────────
// The platform's own health probe reaches the container directly and cannot
// carry a Cloudflare header. Blocking it would make DigitalOcean judge the app
// unhealthy and restart it forever — a self-inflicted outage from a security
// header, which is precisely the sort of own goal worth writing down.

import crypto from 'node:crypto';

export const ORIGIN_HEADER = 'x-voxel-origin';

/** Reachable without the header, whatever happens. */
export const ALWAYS_ALLOWED = ['/api/health'];

export function originSecret(env = process.env) {
  return (env.ORIGIN_SHARED_SECRET || '').trim();
}

export function guardConfigured(env = process.env) {
  return originSecret(env).length >= 16;   // a short secret is not a secret
}

/** Constant-time compare, so a wrong value cannot be found a byte at a time. */
export function secretMatches(presented, expected) {
  const a = Buffer.from(String(presented ?? ''), 'utf8');
  const b = Buffer.from(String(expected ?? ''), 'utf8');
  if (a.length !== b.length || a.length === 0) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * The decision, as a pure function — every branch below is testable without
 * Express, and the dangerous branch is the one that lets a request through.
 *
 * @returns {{allow: boolean, reason: string}}
 */
export function verdictFor({ path, header, secret }) {
  if (!secret || secret.length < 16) {
    return { allow: true, reason: 'not-configured' };      // inert until set
  }
  if (ALWAYS_ALLOWED.includes(path)) {
    return { allow: true, reason: 'always-allowed' };
  }
  if (!header) return { allow: false, reason: 'missing-header' };
  return secretMatches(header, secret)
    ? { allow: true, reason: 'verified' }
    : { allow: false, reason: 'bad-secret' };
}

/**
 * Express middleware.
 *
 * Rejects with 403 and a body that says nothing useful to a prober: a message
 * naming the header would tell an attacker exactly what to forge, and the
 * people who legitimately hit this are Cloudflare (which will have it) or the
 * owner testing (who has this file).
 */
export function originGuard(env = process.env) {
  const secret = originSecret(env);
  if (!guardConfigured(env)) {
    console.warn('[origin-guard] ORIGIN_SHARED_SECRET is not set (or is under 16 chars) — '
      + 'the origin can still be reached directly, bypassing Cloudflare. See origin-guard.js.');
  } else {
    console.log('[origin-guard] active — requests must arrive via Cloudflare');
  }

  return function originGuardMiddleware(req, res, next) {
    const v = verdictFor({
      path: req.path,
      header: req.get(ORIGIN_HEADER),
      secret,
    });
    if (v.allow) return next();
    // Logged so a real misconfiguration is visible, but without echoing the
    // presented value — that is attacker-controlled and would pollute the log.
    console.warn(`[origin-guard] refused ${req.method} ${req.path} (${v.reason})`);
    return res.status(403).json({ error: 'Forbidden.' });
  };
}
