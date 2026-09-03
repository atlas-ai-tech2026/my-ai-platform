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
// hand to someone else: the totals, the checks a careful bookkeeper would do
// by hand — who received it twice, who got a different amount than everyone
// else — and then every entry.
//
// Pure functions — the numbers here are tested. The PDF is the browser's own
// print-to-PDF of the HTML this builds (no new dependency; the page carries a
// print stylesheet). Every value is HTML-escaped: reasons are typed by admins,
// emails by customers, and a report must never execute either.
//
// Layout decisions, from the first real report (396 rows, 2026-09-03): a
// column whose value never changes (every row "Credit added", every row the
// same admin) is folded into the header instead of repeated 396 times, the
// totals sit once at the end rather than on every printed page, and the two
// checks are small tables rather than run-on sentences.

import { CREDIT_VALUE_USD } from './creditPricing';

const esc = (v) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const money = (usd) => '$' + Number(usd).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });

/**
 * Totals and checks over ledger rows ({ email, amount, created_at, ... }).
 *
 *   grants      number of rows
 *   accounts    distinct emails (case-insensitive)
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

const uniq = (arr) => [...new Set(arr)];

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
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('en-GB', {
    year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  });
};

function timeZoneName() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time'; } catch { return 'local time'; }
}

/**
 * The report as a complete HTML document: a toolbar (hidden when printing),
 * the header, four totals, the checks, then every entry with the totals once
 * at the end. Opened in its own tab so the browser's Print → Save as PDF
 * gives a clean A4 file.
 */
