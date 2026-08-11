// ─── google-auth.test.js ─────────────────────────────────────────────────────
// "Sign in with Google" is an authentication boundary: everything it accepts
// becomes a logged-in session. These tests use a REAL RSA keypair and REAL
// signed tokens, so the signature check is genuinely exercised rather than
// mocked away.
//
// The attacks each test represents are the standard ways OIDC verification is
// got wrong: a token minted for a different app, a token signed by someone
// else, an unverified email address (which would make account linking an
// takeover primitive), algorithm confusion, and CSRF on the round trip.

import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import {
  verifyGoogleIdToken, __resetGoogleKeyCache,
  buildGoogleAuthUrl, newOauthState, stateMatches,
  googleConfigured, missingGoogleVars, googleRedirectUri,
  GOOGLE_SCOPES,
} from './google-auth.js';

const CLIENT_ID = '1234.apps.googleusercontent.com';
const KID = 'test-key-1';

// A real keypair standing in for Google's.
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' };

/** A second keypair — an attacker's. */
const attacker = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });

function fakeJwks(keys = [jwk]) {
  return async () => ({ ok: true, status: 200, json: async () => ({ keys }) });
}

function signIdToken(payload = {}, { key = privateKey, kid = KID, algorithm = 'RS256' } = {}) {
  return jwt.sign(
    {
      iss: 'https://accounts.google.com',
      aud: CLIENT_ID,
      sub: '110000000000000000001',
      email: 'person@example.com',
      email_verified: true,
      name: 'A Person',
      ...payload,
    },
    key,
    { algorithm, keyid: kid, expiresIn: '5m' }
  );
}

beforeEach(() => __resetGoogleKeyCache());

describe('a genuine Google token is accepted', () => {
  it('returns the identity, with the email lower-cased', async () => {
    const token = signIdToken({ email: 'Person@Example.COM' });
    const id = await verifyGoogleIdToken(token, { clientId: CLIENT_ID, fetchImpl: fakeJwks() });
    expect(id.email).toBe('person@example.com');
    expect(id.sub).toBe('110000000000000000001');
    expect(id.name).toBe('A Person');
  });

  it('accepts the bare issuer spelling Google also uses', async () => {
    const token = signIdToken({ iss: 'accounts.google.com' });
    await expect(verifyGoogleIdToken(token, { clientId: CLIENT_ID, fetchImpl: fakeJwks() }))
      .resolves.toMatchObject({ sub: '110000000000000000001' });
  });
});

describe('tokens that must be refused', () => {
  it('refuses a token minted for a DIFFERENT application', async () => {
    // The classic OIDC mistake. Without an audience check, any site using
    // Google login could take a token issued to them and replay it here to
    // become that user on Voxel.
    const token = signIdToken({ aud: 'someone-elses-app.apps.googleusercontent.com' });
    await expect(verifyGoogleIdToken(token, { clientId: CLIENT_ID, fetchImpl: fakeJwks() }))
      .rejects.toThrow(/rejected/i);
  });

  it('refuses a token signed with the wrong key', async () => {
    const token = signIdToken({}, { key: attacker.privateKey });
    await expect(verifyGoogleIdToken(token, { clientId: CLIENT_ID, fetchImpl: fakeJwks() }))
      .rejects.toThrow(/rejected/i);
  });

  it('refuses a forged issuer even when the signature checks out', async () => {
    const token = signIdToken({ iss: 'https://accounts.evil.example' });
    await expect(verifyGoogleIdToken(token, { clientId: CLIENT_ID, fetchImpl: fakeJwks() }))
      .rejects.toThrow(/unexpected issuer/i);
  });

  it('refuses an UNVERIFIED email — this is what makes linking safe', async () => {
    // Account linking matches an existing Voxel account by email address. If
    // an unverified address were accepted, anyone could put someone else's
    // address on a Google account and inherit their Voxel account.
    const token = signIdToken({ email_verified: false });
    await expect(verifyGoogleIdToken(token, { clientId: CLIENT_ID, fetchImpl: fakeJwks() }))
      .rejects.toThrow(/not verified/i);
  });

  it('refuses a token with no email at all', async () => {
    const token = signIdToken({ email: undefined });
    await expect(verifyGoogleIdToken(token, { clientId: CLIENT_ID, fetchImpl: fakeJwks() }))
      .rejects.toThrow(/did not return an email/i);
  });

  it('refuses an expired token', async () => {
    const token = jwt.sign(
      { iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: '1', email: 'a@b.c', email_verified: true },
      privateKey,
      { algorithm: 'RS256', keyid: KID, expiresIn: -60 }
    );
    await expect(verifyGoogleIdToken(token, { clientId: CLIENT_ID, fetchImpl: fakeJwks() }))
      .rejects.toThrow(/rejected/i);
  });

  it('refuses an unsigned "alg: none" token', async () => {
    // Algorithm confusion. Pinning algorithms:['RS256'] is what stops it.
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT', kid: KID })).toString('base64url');
    const body = Buffer.from(JSON.stringify({
      iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: '1',
      email: 'a@b.c', email_verified: true, exp: Math.floor(Date.now() / 1000) + 300,
    })).toString('base64url');
    await expect(verifyGoogleIdToken(`${header}.${body}.`, { clientId: CLIENT_ID, fetchImpl: fakeJwks() }))
      .rejects.toThrow();
  });

  it('refuses a token whose key id Google does not publish', async () => {
    const token = signIdToken({}, { kid: 'not-a-google-key' });
    await expect(verifyGoogleIdToken(token, { clientId: CLIENT_ID, fetchImpl: fakeJwks() }))
      .rejects.toThrow(/unknown key/i);
  });

  it('refuses garbage instead of crashing', async () => {
    for (const bad of ['', 'not.a.token', null, undefined, 42]) {
      await expect(verifyGoogleIdToken(bad, { clientId: CLIENT_ID, fetchImpl: fakeJwks() }))
        .rejects.toThrow();
    }
  });
});

