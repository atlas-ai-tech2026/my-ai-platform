// ─── credit-report.test.js ───────────────────────────────────────────────────
// The credit report must show exactly the rows the Logs page would show for
// the same filters — so the two routes share one filter builder — and it must
// be behind the admin gate like everything else that reads the ledger.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, 'index.js'), 'utf8');

function routeBody(route) {
  const start = src.indexOf(`app.get('${route}'`);
  expect(start, `route ${route} not found`).toBeGreaterThan(-1);
  const next = src.indexOf('\napp.get(', start + 1);
  const alt = src.indexOf('\napp.post(', start + 1);
  return src.slice(start, Math.min(...[next, alt, src.length].filter((i) => i > 0)));
}

describe('GET /api/admin/reports/credits', () => {
  const report = routeBody('/api/admin/reports/credits');
  const logs = routeBody('/api/admin/logs');

  it('is admin-only', () => {
    expect(report).toMatch(/app\.get\('\/api\/admin\/reports\/credits', adminGate/);
  });

  it('uses the SAME filter builder as the Logs page — same filters, same rows', () => {
    expect(report).toMatch(/ledgerFilters\(req\.query\)/);
    expect(logs).toMatch(/ledgerFilters\(req\.query\)/);
    expect(src).toMatch(/function ledgerFilters\(query\)/);
  });

  it('the shared filters still cover reason text, action, email and dates', () => {
    const fn = src.slice(src.indexOf('function ledgerFilters(query)'), src.indexOf("app.get('/api/admin/logs'"));
    expect(fn).toMatch(/ch\.reason ILIKE/);
    expect(fn).toMatch(/ch\.action = /);
    expect(fn).toMatch(/u\.email ILIKE/);
    expect(fn).toMatch(/ch\.created_at >= /);
    expect(fn).toMatch(/INTERVAL '1 day'/);
  });

  it('returns every matching row with who added it, oldest first, and says when it capped', () => {
    expect(report).toMatch(/ch\.admin_email/);
    expect(report).toMatch(/ORDER BY ch\.created_at ASC/);
    expect(report).toMatch(/const cap = 5000/);
    expect(report).toMatch(/LIMIT \$\{cap \+ 1\}/);
    expect(report).toMatch(/truncated/);
  });

  it('returns the totals a report needs — rows, distinct people, credits', () => {
    expect(report).toMatch(/accounts: new Set\(out\.map\(\(r\) => r\.user_id\)\)\.size/);
    expect(report).toMatch(/credits: Math\.round\(credits \* 100\) \/ 100/);
  });
});
