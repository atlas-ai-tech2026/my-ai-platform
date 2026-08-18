// ─── origin-guard.test.js ────────────────────────────────────────────────────
// The dangerous branch of a guard is the one that lets a request THROUGH, so
// most of these test what it allows rather than what it blocks.
//
// The second danger is specific to this guard: enforcing before Cloudflare is
// configured takes the whole site down. A security control whose first act is
// an outage gets removed rather than fixed, so "inert until configured" is
// asserted here as a feature, not tolerated as a gap.

import { describe, it, expect } from 'vitest';
import {
  verdictFor, secretMatches, guardConfigured, originSecret,
  ORIGIN_HEADER, ALWAYS_ALLOWED,
} from './origin-guard.js';

const SECRET = 'a-long-enough-shared-secret-value';

describe('inert until it is configured', () => {
  it('allows everything when no secret is set', () => {
    expect(verdictFor({ path: '/api/anything', header: null, secret: '' }))
      .toEqual({ allow: true, reason: 'not-configured' });
  });

  // A short secret is not a secret, and half-enforcement is worse than none:
  // it blocks real users while a guesser walks through.
  it('stays inert on a secret too short to be one', () => {
    expect(verdictFor({ path: '/api/x', header: null, secret: 'short' }).allow).toBe(true);
    expect(guardConfigured({ ORIGIN_SHARED_SECRET: 'short' })).toBe(false);
    expect(guardConfigured({ ORIGIN_SHARED_SECRET: SECRET })).toBe(true);
  });

  it('reads and trims the secret from the environment', () => {
    expect(originSecret({ ORIGIN_SHARED_SECRET: `  ${SECRET}  ` })).toBe(SECRET);
    expect(originSecret({})).toBe('');
  });
});

describe('once configured', () => {
  it('allows a request carrying the right secret', () => {
    expect(verdictFor({ path: '/api/x', header: SECRET, secret: SECRET }))
      .toEqual({ allow: true, reason: 'verified' });
  });

  // The whole point: this is the request that was reaching production.
  it('REFUSES a request with no header — the direct-to-origin case', () => {
    expect(verdictFor({ path: '/api/pricing', header: null, secret: SECRET }))
      .toEqual({ allow: false, reason: 'missing-header' });
  });

  it('refuses a wrong secret', () => {
    expect(verdictFor({ path: '/api/x', header: 'wrong-but-long-enough-value', secret: SECRET }))
      .toEqual({ allow: false, reason: 'bad-secret' });
  });

  it('refuses an empty header rather than treating it as absent-and-fine', () => {
    expect(verdictFor({ path: '/api/x', header: '', secret: SECRET }).allow).toBe(false);
  });
});

describe('the health probe must never be blocked', () => {
  // DigitalOcean probes the container directly and cannot carry a Cloudflare
  // header. Blocking it makes the platform judge the app unhealthy and restart
  // it forever — an outage caused by a security header.
  it('always allows the health path, even with no header', () => {
    expect(verdictFor({ path: '/api/health', header: null, secret: SECRET }))
      .toEqual({ allow: true, reason: 'always-allowed' });
  });

  it('keeps the allow-list to exactly what the platform needs', () => {
    expect(ALWAYS_ALLOWED).toEqual(['/api/health']);
  });

  // A prefix match would open /api/health-and-everything-else.
  it('matches the health path exactly, not as a prefix', () => {
    expect(verdictFor({ path: '/api/healthz', header: null, secret: SECRET }).allow).toBe(false);
    expect(verdictFor({ path: '/api/health/secret', header: null, secret: SECRET }).allow).toBe(false);
  });
});

describe('secretMatches', () => {
  it('accepts an exact match and rejects everything else', () => {
    expect(secretMatches(SECRET, SECRET)).toBe(true);
    expect(secretMatches(`${SECRET}x`, SECRET)).toBe(false);
    expect(secretMatches(SECRET.slice(0, -1), SECRET)).toBe(false);
  });

  it('never treats empty as a match', () => {
    for (const [a, b] of [['', ''], ['', SECRET], [SECRET, ''], [null, null], [undefined, SECRET]]) {
      expect(secretMatches(a, b), `${a} vs ${b}`).toBe(false);
    }
  });

  it('compares in constant time — length is checked before the comparison', () => {
    // timingSafeEqual throws on unequal lengths; returning false rather than
    // throwing is what keeps the middleware from 500-ing on a probe.
    expect(() => secretMatches('a', 'bbbbbbbb')).not.toThrow();
  });
});

describe('the header name', () => {
  it('is lowercase, because Express lowercases incoming header names', () => {
    expect(ORIGIN_HEADER).toBe(ORIGIN_HEADER.toLowerCase());
  });
});
