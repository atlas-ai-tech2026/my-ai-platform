// ─── Auth middleware ────────────────────────────────────────────────────────
//
// Three composable guards for protecting API routes:
//
//   verifyJwt         — reads `Authorization: Bearer <token>`, verifies with
//                       JWT_SECRET, attaches `req.user = {id, email, role}`.
//   requireAdmin      — requires `req.user.role === 'admin'`. Run AFTER verifyJwt.
//   requireNotBanned  — re-checks users.banned on every request so banning a
//                       user takes effect immediately, not "next login".
//
// All three return JSON errors (never crash) and use the same error shape.

import jwt from 'jsonwebtoken';
import { pool } from '../db.js';

// Read + trim once at module load so we always verify with the SAME secret
// that index.js used to sign. Without the trim, a JWT_SECRET pasted into the
// hosting provider with a stray trailing newline/space would cause every
// admin request to 401 with "Invalid or expired token" — login signs with
// the trimmed value, verify reads the raw env var, they don't match.
const JWT_SECRET = (process.env.JWT_SECRET || '').trim();

export function verifyJwt(req, res, next) {
  if (!JWT_SECRET) {
    return res.status(503).json({ error: 'Auth not configured on server.' });
  }
  // H7 (audit 2026-07-28): the admin session now arrives in an httpOnly
  // cookie that JavaScript cannot read, so XSS can't steal it. The bearer
  // header is still accepted — regular user sessions use it, and it keeps
  // any in-flight admin tab working across the deploy.
  //
  // `usedCookieAuth` is recorded because only cookie-authenticated requests
  // need the CSRF check: a bearer header is never attached automatically by
  // the browser, so it cannot be forged cross-site.
  const auth = req.get('authorization') || '';
  const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1];
  const cookieToken = req.cookies?.voxel_admin;
  const token = bearer || cookieToken;

  if (!token) {
    return res.status(401).json({ error: 'Missing bearer token.' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    // Standard JWT field is `sub` (subject) — we put user id there at issue time.
    req.user = {
      id: payload.sub,
      email: payload.email,
      role: payload.role || 'user',
      // N9: when this token was issued, compared against the account's
      // sessions_valid_from cutoff by requireNotBanned.
      issuedAt: payload.iat,
    };
    req.usedCookieAuth = !bearer && !!cookieToken;
    next();
  } catch (err) {
    // Don't leak whether the token was malformed vs. expired vs. wrong secret.
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

export function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only.' });
  }
  next();
}

export async function requireNotBanned(req, res, next) {
  try {
    if (!req.user?.id) return res.status(401).json({ error: 'Not authenticated.' });
    const { rows } = await pool.query(
      'SELECT banned, expires_at, allowed_models, sessions_valid_from FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!rows[0]) {
      return res.status(401).json({ error: 'Account no longer exists.' });
    }
    if (rows[0].banned) {
      return res.status(403).json({ error: 'Account is banned.' });
    }
    // N9 (recheck 2026-08-03): tokens carried no version and lasted 7 days
    // (30 min for admins), and nothing compared them against a password
    // change. Resetting a compromised account's password therefore did NOT
    // evict the attacker — their token kept spending credits until it expired.
    //
    // Rides on the query that was already here for the ban check, so this
    // costs no extra round trip. NULL cutoff = no sessions revoked, which is
    // every account until a password actually changes.
    if (rows[0].sessions_valid_from && req.user.issuedAt) {
      // ceil, not floor: `iat` is whole seconds, so a token minted in the same
      // second as the reset would otherwise compare equal and survive. Round
      // the cutoff up so that one-second window revokes rather than admits.
      const cutoff = Math.ceil(new Date(rows[0].sessions_valid_from).getTime() / 1000);
      if (req.user.issuedAt < cutoff) {
        return res.status(401).json({
          error: 'Your password was changed. Please sign in again.',
          reauth: true,
        });
      }
    }
    // Bulk-provisioned accounts can carry a hard expiry (CRM Bulk tab).
    if (rows[0].expires_at && new Date(rows[0].expires_at) <= new Date()) {
      return res.status(403).json({ error: 'Account has expired — contact support to renew.' });
    }
    // Per-user model allow-list (NULL = unrestricted). Routes consult this
    // via req.userAccess before charging.
    req.userAccess = { allowedModels: rows[0].allowed_models || null };
    next();
  } catch (err) {
    console.error('[auth] requireNotBanned error:', err.message);
    return res.status(500).json({ error: 'Auth check failed.' });
  }
}
