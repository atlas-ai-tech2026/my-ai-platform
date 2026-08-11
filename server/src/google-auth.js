// ─── google-auth.js ──────────────────────────────────────────────────────────
// "Sign in with Google" — server-side authorization-code flow.
//
// WHY THE REDIRECT FLOW AND NOT THE GOOGLE BUTTON WIDGET:
// Google Identity Services renders its button by loading a script from
// accounts.google.com. Our CSP is `script-src 'self'` (no third-party script
// may execute), and N15 just narrowed connect-src to a fixed host list. Using
// the widget would mean loosening script-src — the one thing the security
// handover says never to do. The redirect flow needs no third-party script at
// all, so the CSP stays exactly as tight as it is.
//
// NO NEW DEPENDENCY: google-auth-library is the usual choice, but node:crypto
// can turn Google's published JWK straight into a verification key and the
// jsonwebtoken package (already a dependency) checks the RS256 signature. That
// follows this repo's rule of checking the stdlib and existing deps first —
// the same reasoning that made H5's TOTP use node:crypto over otplib.

import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

// Google documents both spellings of the issuer; accept exactly these two.
const VALID_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

// Only these three scopes. Anything beyond them is a "sensitive" or
// "restricted" scope, which drags in a Google security audit costing
// USD 540–1000 and buys us nothing: we want an identity, not someone's inbox.
export const GOOGLE_SCOPES = 'openid email profile';

export function googleConfigured(env = process.env) {
  return !!((env.GOOGLE_CLIENT_ID || '').trim() && (env.GOOGLE_CLIENT_SECRET || '').trim());
}

export function missingGoogleVars(env = process.env) {
  return ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'].filter((k) => !(env[k] || '').trim());
}

/** The redirect URI must match one registered in the Google console EXACTLY. */
export function googleRedirectUri(env = process.env) {
  const explicit = (env.GOOGLE_REDIRECT_URI || '').trim();
  if (explicit) return explicit;
  const base = (env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  return base ? `${base}/api/auth/google/callback` : '';
}

// ---- JWKS ------------------------------------------------------------------

let jwksCache = { keys: null, fetchedAt: 0 };
const JWKS_TTL_MS = 60 * 60 * 1000; // Google rotates slowly; an hour is safe.

/** Google's signing keys, cached. Exported for tests via `fetchImpl`. */
export async function getGoogleKeys({ fetchImpl = fetch, now = Date.now } = {}) {
  const t = now();
  if (jwksCache.keys && t - jwksCache.fetchedAt < JWKS_TTL_MS) return jwksCache.keys;
  const res = await fetchImpl(GOOGLE_JWKS_URL);
  if (!res.ok) throw new Error(`Could not fetch Google signing keys (HTTP ${res.status})`);
  const body = await res.json();
  if (!Array.isArray(body?.keys) || !body.keys.length) {
    throw new Error('Google returned no signing keys');
  }
  jwksCache = { keys: body.keys, fetchedAt: t };
  return body.keys;
}

/** Test seam — also used to force a refetch if a `kid` is unknown. */
export function __resetGoogleKeyCache() {
  jwksCache = { keys: null, fetchedAt: 0 };
}

/**
 * Verify a Google ID token and return the identity it asserts.
 *
 * Checks, in order: RS256 signature against Google's published key for the
 * token's `kid`, issuer, audience (our client id — this is what stops a token
 * minted for a DIFFERENT app being replayed at us), expiry, and finally that
 * Google itself considers the address verified.
 */
export async function verifyGoogleIdToken(idToken, {
  clientId = (process.env.GOOGLE_CLIENT_ID || '').trim(),
  fetchImpl = fetch,
  now = Date.now,
} = {}) {
  if (!clientId) throw new Error('GOOGLE_CLIENT_ID is not set');
  if (!idToken || typeof idToken !== 'string') throw new Error('No id_token returned by Google');

  const decoded = jwt.decode(idToken, { complete: true });
  if (!decoded?.header?.kid) throw new Error('id_token has no key id');

  let keys = await getGoogleKeys({ fetchImpl, now });
  let jwk = keys.find((k) => k.kid === decoded.header.kid);
  if (!jwk) {
    // Unknown kid usually means Google rotated between our cache and this
    // token. Refetch once before giving up.
    __resetGoogleKeyCache();
    keys = await getGoogleKeys({ fetchImpl, now });
    jwk = keys.find((k) => k.kid === decoded.header.kid);
  }
  if (!jwk) throw new Error('id_token signed with an unknown key');

  const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });

  let payload;
  try {
    payload = jwt.verify(idToken, publicKey, {
      // Pin the algorithm: without this, a token could nominate its own.
      algorithms: ['RS256'],
      audience: clientId,
      clockTolerance: 10,
    });
  } catch (e) {
    throw new Error(`id_token rejected: ${e.message}`);
  }

  if (!VALID_ISSUERS.has(payload.iss)) {
    throw new Error(`id_token has an unexpected issuer: ${payload.iss}`);
  }
  if (!payload.sub) throw new Error('id_token has no subject');

  const email = String(payload.email || '').trim().toLowerCase();
  if (!email) throw new Error('Google did not return an email address');

  // email_verified matters enormously here: it is the ONLY thing that makes it
  // safe to attach this login to an existing password account of the same
  // address. Without it, anyone able to set an arbitrary unverified address on
  // a Google account could take over a Voxel account by email alone.
  if (payload.email_verified !== true && payload.email_verified !== 'true') {
    throw new Error('Google has not verified that email address');
  }

  return {
    sub: String(payload.sub),
    email,
    name: typeof payload.name === 'string' ? payload.name.slice(0, 80) : null,
    picture: typeof payload.picture === 'string' ? payload.picture.slice(0, 500) : null,
  };
}

