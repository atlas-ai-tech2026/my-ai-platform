// ─── waitlist.test.js ────────────────────────────────────────────────────────
// The bug this replaces is not a crash — it is a screen that said "you'll be
// notified" while dropping the address on the floor. Verified 2026-08-17:
// Edit.jsx validated the email, called toast.success, and made no request at
// all. There was no table and no endpoint.
//
// So these tests are mostly about the shape of that failure: never claim to
// have stored something unless it was stored.

import { describe, it, expect, vi } from 'vitest';
import { normaliseEmail, normaliseSource, addToWaitlist, WAITLIST_SOURCES } from './waitlist.js';

describe('normaliseEmail', () => {
  it('accepts ordinary addresses and lowercases them', () => {
    expect(normaliseEmail('  Someone@Example.COM ')).toBe('someone@example.com');
    expect(normaliseEmail('a.b+tag@sub.domain.co.uk')).toBe('a.b+tag@sub.domain.co.uk');
  });

  it('rejects what genuinely cannot be delivered', () => {
    for (const bad of ['', null, undefined, 'nope', '@example.com', 'a@', 'a@b',
                       'two@at@example.com', 'has space@example.com', 'a@.com', 'a@com.']) {
      expect(normaliseEmail(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  // The OLD check was `email.includes('@')`, which accepted "@" alone. Being
  // permissive is fine; being meaningless is not.
  it('is stricter than the check it replaces', () => {
    expect('@'.includes('@')).toBe(true);
    expect(normaliseEmail('@')).toBeNull();
  });

  it('does not reject valid addresses out of misplaced strictness', () => {
    // Over-strict validation rejects real addresses people actually use.
    for (const ok of ['x@y.io', "o'brien@example.com", 'user_name@example-host.com']) {
      expect(normaliseEmail(ok), ok).not.toBeNull();
    }
  });
});

describe('normaliseSource', () => {
  it('keeps known sources and defaults the rest', () => {
    expect(normaliseSource('edit')).toBe('edit');
    expect(normaliseSource('MOBILE')).toBe('mobile');
    expect(normaliseSource('anything-else')).toBe('edit');
    expect(normaliseSource(undefined)).toBe('edit');
  });

  // An open text field becomes junk within a week and the counts stop meaning
  // anything.
  it('is a closed list', () => {
    expect(WAITLIST_SOURCES).toContain('edit');
    expect(normaliseSource('<script>')).toBe('edit');
  });
});

describe('addToWaitlist', () => {
  const poolWith = (rows) => ({ query: vi.fn().mockResolvedValue({ rows }) });

  it('stores a valid address and reports it was created', async () => {
    const pool = poolWith([{ id: 1 }]);
    const r = await addToWaitlist(pool, { email: 'A@B.com', source: 'edit' });
    expect(r).toEqual({ ok: true, created: true });
    expect(pool.query.mock.calls[0][1][0]).toBe('a@b.com');   // normalised
  });

  it('refuses an invalid address instead of silently accepting it', async () => {
    const pool = poolWith([]);
    const r = await addToWaitlist(pool, { email: 'nope', source: 'edit' });
    expect(r.ok).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });

  // Signing up twice is not two people. The count must mean "how many are
  // waiting", not "how many times a button was pressed".
  it('is idempotent — a repeat signup is not a second person', async () => {
    const r = await addToWaitlist(poolWith([]), { email: 'a@b.com', source: 'edit' });
    expect(r).toEqual({ ok: true, created: false });
  });

  it('truncates a hostile user agent rather than storing it whole', async () => {
    const pool = poolWith([{ id: 1 }]);
    await addToWaitlist(pool, { email: 'a@b.com', source: 'edit', userAgent: 'x'.repeat(5000) });
    expect(pool.query.mock.calls[0][1][4].length).toBe(500);
  });
});
