// ─── sop-smoke.js ────────────────────────────────────────────────────────────
// Five checks that EXERCISE the system rather than describe it.
//
// The owner asked for "a test for all the behaviour of the system" on the SOP
// tab. The honest boundary: the 1,684-test suite runs at BUILD time, in a
// different process, against mocks. It cannot tell you the live server can
// reach its database right now. This can.
//
// ── WHY FIVE, AND NOT FIFTY ────────────────────────────────────────────────
// A number that looks reassuring is not the same as a check that runs. Five
// things that genuinely execute beat "1,684 tests passed" copied onto a screen
// where it means nothing about the running system.
//
// ── EVERY ONE IS SAFE TO RUN ON PRODUCTION ─────────────────────────────────
// They read, or they write inside a transaction that is always rolled back.
// Nothing here can leave a row behind, charge anybody, or call a paid API. A
// health check that costs money is a health check you stop running.

import { VIDEO_CREDITS } from './pricing.js';
import * as storage from './storage.js';

/** One result. `ok:null` means "could not determine" — never silently healthy. */
const result = (name, ok, detail, ms) => ({ name, ok, detail, ms });

/**
 * Can the live server read from its database?
 * The most basic claim the app makes, and the one nothing else verifies.
 */
export async function checkDbRead(pool) {
  const t = Date.now();
  try {
    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM users');
    return result('Database read', true, `${rows[0].n} users visible`, Date.now() - t);
  } catch (e) {
    return result('Database read', false, e.message, Date.now() - t);
  }
}

/**
 * Can it WRITE? Read-only access looks identical to healthy until the moment
 * someone tries to sign up — which is a bad moment to find out.
 *
 * Written inside a transaction that is ALWAYS rolled back, so it proves the
 * write path without leaving anything behind.
 */
export async function checkDbWrite(pool) {
  const t = Date.now();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('CREATE TEMP TABLE sop_smoke_probe (v int) ON COMMIT DROP');
    await client.query('INSERT INTO sop_smoke_probe (v) VALUES (1)');
    const { rows } = await client.query('SELECT COUNT(*)::int AS n FROM sop_smoke_probe');
    const ok = rows[0].n === 1;
    return result('Database write', ok, ok ? 'write and read back succeeded' : 'wrote but could not read back',
      Date.now() - t);
  } catch (e) {
    return result('Database write', false, e.message, Date.now() - t);
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
}

/**
 * Does the charging authority still resolve a real model to a real price?
 *
 * This is the C1 gate. A model the UI offers but pricing.js cannot price is
 * charged NOTHING — the generation is free and nobody finds out from an error,
 * because there isn't one.
 */
export function checkPricingResolves() {
  const t = Date.now();
  try {
    const ids = Object.keys(VIDEO_CREDITS).filter((k) => /^[a-z0-9-]+$/.test(k));
    if (!ids.length) return result('Pricing table', false, 'no video models are priced at all', Date.now() - t);
    // SHAPE-AGNOSTIC on purpose. The table holds at least three shapes today:
    //   per-sec  byRes: { '480p': { off: 4, on: 4 } }
    //   flat     byRes: { '720p': 33 }
    //   per-gen  byResDuration: { '720p': { '4': 8.5 } }
    // My first version only understood the first, so it would have reported
    // "no sale price: gemini-omni" — a false alarm about the charging table on
    // the very screen that is supposed to be trusted. Asking "does any positive
    // price exist anywhere in here?" survives a fourth shape being added.
    const anyPrice = (v, depth = 0) => {
      if (depth > 4) return false;
      if (typeof v === 'number') return v > 0;
      if (v && typeof v === 'object') return Object.values(v).some((x) => anyPrice(x, depth + 1));
      return false;
    };
    const unpriced = ids.filter((id) => {
      const m = VIDEO_CREDITS[id];
      if (!m || typeof m !== 'object') return true;
      const table = m.byRes ?? m.byResDuration ?? m;
      return !anyPrice(table);
    });
    const ok = unpriced.length === 0;
    return result('Pricing table', ok,
      ok ? `${ids.length} models priced` : `no sale price: ${unpriced.join(', ')}`,
      Date.now() - t);
  } catch (e) {
    return result('Pricing table', false, e.message, Date.now() - t);
  }
}

/** Is durable storage reachable? Outputs re-hosted there are what stop history
 *  vanishing when a provider URL expires. */
export async function checkStorage() {
  const t = Date.now();
  try {
    if (!storage.isReady()) {
      return result('Storage', null, 'not configured in this environment', Date.now() - t);
    }
    const keys = await storage.listKeys('backups/');
    return result('Storage', true, `reachable, ${keys.length} backup object(s)`, Date.now() - t);
  } catch (e) {
    return result('Storage', false, e.message, Date.now() - t);
  }
}

/**
 * Are the settings that make the system SAFE actually set?
 *
 * Each of these has bitten this project: mail silently in test mode, a backup
 * passphrase unset so archives are unreadable, alerts delivered to an inbox
 * nobody opens.
 */
export function checkConfig(env = process.env) {
  const t = Date.now();
  const problems = [];
  if (String(env.MAIL_TEST_MODE || '').toLowerCase() === 'true') {
    problems.push('MAIL_TEST_MODE is TRUE — no email is actually being sent');
  }
  if (!(env.BACKUP_ENCRYPTION_PASSPHRASE || '').trim()) {
    problems.push('BACKUP_ENCRYPTION_PASSPHRASE is unset — backups are unreadable');
  }
  if (!(env.JWT_SECRET || '').trim()) problems.push('JWT_SECRET is unset');
  return result('Configuration', problems.length === 0,
    problems.length ? problems.join(' · ') : 'mail, backup key and auth secret all set',
    Date.now() - t);
}

/** Run them all. Never throws — a crashed check must report, not vanish. */
export async function runSmokeChecks(pool, { env = process.env } = {}) {
  const checks = [
    () => checkDbRead(pool),
    () => checkDbWrite(pool),
    () => checkPricingResolves(),
    () => checkStorage(),
    () => checkConfig(env),
  ];
  const out = [];
  for (const run of checks) {
    try { out.push(await run()); }
    catch (e) { out.push(result('unknown check', false, `the check itself threw: ${e.message}`, 0)); }
  }
  return out;
}

/** Roll up to one state for the SOP line. `null` results are UNKNOWN, not OK. */
export function summariseSmoke(results) {
  if (results.some((r) => r.ok === false)) return 'critical';
  if (results.some((r) => r.ok === null)) return 'unknown';
  return 'ok';
}
