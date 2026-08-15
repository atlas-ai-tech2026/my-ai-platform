// ─── LogsTab ─────────────────────────────────────────────────────────────────
// kie.ai-style "Logs — an overview of the latest requests", across ALL users.
// Filters: action (kie's status dropdown), model text, user email, date range.
// Every row shows BOTH meters: Voxel credits (signed, what the user paid) and
// KIE credits (estimated cost on our kie.ai balance; "—" = FAL-backed or no
// kie price on file / row predates KIE tracking).

import ProviderDashboard from './ProviderDashboard';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { adminApi } from '@/lib/adminApi';

const PAGE_SIZE = 50;

const ACTION_CHIP = {
  spend:  { label: 'success', color: 'var(--crm-green)', bg: 'var(--crm-green-bg)' },
  refund: { label: 'refunded', color: 'var(--crm-amber)', bg: 'var(--crm-amber-bg)' },
  grant:  { label: 'grant', color: 'var(--crm-blue)', bg: 'var(--crm-blue-bg)' },
  revoke: { label: 'revoke', color: 'var(--crm-red)', bg: 'var(--crm-red-bg)' },
  promo:  { label: 'promo', color: 'var(--crm-purple)', bg: 'var(--crm-purple-bg)' },
  gift:   { label: 'gift card', color: 'var(--crm-pink)', bg: 'var(--crm-pink-bg)' },
};

