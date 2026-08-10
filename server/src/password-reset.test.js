// ─── password-reset.test.js ──────────────────────────────────────────────────
// A reset endpoint is the most attackable thing on a login page: it accepts an
// arbitrary email from anyone, and it hands out account access. The tests below
// are weighted to the four ways it goes wrong in the wild.
//
//   · the token stored in plain text  → a leaked backup opens every account
//   · a reusable token                → forwarded mail becomes a permanent key
//   · a token with no expiry          → an old inbox is a standing back door
//   · a response that differs for a real vs unknown address → free user list
//
// That last one is finding N11 in a worse place: sign-up leaked existence and
// was only slowed down. A reset endpoint is a far easier oracle to query, so it
// must be genuinely indistinguishable, not merely rate-limited.

import { describe, it, expect, vi } from 'vitest';
import {
  newResetToken, hashResetToken, resetExpiry, resetUrl, passwordProblem,
  createReset, consumeReset, resetEmailBody, NEUTRAL_REPLY, RESET_TTL_MS,
} from './password-reset.js';

describe('the token itself', () => {
  it('is long and random — two calls never collide', () => {
    const seen = new Set();
    for (let i = 0; i < 500; i++) seen.add(newResetToken().token);
    expect(seen.size).toBe(500);
    expect([...seen][0].length).toBeGreaterThanOrEqual(40);
  });

  it('is URL-safe, so it survives any mail client', () => {
    for (let i = 0; i < 100; i++) {
      expect(newResetToken().token).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  // The whole point: the database never holds anything usable.
  it('is stored only as a hash — the raw token appears nowhere', () => {
    const { token, hash } = newResetToken();
    expect(hash).toHaveLength(64);
    expect(hash).not.toContain(token);
    expect(hash).toBe(hashResetToken(token));
  });

  it('hashing is deterministic, so lookup works, and specific to the token', () => {
    expect(hashResetToken('abc')).toBe(hashResetToken('abc'));
    expect(hashResetToken('abc')).not.toBe(hashResetToken('abd'));
  });

  it('expires in one hour', () => {
    const now = Date.now();
    expect(resetExpiry(now).getTime() - now).toBe(RESET_TTL_MS);
    expect(RESET_TTL_MS).toBe(3600000);
  });
});

describe('redeeming a token', () => {
  /** A pool whose UPDATE ... RETURNING matches only an unused, unexpired row. */
  function fakePool(rows) {
    const calls = [];
    return {
      calls,
      query: vi.fn(async (sql, params) => {
        calls.push({ sql, params });
        if (/UPDATE password_resets/.test(sql) && /RETURNING user_id/.test(sql)) {
          return { rows: rows.splice(0, 1) };   // first call wins, second gets none
        }
        return { rows: [] };
      }),
    };
  }

  it('accepts a valid token once and returns the account', async () => {
    const pool = fakePool([{ user_id: 42 }]);
    expect(await consumeReset(pool, 'good-token')).toEqual({ ok: true, userId: 42 });
  });

  // Two people (or two clicks) racing must not both get in.
  it('is single-use — the second attempt fails', async () => {
    const pool = fakePool([{ user_id: 42 }]);
    expect((await consumeReset(pool, 'good-token')).ok).toBe(true);
    expect((await consumeReset(pool, 'good-token')).ok).toBe(false);
  });

  // A SELECT-then-UPDATE would let both racing requests through. One statement
  // that checks and consumes together is what makes that impossible.
  it('checks and consumes in ONE statement, not two', async () => {
    const pool = fakePool([{ user_id: 1 }]);
    await consumeReset(pool, 'tok');
    const redeem = pool.calls.find((c) => /RETURNING user_id/.test(c.sql));
    expect(redeem.sql).toMatch(/UPDATE password_resets/);
    expect(redeem.sql).toMatch(/used_at IS NULL/);
    expect(redeem.sql).toMatch(/expires_at > NOW\(\)/);
    expect(pool.calls.filter((c) => /^\s*SELECT/i.test(c.sql))).toHaveLength(0);
  });

  it('never sends the raw token to the database', async () => {
    const pool = fakePool([{ user_id: 1 }]);
    await consumeReset(pool, 'my-secret-token');
    for (const c of pool.calls) {
      expect(JSON.stringify(c.params)).not.toContain('my-secret-token');
    }
  });

  it('refuses junk without touching the database', async () => {
    for (const bad of [null, undefined, '', 123, {}]) {
      const pool = fakePool([{ user_id: 1 }]);
      expect((await consumeReset(pool, bad)).ok).toBe(false);
      expect(pool.query).not.toHaveBeenCalled();
    }
  });
});

describe('requesting a reset', () => {
  it('kills any earlier unused token for that account first', async () => {
    const calls = [];
    const pool = { query: vi.fn(async (sql, params) => { calls.push({ sql, params }); return { rows: [] }; }) };
    await createReset(pool, 7);
    // Asking twice must not leave two live keys to the same door.
    expect(calls[0].sql).toMatch(/UPDATE password_resets\s+SET used_at/);
    expect(calls[0].sql).toMatch(/used_at IS NULL/);
    expect(calls[1].sql).toMatch(/INSERT INTO password_resets/);
  });

  it('stores the hash, and returns the raw token to the caller only', async () => {
    const calls = [];
    const pool = { query: vi.fn(async (sql, params) => { calls.push({ sql, params }); return { rows: [] }; }) };
    const token = await createReset(pool, 7);
    const insert = calls.find((c) => /INSERT INTO password_resets/.test(c.sql));
    expect(insert.params[1]).toBe(hashResetToken(token));
    expect(insert.params[1]).not.toBe(token);
  });
});

describe('the reply must not reveal whether an account exists', () => {
  // N11 in a worse place. Sign-up leaked existence and was merely slowed;
  // a reset endpoint is a far easier oracle, so it has to be identical.
  it('is one fixed, non-committal sentence', () => {
    expect(NEUTRAL_REPLY.message).toMatch(/if that address has/i);
    expect(NEUTRAL_REPLY.ok).toBe(true);
    // No branch, no "not found", no "we sent you" — nothing to compare.
    expect(JSON.stringify(NEUTRAL_REPLY)).not.toMatch(/not found|unknown|no account|sent to/i);
  });
});

describe('the new password', () => {
  it('must meet the same minimum sign-up requires', () => {
    expect(passwordProblem('short')).toMatch(/at least 8/);
    expect(passwordProblem('')).toMatch(/at least 8/);
    expect(passwordProblem('x'.repeat(201))).toMatch(/too long/);
    expect(passwordProblem('goodenough')).toBeNull();
  });

  it('treats missing input as a failure, not as an empty pass', () => {
    expect(passwordProblem(undefined)).not.toBeNull();
    expect(passwordProblem(null)).not.toBeNull();
  });
});

describe('the link and the message', () => {
  it('points at the site with the token in the query', () => {
    const url = resetUrl('abc-123', { PUBLIC_BASE_URL: 'https://voxel-ai.ai' });
    expect(url).toBe('https://voxel-ai.ai/reset-password?token=abc-123');
  });

  it('escapes a token that would otherwise break the URL', () => {
    expect(resetUrl('a+b/c=', {})).toContain('token=a%2Bb%2Fc%3D');
  });

  it('tolerates a trailing slash in the configured base', () => {
    expect(resetUrl('t', { PUBLIC_BASE_URL: 'https://voxel-ai.ai/' }))
      .toBe('https://voxel-ai.ai/reset-password?token=t');
  });

  // Someone who did NOT request this must be told plainly that ignoring it is
  // safe — otherwise the mail itself reads like a break-in.
  it('tells a non-requester that ignoring it is safe', () => {
    const m = resetEmailBody('https://x/y');
    expect(m.body).toMatch(/wasn't you/i);
    expect(m.body).toMatch(/password stays/i);
    expect(m.body).toMatch(/expires in 1 hour/i);
    expect(m.ctaUrl).toBe('https://x/y');
  });
});
