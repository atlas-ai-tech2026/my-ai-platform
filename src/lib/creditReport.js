// ─── creditReport.js ─────────────────────────────────────────────────────────
// The workshop question, answered from the ledger.
//
// Owner, 2026-09-03: "The workshop a few days ago — we gave every student
// $25, 395 credits, with the reason SPA4 in the CRM. I need a PDF: every email,
// the reason, how many credits. I need to know everything."
//
// Every credit ever added is a row in credits_history with the email, the
// amount, the date, the admin who did it and the reason they typed. The Logs
// screen shows those rows a page at a time; a workshop is ONE question with
// ONE answer, so this turns all the matching rows into a report a person can
// hand to someone else: a table, the totals, and the checks a careful
// bookkeeper would do by hand — who received it twice, who got a different
// amount than everyone else.
//
// Pure functions — the numbers here are tested. The PDF is the browser's own
// print-to-PDF of the HTML this builds (no new dependency; the page carries a
// print stylesheet). Every value is HTML-escaped: reasons are typed by admins,
// emails by customers, and a report must never execute either.

import { CREDIT_VALUE_USD } from './creditPricing';

const esc = (v) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const money = (usd) => `$${usd.toFixed(2)}`;
const num = (n) => Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });

/**
 * Totals and checks over ledger rows ({ email, amount, created_at, ... }).
 *
 *   grants      number of rows
 *   accounts    distinct emails
 *   credits     sum of amounts
 *   usd         credits × the credit's dollar value ($19 / 300)
 *   standard    the most common amount — the "395" of the workshop
 *   duplicates  emails with more than one row (count + total)
 *   offStandard rows whose amount differs from the standard
 */
export function summarizeCreditRows(rows = []) {
  const byEmail = new Map();
  const byAmount = new Map();
  let credits = 0;
  for (const r of rows) {
    const amt = Number(r.amount) || 0;
    credits += amt;
    const e = String(r.email || '').toLowerCase();
    const cur = byEmail.get(e) || { email: r.email, count: 0, credits: 0 };
    cur.count += 1; cur.credits += amt;
    byEmail.set(e, cur);
    byAmount.set(amt, (byAmount.get(amt) || 0) + 1);
  }
  let standard = null;
  let best = 0;
  for (const [amt, n] of byAmount) if (n > best) { best = n; standard = amt; }
  const duplicates = [...byEmail.values()].filter((v) => v.count > 1)
    .sort((a, b) => b.count - a.count || a.email.localeCompare(b.email));
  const offStandard = standard == null ? [] : rows.filter((r) => Number(r.amount) !== standard);
  return {
    grants: rows.length,
    accounts: byEmail.size,
    credits: Math.round(credits * 100) / 100,
    usd: Math.round(credits * CREDIT_VALUE_USD * 100) / 100,
    standard,
    standardUsd: standard == null ? null : Math.round(standard * CREDIT_VALUE_USD * 100) / 100,
    duplicates,
    offStandard,
  };
}

const ACTION_LABEL = { grant: 'Credit added', revoke: 'Credit removed', promo: 'Promo code', gift: 'Gift card', spend: 'Spend', refund: 'Refund', set: 'Balance set', signup: 'Sign-up' };

function describeFilters(f = {}) {
  const parts = [];
  if (f.q) parts.push(`Reason contains “${f.q}”`);
  if (f.action) parts.push(`Type: ${ACTION_LABEL[f.action] || f.action}`);
  if (f.email) parts.push(`Email contains “${f.email}”`);
  if (f.from || f.to) parts.push(`Period: ${f.from || 'start'} → ${f.to || 'today'}`);
  return parts.length ? parts.join(' · ') : 'All ledger rows';
}

const when = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
};

/**
 * The report as a complete HTML document: a toolbar (hidden when printing),
 * the header, four totals, the checks, then the table. Opened in its own tab
 * so the browser's Print → Save as PDF gives a clean A4 file.
 */