export default function LogsTab({ onError }) {
  // The provider spend dashboard replaces the log table when open — it is a
  // different question (what a supplier costs us) about the same rows.
  const [showDashboard, setShowDashboard] = useState(false);
  const [rows, setRows] = useState(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  // Filters (kie.ai order: status · model · user · dates)
  const [action, setAction] = useState('');
  const [q, setQ] = useState('');
  const [email, setEmail] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const load = useCallback(async (pageArg = page) => {
    setLoading(true);
    try {
      const r = await adminApi.logs({
        limit: PAGE_SIZE, offset: (pageArg - 1) * PAGE_SIZE,
        action, q, email, from, to,
      });
      setRows(r.logs);
      setTotal(r.total);
    } catch (e) {
      onError?.(e, 'Logs fetch failed');
    } finally {
      setLoading(false);
    }
  }, [page, action, q, email, from, to, onError]);

  // Reload on page change immediately; debounce the text filters.
  useEffect(() => {
    const id = setTimeout(() => load(page), q || email ? 350 : 0);
    return () => clearTimeout(id);
  }, [load, page]);

  // Filter changes reset to page 1.
  useEffect(() => { setPage(1); }, [action, q, email, from, to]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const exportCsv = useCallback(() => {
    if (!rows?.length) return;
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [
      ['time', 'user', 'details', 'action', 'voxel_credits', 'kie_credits', 'fal_cost_usd'].join(','),
      ...rows.map(r => [
        esc(new Date(r.created_at).toISOString()), esc(r.email), esc(r.reason),
        esc(r.action), esc(r.amount), esc(r.kie_credits ?? ''), esc(r.fal_cost ?? ''),
      ].join(',')),
    ].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `voxel-logs-page${page}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [rows, page]);

  const summary = useMemo(() => {
    if (!rows?.length) return null;
    const voxel = rows.reduce((s, r) => s + (r.action === 'spend' ? -Number(r.amount) : 0), 0);
    const kie = rows.reduce((s, r) => s + (r.kie_credits ? Number(r.kie_credits) : 0), 0);
    const fal = rows.reduce((s, r) => s + (r.fal_cost ? Number(r.fal_cost) : 0), 0);
    return { voxel: voxel.toFixed(2), kie: kie.toFixed(2), fal: fal.toFixed(2) };
  }, [rows]);

  // The dashboard answers a different question about the same rows — what a
  // supplier costs us, rather than what each user did — so it takes the whole
  // pane rather than sitting squashed above the table.
  if (showDashboard) {
    return <ProviderDashboard provider="kie" onClose={() => setShowDashboard(false)} onError={onError} />;
  }

  return (
    <div>
      <div style={{ color: 'var(--crm-w40)', fontSize: 13, marginBottom: 16 }}>
        An overview of the latest requests across all users. Voxel credits = what the
        user paid; KIE credits = estimated cost on our kie.ai balance; FAL cost =
        estimated USD on our fal.ai bill. "—" = other provider, no price on file,
        or unlabeled historical row.
      </div>

      {/* Filters row */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        <select value={action} onChange={e => setAction(e.target.value)} style={inputStyle}>
          <option value="">All Status</option>
          <option value="spend">success (spend)</option>
          <option value="refund">refunded</option>
          <option value="grant">grant</option>
          <option value="revoke">revoke</option>
          <option value="promo">promo</option>
          <option value="gift">gift card</option>
        </select>
        <input placeholder="Filter by model / details…" value={q}
          onChange={e => setQ(e.target.value)} style={{ ...inputStyle, minWidth: 190 }} />
        <input placeholder="Filter by user email…" value={email}
          onChange={e => setEmail(e.target.value)} style={{ ...inputStyle, minWidth: 180 }} />
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={inputStyle} title="From" />
        <input type="date" value={to} onChange={e => setTo(e.target.value)} style={inputStyle} title="To" />
        <button onClick={() => setShowDashboard(true)} style={btnStyle}
          title="KIE spend, laid out like kie.ai's own dashboard">
          📊 Dashboard
        </button>
        <button onClick={() => load(page)} disabled={loading} style={btnStyle}>
          {loading ? 'Loading…' : '⟳ Refresh'}
        </button>
        <button onClick={exportCsv} disabled={!rows?.length} style={btnStyle}>⬇ Export CSV</button>
      </div>

      {summary && (
        <div style={{ color: 'var(--crm-w45)', fontSize: 12, marginBottom: 10 }}>
          This page: <b style={{ color: 'var(--crm-ink)' }}>{summary.voxel}</b> voxel credits spent ·{' '}
          <b style={{ color: 'var(--crm-ink)' }}>{summary.kie}</b> KIE credits ·{' '}
          <b style={{ color: 'var(--crm-ink)' }}>${summary.fal}</b> FAL cost
        </div>
      )}

      {/* Table */}
      <div style={{ overflowX: 'auto', border: '1px solid var(--crm-w08)', borderRadius: 12 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              {['Time', 'User', 'Model & Details', 'Status', 'Voxel credits', 'KIE credits', 'FAL cost'].map(h => (
                <th key={h} style={thStyle}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows === null && (
              <tr><td colSpan={7} style={emptyStyle}>Loading…</td></tr>
            )}
            {rows?.length === 0 && (
              <tr><td colSpan={7} style={emptyStyle}>No log entries match these filters.</td></tr>
            )}
            {rows?.map(r => {
              const chip = ACTION_CHIP[r.action] || { label: r.action, color: 'var(--crm-w50)', bg: 'var(--crm-w08)' };
              const amt = Number(r.amount);
              return (
                <tr key={r.id} style={{ borderTop: '1px solid var(--crm-w06)' }}>
                  <td style={tdStyle} title={new Date(r.created_at).toISOString()}>
                    {new Date(r.created_at).toLocaleString()}
                  </td>
                  <td style={tdStyle}>{r.email}</td>
                  <td style={{ ...tdStyle, maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    title={r.reason || ''}>
                    {r.reason || '—'}
                  </td>
                  <td style={tdStyle}>
                    <span style={{ color: chip.color, background: chip.bg, padding: '2px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600 }}>
                      {chip.label}
                    </span>
                  </td>
                  <td style={{ ...tdStyle, color: amt < 0 ? 'var(--crm-red)' : 'var(--crm-green)', fontWeight: 600 }}>
                    {amt > 0 ? `+${amt}` : amt}
                  </td>
                  <td style={{ ...tdStyle, color: r.kie_credits ? 'var(--crm-purple)' : 'var(--crm-w30)', fontWeight: r.kie_credits ? 600 : 400 }}>
                    {r.kie_credits ? `−${Number(r.kie_credits)}` : '—'}
                  </td>
                  <td style={{ ...tdStyle, color: r.fal_cost ? 'var(--crm-orange)' : 'var(--crm-w30)', fontWeight: r.fal_cost ? 600 : 400 }}>
                    {r.fal_cost ? `−$${Number(r.fal_cost)}` : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, fontSize: 13, color: 'var(--crm-w50)' }}>
        <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} style={btnStyle}>← Prev</button>
        <span>Page {page} / {pages} · {total} entries</span>
        <button onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={page >= pages} style={btnStyle}>Next →</button>
      </div>
    </div>
  );
}

const inputStyle = {
  height: 36, padding: '0 12px', borderRadius: 10,
  background: 'var(--crm-w04)', border: '1px solid var(--crm-w10)',
  color: 'var(--crm-ink)', fontSize: 13, outline: 'none', fontFamily: 'inherit',
  colorScheme: 'dark',
};
const btnStyle = {
  height: 36, padding: '0 14px', borderRadius: 10, cursor: 'pointer',
  background: 'var(--crm-w06)', border: '1px solid var(--crm-w12)',
  color: 'var(--crm-ink)', fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
};
const thStyle = {
  textAlign: 'left', padding: '10px 14px', fontSize: 12, fontWeight: 600,
  color: 'var(--crm-w45)', background: 'var(--crm-w03)',
  whiteSpace: 'nowrap',
};
const tdStyle = { padding: '10px 14px', color: 'var(--crm-w85)', whiteSpace: 'nowrap' };
const emptyStyle = { padding: 32, textAlign: 'center', color: 'var(--crm-w35)' };
