// ─── UsageTab ────────────────────────────────────────────────────────────────
// kie.ai-style "API Usage": date-range picker (default last 14 days), live
// kie.ai balance widget, totals, a daily chart of Voxel credits vs KIE
// credits, a per-model breakdown table, and CSV export. All-users scope.

import React, { useCallback, useEffect, useState } from 'react';
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis,
  Tooltip, Legend, CartesianGrid,
} from 'recharts';
import { adminApi } from '@/lib/adminApi';

const dayStr = (d) => d.toISOString().slice(0, 10);

export default function UsageTab({ onError }) {
  const [from, setFrom] = useState(dayStr(new Date(Date.now() - 13 * 24 * 3600 * 1000)));
  const [to, setTo] = useState(dayStr(new Date()));
  const [data, setData] = useState(null);       // { daily, models, totals }
  const [loading, setLoading] = useState(false);
  const [balance, setBalance] = useState(null); // null | 'loading' | { credits, usd } | { error }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await adminApi.usage(from, to));
    } catch (e) {
      onError?.(e, 'Usage fetch failed');
    } finally {
      setLoading(false);
    }
  }, [from, to, onError]);

  const loadBalance = useCallback(async () => {
    setBalance('loading');
    try {
      setBalance(await adminApi.kieBalance());
    } catch (e) {
      setBalance({ error: e.body?.error || e.message || 'kie.ai balance unavailable' });
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadBalance(); }, [loadBalance]);

  const exportCsv = useCallback(() => {
    if (!data?.daily?.length) return;
    const csv = [
      ['day', 'voxel_spent', 'voxel_refunded', 'kie_credits', 'fal_cost_usd', 'generations'].join(','),
      ...data.daily.map(d => [d.day, d.voxel_spent, d.voxel_refunded, d.kie_credits, d.fal_cost, d.generations].join(',')),
    ].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `voxel-usage-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [data, from, to]);

  const t = data?.totals;

  return (
    <div>
      <div style={{ color: 'var(--crm-w40)', fontSize: 13, marginBottom: 16 }}>
        Credit consumption across all users — Voxel credits (what users spend) next to
        KIE credits (our kie.ai balance) and FAL cost (our fal.ai bill, USD).
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={inputStyle} />
        <span style={{ color: 'var(--crm-w40)' }}>→</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} style={inputStyle} />
        <button onClick={load} disabled={loading} style={btnStyle}>{loading ? 'Loading…' : '⟳ Refresh'}</button>
        <button onClick={exportCsv} disabled={!data?.daily?.length} style={btnStyle}>⬇ Export CSV</button>
      </div>

      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 20 }}>
        <Card label="kie.ai balance (live)"
          accent={balance?.credits != null && Number(balance.credits) < 3000 ? '#f87171' : '#c084fc'}
          value={
            balance === 'loading' || balance === null ? '…'
              : balance.error ? '—'
              : `${Number(balance.credits).toLocaleString()} cr`
          }
          sub={
            balance?.error ? balance.error
              : balance?.credits != null && Number(balance.credits) < 3000
                ? `⚠ LOW — ≈ $${balance.usd} left, top up soon`
                : balance?.usd != null ? `≈ $${balance.usd} · 1 cr = $0.005` : ''
          }
          action={<button onClick={loadBalance} style={miniBtnStyle} title="Refresh kie.ai balance">⟳</button>}
        />
        <Card label="Voxel credits spent" value={t ? t.voxel_spent.toLocaleString() : '…'}
          sub={t ? `${t.voxel_refunded.toLocaleString()} refunded` : ''} accent="#f87171" />
        <Card label="KIE credits used" value={t ? t.kie_credits.toLocaleString() : '…'}
          sub="estimated, kie-backed models only" accent="#c084fc" />
        <Card label="FAL cost" value={t ? `$${t.fal_cost.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : '…'}
          sub="estimated, FAL-backed models only" accent="#fb923c" />
        <Card label="Generations" value={t ? t.generations.toLocaleString() : '…'}
          sub={t ? `${t.active_users} active user(s)` : ''} accent="#4ade80" />
      </div>

      {/* Daily chart */}
      <div style={panelStyle}>
        <div style={panelTitleStyle}>Daily usage</div>
        {data?.daily?.length ? (
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={data.daily} margin={{ top: 8, right: 12, left: -10, bottom: 0 }}>
              <CartesianGrid stroke="var(--crm-w06)" vertical={false} />
              <XAxis dataKey="day" tick={{ fill: 'var(--crm-w45)', fontSize: 11 }}
                tickFormatter={(d) => d.slice(5)} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: 'var(--crm-w45)', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="usd" orientation="right" tick={{ fill: 'rgba(251,146,60,0.7)', fontSize: 11 }}
                axisLine={false} tickLine={false} tickFormatter={(v) => `$${v}`} />
              <Tooltip
                contentStyle={{ background: '#141417', border: '1px solid var(--crm-w10)', borderRadius: 10, fontSize: 12 }}
                labelStyle={{ color: 'var(--crm-w60)' }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="voxel_spent" name="Voxel credits" fill="#e0442c" radius={[4, 4, 0, 0]} maxBarSize={28} />
              <Line dataKey="kie_credits" name="KIE credits" stroke="#c084fc" strokeWidth={2} dot={false} type="monotone" />
              <Line yAxisId="usd" dataKey="fal_cost" name="FAL cost ($)" stroke="#fb923c" strokeWidth={2} dot={false} type="monotone" />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--crm-w30)' }}>
            {data ? 'No data in this range' : 'Loading…'}
          </div>
        )}
      </div>

      {/* Per-model breakdown */}
      <div style={{ ...panelStyle, marginTop: 16 }}>
        <div style={panelTitleStyle}>By model</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                {['Model', 'Generations', 'Voxel credits', 'KIE credits', 'FAL cost'].map(h => (
                  <th key={h} style={thStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data?.models?.length === 0 && (
                <tr><td colSpan={5} style={{ padding: 24, textAlign: 'center', color: 'var(--crm-w35)' }}>No spends in this range.</td></tr>
              )}
              {data?.models?.map(m => (
                <tr key={m.model} style={{ borderTop: '1px solid var(--crm-w06)' }}>
                  <td style={tdStyle}>{m.model}</td>
                  <td style={tdStyle}>{m.generations}</td>
                  <td style={{ ...tdStyle, color: '#f87171', fontWeight: 600 }}>{m.voxel_spent.toLocaleString()}</td>
                  <td style={{ ...tdStyle, color: m.kie_credits ? '#c084fc' : 'var(--crm-w30)', fontWeight: m.kie_credits ? 600 : 400 }}>
                    {m.kie_credits ? m.kie_credits.toLocaleString() : '—'}
                  </td>
                  <td style={{ ...tdStyle, color: m.fal_cost ? '#fb923c' : 'var(--crm-w30)', fontWeight: m.fal_cost ? 600 : 400 }}>
                    {m.fal_cost ? `$${m.fal_cost.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Card({ label, value, sub, accent, action }) {
  return (
    <div style={{ ...panelStyle, padding: '14px 16px', position: 'relative' }}>
      <div style={{ fontSize: 12, color: 'var(--crm-w45)', marginBottom: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        {label}{action}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: accent || 'var(--crm-ink)' }}>{value}</div>
      {sub ? <div style={{ fontSize: 11, color: 'var(--crm-w35)', marginTop: 4 }}>{sub}</div> : null}
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
const miniBtnStyle = {
  height: 22, width: 22, borderRadius: 6, cursor: 'pointer', padding: 0,
  background: 'var(--crm-w06)', border: '1px solid var(--crm-w12)',
  color: 'var(--crm-ink)', fontSize: 12, fontFamily: 'inherit',
};
const panelStyle = {
  background: 'var(--crm-w03)', border: '1px solid var(--crm-w08)',
  borderRadius: 12, padding: 16,
};
const panelTitleStyle = { fontSize: 13, fontWeight: 600, color: 'var(--crm-w60)', marginBottom: 12 };
const thStyle = {
  textAlign: 'left', padding: '8px 14px', fontSize: 12, fontWeight: 600,
  color: 'var(--crm-w45)', whiteSpace: 'nowrap',
};
const tdStyle = { padding: '8px 14px', color: 'var(--crm-w85)', whiteSpace: 'nowrap' };
