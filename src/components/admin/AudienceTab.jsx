// ─── AudienceTab.jsx ─────────────────────────────────────────────────────────
// Who reaches the site, where from, and how long they stay.
//
// ── TWO SOURCES ON ONE SCREEN, AND IT SAYS SO ──────────────────────────────
// The owner asked for the history: "we need the old data also, or we cannot see
// the history of the site." Half of that was possible.
//
//   VISITS begin the day counting started. Nothing ever recorded a page view
//   before it — no table, no log. Earlier days are UNKNOWN, not zero, and
//   drawing them as zero would be inventing a fact.
//
//   SIGNUPS AND ACTIVITY go back to the first customer, reconstructed from
//   dates that were always kept. No new tracking was needed for any of it.
//
// Putting both on one screen without saying which is which invites exactly one
// reading — that nobody visited before today — so each block carries its own
// provenance line. That is the most important thing on this tab.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import FirstRunStats from './FirstRunStats';
import { adminApi } from '@/lib/adminApi';

const panel = {
  border: '1px solid var(--crm-w08)', borderRadius: 12,
  padding: '14px 16px', marginBottom: 14,
};

function Spark({ rows, field, colour }) {
  const max = Math.max(1, ...rows.map((r) => r[field] || 0));
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 1, height: 56, marginTop: 8 }}>
      {rows.map((r) => (
        <div key={r.day}
          title={`${r.day} · ${r[field] || 0}`}
          style={{
            flex: 1, minWidth: 2,
            height: `${Math.max(2, ((r[field] || 0) / max) * 100)}%`,
            background: colour, opacity: (r[field] || 0) ? 1 : 0.25, borderRadius: 1,
          }} />
      ))}
    </div>
  );
}

function Stat({ label, value, note }) {
  return (
    <div>
      <div style={{ fontSize: 11.5, color: 'var(--crm-w40)' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.2 }}>{value}</div>
      {note && <div style={{ fontSize: 11, color: 'var(--crm-w35)' }}>{note}</div>}
    </div>
  );
}

function Bars({ rows, labelKey, valueKey, empty }) {
  if (!rows?.length) {
    return <div style={{ fontSize: 12, color: 'var(--crm-w40)' }}>{empty}</div>;
  }
  const max = Math.max(...rows.map((r) => r[valueKey]));
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      {rows.map((r) => (
        <div key={r[labelKey]} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
          <div style={{
            width: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            fontFamily: '"JetBrains Mono", monospace', fontSize: 11.5, color: 'var(--crm-w60)',
          }}>{r[labelKey] || 'direct'}</div>
          <div style={{ flex: 1, background: 'var(--crm-w06)', borderRadius: 4, height: 14 }}>
            <div style={{
              width: `${(r[valueKey] / max) * 100}%`, height: '100%',
              background: 'var(--crm-blue)', borderRadius: 4,
            }} />
          </div>
          <div style={{ width: 54, textAlign: 'right' }}>{r[valueKey].toLocaleString()}</div>
        </div>
      ))}
    </div>
  );
}

