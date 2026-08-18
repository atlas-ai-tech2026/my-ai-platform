// ─── backup-verify.js ────────────────────────────────────────────────────────
// Proves a backup can actually be RESTORED. Nothing had ever done this.
//
// WHAT WAS ALREADY TRUE before this file, and what was not:
//   ✓ backups run daily to two places, encrypted (M3)
//   ✓ RESTORE.md documents the whole procedure, including a drill
//   ✗ nobody had ever performed the drill — not once
//   ✗ nothing checked, so nothing could report
//
// RESTORE.md asks for the drill "once a quarter, ~20 minutes". A quarterly
// manual checklist fails in the quarter you are busy, which is the quarter it
// matters. This turns steps 1-4 of that drill into something that runs itself
// and speaks into ALERTS — the same principle applied to the rest of this
// codebase: a check whose only output is a log is not a check.
//
// ── THE FIVE WAYS A BACKUP IS SECRETLY DEAD ───────────────────────────────
// In rough order of how likely they are, and what catches each:
//
//   1. THE PASSPHRASE IS WRONG OR LOST. Every archive is unreadable and
//      nothing says so. → decrypt actually runs. AES-GCM authenticates, so a
//      wrong passphrase throws rather than yielding plausible garbage.
//   2. THE OFFSITE COPY IS MISSING OR STALE. The primary succeeded, the second
//      quietly did not, and one copy in one account is what M3 existed to end.
//      → the archive is FETCHED from offsite, and its age is checked.
//   3. THE ARCHIVE IS CORRUPT. → gunzip + GCM auth tag.
//   4. THE BACKUP IS INCOMPLETE. A table erroring mid-dump is written into the
//      file as {table, error} and the job still "succeeds". → every row is
//      counted and compared against the manifest the backup wrote about
//      ITSELF, and any recorded per-table error is surfaced.
//   5. THE ROWS NO LONGER FIT THE SCHEMA. Columns have moved on since the
//      backup was taken, so the file is perfect and still will not load.
//      → the only one that needs a database: rows are really INSERTed into a
//      throwaway schema built with LIKE public.<table> INCLUDING ALL.
//
// 1-4 need no database and are the overwhelming majority of real failures —
// RESTORE.md says as much itself: "Steps 1-3 alone catch almost every real
// backup failure." They run on a schedule. 5 is opt-in via verifyLoadable()
// because it writes (to a temporary schema it then drops).
//
// NOTHING HERE EVER TOUCHES THE LIVE TABLES. The load test creates its own
// schema, works only inside it, and drops it in a finally block.

