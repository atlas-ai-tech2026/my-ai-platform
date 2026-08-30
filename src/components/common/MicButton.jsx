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
// It also means the rules below are enforced in ONE place rather than eight.
//
// ── ONE BUTTON, ONE ICON (Amr, 2026-08-30) ─────────────────────────────────
// *"Keep it without play button, only the microphone icon."*
//
// It used to swap the microphone for a filled square while listening, and put
// a "Listening…" readout beside it. The square reads as a media control — a
// stop, or a play — so the button appeared to change into a different tool
// mid-sentence. Now the glyph never changes: the state is the colour and the
// pulse, and nothing else is drawn.
//
// ── AND THE WORDS APPEAR WHILE YOU SPEAK ───────────────────────────────────
// *"It's not fast."* Most of that was not the recogniser. Text only reached
// the box when a phrase was FINALISED — and the browser sits on a phrase for
// a second or more after you stop talking. In between, the words were shown
// in a little grey readout NEXT to the button and thrown away.
//
// So they go straight into the prompt box now, and are rewritten in place as
// the recogniser firms them up. Same recogniser, same speed — but you see the
// sentence forming where you are going to read it, which is the whole of what
// "fast" means here.
//
// ── THE RULE THAT SURVIVES ALL OF THAT ─────────────────────────────────────
// WHAT WAS TYPED BEFORE YOU SPOKE IS NEVER TOUCHED. It is captured the moment
// the microphone opens and every word is appended AFTER it. Somebody who has
// written three careful lines and then speaks keeps the three lines — there is
// no undo on a textarea something else cleared.
//
// The narrower honest statement: while the microphone is OPEN, this component
// owns the tail of the box. Typing into it mid-sentence will be overwritten by
// the next spoken word. That is how every dictation box behaves, and it is the
// price of showing words as they are said.

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import { chimeStart, chimeStop } from '@/lib/chime';
import {
  speechSupported, startListening, appendSpeech, defaultLanguage,
} from '@/lib/speech-input';

/**
 * @param getValue  () => string   the CURRENT text, read at the moment the
 *                  microphone OPENS — never captured at render time
 * @param onChange  (next) => void
 * @param size      the button diameter; the prompt bars differ
 */
export default function MicButton({
  getValue, onChange, size = 34, style = {}, onListeningChange,
}) {
  const [listening, setListening] = useState(false);
  // ── NO LANGUAGE PICKER ON SCREEN (2026-08-30) ──
  // Amr, twice: "I never think to choose the language" and then "please remove
  // it, I don't need to see it."
  //
  // He is right, and the picker was me exposing a limitation of the browser's
  // recogniser rather than solving it — it must be TOLD which language to
  // expect, and cannot detect one. So the choice is now made silently from the
  // browser's own setting, and the row of chips is gone.
  //
  // This does NOT make it multilingual. It makes the limitation invisible,
  // which is honest only because the real fix — a model that detects the
  // language — is written down as the next step rather than quietly dropped.
  const [lang] = useState(defaultLanguage());
  const handle = useRef(null);

  // The text as it was when the microphone opened. Everything spoken is
  // appended after this, and this is never re-read — so a phrase landing
  // before React has re-rendered cannot append itself twice.
  const base = useRef('');
  // Phrases the recogniser has committed during THIS run.
  const settled = useRef('');

  // Computed once: the answer cannot change while the page is open, and it
  // decides whether the button exists at all.
  const available = useMemo(() => speechSupported(), []);

  /** Put the sentence-so-far into the box, live. */
  const paint = (interim) => {
    const spoken = [settled.current, interim].filter((s) => s && s.trim()).join(' ');
    onChange?.(appendSpeech(base.current, spoken));
  };

  const stop = () => {
    // Falling tone. You know the microphone has closed without looking at the
    // screen — which is the point in a room where you are talking to people
    // rather than watching a button.
    chimeStop();
    // stop() commits any half-heard tail through onFinal FIRST, so this must
    // run before the refs are cleared or the last words are lost.
    handle.current?.stop();
    handle.current = null;
    base.current = '';
    settled.current = '';
    setListening(false);
    onListeningChange?.(false);
  };

  const toggle = () => {
    if (listening) { stop(); return; }
    base.current = getValue?.() ?? '';
    settled.current = '';
    setListening(true);
    onListeningChange?.(true);
    // Rising tone, and the click that triggered it is also the user gesture
    // every browser requires before it will play audio at all.
    chimeStart();
    handle.current = startListening({
      lang,
      // Straight into the box, rewritten as the recogniser changes its mind.
      onInterim: (text) => paint(text),
      onFinal: (text) => {
        settled.current = [settled.current, String(text || '').trim()]
          .filter(Boolean).join(' ');
        paint('');
      },
      onError: (msg) => { toast.error(msg); stop(); },
      onEnd: () => {
        handle.current = null;
        base.current = '';
        settled.current = '';
        setListening(false);
        onListeningChange?.(false);
      },
    });
  };

  // Leaving the page with the microphone open would keep it live behind them.
  useEffect(() => () => handle.current?.stop(), []);

  // Hidden entirely where the browser cannot listen. A dead button is worse
  // than no button — it looks like the feature is broken rather than absent.
  if (!available) return null;

  return (
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
      {/* ALWAYS the microphone. Never a square, never a triangle — a glyph that
          changes into a media control mid-sentence looks like a different
          tool, which is what Amr was reading it as.

          Drawn, not an emoji: 🎤 renders as a different object on every
          platform — a karaoke mic on one, a flat glyph on another — and at
          this size that is the difference between a control and a sticker. */}
      <svg width={Math.round(size * 0.5)} height={Math.round(size * 0.5)} viewBox="0 0 24 24"
           fill="none" stroke="currentColor" strokeWidth="2"
           strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="9" y="2" width="6" height="11" rx="3" />
        <path d="M5 10v1a7 7 0 0 0 14 0v-1" />
        <line x1="12" y1="19" x2="12" y2="22" />
      </svg>
    </button>
  );
}

/** The pulse, so every place that uses the button gets it without repeating
 *  the keyframes. With the "Listening…" readout gone this is now the ONLY
 *  moving thing on the screen while the microphone is open — a still red
 *  button is indistinguishable from one that has stopped listening. */
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
