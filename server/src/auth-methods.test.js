// ─── auth-methods.test.js ────────────────────────────────────────────────────
// /api/auth/methods tells the sign-in screen which methods actually work.
//
// It exists because the login modal hard-coded `live: true` for Google and
// Microsoft. On a deploy landing before the OAuth credentials do — exactly the
// production situation on 2026-08-11, where none of GOOGLE_*, MICROSOFT_*,
// RESEND_API_KEY were set — every customer would have seen two prominent
// buttons that bounce to an error page, and a password reset that confirms
// "check your email" and sends nothing.
//
// Two properties matter, and they pull in opposite directions:
//   · it must be ACCURATE, or the UI is wrong in one direction or the other
//   · it must leak NOTHING — no variable names, no values, no "missing" hints.
//     It is public and unauthenticated by necessity (the sign-in screen is
//     seen by people who are not signed in).

import { describe, it, expect } from 'vitest';
import { googleConfigured, googleRedirectUri } from './google-auth.js';
import { microsoftConfigured, microsoftRedirectUri } from './microsoft-auth.js';
import { mailConfigured } from './mailer.js';

/**
 * Mirrors the route exactly. Credentials ALONE are not enough — a provider
 * without a redirect URI fails at the OAuth round trip, which is precisely the
 * half-configured state that renders a button that cannot work. Writing this
 * helper as credentials-only is what the first version of this test got wrong.
 */
function methodsFor(env) {
  return {
    google: googleConfigured(env) && !!googleRedirectUri(env),
    microsoft: microsoftConfigured(env) && !!microsoftRedirectUri(env),
    password_reset: mailConfigured(env),
  };
}

const FULL_GOOGLE = {
  GOOGLE_CLIENT_ID: 'id.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'secret',
  GOOGLE_REDIRECT_URI: 'https://voxel-ai.ai/api/auth/google/callback',
};
const FULL_MICROSOFT = {
  MICROSOFT_CLIENT_ID: 'mid',
  MICROSOFT_CLIENT_SECRET: 'msecret',
  MICROSOFT_REDIRECT_URI: 'https://voxel-ai.ai/api/auth/microsoft/callback',
};
const FULL_MAIL = { RESEND_API_KEY: 're_key', MAIL_FROM: 'no-reply@voxel-ai.ai' };

describe('an unconfigured server offers nothing', () => {
  // This is the production state as of 2026-08-11 — the case that matters.
  it('reports every method false when no credentials are set', () => {
    expect(methodsFor({})).toEqual({ google: false, microsoft: false, password_reset: false });
  });

  it('stays false when a variable is present but empty or whitespace', () => {
    const blank = { GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '   ', RESEND_API_KEY: '' };
    const m = methodsFor(blank);
    expect(m.google).toBe(false);
    expect(m.password_reset).toBe(false);
  });

  // Half-configured is the dangerous middle: enough to render a button, not
  // enough for it to work.
  it('refuses a partially configured provider', () => {
    expect(methodsFor({ GOOGLE_CLIENT_ID: 'id' }).google).toBe(false);
    expect(methodsFor({ MICROSOFT_CLIENT_ID: 'id' }).microsoft).toBe(false);
  });

  // Credentials without a redirect URI is the sharpest version of the trap:
  // googleConfigured() alone returns TRUE here, so a check that stopped there
  // would light the button up on a server that cannot complete the round trip.
  // Production today has neither GOOGLE_REDIRECT_URI nor PUBLIC_BASE_URL.
  it('refuses credentials that have no redirect URI', () => {
    expect(googleConfigured({ GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 's' })).toBe(true);
    expect(methodsFor({ GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 's' }).google).toBe(false);
    expect(methodsFor({ MICROSOFT_CLIENT_ID: 'i', MICROSOFT_CLIENT_SECRET: 's' }).microsoft).toBe(false);
  });

  // PUBLIC_BASE_URL is the other way to supply it — one variable instead of two.
  it('accepts PUBLIC_BASE_URL in place of an explicit redirect URI', () => {
    const m = methodsFor({
      GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 's',
      PUBLIC_BASE_URL: 'https://voxel-ai.ai',
    });
    expect(m.google).toBe(true);
  });
});

describe('a configured server offers exactly what it has', () => {
  it('turns each method on independently', () => {
    expect(methodsFor(FULL_GOOGLE).google).toBe(true);
    expect(methodsFor(FULL_GOOGLE).microsoft).toBe(false);
    expect(methodsFor(FULL_MICROSOFT).microsoft).toBe(true);
    expect(methodsFor(FULL_MICROSOFT).google).toBe(false);
    expect(methodsFor(FULL_MAIL).password_reset).toBe(true);
  });

  it('reports all three when everything is set', () => {
    expect(methodsFor({ ...FULL_GOOGLE, ...FULL_MICROSOFT, ...FULL_MAIL }))
      .toEqual({ google: true, microsoft: true, password_reset: true });
  });
});

describe('it must not leak configuration', () => {
  it('returns booleans only — no names, no values, no reasons', () => {
    const body = methodsFor({ ...FULL_GOOGLE, ...FULL_MICROSOFT, ...FULL_MAIL });
    for (const v of Object.values(body)) expect(typeof v).toBe('boolean');
    const json = JSON.stringify(body);
    // Nothing identifying may appear — not the secret, not the client id,
    // not the variable names that would tell someone what to go looking for.
    expect(json).not.toMatch(/secret|CLIENT_ID|RESEND|re_key|googleusercontent|voxel-ai\.ai/i);
    expect(Object.keys(body).sort()).toEqual(['google', 'microsoft', 'password_reset']);
  });

  it('answers identically whether a method is off because it is unset or misconfigured', () => {
    const unset = methodsFor({});
    const partial = methodsFor({ GOOGLE_CLIENT_ID: 'id', MICROSOFT_CLIENT_SECRET: 'x' });
    expect(JSON.stringify(unset)).toBe(JSON.stringify(partial));
  });
});