import zlib from 'node:zlib';
import { GetObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { decryptBackup } from './backup-offsite.js';

/** Tables whose emptiness means the backup is worthless, whatever else is in
 *  it. A backup with zero users is not a backup of this business. */
export const CRITICAL_TABLES = ['users', 'credits_history', 'promo_codes', 'promo_redemptions'];

/** Older than this and the "daily" backup is not daily. Two days, not one:
 *  a single missed run is a blip, two is a broken job. */
export const MAX_ARCHIVE_AGE_HOURS = 48;

/** How long a verification stays fresh before its absence is itself a finding. */
export const MAX_VERIFY_AGE_DAYS = 35;

// ── parsing ────────────────────────────────────────────────────────────────

/**
 * Decrypt → gunzip → parse an archive, counting what is really inside it.
 *
 * Deliberately does NOT trust the manifest: it counts rows itself and returns
 * both numbers so the caller can compare. A backup that lies about its own
 * contents is exactly the failure worth catching.
 *
 * @returns {{meta, manifestCounts, actualCounts, tableErrors, rowsTotal, lines}}
 */
export function parseArchive(encryptedBuffer, passphrase) {
  const gz = decryptBackup(encryptedBuffer, passphrase);   // throws on bad passphrase
  const ndjson = zlib.gunzipSync(gz).toString('utf8');     // throws on corruption

  let meta = null;
  let manifestCounts = null;
  const actualCounts = {};
  const tableErrors = [];
  let rowsTotal = 0;
  let lines = 0;
  let malformed = 0;

  for (const line of ndjson.split('\n')) {
    if (!line.trim()) continue;
    lines++;
    let obj;
    try { obj = JSON.parse(line); } catch { malformed++; continue; }

    if (obj.meta) { meta = obj.meta; continue; }
    if (obj.done) { manifestCounts = obj.counts || {}; continue; }
    // A table that failed mid-dump is recorded IN the archive and the backup
    // job still reports success. This is the line that makes it visible.
    if (obj.table && obj.error) { tableErrors.push({ table: obj.table, error: obj.error }); continue; }
    if (obj.table && obj.row) {
      actualCounts[obj.table] = (actualCounts[obj.table] || 0) + 1;
      rowsTotal++;
    }
  }

  return { meta, manifestCounts, actualCounts, tableErrors, rowsTotal, lines, malformed };
}

/**
 * Turn a parsed archive into a verdict.
 * Pure — no I/O — so every branch below is directly testable.
 */
export function verifyParsed(parsed, { now = new Date(), criticalTables = CRITICAL_TABLES } = {}) {
  const problems = [];
  const warnings = [];

  if (!parsed.meta) problems.push('no meta line — this may not be a Voxel archive');
  if (!parsed.manifestCounts) {
    // The manifest is the LAST line. Missing means the dump was cut off
    // partway, which a size check alone would never reveal.
    problems.push('no final manifest line — the backup was truncated, not finished');
  }
  if (parsed.malformed) problems.push(`${parsed.malformed} unparseable line(s)`);

  for (const { table, error } of parsed.tableErrors) {
    problems.push(`table "${table}" failed during backup: ${error}`);
  }

  // Manifest vs reality, per table.
  const mismatches = [];
  if (parsed.manifestCounts) {
    for (const [table, expected] of Object.entries(parsed.manifestCounts)) {
      const actual = parsed.actualCounts[table] || 0;
      if (actual !== expected) mismatches.push({ table, expected, actual });
    }
  }
  for (const m of mismatches) {
    problems.push(`${m.table}: manifest says ${m.expected} rows, archive contains ${m.actual}`);
  }

  // Critical tables must exist AND be non-empty.
  const emptyCritical = criticalTables.filter((t) => !(parsed.actualCounts[t] > 0));
  for (const t of emptyCritical) problems.push(`critical table "${t}" is empty or absent`);

  // Age.
  let ageHours = null;
  if (parsed.meta?.exported_at) {
    ageHours = (now - new Date(parsed.meta.exported_at)) / 36e5;
    if (ageHours > MAX_ARCHIVE_AGE_HOURS) {
      problems.push(`archive is ${Math.floor(ageHours / 24)} day(s) old — the daily backup is not running`);
    }
  } else {
    warnings.push('archive has no exported_at timestamp; age unknown');
  }

  return {
    ok: problems.length === 0,
    problems,
    warnings,
    rowsTotal: parsed.rowsTotal,
    tables: Object.keys(parsed.actualCounts).length,
    counts: parsed.actualCounts,
    mismatches,
    ageHours,
    exportedAt: parsed.meta?.exported_at || null,
  };
}

// ── fetching the real archive ──────────────────────────────────────────────

function s3(env) {
  return new S3Client({
    endpoint: env.OFFSITE_S3_ENDPOINT.trim(),
    region: env.OFFSITE_S3_REGION.trim(),
    credentials: {
      accessKeyId: env.OFFSITE_S3_KEY.trim(),
      secretAccessKey: env.OFFSITE_S3_SECRET.trim(),
    },
    forcePathStyle: true,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

/**
 * Newest archive in the OFFSITE bucket — deliberately not DO Spaces.
 *
 * The offsite copy is the one that survives losing the DigitalOcean account,
 * which is the whole scenario M3 was about. Verifying the convenient copy
 * would prove the least important half.
 */
export async function fetchLatestOffsite(env = process.env, { client = null } = {}) {
  const c = client || s3(env);
  const prefix = (env.OFFSITE_S3_PREFIX || 'backups/').replace(/^\/+/, '');
  const listed = await c.send(new ListObjectsV2Command({
    Bucket: env.OFFSITE_S3_BUCKET.trim(), Prefix: prefix,
  }));
  const objects = (listed.Contents || []).filter((o) => o.Key && o.Size > 0);
  if (!objects.length) throw new Error(`no objects under ${prefix} in the offsite bucket`);

  objects.sort((a, b) => new Date(b.LastModified) - new Date(a.LastModified));
  const newest = objects[0];

  const got = await c.send(new GetObjectCommand({
    Bucket: env.OFFSITE_S3_BUCKET.trim(), Key: newest.Key,
  }));
  const body = Buffer.from(await got.Body.transformToByteArray());
  return { key: newest.Key, size: body.length, lastModified: newest.LastModified, body };
}

/**
 * Newest archive in the PRIMARY copy (DigitalOcean Spaces).
 *
 * Used only when the offsite copy cannot be reached. Two different questions
 * hide inside "can we restore?":
 *   (a) is there a readable archive at all — is the passphrase right?
 *   (b) is there a readable archive OUTSIDE DigitalOcean?
 * Only (b) needs the offsite copy. Letting a bandwidth cap block (a) as well
 * means a transient billing limit stops us answering the question that
 * actually keeps the business alive — which is what happened on 2026-08-17.
 *
 * The offsite failure is still recorded as a problem. This does not paper
 * over it; it stops it hiding a second, bigger answer.
 */
export async function fetchLatestPrimary(storage, { prefix = 'backups/' } = {}) {
  const objects = (await storage.listKeys(prefix)).filter((o) => o.size > 0);
  if (!objects.length) throw new Error(`no objects under ${prefix} in the primary bucket`);
  objects.sort((a, b) => new Date(b.modified) - new Date(a.modified));
  const newest = objects[0];
  const body = await storage.downloadPrivate(newest.key);
  return { key: newest.key, size: body.length, lastModified: newest.modified, body, source: 'primary' };
}

// ── the load test (the only part that needs a database) ────────────────────

/** Reject anything that is not a plain table identifier before it reaches SQL.
 *  Table names here come from our own archive, but an archive is a FILE, and a
 *  file is untrusted input the moment it is the thing you are testing. */
function safeIdent(name) {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`unsafe table identifier: ${name}`);
  return name;
}

/**
 * Really insert the backed-up rows into throwaway copies of the live tables.
 * This is the only check that can answer "will this data still go back in?" —
 * a perfect archive whose columns no longer match the schema loads nothing.
 *
 * Isolated by construction: everything happens inside a uniquely-named schema
 * created at the start and dropped in `finally`, even on failure. The live
 * tables are only ever read from, by LIKE.
 */
export async function verifyLoadable(pool, parsed, {
  tables = CRITICAL_TABLES,
  rowsPerTable = 500,
} = {}) {
  const results = [];
  const client = await pool.connect();
  let unavailable = null;

  try {
    // TEMPORARY tables inside a transaction that is ALWAYS rolled back.
    //
    // The first version created a real schema, and production answered
    // "permission denied for database dev-db-347887" — the managed-Postgres
    // app user has no CREATE on the database, and it should not have. Needing
    // a privilege escalation to check your backups is a bad trade.
    //
    // Temp tables need no special grant, live only in this session, and the
    // ROLLBACK discards them along with everything written. There is no path
    // by which this touches a real table: the only reference to public.<t> is
    // LIKE, which reads the shape and copies nothing.
    await client.query('BEGIN');

    for (const table of tables) {
      const t = safeIdent(table);
      const rows = (parsed.rowsByTable?.[t] || []).slice(0, rowsPerTable);
      if (!rows.length) { results.push({ table: t, attempted: 0, loaded: 0, error: 'no rows in archive' }); continue; }

      // INCLUDING ALL brings the column types, defaults and constraints of the
      // CURRENT schema — which is exactly what the backup must still satisfy.
      await client.query(`CREATE TEMP TABLE restore_check_${t} (LIKE public.${t} INCLUDING ALL) ON COMMIT DROP`);

      const cols = Object.keys(rows[0]);
      cols.forEach(safeIdent);
      const colList = cols.map((c) => `"${c}"`).join(',');
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(',');

      let loaded = 0;
      let error = null;
      for (const row of rows) {
        try {
          await client.query(
            `INSERT INTO restore_check_${t} (${colList}) VALUES (${placeholders})
             ON CONFLICT DO NOTHING`,
            cols.map((c) => row[c]));
          loaded++;
        } catch (e) {
          // First failure is the informative one; the rest are usually the
          // same cause repeated, and 500 identical errors help nobody.
          error = e.message;
          break;
        }
      }
      results.push({ table: t, attempted: rows.length, loaded, error });
    }
  } catch (e) {
    // Could not run at all — an environment limitation, NOT a verdict on the
    // backup. Reported separately so it cannot be read as "the data is bad".
    unavailable = e.message;
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }

  const failed = results.filter((r) => r.error);
  return {
    ok: !unavailable && failed.length === 0,
    unavailable,
    results,
    problems: failed.map((r) => `${r.table}: ${r.error} (loaded ${r.loaded}/${r.attempted})`),
  };
}

/**
 * parseArchive keeps only counts, because holding every row of every table in
 * memory to count them would be wasteful. The load test needs actual rows, so
 * this second pass collects a bounded sample of the tables it will try.
 */
export function collectRows(encryptedBuffer, passphrase, { tables = CRITICAL_TABLES, limit = 500 } = {}) {
  const ndjson = zlib.gunzipSync(decryptBackup(encryptedBuffer, passphrase)).toString('utf8');
  const want = new Set(tables);
  const rowsByTable = {};
  for (const t of tables) rowsByTable[t] = [];

  for (const line of ndjson.split('\n')) {
    if (!line.trim()) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    if (obj.table && obj.row && want.has(obj.table) && rowsByTable[obj.table].length < limit) {
      rowsByTable[obj.table].push(obj.row);
    }
  }
  return rowsByTable;
}
