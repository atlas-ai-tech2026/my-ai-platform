#!/usr/bin/env node
// ─── refresh-dev-db.mjs ──────────────────────────────────────────────────────
// Make the dev database look like production, WITHOUT making dev a second
// front door to real customer accounts.
//
// WHY THIS EXISTS. Dev's Postgres was copied once, around 2 August, and then
// left. By 16 August it held 379 of production's 592 users, ZERO promo codes,
// ZERO redemptions and nothing after 6 August — so it could not reproduce the
// business: no workshop cohorts, no bulk expiry, no P&L. That cost real time
// twice in one day, including sending the owner to check a screen that had no
// data behind it.
//
// THE ONE THING THIS DELIBERATELY BREAKS. dev.voxel-ai.ai is a PUBLIC site with
// a working sign-in form. Copying users verbatim would copy password hashes,
// so every customer's real password would also work on a test system where
// half-finished features land and settings get changed freely. So every
// non-admin password hash on dev is replaced with an unusable value and TOTP
// secrets are cleared. Nothing is lost for analysis, reporting or the P&L —
// the only thing that stops working is signing in AS a customer on dev.
//
// Production is opened in a READ ONLY transaction and never written to.
//
// Usage:
//   node scripts/refresh-dev-db.mjs           # dry run, changes nothing
//   node scripts/refresh-dev-db.mjs apply
//
// Re-runnable on purpose: a one-off copy is stale again within a fortnight,
// which is exactly how the situation above arose.

import { execFileSync } from 'node:child_process';
import pg from 'pg';

const APPLY = process.argv[2] === 'apply';
const PROD = { cluster: '0dc10c53-06b2-4716-b61c-6eb2e63cb13b', db: 'dev-db-347887' };
const DEV  = { cluster: 'eaeb9f05-ca43-4b3e-a093-4f3f53620ce6', db: 'dev-db' };

// bcrypt-shaped but not a hash of anything. bcrypt.compare returns false for
// every input, so these accounts simply cannot be signed into.
const DEAD_HASH = '$2a$12$devONLYnoLOGINnoLOGINnoLOGINnoLOGINnoLOGINnoLOGINno';

const connect = async ({ cluster, db }) => {
  const uri = execFileSync('doctl', ['databases', 'connection', cluster, '--format', 'URI', '--no-header'],
    { encoding: 'utf8' }).trim();
  const u = new URL(uri); u.pathname = `/${db}`; u.search = '';
  const c = new pg.Client({ connectionString: u.toString(), ssl: { rejectUnauthorized: false } });
  await c.connect();
  return c;
};

const columnsOf = async (client, table) => (await client.query(
  `SELECT column_name FROM information_schema.columns WHERE table_name = $1`, [table]
)).rows.map((r) => r.column_name);

/** Columns present in BOTH schemas, so schema drift cannot corrupt the copy. */
const shared = async (a, b, table, drop = ['id']) => {
  const A = new Set(await columnsOf(a, table));
  return (await columnsOf(b, table)).filter((c) => A.has(c) && !drop.includes(c));
};

