#!/usr/bin/env node
/**
 * VOXEL — SPA users + credits report exporter
 *
 * Pulls every user who has ever received a credit grant where the reason
 * matches "spa" (case-insensitive, substring) from credits_history, then
 * writes a polished Excel file with three sheets:
 *
 *   1. "SPA Users + Credits"   – one row per user (id, email, registered,
 *                                current balance, # of SPA grants, total
 *                                credits granted under SPA, first & last
 *                                grant timestamps)
 *   2. "Summary"               – totals + averages
 *   3. "All SPA Grants"        – raw credits_history rows (audit trail)
 *
 * USAGE
 *   1. cd into your repo:    cd ~/my-ai-platform
 *   2. install deps once:    npm install exceljs pg
 *      (pg is already a backend dep; exceljs is the only new one)
 *   3. run the script:       DATABASE_URL="postgresql://..." node export_spa_report.js
 *
 *      If you don't pass DATABASE_URL on the command line, the script
 *      reads it from server/.env (same file your backend uses).
 *
 *   4. open the file:        reports/Voxel_SPA_Users_Report_<timestamp>.xlsx
 *
 * Change the REASON_FILTER constant below if "spa" matches the wrong rows.
 */

import 'dotenv/config';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import ExcelJS from 'exceljs';

// ── Config ────────────────────────────────────────────────────────────
const REASON_FILTER = 'spa';       // case-insensitive substring match on credits_history.reason
// C2 (audit 2026-07-28): reports contain customer PII and must land in the
// git-ignored reports/ folder, never the repo root of this PUBLIC repo.
const OUTPUT_DIR    = path.join(process.cwd(), 'reports');
mkdirSync(OUTPUT_DIR, { recursive: true });
const STAMP         = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUTPUT_FILE   = path.join(OUTPUT_DIR, `Voxel_SPA_Users_Report_${STAMP}.xlsx`);

