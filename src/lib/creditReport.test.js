// ─── creditReport.test.js ────────────────────────────────────────────────────
// The workshop report is handed to other people, so its numbers are tested,
// and the two checks a bookkeeper does by hand — duplicates and odd amounts —
// must come out of the same rows.

import { describe, it, expect } from 'vitest';
import { summarizeCreditRows, buildCreditReportHtml } from './creditReport';

const row = (email, amount, extra = {}) => ({
  id: Math.random(), email, amount, action: 'grant', admin_email: 'atlas@example.com',
  reason: 'SPA4', created_at: '2026-08-30T09:00:00Z', ...extra,
});

describe('summarizeCreditRows — the workshop totals', () => {
  it('counts people, entries, credits and the dollar value', () => {
    const s = summarizeCreditRows([row('a@x.com', 395), row('b@x.com', 395), row('c@x.com', 395)]);
    expect(s).toMatchObject({ grants: 3, accounts: 3, credits: 1185, standard: 395 });
    expect(s.usd).toBeCloseTo(75.05, 2);          // 1185 × $19/300
    expect(s.standardUsd).toBeCloseTo(25.02, 2);  // the "$25" of the workshop
    expect(s.duplicates).toEqual([]);
    expect(s.offStandard).toEqual([]);
  });

  it('finds the email that received the credit twice — case-insensitively', () => {
    const s = summarizeCreditRows([row('a@x.com', 395), row('A@X.com', 395), row('b@x.com', 395)]);
    expect(s.accounts).toBe(2);
    expect(s.duplicates).toEqual([{ email: 'a@x.com', count: 2, credits: 790 }]);
  });

  it('finds the entry whose amount differs from everyone else\'s', () => {
    const s = summarizeCreditRows([row('a@x.com', 395), row('b@x.com', 395), row('c@x.com', 300)]);
    expect(s.standard).toBe(395);
    expect(s.offStandard.map((r) => r.email)).toEqual(['c@x.com']);
  });

  it('copes with an empty result', () => {
    expect(summarizeCreditRows([])).toMatchObject({ grants: 0, accounts: 0, credits: 0, usd: 0, standard: null });
  });
});

describe('buildCreditReportHtml — the page that becomes the PDF', () => {
  const rows = [row('a@x.com', 395), row('b@x.com', 395), row('c@x.com', 300)];
  const html = buildCreditReportHtml({ rows, filters: { q: 'SPA4', action: 'grant' }, generatedAt: '2026-09-03T10:00:00Z' });

  it('names the filters and the source, and lists every email', () => {
    expect(html).toContain('Reason contains “SPA4”');
    expect(html).toContain('Type: Credit added');
    expect(html).toContain('a@x.com');
    expect(html).toContain('b@x.com');
    expect(html).toContain('c@x.com');
    expect(html).toContain('credits_history');
  });

  it('carries the totals and both checks', () => {
    expect(html).toMatch(/3<\/div><div class="s">distinct emails/);
    expect(html).toContain('1,090');                       // 395 + 395 + 300
    expect(html).toContain('No email appears twice.');
    expect(html).toContain('differ from the usual amount of 395 credits');
    expect(html).toMatch(/c@x\.com<\/td><td class="n">300<\/td>/);   // the off-standard table
  });

  // 396 rows of "Credit added" by the same admin printed those two values 396
  // times each and pushed the first real report to 34 pages. A value that
  // never changes is said once, in the header.
  it('folds columns that never change into the header, and keeps them when they vary', () => {
    expect(html).toContain('Added by atlas@example.com (all entries)');
    expect(html).not.toMatch(/<th>Added by<\/th>/);
    const mixed = buildCreditReportHtml({
      rows: [row('a@x.com', 5), row('b@x.com', 5, { admin_email: 'other@example.com', action: 'promo' })],
    });
    expect(mixed).toMatch(/<th>Added by<\/th>/);
    expect(mixed).toMatch(/<th>Type<\/th>/);
    expect(mixed).toContain('Promo code');
  });

  it('prints the totals once, at the end, and formats money with thousands separators', () => {
    const big = buildCreditReportHtml({ rows: Array.from({ length: 400 }, (_, i) => row(`u${i}@x.com`, 395)) });
    expect(big.match(/class="total"/g)).toHaveLength(1);
    expect(big).toContain('$10,006.67');                    // 158,000 × $19/300
    expect(big).toContain('158,000');
  });

  it('has a print stylesheet and a Save as PDF button', () => {
    expect(html).toContain('@media print');
    expect(html).toContain('size: A4');
    expect(html).toContain('window.print()');
  });

  it('escapes what admins and customers typed — a reason can never run as code', () => {
    const nasty = buildCreditReportHtml({
      rows: [row('<script>alert(1)</script>@x.com', 5, { reason: '<img src=x onerror=alert(1)>' })],
      filters: { q: '"><b>' },
    });
    expect(nasty).not.toContain('<script>alert(1)</script>');
    expect(nasty).not.toContain('<img src=x');
    expect(nasty).toContain('&lt;script&gt;');
    expect(nasty).toContain('&quot;&gt;&lt;b&gt;');
  });

  it('says so when the server capped the rows', () => {
    expect(buildCreditReportHtml({ rows, truncated: true, cap: 5000 })).toContain('Only the first 5,000 rows are shown');
  });
});