// ---- flow helpers ----------------------------------------------------------

/** Where to send the browser to begin sign-in. */
export function buildGoogleAuthUrl({ clientId, redirectUri, state }) {
  const u = new URL(GOOGLE_AUTH_URL);
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', GOOGLE_SCOPES);
  u.searchParams.set('state', state);
  // Ask for an id_token only; we never want offline access or a refresh token,
  // because we are not acting on the user's behalf after sign-in.
  u.searchParams.set('access_type', 'online');
  u.searchParams.set('prompt', 'select_account');
  return u.toString();
}

/** Exchange the one-time code for tokens. Returns the raw token response. */
export async function exchangeCodeForTokens({
  code, clientId, clientSecret, redirectUri, fetchImpl = fetch,
}) {
  const res = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }).toString(),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Google's error bodies are safe to log but not to show a visitor.
    throw new Error(`token exchange failed (HTTP ${res.status}): ${body.error || 'unknown'}`);
  }
  return body;
}

/** Random, URL-safe CSRF state for the round trip. */
export function newOauthState() {
  return crypto.randomBytes(24).toString('base64url');
}

/** Constant-time compare of the state we issued against the one returned. */
export function stateMatches(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length || !a) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// ---- cookies ---------------------------------------------------------------
//
// SameSite=Lax, NOT Strict, and this is not a slip. The admin session cookies
// are Strict because nothing should ever carry them in from another site. But
// the OAuth round trip ends with Google performing a top-level navigation back
// to our callback — a cross-site request. A Strict cookie is withheld on
// exactly that navigation, so the state cookie would be missing every single
// time and sign-in could never succeed. Lax is the documented setting for this
// flow: sent on top-level GET navigation, withheld from cross-site subrequests.

const isProd = () => process.env.NODE_ENV === 'production';

export const OAUTH_STATE_COOKIE = 'voxel_oauth_state';
export const OAUTH_HANDOFF_COOKIE = 'voxel_oauth_handoff';

function serializeLaxCookie(name, value, maxAgeSeconds) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
    'HttpOnly',
  ];
  if (isProd()) parts.push('Secure');
  return parts.join('; ');
}

export function setOauthCookie(res, name, value, maxAgeSeconds) {
  res.append('Set-Cookie', serializeLaxCookie(name, value, maxAgeSeconds));
}

export function clearOauthCookie(res, name) {
  res.append('Set-Cookie', serializeLaxCookie(name, '', 0));
}
