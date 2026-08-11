// ─── microsoft-auth.js ───────────────────────────────────────────────────────
// "Sign in with Microsoft" — same server-side authorization-code shape as
// google-auth.js (no third-party script, so the CSP stays untouched; no new
// dependency, since node:crypto + jsonwebtoken verify the RS256 id_token).
//
// ── WHY THIS IS NOT A COPY OF THE GOOGLE MODULE ────────────────────────────
//
// 1. nOAuth. Entra ID lets a user put ANY email address on their account
//    WITHOUT verifying it. An attacker creates their own tenant, sets the
//    address to a victim's, signs in — and any app that matches accounts on
//    the email claim hands over the victim's account. Google's email_verified
//    is trustworthy; Microsoft has no equivalent guarantee. So the linking
//    rule here is deliberately stricter: identity is (issuer, subject) ONLY,
//    and an email collision with an existing account is REFUSED rather than
//    linked. See findOrCreateMicrosoftUser's caller in index.js.
//
// 2. The issuer is per-tenant. Google always says accounts.google.com;
//    Microsoft says https://login.microsoftonline.com/<tenant-guid>/v2.0, so a
//    fixed string comparison is impossible. We validate the SHAPE and then
//    require it to agree with the token's own `tid` claim — otherwise a token
//    from any tenant could claim any issuer.
//
// 3. The email may be absent entirely. Depending on account type it arrives as
//    `email`, or `preferred_username`, or not at all. A missing address is a
//    hard failure here, not something to paper over with a placeholder.

import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

// The `common` endpoint accepts both work/school and personal accounts.
const MS_AUTH_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const MS_TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const MS_JWKS_URL = 'https://login.microsoftonline.com/common/discovery/v2.0/keys';

// openid = an id_token at all; email + profile = the address and display name.
// Nothing else: every additional scope is a permission we would have to justify
// on the consent screen and could be asked to defend in a review.
export const MS_SCOPES = 'openid email profile';

// Personal Microsoft accounts (outlook.com, hotmail.com…) all sit in this
// pseudo-tenant rather than a real organisational one.
const CONSUMER_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad';

export function microsoftConfigured(env = process.env) {
  return !!((env.MICROSOFT_CLIENT_ID || '').trim() && (env.MICROSOFT_CLIENT_SECRET || '').trim());
}

export function missingMicrosoftVars(env = process.env) {
  return ['MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET'].filter((k) => !(env[k] || '').trim());
}