export function buildCreditReportHtml({ rows = [], filters = {}, generatedAt = new Date().toISOString(), truncated = false, cap = 0, title = 'Credit report' } = {}) {
  const s = summarizeCreditRows(rows);
  const subtitle = describeFilters(filters);
  const fileStem = `voxel-credit-report-${(filters.q || 'all').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${generatedAt.slice(0, 10)}`;

  const checks = [];
  if (s.grants === 0) checks.push('<li>No rows match these filters.</li>');
  if (s.duplicates.length) {
    checks.push(`<li><b>${s.duplicates.length}</b> email${s.duplicates.length === 1 ? '' : 's'} received more than one entry: `
      + s.duplicates.map((d) => `${esc(d.email)} (${d.count}× · ${num(d.credits)} cr)`).join(', ') + '</li>');
  } else if (s.grants) {
    checks.push('<li>No email appears twice.</li>');
  }
  if (s.standard != null && s.offStandard.length) {
    checks.push(`<li><b>${s.offStandard.length}</b> entr${s.offStandard.length === 1 ? 'y' : 'ies'} differ from the usual amount of ${num(s.standard)} credits: `
      + s.offStandard.map((r) => `${esc(r.email)} (${num(r.amount)} cr)`).join(', ') + '</li>');
  } else if (s.grants) {
    checks.push(`<li>Every entry is ${num(s.standard)} credits (${money(s.standardUsd)}).</li>`);
  }
  if (truncated) checks.push(`<li><b>Only the first ${num(cap)} rows are shown</b> — narrow the filters for a complete report.</li>`);

  const tableRows = rows.map((r, i) => `
      <tr>
        <td class="n">${i + 1}</td>
        <td>${esc(r.email)}</td>
        <td class="nowrap">${esc(when(r.created_at))}</td>
        <td class="n">${num(r.amount)}</td>
        <td>${esc(ACTION_LABEL[r.action] || r.action)}</td>
        <td>${esc(r.admin_email || '—')}</td>
        <td>${esc(r.reason || '—')}</td>
      </tr>`).join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${esc(title)} — ${esc(filters.q || 'all')}</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; color: #111; background: #f3f4f6; }
  .bar { position: sticky; top: 0; display: flex; gap: 10px; align-items: center; padding: 12px 24px; background: #111; color: #fff; }
  .bar button { font: inherit; font-weight: 600; padding: 8px 14px; border-radius: 8px; border: 1px solid #444; background: #E01E1E; color: #fff; cursor: pointer; }
  .bar button.ghost { background: transparent; }
  .bar .hint { color: #bbb; font-size: 13px; margin-left: auto; }
  .page { max-width: 900px; margin: 24px auto; background: #fff; padding: 36px 40px; box-shadow: 0 2px 20px rgba(0,0,0,.08); }
  h1 { margin: 0 0 4px; font-size: 24px; letter-spacing: .01em; }
  .sub { color: #444; margin: 0 0 4px; font-size: 14px; }
  .meta { color: #777; font-size: 12px; margin: 0 0 22px; }
  .tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 22px; }
  .tile { border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px 14px; }
  .tile .k { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #666; }
  .tile .v { font-size: 22px; font-weight: 700; margin-top: 4px; }
  .tile .s { font-size: 11px; color: #777; margin-top: 2px; }
  h2 { font-size: 14px; text-transform: uppercase; letter-spacing: .06em; color: #444; margin: 22px 0 8px; }
  ul.checks { margin: 0 0 8px; padding-left: 18px; font-size: 13px; line-height: 1.6; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: #555; padding: 8px 8px; border-bottom: 2px solid #ddd; }
  td { padding: 7px 8px; border-bottom: 1px solid #eee; vertical-align: top; }
  td.n, th.n { text-align: right; white-space: nowrap; }
  .nowrap { white-space: nowrap; }
  tfoot td { font-weight: 700; border-top: 2px solid #ddd; }
  .foot { color: #888; font-size: 11px; margin-top: 22px; }
  @media print {
    body { background: #fff; }
    .bar { display: none; }
    .page { box-shadow: none; margin: 0; padding: 0; max-width: none; }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; }
    @page { size: A4; margin: 16mm; }
  }
</style></head>
<body>
  <div class="bar">
    <button onclick="window.print()">Save as PDF</button>
    <button class="ghost" onclick="window.close()">Close</button>
    <span class="hint">In the print dialog choose “Save as PDF”. Suggested file name: ${esc(fileStem)}.pdf</span>
  </div>
  <div class="page">
    <h1>VOXEL.AI — ${esc(title)}</h1>
    <p class="sub">${esc(subtitle)}</p>
    <p class="meta">Generated ${esc(when(generatedAt))} from the Voxel credit ledger. 1 credit = ${money(CREDIT_VALUE_USD)}.</p>

    <div class="tiles">
      <div class="tile"><div class="k">People</div><div class="v">${num(s.accounts)}</div><div class="s">distinct emails</div></div>
      <div class="tile"><div class="k">Entries</div><div class="v">${num(s.grants)}</div><div class="s">ledger rows</div></div>
      <div class="tile"><div class="k">Credits</div><div class="v">${num(s.credits)}</div><div class="s">total added</div></div>
      <div class="tile"><div class="k">Value</div><div class="v">${money(s.usd)}</div><div class="s">${s.standard != null ? `usual entry ${num(s.standard)} cr = ${money(s.standardUsd)}` : '—'}</div></div>
    </div>

    <h2>Checks</h2>
    <ul class="checks">${checks.join('')}</ul>

    <h2>Every entry</h2>
    <table>
      <thead><tr><th class="n">#</th><th>Email</th><th>Date</th><th class="n">Credits</th><th>Type</th><th>Added by</th><th>Reason</th></tr></thead>
      <tbody>${tableRows}</tbody>
      <tfoot><tr><td></td><td>${num(s.accounts)} people</td><td></td><td class="n">${num(s.credits)}</td><td colspan="3">${money(s.usd)}</td></tr></tfoot>
    </table>

    <p class="foot">Source: credits_history joined to users, filtered as stated above. Amounts are the credits recorded at the time of each entry.</p>
  </div>
</body></html>`;
}
