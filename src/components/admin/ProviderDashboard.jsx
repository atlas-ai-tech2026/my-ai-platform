// ─── ProviderDashboard ───────────────────────────────────────────────────────
// What one supplier costs us, laid out like that supplier's own console: a
// headline total, a daily bar chart, and a card per model with its own chart.
// The owner reads this next to kie.ai's dashboard, so the shapes match on
// purpose — a different layout would make the two hard to compare, which is
// the whole reason this screen exists.
//
// TWO THINGS IT REFUSES TO HIDE:
//
//   1. COVERAGE. Charges before 22 July 2026 carry no provider attribution —
//      13,736 rows, 45% of all credits ever spent. A total that silently omits
//      them looks complete and is not, so the gap is printed on the screen.
//
//   2. USD IS DERIVED. We multiply credits by a constant; we never read the
//      invoice. Against kie.ai's own figure for 2–15 Aug the real rate was
//      ~$0.004318 against the $0.005 we assume, so our dollars run ~14% high.
//      The screen says "estimated" rather than implying it is billed.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { adminApi } from '@/lib/adminApi';

const DAY = 86400000;
const iso = (d) => d.toISOString().slice(0, 10);

export default function ProviderDashboard({ provider = 'kie', onClose, onError }) {
  const [from, setFrom] = useState(iso(new Date(Date.now() - 13 * DAY)));
  const [to, setTo] = useState(iso(new Date()));
  const [mode, setMode] = useState('spend');      // 'spend' | 'credits'
  const [data, setData] = useState(null);

  const load = useCallback(async () => {
    setData(null);
    try {
      setData(await adminApi.providerUsage({ provider, from, to }));
    } catch (e) { onError?.(e); setData({ error: true }); }
  }, [provider, from, to, onError]);

  useEffect(() => { load(); }, [load]);

  // One switch drives every number and axis on the page, so the headline can
  // never disagree with the chart beneath it.
  const pick = useMemo(
    () => (row) => (mode === 'spend' ? row.usd : row.units),
    [mode]);
  const fmt = useMemo(
    () => (v) => (mode === 'spend'
      ? '$' + Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })
      : Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })),
    [mode]);

  const label = provider.toUpperCase();
  const daily = (data?.daily || []).map((d) => ({ ...d, value: pick(d) }));

  return (
    <div style={{ fontFamily: '"DM Sans", sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 19, fontWeight: 800, color: 'var(--crm-ink)' }}>{label} Usage</div>
          <div style={{ fontSize: 12, color: 'var(--crm-w50)', marginTop: 2 }}>
            What {label} costs us — compare directly against {provider === 'kie' ? 'kie.ai' : 'fal.ai'}’s own dashboard.
          </div>
        </div>
        <button onClick={onClose} style={ghost}>← Back to logs</button>
      </div>

      {/* Range + the Spend/Credits switch, mirroring the provider console. */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={input} />
        <span style={{ color: 'var(--crm-w40)' }}>→</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={input} />
        {[[7, 'Last 7d'], [14, 'Last 14d'], [30, 'Last 30d']].map(([n, t]) => (
          <button key={n} style={ghost}
            onClick={() => { setFrom(iso(new Date(Date.now() - (n - 1) * DAY))); setTo(iso(new Date())); }}>
            {t}
          </button>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', background: 'var(--crm-w06)', borderRadius: 9, padding: 3 }}>
          {[['spend', 'Total Spend'], ['credits', provider === 'kie' ? 'Total Credits' : 'Raw USD']].map(([m, t]) => (
            <button key={m} onClick={() => setMode(m)}
              style={{ ...toggle, ...(mode === m ? toggleOn : null) }}>{t}</button>
          ))}
        </div>
      </div>

      {data === null && <div style={{ color: 'var(--crm-w50)' }}>Loading…</div>}
      {data?.error && <div style={{ color: 'var(--crm-red)' }}>Could not load {label} usage.</div>}

      {data && !data.error && (
        <>
          {/* Headline */}
          <div style={card}>
            <div style={{ fontSize: 13, color: 'var(--crm-w50)', marginBottom: 4 }}>
              {mode === 'spend' ? 'Total Spend' : `Total ${provider === 'kie' ? 'Credits' : 'USD'}`}
            </div>
            <div style={{ fontSize: 34, fontWeight: 800, color: 'var(--crm-ink)', letterSpacing: '-.02em' }}>
              {fmt(pick(data.totals))}
            </div>
            <div style={{ fontSize: 12, color: 'var(--crm-w45)', marginTop: 4 }}>
              {data.totals.generations.toLocaleString()} generations ·{' '}
              {data.totals.users.toLocaleString()} users ·{' '}
              {Number(data.totals.voxel_credits).toLocaleString()} Voxel credits charged
            </div>

            {mode === 'spend' && (
              <div style={note}>
                {data.calibration ? (
                  <>
                    ${Number(data.usd_rate).toFixed(6)}/credit, <b>calibrated against the real
                    invoice</b> — {data.calibration.window} ({data.calibration.measured_on}), where
                    our ${data.calibration.our_estimate_usd.toLocaleString()} estimate met a billed
                    ${data.calibration.billed_usd.toLocaleString()} (×{data.calibration.factor}).
                    List rate is ${data.list_rate}/credit; our per-model costs run high, so charges
                    stay deliberately conservative and real margins are better than the Costing tab
                    shows. <b>Re-measure on the next invoice</b> — one window, mostly Kling 3.0, so
                    this drifts if kie.ai discounts by volume.
                  </>
                ) : (
                  <>
                    Estimated at ${data.usd_rate}/credit — <b>not the billed figure</b>. Check the
                    real total on {provider === 'kie' ? 'kie.ai' : 'fal.ai'}; if they differ, the
                    rate needs calibrating.
                  </>
                )}
              </div>
            )}

            {data.coverage?.unattributed_rows > 0 && (
              <div style={{ ...note, borderColor: 'var(--crm-red-br)', background: 'var(--crm-red-bg)', color: 'var(--crm-red)' }}>
                ⚠️ {data.coverage.unattributed_rows.toLocaleString()} of{' '}
                {data.coverage.total_rows.toLocaleString()} charges in this range have no provider
                recorded ({Number(data.coverage.unattributed_voxel_credits).toLocaleString()} Voxel
                credits). Those are missing from the total above — attribution only began 22 July 2026.
              </div>
            )}

            <div style={{ height: 260, marginTop: 16 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={daily} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--crm-w08)" vertical={false} />
                  <XAxis dataKey="day" tick={{ fontSize: 11, fill: 'var(--crm-w45)' }} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--crm-w45)' }} tickLine={false} axisLine={false} />
                  <Tooltip formatter={(v) => fmt(v)} contentStyle={tooltip} />
                  <Bar dataKey="value" fill="var(--crm-blue)" radius={[4, 4, 0, 0]} maxBarSize={34} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Per-model cards, each with its own chart — the provider console shape. */}
          <div style={{ ...card, marginTop: 14 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--crm-ink)' }}>Models</div>
            <div style={{ fontSize: 12, color: 'var(--crm-w50)', marginBottom: 12 }}>
              The 12 models with the highest {label} usage in this range
            </div>
            {!data.models.length && <div style={{ color: 'var(--crm-w45)' }}>Nothing in this range.</div>}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
              {data.models.map((m) => (
                <div key={m.model} style={{ ...card, padding: 14 }}>
                  <div style={{ fontWeight: 700, color: 'var(--crm-ink)' }}>{m.model}</div>
                  <div style={{ fontSize: 13, color: 'var(--crm-w60)', margin: '2px 0 8px' }}>
                    {fmt(pick(m))} · {m.generations.toLocaleString()} generations
                  </div>
                  <div style={{ height: 110 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={(m.daily || []).map((d) => ({ ...d, value: pick(d) }))}>
                        <XAxis dataKey="day" tick={{ fontSize: 9, fill: 'var(--crm-w35)' }} tickLine={false} />
                        <Tooltip formatter={(v) => fmt(v)} contentStyle={tooltip} />
                        <Bar dataKey="value" fill="var(--crm-blue)" radius={[3, 3, 0, 0]} maxBarSize={16} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const card = {
  background: 'var(--crm-w03)', border: '1px solid var(--crm-w08)',
  borderRadius: 12, padding: '16px 18px',
};
const input = {
  background: 'var(--crm-w05)', border: '1px solid var(--crm-w12)', borderRadius: 8,
  padding: '7px 10px', fontSize: 13, color: 'var(--crm-ink)', outline: 'none',
  fontFamily: '"DM Sans", sans-serif',
};
const ghost = {
  padding: '7px 12px', fontSize: 12, fontWeight: 600, borderRadius: 8,
  background: 'var(--crm-w06)', border: '1px solid var(--crm-w10)',
  color: 'var(--crm-w85)', cursor: 'pointer', fontFamily: '"DM Sans", sans-serif',
};
const toggle = {
  padding: '6px 14px', fontSize: 12, fontWeight: 600, borderRadius: 7,
  background: 'transparent', border: 'none', color: 'var(--crm-w60)',
  cursor: 'pointer', fontFamily: '"DM Sans", sans-serif',
};
const toggleOn = { background: 'var(--crm-w10)', color: 'var(--crm-ink)' };
const note = {
  marginTop: 10, padding: '8px 11px', borderRadius: 8, fontSize: 11.5, lineHeight: 1.5,
  background: 'var(--crm-w05)', border: '1px solid var(--crm-w10)', color: 'var(--crm-w60)',
};
const tooltip = {
  background: 'var(--crm-tooltip-bg)', border: '1px solid var(--crm-w12)',
  borderRadius: 8, fontSize: 12, color: 'var(--crm-ink)',
};
