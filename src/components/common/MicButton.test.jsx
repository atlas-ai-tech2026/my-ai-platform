// ─── MicButton.test.jsx ──────────────────────────────────────────────────────
// The microphone, tested through what is ON THE SCREEN rather than through the
// functions behind it.
//
// That is deliberate, and it is CLAUDE.md RULE 2. Everything about this button
// that Amr has had to correct was visible from the screen and invisible from
// the code: a picker he did not want, a glyph that turned into what he read as
// a play button, a readout he did not need, and words that did not appear
// until after he had finished saying them. Not one of those is a broken
// function.
//
// So these tests render it and look.

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MicButton from './MicButton';

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

/** The last recogniser jsdom was asked to build, so a test can drive it. */
let rec;

function installRecogniser() {
  rec = null;
  window.SpeechRecognition = function FakeRecogniser() {
    rec = this;
    this.lang = '';
    this.continuous = false;
    this.interimResults = false;
    this.start = vi.fn();
    this.stop = vi.fn(() => this.onend?.());
  };
}

/** Feed the component a phrase the way Chrome does. */
function say(text, { final }) {
  rec.onresult({
    resultIndex: 0,
    results: [Object.assign([{ transcript: text }], { isFinal: final })],
  });
}

beforeEach(() => { installRecogniser(); });
afterEach(() => { delete window.SpeechRecognition; vi.restoreAllMocks(); });

describe('☠ ONLY THE MICROPHONE ICON — nothing else is ever drawn', () => {
  it('the glyph while LISTENING is identical to the glyph while idle', () => {
    // Amr: "keep it without play button, only the microphone icon."
    //
    // It used to swap the microphone for a filled square. A square at this
    // size is a media control, so the button appeared to become a different
    // tool halfway through a sentence.
    //
    // Comparing the two states rather than asserting a shape, because the
    // failure was a CHANGE — any future swap fails this whatever it swaps to.
    const { container } = render(<MicButton getValue={() => ''} onChange={() => {}} />);
    const idle = container.querySelector('svg').innerHTML;

    fireEvent.click(screen.getByRole('button'));
    const busy = container.querySelector('svg').innerHTML;

    expect(busy).toBe(idle);
  });

  it('renders exactly ONE control and ONE icon, open or closed', () => {
    const { container } = render(<MicButton getValue={() => ''} onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button'));
    expect(container.querySelectorAll('button')).toHaveLength(1);
    expect(container.querySelectorAll('svg')).toHaveLength(1);
  });

  it('shows no readout, no transcript and no language chips', () => {
    const { container } = render(<MicButton getValue={() => ''} onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button'));
    say('a red car', { final: false });

    // The words belong in the prompt box, not in a grey label beside it.
    expect(container.textContent).toBe('');
    expect(screen.queryByText(/listening/i)).toBeNull();
    expect(screen.queryByText('العربية')).toBeNull();
    expect(screen.queryByText('English')).toBeNull();
  });

  it('and the only thing that changes is the colour', () => {
    render(<MicButton getValue={() => ''} onChange={() => {}} />);
    const btn = screen.getByRole('button');
    const before = btn.style.background;
    fireEvent.click(btn);
    expect(btn.style.background).not.toBe(before);
    expect(btn.style.animation).toContain('micPulse');
  });
});

describe('the words appear WHILE you speak — this is what "fast" meant', () => {
  it('interim words reach the prompt box before the phrase is final', () => {
    // The old version showed these in a label and threw them away, so nothing
    // reached the box until the recogniser finalised — a second or more after
    // he had stopped talking. Same recogniser, same speed; the difference was
    // entirely where the words were put.
    const onChange = vi.fn();
    render(<MicButton getValue={() => ''} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button'));

    say('a red', { final: false });
    expect(onChange).toHaveBeenLastCalledWith('a red');
    say('a red car', { final: false });
    expect(onChange).toHaveBeenLastCalledWith('a red car');
  });

  it('rewrites in place as the recogniser changes its mind — never stacks', () => {
    const onChange = vi.fn();
    render(<MicButton getValue={() => ''} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button'));

    say('a red', { final: false });
    say('a bread', { final: false });        // it reconsidered
    expect(onChange).toHaveBeenLastCalledWith('a bread');
    expect(onChange).not.toHaveBeenCalledWith('a red a bread');
  });

  it('a second sentence follows the first instead of replacing it', () => {
    const onChange = vi.fn();
    render(<MicButton getValue={() => ''} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button'));

    say('a red car', { final: true });
    say('at night', { final: true });
    expect(onChange).toHaveBeenLastCalledWith('a red car at night');
  });
});

describe('☠ WHAT WAS TYPED BEFORE SPEAKING IS NEVER TOUCHED', () => {
  it('speech is appended after it, not over it', () => {
    // There is no undo on a textarea something else cleared.
    const onChange = vi.fn();
    render(<MicButton getValue={() => 'three careful lines'} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button'));

    say('and a red car', { final: false });
    expect(onChange).toHaveBeenLastCalledWith('three careful lines and a red car');
    say('and a red car', { final: true });
    expect(onChange).toHaveBeenLastCalledWith('three careful lines and a red car');
  });

  it('reads the box at the moment the microphone OPENS, not at render', () => {
    // Typed between rendering the page and pressing the button. Capturing at
    // render time would silently drop it.
    let typed = '';
    const onChange = vi.fn();
    render(<MicButton getValue={() => typed} onChange={onChange} />);
    typed = 'a mountain';

    fireEvent.click(screen.getByRole('button'));
    say('at sunrise', { final: true });
    expect(onChange).toHaveBeenLastCalledWith('a mountain at sunrise');
  });

  it('hearing nothing at all leaves the box exactly as it was', () => {
    const onChange = vi.fn();
    render(<MicButton getValue={() => 'kept'} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByRole('button'));           // stopped, silent
    onChange.mock.calls.forEach(([v]) => expect(v).toContain('kept'));
  });
});

describe('closing it does not throw away the tail', () => {
  it('the half-heard sentence is committed before the recogniser stops', () => {
    // Pressing stop the instant you finish speaking is the normal way to use
    // it. Losing that sentence is the worst possible answer to "it is slow".
    const onChange = vi.fn();
    render(<MicButton getValue={() => ''} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button'));
    say('a red car at night', { final: false });
    fireEvent.click(screen.getByRole('button'));
    expect(onChange).toHaveBeenLastCalledWith('a red car at night');
  });
});

describe('it is hidden where the browser cannot listen', () => {
  it('renders nothing rather than a button that does not work', () => {
    delete window.SpeechRecognition;
    const { container } = render(<MicButton getValue={() => ''} onChange={() => {}} />);
    expect(container.innerHTML).toBe('');
  });
});
