#!/usr/bin/env node
/**
 * VOXEL — "Today's 70-credit SPA grants" Excel exporter
 *
 * Pulls every credits_history row where:
 *   - amount      = 70
 *   - reason      contains "spa" (case-insensitive)
 *   - created_at  is today (server's local date)
 *
 * Outputs a single-sheet Excel with the count at the top + a row per user.
 *
 * USAGE
 *   cd ~/my-ai-platform
 *   npm install exceljs                          # one-time, if not done
 *   node export_spa_70_today.js                  # writes reports/Voxel_SPA_70_TODAY_<date>.xlsx
 *
 * Change AMOUNT or REASON_FILTER at the top if needed.
 */

import 'dotenv/config';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import ExcelJS from 'exceljs';

// ── Filters ────────────────────────────────────────────────────────
const AMOUNT         = 70;
const REASON_FILTER  = 'spa';
const TODAY          = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

// ── DB connection helper ───────────────────────────────────────────
function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const f of [path.resolve(process.cwd(), 'server/.env'), path.resolve(process.cwd(), '.env')]) {
    if (existsSync(f)) {
      const m = readFileSync(f, 'utf8').match(/^DATABASE_URL\s*=\s*['"]?(.+?)['"]?\s*$/m);
      if (m) return m[1].trim();
    }
  }
  throw new Error('No DATABASE_URL found. Set it in env or server/.env');
}
function stripSslmode(url) {
  try { const u = new URL(url); u.searchParams.delete('sslmode'); return u.toString(); }
  catch { return url; }
}

// ── Main ───────────────────────────────────────────────────────────
async function main() {
  const { Pool } = pg;
  const pool = new Pool({
    connectionString: stripSslmode(loadDatabaseUrl()),
    ssl: { rejectUnauthorized: false },
  });

  console.log(`[spa-70-today] querying credits_history for amount=${AMOUNT}, reason like %${REASON_FILTER}%, date=${TODAY}`);

  const sql = `
    SELECT
      ch.id        AS grant_id,
      ch.user_id,
      u.email,
      ch.amount,
      ch.reason,
      ch.created_at,
      ch.ip_address
    FROM credits_history ch
    LEFT JOIN users u ON u.id = ch.user_id
    WHERE ch.amount = $1
      AND LOWER(COALESCE(ch.reason,'')) LIKE $2
      AND ch.created_at::date = CURRENT_DATE
    ORDER BY ch.created_at ASC;
  `;
  const { rows } = await pool.query(sql, [AMOUNT, `%${REASON_FILTER.toLowerCase()}%`]);
  await pool.end();

  console.log(`[spa-70-today] found ${rows.length} grant(s) today`);

  // ── Build the Excel ───────────────────────────────────────────
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Voxel'; wb.created = new Date();

  const ws = wb.addWorksheet(`Today's ${AMOUNT}-credit SPA grants`, {
    views: [{ state: 'frozen', ySplit: 6 }]
  });

  ws.mergeCells('A1:F1');
  ws.getCell('A1').value = `Users you added ${AMOUNT} credits to TODAY (${TODAY}) — reason: SPA`;
  ws.getCell('A1').font = { name: 'Arial', size: 14, bold: true };

  ws.mergeCells('A2:F2');
  ws.getCell('A2').value = `Filter: amount=${AMOUNT} AND reason LIKE %${REASON_FILTER}% AND created_at = today`;
  ws.getCell('A2').font = { name: 'Arial', size: 9, italic: true, color: { argb: 'FF6B7280' } };

  // Big number callout (row 4)
  ws.getCell('A4').value = 'TOTAL USERS:';
  ws.getCell('A4').font = { name: 'Arial', bold: true, size: 11 };
  ws.getCell('A4').alignment = { horizontal: 'right', vertical: 'middle' };

  ws.getCell('B4').value = rows.length;
  ws.getCell('B4').font = { name: 'Arial', bold: true, size: 24, color: { argb: 'FF22C55E' } };
  ws.getCell('B4').alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getCell('B4').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFECFCCB' } };

  ws.getCell('C4').value = 'TOTAL CREDITS GIVEN:';
  ws.getCell('C4').font = { name: 'Arial', bold: true, size: 11 };
  ws.getCell('C4').alignment = { horizontal: 'right', vertical: 'middle' };

  ws.getCell('D4').value = { formula: `B4*${AMOUNT}` };
  ws.getCell('D4').font = { name: 'Arial', bold: true, size: 24, color: { argb: 'FF22C55E' } };
  ws.getCell('D4').alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getCell('D4').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFECFCCB' } };
  ws.getCell('D4').numFmt = '#,##0';

  ws.getRow(4).height = 36;

  // Headers (row 6)
  const hdr = ws.getRow(6);
  ['User ID', 'Email', 'Credits Added', 'Reason', 'Time (today)', 'IP'].forEach((h, i) => hdr.getCell(i + 1).value = h);
  hdr.eachCell(c => {
    c.font = { name: 'Arial', bold: true, color: { argb: 'FFBEF264' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A1D21' } };
    c.alignment = { horizontal: 'center' };
    c.border = { top:{style:'thin'},bottom:{style:'thin'},left:{style:'thin'},right:{style:'thin'} };
  });

  // Data rows
  rows.forEach((g, idx) => {
    const r = ws.getRow(7 + idx);
    r.getCell(1).value = g.user_id;
    r.getCell(2).value = g.email || '(unknown)';
    r.getCell(3).value = Number(g.amount);
    r.getCell(4).value = g.reason || '';
    r.getCell(5).value = g.created_at ? new Date(g.created_at).toISOString().slice(0,19).replace('T',' ') : '';
    r.getCell(6).value = g.ip_address || '';
    r.getCell(3).numFmt = '#,##0';
    r.eachCell(c => {
      c.font = { name: 'Arial', size: 10 };
      c.border = { top:{style:'thin'},bottom:{style:'thin'},left:{style:'thin'},right:{style:'thin'} };
    });
  });

  // Totals row
  if (rows.length > 0) {
    const t = ws.getRow(7 + rows.length);
    t.getCell(1).value = 'TOTAL';
    t.getCell(3).value = { formula: `SUM(C7:C${7 + rows.length - 1})` };
    t.getCell(3).numFmt = '#,##0';
    t.eachCell(c => {
      c.font = { name: 'Arial', bold: true };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
      c.border = { top:{style:'thin'},bottom:{style:'thin'},left:{style:'thin'},right:{style:'thin'} };
    });
  }

  ws.columns = [
    { width: 10 }, { width: 30 }, { width: 14 }, { width: 28 }, { width: 22 }, { width: 14 },
  ];

  // C2 (audit 2026-07-28): PII reports go into the git-ignored reports/
  // folder, never the repo root of this PUBLIC repo.
  const outDir = path.join(process.cwd(), 'reports');
  mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `Voxel_SPA_${AMOUNT}_TODAY_${TODAY}.xlsx`);
  await wb.xlsx.writeFile(outFile);
  console.log(`[spa-70-today] wrote ${outFile}`);
  console.log(`[spa-70-today] ${rows.length} users got ${AMOUNT} credits today = ${rows.length * AMOUNT} credits total`);
}

main().catch(err => {
  console.error('[spa-70-today] FAILED:', err.message);
  process.exit(1);
});
