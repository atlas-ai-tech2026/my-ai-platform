// ─── LogsTab ─────────────────────────────────────────────────────────────────
// kie.ai-style "Logs — an overview of the latest requests", across ALL users.
// Filters: action (kie's status dropdown), model text, user email, date range.
// Every row shows BOTH meters: Voxel credits (signed, what the user paid) and
// KIE credits (estimated cost on our kie.ai balance; "—" = FAL-backed or no
// kie price on file / row predates KIE tracking).

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { adminApi } from '@/lib/adminApi';

const PAGE_SIZE = 50;

const ACTION_CHIP = {
  spend:  { label: 'success', color: '#4ade80', bg: 'rgba(74,222,128,0.12)' },
  refund: { label: 'refunded', color: '#fbbf24', bg: 'rgba(251,191,36,0.12)' },
  grant:  { label: 'grant', color: '#60a5fa', bg: 'rgba(96,165,250,0.12)' },
  revoke: { label: 'revoke', color: '#f87171', bg: 'rgba(248,113,113,0.12)' },
};

export default function LogsTab({ onError }) {
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

  return (
    <div>
      <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, marginBottom: 16 }}>
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
        </select>
        <input placeholder="Filter by model / details…" value={q}
          onChange={e => setQ(e.target.value)} style={{ ...inputStyle, minWidth: 190 }} />
        <input placeholder="Filter by user email…" value={email}
          onChange={e => setEmail(e.target.value)} style={{ ...inputStyle, minWidth: 180 }} />
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={inputStyle} title="From" />
        <input type="date" value={to} onChange={e => setTo(e.target.value)} style={inputStyle} title="To" />
        <button onClick={() => load(page)} disabled={loading} style={btnStyle}>
          {loading ? 'Loading…' : '⟳ Refresh'}
        </button>
        <button onClick={exportCsv} disabled={!rows?.length} style={btnStyle}>⬇ Export CSV</button>
      </div>

      {summary && (
        <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12, marginBottom: 10 }}>
          This page: <b style={{ color: '#fff' }}>{summary.voxel}</b> voxel credits spent ·{' '}
          <b style={{ color: '#fff' }}>{summary.kie}</b> KIE credits ·{' '}
          <b style={{ color: '#fff' }}>${summary.fal}</b> FAL cost
        </div>
      )}

      {/* Table */}
      <div style={{ overflowX: 'auto', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12 }}>
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
              const chip = ACTION_CHIP[r.action] || { label: r.action, color: '#aaa', bg: 'rgba(255,255,255,0.08)' };
              const amt = Number(r.amount);
              return (
                <tr key={r.id} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
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
                  <td style={{ ...tdStyle, color: amt < 0 ? '#f87171' : '#4ade80', fontWeight: 600 }}>
                    {amt > 0 ? `+${amt}` : amt}
                  </td>
                  <td style={{ ...tdStyle, color: r.kie_credits ? '#c084fc' : 'rgba(255,255,255,0.3)', fontWeight: r.kie_credits ? 600 : 400 }}>
                    {r.kie_credits ? `−${Number(r.kie_credits)}` : '—'}
                  </td>
                  <td style={{ ...tdStyle, color: r.fal_cost ? '#fb923c' : 'rgba(255,255,255,0.3)', fontWeight: r.fal_cost ? 600 : 400 }}>
                    {r.fal_cost ? `−$${Number(r.fal_cost)}` : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>
        <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} style={btnStyle}>← Prev</button>
        <span>Page {page} / {pages} · {total} entries</span>
        <button onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={page >= pages} style={btnStyle}>Next →</button>
      </div>
    </div>
  );
}

const inputStyle = {
  height: 36, padding: '0 12px', borderRadius: 10,
  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
  color: '#fff', fontSize: 13, outline: 'none', fontFamily: 'inherit',
  colorScheme: 'dark',
};
const btnStyle = {
  height: 36, padding: '0 14px', borderRadius: 10, cursor: 'pointer',
  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
  color: '#fff', fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
};
const thStyle = {
  textAlign: 'left', padding: '10px 14px', fontSize: 12, fontWeight: 600,
  color: 'rgba(255,255,255,0.45)', background: 'rgba(255,255,255,0.03)',
  whiteSpace: 'nowrap',
};
const tdStyle = { padding: '10px 14px', color: 'rgba(255,255,255,0.85)', whiteSpace: 'nowrap' };
const emptyStyle = { padding: 32, textAlign: 'center', color: 'rgba(255,255,255,0.35)' };
