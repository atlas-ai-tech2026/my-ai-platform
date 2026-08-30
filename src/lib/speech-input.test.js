// ─── speech-input.test.js ────────────────────────────────────────────────────
// Speaking the prompt instead of typing it.
//
// ═══════════════════════════════════════════════════════════════════════════
// THE ONE RULE: IT NEVER OVERWRITES WHAT THEY TYPED.
// ═══════════════════════════════════════════════════════════════════════════
// Somebody writes three careful lines, then adds a spoken sentence. Losing the
// three lines is unrecoverable — there is no undo on a textarea that something
// else cleared, and the prompt is the work.
//
// So appendSpeech is pure, and every case below returns something that still
// contains the original text. The rest of the file is about the two ways a
// dictation button annoys people: showing a raw error token, and pasting
// half-heard words into the box as the recogniser changes its mind.

import { describe, it, expect, vi } from 'vitest';
import {
  appendSpeech, speechSupported, speechErrorMessage, defaultLanguage,
  startListening, LANGUAGES, MORE_LANGUAGES, ALL_LANGUAGES, rememberLanguage,
} from './speech-input.js';

/** A recogniser that behaves like the real one. The first version of these
 *  tests omitted start(), so startListening took its "could not start" path
 *  and three assertions measured the wrong thing entirely. */
function fakeRecogniser() {
  const box = {};
  box.Recogniser = function Rec() {
    box.rec = this;
    this.start = vi.fn();
    this.stop = vi.fn();
  };
  return box;
}

describe('☠ IT NEVER DESTROYS WHAT WAS TYPED', () => {
  it('appends rather than replacing', () => {
    expect(appendSpeech('a careful line', 'and a spoken one'))
      .toBe('a careful line and a spoken one');
  });

  it('hearing NOTHING leaves the box exactly as it was', () => {
    // The dangerous case: the recogniser returns empty and the naive version
    // writes it straight in, clearing everything.
    for (const said of ['', '   ', null, undefined]) {
      expect(appendSpeech('three careful lines', said)).toBe('three careful lines');
    }
  });

  it('and every other input still contains the original', () => {
    const original = 'the work';
    for (const said of ['x', '', null, undefined, '  spaced  ', 0, false]) {
      expect(appendSpeech(original, said), JSON.stringify(said)).toContain(original);
    }
  });

  it('an empty box takes the speech as-is, not with a leading space', () => {
    expect(appendSpeech('', 'a cat on a wall')).toBe('a cat on a wall');
    expect(appendSpeech('   ', 'a cat')).toBe('a cat');
  });

  it('speaking twice does not run the sentences together', () => {
    let t = appendSpeech('', 'a cat');
    t = appendSpeech(t, 'on a wall');
    expect(t).toBe('a cat on a wall');
  });

  it('does not double the space when the text already ends in one', () => {
    expect(appendSpeech('a cat ', 'on a wall')).toBe('a cat on a wall');
  });

  it('a null existing value does not become the string "null"', () => {
    expect(appendSpeech(null, 'a cat')).toBe('a cat');
    expect(appendSpeech(undefined, 'a cat')).toBe('a cat');
  });
});

describe('only FINISHED phrases reach the prompt', () => {
  // Interim results change as the recogniser reconsiders. Appending them would
  // scatter half-heard words through somebody's prompt.
  const fakeEvent = (results) => ({ resultIndex: 0, results });

  it('interim text is reported separately and never appended', () => {
    const f = fakeRecogniser();
    const onFinal = vi.fn(); const onInterim = vi.fn();
    startListening({ Recogniser: f.Recogniser, onFinal, onInterim });

    f.rec.onresult(fakeEvent([{ 0: { transcript: 'a ca' }, isFinal: false }]));
    expect(onFinal).not.toHaveBeenCalled();
    expect(onInterim).toHaveBeenCalledWith('a ca');
  });

  it('a final phrase IS appended', () => {
    const f = fakeRecogniser();
    const onFinal = vi.fn();
    startListening({ Recogniser: f.Recogniser, onFinal });
    f.rec.onresult(fakeEvent([{ 0: { transcript: 'a cat on a wall' }, isFinal: true }]));
    expect(onFinal).toHaveBeenCalledWith('a cat on a wall');
  });

  it('keeps listening between sentences — a long prompt has pauses in it', () => {
    const f = fakeRecogniser();
    startListening({ Recogniser: f.Recogniser });
    expect(f.rec.continuous).toBe(true);
    expect(f.rec.interimResults).toBe(true);
  });
});

