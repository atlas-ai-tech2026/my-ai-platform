// ─── useEditorShortcuts.test.jsx ─────────────────────────────────────────────
// Two things are being protected here, and only one of them is about editing.
//
// The first is J/K/L behaving the way three decades of muscle memory expect.
// The second is the bug every editor ships once: typing a clip name, pressing
// "c", and watching the timeline split underneath you. That one destroys work
// and it is three lines to prevent — so it is pinned first.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';

import { useEditorShortcuts, SHORTCUTS, SHUTTLE_RATES, FRAME } from './useEditorShortcuts.js';

function Harness({ handlers, enabled = true }) {
  useEditorShortcuts(handlers, { enabled });
  return (
    <div>
      <input aria-label="clip name" />
      <div contentEditable aria-label="chat" suppressContentEditableWarning />
      <button>elsewhere</button>
    </div>
  );
}

let h;
beforeEach(() => {
  h = {
    onTogglePlay: vi.fn(), onShuttle: vi.fn(), onSplit: vi.fn(),
    onMarkIn: vi.fn(), onMarkOut: vi.fn(), onStep: vi.fn(),
    onGoTo: vi.fn(), onDelete: vi.fn(), onUndo: vi.fn(), onRedo: vi.fn(),
  };
});
afterEach(cleanup);

const press = (key, opts = {}) => fireEvent.keyDown(window, { key, ...opts });

describe('THE bug — shortcuts while typing', () => {
  it('does not split the timeline when "c" is typed into a field', () => {
    render(<Harness handlers={h} />);
    fireEvent.keyDown(screen.getByLabelText('clip name'), { key: 'c' });
    expect(h.onSplit, 'typing a name split the project').not.toHaveBeenCalled();
  });

  it('ignores every editing key inside an input', () => {
    render(<Harness handlers={h} />);
    const field = screen.getByLabelText('clip name');
    for (const key of ['c', 'i', 'o', 'j', 'k', 'l', ' ', 'Delete', 'Backspace']) {
      fireEvent.keyDown(field, { key });
    }
    for (const [name, fn] of Object.entries(h)) {
      expect(fn, `${name} fired while typing`).not.toHaveBeenCalled();
    }
  });

  it('ignores them inside a contentEditable — the agent chat is one', () => {
    render(<Harness handlers={h} />);
    fireEvent.keyDown(screen.getByLabelText('chat'), { key: 'c' });
    expect(h.onSplit).not.toHaveBeenCalled();
  });

  it('DOES fire when focus is anywhere else', () => {
    render(<Harness handlers={h} />);
    fireEvent.keyDown(screen.getByText('elsewhere'), { key: 'c' });
    expect(h.onSplit).toHaveBeenCalled();
  });
});

describe('J K L — the muscle memory', () => {
  it('L goes forward, and again goes faster', () => {
    render(<Harness handlers={h} />);
    press('l'); press('l'); press('l');
    expect(h.onShuttle.mock.calls.map((c) => c[0])).toEqual([1, 2, 4]);
  });

  it('J does the same in reverse', () => {
    render(<Harness handlers={h} />);
    press('j'); press('j');
    expect(h.onShuttle.mock.calls.map((c) => c[0])).toEqual([-1, -2]);
  });

  it('K stops', () => {
    render(<Harness handlers={h} />);
    press('l'); press('l'); press('k');
    expect(h.onShuttle).toHaveBeenLastCalledWith(0);
  });

  it('reversing direction returns to 1x first, it does not jump to 4x', () => {
    // Pressing L three times then J must go to -1, not -8. Every NLE does this,
    // and jumping straight to full reverse speed is the thing that would feel
    // wrong in the hand without being easy to name.
    render(<Harness handlers={h} />);
    press('l'); press('l'); press('l');
    h.onShuttle.mockClear();
    press('j');
    expect(h.onShuttle).toHaveBeenCalledWith(-1);
  });

  it('never exceeds the fastest rate however many times it is pressed', () => {
    render(<Harness handlers={h} />);
    for (let i = 0; i < 20; i += 1) press('l');
    const fastest = Math.max(...h.onShuttle.mock.calls.map((c) => c[0]));
    expect(fastest).toBe(SHUTTLE_RATES[SHUTTLE_RATES.length - 1]);
  });

  it('Space stops the shuttle as well as toggling play', () => {
    render(<Harness handlers={h} />);
    press('l'); press('l');
    press(' ');
    h.onShuttle.mockClear();
    press('l');
    expect(h.onShuttle, 'the shuttle should restart from 1x').toHaveBeenCalledWith(1);
  });
});

describe('stepping and navigation', () => {
  it('arrows move one frame, shift-arrows one second', () => {
    render(<Harness handlers={h} />);
    press('ArrowRight');
    expect(h.onStep).toHaveBeenLastCalledWith(FRAME);
    press('ArrowLeft', { shiftKey: true });
    expect(h.onStep).toHaveBeenLastCalledWith(-1);
  });

  it('Home and End go to the ends', () => {
    render(<Harness handlers={h} />);
    press('Home'); expect(h.onGoTo).toHaveBeenLastCalledWith('start');
    press('End'); expect(h.onGoTo).toHaveBeenLastCalledWith('end');
  });
});

describe('undo and redo', () => {
  it('Cmd+Z undoes, Shift+Cmd+Z redoes', () => {
    render(<Harness handlers={h} />);
    press('z', { metaKey: true });
    expect(h.onUndo).toHaveBeenCalled();
    press('z', { metaKey: true, shiftKey: true });
    expect(h.onRedo).toHaveBeenCalled();
  });

  it('Cmd+Z does NOT also trigger a plain-letter action', () => {
    // Handling single letters before the modifier check is how Cmd+C ends up
    // splitting the timeline instead of copying.
    render(<Harness handlers={h} />);
    press('c', { metaKey: true });
    expect(h.onSplit, 'Cmd+C split the timeline').not.toHaveBeenCalled();
  });
});

describe('being switched off', () => {
  it('listens to nothing when disabled — a modal must not drive the timeline', () => {
    render(<Harness handlers={h} enabled={false} />);
    press('c'); press('l'); press(' ');
    expect(h.onSplit).not.toHaveBeenCalled();
    expect(h.onShuttle).not.toHaveBeenCalled();
    expect(h.onTogglePlay).not.toHaveBeenCalled();
  });

  it('a missing handler is silence, not a crash', () => {
    render(<Harness handlers={{}} />);
    expect(() => { press('c'); press('l'); press('Delete'); }).not.toThrow();
  });
});

describe('the help list cannot drift from the handler', () => {
  it('documents every key the handler actually implements', () => {
    const documented = SHORTCUTS.map(([k]) => k).join(' ').toLowerCase();
    for (const key of ['space', 'j', 'k', 'l', 'c', 'i', 'o', 'home', 'end', 'delete']) {
      expect(documented, `${key} is implemented but undocumented`).toContain(key);
    }
  });
});
