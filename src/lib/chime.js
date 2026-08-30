// ─── chime.js ────────────────────────────────────────────────────────────────
// Two short tones: one when the microphone opens, one when it closes.
//
// ── WHY GENERATED AND NOT A SOUND FILE ─────────────────────────────────────
// A file would be two more requests, two more things to 404, and something the
// CSP has to allow. The browser can make the tone itself in a few lines, and
// it is instant — which matters, because a confirmation sound that arrives
// after the thing it confirms is worse than silence.
//
// ── AND WHY THE TWO TONES GO IN OPPOSITE DIRECTIONS ────────────────────────
// Rising to open, falling to close. That is the one piece of it a person
// learns without being told: you know whether the microphone is on without
// looking at the screen, which is the entire point in a room where you are
// talking to twenty people rather than watching a button.
//
// ── IT MUST NEVER BE THE THING THAT BREAKS ─────────────────────────────────
// Audio is blocked before a user gesture in every browser, contexts get
// suspended, and some machines have no output at all. A dictation button that
// throws because it could not beep would be absurd — so every path here
// swallows and returns false.
//
// Quiet on purpose: 0.06 gain, ~120ms. These fire in workshop rooms with
// twenty laptops in them.

const START = [660, 880];   // rising  — listening
const STOP  = [880, 660];   // falling — stopped

/** Kept between plays: creating a context per beep leaks them, and browsers
 *  cap how many a page may have. */
let ctx = null;

/**
 * ── ONLY THE REAL ONE IS CACHED ────────────────────────────────────────────
 * An INJECTED constructor is never cached. The first version cached whatever
 * it was first given, so in a test file the first fake stuck and every later
 * one was silently ignored — three assertions measured a context they had not
 * created.
 *
 * The rule is also right in production: the cache exists because a page should
 * hold one AudioContext, and that reasoning only applies to the browser's own.
 */
function context(Ctor) {
  if (Ctor) {
    const made = new Ctor();
    if (made.state === 'suspended') made.resume?.();
    return made;
  }
  const C = typeof window !== 'undefined'
    ? (window.AudioContext || window.webkitAudioContext) : null;
  if (!C) return null;
  if (!ctx) ctx = new C();
  // Browsers suspend the context until a gesture; the click that opened the
  // microphone IS that gesture, so this resumes on the first real use.
  if (ctx.state === 'suspended') ctx.resume?.();
  return ctx;
}

/**
 * Play a two-note tone.
 *
 * @returns true if it played, false if it could not — NEVER throws.
 */
export function playTone(notes, { Ctor, gain = 0.06, noteMs = 60 } = {}) {
  try {
    const audio = context(Ctor);
    if (!audio) return false;

    const now = audio.currentTime;
    notes.forEach((hz, i) => {
      const osc = audio.createOscillator();
      const vol = audio.createGain();
      // A sine, not a square: a square wave at these frequencies is a beep
      // from a 1990s modem, and people would switch it off within a day.
      osc.type = 'sine';
      osc.frequency.value = hz;

      const at = now + (i * noteMs) / 1000;
      const until = at + noteMs / 1000;
      // Ramped rather than switched. An instant start and stop produces an
      // audible click at the edges of the note, which reads as a fault.
      vol.gain.setValueAtTime(0, at);
      vol.gain.linearRampToValueAtTime(gain, at + 0.01);
      vol.gain.linearRampToValueAtTime(0, until);

      osc.connect(vol).connect(audio.destination);
      osc.start(at);
      osc.stop(until + 0.02);
    });
    return true;
  } catch {
    // No output, no permission, a suspended context that will not resume.
    // None of these are worth failing a dictation button over.
    return false;
  }
}

export const chimeStart = (opts) => playTone(START, opts);
export const chimeStop = (opts) => playTone(STOP, opts);

/** Exposed so a test can assert the DIRECTION rather than the frequencies —
 *  the pitch is taste, the direction is the thing a person learns. */
export const TONES = { START, STOP };