// ── DATABASE_URL resolution ──────────────────────────────────────────
function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  // Try server/.env relative to script
  const candidates = [
    path.resolve(process.cwd(), 'server/.env'),
    path.resolve(process.cwd(), '.env'),
  ];
  for (const f of candidates) {
    if (existsSync(f)) {
      const env = readFileSync(f, 'utf8');
      const m = env.match(/^DATABASE_URL\s*=\s*['"]?(.+?)['"]?\s*$/m);
      if (m) return m[1].trim();
    }
  }
  throw new Error(
    'No DATABASE_URL found. Set it via env var or in server/.env\n' +
    'Example: DATABASE_URL="postgresql://user:pass@host:port/db" node export_spa_report.js'
  );
}

// Strip sslmode=... (same trick your db.js uses)
function stripSslmode(url) {
  try { const u = new URL(url); u.searchParams.delete('sslmode'); return u.toString(); }
  catch { return url; }
}

// ── Main ─────────────────────────────────────────────────────────────
async function main() {
  const { Pool } = pg;
  const dbUrl = loadDatabaseUrl();
  const pool = new Pool({
    connectionString: stripSslmode(dbUrl),
    ssl: { rejectUnauthorized: false },
  });

  console.log('[spa-report] connecting to Postgres…');

  // 1. Per-user aggregate
  const usersQuery = `
    SELECT
      u.id                                  AS user_id,
      u.email,
      u.created_at                          AS registered_at,
      u.credits                             AS current_balance,
      COUNT(ch.id)                          AS spa_grants_count,
      COALESCE(SUM(ch.amount), 0)::NUMERIC  AS total_spa_credits,
      MIN(ch.created_at)                    AS first_spa_grant,
      MAX(ch.created_at)                    AS last_spa_grant
    FROM users u
    INNER JOIN credits_history ch ON ch.user_id = u.id
    WHERE LOWER(COALESCE(ch.reason,'')) LIKE $1
      AND ch.amount > 0                                    -- only credit ADDITIONS
    GROUP BY u.id, u.email, u.created_at, u.credits
    ORDER BY total_spa_credits DESC, u.id ASC;
  `;
  const { rows: users } = await pool.query(usersQuery, [`%${REASON_FILTER.toLowerCase()}%`]);

  // 2. Detail: every SPA grant row
  const detailQuery = `
    SELECT
      ch.id        AS grant_id,
      ch.user_id,
      u.email,
      ch.amount,
      ch.action,
      ch.reason,
      ch.ip_address,
      ch.created_at
    FROM credits_history ch
    LEFT JOIN users u ON u.id = ch.user_id
    WHERE LOWER(COALESCE(ch.reason,'')) LIKE $1
      AND ch.amount > 0
    ORDER BY ch.created_at DESC;
  `;
  const { rows: grants } = await pool.query(detailQuery, [`%${REASON_FILTER.toLowerCase()}%`]);

  await pool.end();
  console.log(`[spa-report] fetched ${users.length} users, ${grants.length} grant rows`);

  // ── Build the workbook ─────────────────────────────────────────────
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Voxel'; wb.created = new Date();

  // === Sheet 1 — SPA Users + Credits ===
  const ws1 = wb.addWorksheet('SPA Users + Credits', { views: [{ state: 'frozen', ySplit: 4 }] });
  ws1.mergeCells('A1:H1');
  ws1.getCell('A1').value = 'VOXEL — Users with SPA Credit Grants';
  ws1.getCell('A1').font = { name: 'Arial', size: 14, bold: true };
  ws1.mergeCells('A2:H2');
  ws1.getCell('A2').value = `Generated: ${new Date().toISOString().slice(0,19).replace('T',' ')} | Reason filter: %${REASON_FILTER}%`;
  ws1.getCell('A2').font = { name: 'Arial', size: 9, italic: true, color: { argb: 'FF6B7280' } };

  const hdrRow = ws1.getRow(4);
  ['User ID', 'Email', 'Registered', 'Current Balance', '# SPA Grants', 'Total SPA Credits Added', 'First SPA Grant', 'Last SPA Grant']
    .forEach((h, i) => hdrRow.getCell(i + 1).value = h);
  hdrRow.eachCell(c => {
    c.font = { name: 'Arial', bold: true, color: { argb: 'FFBEF264' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A1D21' } };
    c.alignment = { horizontal: 'center', vertical: 'middle' };
    c.border = { top:{style:'thin'},bottom:{style:'thin'},left:{style:'thin'},right:{style:'thin'} };
  });

  users.forEach((u, idx) => {
    const r = ws1.getRow(5 + idx);
    r.getCell(1).value = u.user_id;
    r.getCell(2).value = u.email;
    r.getCell(3).value = u.registered_at ? new Date(u.registered_at).toISOString().slice(0,10) : '';
    r.getCell(4).value = Number(u.current_balance);
    r.getCell(5).value = Number(u.spa_grants_count);
    r.getCell(6).value = Number(u.total_spa_credits);
    r.getCell(7).value = u.first_spa_grant ? new Date(u.first_spa_grant).toISOString().slice(0,10) : '';
    r.getCell(8).value = u.last_spa_grant  ? new Date(u.last_spa_grant ).toISOString().slice(0,10) : '';
    r.getCell(4).numFmt = '#,##0.00';
    r.getCell(6).numFmt = '#,##0.00';
    r.eachCell(c => { c.font = { name: 'Arial', size: 10 };
      c.border = { top:{style:'thin'},bottom:{style:'thin'},left:{style:'thin'},right:{style:'thin'} };
    });
  });

  const totalRow = ws1.getRow(5 + users.length);
  totalRow.getCell(1).value = 'TOTALS';
  totalRow.getCell(4).value = { formula: `SUM(D5:D${5 + users.length - 1})` };
  totalRow.getCell(5).value = { formula: `SUM(E5:E${5 + users.length - 1})` };
  totalRow.getCell(6).value = { formula: `SUM(F5:F${5 + users.length - 1})` };
  totalRow.getCell(4).numFmt = '#,##0.00';
  totalRow.getCell(6).numFmt = '#,##0.00';
  totalRow.eachCell(c => {
    c.font = { name: 'Arial', bold: true };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
    c.border = { top:{style:'thin'},bottom:{style:'thin'},left:{style:'thin'},right:{style:'thin'} };
  });

  ws1.columns = [
    { width: 10 }, { width: 28 }, { width: 14 }, { width: 16 },
    { width: 14 }, { width: 22 }, { width: 14 }, { width: 14 },
  ];

  // === Sheet 2 — Summary ===
  const ws2 = wb.addWorksheet('Summary');
  ws2.getCell('A1').value = 'SPA Credit Grants — Summary';
  ws2.getCell('A1').font = { name: 'Arial', size: 14, bold: true };

  const totalUsers   = users.length;
  const totalCredits = users.reduce((s, u) => s + Number(u.total_spa_credits), 0);
  const totalGrants  = users.reduce((s, u) => s + Number(u.spa_grants_count), 0);
  const avgCredits   = totalUsers > 0 ? totalCredits / totalUsers : 0;
  const avgGrants    = totalUsers > 0 ? totalGrants  / totalUsers : 0;

  const sumRows = [
    ['Metric', 'Value'],
    ['Total users who received SPA grants', totalUsers],
    ['Total credits granted (SPA reason)',  totalCredits],
    ['Total # of grant events',             totalGrants],
    ['Average credits per user',            avgCredits],
    ['Average grants per user',             avgGrants],
    ['Report generated',                    new Date().toISOString().slice(0,19).replace('T',' ')],
  ];
  sumRows.forEach((row, idx) => {
    const r = ws2.getRow(3 + idx);
    r.getCell(1).value = row[0]; r.getCell(2).value = row[1];
    if (idx === 0) {
      r.eachCell(c => {
        c.font = { name: 'Arial', bold: true, color: { argb: 'FFBEF264' } };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A1D21' } };
      });
    } else {
      r.getCell(1).font = { name: 'Arial' };
      r.getCell(2).font = { name: 'Arial', bold: true };
      if (idx === 2 || idx === 4) r.getCell(2).numFmt = '#,##0.00';
      if (idx === 5) r.getCell(2).numFmt = '0.00';
    }
    r.eachCell(c => c.border = { top:{style:'thin'},bottom:{style:'thin'},left:{style:'thin'},right:{style:'thin'} });
  });
  ws2.columns = [{ width: 38 }, { width: 22 }];

  // === Sheet 3 — All SPA Grants ===
  const ws3 = wb.addWorksheet('All SPA Grants (detail)', { views: [{ state: 'frozen', ySplit: 3 }] });
  ws3.mergeCells('A1:H1');
  ws3.getCell('A1').value = 'Every credits_history row where reason matches SPA';
  ws3.getCell('A1').font = { name: 'Arial', size: 14, bold: true };

  const dhdr = ws3.getRow(3);
  ['Grant ID', 'User ID', 'Email', 'Amount (credits)', 'Action', 'Reason', 'IP', 'Created At']
    .forEach((h, i) => dhdr.getCell(i + 1).value = h);
  dhdr.eachCell(c => {
    c.font = { name: 'Arial', bold: true, color: { argb: 'FFBEF264' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A1D21' } };
    c.alignment = { horizontal: 'center' };
  });

  grants.forEach((g, idx) => {
    const r = ws3.getRow(4 + idx);
    r.getCell(1).value = g.grant_id;
    r.getCell(2).value = g.user_id;
    r.getCell(3).value = g.email || '';
    r.getCell(4).value = Number(g.amount);
    r.getCell(5).value = g.action || '';
    r.getCell(6).value = g.reason || '';
    r.getCell(7).value = g.ip_address || '';
    r.getCell(8).value = g.created_at ? new Date(g.created_at).toISOString().slice(0,19).replace('T',' ') : '';
    r.getCell(4).numFmt = '#,##0.00';
    r.eachCell(c => { c.font = { name: 'Arial', size: 10 };
      c.border = { top:{style:'thin'},bottom:{style:'thin'},left:{style:'thin'},right:{style:'thin'} };
    });
  });
  ws3.columns = [
    { width: 10 }, { width: 10 }, { width: 28 }, { width: 16 },
    { width: 18 }, { width: 32 }, { width: 16 }, { width: 18 },
  ];

  await wb.xlsx.writeFile(OUTPUT_FILE);
  console.log(`[spa-report] wrote ${OUTPUT_FILE}`);
  console.log(`[spa-report] ✓ ${users.length} users, ${grants.length} grants, ${totalCredits} total credits granted`);
}

main().catch(err => {
  console.error('[spa-report] FAILED:', err.message);
  process.exit(1);
});
