// ─── PreflightPanel.jsx ──────────────────────────────────────────────────────
// THE TEN MINUTES BEFORE A WORKSHOP, ON ONE SCREEN.
//
// On 8 August, 415 generations failed in front of a room because the supplier
// account was empty. Every one auto-refunded, so nothing flagged it.
//
// Not one fact needed to prevent that was missing. They were on four different
// tabs — the balance on this one, the model failure rates under Costing, the
// code under Promo Codes, the alerts on Alerts. Four tabs and four judgements,
// while a room fills up, is not a check anybody performs.
//
// ── WHY IT LEADS WITH A SENTENCE ────────────────────────────────────────────
// A dashboard makes you decide. With people sitting down in front of you the
// useful output is "start" or "do not start yet, because X". So the headline is
// a verdict, the four lines are the evidence, and every line that is not green
// carries what to do about it.
//
// ── AND WHY "READY" IS HARD TO EARN ─────────────────────────────────────────
// A check that could not run reads as NOT ready — never as probably fine.
// That is the whole lesson of 8 August: the thing nobody could see was the
// thing that broke. The server ranks "could not tell" above "minor warning"
// for exactly this screen; see server/src/preflight.js.

import React, { useState, useCallback } from 'react';
import { adminApi } from '@/lib/adminApi';
import InfoDot from './InfoDot';

const STATE_STYLE = {
  critical: { dot: 'var(--crm-red)',   bg: 'var(--crm-red-bg)',   label: 'Act now' },
  warn:     { dot: 'var(--crm-amber)', bg: 'var(--crm-amber-bg)', label: 'Look first' },
  unknown:  { dot: 'var(--crm-w40)',   bg: 'var(--crm-w05)',      label: 'Not checked' },
  ok:       { dot: 'var(--crm-green)', bg: 'transparent',         label: 'Fine' },
};

const btn = {
  padding: '7px 13px', borderRadius: 8, border: '1px solid var(--crm-w14)',
  background: 'var(--crm-w06)', color: 'var(--crm-ink)', fontSize: 12.5,
  fontWeight: 600, cursor: 'pointer',
};

