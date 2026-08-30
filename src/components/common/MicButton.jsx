// ─── MicButton.jsx ───────────────────────────────────────────────────────────
// Speak, instead of typing. One button, used everywhere a prompt is written.
//
// ── WHY IT IS SHARED AND NOT COPIED ────────────────────────────────────────
// There are NINE places a customer types a prompt: image, video, Seedance,
// music, the video side panel, three Studio modules and the node canvas. The
// first version of this lived inside the image prompt bar, which would have
// meant the button existed on one of the nine and Amr would have found the
// other eight himself — the exact half-built shape this project keeps
// producing.
//
// It also means the rule below is enforced in ONE place rather than eight.
//
// ── THE RULE ───────────────────────────────────────────────────────────────
// IT NEVER OVERWRITES WHAT WAS TYPED. Speech appends. Somebody who has written
// three careful lines and then speaks must not lose the three lines, and there
// is no undo on a textarea something else cleared.
//
// `valueRef` is why this takes a getter rather than a value: the recogniser
// holds onto its callbacks, so a spoken phrase would otherwise append to
// whatever the text was when listening STARTED — silently discarding anything
// typed while the microphone was open.

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import { chimeStart, chimeStop } from '@/lib/chime';
import {
  speechSupported, startListening, appendSpeech, defaultLanguage,
  LANGUAGES, MORE_LANGUAGES, ALL_LANGUAGES, rememberLanguage,
} from '@/lib/speech-input';

/**
 * @param getValue  () => string   the CURRENT text, read at the moment a
 *                  phrase lands — never captured up front
 * @param onChange  (next) => void
 * @param size      the button diameter; the prompt bars differ
 */
export default function MicButton({
  getValue, onChange, size = 34, style = {}, onListeningChange,
}) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [lang, setLang] = useState(defaultLanguage());
  // The extra languages stay folded away. A dropdown of ten is worse than two
  // for the ninety percent who speak one of the two — but the Filipino or
  // Urdu speaker in the room is exactly who needs this button most.
  const [showMore, setShowMore] = useState(false);
  const handle = useRef(null);

  // Computed once: the answer cannot change while the page is open, and it
  // decides whether the button exists at all.
  const available = useMemo(() => speechSupported(), []);

  const stop = () => {
    // Falling tone. You know the microphone has closed without looking at the
    // screen — which is the point in a room where you are talking to people
    // rather than watching a button.
    chimeStop();
    handle.current?.stop();
    handle.current = null;
    setListening(false);
    setInterim('');
    onListeningChange?.(false);
  };

  const toggle = () => {
    if (listening) { stop(); return; }
    setInterim('');
    setListening(true);
    onListeningChange?.(true);
    // Rising tone, and the click that triggered it is also the user gesture
    // every browser requires before it will play audio at all.
    chimeStart();
    handle.current = startListening({
      lang,
      onInterim: setInterim,
      // APPENDS, and reads the text FRESH. See the note above.
      onFinal: (text) => onChange?.(appendSpeech(getValue?.() ?? '', text)),
      onError: (msg) => { toast.error(msg); stop(); },
      onEnd: () => { handle.current = null; setListening(false); setInterim(''); onListeningChange?.(false); },
    });
  };

  // Leaving the page with the microphone open would keep it live behind them.
  useEffect(() => () => handle.current?.stop(), []);

  // The recogniser cannot switch language while running, so changing it stops.
  useEffect(() => {
    if (listening) stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  // Hidden entirely where the browser cannot listen. A dead button is worse
  // than no button — it looks like the feature is broken rather than absent.
  if (!available) return null;

  return (
    <>
      <button
        type="button" onClick={toggle}
        aria-label={listening ? 'Stop listening' : 'Speak instead of typing'}
        title={listening ? 'Stop listening' : 'Speak instead of typing'}
        style={{
          width: size, height: size, borderRadius: '50%', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: listening ? '#E01E1E' : 'rgba(255,255,255,0.08)',
          border: `1px solid ${listening ? '#E01E1E' : 'rgba(255,255,255,0.16)'}`,
          color: '#fff', lineHeight: 1, flex: 'none', padding: 0,
          animation: listening ? 'micPulse 1.4s ease-in-out infinite' : 'none',
          transition: 'background 140ms ease, border-color 140ms ease',
          ...style,
        }}
      >
        {/* Drawn, not an emoji. 🎤 renders as a different object on every
            platform — a karaoke mic on one, a flat glyph on another — and at
            this size it is the difference between a control and a sticker. */}
        {listening ? (
          <svg width={Math.round(size * 0.34)} height={Math.round(size * 0.34)} viewBox="0 0 10 10" aria-hidden="true">
            <rect width="10" height="10" rx="1.6" fill="currentColor" />
          </svg>
        ) : (
          <svg width={Math.round(size * 0.5)} height={Math.round(size * 0.5)} viewBox="0 0 24 24"
               fill="none" stroke="currentColor" strokeWidth="2"
               strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="9" y="2" width="6" height="11" rx="3" />
            <path d="M5 10v1a7 7 0 0 0 14 0v-1" />
            <line x1="12" y1="19" x2="12" y2="22" />
          </svg>
        )}
      </button>

      {listening && (
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
          fontSize: 12.5, color: 'rgba(255,255,255,0.6)', fontFamily: '"DM Sans", sans-serif',
        }}>
          <span style={{ color: '#E01E1E', fontWeight: 700 }}>Listening…</span>
          {/* Shown, never written. Interim words change as the recogniser
              reconsiders; committing them would scatter half-heard fragments
              through somebody's prompt. */}
          {interim && <span style={{ fontStyle: 'italic' }}>{interim}</span>}
          {(showMore ? ALL_LANGUAGES : LANGUAGES).map((l) => (
            <button
              key={l.id} type="button" onClick={() => setLang(rememberLanguage(l.id))}
              style={{
                padding: '2px 9px', borderRadius: 999, cursor: 'pointer',
                fontSize: 11.5, fontFamily: 'inherit',
                background: lang === l.id ? 'rgba(224,30,30,0.2)' : 'transparent',
                border: `1px solid ${lang === l.id ? '#E01E1E' : 'rgba(255,255,255,0.14)'}`,
                color: '#fff',
              }}
            >{l.label}</button>
          ))}
          {!showMore && MORE_LANGUAGES.length > 0 && (
            <button
              type="button" onClick={() => setShowMore(true)}
              style={{
                padding: '2px 9px', borderRadius: 999, cursor: 'pointer',
                fontSize: 11.5, fontFamily: 'inherit', background: 'transparent',
                border: '1px dashed rgba(255,255,255,0.2)', color: 'rgba(255,255,255,0.6)',
              }}
            >+{MORE_LANGUAGES.length}</button>
          )}
        </span>
      )}
    </>
  );
}

/** The pulse, so every place that uses the button gets it without repeating
 *  the keyframes. A still red button is indistinguishable from one that has
 *  stopped listening. */
export function MicKeyframes() {
  return (
    <style>{`
      @keyframes micPulse {
        0%, 100% { box-shadow: 0 0 0 0 rgba(224,30,30,0.55); }
        50%      { box-shadow: 0 0 0 7px rgba(224,30,30,0); }
      }
    `}</style>
  );
}
