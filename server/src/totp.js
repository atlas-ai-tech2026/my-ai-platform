// ─── totp.js ─────────────────────────────────────────────────────────────────
// H5 (security audit 2026-07-28): TOTP two-factor for the admin account.
//
// RFC 6238 (TOTP) on top of RFC 4226 (HOTP), implemented with node:crypto —
// no new runtime dependency (CLAUDE.md: don't add a dep when the stdlib
// solves it), no supply chain added to a security fix. Correctness is
// pinned by the OFFICIAL RFC 6238 test vectors in totp.test.js.
//
// Compatible with Google Authenticator, Authy, 1Password, etc: SHA-1,
// 6 digits, 30-second step, base32 secret, standard otpauth:// URI.

import crypto from 'node:crypto';

const DIGITS = 6;
const STEP_SECONDS = 30;
const ALGO = 'sha1';           // what every authenticator app expects
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

// ---- base32 (RFC 4648, no padding) — the format authenticator apps take --

export function base32Encode(buffer) {
  let bits = 0, value = 0, out = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input) {
  const clean = String(input || '').toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = 0, value = 0;
  const out = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) throw new Error('Invalid base32 character in secret');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A fresh 160-bit secret (RFC 4226's recommended size), base32-encoded. */
export function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

// ---- HOTP / TOTP ---------------------------------------------------------

/** RFC 4226 HOTP. `counter` is a number or BigInt. */
export function hotp(secretBuffer, counter, digits = DIGITS, algo = ALGO) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac(algo, secretBuffer).update(buf).digest();
  // Dynamic truncation (RFC 4226 §5.3)
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/** RFC 6238 TOTP for a point in time (default: now). */
export function generateTotp(secret, { timestampMs = Date.now(), step = STEP_SECONDS, digits = DIGITS, algo = ALGO } = {}) {
  const counter = Math.floor(timestampMs / 1000 / step);
  return hotp(base32Decode(secret), counter, digits, algo);
}

/**
 * Verify a user-entered code. Accepts the adjacent time steps (default ±1,
 * i.e. ~90s) so a slightly-off phone clock still works — the standard
 * tolerance. Comparison is constant-time.
 *
 * Returns the matched step offset (…-1, 0, 1…) or null when no match, so
 * the caller can store the last used step and reject replays.
 */
export function verifyTotp(secret, token, { timestampMs = Date.now(), window = 1, step = STEP_SECONDS, digits = DIGITS, algo = ALGO } = {}) {
  const code = String(token || '').replace(/\s+/g, '');
  if (!new RegExp(`^\\d{${digits}}$`).test(code)) return null;

  let key;
  try {
    key = base32Decode(secret);
  } catch {
    return null;
  }
  const current = Math.floor(timestampMs / 1000 / step);
  for (let offset = -window; offset <= window; offset++) {
    const expected = hotp(key, current + offset, digits, algo);
    const a = Buffer.from(expected);
    const b = Buffer.from(code);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return offset;
  }
  return null;
}

/** The step number a code belongs to — stored as `totp_last_step` so the
 * same code cannot be replayed within its own 30s window. */
export function currentStep(timestampMs = Date.now(), step = STEP_SECONDS) {
  return Math.floor(timestampMs / 1000 / step);
}

// ---- enrolment -----------------------------------------------------------

/** otpauth:// URI for the QR code the admin scans. */
export function buildOtpAuthUri(secret, { account, issuer = 'Voxel AI' } = {}) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// ---- recovery codes ------------------------------------------------------
// Shown to the admin ONCE at setup; only their hashes are stored. Used when
// the phone is lost. Format: 10 groups of "XXXX-XXXX" from an unambiguous
// alphabet (no 0/O/1/I) so they can be written down and re-typed reliably.

const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateRecoveryCodes(count = 10) {
  const codes = [];
  for (let i = 0; i < count; i++) {
    let s = '';
    const bytes = crypto.randomBytes(8);
    for (const b of bytes) s += RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length];
    codes.push(`${s.slice(0, 4)}-${s.slice(4, 8)}`);
  }
  return codes;
}

export function normalizeRecoveryCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Recovery codes are high-entropy random values, so a fast SHA-256 is
 * appropriate here (unlike passwords, which stay on bcrypt cost 12). */
export function hashRecoveryCode(code) {
  return crypto.createHash('sha256').update(normalizeRecoveryCode(code)).digest('hex');
}

// ---- login decision ------------------------------------------------------

/**
 * The whole second-factor decision for a login attempt, as a pure function
 * so it can be tested without a database or an HTTP server.
 *
 * @param user  { totp_enabled, totp_secret, totp_last_step, totp_recovery_codes }
 * @param input { totpCode, recoveryCode }
 * @returns one of
 *   { outcome: 'not_required' }
 *   { outcome: 'required' }                          → 401, prompt for a code
 *   { outcome: 'invalid' }                           → 401, count as a failure
 *   { outcome: 'replayed' }                          → 401, code already used
 *   { outcome: 'ok', nextStep }                      → issue the token
 *   { outcome: 'ok_recovery', remainingHashes, usedHash }
 */
export function evaluateSecondFactor(user, { totpCode, recoveryCode } = {}, { timestampMs = Date.now() } = {}) {
  if (!user?.totp_enabled) return { outcome: 'not_required' };

  const code = String(totpCode || '').trim();
  const recovery = String(recoveryCode || '').trim();
  if (!code && !recovery) return { outcome: 'required' };

  if (code) {
    const offset = verifyTotp(user.totp_secret, code, { timestampMs });
    if (offset === null) return { outcome: 'invalid' };
    const step = currentStep(timestampMs) + offset;
    // Replay guard: the same code cannot be reused within its own window.
    if (user.totp_last_step != null && BigInt(user.totp_last_step) >= BigInt(step)) {
      return { outcome: 'replayed' };
    }
    return { outcome: 'ok', nextStep: step };
  }

  const stored = Array.isArray(user.totp_recovery_codes) ? user.totp_recovery_codes : [];
  const usedHash = matchRecoveryCode(recovery, stored);
  if (!usedHash) return { outcome: 'invalid' };
  return {
    outcome: 'ok_recovery',
    usedHash,
    remainingHashes: stored.filter((h) => h !== usedHash),
  };
}

/** Constant-time membership test against the stored hashes. Returns the
 * matching hash (so the caller can consume it) or null. */
export function matchRecoveryCode(code, storedHashes = []) {
  const candidate = hashRecoveryCode(code);
  const candidateBuf = Buffer.from(candidate, 'hex');
  let found = null;
  // Scan every entry regardless of an early match — no early return, so the
  // time taken doesn't reveal which code matched.
  for (const stored of storedHashes) {
    const storedBuf = Buffer.from(String(stored), 'hex');
    if (storedBuf.length === candidateBuf.length && crypto.timingSafeEqual(storedBuf, candidateBuf)) {
      found = stored;
    }
  }
  return found;
}