export default function PreflightPanel({ onError }) {
  const [data, setData] = useState(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const run = useCallback(async (which) => {
    setBusy(true);
    try {
      setData(await adminApi.preflight(which));
    } catch (e) {
      onError?.(e, 'The pre-flight check could not run');
    } finally {
      setBusy(false);
    }
  }, [onError]);

  const s = data ? (STATE_STYLE[data.state] || STATE_STYLE.unknown) : null;

  return (
    <section style={{
      padding: '14px 16px', borderRadius: 12, marginBottom: 18,
      border: `1px solid ${data && !data.go ? 'var(--crm-red)' : 'var(--crm-w14)'}`,
      background: 'var(--crm-w04)',
    }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 700, color: 'var(--crm-ink)', fontSize: 14 }}>
          Before a workshop
        </span>
        <InfoDot
          label="Before a workshop"
          text={'The four things worth knowing in the ten minutes before you stand up in front of '
            + 'people: is anything already broken, will the supplier account last the day, has any '
            + 'model started failing, and does this cohort’s access actually work today. '
            + 'Nothing here is new — it is the same data as the Alerts, Costing and Promo Codes '
            + 'tabs, gathered so it can never disagree with them. It writes NOTHING. A check that '
            + 'could not run shows as "not checked" and stops the screen saying ready, because on '
            + '8 August the thing nobody could see was the thing that broke.'}
        />

        {/* The code, typed rather than picked from a list first: before a
            workshop you know which code you issued, and a dropdown of 100
            codes is slower than typing eight characters. The list is offered
            below as a fallback once the check has run. */}
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !busy) run(code.trim()); }}
          placeholder="Workshop code"
          aria-label="Workshop promo code"
          style={{
            padding: '6px 10px', borderRadius: 8, border: '1px solid var(--crm-w14)',
            background: 'var(--crm-w06)', color: 'var(--crm-ink)', fontSize: 12.5,
            width: 150, marginLeft: 'auto',
          }}
        />
        <button onClick={() => run(code.trim())} disabled={busy} style={btn}>
          {busy ? 'Checking…' : data ? 'Check again' : 'Check'}
        </button>
      </div>

      {!data && (
        <div style={{ fontSize: 12.5, color: 'var(--crm-w50)', marginTop: 8, lineHeight: 1.6 }}>
          Reads the balance, the alerts, the model failure rates and the cohort’s code, and says
          whether it is safe to start. Nothing is changed. Leave the code blank to check everything
          except the cohort.
        </div>
      )}

      {data && (
        <>
          {/* The verdict. First, largest, and a sentence. */}
          <div style={{
            marginTop: 12, padding: '11px 13px', borderRadius: 10,
            background: s.bg === 'transparent' ? 'var(--crm-w05)' : s.bg,
            border: `1px solid ${data.go ? 'var(--crm-w08)' : s.dot}`,
            display: 'flex', gap: 10, alignItems: 'flex-start',
          }}>
            <span aria-hidden="true" style={{
              width: 11, height: 11, borderRadius: '50%', background: s.dot,
              flex: 'none', marginTop: 4,
            }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, color: 'var(--crm-ink)', fontSize: 14.5 }}>
                {data.headline}
              </div>
              {data.because?.length > 0 && (
                <ul style={{
                  margin: '6px 0 0', paddingLeft: 18, fontSize: 12.5,
                  color: 'var(--crm-w60)', lineHeight: 1.6,
                }}>
                  {data.because.map((b, i) => <li key={i}>{b}</li>)}
                </ul>
              )}
            </div>
          </div>

          <div style={{ marginTop: 10 }}>
            {data.checks.map((c) => <Check key={c.key} check={c} />)}
          </div>

          {/* Only shown when a code was asked for and not found — otherwise it
              is a hundred rows nobody needs. */}
          {code.trim() && !data.chosen && data.codes?.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--crm-w50)', lineHeight: 1.6 }}>
              No code called <strong style={{ color: 'var(--crm-ink)' }}>{code.trim()}</strong>.
              {' '}Active codes:{' '}
              {data.codes.slice(0, 12).map((c) => (
                <button
                  key={c.code} onClick={() => { setCode(c.code); run(c.code); }}
                  style={{
                    ...btn, padding: '2px 7px', fontSize: 11.5, marginRight: 4, marginBottom: 4,
                  }}
                >{c.code}</button>
              ))}
              {data.codes.length > 12 && <span>… and {data.codes.length - 12} more</span>}
            </div>
          )}

          <div style={{ marginTop: 8, fontSize: 11, color: 'var(--crm-w40)' }}>
            Read {new Date(data.checked_at).toLocaleTimeString()} · models over the last{' '}
            {data.window_days} days · nothing was changed
          </div>
        </>
      )}
    </section>
  );
}

function Check({ check }) {
  const s = STATE_STYLE[check.state] || STATE_STYLE.unknown;
  return (
    <div style={{
      display: 'flex', gap: 11, padding: '10px 12px', borderRadius: 9,
      background: s.bg, border: '1px solid var(--crm-w08)', marginBottom: 6,
      alignItems: 'flex-start',
    }}>
      <span aria-hidden="true" style={{
        width: 8, height: 8, borderRadius: '50%', background: s.dot, flex: 'none', marginTop: 6,
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700, color: 'var(--crm-ink)', fontSize: 13 }}>{check.label}</span>
          {/* Standing rule: every line explains itself where it is read. */}
          <InfoDot label={check.label} text={check.info} />
          {check.value != null && (
            <span style={{
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 12, color: 'var(--crm-w72)',
            }}>{check.value}</span>
          )}
          <span style={{
            marginLeft: 'auto', fontSize: 10.5, textTransform: 'uppercase',
            letterSpacing: '.06em', color: s.dot, fontWeight: 700,
          }}>{s.label}</span>
        </div>
        {check.detail && (
          <div style={{ fontSize: 12.5, color: 'var(--crm-w60)', marginTop: 3, lineHeight: 1.55 }}>
            {check.detail}
          </div>
        )}
        {check.action && (
          <div style={{
            fontSize: 12.5, color: 'var(--crm-ink)', marginTop: 5, lineHeight: 1.55,
            paddingLeft: 10, borderLeft: `2px solid ${s.dot}`,
          }}>
            <strong>Do:</strong> {check.action}
          </div>
        )}
      </div>
    </div>
  );
}