export function buildCreditReportHtml({ rows = [], filters = {}, generatedAt = new Date().toISOString(), truncated = false, cap = 0, title = 'Credit report' } = {}) {
  const s = summarizeCreditRows(rows);
  const fileStem = `voxel-credit-report-${(filters.q || 'all').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${generatedAt.slice(0, 10)}`;

  // A column that never changes is said once in the header, not per row.
  const actions = uniq(rows.map((r) => r.action));
  const admins = uniq(rows.map((r) => r.admin_email || '—'));
  const showType = actions.length > 1;
  const showAdmin = admins.length > 1;
  const folded = [];
  if (rows.length && !showType && !filters.action) folded.push(`Type: ${ACTION_LABEL[actions[0]] || actions[0]}`);
  if (rows.length && !showAdmin) folded.push(`Added by ${esc(admins[0])} (all entries)`);
  const subtitle = [esc(describeFilters(filters)), ...folded].join(' · ');

  // ── checks ──
  const checks = [];
  if (s.grants === 0) checks.push('<p class="chk">No rows match these filters.</p>');
  if (s.duplicates.length) {
    checks.push(`<p class="chk"><b>${s.duplicates.length}</b> email${s.duplicates.length === 1 ? '' : 's'} received more than one entry:</p>
    <table class="mini"><thead><tr><th>Email</th><th class="n">Entries</th><th class="n">Total credits</th></tr></thead><tbody>
    ${s.duplicates.map((d) => `<tr><td>${esc(d.email)}</td><td class="n">${d.count}</td><td class="n">${num(d.credits)}</td></tr>`).join('')}
    </tbody></table>`);
  } else if (s.grants) {
    checks.push('<p class="chk">No email appears twice.</p>');
  }
  if (s.standard != null && s.offStandard.length) {
    checks.push(`<p class="chk"><b>${s.offStandard.length}</b> entr${s.offStandard.length === 1 ? 'y' : 'ies'} differ from the usual amount of ${num(s.standard)} credits:</p>
    <table class="mini"><thead><tr><th>Email</th><th class="n">Credits</th><th>Date</th><th>Reason</th></tr></thead><tbody>
    ${s.offStandard.map((r) => `<tr><td>${esc(r.email)}</td><td class="n">${num(r.amount)}</td><td class="nowrap">${esc(when(r.created_at))}</td><td>${esc(r.reason || '—')}</td></tr>`).join('')}
    </tbody></table>`);
  } else if (s.grants) {
    checks.push(`<p class="chk">Every entry is ${num(s.standard)} credits (${money(s.standardUsd)}).</p>`);
  }
  if (truncated) checks.push(`<p class="chk"><b>Only the first ${num(cap)} rows are shown</b> — narrow the filters for a complete report.</p>`);

  // ── every entry ──
  const head = ['<th class="n">#</th>', '<th>Email</th>', '<th>Date</th>', '<th class="n">Credits</th>',
    showType ? '<th>Type</th>' : '', showAdmin ? '<th>Added by</th>' : '', '<th>Reason</th>'].join('');
  const cols = 4 + (showType ? 1 : 0) + (showAdmin ? 1 : 0) + 1;
  const body = rows.map((r, i) => `
      <tr>
        <td class="n">${i + 1}</td>
        <td>${esc(r.email)}</td>
        <td class="nowrap">${esc(when(r.created_at))}</td>
        <td class="n">${num(r.amount)}</td>
        ${showType ? `<td class="nowrap">${esc(ACTION_LABEL[r.action] || r.action)}</td>` : ''}
        ${showAdmin ? `<td>${esc(r.admin_email || '—')}</td>` : ''}
        <td class="reason">${esc(r.reason || '—')}</td>
      </tr>`).join('');
  const totalRow = `
      <tr class="total">
        <td></td>
        <td>${num(s.accounts)} people · ${num(s.grants)} entries</td>
        <td></td>
        <td class="n">${num(s.credits)}</td>
        <td colspan="${cols - 4}">${money(s.usd)}</td>
      </tr>`;

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
  .sub { color: #333; margin: 0 0 4px; font-size: 13.5px; }
  .meta { color: #777; font-size: 12px; margin: 0 0 22px; }
  .tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 22px; }
  .tile { border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px 14px; }
  .tile .k { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #666; }
  .tile .v { font-size: 22px; font-weight: 700; margin-top: 4px; }
  .tile .s { font-size: 11px; color: #777; margin-top: 2px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .06em; color: #444; margin: 22px 0 8px; }
  .chk { margin: 8px 0 6px; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  table.mini { margin-bottom: 14px; }
  th { text-align: left; font-size: 10.5px; text-transform: uppercase; letter-spacing: .05em; color: #555; padding: 6px 8px; border-bottom: 2px solid #ddd; }
  td { padding: 5px 8px; border-bottom: 1px solid #eee; vertical-align: top; }
  td.n, th.n { text-align: right; white-space: nowrap; }
  .nowrap { white-space: nowrap; }
  .reason { color: #444; }
  tr.total td { font-weight: 700; border-top: 2px solid #ddd; border-bottom: none; }
  .foot { color: #888; font-size: 11px; margin-top: 22px; }
  @media print {
    body { background: #fff; }
    .bar { display: none; }
    .page { box-shadow: none; margin: 0; padding: 0; max-width: none; }
    table { font-size: 10.5px; }
    td { padding: 3.5px 6px; }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; }
    h2 { page-break-after: avoid; }
    @page { size: A4; margin: 14mm 12mm; }
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
    <p class="sub">${subtitle}</p>
    <p class="meta">Generated ${esc(when(generatedAt))} (${esc(timeZoneName())}) from the Voxel credit ledger · 1 credit = $${CREDIT_VALUE_USD.toFixed(4)}.</p>

    <div class="tiles">
      <div class="tile"><div class="k">People</div><div class="v">${num(s.accounts)}</div><div class="s">distinct emails</div></div>
      <div class="tile"><div class="k">Entries</div><div class="v">${num(s.grants)}</div><div class="s">ledger rows</div></div>
      <div class="tile"><div class="k">Credits</div><div class="v">${num(s.credits)}</div><div class="s">total added</div></div>
      <div class="tile"><div class="k">Value</div><div class="v">${money(s.usd)}</div><div class="s">${s.standard != null ? `usual entry ${num(s.standard)} cr = ${money(s.standardUsd)}` : '—'}</div></div>
    </div>

    <h2>Checks</h2>
    ${checks.join('\n')}

    <h2>Every entry</h2>
    <table class="main">
      <thead><tr>${head}</tr></thead>
      <tbody>${body}${totalRow}</tbody>
    </table>

    <p class="foot">Source: credits_history joined to users, filtered as stated above. Amounts are the credits recorded at the time of each entry. Dates in ${esc(timeZoneName())}.</p>
  </div>
</body></html>`;
}
