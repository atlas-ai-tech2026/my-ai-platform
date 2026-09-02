// ─── waitlist.js ─────────────────────────────────────────────────────────────
// The /edit page invited people to "be notified when VOXEL Edit launches",
// checked their address contained an @, showed a success toast — and threw the
// address away. No table, no endpoint, no record. Verified 2026-08-17.
//
// Every person who ever asked to hear about VOXEL Edit is gone, and the page
// went on asking. That is worse than not asking: these are people declaring
// interest in a product still being scoped, and their names would have been
// the best input to scoping it.
//
// This is deliberately small. It stores an address and where it came from.
// It does not send anything — email campaigns are on hold at the owner's
// instruction, and collecting is a separate act from contacting.

import { normalizeEmail } from './email-normalize.js';
/** Sources a caller may claim. An open field becomes junk within a week. */
export const WAITLIST_SOURCES = ['edit', 'mobile', 'api'];

/**
 * Is this a usable address?
 *
 * Deliberately permissive rather than clever: the old check was
 * `email.includes('@')`, and full RFC validation rejects addresses that work.
 * The real defence against junk is the unique index and the rate limit, not a
 * regex. This only rejects what obviously cannot be delivered.
 */
export function normaliseEmail(raw) {
  // Strip the untypable first — see email-normalize.js. Someone pasting
  // their address out of a mail client brings the marks with it, and a
  // waitlist row nobody can ever match to a sign-up is a row lost.
  const email = normalizeEmail(raw);
  if (email.length < 6 || email.length > 254) return null;
  const at = email.indexOf('@');
  if (at < 1 || at !== email.lastIndexOf('@')) return null;
  const domain = email.slice(at + 1);
  if (!domain.includes('.') || domain.startsWith('.') || domain.endsWith('.')) return null;
  if (/\s/.test(email)) return null;
  return email;
}

export function normaliseSource(raw) {
  const s = String(raw ?? 'edit').trim().toLowerCase();
  return WAITLIST_SOURCES.includes(s) ? s : 'edit';
}

/**
 * Record an address. Idempotent by (email, source).
 *
 * Signing up twice is not two people — the count has to mean "how many are
 * waiting", or it is just a click counter with a misleading name.
 *
 * @returns {{ok:true, created:boolean}} created=false when already present
 */
export async function addToWaitlist(pool, { email, source, userId = null, ip = null, userAgent = null }) {
  const clean = normaliseEmail(email);
  if (!clean) return { ok: false, error: 'That email address does not look right.' };
  const src = normaliseSource(source);

  const { rows } = await pool.query(
    `INSERT INTO waitlist (email, source, user_id, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (lower(email), source) DO NOTHING
     RETURNING id`,
    [clean, src, userId, ip, (userAgent || '').slice(0, 500) || null]);

  return { ok: true, created: rows.length > 0 };
}

export function registerWaitlistRoutes(app, { pool, dbReady, limiter, adminGate, resolveIp }) {
  // PUBLIC. Anyone can join; that is the point of a waitlist.
  app.post('/api/waitlist', limiter, async (req, res) => {
    if (!dbReady()) {
      // Say so rather than showing success. A page that thanks you while
      // dropping the address is the bug this file exists to fix.
      return res.status(503).json({ error: 'Not available right now — please try again shortly.' });
    }
    try {
      const r = await addToWaitlist(pool, {
        email: req.body?.email,
        source: req.body?.source,
        userId: req.user?.sub || null,
        ip: resolveIp ? resolveIp(req) : (req.ip || null),
        userAgent: req.get('user-agent'),
      });
      if (!r.ok) return res.status(400).json({ error: r.error });
      // `created` is not exposed: telling a stranger whether an address is
      // already on the list is a membership oracle, and the person's
      // experience should be identical either way.
      console.log(`[waitlist] ${r.created ? 'added' : 'already present'} (source=${normaliseSource(req.body?.source)})`);
      res.json({ ok: true });
    } catch (e) {
      console.error('[waitlist] failed:', e.message);
      res.status(500).json({ error: 'Could not save that — please try again.' });
    }
  });

  // ADMIN. Collecting addresses nobody can see would repeat the original bug
  // one layer down.
  app.get('/api/admin/waitlist', adminGate, async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT email, source, created_at, user_id
           FROM waitlist ORDER BY created_at DESC LIMIT 500`);
      const { rows: counts } = await pool.query(
        `SELECT source, COUNT(*)::int AS n,
                COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')::int AS last_7d
           FROM waitlist GROUP BY source ORDER BY n DESC`);
      res.json({ entries: rows, counts, total: rows.length });
    } catch (e) {
      console.error('[waitlist] admin read failed:', e.message);
      res.status(500).json({ error: 'Could not read the waitlist.' });
    }
  });
}