export function microsoftRedirectUri(env = process.env) {
  const explicit = (env.MICROSOFT_REDIRECT_URI || '').trim();
  if (explicit) return explicit;
  const base = (env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  return base ? `${base}/api/auth/microsoft/callback` : '';
}

// ---- JWKS ------------------------------------------------------------------

let jwksCache = { keys: null, fetchedAt: 0 };
const JWKS_TTL_MS = 60 * 60 * 1000;

export async function getMicrosoftKeys({ fetchImpl = fetch, now = Date.now } = {}) {
  const t = now();
  if (jwksCache.keys && t - jwksCache.fetchedAt < JWKS_TTL_MS) return jwksCache.keys;
  const res = await fetchImpl(MS_JWKS_URL);
  if (!res.ok) throw new Error(`Could not fetch Microsoft signing keys (HTTP ${res.status})`);
  const body = await res.json();
  if (!Array.isArray(body?.keys) || !body.keys.length) {
    throw new Error('Microsoft returned no signing keys');
  }
  jwksCache = { keys: body.keys, fetchedAt: t };
  return body.keys;
}

export function __resetMicrosoftKeyCache() {
  jwksCache = { keys: null, fetchedAt: 0 };
}

/**
 * Is this a well-formed Microsoft issuer, and does it match the token's own
 * tenant claim?
 *
 * Checking only the prefix would be useless — the tenant segment is
 * attacker-chosen in a multi-tenant app. Binding issuer to `tid` is what makes
 * the pair meaningful: a token cannot claim to come from a tenant other than
 * the one that signed it.
 */
export function issuerMatchesTenant(iss, tid) {
  if (typeof iss !== 'string' || typeof tid !== 'string' || !tid) return false;
  const m = /^https:\/\/login\.microsoftonline\.com\/([0-9a-f-]{36})\/v2\.0$/i.exec(iss);
  return !!m && m[1].toLowerCase() === tid.toLowerCase();
}

/**
 * Verify a Microsoft id_token and return the identity it asserts.
 *
 * NOTE the shape of what comes back: `emailVerified` is deliberately NOT part
 * of it, because Microsoft cannot promise it. Callers must treat `email` as a
 * display value and `sub`/`tenantId` as the identity.
 */
export async function verifyMicrosoftIdToken(idToken, {
  clientId = (process.env.MICROSOFT_CLIENT_ID || '').trim(),
  fetchImpl = fetch,
  now = Date.now,
} = {}) {
  if (!clientId) throw new Error('MICROSOFT_CLIENT_ID is not set');
  if (!idToken || typeof idToken !== 'string') throw new Error('No id_token returned by Microsoft');

  const decoded = jwt.decode(idToken, { complete: true });
  if (!decoded?.header?.kid) throw new Error('id_token has no key id');

  let keys = await getMicrosoftKeys({ fetchImpl, now });
  let jwk = keys.find((k) => k.kid === decoded.header.kid);
  if (!jwk) {
    __resetMicrosoftKeyCache();
    keys = await getMicrosoftKeys({ fetchImpl, now });
    jwk = keys.find((k) => k.kid === decoded.header.kid);
  }
  if (!jwk) throw new Error('id_token signed with an unknown key');

  const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });

  let payload;
  try {
    payload = jwt.verify(idToken, publicKey, {
      algorithms: ['RS256'],
      audience: clientId,
      clockTolerance: 10,
    });
  } catch (e) {
    throw new Error(`id_token rejected: ${e.message}`);
  }

  if (!issuerMatchesTenant(payload.iss, payload.tid)) {
    throw new Error(`id_token issuer does not match its tenant: ${payload.iss}`);
  }
  if (!payload.sub) throw new Error('id_token has no subject');

  // Address, best effort. `email` is only present when the tenant chose to
  // emit it; `preferred_username` is usually the sign-in address.
  const email = String(payload.email || payload.preferred_username || '')
    .trim().toLowerCase();
  if (!email || !email.includes('@')) {
    throw new Error('Microsoft did not return a usable email address');
  }

  return {
    // The identity. sub is unique PER APPLICATION per user and never reused.
    sub: String(payload.sub),
    tenantId: String(payload.tid),
    isPersonalAccount: String(payload.tid).toLowerCase() === CONSUMER_TENANT,
    email,
    name: typeof payload.name === 'string' ? payload.name.slice(0, 80) : null,
    // Optional claim a tenant can enable to assert the address really is
    // domain-verified. Absent for most tenants — treat absence as "unverified",
    // never as "fine".
    emailDomainOwnerVerified: payload.xms_edov === true || payload.xms_edov === '1',
  };
}

// ---- flow helpers ----------------------------------------------------------

export function buildMicrosoftAuthUrl({ clientId, redirectUri, state }) {
  const u = new URL(MS_AUTH_URL);
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', MS_SCOPES);
  u.searchParams.set('state', state);
  u.searchParams.set('response_mode', 'query');
  u.searchParams.set('prompt', 'select_account');
  return u.toString();
}

export async function exchangeMicrosoftCode({
  code, clientId, clientSecret, redirectUri, fetchImpl = fetch,
}) {
  const res = await fetchImpl(MS_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      scope: MS_SCOPES,
    }).toString(),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`token exchange failed (HTTP ${res.status}): ${body.error || 'unknown'}`);
  }
  return body;
}