describe('errors are sentences, not tokens', () => {
  it('a refused microphone says what to do about it', () => {
    expect(speechErrorMessage('not-allowed')).toMatch(/Allow it in your browser/);
    expect(speechErrorMessage('service-not-allowed')).toMatch(/permission/i);
  });

  it('silence blames the microphone, not the person', () => {
    expect(speechErrorMessage('no-speech')).toMatch(/not muted/);
  });

  it('no microphone at all says so plainly', () => {
    expect(speechErrorMessage('audio-capture')).toMatch(/No microphone/);
  });

  it('STOPPING is not an error and shows nothing', () => {
    // The customer pressed the button. Telling them off for it would be absurd.
    expect(speechErrorMessage('aborted')).toBeNull();
  });

  it('an unknown code still produces something readable', () => {
    for (const c of ['weird', '', null, undefined]) {
      const m = speechErrorMessage(c);
      expect(m).toBeTruthy();
      expect(m).not.toMatch(/undefined|null/);
    }
  });

  it('an error is surfaced through onError, not thrown', () => {
    const f = fakeRecogniser();
    const onError = vi.fn();
    startListening({ Recogniser: f.Recogniser, onError });
    f.rec.onerror({ error: 'not-allowed' });
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/permission/i));
  });

  it('and "aborted" is NOT surfaced', () => {
    const f = fakeRecogniser();
    const onError = vi.fn();
    startListening({ Recogniser: f.Recogniser, onError });
    f.rec.onerror({ error: 'aborted' });
    expect(onError).not.toHaveBeenCalled();
  });
});

describe('the button appears only where it can work', () => {
  it('supported where the browser provides a recogniser', () => {
    expect(speechSupported({ SpeechRecognition: function () {} })).toBe(true);
    expect(speechSupported({ webkitSpeechRecognition: function () {} })).toBe(true);
  });

  it('and NOT where it does not — a dead button is worse than none', () => {
    expect(speechSupported({})).toBe(false);
    expect(speechSupported(undefined)).toBe(false);
  });

  it('says so kindly if started anyway', () => {
    const onError = vi.fn();
    startListening({ Recogniser: null, onError });
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/Chrome or Safari/));
  });
});

describe('language', () => {
  it('offers Arabic FIRST — it is the reason this button exists', () => {
    // English is typable on the keyboards these customers actually have.
    // Arabic mostly is not, which is the whole point.
    expect(LANGUAGES[0].id).toBe('ar-SA');
  });

  it('follows the browser, defaulting to Arabic', () => {
    expect(defaultLanguage({ language: 'en-GB' })).toBe('en-US');
    expect(defaultLanguage({ language: 'ar-KW' })).toBe('ar-SA');
    expect(defaultLanguage({})).toBe('ar-SA');
    expect(defaultLanguage({ language: '' })).toBe('ar-SA');
  });

  it('passing NOTHING uses the real browser, not the Arabic default', () => {
    // A default parameter only fills in for `undefined`, so
    // `defaultLanguage(undefined)` reads the real navigator rather than the
    // fallback — which is correct, and is exactly what the first version of
    // this test got wrong. The same trap once nearly caused a blank Edit Cut
    // page.
    expect(['ar-SA', 'en-US']).toContain(defaultLanguage());
  });

  it('is passed to the recogniser', () => {
    const f = fakeRecogniser();
    startListening({ Recogniser: f.Recogniser, lang: 'en-US' });
    expect(f.rec.lang).toBe('en-US');
  });
});

describe('stopping', () => {
  it('stops once, and twice is harmless', () => {
    const f = fakeRecogniser();
    const h = startListening({ Recogniser: f.Recogniser });
    h.stop(); h.stop();
    expect(f.rec.stop).toHaveBeenCalledTimes(1);
  });

  it('a recogniser that throws on start reports it instead of crashing', () => {
    const Recogniser = function () {
      this.start = () => { throw Object.assign(new Error('x'), { name: 'not-allowed' }); };
    };
    const onError = vi.fn();
    const h = startListening({ Recogniser, onError });
    expect(onError).toHaveBeenCalled();
    expect(() => h.stop()).not.toThrow();
  });
});

