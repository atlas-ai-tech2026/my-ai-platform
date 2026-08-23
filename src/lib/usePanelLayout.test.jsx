// ─── usePanelLayout.test.jsx ─────────────────────────────────────────────────
// The test that matters here is "coming back gives you what you had".
//
// Everything else is bookkeeping. That one is the difference between a control
// people use and one they try twice and stop trusting, because it quietly
// rearranged a workspace they had set up deliberately.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import React from 'react';

import { usePanelLayout, readLayout, LAYOUT_KEY } from './usePanelLayout.js';

function fakeStorage(initial) {
  const map = new Map(initial ? [[LAYOUT_KEY, JSON.stringify(initial)]] : []);
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
  };
}

/** Grab the hook's value so a test can drive it directly. */
function mount(storage) {
  const api = {};
  function Probe() {
    Object.assign(api, usePanelLayout({ storage }));
    return null;
  }
  render(<Probe />);
  return api;
}

afterEach(cleanup);

describe('coming back gives you what you had', () => {
  it('restores ONLY the panel that was open', () => {
    // Somebody works with the shot panel closed. They press the key to look at
    // the picture, then press it again. Opening both would hand them back a
    // panel they deliberately closed.
    const api = mount(fakeStorage({ left: false, middle: true }));
    expect(api.left).toBe(false);
    expect(api.middle).toBe(true);

    act(() => api.focusViewer());
    expect(api.focused).toBe(true);
    expect(api.left).toBe(false);
    expect(api.middle).toBe(false);

    act(() => api.focusViewer());
    expect(api.left, 'it reopened a panel that was deliberately closed').toBe(false);
    expect(api.middle).toBe(true);
  });

  it('opens both when they were both closed by hand first', () => {
    // Nothing was remembered, so there is nothing to give back. Both is the
    // only sensible answer — the alternative is a key that appears dead.
    const api = mount(fakeStorage({ left: false, middle: false }));
    act(() => api.focusViewer());
    expect(api.left).toBe(true);
    expect(api.middle).toBe(true);
  });

  it('a manual toggle makes the remembered state stale, not wrong', () => {
    const api = mount(fakeStorage({ left: true, middle: true }));
    act(() => api.focusViewer());        // remembers both open
    act(() => api.toggleLeft());         // …then they open one by hand
    expect(api.left).toBe(true);
    act(() => api.focusViewer());        // collapses again from here
    expect(api.focused).toBe(true);
    act(() => api.focusViewer());
    expect(api.left).toBe(true);
    expect(api.middle).toBe(false);      // exactly the state before the collapse
  });
});

describe('the toggles', () => {
  it('flip one panel at a time', () => {
    const api = mount(fakeStorage());
    expect(api.left).toBe(true);
    act(() => api.toggleLeft());
    expect(api.left).toBe(false);
    expect(api.middle, 'toggling one moved the other').toBe(true);
    act(() => api.toggleMiddle());
    expect(api.middle).toBe(false);
  });

  it('focused is true only when BOTH are closed', () => {
    const api = mount(fakeStorage());
    act(() => api.toggleLeft());
    expect(api.focused).toBe(false);
    act(() => api.toggleMiddle());
    expect(api.focused).toBe(true);
  });
});

describe('it is remembered', () => {
  it('writes the layout so it survives the next session', () => {
    // Having to re-collapse every time is exactly what stops anyone bothering.
    const storage = fakeStorage();
    const api = mount(storage);
    act(() => api.toggleMiddle());
    expect(JSON.parse(storage.map.get(LAYOUT_KEY))).toEqual({ left: true, middle: false });
  });

  it('reads it back on the next load', () => {
    const api = mount(fakeStorage({ left: false, middle: true }));
    expect(api.left).toBe(false);
  });
});

describe('a bad or missing preference opens normally', () => {
  it('opens both when nothing is stored', () => {
    expect(readLayout(fakeStorage())).toEqual({ left: true, middle: true });
  });

  it('opens both on unparseable JSON', () => {
    const s = fakeStorage();
    s.setItem(LAYOUT_KEY, '{not json');
    expect(readLayout(s)).toEqual({ left: true, middle: true });
  });

  it('ignores values of the wrong type rather than blanking a panel', () => {
    const s = fakeStorage();
    s.setItem(LAYOUT_KEY, JSON.stringify({ left: 'yes', middle: null }));
    expect(readLayout(s)).toEqual({ left: true, middle: true });
  });

  it('survives storage that is not there at all', () => {
    // Blocked cookies THROW on the property read. A layout preference must
    // never be the reason the editor fails to open.
    expect(readLayout(null)).toEqual({ left: true, middle: true });
    const api = mount(null);
    expect(api.left).toBe(true);
    expect(() => act(() => api.toggleLeft())).not.toThrow();
  });

  it('a storage that throws on write does not break the toggle', () => {
    const s = { getItem: () => null, setItem: () => { throw new Error('blocked'); } };
    const api = mount(s);
    expect(() => act(() => api.toggleLeft())).not.toThrow();
    expect(api.left).toBe(false);
  });
});
