// ─── health-deep.js ──────────────────────────────────────────────────────────
// "Is the site actually working", as opposed to "is this process alive".
//
// ── WHY THIS IS A SECOND ENDPOINT AND NOT A BETTER /api/health ─────────────
// /api/health is DigitalOcean's LIVENESS probe. It runs every 10 seconds and a
// container that fails it six times gets restarted. That is exactly right for
// "has this process wedged" and exactly wrong for "can it reach Postgres":
// make the liveness probe query the database and a database that is merely
// SLOW starts killing healthy containers, turning a degradation into an
// outage. The cure would cause the disease.
//
// So: two endpoints, two questions.
//   /api/health  — shallow, for the platform. Never touches anything.
//   /api/ready   — deep, for an external monitor and for a human.
//
// ── THE HOLE THIS FILLS, FOUND 2026-08-23 ─────────────────────────────────
// /api/health reports `db_configured: dbReady()`, and dbReady() is
// `pool !== null` — it proves a pool OBJECT was constructed at boot, never
// that Postgres answers. With the database completely unreachable the endpoint
// still returned status: ok, db_configured: true. The platform kept the
// container alive, any monitor would have shown green, and every customer
// would have been seeing errors.
//
// ── AND WHY IT MUST ANSWER 503 ────────────────────────────────────────────
// An uptime monitor reads the STATUS CODE. A body that says {"ok":false} with
// a 200 on it is a monitor that never fires — the most expensive kind of
// check, because it is worse than none: it actively reassures.

/** One check's worth of work, with a deadline. A hanging database must not
 *  hang the endpoint — that would turn a slow dependency into a timeout for
 *  whoever is asking, which is the same failure one layer up. */
async function within(ms, work) {
  let timer;
  try {
    return await Promise.race([
      work(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timed out')), ms); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ask each dependency whether it is really there.
 *
 * Dependencies are passed in rather than imported so this is testable without
 * a database — a health check that can only be verified against live
 * infrastructure is a health check nobody verifies.
 *
 * @param {object}  deps.pool          pg pool, or null when not configured
 * @param {boolean} deps.storageReady  whether Spaces has credentials
 * @param {number}  deps.timeoutMs     per-check deadline
 */
export async function deepHealth({ pool, storageReady = false, timeoutMs = 4000 } = {}) {
  const checks = [];

  // ── DATABASE ──────────────────────────────────────────────────────────
  // SELECT 1 and nothing else. It proves the connection, the credentials and
  // that the server is answering, without reading a row anybody owns.
  if (!pool) {
    checks.push({ name: 'database', ok: false, detail: 'not configured' });
  } else {
    try {
      await within(timeoutMs, () => pool.query('SELECT 1'));
      checks.push({ name: 'database', ok: true });
    } catch (e) {
      // The MESSAGE is deliberately coarse. This endpoint is unauthenticated
      // so a monitor can call it, and a raw pg error carries the host, the
      // port and sometimes the user. "unreachable" is all a monitor needs;
      // the full error is in the server log where it belongs.
      checks.push({ name: 'database', ok: false, detail: e.message === 'timed out' ? 'timed out' : 'unreachable' });
    }
  }

  // ── STORAGE ───────────────────────────────────────────────────────────
  // Configuration only, NOT a round trip. Every generated image and video
  // lives in Spaces, so it matters — but a HEAD request every two minutes is
  // a request we pay for, and Spaces being slow is not a reason to declare
  // the site down. Reported separately so it can be read but does not decide.
  checks.push({ name: 'storage', ok: Boolean(storageReady), detail: storageReady ? undefined : 'not configured' });

  // Only the DATABASE decides. Without it nothing works — no sign-in, no
  // history, no credits. Storage being unconfigured is a real problem and a
  // different one, and conflating them means every alert has to be
  // investigated from scratch.
  const ok = checks.find((c) => c.name === 'database')?.ok === true;
  return { ok, status: ok ? 200 : 503, checks };
}
