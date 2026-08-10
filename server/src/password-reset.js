// ─── password-reset.js ───────────────────────────────────────────────────────
// Letting a customer back into their own account.
//
// Until now Voxel had NO reset path at all: passwords are hashed and
// unrecoverable, so a forgotten password meant emailing the owner and waiting
// for a manual reset from the CRM. That is the single most user-facing gap the
// platform has, and it is why email was the highest-value item on the list.
//
// ── THE FOUR RULES THIS FILE ENFORCES ────────────────────────────────────────
//
// 1. THE TOKEN IS NEVER STORED. Only its SHA-256 hash goes in the database, the
//    same reasoning as password hashing: a leaked backup must not hand someone
//    a working key to every account with a pending reset.
//
// 2. SINGLE USE. Consuming a token marks it used in the same statement that
//    reads it, so two racing requests cannot both succeed.
//
// 3. SHORT LIFE. One hour. Long enough for someone to find the mail, short
//    enough that a token sitting in an old inbox is worthless.
//
// 4. THE RESPONSE NEVER REVEALS WHETHER AN ACCOUNT EXISTS. "If that address has
//    an account, we've sent a link" — identical wording, identical timing,
//    whether or not the email is real. This is finding N11: the sign-up route
//    leaked exactly this, and a reset endpoint is a far easier oracle to query.

import crypto from 'node:crypto';

/** One hour. */
export const RESET_TTL_MS = 60 * 60 * 1000;

/** The reply every caller gets, real address or not. */
export const NEUTRAL_REPLY = {
  ok: true,
  message: 'If that address has a Voxel account, a reset link is on its way.',
};

/**
 * A fresh token: 32 random bytes for the customer, its hash for us.
 * base64url so it survives being pasted out of any mail client.
 */
export function newResetToken() {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, hash: hashResetToken(token) };
}

export function hashResetToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

export function resetExpiry(now = Date.now()) {
  return new Date(now + RESET_TTL_MS);
}

/** The link that goes in the email. */
export function resetUrl(token, env = process.env) {
  const base = String(env.PUBLIC_BASE_URL || 'https://voxel-ai.ai').replace(/\/+$/, '');
  return `${base}/reset-password?token=${encodeURIComponent(token)}`;
}

/**
 * Password rules — deliberately the same minimum the register route uses, so a
 * reset cannot set a password that sign-up would have rejected.
 */
export function passwordProblem(password) {
  const p = String(password ?? '');
  if (p.length < 8) return 'Password must be at least 8 characters.';
  if (p.length > 200) return 'Password is too long.';
  return null;
}

/**
 * Record a reset request. Any earlier unused token for the account is killed
 * first: asking twice must not leave two live keys to the same door.
 */
export async function createReset(pool, userId, { now = Date.now() } = {}) {
  const { token, hash } = newResetToken();
  await pool.query(
    `UPDATE password_resets SET used_at = NOW()
      WHERE user_id = $1 AND used_at IS NULL`, [userId]);
  await pool.query(
    `INSERT INTO password_resets (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`, [userId, hash, resetExpiry(now)]);
  return token;
}

/**
 * Redeem a token, atomically.
 *
 * The UPDATE ... RETURNING both checks and consumes in ONE statement, so two
 * requests arriving together cannot both pass: the second matches no unused
 * row. A SELECT-then-UPDATE would let both through.
 */
export async function consumeReset(pool, token) {
  if (!token || typeof token !== 'string') return { ok: false, reason: 'invalid' };
  const { rows } = await pool.query(
    `UPDATE password_resets
        SET used_at = NOW()
      WHERE token_hash = $1
        AND used_at IS NULL
        AND expires_at > NOW()
      RETURNING user_id`,
    [hashResetToken(token)]
  );
  if (!rows.length) return { ok: false, reason: 'invalid or expired' };
  return { ok: true, userId: rows[0].user_id };
}

/** The email body. Plain, short, and it says what to do if it wasn't them. */
export function resetEmailBody(link, { hours = 1 } = {}) {
  return {
    subject: 'Reset your Voxel password',
    title: 'Reset your password',
    body:
      `<p style="margin:0 0 14px">Someone asked to reset the password for this Voxel account. ` +
      `Use the button below — the link works once and expires in ${hours} hour${hours === 1 ? '' : 's'}.</p>` +
      `<p style="margin:0">If it wasn't you, ignore this email. Your password stays as it is, ` +
      `and nobody can use the link without this message.</p>`,
    ctaText: 'Set a new password',
    ctaUrl: link,
    footerNote: 'You are receiving this because a password reset was requested for your Voxel account.',
  };
}