describe('the round trip is CSRF-protected', () => {
  it('state is long, random and never repeats', () => {
    const seen = new Set(Array.from({ length: 200 }, () => newOauthState()));
    expect(seen.size).toBe(200);
    expect([...seen][0].length).toBeGreaterThanOrEqual(24);
  });

  it('matches only an identical state', () => {
    const s = newOauthState();
    expect(stateMatches(s, s)).toBe(true);
    expect(stateMatches(s, newOauthState())).toBe(false);
  });

  it('never throws on mismatched lengths or junk', () => {
    // timingSafeEqual throws on unequal lengths — a crash here would be a
    // denial of service on the callback.
    for (const [a, b] of [['abc', 'abcd'], ['', ''], [null, 'x'], ['x', undefined], [1, 2]]) {
      expect(() => stateMatches(a, b)).not.toThrow();
      expect(stateMatches(a, b)).toBe(false);
    }
  });
});

describe('configuration and scopes', () => {
  it('asks for only the three free scopes', () => {
    // Anything beyond these is "sensitive" or "restricted" and triggers a
    // Google security audit costing USD 540–1000.
    expect(GOOGLE_SCOPES.split(' ').sort()).toEqual(['email', 'openid', 'profile']);
  });

  it('the authorize url carries state and asks for a code, not a token', () => {
    const url = new URL(buildGoogleAuthUrl({
      clientId: CLIENT_ID, redirectUri: 'https://x.example/api/auth/google/callback', state: 'abc',
    }));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('state')).toBe('abc');
    // No refresh token: we authenticate people, we do not act for them later.
    expect(url.searchParams.get('access_type')).toBe('online');
  });

  it('reports itself unconfigured rather than half-working', () => {
    expect(googleConfigured({})).toBe(false);
    expect(googleConfigured({ GOOGLE_CLIENT_ID: 'x' })).toBe(false);
    expect(googleConfigured({ GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'y' })).toBe(true);
    expect(missingGoogleVars({ GOOGLE_CLIENT_ID: 'x' })).toEqual(['GOOGLE_CLIENT_SECRET']);
  });

  it('derives the redirect uri from the public base url', () => {
    expect(googleRedirectUri({ PUBLIC_BASE_URL: 'https://x.example/' }))
      .toBe('https://x.example/api/auth/google/callback');
    expect(googleRedirectUri({ GOOGLE_REDIRECT_URI: 'https://y.example/cb' }))
      .toBe('https://y.example/cb');
    expect(googleRedirectUri({})).toBe('');
  });
});
