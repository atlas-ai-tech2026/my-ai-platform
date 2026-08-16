// ─── ReliabilityPanel ────────────────────────────────────────────────────────
// Which models can be trusted in front of a room. Tier 1.3.
//
// The question this answers is not really "what is our error rate". It is
// "which models should I demonstrate on Sunday morning". A model failing 30% of
// the time bills you for every attempt AND leaves an attendee watching nothing
// happen — and recommending it in the first ten minutes loses the room in a way
// no refund recovers.
//
// TWO HONESTY RULES, both visible on the screen rather than buried here:
//
//   1. The failure count is INFERRED. Nothing records "model X failed" — spend
//      rows name the model, refund rows name the provider's complaint. A refund
//      is matched to the spend it almost certainly reverses (same person, same
//      amount, within 30 minutes), which recovers ~91%. The banner says so.
//   2. A rate from a small sample is refused, not rounded. Twelve clean
//      attempts renders "too few", never "100% reliable" — on a screen that
//      decides what gets shown to 170 people, a confident number from thin data
//      is worse than no number.
import React, { useCallback, useEffect, useState } from 'react';
import { adminApi } from '@/lib/adminApi';

const TONE = {
  ok:   { bg: 'var(--crm-green-bg)', fg: 'var(--crm-green)', br: 'var(--crm-green-br)' },
  warn: { bg: 'var(--crm-amber-bg)', fg: 'var(--crm-amber)', br: 'var(--crm-amber-br)' },
  crit: { bg: 'var(--crm-red-bg)',   fg: 'var(--crm-red)',   br: 'var(--crm-red-br)' },
  dim:  { bg: 'var(--crm-w06)',      fg: 'var(--crm-w45)',   br: 'var(--crm-w10)' },
};