const main = async () => {
  const prod = await connect(PROD);
  const dev = await connect(DEV);
  await prod.query('BEGIN TRANSACTION READ ONLY');

  const userCols = await shared(prod, dev, 'users');
  const { rows: pUsers } = await prod.query(`SELECT ${userCols.join(',')} FROM users`);
  const { rows: dUsers } = await dev.query(`SELECT id, lower(email) AS email, role FROM users`);
  const devByEmail = new Map(dUsers.map((u) => [u.email, u]));
  const missing = pUsers.filter((u) => !devByEmail.has(String(u.email).toLowerCase()));

  const { rows: [{ m: devMaxHistory }] } = await dev.query(
    `SELECT MAX(created_at) AS m FROM credits_history`);

  const histCols = await shared(prod, dev, 'credits_history');
  const newEmails = new Set(missing.map((u) => String(u.email).toLowerCase()));

  // Existing dev users need only the GAP (anything after dev's newest row).
  // Newly copied users need their WHOLE history, or a person who registered on
  // 4 August arrives with their first two days missing.
  const { rows: history } = await prod.query(
    `SELECT lower(u.email) AS _email, ${histCols.filter((c) => c !== 'user_id').map((c) => `h.${c}`).join(',')}
       FROM credits_history h JOIN users u ON u.id = h.user_id
      WHERE h.created_at > $1 OR lower(u.email) = ANY($2::text[])`,
    [devMaxHistory, [...newEmails]]);

  const codeCols = await shared(prod, dev, 'promo_codes');
  const { rows: codes } = await prod.query(`SELECT ${codeCols.join(',')} FROM promo_codes`);
  const { rows: reds } = await prod.query(
    `SELECT upper(p.code) AS code, lower(u.email) AS email, r.created_at
       FROM promo_redemptions r
       JOIN promo_codes p ON p.id = r.code_id
       JOIN users u ON u.id = r.user_id`);

  const admins = dUsers.filter((u) => u.role === 'admin').length;
  const scrubbable = dUsers.length - admins + missing.filter((u) => u.role !== 'admin').length;

  console.log('\n── what this will do ──');
  console.table([
    { step: 'users to add',                 count: missing.length },
    { step: 'credit-history rows to add',   count: history.length },
    { step: 'promo codes to add',           count: codes.length },
    { step: 'redemptions to add',           count: reds.length },
    { step: 'passwords to scrub (non-admin)', count: scrubbable },
    { step: 'admin accounts left signable', count: admins },
  ]);
  console.log(`dev history currently ends: ${devMaxHistory ? devMaxHistory.toISOString() : 'never'}`);

  if (!APPLY) {
    console.log('\n(dry run — nothing written. Re-run with "apply".)');
    await prod.query('ROLLBACK'); await prod.end(); await dev.end();
    return;
  }

  await dev.query('BEGIN');
  try {
    // 1. accounts, with credentials already dead on arrival
    const pw = userCols.indexOf('password_hash');
    for (const u of missing) {
      const vals = userCols.map((c) => u[c]);
      if (pw >= 0) vals[pw] = DEAD_HASH;
      for (const t of ['totp_secret', 'totp_recovery_codes', 'totp_last_step']) {
        const i = userCols.indexOf(t);
        if (i >= 0) vals[i] = null;
      }
      const i = userCols.indexOf('totp_enabled');
      if (i >= 0) vals[i] = false;
      await dev.query(
        `INSERT INTO users (${userCols.join(',')})
              VALUES (${userCols.map((_, j) => `$${j + 1}`).join(',')})
         ON CONFLICT DO NOTHING`, vals);
    }

    // 2. and the ones already here, carried over from the 2 August copy
    const scrub = await dev.query(
      `UPDATE users SET password_hash = $1, totp_secret = NULL, totp_enabled = FALSE,
              totp_recovery_codes = NULL
        WHERE role <> 'admin' AND password_hash IS DISTINCT FROM $1
        RETURNING id`, [DEAD_HASH]);

    const { rows: allDev } = await dev.query(`SELECT id, lower(email) AS email FROM users`);
    const uid = new Map(allDev.map((u) => [u.email, u.id]));

    // 3. the ledger
    const fields = ['user_id', ...histCols.filter((c) => c !== 'user_id')];
    let hRows = 0;
    for (let i = 0; i < history.length; i += 500) {
      const batch = history.slice(i, i + 500).filter((r) => uid.has(r._email));
      if (!batch.length) continue;
      const vals = [], parts = [];
      for (const r of batch) {
        const row = [uid.get(r._email), ...histCols.filter((c) => c !== 'user_id').map((c) => r[c])];
        parts.push(`(${row.map((_, j) => `$${vals.length + j + 1}`).join(',')})`);
        vals.push(...row);
      }
      await dev.query(`INSERT INTO credits_history (${fields.join(',')}) VALUES ${parts.join(',')}`, vals);
      hRows += batch.length;
    }

    // 4. codes and who redeemed them — the cohort link the P&L needs
    for (const c of codes) {
      await dev.query(
        `INSERT INTO promo_codes (${codeCols.join(',')})
              VALUES (${codeCols.map((_, j) => `$${j + 1}`).join(',')})
         ON CONFLICT DO NOTHING`, codeCols.map((k) => c[k]));
    }
    const { rows: devCodes } = await dev.query(`SELECT id, upper(code) AS code FROM promo_codes`);
    const cid = new Map(devCodes.map((c) => [c.code, c.id]));
    let rRows = 0;
    for (const r of reds) {
      const U = uid.get(r.email), C = cid.get(r.code);
      if (!U || !C) continue;
      rRows += (await dev.query(
        `INSERT INTO promo_redemptions (code_id, user_id, created_at)
              VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [C, U, r.created_at])).rowCount;
    }

    await dev.query('COMMIT');
    console.log('\n✅ dev refreshed');
    console.table([
      { result: 'users added',        n: missing.length },
      { result: 'passwords scrubbed', n: scrub.rowCount },
      { result: 'history rows added', n: hRows },
      { result: 'promo codes',        n: devCodes.length },
      { result: 'redemptions added',  n: rRows },
    ]);
    console.log('\nCustomer sign-in on dev is now impossible by design. Admin sign-in is untouched.');
  } catch (e) {
    await dev.query('ROLLBACK');
    console.error('\n❌ ROLLED BACK — dev unchanged:', e.message);
    process.exitCode = 1;
  }
  await prod.query('ROLLBACK');
  await prod.end(); await dev.end();
};

main().catch((e) => { console.error(e.message); process.exit(1); });
