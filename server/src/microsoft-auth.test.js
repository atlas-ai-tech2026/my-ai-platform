// ─── microsoft-auth.test.js ──────────────────────────────────────────────────
// Real RSA keypairs and real signed tokens, so the signature path is genuinely
// exercised rather than mocked.
//
// The headline risk here is NOT generic OIDC sloppiness — it is nOAuth. Entra
// ID lets a user set an arbitrary, unverified email address on their account.
// An attacker spins up their own tenant, sets the address to a victim's, signs
// in, and any app that identifies users by the email claim hands over the
// victim's account. These tests pin the two defences: identity is
// (issuer, subject) bound together, and the email is never treated as proof.

import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import {
  verifyMicrosoftIdToken, __resetMicrosoftKeyCache, issuerMatchesTenant,
  buildMicrosoftAuthUrl, microsoftConfigured, missingMicrosoftVars,
  microsoftRedirectUri, MS_SCOPES,
} from './microsoft-auth.js';

const CLIENT_ID = '11111111-2222-3333-4444-555555555555';
const REAL_TENANT = '72f988bf-86f1-41af-91ab-2d7cd011db47';
const ATTACKER_TENANT = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const CONSUMER_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad';
const KID = 'ms-test-key-1';

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' };
const attacker = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });

const fakeJwks = (keys = [jwk]) => async () => ({ ok: true, status: 200, json: async () => ({ keys }) });

function signIdToken(payload = {}, { key = privateKey, kid = KID, tenant = REAL_TENANT } = {}) {
  return jwt.sign(
    {
      iss: `https://login.microsoftonline.com/${tenant}/v2.0`,
      tid: tenant,
      aud: CLIENT_ID,
      sub: 'AAAAAAAAAAAAAAAAAAAAAA',
      preferred_username: 'person@company.com',
      name: 'A Person',
      ...payload,
    },
    key,
    { algorithm: 'RS256', keyid: kid, expiresIn: '5m' }
  );
}

beforeEach(() => __resetMicrosoftKeyCache());

describe('a genuine Microsoft token is accepted', () => {
  it('returns the identity, keyed on subject and tenant', async () => {
    const id = await verifyMicrosoftIdToken(signIdToken(), { clientId: CLIENT_ID, fetchImpl: fakeJwks() });
    expect(id.sub).toBe('AAAAAAAAAAAAAAAAAAAAAA');
    expect(id.tenantId).toBe(REAL_TENANT);
    expect(id.email).toBe('person@company.com');
    expect(id.isPersonalAccount).toBe(false);
  });

  it('falls back to preferred_username when there is no email claim', async () => {
    // Microsoft omits `email` entirely for many tenants.
    const id = await verifyMicrosoftIdToken(
      signIdToken({ email: undefined, preferred_username: 'Someone@Contoso.COM' }),
      { clientId: CLIENT_ID, fetchImpl: fakeJwks() }
    );
    expect(id.email).toBe('someone@contoso.com');
  });

  it('flags personal accounts so they are distinguishable from work accounts', async () => {
    const id = await verifyMicrosoftIdToken(
      signIdToken({}, { tenant: CONSUMER_TENANT }), { clientId: CLIENT_ID, fetchImpl: fakeJwks() }
    );
    expect(id.isPersonalAccount).toBe(true);
  });

  it('never claims an address is verified unless the tenant asserted it', async () => {
    const plain = await verifyMicrosoftIdToken(signIdToken(), { clientId: CLIENT_ID, fetchImpl: fakeJwks() });
    // Absence of xms_edov must read as "unverified", never as "fine".
    expect(plain.emailDomainOwnerVerified).toBe(false);

    const asserted = await verifyMicrosoftIdToken(
      signIdToken({ xms_edov: true }), { clientId: CLIENT_ID, fetchImpl: fakeJwks() }
    );
    expect(asserted.emailDomainOwnerVerified).toBe(true);
  });
});

