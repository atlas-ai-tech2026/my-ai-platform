// ─── screen-shows-what-the-query-sends.test.jsx ──────────────────────────────
// ☠ A COLUMN THE SCREEN RENDERS THAT THE QUERY NEVER SENDS.
//
// Manual Credits shipped with an "Added by" column. Every row showed "—".
// Nothing errored, nothing was logged, no test failed: the component read
// `r.admin_email`, the row simply did not have it, and `|| '—'` turned the
// absence into a dash that looks like an answer. The owner saw it in the first
// screenshot he sent.
//
// It is the house pattern in miniature — something that works exactly as
// written and tells you nothing true. A field that is missing should be a
// bug, not a dash.
//
// This checks the columns Manual Credits depends on are actually in the SELECT
// that feeds it.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const server = readFileSync(join(process.cwd(), 'server/src/index.js'), 'utf8');
const screen = readFileSync(
  join(process.cwd(), 'src/components/admin/ManualCreditsTab.jsx'), 'utf8');

/** The SELECT behind /api/admin/logs, which is what this screen reads. */
function logsSelect() {
  const at = server.indexOf("app.get('/api/admin/logs'");
  expect(at, 'the logs endpoint has moved or gone').toBeGreaterThan(0);
  const body = server.slice(at, at + 1400);
  const m = /SELECT ([\s\S]*?)FROM credits_history/.exec(body);
  return m ? m[1] : '';
}

describe('☠ EVERY FIELD THE SCREEN SHOWS MUST BE IN THE QUERY', () => {
  const select = logsSelect();

  it('found the query — a check over nothing is not a check', () => {
    expect(select).toMatch(/ch\.id/);
  });

  // ☠ ONLY the row loop. The component also names its API RESPONSE `r`
  // (`const r = await adminApi.manualCredits(...)` → r.logs, r.total), and the
  // first version of this test demanded the SQL select a column called
  // "logs". Two different variables, the same letter — scope the search to
  // where rows are actually rendered.
  const loop = screen.slice(screen.indexOf('rows?.map((r) =>'));
  const used = [...new Set([...loop.matchAll(/\br\.([a-z_]+)\b/g)].map((m) => m[1]))]
    .filter((f) => !['map', 'filter', 'length'].includes(f));

  it('lists the fields the screen reads', () => {
    expect(used).toEqual(expect.arrayContaining(['email', 'amount', 'action', 'reason', 'admin_email']));
  });

  it.each(used)('the query sends r.%s', (field) => {
    expect(select,
      `ManualCreditsTab renders r.${field}, but /api/admin/logs does not SELECT it. The column `
      + `will show its fallback on every row — a dash that looks like an answer. Add ch.${field} `
      + `to the SELECT, or stop displaying it.`).toMatch(new RegExp(`\\b${field}\\b`));
  });
});
