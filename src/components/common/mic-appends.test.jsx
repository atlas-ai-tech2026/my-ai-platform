// ─── mic-appends.test.jsx ────────────────────────────────────────────────────
// ☠ THE SECOND DICTATION DELETED THE FIRST.
//
// Amr, testing on production 2026-09-02:
//
//   "When I record something ... everything it's written absolutely right,
//    then I forget something to need to add more words on the same
//    conversation. When I click play again, the first word it's disappear or
//    deleted, and only the new one it's become. I cannot put the multiple
//    voice recording and typing."
//
// ── THE CAUSE ──────────────────────────────────────────────────────────────
// The browser keeps talking after you stop it. rec.stop() makes Chrome deliver
// one more `isFinal` result ASYNCHRONOUSLY — after MicButton.stop() has already
// set base.current = ''. paint() then rebuilds the box from an empty base, so
// everything typed or dictated before is replaced by the handful of words that
// arrived late.
//
// The tail is not lost by ignoring those: speech-input's stop() flushes
// `pending` through onFinal synchronously, while the run is still live. The
// late result is usually the SAME phrase, so honouring it would duplicate the
// words as well as eat the box.
//
// These tests drive the recogniser directly, because the bug lives entirely in
// the ordering of callbacks — no assertion about the component's own state
// could have caught it.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MicButton from './MicButton';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/lib/chime', () => ({ chimeStart: vi.fn(), chimeStop: vi.fn() }));

/** A stand-in for the browser recogniser we can drive by hand. */
let rec;
class FakeRecogniser {
  constructor() { rec = this; this.lang = ''; }
  start() {}
  stop() { this.onend?.(); }
  /** Deliver a finished phrase, the way Chrome does. */
  final(text) {
    this.onresult?.({ resultIndex: 0, results: [{ 0: { transcript: text }, isFinal: true }] });
  }
}

beforeEach(() => {
  vi.restoreAllMocks();
  window.SpeechRecognition = FakeRecogniser;
});

/** The box, with the mic wired to it exactly as every page wires it. */
function Box({ initial = '' }) {
  const [text, setText] = React.useState(initial);
  return (
    <>
      <textarea aria-label="prompt" value={text} onChange={(e) => setText(e.target.value)} />
      <MicButton getValue={() => text} onChange={setText} />
    </>
  );
}

const mic = () => screen.getAllByRole('button')[0];
const box = () => screen.getByLabelText('prompt');

describe('☠ A SECOND DICTATION ADDS TO THE FIRST', () => {
  it('dictate · stop · dictate again — both are in the box', async () => {
    render(<Box />);
    await userEvent.click(mic());
    act(() => rec.final('a cat on a roof'));
    await userEvent.click(mic());                    // stop
    expect(box().value).toBe('a cat on a roof');

    await userEvent.click(mic());                    // start again
    act(() => rec.final('at sunset'));
    await userEvent.click(mic());
    expect(box().value).toBe('a cat on a roof at sunset');
  });

  it('☠ and a LATE result after stopping cannot wipe the box', async () => {
    // The bug itself. Chrome delivers one more final AFTER rec.stop(), when
    // base has already been cleared.
    render(<Box />);
    await userEvent.click(mic());
    act(() => rec.final('a cat on a roof'));
    await userEvent.click(mic());                    // stop — refs cleared here
    act(() => rec.final('LATE'));                    // Chrome, a moment later
    expect(box().value, 'a late result replaced everything').toBe('a cat on a roof');
  });

  it('dictation adds to text that was TYPED first', async () => {
    render(<Box initial="a cat" />);
    await userEvent.click(mic());
    act(() => rec.final('on a roof'));
    expect(box().value).toBe('a cat on a roof');
  });

  it('☠ and typing between two dictations survives', async () => {
    // "I cannot put the multiple voice recording and typing" — this is that.
    render(<Box />);
    await userEvent.click(mic());
    act(() => rec.final('a cat'));
    await userEvent.click(mic());

    await userEvent.type(box(), ' on a roof');
    expect(box().value).toBe('a cat on a roof');

    await userEvent.click(mic());
    act(() => rec.final('at sunset'));
    expect(box().value).toBe('a cat on a roof at sunset');
  });

  it('three dictations in a row all survive', async () => {
    render(<Box />);
    for (const phrase of ['one', 'two', 'three']) {
      await userEvent.click(mic());
      act(() => rec.final(phrase));
      await userEvent.click(mic());
    }
    expect(box().value).toBe('one two three');
  });
});

describe('the run still commits what it heard', () => {
  it('a phrase spoken before stopping is kept, not dropped', async () => {
    // The guard must not throw away the tail — that is the opposite failure,
    // and the reason speech-input flushes synchronously inside stop().
    render(<Box />);
    await userEvent.click(mic());
    act(() => rec.final('kept'));
    await userEvent.click(mic());
    expect(box().value).toBe('kept');
  });

  it('the recogniser ending on its own does not clear anything', async () => {
    // Chrome ends the session after a long silence. That must leave the words.
    render(<Box />);
    await userEvent.click(mic());
    act(() => rec.final('spoken then silence'));
    act(() => rec.onend?.());
    expect(box().value).toBe('spoken then silence');
  });
});
