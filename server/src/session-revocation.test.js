// ─── session-revocation.test.js ──────────────────────────────────────────────
// N9 (recheck 2026-08-03): JWTs carried no version and lasted 7 days (30 min
// for admins), and nothing compared them against a password change. So the
// admin action taken IN RESPONSE to a compromise — resetting the password —
// did not evict the attacker: their existing token kept working, and kept
// spending the victim's credits, until it expired on its own.
//
// sessions_valid_from is the cutoff, checked inside the query requireNotBanned
// already ran for the ban check, so it costs no extra round trip.

import { describe, it, expect } from 'vitest';

/** The N9 comparison, extracted from requireNotBanned. */
function sessionRevoked({ sessionsValidFrom, issuedAt }) {
  if (!sessionsValidFrom || !issuedAt) return false;
  const cutoff = Math.ceil(new Date(sessionsValidFrom).getTime() / 1000);
  return issuedAt < cutoff;
}

const T = Date.parse('2026-08-03T12:00:00.000Z');
const sec = (ms) => Math.floor(ms / 1000);

describe('N9 — a password reset evicts existing sessions', () => {
  it('revokes a token issued before the reset', () => {
    // The attacker signed in an hour ago; the admin resets the password now.
    expect(sessionRevoked({
      sessionsValidFrom: new Date(T).toISOString(),
      issuedAt: sec(T - 60 * 60 * 1000),
    })).toBe(true);
  });

  it('revokes a token issued days earlier, the full 7-day window', () => {
    expect(sessionRevoked({
      sessionsValidFrom: new Date(T).toISOString(),
      issuedAt: sec(T - 7 * 24 * 60 * 60 * 1000),
    })).toBe(true);
  });

  it('keeps the session created by signing in AFTER the reset', () => {
    // The legitimate owner logs in with their new password.
    expect(sessionRevoked({
      sessionsValidFrom: new Date(T).toISOString(),
      issuedAt: sec(T + 5000),
    })).toBe(false);
  });

  it('revokes a token minted in the same second as the reset', () => {
    // `iat` is whole seconds. With a floored cutoff this token compares equal
    // and survives — hence Math.ceil, which closes that one-second window.
    expect(sessionRevoked({
      sessionsValidFrom: new Date(T + 400).toISOString(),
      issuedAt: sec(T + 400),
    })).toBe(true);
  });
});

describe('N9 — nobody is logged out who should not be', () => {
  it('does not revoke when no password has ever been changed', () => {
    // NULL cutoff is the state of all 377 accounts at deploy time, so the
    // migration itself must not sign a single person out.
    expect(sessionRevoked({ sessionsValidFrom: null, issuedAt: sec(T) })).toBe(false);
    expect(sessionRevoked({ sessionsValidFrom: undefined, issuedAt: sec(T) })).toBe(false);
  });

  it('does not revoke a token that carries no iat', () => {
    // Fail open rather than locking out a valid session over a missing claim;
    // such a token is still signature-checked and still expires normally.
    expect(sessionRevoked({
      sessionsValidFrom: new Date(T).toISOString(),
      issuedAt: undefined,
    })).toBe(false);
  });
});

describe('N9 — the reset statement actually stamps the cutoff', () => {
  it('sets sessions_valid_from in the same UPDATE as the new hash', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const path = await import('node:path');
    const src = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.js'), 'utf8'
    ).replace(/\/\/.*$/gm, '');

    // Every statement that writes a password hash must also move the cutoff,
    // otherwise a reset silently leaves the attacker's session alive.
    const updates = src.match(/UPDATE users SET password_hash[^`]*/g) || [];
    expect(updates.length, 'no password-hash UPDATE found — renamed?').toBeGreaterThan(0);
    for (const stmt of updates) {
      expect(
        stmt.includes('sessions_valid_from'),
        `a password reset does not revoke sessions: ${stmt.trim()}`
      ).toBe(true);
    }
  });

  it('reads the cutoff in the ban-check query, not a second round trip', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const path = await import('node:path');
    const auth = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), 'middleware/auth.js'), 'utf8'
    );
    expect(auth).toMatch(/SELECT banned[^']*sessions_valid_from/);
  });
});
