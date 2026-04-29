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
  const auth = req.get('authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) {
    return res.status(401).json({ error: 'Missing bearer token.' });
  }
  try {
    const payload = jwt.verify(m[1], JWT_SECRET);
    // Standard JWT field is `sub` (subject) — we put user id there at issue time.
    req.user = {
      id: payload.sub,
      email: payload.email,
      role: payload.role || 'user',
    };
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
    const { rows } = await pool.query('SELECT banned FROM users WHERE id = $1', [req.user.id]);
    if (!rows[0]) {
      return res.status(401).json({ error: 'Account no longer exists.' });
    }
    if (rows[0].banned) {
      return res.status(403).json({ error: 'Account is banned.' });
    }
    next();
  } catch (err) {
    console.error('[auth] requireNotBanned error:', err.message);
    return res.status(500).json({ error: 'Auth check failed.' });
  }
}