export default function ReliabilityPanel({ onError }) {
  const [data, setData] = useState(null);
  const [days, setDays] = useState(30);

  const load = useCallback(async (d) => {
    setData(null);
    try { setData(await adminApi.reliability(d)); }
    catch (e) { onError?.(e); setData({ models: [], summary: null }); }
  }, [onError]);

  useEffect(() => { load(days); }, [load, days]);

  const rows = data?.models || [];
  const s = data?.summary;
  const c = data?.confidence;

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, color: 'var(--crm-w55)', maxWidth: '68ch', lineHeight: 1.6 }}>
          How often each model fails, and whether it is safe to demonstrate live. A model that
          fails often <b>bills you for every attempt</b> and leaves an attendee watching nothing
          happen.
        </div>
        <div style={{ marginLeft: 'auto', display: 'inline-flex', border: '1px solid var(--crm-w12)', borderRadius: 8, overflow: 'hidden' }}>
          {[7, 30, 90].map((d) => (
            <button key={d} onClick={() => setDays(d)} style={{
              border: 'none', borderRadius: 0, padding: '6px 13px', fontSize: 12.5,
              cursor: 'pointer', fontFamily: 'inherit',
              background: days === d ? 'var(--crm-w14)' : 'transparent',
              color: days === d ? 'var(--crm-ink)' : 'var(--crm-w60)',
              fontWeight: days === d ? 600 : 500,
            }}>{d} days</button>
          ))}
        </div>
      </div>

      {/* The inference, stated before any number is read. */}
      {c && (
        <div style={{ ...box, borderColor: 'var(--crm-w10)', fontSize: 12, color: 'var(--crm-w55)', lineHeight: 1.6 }}>
          <b style={{ color: 'var(--crm-ink)' }}>These failure counts are worked out, not recorded.</b>{' '}
          Nothing stores “this model failed” — a refund names the provider’s complaint, not the
          model. So each refund is matched to the generation it reverses (same person, same amount,
          within 30 minutes). That accounts for{' '}
          <b style={{ color: c.label === 'high' ? 'var(--crm-green)' : 'var(--crm-amber)' }}>
            {c.matched} of {c.total_refunds} refunds ({c.pct}%)
          </b>
          {c.total_refunds > c.matched && <> — the remaining {c.total_refunds - c.matched} could not be tied to a model and are left out</>}.
          {c.unnamed_attempts > 0 && (
            <> A further <b>{c.unnamed_attempts.toLocaleString()}</b> generations recorded no model name at all
              and are excluded from both columns.</>
          )}
        </div>
      )}

      {s && rows.length > 0 && (
        <div style={cards}>
          <Card k="Models used" v={s.models} n={`${s.judged} with enough data to judge`} />
          <Card k="Generations" v={s.attempts.toLocaleString()} n={`over ${data.window_days} days`} />
          <Card k="Failed" v={s.overall_rate_pct !== null ? `${s.overall_rate_pct}%` : '—'}
            n={`${s.failures.toLocaleString()} attempts`}
            tone={s.overall_rate_pct === null ? '' : s.overall_rate_pct < 5 ? 'ok' : s.overall_rate_pct < 15 ? 'warn' : 'crit'} />
          <Card k="Avoid live" v={s.avoid_live} n={s.worst || 'none'}
            tone={s.avoid_live ? 'crit' : 'ok'} />
          {/* Separated deliberately. This one is fixed by topping up an
              account, not by changing what you teach. */}
          <Card k="Your account was empty" v={(s.account_dry_failures || 0).toLocaleString()}
            n={s.account_dry_failures ? 'not any model’s fault' : 'none'}
            tone={s.account_dry_failures ? 'warn' : 'ok'} />
        </div>
      )}

      {data === null && <div style={{ color: 'var(--crm-w50)' }}>Working it out…</div>}

      {data && !rows.length && (
        <div style={{ ...box, color: 'var(--crm-w55)' }}>
          No generations recorded in this window. Try a longer period.
        </div>
      )}

      {rows.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={table}>
            <thead>
              <tr>{['Model', 'Type', 'Attempts', 'Model failed', 'Rate', 'Our account empty', 'Wasted', 'Live demo?']
                .map((h, i) => <th key={i} style={{ ...th, textAlign: i >= 2 && i <= 6 ? 'right' : 'left' }}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const t = TONE[r.verdict.tone] || TONE.dim;
                return (
                  <tr key={r.model}>
                    <td style={{ ...td, color: 'var(--crm-ink)', fontWeight: 600 }}>{r.model}</td>
                    <td style={{ ...td, color: 'var(--crm-w45)', fontSize: 11.5 }}>{r.kind || '—'}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{r.attempts.toLocaleString()}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{r.failures.toLocaleString()}</td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      {r.rate_pct !== null
                        ? <b style={{ color: t.fg }}>{r.rate_pct}%</b>
                        // Never a bare dash, and never 0% — both read as "perfect".
                        : <span style={{ fontSize: 11, color: 'var(--crm-w40)' }}>not enough data</span>}
                    </td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      {r.account_dry_failures
                        ? <span style={{ color: 'var(--crm-amber)' }} title="Your supplier account was empty — not this model's fault, and excluded from the rate">
                            {r.account_dry_failures.toLocaleString()}
                          </span>
                        : <span style={{ color: 'var(--crm-w40)' }}>—</span>}
                    </td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      {r.wasted_usd !== null
                        ? `$${r.wasted_usd.toFixed(2)}`
                        : <span style={{ fontSize: 11, color: 'var(--crm-w40)' }} title="No supplier cost on file for this model">no cost on file</span>}
                    </td>
                    <td style={td}>
                      <span style={{ ...pill, background: t.bg, color: t.fg, border: `1px solid ${t.br}` }}
                        title={r.verdict.note}>{r.verdict.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {rows.length > 0 && (
        <div style={{ fontSize: 11.5, color: 'var(--crm-w45)', marginTop: 10, lineHeight: 1.6, maxWidth: '76ch' }}>
          <b>“too few”</b> means fewer than {data.min_attempts} attempts — not that the model is
          unreliable, and not that it is perfect. A rate from a handful of tries is a guess wearing
          a number’s clothes, and this table decides what you demonstrate to a room.
          <br />
          <b>“Our account empty”</b> is failures where fal or kie refused because <b>your</b>
          balance was exhausted — those fail whatever model is running, so they are excluded from
          the rate and the verdict. The first version of this screen did not separate them and
          told you to stop teaching Nano Banana Pro because of a billing problem.
          <br />
          <b>“Wasted”</b> is what the failures cost you in supplier fees. It reads “no cost on file”
          rather than $0.00 where the model’s supplier cost has not been entered yet.
        </div>
      )}
    </div>
  );
}

function Card({ k, v, n, tone }) {
  const fg = tone ? (TONE[tone] || TONE.dim).fg : 'var(--crm-ink)';
  return (
    <div style={box}>
      <div style={{ fontSize: 10.5, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--crm-w45)' }}>{k}</div>
      <div style={{ fontSize: 22, fontWeight: 730, marginTop: 4, color: fg }}>{v}</div>
      {n && <div style={{ fontSize: 11, color: 'var(--crm-w45)', marginTop: 2 }}>{n}</div>}
    </div>
  );
}

const box = {
  background: 'var(--crm-w03)', border: '1px solid var(--crm-w08)',
  borderRadius: 10, padding: '12px 14px', marginBottom: 12,
};
const cards = {
  display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', marginBottom: 14,
};
const table = { width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 680 };
const th = {
  fontSize: 10, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--crm-w45)',
  fontWeight: 600, padding: '0 10px 8px 0', borderBottom: '1px solid var(--crm-w10)',
};
const td = { padding: '9px 10px 9px 0', borderBottom: '1px solid var(--crm-w06)', color: 'var(--crm-w85)' };
const pill = { padding: '2px 9px', borderRadius: 999, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' };
