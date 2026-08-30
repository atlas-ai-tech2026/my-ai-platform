// ─── speech-input.js ─────────────────────────────────────────────────────────
// Speak the prompt instead of typing it.
//
// ── WHY THIS MATTERS HERE SPECIFICALLY ─────────────────────────────────────
// The workshops are Arabic-speaking, and most laptops in those rooms have
// English keyboards. Typing a long Arabic prompt on one is genuinely slow —
// slow enough that people shorten what they ask for, and get a worse picture
// because of the keyboard rather than the idea.
//
// ── WHY THE BROWSER'S OWN RECOGNISER, AND WHAT IT COSTS ────────────────────
// We already host Whisper in our own bucket for Edit Cut, and it is better on
// privacy: the audio never leaves the machine. It is the wrong choice HERE.
//
//   · ~40 MB downloaded on first use — in a workshop, on shared wifi, with
//     twenty people starting at once
//   · record-then-transcribe, so nothing appears until you stop speaking
//
// The browser's recogniser is instant and shows words AS THEY ARE SPOKEN,
// which is what makes dictation feel worth using. The cost is real and stated
// in the UI rather than hidden: in Chrome the audio is sent to Google for
// recognition. For a PROMPT — a description of a picture somebody is about to
// publish — that is a reasonable trade. It would not be for the transcript of
// a customer's private video, which is exactly why Edit Cut uses Whisper.
//
// ── AND THE ONE RULE ───────────────────────────────────────────────────────
// IT NEVER OVERWRITES WHAT THEY TYPED. Speech APPENDS. Somebody who has
// written three careful lines and then adds a spoken sentence must not lose
// the three lines — and there is no undo on a textarea somebody else cleared.

/** Chrome and Safari expose it under different names; Firefox not at all. */
export function speechSupported(win = typeof window !== 'undefined' ? window : undefined) {
  if (!win) return false;
  return Boolean(win.SpeechRecognition || win.webkitSpeechRecognition);
}

/**
 * The languages offered.
 *
 * Arabic first, deliberately: it is the harder one to type on the keyboards
 * these customers actually have, so it is the reason the button exists.
 */
export const LANGUAGES = [
  { id: 'ar-SA', label: 'العربية' },
  { id: 'en-US', label: 'English' },
];

/**
 * Everything the browser can actually hear.
 *
 * The recogniser supports around a hundred languages; these are the ones that
 * plausibly walk into a Gulf workshop room. Adding a language is one line —
 * the cost is the LIST, not the code: a dropdown of ninety entries is worse
 * than four, because nobody scrolls to find their own.
 *
 * So this is offered as a "more languages" list behind the two defaults, and
 * anything nobody picks should be deleted rather than left to grow.
 */
export const MORE_LANGUAGES = [
  { id: 'ar-EG', label: 'العربية (مصر)' },
  { id: 'ar-AE', label: 'العربية (الإمارات)' },
  { id: 'en-GB', label: 'English (UK)' },
  { id: 'hi-IN', label: 'हिन्दी' },
  { id: 'ur-PK', label: 'اردو' },
  { id: 'tl-PH', label: 'Filipino' },
  { id: 'fr-FR', label: 'Français' },
  { id: 'tr-TR', label: 'Türkçe' },
];

/** Every language on offer, defaults first. */
export const ALL_LANGUAGES = [...LANGUAGES, ...MORE_LANGUAGES];

export const LANG_KEY = 'voxel.speech.lang';

/**
 * Which one to start on.
 *
 * ── WHY THIS IS REMEMBERED ─────────────────────────────────────────────────
 * Amr, comparing it to dictating to an assistant that just understands you:
 * *"I never think to choose the language."* He is right, and the browser
 * recogniser genuinely cannot detect it — you must tell it which language to
 * expect. That is the API, not a decision.
 *
 * So the next best thing: ask ONCE. Almost nobody switches language between
 * prompts, so a remembered choice makes the picker invisible after the first
 * use, which is most of the way to not choosing at all.
 *
 * Order: what they chose last → what their browser is set to → Arabic, because
 * that is who this button is for.
 */
