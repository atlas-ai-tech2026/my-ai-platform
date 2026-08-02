import { describe, it, expect } from 'vitest';
import { loginThrottleVerdict, DEFAULT_CEILINGS } from './login-throttle.js';

describe('loginThrottleVerdict (N2)', () => {
  it('allows a normal user well under both ceilings', () => {
    expect(loginThrottleVerdict({ fromIp: 3, fromAnywhere: 9 }))
      .toEqual({ blocked: false, scope: null });
  });

  it('blocks a single address that hits the per-IP ceiling', () => {
    expect(loginThrottleVerdict({ fromIp: 10, fromAnywhere: 10 }))
      .toEqual({ blocked: true, scope: 'ip' });
  });

  // The finding itself: 50 proxies × 9 failures each stayed under the old
  // (IP, email) ceiling forever, because every new address reset the count.
  it('blocks distributed guessing that never trips the per-IP ceiling', () => {
    const verdict = loginThrottleVerdict({ fromIp: 1, fromAnywhere: 25 });
    expect(verdict.blocked).toBe(true);
    expect(verdict.scope).toBe('account');
  });

  it('gives the admin a looser per-IP ceiling but still a hard account cap', () => {
    // 20 failures from one address: fine for admin, blocked for a user.
    expect(loginThrottleVerdict({ fromIp: 20, fromAnywhere: 20, isAdmin: true }).blocked).toBe(false);
    expect(loginThrottleVerdict({ fromIp: 20, fromAnywhere: 20, isAdmin: false }).blocked).toBe(true);
    // But the admin account cannot be guessed indefinitely across addresses.
    expect(loginThrottleVerdict({ fromIp: 2, fromAnywhere: 50, isAdmin: true }))
      .toEqual({ blocked: true, scope: 'account' });
  });

  it('reports account scope ahead of ip scope when both are tripped', () => {
    expect(loginThrottleVerdict({ fromIp: 99, fromAnywhere: 99 }).scope).toBe('account');
  });

  it('treats missing counters as zero rather than blocking', () => {
    expect(loginThrottleVerdict().blocked).toBe(false);
    expect(loginThrottleVerdict({}).blocked).toBe(false);
  });

  it('keeps the account ceiling above the per-IP ceiling for both roles', () => {
    // A real user's typos must never trip the account-wide lockout first.
    expect(DEFAULT_CEILINGS.user.perAccount).toBeGreaterThan(DEFAULT_CEILINGS.user.perIp);
    expect(DEFAULT_CEILINGS.admin.perAccount).toBeGreaterThan(DEFAULT_CEILINGS.admin.perIp);
  });

  it('honours injected ceilings', () => {
    const ceilings = { user: { perIp: 2, perAccount: 3 }, admin: { perIp: 2, perAccount: 3 } };
    expect(loginThrottleVerdict({ fromIp: 2, fromAnywhere: 2, ceilings }).scope).toBe('ip');
    expect(loginThrottleVerdict({ fromIp: 0, fromAnywhere: 3, ceilings }).scope).toBe('account');
  });
});
