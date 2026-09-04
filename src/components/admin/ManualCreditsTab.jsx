// ─── ManualCreditsTab ────────────────────────────────────────────────────────
// Every credit added or removed BY HAND. Not promo codes, not Bulk.
//
// ☠ WHY IT EXISTS, IN THE OWNER'S WORDS: "I don't have a screen where exactly
// I can find all the manual adding." He was right. The Logs tab could show
// them — but only if you already knew what somebody had typed months ago. His
// SPA 4 report, 396 rows and $9,605, could only be produced by searching for
// "SPA4 (typed as spa 4 / Spa 4)". Three spellings of one workshop, one of
// them ending in a full stop.
//
// So this filters on `source`, which is chosen from a fixed set when the row
// is written. It cannot be misspelled, and Bulk — which writes the same
// ACTION as a hand-typed grant — can never appear here by accident.
//
// Read-only. Adding credits stays on Users → + Credits, because two "add
// money" buttons in two places is how they end up behaving differently.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { adminApi } from '@/lib/adminApi';
import InfoDot from './InfoDot';
import BackfillPanel from './BackfillPanel';

const CREDIT_USD = 0.063333;
const money = (usd) => '$' + Number(usd).toLocaleString('en-US',
  { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
const day = (iso) => (iso ? new Date(iso).toLocaleString(undefined,
  { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

/** grant / revoke / set, in words a person would use. */
const TYPE = {
  grant: { label: 'Added', fg: 'var(--crm-green)', bg: 'var(--crm-green-bg)' },
  revoke: { label: 'Removed', fg: 'var(--crm-red)', bg: 'var(--crm-red-bg)' },
  set: { label: 'Corrected', fg: 'var(--crm-amber)', bg: 'var(--crm-amber-bg)' },
};

export default function ManualCreditsTab({ onError }) {
  const [q, setQ] = useState({ email: '', from: '', to: '', min: '', max: '', action: '', q: '' });
  const [rows, setRows] = useState(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const LIMIT = 100;

  const load = useCallback(async () => {
    try {
      const r = await adminApi.manualCredits({
        ...q, source: 'manual', limit: LIMIT, offset: page * LIMIT,
      });
      setRows(r.logs || []);
      setTotal(r.total || 0);
    } catch (e) { onError?.(e, 'Could not load manual credits'); }
  }, [q, page, onError]);

  useEffect(() => { load(); }, [load]);

  const set = (k) => (e) => { setQ((p) => ({ ...p, [k]: e.target.value })); setPage(0); };

  // Totals over the PAGE, labelled as such. A total that silently covers only
  // what is on screen, while the header says 396, is the kind of number this
  // project has been burned by.
  const shown = useMemo(() => {
    const list = rows || [];
    const credits = list.reduce((t, r) => t + Number(r.amount || 0), 0);
    const accounts = new Set(list.map((r) => String(r.email || '').toLowerCase())).size;
    return { credits, accounts, rows: list.length };
  }, [rows]);

  // The checks a careful bookkeeper does by hand, from your SPA 4 report:
  // who appears twice, and which amounts are unusual.
  const twice = useMemo(() => {
    const seen = new Map();
    for (const r of rows || []) {
      const k = String(r.email || '').toLowerCase();
      seen.set(k, (seen.get(k) || 0) + 1);
    }
    return [...seen].filter(([, n]) => n > 1);
  }, [rows]);

  const pages = Math.ceil(total / LIMIT) || 1;

  return (
    <div>
      <div style={{ color: 'var(--crm-w40)', fontSize: 13, marginBottom: 14, lineHeight: 1.6 }}>
        Every credit added or removed <b>by hand</b> — from Users → + Credits. Promo redemptions,
        Bulk provisioning, gift cards and customer spending are not here; each has its own screen.
        This one only reads: nothing on it changes a balance.
      </div>

      <BackfillPanel onError={onError} onApplied={load} />

      <div style={{ ...panel, marginBottom: 14 }}>
        <div style={{ ...panelTitle, display: 'flex', alignItems: 'center', gap: 7 }}>
          Filters
          <InfoDot label="Filters"
            text={'Every box narrows the list and the totals together. Credits min/max match the '
              + 'SIZE of the movement, so 50 finds both a 50-credit grant and a 50-credit removal. '
              + 'Dates are inclusive. "Reason contains" searches the words whoever made the entry '
              + 'typed — useful, but it is free text, which is exactly why this screen does not '
              + 'depend on it.'} />
        </div>
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
          <Field label="Account"><input value={q.email} onChange={set('email')}
            placeholder="email contains…" aria-label="Account" style={input} /></Field>
          <Field label="From"><input type="date" value={q.from} onChange={set('from')}
            aria-label="From" style={input} /></Field>
          <Field label="To"><input type="date" value={q.to} onChange={set('to')}
            aria-label="To" style={input} /></Field>
          <Field label="Credits min"><input type="number" value={q.min} onChange={set('min')}
            placeholder="any" aria-label="Credits min" style={input} /></Field>
          <Field label="Credits max"><input type="number" value={q.max} onChange={set('max')}
            placeholder="any" aria-label="Credits max" style={input} /></Field>
          <Field label="Type">
            <select value={q.action} onChange={set('action')} aria-label="Type" style={input}>
              <option value="">All</option>
              <option value="grant">Added</option>
              <option value="revoke">Removed</option>
              <option value="set">Corrected</option>
            </select>
          </Field>
          <Field label="Reason contains"><input value={q.q} onChange={set('q')}
            placeholder="e.g. spa" aria-label="Reason contains" style={input} /></Field>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', marginBottom: 14 }}>
        <Stat k="Entries" v={num(total)} n={total > shown.rows ? `showing ${shown.rows} on this page` : 'all on this page'} />
        <Stat k="Accounts" v={num(shown.accounts)} n="distinct, on this page" />
        <Stat k="Credits" v={num(shown.credits)} n="on this page" />
        <Stat k="Value" v={money(shown.credits * CREDIT_USD)} n={`at $${CREDIT_USD}/credit`} accent />
      </div>

      {twice.length > 0 && (
        <div style={{
          background: 'var(--crm-amber-bg)', border: '1px solid var(--crm-w08)', borderRadius: 10,
          padding: '10px 13px', marginBottom: 14, fontSize: 12.5, lineHeight: 1.6,
        }}>
          <b>{twice.length} account{twice.length === 1 ? '' : 's'} appear{twice.length === 1 ? 's' : ''} more
          than once on this page</b> — worth checking before you invoice.{' '}
          <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 11.5, color: 'var(--crm-w60)' }}>
            {twice.slice(0, 6).map(([e, n]) => `${e} ×${n}`).join(' · ')}
            {twice.length > 6 ? ` … and ${twice.length - 6} more` : ''}
          </span>
        </div>
      )}

      <div style={{ overflowX: 'auto', border: '1px solid var(--crm-w08)', borderRadius: 12 }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 780 }}>
          <thead>
            <tr>
              {['Date', 'Account', 'Credits', 'Type', 'Reason typed', 'Added by'].map((h) => (
                <th key={h} style={th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows === null && <tr><td colSpan={6} style={{ ...td, color: 'var(--crm-w40)' }}>Loading…</td></tr>}
            {rows?.length === 0 && (
              <tr><td colSpan={6} style={{ ...td, color: 'var(--crm-w40)' }}>
                No manual credit entries match these filters.
              </td></tr>
            )}
            {rows?.map((r) => {
              const t = TYPE[r.action] || { label: r.action, fg: 'var(--crm-w60)', bg: 'var(--crm-w05)' };
              const amt = Number(r.amount || 0);
              return (
                <tr key={r.id}>
                  <td style={{ ...td, whiteSpace: 'nowrap', color: 'var(--crm-w60)' }}>{day(r.created_at)}</td>
                  <td style={{ ...td, fontFamily: '"JetBrains Mono", monospace', fontSize: 12.5 }}>{r.email}</td>
                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <span style={{ fontWeight: 700, color: amt < 0 ? 'var(--crm-red)' : 'var(--crm-green)' }}>
                      {amt > 0 ? '+' : ''}{num(amt)}
                    </span>
                    <span style={{ display: 'block', fontSize: 11.5, color: 'var(--crm-w40)' }}>
                      {money(Math.abs(amt) * CREDIT_USD)}
                    </span>
                  </td>
                  <td style={td}>
                    <span style={{
                      display: 'inline-block', whiteSpace: 'nowrap', padding: '2px 9px',
                      borderRadius: 999, fontSize: 11.5, fontWeight: 700, color: t.fg, background: t.bg,
                    }}>{t.label}</span>
                  </td>
                  <td style={{ ...td, color: 'var(--crm-w60)', fontSize: 12.5 }}>{r.reason || '—'}</td>
                  <td style={{ ...td, fontFamily: '"JetBrains Mono", monospace', fontSize: 11.5, color: 'var(--crm-w50)' }}>
                    {r.admin_email || '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12, fontSize: 12.5, color: 'var(--crm-w40)' }}>
          <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} style={btn}>Previous</button>
          <span>Page {page + 1} of {pages}</span>
          <button onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1} style={btn}>Next</button>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
      <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--crm-w40)' }}>
        {label}
      </span>
      {children}
    </label>
  );
}

function Stat({ k, v, n, accent }) {
  return (
    <div style={{ ...panel, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.09em', textTransform: 'uppercase', color: 'var(--crm-w40)' }}>{k}</span>
      <span style={{ fontSize: 22, fontWeight: 700, color: accent ? 'var(--crm-orange)' : 'var(--crm-ink)' }}>{v}</span>
      <span style={{ fontSize: 11.5, color: 'var(--crm-w40)' }}>{n}</span>
    </div>
  );
}

const input = {
  height: 34, padding: '0 10px', borderRadius: 9,
  background: 'var(--crm-w04)', border: '1px solid var(--crm-w10)',
  color: 'var(--crm-ink)', fontSize: 12.5, outline: 'none', fontFamily: 'inherit', width: '100%',
};
const btn = {
  height: 30, padding: '0 12px', borderRadius: 9, cursor: 'pointer',
  background: 'var(--crm-w06)', border: '1px solid var(--crm-w12)',
  color: 'var(--crm-ink)', fontSize: 12.5, fontWeight: 600, fontFamily: 'inherit',
};
const panel = { background: 'var(--crm-w03)', border: '1px solid var(--crm-w08)', borderRadius: 12, padding: 14 };
const panelTitle = { fontSize: 13, fontWeight: 600, color: 'var(--crm-w60)', marginBottom: 11 };
const th = {
  textAlign: 'left', padding: '10px 13px', fontSize: 10.5, fontWeight: 700,
  letterSpacing: '.09em', textTransform: 'uppercase', color: 'var(--crm-w40)',
  background: 'var(--crm-w03)', whiteSpace: 'nowrap', borderBottom: '1px solid var(--crm-w08)',
};
const td = { padding: '9px 13px', color: 'var(--crm-w85)', borderBottom: '1px solid var(--crm-w05)' };
