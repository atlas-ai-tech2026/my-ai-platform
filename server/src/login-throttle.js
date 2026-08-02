// ─── login-throttle.js ───────────────────────────────────────────────────────
// N2 (recheck 2026-08-03): the failed-login throttle was scoped to
// (IP, email). An attacker with a proxy pool got a fresh allowance for every
// address — 30 admin guesses per IP, unlimited IPs, and no lockout anywhere.
// With H5's 2FA unusable from the UI (N1), a password was the only control on
// the admin account.
//
// The verdict below adds a second, ACCOUNT-WIDE ceiling: every failure for one
// email inside the window counts, whatever address produced it. Rotating IPs
// no longer resets anything.
//
// Kept as a pure function (like checkCsrf in admin-session.js) so the decision
// is unit-testable without a database or a live server.

/** Default ceilings, per 15-minute rolling window. */
export const DEFAULT_CEILINGS = {
  user:  { perIp: 10, perAccount: 25 },
  admin: { perIp: 30, perAccount: 50 },
};

/**
 * Decide whether a login attempt must be refused before doing any bcrypt work.
 *
 * @param {number}  fromIp        failures for (this email, this IP) in-window
 * @param {number}  fromAnywhere  failures for this email from ANY IP in-window
 * @param {boolean} isAdmin       is this the admin account?
 * @param {object}  ceilings      override for tests / env tuning
 * @returns {{blocked: boolean, scope: 'ip'|'account'|null}}
 *
 * `scope` is for server-side logging only. The HTTP response must be identical
 * either way: telling an attacker which ceiling tripped tells them whether
 * their proxy rotation is working.
 */
export function loginThrottleVerdict({
  fromIp = 0,
  fromAnywhere = 0,
  isAdmin = false,
  ceilings = DEFAULT_CEILINGS,
} = {}) {
  const c = isAdmin ? ceilings.admin : ceilings.user;
  // Account-wide is reported first: it is the more serious signal (a
  // distributed attempt), and it is the one worth alerting on.
  if (fromAnywhere >= c.perAccount) return { blocked: true, scope: 'account' };
  if (fromIp >= c.perIp) return { blocked: true, scope: 'ip' };
  return { blocked: false, scope: null };
}