describe('nOAuth — the issuer must be bound to the tenant', () => {
  it('refuses a token whose issuer and tenant disagree', async () => {
    // The heart of it: an attacker signs in from THEIR tenant but claims the
    // issuer of the victim's. Checking only the issuer prefix would pass.
    const token = signIdToken({ iss: `https://login.microsoftonline.com/${REAL_TENANT}/v2.0`, tid: ATTACKER_TENANT });
    await expect(verifyMicrosoftIdToken(token, { clientId: CLIENT_ID, fetchImpl: fakeJwks() }))
      .rejects.toThrow(/does not match its tenant/i);
  });

  it('refuses a lookalike issuer host', () => {
    expect(issuerMatchesTenant(`https://login.microsoftonline.com.evil.tld/${REAL_TENANT}/v2.0`, REAL_TENANT)).toBe(false);
    expect(issuerMatchesTenant(`https://evil.tld/login.microsoftonline.com/${REAL_TENANT}/v2.0`, REAL_TENANT)).toBe(false);
  });

  it('refuses a non-guid tenant segment', () => {
    expect(issuerMatchesTenant('https://login.microsoftonline.com/common/v2.0', 'common')).toBe(false);
  });

  it('accepts only the genuine pairing', () => {
    expect(issuerMatchesTenant(`https://login.microsoftonline.com/${REAL_TENANT}/v2.0`, REAL_TENANT)).toBe(true);
    // Case-insensitive: Microsoft is inconsistent about guid casing.
    expect(issuerMatchesTenant(`https://login.microsoftonline.com/${REAL_TENANT.toUpperCase()}/v2.0`, REAL_TENANT)).toBe(true);
  });
});

describe('tokens that must be refused', () => {
  it('refuses a token minted for a different application', async () => {
    const token = signIdToken({ aud: '99999999-9999-9999-9999-999999999999' });
    await expect(verifyMicrosoftIdToken(token, { clientId: CLIENT_ID, fetchImpl: fakeJwks() }))
      .rejects.toThrow(/rejected/i);
  });

  it('refuses a token signed with the wrong key', async () => {
    const token = signIdToken({}, { key: attacker.privateKey });
    await expect(verifyMicrosoftIdToken(token, { clientId: CLIENT_ID, fetchImpl: fakeJwks() }))
      .rejects.toThrow(/rejected/i);
  });

  it('refuses an unsigned alg:none token', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT', kid: KID })).toString('base64url');
    const body = Buffer.from(JSON.stringify({
      iss: `https://login.microsoftonline.com/${REAL_TENANT}/v2.0`, tid: REAL_TENANT,
      aud: CLIENT_ID, sub: 'x', preferred_username: 'a@b.c',
      exp: Math.floor(Date.now() / 1000) + 300,
    })).toString('base64url');
    await expect(verifyMicrosoftIdToken(`${header}.${body}.`, { clientId: CLIENT_ID, fetchImpl: fakeJwks() }))
      .rejects.toThrow();
  });

  it('refuses an expired token', async () => {
    const token = jwt.sign(
      { iss: `https://login.microsoftonline.com/${REAL_TENANT}/v2.0`, tid: REAL_TENANT,
        aud: CLIENT_ID, sub: 'x', preferred_username: 'a@b.c' },
      privateKey, { algorithm: 'RS256', keyid: KID, expiresIn: -60 }
    );
    await expect(verifyMicrosoftIdToken(token, { clientId: CLIENT_ID, fetchImpl: fakeJwks() }))
      .rejects.toThrow(/rejected/i);
  });

  it('refuses a token with no usable address at all', async () => {
    const token = signIdToken({ email: undefined, preferred_username: undefined });
    await expect(verifyMicrosoftIdToken(token, { clientId: CLIENT_ID, fetchImpl: fakeJwks() }))
      .rejects.toThrow(/usable email/i);
  });

  it('refuses garbage without crashing', async () => {
    for (const bad of ['', 'not.a.token', null, undefined, 7]) {
      await expect(verifyMicrosoftIdToken(bad, { clientId: CLIENT_ID, fetchImpl: fakeJwks() }))
        .rejects.toThrow();
    }
  });
});

describe('configuration', () => {
  it('requests only the three basic scopes', () => {
    expect(MS_SCOPES.split(' ').sort()).toEqual(['email', 'openid', 'profile']);
  });

  it('the authorize url asks for a code and carries state', () => {
    const u = new URL(buildMicrosoftAuthUrl({
      clientId: CLIENT_ID, redirectUri: 'https://x.example/api/auth/microsoft/callback', state: 'abc',
    }));
    expect(u.origin + u.pathname).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('state')).toBe('abc');
  });

  it('reports itself unconfigured rather than half-working', () => {
    expect(microsoftConfigured({})).toBe(false);
    expect(microsoftConfigured({ MICROSOFT_CLIENT_ID: 'x' })).toBe(false);
    expect(microsoftConfigured({ MICROSOFT_CLIENT_ID: 'x', MICROSOFT_CLIENT_SECRET: 'y' })).toBe(true);
    expect(missingMicrosoftVars({ MICROSOFT_CLIENT_ID: 'x' })).toEqual(['MICROSOFT_CLIENT_SECRET']);
    expect(microsoftRedirectUri({ PUBLIC_BASE_URL: 'https://x.example/' }))
      .toBe('https://x.example/api/auth/microsoft/callback');
  });
});