export function defaultLanguage(
  nav = typeof navigator !== 'undefined' ? navigator : undefined,
  storage = typeof localStorage !== 'undefined' ? localStorage : undefined,
) {
  try {
    const saved = storage?.getItem(LANG_KEY);
    // Only a language we actually offer. A stale id from an older list would
    // otherwise be handed to the recogniser and fail on every attempt.
    if (saved && ALL_LANGUAGES.some((l) => l.id === saved)) return saved;
  } catch { /* private mode — not worth breaking over */ }
  const tag = String(nav?.language || '').toLowerCase();
  if (tag.startsWith('en')) return 'en-US';
  return 'ar-SA';
}

/** Remember it, so the choice is made once rather than every time. */
export function rememberLanguage(id, storage = typeof localStorage !== 'undefined' ? localStorage : undefined) {
  try { storage?.setItem(LANG_KEY, id); } catch { /* no storage */ }
  return id;
}

/**
 * Join spoken text onto whatever is already in the box.
 *
 * PURE, and the most important function here — it is the one that can destroy
 * work. Every case returns something containing the original text.
 */
export function appendSpeech(existing, spoken) {
  const had = String(existing ?? '');
  const said = String(spoken ?? '').trim();
  if (!said) return had;              // nothing heard — never clear the box
  if (!had.trim()) return said;
  // A space unless the text already ends in one, so speaking twice does not
  // run two sentences together.
  return /\s$/.test(had) ? had + said : `${had} ${said}`;
}

/**
 * What went wrong, in words a customer can act on.
 *
 * The raw errors are single tokens — "not-allowed", "no-speech" — and showing
 * those would be the platform blaming the person.
 */
export function speechErrorMessage(code) {
  switch (String(code || '')) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Voxel needs permission to use your microphone. Allow it in your browser, then try again.';
    case 'no-speech':
      return 'Nothing was heard. Check the microphone is not muted and try again.';
    case 'audio-capture':
      return 'No microphone was found on this computer.';
    case 'network':
      return 'Speech recognition needs a connection and could not reach it.';
    case 'aborted':
      return null;                    // the customer stopped it — not an error
    default:
      return 'The microphone stopped unexpectedly. Try again.';
  }
}

/**
 * Start listening.
 *
 * Everything injected so this is testable without a browser. Returns a handle
 * with stop(); calling stop twice is harmless.
 *
 * @param onInterim (text) => void   words as they are spoken, not yet final
 * @param onFinal   (text) => void   a finished phrase — the only thing appended
 * @param onError   (message|null) => void
 * @param onEnd     () => void
 */
export function startListening({
  lang, onInterim, onFinal, onError, onEnd,
  Recogniser = typeof window !== 'undefined'
    ? (window.SpeechRecognition || window.webkitSpeechRecognition)
    : null,
} = {}) {
  if (!Recogniser) {
    onError?.('This browser cannot listen. Chrome or Safari can.');
    return { stop() {} };
  }

  const rec = new Recogniser();
  rec.lang = lang || 'ar-SA';
  // Keeps going between sentences, so a long prompt is not cut off after the
  // first pause for breath.
  rec.continuous = true;
  rec.interimResults = true;

  rec.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const r = event.results[i];
      const text = r[0]?.transcript || '';
      // ONLY final results are appended. Interim text changes as the recogniser
      // reconsiders, and appending it would scatter half-heard words through
      // the prompt.
      if (r.isFinal) { onFinal?.(text); pending = ''; }
      else interim += text;
    }
    pending = interim;
    onInterim?.(interim);
  };

  // What has been heard but not yet finalised. Pressing stop should give you
  // the words immediately rather than discarding the tail — the recogniser can
  // sit on a final phrase for a second or more, and that pause is most of what
  // "it is not fast" actually means.
  let pending = '';

  rec.onerror = (e) => {
    const msg = speechErrorMessage(e?.error);
    if (msg) onError?.(msg);
  };
  rec.onend = () => onEnd?.();

  try {
    rec.start();
  } catch (e) {
    // Already running, or blocked before it began.
    onError?.(speechErrorMessage(e?.name) || 'The microphone could not be started.');
    return { stop() {} };
  }

  let stopped = false;
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      // Commit the tail BEFORE stopping. Otherwise a sentence spoken and then
      // ended by pressing the button is simply lost, and the customer has to
      // say it again — which is the worst possible response to "it is slow".
      if (pending.trim()) { onFinal?.(pending); pending = ''; }
      try { rec.stop(); } catch { /* already ended */ }
    },
  };
}
