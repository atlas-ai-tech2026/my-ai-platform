// ─── LiveTab ─────────────────────────────────────────────────────────────────
// The screen for the two hours you are standing in a room with 170 people.
// Tier 2.1.
//
// Every other tab answers "what happened". This answers "what is happening",
// and that changes the design rules:
//
//   · Readable from a lectern, mid-sentence. Four numbers, one shape, one
//     short list of things needing a decision. Nothing that needs interpreting.
//   · A quiet moment must LOOK quiet. If nothing is running it says so —
//     a wall of zeros reads as an outage and sends you hunting for a fault
//     that isn't there.
//   · It refreshes itself. Anything you have to remember to reload is not a
//     live screen.
//
// The reason it exists: on 8 August roughly 415 generations failed in front of
// a live cohort because the supplier account was empty. Everyone was
// auto-refunded, so nothing flagged it — from the room it simply looked like
// the platform didn't work.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { adminApi } from '@/lib/adminApi';

const REFRESH_MS = 10000;

const TONE = {
  crit: 'var(--crm-red)', warn: 'var(--crm-amber)', ok: 'var(--crm-green)', dim: 'var(--crm-w45)',
};

export default function LiveTab({ onError }) {
  const [data, setData] = useState(null);
  const [lastAt, setLastAt] = useState(null);
  const timer = useRef(null);

  const load = useCallback(async () => {
    try {
      setData(await adminApi.live());
      setLastAt(new Date());
    } catch (e) { onError?.(e); }
  }, [onError]);

  useEffect(() => {
    load();
    timer.current = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer.current);
  }, [load]);

  if (data === null) return <div style={{ color: 'var(--crm-w50)' }}>Reading activity…</div>;

  const peak = Math.max(1, ...(data.per_minute || []).map((m) => m.n));
  const w = data.workshop;

  return (
    <div style={{ fontFamily: '"DM Sans", sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <span style={{
          width: 9, height: 9, borderRadius: '50%',
          background: data.live ? 'var(--crm-green)' : 'var(--crm-w20)',
        }} />
        <h2 style={{ margin: 0, fontSize: 17, color: 'var(--crm-ink)' }}>
          {data.live
            ? (w?.title || (w?.code ? `Session · ${w.code}` : 'Session running'))
            : 'Nothing running'}
        </h2>
        <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--crm-w45)' }}>
          {lastAt ? `updated ${lastAt.toLocaleTimeString()}` : ''} · refreshes every 10s
        </span>
      </div>

      {/* Quiet must look quiet, not broken. */}
      {!data.live && (
        <div style={{ ...box, color: 'var(--crm-w55)', lineHeight: 1.6 }}>
          <b style={{ color: 'var(--crm-ink)' }}>No generations in the last {data.active_window_min} minutes.</b>
          {' '}That is not a fault — it is what a quiet platform looks like. This screen fills in on
          its own the moment a session starts.
        </div>
      )}

      {data.live && (
        <>
          <div style={cards}>
            <Card k="Active now" v={data.active_now}
              n={w?.cohort_size ? `of ${w.cohort_size} in this cohort` : `generated in the last ${data.active_window_min} min`} />
            <Card k="Generating" v={data.generating_now?.n ?? 0}
              n={`${data.generating_now?.video ?? 0} video · ${data.generating_now?.image ?? 0} image`} />
            <Card k={`Failed / ${data.fail_window_min} min`} v={data.failed_recent}
              n={data.failed_recent ? 'see below' : 'nothing failing'}
              tone={data.failed_recent >= 15 ? 'crit' : data.failed_recent >= 5 ? 'warn' : 'ok'} />
            <Card k="Credits / min" v={data.credits_per_min}
              n={`≈ $${(data.credits_per_min * 0.063333).toFixed(2)}/min`} />
          </div>

          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))' }}>
            {/* One shape. "It stopped" is visible without reading a number. */}
            <div style={box}>
              <div style={label}>Generations per minute · last 30</div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 72, marginTop: 10 }}>
                {(data.per_minute || []).map((m) => (
                  <div key={m.minute} title={`${m.minute} — ${m.n}`}
                    style={{
                      flex: 1, minWidth: 2, borderRadius: '2px 2px 0 0',
                      height: `${Math.max(4, (m.n / peak) * 100)}%`,
                      background: 'var(--crm-red)', opacity: 0.85,
                    }} />
                ))}
                {!data.per_minute?.length && (
                  <span style={{ fontSize: 11.5, color: 'var(--crm-w45)' }}>nothing yet</span>
                )}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--crm-w45)', marginTop: 4 }}>
                <span>{data.per_minute?.[0]?.minute || ''}</span>
                <span>now</span>
              </div>
            </div>

            {/* One list, only things that need a decision. */}
            <div style={box}>
              <div style={{ ...label, marginBottom: 8 }}>Needs a look</div>
              {!data.attention?.length && (
                <div style={{ fontSize: 12.5, color: 'var(--crm-green)' }}>✅ Nothing needs a decision.</div>
              )}
              {(data.attention || []).map((a, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, padding: '8px 0', borderTop: i ? '1px solid var(--crm-w06)' : 'none' }}>
                  <span style={{ width: 3, alignSelf: 'stretch', borderRadius: 2, background: TONE[a.severity] || TONE.dim, flex: 'none' }} />
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 640, color: 'var(--crm-ink)' }}>{a.title}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--crm-w55)', marginTop: 2, lineHeight: 1.5 }}>{a.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {data.top_models?.length > 0 && (
            <div style={{ ...box, marginTop: 12 }}>
              <div style={label}>What the room is using · last {data.fail_window_min} min</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                {data.top_models.map((m) => (
                  <span key={m.model} style={chip}>
                    {m.model} <b style={{ color: 'var(--crm-ink)' }}>{m.attempts}</b>
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Card({ k, v, n, tone }) {
  return (
    <div style={box}>
      <div style={label}>{k}</div>
      <div style={{ fontSize: 26, fontWeight: 730, marginTop: 4, color: tone ? TONE[tone] : 'var(--crm-ink)' }}>{v}</div>
      {n && <div style={{ fontSize: 11, color: 'var(--crm-w45)', marginTop: 2 }}>{n}</div>}
    </div>
  );
}

const box = {
  background: 'var(--crm-w03)', border: '1px solid var(--crm-w08)',
  borderRadius: 10, padding: '12px 14px',
};
const cards = {
  display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', marginBottom: 12,
};
const label = {
  fontSize: 10, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--crm-w45)', fontWeight: 600,
};
const chip = {
  fontSize: 11.5, color: 'var(--crm-w55)', background: 'var(--crm-w06)',
  border: '1px solid var(--crm-w10)', borderRadius: 999, padding: '3px 10px',
};