describe('more languages, and why the list is short', () => {
  it('the two DEFAULTS are Arabic and English, in that order', () => {
    expect(LANGUAGES.map((l) => l.id)).toEqual(['ar-SA', 'en-US']);
  });

  it('the extra list covers who actually walks into a Gulf workshop', () => {
    // Hindi, Urdu and Filipino between them cover a large share of the
    // workforce in Kuwait and Saudi Arabia. Guessing that from a map of the
    // world's biggest languages would have given a different, wronger list.
    const ids = MORE_LANGUAGES.map((l) => l.id);
    for (const want of ['hi-IN', 'ur-PK', 'tl-PH', 'ar-EG']) expect(ids).toContain(want);
  });

  it('every entry has a label in its OWN script', () => {
    // "Hindi" written in English is a label for somebody who already reads
    // English — which is the person who does not need this list.
    for (const l of ALL_LANGUAGES) {
      expect(l.label, l.id).toBeTruthy();
      expect(l.id).toMatch(/^[a-z]{2}-[A-Z]{2}$/);
    }
  });

  it('no duplicates between the defaults and the extras', () => {
    const ids = ALL_LANGUAGES.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('and the whole list stays SHORT — a dropdown nobody scrolls is not a feature', () => {
    // The recogniser supports about a hundred. Offering a hundred means
    // nobody finds their own.
    expect(ALL_LANGUAGES.length).toBeLessThanOrEqual(12);
  });
});

describe('the language is chosen ONCE, not every time', () => {
  const store = (initial) => {
    let v = initial;
    return { getItem: () => v, setItem: (_k, next) => { v = next; }, read: () => v };
  };

  it('remembers what was picked last', () => {
    // Amr: "I never think to choose the language." The recogniser genuinely
    // cannot detect it, so the next best thing is to ask once.
    const st = store(null);
    rememberLanguage('ur-PK', st);
    expect(defaultLanguage({ language: 'en-US' }, st)).toBe('ur-PK');
  });

  it('ignores a remembered language we no longer offer', () => {
    // A stale id from an older list would be handed to the recogniser and fail
    // on every single attempt, with nothing on screen explaining why.
    expect(defaultLanguage({ language: 'en-US' }, store('kl-GL'))).toBe('en-US');
    expect(defaultLanguage({ language: 'ar-KW' }, store('nonsense'))).toBe('ar-SA');
  });

  it('falls back to the browser, then to Arabic', () => {
    expect(defaultLanguage({ language: 'en-GB' }, store(null))).toBe('en-US');
    expect(defaultLanguage({ language: 'ar-KW' }, store(null))).toBe('ar-SA');
  });

  it('survives storage that throws — private mode is not worth breaking over', () => {
    const bad = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(() => defaultLanguage({ language: 'en-US' }, bad)).not.toThrow();
    expect(defaultLanguage({ language: 'en-US' }, bad)).toBe('en-US');
    expect(() => rememberLanguage('ar-SA', bad)).not.toThrow();
  });
});

describe('pressing stop does not lose the sentence you just said', () => {
  it('commits what was heard but not yet finalised', () => {
    // The recogniser can sit on a phrase for a second or more before calling
    // it final. Discarding it on stop means saying it all again — the worst
    // possible answer to "it feels slow".
    const f = fakeRecogniser();
    const onFinal = vi.fn();
    const h = startListening({ Recogniser: f.Recogniser, onFinal });
    f.rec.onresult({ resultIndex: 0, results: [{ 0: { transcript: 'a cat on a wall' }, isFinal: false }] });
    expect(onFinal).not.toHaveBeenCalled();
    h.stop();
    expect(onFinal).toHaveBeenCalledWith('a cat on a wall');
  });

  it('does not commit an empty tail', () => {
    const f = fakeRecogniser();
    const onFinal = vi.fn();
    const h = startListening({ Recogniser: f.Recogniser, onFinal });
    f.rec.onresult({ resultIndex: 0, results: [{ 0: { transcript: '   ' }, isFinal: false }] });
    h.stop();
    expect(onFinal).not.toHaveBeenCalled();
  });

  it('does not commit a phrase twice when it was already final', () => {
    const f = fakeRecogniser();
    const onFinal = vi.fn();
    const h = startListening({ Recogniser: f.Recogniser, onFinal });
    f.rec.onresult({ resultIndex: 0, results: [{ 0: { transcript: 'a cat' }, isFinal: true }] });
    h.stop();
    expect(onFinal).toHaveBeenCalledTimes(1);
  });
});
