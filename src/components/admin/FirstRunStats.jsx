// ─── FirstRunStats.jsx ───────────────────────────────────────────────────────
// What the first-run questions have told us, inside the Audience tab.
//
// ── WHY HERE AND NOT A TAB OF ITS OWN ──────────────────────────────────────
// Audience already says "how many arrived, WHERE THEY CAME FROM". This is
// that. A separate tab would split one question across two screens, and the
// two halves are better together: Audience records what the BROWSER reports
// and this records what the CUSTOMER says. Most referrers arrive empty because
// links get stripped, so the answer fills a gap the technical data cannot.
//
// ── THE ONE RULE EVERY NUMBER HERE OBEYS ───────────────────────────────────
// Nothing measured is never shown as a result. "0% completion" on an empty
// screen reads as a catastrophe; "nobody has been through it yet" reads as the
// truth. Every rate here is null until there is something to divide by.

import React, { useEffect, useState, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { adminApi } from '@/lib/adminApi';
import { SCREENS, ALL_QUESTIONS } from '@/lib/onboarding-questions';

const MONO = '"JetBrains Mono", monospace';
// Theme variables, not literals. The CRM has a light mode, and a hex here
// would stay dark on a white page — the exact fault crmTheme.test.jsx sweeps
// for. --crm-tooltip-bg and --crm-violet already exist for this.
const ACCENT = 'var(--crm-red)';
const FUNNEL = 'var(--crm-violet)';
const TOOLTIP = {
  background: 'var(--crm-tooltip-bg)', border: '1px solid var(--crm-w14)',
  borderRadius: 8, fontSize: 12,
};

/** A rate that has no denominator is not zero. */
const pct = (v) => (v === null || v === undefined ? '—' : `${v}%`);

function Stat({ label, value, hint }) {
  return (
    <div style={{
      background: 'var(--crm-w04)', border: '1px solid var(--crm-w08)',
      borderRadius: 10, padding: '14px 16px', flex: 1, minWidth: 150,
    }}>
      <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.13em', textTransform: 'uppercase', color: 'var(--crm-w40)' }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--crm-ink)', marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {hint && <div style={{ fontSize: 11, color: 'var(--crm-w35)', marginTop: 4, lineHeight: 1.4 }}>{hint}</div>}
    </div>
  );
}

function Chart({ rows, colour = ACCENT }) {
  if (!rows?.length) {
    return <div style={{ fontSize: 12, color: 'var(--crm-w35)', padding: '10px 0' }}>Nobody has answered this yet.</div>;
  }
  return (
    <div style={{ height: Math.max(90, rows.length * 30) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ left: 4, right: 22, top: 2, bottom: 2 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="label" width={165} tickLine={false} axisLine={false}
            tick={{ fill: 'var(--crm-w55)', fontSize: 11.5 }} />
          <Tooltip cursor={{ fill: 'var(--crm-w06)' }} contentStyle={TOOLTIP} />
          <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={15}>
            {rows.map((r) => <Cell key={r.label} fill={colour} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function FirstRunStats({ onError }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try { setD(await adminApi.onboardingStats()); }
    catch (e) { setErr(e?.message || 'could not load'); onError?.(e, 'Could not load the first-run figures'); }
  }, [onError]);
  useEffect(() => { load(); }, [load]);

  if (err) return <div style={{ fontSize: 12.5, color: 'var(--crm-red)' }}>{err}</div>;
  if (!d) return <div style={{ color: 'var(--crm-w40)', fontSize: 12.5 }}>Reading the first-run answers…</div>;

  if (!d.total) {
    // NOT a zeroed dashboard. An empty screen full of 0% is indistinguishable
    // from a broken one, and this is the state it will be in on the day it
    // ships — so it has to say what it means.
    return (
      <div style={{ fontSize: 12.5, color: 'var(--crm-w45)', lineHeight: 1.6 }}>
        Nobody has been through the first-run questions yet. Existing customers were
        marked as already done when this shipped, deliberately — asking somebody who
        has used Voxel for months how they found it gets a guess, not a fact.
        The figures start when the next new customer signs up.
      </div>
    );
  }

  const funnel = d.funnel.map((f) => ({
    label: `${f.screen}. ${SCREENS[f.screen - 1]?.title?.slice(0, 26) || ''}`,
    count: f.reached,
    keptFrom: f.keptFrom,
  }));

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 22 }}>
        <Stat label="Started" value={d.total} hint="Reached the first question" />
        <Stat label="Finished" value={d.finished} />
        <Stat label="Completion" value={pct(d.completionRate)} hint="Of everybody who started" />
        <Stat label="Left after screen 1"
          value={d.funnel[0]?.reached && d.funnel[1] ? `${d.funnel[0].reached - d.funnel[1].reached}` : '—'}
          hint="The steepest drop is where to look first" />
      </div>

      <h4 style={{ fontSize: 13, fontWeight: 700, color: 'var(--crm-ink)', margin: '0 0 4px' }}>How far people get</h4>
      <div style={{ fontSize: 11.5, color: 'var(--crm-w35)', marginBottom: 10 }}>
        Reaching a screen, not finishing it. The gap between two bars is where people leave.
      </div>
      <Chart rows={funnel} colour={FUNNEL} />

      {ALL_QUESTIONS.map((q) => {
        const s = d.questions?.[q.id];
        if (!s) return null;
        return (
          <div key={q.id} style={{ marginTop: 26 }}>
            <h4 style={{ fontSize: 13, fontWeight: 700, color: 'var(--crm-ink)', margin: '0 0 4px' }}>
              {q.label || q.id}
            </h4>
            <div style={{ fontSize: 11.5, color: 'var(--crm-w35)', marginBottom: 10 }}>
              {s.answered} answered · <b style={{ color: s.skipRate > 40 ? 'var(--crm-amber)' : 'var(--crm-w45)' }}>
                {s.skipped} skipped ({pct(s.skipRate)})
              </b>
              {s.avgSeconds !== null && <> · {s.avgSeconds}s on average</>}
            </div>
            <Chart rows={s.values} />
          </div>
        );
      })}

      <div style={{ fontSize: 11.5, color: 'var(--crm-w35)', lineHeight: 1.6, marginTop: 24 }}>
        A <b>skip</b> is somebody who reached the question and declined it — stored as its own
        value, not as a blank, so it can be told apart from never getting that far. The skip
        rate is out of the people who <i>reached</i> that question, not out of everybody:
        counting it over the whole population would fall every time somebody quit earlier,
        which says nothing about the question itself.
      </div>
    </div>
  );
}
