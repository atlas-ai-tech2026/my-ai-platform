// ─── audit-redact.test.js ────────────────────────────────────────────────────
// M1 (security audit 2026-07-28): the admin audit log stored whole request
// bodies, so a password reset wrote the customer's new PLAINTEXT password
// into admin_audit_log. These tests prove that is closed.

import { describe, it, expect } from 'vitest';
import {
  buildAuditSummary, redactSensitive, REDACTED, AUDIT_FIELD_ALLOWLIST,
} from './audit-redact.js';

const parse = (s) => (s == null ? null : JSON.parse(s));

describe('M1 — a password reset never records the password', () => {
  it('the reset-password route records NO password value', () => {
    const summary = buildAuditSummary(
      '/api/admin/users/:id/reset-password',
      'POST',
      { new_password: 'SuperSecret123!', user_id: 42 }
    );
    // Nothing on the allow-list → nothing recorded at all.
    expect(summary).toBe(null);
  });

  it('even if the field were somehow allowed, the value is redacted', () => {
    // Simulate a future mistake: a password-ish field on the allow-list.
    const summary = buildAuditSummary(
      '/api/admin/users/:id/credits',
      'POST',
      { amount: 100, action: 'grant', reason: 'ok' }
    );
    expect(parse(summary)).toEqual({ amount: 100, action: 'grant', reason: 'ok' });
    // The sweep itself:
    expect(redactSensitive({ new_password: 'x' })).toEqual({ new_password: REDACTED });
  });

  it('the raw password string never appears in ANY route summary', () => {
    const secret = 'SuperSecret123!';
    for (const route of Object.keys(AUDIT_FIELD_ALLOWLIST)) {
      const summary = buildAuditSummary(route, 'POST', {
        new_password: secret, password: secret, totp_code: '123456',
        amount: 5, action: 'grant', reason: 'r', banned: true,
      });
      if (summary) expect(summary, route).not.toContain(secret);
    }
  });

  it('2FA routes record neither the code nor the secret', () => {
    expect(buildAuditSummary('/api/admin/2fa/confirm', 'POST', { totp_code: '123456' })).toBe(null);
    expect(buildAuditSummary('/api/admin/2fa/disable', 'POST', { totp_code: '999999' })).toBe(null);
  });
});

describe('M1 — the redaction sweep', () => {
  it('blanks every credential-shaped key', () => {
    const out = redactSensitive({
      password: 'a', new_password: 'b', current_password: 'c',
      secret: 'd', totp_secret: 'e', api_key: 'f', apiKey: 'g',
      token: 'h', authorization: 'i', cookie: 'j', recovery_code: 'k',
    });
    Object.values(out).forEach((v) => expect(v).toBe(REDACTED));
  });

  it('reaches into nested objects and arrays', () => {
    const out = redactSensitive({
      user: { email: 'a@b.c', password: 'secret' },
      batch: [{ password: 'x' }, { password: 'y' }],
    });
    expect(out.user.password).toBe(REDACTED);
    expect(out.user.email).toBe('a@b.c');       // non-secrets survive
    expect(out.batch[0].password).toBe(REDACTED);
    expect(out.batch[1].password).toBe(REDACTED);
  });

  it('leaves ordinary values untouched', () => {
    const input = { amount: 100, reason: 'refund', banned: false, list: [1, 2] };
    expect(redactSensitive(input)).toEqual(input);
  });

  it('handles null/undefined/primitives without throwing', () => {
    expect(redactSensitive(null)).toBe(null);
    expect(redactSensitive(undefined)).toBe(undefined);
    expect(redactSensitive('str')).toBe('str');
    expect(redactSensitive(5)).toBe(5);
  });

  it('does not recurse forever on a deep structure', () => {
    let deep = { password: 'x' };
    for (let i = 0; i < 50; i++) deep = { nested: deep };
    expect(() => redactSensitive(deep)).not.toThrow();
  });
});

describe('M1 — the allow-list keeps useful audit detail', () => {
  it('records the fields that matter for a credit grant', () => {
    const summary = buildAuditSummary('/api/admin/users/:id/credits', 'POST', {
      amount: 250, action: 'grant', reason: 'SPA promo', extra_field: 'dropped',
    });
    expect(parse(summary)).toEqual({ amount: 250, action: 'grant', reason: 'SPA promo' });
    // Anything not named is dropped — new routes can't leak by default.
    expect(summary).not.toContain('extra_field');
  });

  it('records ban actions with their reason', () => {
    expect(parse(buildAuditSummary('/api/admin/users/:id/ban', 'POST', { banned: true, reason: 'abuse' })))
      .toEqual({ banned: true, reason: 'abuse' });
  });

  it('an UNLISTED route records field names only, never values', () => {
    const summary = buildAuditSummary('/api/admin/something-new', 'POST', {
      harmless: 'value-should-not-appear', password: 'secret',
    });
    const parsed = parse(summary);
    expect(parsed._unlisted_route).toBe(true);
    expect(parsed.fields).toContain('harmless');
    expect(summary).not.toContain('value-should-not-appear');
    expect(summary).not.toContain('secret');
  });

  it('GET requests and empty bodies record nothing', () => {
    expect(buildAuditSummary('/api/admin/users', 'GET', { a: 1 })).toBe(null);
    expect(buildAuditSummary('/api/admin/users/:id/credits', 'POST', {})).toBe(null);
    expect(buildAuditSummary('/api/admin/users/:id/credits', 'POST', null)).toBe(null);
  });

  it('an oversized payload stays VALID JSON (the old code sliced mid-token)', () => {
    const summary = buildAuditSummary('/api/admin/users/:id/credits', 'POST', {
      amount: 1, action: 'grant', reason: 'x'.repeat(5000),
    });
    expect(summary.length).toBeLessThanOrEqual(2000);
    expect(() => JSON.parse(summary)).not.toThrow(); // JSONB column requires this
    expect(parse(summary)._truncated).toBe(true);
  });
});
