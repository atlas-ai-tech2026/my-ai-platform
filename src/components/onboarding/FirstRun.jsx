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
  // The screen fades OUT before the next one fades in. Without this the
  // change was instant however long the enter animation was.
  const [leaving, setLeaving] = useState(false);
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

  /** Has this question been answered at all? */
  const filled = (q) => {
    const v = answers[q.id];
    if (Array.isArray(v)) return v.length > 0;
    return v !== undefined && String(v).trim() !== '';
  };

  /**
   * Continue is only live once every question on this screen has an answer.
   *
   * ── WHY, AND WHY SKIP IS THE ONLY WAY PAST ───────────────────────────
   * Amr: "if I did not check anything, you cannot move from this page." He is
   * right, and it makes the DATA honest as well as the screen: a Continue
   * that advances on nothing produces rows that are neither answered nor
   * skipped, and those are exactly the rows that make a skip rate meaningless.
   *
   * Declining is a deliberate act — the Skip button — not something you fall
   * into by clicking the wrong one. Questions marked optional (the company
   * name) never hold it back.
   */
  const canContinue = screen.questions.every((q) => q.optional || filled(q));

  const chosen = (qid, value, multi) => {
    const a = answers[qid];
    return multi ? (Array.isArray(a) && a.includes(value)) : a === value;
  };

  /** Send this screen and move on. Never throws, never blocks. */
  const advance = useCallback(async (skipped) => {
    setBusy(true);
    // Start the fade the instant they click, so the screen answers the press
    // rather than waiting on the network. The save runs underneath it.
    setLeaving(true);
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
    // Hold until the fade-out has actually played. 190ms matches .fr-leave;
    // a swap faster than the animation is the same as no animation at all.
    const held = Date.now() - startedAt.current;
    if (held < 190) await new Promise((r) => setTimeout(r, 190 - held));
    setBusy(false);
    setLeaving(false);
    if (i === SCREENS.length - 1) onFinish?.(answers);
    else setI(i + 1);
  }, [i, screen, answers, api, onFinish]);

  const pct = Math.round(((i + 1) / SCREENS.length) * 100);

  return (
    <div className="fr-wrap" style={{
      position: 'fixed', inset: 0, zIndex: 9000, background: C.ground,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: '"DM Sans", sans-serif',
    }}>
      <div className="fr-shell" style={{
        width: '100%', maxWidth: 1000, background: C.panel,
        border: `1px solid ${C.line}`, borderRadius: 18, overflow: 'hidden',
        boxShadow: '0 40px 90px -20px rgba(0,0,0,.7)',
      }}>
        <div className="fr-side">

          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 38 }}>
            <b style={{ fontFamily: MONO, fontSize: 11.5, fontWeight: 500, letterSpacing: '0.14em', color: C.ink3 }}>
              <span style={{ color: C.accentSoft }}>{String(i + 1).padStart(2, '0')}</span> / {String(SCREENS.length).padStart(2, '0')}
            </b>
            <span style={{ flex: 1, height: 2, background: C.line2, borderRadius: 2, overflow: 'hidden' }}>
              <span style={{ display: 'block', height: '100%', width: `${pct}%`, background: C.accent, borderRadius: 2, transition: 'width .3s ease' }} />
            </span>
          </div>

          {/* ── ONE REAL BOX, NOT display:contents ─────────────────────────
              The first version put the animation on a display:contents
              wrapper. Such an element generates no box, so transform and
              opacity have nothing to act on and the animation NEVER RAN —
              which is exactly what Amr reported: no transition at all. */}
          <div key={screen.id} className={`fr-content ${leaving ? 'fr-leave' : 'fr-enter'}`}>
            <h2 className="fr-q" style={{ fontWeight: 700, letterSpacing: '-0.035em', lineHeight: 1.1, margin: '0 0 10px', color: C.ink }}>
              {screen.title}
            </h2>
            <p style={{ fontSize: 14.5, color: C.ink3, margin: '0 0 26px', maxWidth: '44ch' }}>{screen.sub}</p>

            <div className="fr-body">
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
                  <div className="fr-cards">
                    {q.options.map((o) => {
                      const on = chosen(q.id, o.value, q.multi);
                      return (
                        <button key={o.value} type="button" className="fr-card"
                          aria-pressed={on} onClick={() => pick(q.id, o.value, q.multi)}
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
                        <button key={v} type="button" className="fr-chip"
                          aria-pressed={on} onClick={() => pick(q.id, v, q.multi)}
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
                    className="fr-input"
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
          </div>

          <div style={{
            display: 'flex', alignItems: 'center', gap: 20, flex: 'none',
            paddingTop: 26, marginTop: 20, borderTop: `1px solid ${C.line}`,
          }}>
            <button type="button" className="fr-btn" onClick={() => advance(false)}
              disabled={busy || !canContinue}
              style={{
                background: canContinue ? C.accent : C.panel2,
                color: canContinue ? '#fff' : C.ink3,
                border: `1px solid ${canContinue ? C.accent : C.line}`,
                borderRadius: 10, padding: '12px 26px', fontFamily: 'inherit',
                fontSize: 14.5, fontWeight: 700,
                cursor: busy ? 'wait' : (canContinue ? 'pointer' : 'not-allowed'),
                opacity: busy ? 0.6 : 1,
              }}>
              {screen.generate ? 'Generate' : 'Continue'}
            </button>
            {screen.skippable && (
              <button type="button" className="fr-ghost" onClick={() => advance(true)} disabled={busy}
                style={{ background: 'none', border: 0, color: C.ink3, fontFamily: 'inherit', fontSize: 14.5, fontWeight: 500, cursor: 'pointer', padding: '12px 0' }}>
                {screen.generate ? 'I’ll do it myself' : 'Skip'}
              </button>
            )}
            {/* A disabled button with no explanation is the worst control on
                any screen — it reads as broken. This says what is missing,
                and only once something is actually missing. */}
            {!canContinue && !busy && (
              <span style={{ fontSize: 12.5, color: C.ink3, marginLeft: 'auto', textAlign: 'right' }}>
                {screen.skippable ? 'Choose an answer, or Skip' : 'Choose an answer to continue'}
              </span>
            )}
          </div>
        </div>

        {/* key + class: React remounts it per screen, and the fade runs a beat
            longer than the question's so the eye lands on the words first. */}
        <div key={`art-${screen.id}`} className="fr-art fr-art-enter"
          style={{ minHeight: 0, borderLeft: `1px solid ${C.line}`, overflow: 'hidden' }}>
          <FirstRunArt name={screen.art} caption={screen.caption}
            tagline={screen.generate ? 'Yours, in a moment' : 'Made in Voxel'} />
        </div>
      </div>

      <style>{`
        /* ══ RESPONSIVE ══════════════════════════════════════════════════
           Three things have to survive a small window, and only the first is
           obvious:
             1. the two columns become one
             2. the QUESTIONS scroll while the buttons stay put — screen 3 has
                four questions and on a short laptop the Continue button was
                pushed below the fold, which is unreachable, not merely ugly
             3. the artwork gives up its space rather than squeezing the
                questions, because on a phone the questions are the product
                and the picture is the argument for it                       */
        .fr-wrap { padding: 20px; }
        .fr-shell {
          display: grid;
          grid-template-columns: minmax(0, 1.12fr) minmax(0, 1fr);
          /* minmax(0,1fr), not auto. A grid ROW sized by its content grows
             straight past a max-height on the container — which put the
             Continue button below the fold on a 1280x800 laptop, and a button
             you cannot reach is not a cosmetic problem. */
          grid-template-rows: minmax(0, 1fr);
          max-height: calc(100vh - 40px);
          overflow: hidden;
        }
        .fr-side {
          padding: clamp(26px, 3.4vw, 44px);
          display: flex; flex-direction: column; min-width: 0; min-height: 0;
        }
        /* the scrolling part, so the actions below it never move */
        .fr-body {
          flex: 1; min-height: 0;
          overflow-y: auto;
          /* hidden, not auto: a chip one pixel too wide produced a horizontal
             scrollbar across the whole question list. They wrap; they never
             need to scroll sideways. */
          overflow-x: hidden;
          overscroll-behavior: contain;
          padding-right: 4px;   /* so the scrollbar never sits on a chip */
        }
        .fr-body::-webkit-scrollbar { width: 6px; }
        .fr-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,.14); border-radius: 3px; }
        .fr-q { font-size: clamp(22px, 2.6vw, 32px); }
        .fr-cards { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }

        @media (max-width: 900px) {
          .fr-shell { grid-template-columns: 1fr; }
          .fr-art { min-height: 150px; max-height: 22vh; border-left: 0; border-top: 1px solid rgba(255,255,255,.08); }
        }
        /* Below this the picture is costing more than it gives: the window is
           too short for both, and a half-visible question is worse than no
           artwork. */
        @media (max-width: 640px), (max-height: 620px) {
          .fr-art { display: none; }
          .fr-wrap { padding: 0; }
          .fr-shell {
            max-height: 100vh; height: 100vh; border-radius: 0; border: 0;
            /* Collapse to ONE column too. Hiding the artwork without this left
               its grid column standing — an empty half-screen on a short
               laptop, with the questions crammed into the other half. */
            grid-template-columns: 1fr;
          }
        }
        @media (max-width: 460px) {
          .fr-cards { grid-template-columns: 1fr; }
        }

        /* ══ MOTION ══════════════════════════════════════════════════════
           One orchestrated move, not four scattered ones: the panel lifts and
           fades as a whole, and the artwork follows a beat later so the eye
           lands on the question first. Keyed on the screen id, so React
           replays it on every change.                                       */
        /* The content is a real flex box now — the previous version animated a
           display:contents wrapper, which generates NO BOX, so opacity and
           transform had nothing to act on and the animation never ran. */
        .fr-content { flex: 1; min-height: 0; display: flex; flex-direction: column; }
        @keyframes frIn {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: none; }
        }
        @keyframes frOut {
          from { opacity: 1; transform: none; }
          to   { opacity: 0; transform: translateY(-8px); }
        }
        @keyframes frArt { from { opacity: 0; } to { opacity: 1; } }
        /* Out is quicker than in: leaving should feel decisive, arriving
           should feel settled. Matched to the 190ms hold in advance(). */
        .fr-enter { animation: frIn 380ms cubic-bezier(.22,.61,.36,1) both; }
        .fr-leave { animation: frOut 190ms ease-in both; pointer-events: none; }
        .fr-art-enter { animation: frArt 640ms ease both; }

        .fr-chip, .fr-card, .fr-btn { transition: background .16s ease, border-color .16s ease, transform .12s ease; }
        .fr-chip:hover, .fr-card:hover { border-color: rgba(255,255,255,.28); }
        .fr-chip:active, .fr-card:active, .fr-btn:active { transform: scale(.985); }
        .fr-btn:hover { filter: brightness(1.08); }
        .fr-ghost:hover { color: rgba(255,255,255,.8); }
        /* Keyboard users get a visible ring; mouse users never see it. */
        .fr-chip:focus-visible, .fr-card:focus-visible, .fr-btn:focus-visible,
        .fr-ghost:focus-visible, .fr-input:focus-visible {
          outline: 2px solid #ff5555; outline-offset: 2px;
        }
        .fr-input:focus { border-color: rgba(255,255,255,.3); }

        @media (prefers-reduced-motion: reduce) {
          .fr-enter, .fr-art-enter { animation: none; }
          .fr-chip, .fr-card, .fr-btn { transition: none; }
        }
      `}</style>
    </div>
  );
}
