// ─── FirstRun.jsx ────────────────────────────────────────────────────────────
// What a new customer sees the first time they sign in, and never again.
//
// ── THE RULES THIS IS BUILT UNDER (agreed with Amr, 2026-08-31) ────────────
// · Saved PER SCREEN, not at the end — somebody who quits on screen 2 still
//   tells us where they came from, and the people who quit are the ones worth
//   understanding.
// · A skip writes an explicit value, never null. "Never got this far" and
//   "saw it and said no" are different facts and the skip rate is impossible
//   if they share one representation.
// · Every answer is timestamped, which is where "seconds per screen" comes
//   from — a question averaging forty seconds is one people are struggling
//   with, and counts alone would never show it.
// · IT NEVER BLOCKS. If saving fails the customer goes into the product
//   anyway. A survey must not lock somebody out of the thing they paid for.
//
// ── AND WHY SCREEN 2 HAS NO SKIP ───────────────────────────────────────────
// Its answers decide where we send them and how much help they get. Skipping
// leaves us guessing. Every other screen is skippable, because a question
// somebody cannot skip gets answered dishonestly — which is worse for the
// statistics than not being answered at all.

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { SCREENS, SKIPPED, starterFor } from '@/lib/onboarding-questions';
import FirstRunArt from './FirstRunArt';

const MONO = '"JetBrains Mono", ui-monospace, monospace';
const C = {
  ground: '#08080a', panel: '#111114', panel2: '#191920',
  line: 'rgba(255,255,255,0.08)', line2: 'rgba(255,255,255,0.15)',
  ink: '#fff', ink2: 'rgba(255,255,255,0.60)', ink3: 'rgba(255,255,255,0.33)',
  accent: '#e01e1e', accentSoft: '#ff5555', ok: '#34d399',
};

const valueOf = (o) => (typeof o === 'string' ? o : o.value);
const labelOf = (o) => (typeof o === 'string' ? o : o.label);