export default function AudienceTab({ onError }) {
  const [data, setData] = useState(null);
  const [days, setDays] = useState(90);

  const load = useCallback(async () => {
    try { setData(await adminApi.audience(days)); }
    catch (e) { onError?.(e, 'Could not load the audience report'); }
  }, [days, onError]);

  useEffect(() => { load(); }, [load]);

  const busiest = useMemo(() => {
    if (!data?.engagement?.length) return null;
    return [...data.engagement].sort((a, b) => b.people - a.people)[0];
  }, [data]);

  if (!data) return <div style={{ color: 'var(--crm-w40)' }}>Reading the numbers…</div>;

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, alignItems: 'center' }}>
        <span style={{ fontSize: 11.5, color: 'var(--crm-w40)' }}>showing</span>
        {[30, 90, 365, 1095].map((d) => (
          <button key={d} onClick={() => setDays(d)}
            style={{
              fontSize: 11.5, padding: '3px 9px', borderRadius: 6, cursor: 'pointer',
              border: '1px solid var(--crm-w08)',
              background: days === d ? 'var(--crm-w08)' : 'transparent',
              color: days === d ? 'var(--crm-ink)' : 'var(--crm-w40)',
            }}>
            {d === 1095 ? 'everything' : d === 365 ? '1 year' : `${d}d`}
          </button>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--crm-w35)' }}>
          {data.range.from} → {data.range.to}
        </span>
      </div>

      {/* ── ARRIVALS ─────────────────────────────────────────────────────── */}
      <div style={panel}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 2 }}>Arrivals</div>
        {/* The provenance line. Without it, an empty stretch to the left reads
            as "nobody came", when it means "nobody was counting". */}
        <div style={{ fontSize: 11.5, color: 'var(--crm-amber)', marginBottom: 10, lineHeight: 1.5 }}>
          {data.provenance.visits}
        </div>
        <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
          <Stat label="Page views" value={data.totals.views.toLocaleString()} note="crawlers excluded" />
          <Stat label="Different people" value={data.totals.visitors.toLocaleString()}
            note="counted per day, never across days" />
          <Stat label="New accounts" value={data.totals.signups.toLocaleString()} note="in this range" />
        </div>
        <Spark rows={data.views} field="views" colour="var(--crm-blue)" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
        <div style={panel}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Where they came from</div>
          <Bars rows={data.referrers} labelKey="referrer_host" valueKey="views"
            empty="Nothing counted yet — this fills in as people arrive." />
          <div style={{ fontSize: 11, color: 'var(--crm-w35)', marginTop: 8 }}>
            “direct” means no referrer — typed in, a bookmark, or a link from an app.
            Our own pages are never counted as a source.
          </div>
        </div>

        <div style={panel}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Most visited pages</div>
          <Bars rows={data.topPages} labelKey="path" valueKey="views"
            empty="Nothing counted yet." />
        </div>
      </div>

      {/* ── THE HALF WITH REAL HISTORY ───────────────────────────────────── */}
      <div style={panel}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 2 }}>
          Accounts and time spent
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--crm-green)', marginBottom: 10, lineHeight: 1.5 }}>
          {data.provenance.accounts}
        </div>
        <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', marginBottom: 4 }}>
          <Stat label="Busiest day" value={busiest?.people ? `${busiest.people} people` : '—'}
            note={busiest?.people ? busiest.day : 'no activity in this range'} />
          <Stat
            label="Typical session"
            value={busiest?.medianMinutes ? `${busiest.medianMinutes} min` : '—'}
            note="median on the busiest day — not the average, which one long tab distorts" />
          <Stat label="Longest session"
            value={busiest?.longestMinutes ? `${busiest.longestMinutes} min` : '—'}
            note="first action to last, same day" />
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--crm-w40)', marginTop: 10 }}>New accounts per day</div>
        <Spark rows={data.signups} field="signups" colour="var(--crm-green)" />
        <div style={{ fontSize: 11.5, color: 'var(--crm-w40)', marginTop: 12 }}>
          People working per day
        </div>
        <Spark rows={data.engagement} field="people" colour="var(--crm-amber)" />
        <div style={{ fontSize: 11, color: 'var(--crm-w35)', marginTop: 10, lineHeight: 1.5 }}>
          A session is first action to last on the same day, from timestamps already in the
          ledger. Someone who generated once counts as a zero-minute session rather than
          being left out — otherwise the least engaged people vanish from every average.
        </div>
      </div>

      {/* ── FIRST RUN ───────────────────────────────────────────────────
          Here rather than in a tab of its own because this tab is already
          "where they came from". The two halves belong together: everything
          above is what the BROWSER reported, this is what the CUSTOMER said.
          Most referrers arrive empty because links get stripped, so the
          answers fill a gap the technical data cannot. */}
      <div style={{
        marginTop: 30, paddingTop: 26, borderTop: '1px solid var(--crm-w08)',
      }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--crm-ink)', margin: '0 0 4px' }}>
          What new customers tell us
        </h3>
        <div style={{ fontSize: 11.5, color: 'var(--crm-w35)', marginBottom: 18, lineHeight: 1.6 }}>
          Answered once, the first time somebody signs in. Above is what the browser
          reported; this is what the person said — and most referrers arrive empty,
          so this is often the only account of where they came from.
        </div>
        <FirstRunStats onError={onError} />
      </div>

      <div style={{ fontSize: 11.5, color: 'var(--crm-w35)', lineHeight: 1.6, marginTop: 26 }}>
        Clicks, scrolling and session replays live in <b>Microsoft Clarity</b>, which the site
        loads on customer pages only — never on this control panel.
      </div>
    </div>
  );
}