export default function FirstRun({ userId, onFinish, api }) {
  const [i, setI] = useState(0);
  const [answers, setAnswers] = useState({});
  const [busy, setBusy] = useState(false);
  const startedAt = useRef(Date.now());
  const screen = SCREENS[i];

  useEffect(() => { startedAt.current = Date.now(); }, [i]);

  const pick = (qid, value, multi) => {
    setAnswers((a) => {
      if (!multi) return { ...a, [qid]: value };
      const had = Array.isArray(a[qid]) ? a[qid] : [];
      return { ...a, [qid]: had.includes(value) ? had.filter((v) => v !== value) : [...had, value] };
    });
  };

  const chosen = (qid, value, multi) => {
    const a = answers[qid];
    return multi ? (Array.isArray(a) && a.includes(value)) : a === value;
  };

  /** Send this screen and move on. Never throws, never blocks. */
  const advance = useCallback(async (skipped) => {
    setBusy(true);
    const ms = Date.now() - startedAt.current;
    const payload = {};
    for (const q of screen.questions) {
      // An explicit skip for every question ON THIS SCREEN, so the rate is
      // computable. Untouched-but-not-skipped stays absent.
      if (skipped) payload[q.id] = SKIPPED;
      else if (answers[q.id] !== undefined && answers[q.id] !== '') payload[q.id] = answers[q.id];
    }
    try {
      const last = i === SCREENS.length - 1;
      await api[last ? 'done' : 'step']({ screenId: screen.id, answers: payload, index: i, ms });
    } catch { /* a survey must never keep somebody out */ }
    setBusy(false);
    if (i === SCREENS.length - 1) onFinish?.(answers);
    else setI(i + 1);
  }, [i, screen, answers, api, onFinish]);

  const pct = Math.round(((i + 1) / SCREENS.length) * 100);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9000, background: C.ground,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20, overflowY: 'auto', fontFamily: '"DM Sans", sans-serif',
    }}>
      <div style={{
        width: '100%', maxWidth: 1000, background: C.panel,
        border: `1px solid ${C.line}`, borderRadius: 18, overflow: 'hidden',
        boxShadow: '0 40px 90px -20px rgba(0,0,0,.7)',
        display: 'grid', gridTemplateColumns: 'minmax(0,1.12fr) minmax(0,1fr)',
        minHeight: 520,
      }} className="firstrun-shell">
        <div style={{ padding: '44px 44px 40px', display: 'flex', flexDirection: 'column', minWidth: 0 }}>

          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 38 }}>
            <b style={{ fontFamily: MONO, fontSize: 11.5, fontWeight: 500, letterSpacing: '0.14em', color: C.ink3 }}>
              <span style={{ color: C.accentSoft }}>{String(i + 1).padStart(2, '0')}</span> / {String(SCREENS.length).padStart(2, '0')}
            </b>
            <span style={{ flex: 1, height: 2, background: C.line2, borderRadius: 2, overflow: 'hidden' }}>
              <span style={{ display: 'block', height: '100%', width: `${pct}%`, background: C.accent, borderRadius: 2, transition: 'width .3s ease' }} />
            </span>
          </div>

          <h2 style={{ fontSize: 32, fontWeight: 700, letterSpacing: '-0.035em', lineHeight: 1.1, margin: '0 0 10px', color: C.ink }}>
            {screen.title}
          </h2>
          <p style={{ fontSize: 14.5, color: C.ink3, margin: '0 0 30px', maxWidth: '44ch' }}>{screen.sub}</p>

          <div style={{ flex: 1 }}>
            {screen.questions.map((q) => (
              <div key={q.id} style={{ marginBottom: 24 }}>
                {q.label && (
                  <span style={{
                    fontSize: 12, fontFamily: MONO, letterSpacing: '0.11em', textTransform: 'uppercase',
                    color: C.ink3, margin: '0 0 11px', display: 'block',
                  }}>
                    {q.label}{q.optional && <span style={{ textTransform: 'none', letterSpacing: 0 }}> — optional</span>}
                  </span>
                )}

                {q.kind === 'cards' && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 10 }}>
                    {q.options.map((o) => {
                      const on = chosen(q.id, o.value, q.multi);
                      return (
                        <button key={o.value} type="button" onClick={() => pick(q.id, o.value, q.multi)}
                          style={{
                            textAlign: 'left', cursor: 'pointer', background: on ? 'rgba(224,30,30,0.13)' : C.panel2,
                            border: `1px solid ${on ? C.accent : C.line}`, borderRadius: 13, padding: '16px 16px 15px', color: C.ink,
                          }}>
                          <b style={{ display: 'block', fontSize: 14.5, fontWeight: 700, marginBottom: 2 }}>{o.label}</b>
                          <span style={{ display: 'block', fontSize: 12, color: C.ink3, lineHeight: 1.4 }}>{o.hint}</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {q.kind === 'chips' && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                    {q.options.map((o) => {
                      const v = valueOf(o); const on = chosen(q.id, v, q.multi);
                      return (
                        <button key={v} type="button" onClick={() => pick(q.id, v, q.multi)}
                          style={{
                            cursor: 'pointer', fontSize: 13, fontFamily: 'inherit',
                            color: on ? C.ink : C.ink2, background: on ? 'rgba(224,30,30,0.15)' : C.panel2,
                            border: `1px solid ${on ? C.accent : C.line}`, borderRadius: 999,
                            padding: '7px 14px', display: 'inline-flex', alignItems: 'center', gap: 7,
                            fontWeight: on ? 500 : 400,
                          }}>
                          {on && <span style={{ width: 5, height: 5, borderRadius: '50%', background: C.accentSoft }} />}
                          {labelOf(o)}
                        </button>
                      );
                    })}
                  </div>
                )}

                {q.kind === 'text' && (
                  <input
                    type="text" maxLength={q.max || 120} placeholder={q.placeholder}
                    value={answers[q.id] || ''} onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                    style={{
                      width: '100%', background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 10,
                      padding: '11px 14px', fontSize: 14, color: C.ink, fontFamily: 'inherit', outline: 'none',
                    }}
                  />
                )}
              </div>
            ))}

            {screen.generate && (
              <div style={{ background: C.panel2, border: `1px solid ${C.line2}`, borderRadius: 13, padding: '17px 19px' }}>
                <div style={{ fontSize: 15, lineHeight: 1.55, color: C.ink }}>{starterFor(userId)}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.line}` }}>
                  <span style={{ fontFamily: MONO, fontSize: 10.5, color: C.ink2, background: 'rgba(255,255,255,.05)', border: `1px solid ${C.line}`, borderRadius: 999, padding: '5px 11px' }}>Nano Banana Pro</span>
                  <span style={{ fontFamily: MONO, fontSize: 10.5, color: C.ok, background: 'rgba(52,211,153,.1)', border: '1px solid rgba(52,211,153,.35)', borderRadius: 999, padding: '5px 11px' }}>on us</span>
                </div>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginTop: 'auto', paddingTop: 34 }}>
            <button type="button" onClick={() => advance(false)} disabled={busy}
              style={{
                background: C.accent, color: '#fff', border: 0, borderRadius: 10, padding: '12px 26px',
                fontFamily: 'inherit', fontSize: 14.5, fontWeight: 700, cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.6 : 1,
              }}>
              {screen.generate ? 'Generate' : 'Continue'}
            </button>
            {screen.skippable && (
              <button type="button" onClick={() => advance(true)} disabled={busy}
                style={{ background: 'none', border: 0, color: C.ink3, fontFamily: 'inherit', fontSize: 14.5, fontWeight: 500, cursor: 'pointer', padding: '12px 0' }}>
                {screen.generate ? 'I’ll do it myself' : 'Skip'}
              </button>
            )}
          </div>
        </div>

        <FirstRunArt name={screen.art} caption={screen.caption}
          tagline={screen.generate ? 'Yours, in a moment' : 'Made in Voxel'} />
      </div>

      <style>{`
        @media (max-width: 860px) {
          .firstrun-shell { grid-template-columns: 1fr !important; }
          .firstrun-shell > div:last-child { min-height: 200px; border-left: 0 !important; border-top: 1px solid rgba(255,255,255,.08); }
        }
      `}</style>
    </div>
  );
}
