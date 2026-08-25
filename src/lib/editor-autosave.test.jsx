// ─── editor-autosave.test.jsx ────────────────────────────────────────────────
// Autosave is easy to write and easy to get wrong in ways that only show up on
// somebody else's machine. Every failure path here is one that cannot be
// reproduced by using the editor normally, which is exactly why they need a
// test rather than a look.
//
// The one to read first is "the id collision" — that bug is CREATED by adding
// autosave, and it corrupts work silently, minutes later, on a second session.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import React from 'react';

import {
  saveProject, loadProject, setAside, clearProject, useAutosave,
  AUTOSAVE_KEY, SAVE_DELAY, explain,
} from './editor-autosave.js';
import {
  createProject, createClip, addClip, removeClip, __resetIds, seedIdsFrom, SCHEMA_VERSION,
} from './timeline.js';

/** A localStorage that behaves, and can be told to misbehave. */
function fakeStorage(opts = {}) {
  const map = new Map();
  return {
    map,
    getItem: (k) => {
      if (opts.throwOnRead) throw new Error('read blocked');
      return map.has(k) ? map.get(k) : null;
    },
    setItem: (k, v) => {
      if (opts.throwOnWrite) {
        const e = new Error(opts.throwOnWrite === 'quota' ? 'exceeded the quota' : 'blocked');
        e.name = opts.throwOnWrite === 'quota' ? 'QuotaExceededError' : 'SecurityError';
        throw e;
      }
      map.set(k, v);
    },
    removeItem: (k) => map.delete(k),
  };
}

function demo() {
  __resetIds();
  let p = createProject({ name: 'Demo' });
  const v = p.tracks[0].id;
  p = addClip(p, v, createClip({ kind: 'video', sourceId: 's', name: 'one', start: 0, in: 0, out: 5 }));
  p = addClip(p, v, createClip({ kind: 'video', sourceId: 's', name: 'two', start: 6, in: 0, out: 5 }));
  return p;
}

let errSpy;
beforeEach(() => { errSpy = vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { errSpy.mockRestore(); cleanup(); vi.useRealTimers(); });

// ─────────────────────────────────────────────────────────────────────────────
describe('the id collision — the bug autosave CREATES', () => {
  it('a clip added after a restore does not steal an existing id', () => {
    const storage = fakeStorage();
    const project = demo();
    const existing = project.tracks[0].clips.map((c) => c.id);
    saveProject(project, { storage });

    // A page reload: the module counter goes back to zero.
    __resetIds();

    const restored = loadProject({ storage });
    expect(restored.ok).toBe(true);

    const fresh = createClip({ kind: 'video', sourceId: 's', start: 20, in: 0, out: 2 });
    expect(existing, `new clip reused the id ${fresh.id} — deletes and splits would hit the wrong clip`)
      .not.toContain(fresh.id);
  });

  it('proves the damage: without seeding, ONE delete removes TWO clips', () => {
    // What the bug looks like from the outside, and why it would never be
    // reported accurately: nothing throws, and a clip nobody touched vanishes.
    //
    // Note it does NOT collide on the first clip added after a reload —
    // createProject spends ids 1 and 2 on the two default tracks, so clips
    // start at c3 while the counter restarts at c1. It takes a third addition.
    // That delay is the whole danger: it survives a demo and bites in week two.
    const project = demo();
    const existing = new Set(project.tracks[0].clips.map((c) => c.id));
    __resetIds();                       // reload, WITHOUT seedIdsFrom

    let p = project;
    let collider = null;
    for (let i = 0; i < 6 && !collider; i += 1) {
      const c = createClip({ kind: 'video', sourceId: 's', name: `new${i}`, start: 20 + i * 3, in: 0, out: 2 });
      if (existing.has(c.id)) collider = c;
      p = addClip(p, p.tracks[0].id, c);
    }
    expect(collider, 'no id was reused — the collision is gone and this test is obsolete').toBeTruthy();

    const before = p.tracks[0].clips.length;
    p = removeClip(p, collider.id);
    expect(p.tracks[0].clips.length, 'deleting one clip should remove exactly one').toBe(before - 2);
  });

  it('and with seeding, that same delete removes exactly one', () => {
    const storage = fakeStorage();
    saveProject(demo(), { storage });
    __resetIds();
    let p = loadProject({ storage }).project;   // seeds the counter

    for (let i = 0; i < 6; i += 1) {
      p = addClip(p, p.tracks[0].id,
        createClip({ kind: 'video', sourceId: 's', name: `new${i}`, start: 20 + i * 3, in: 0, out: 2 }));
    }
    const ids = p.tracks[0].clips.map((c) => c.id);
    expect(new Set(ids).size, 'a duplicate id survived the restore').toBe(ids.length);

    const before = p.tracks[0].clips.length;
    p = removeClip(p, ids[0]);
    expect(p.tracks[0].clips.length).toBe(before - 1);
  });

  it('seedIdsFrom moves the counter past the highest id in the document', () => {
    const project = demo();
    __resetIds();
    const seeded = seedIdsFrom(project);
    expect(seeded).toBeGreaterThanOrEqual(4);   // 2 tracks + 2 clips
  });

  it('is not fooled by a source key that merely looks like an id', () => {
    // Source ids are caller-supplied ('racing', a generation uuid). Parsing
    // those as base-36 would shove the counter into the billions.
    const project = demo();
    project.sources = { racing: { id: 'racing', url: '/a.mp4' } };
    __resetIds();
    expect(seedIdsFrom(project)).toBeLessThan(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('a round trip', () => {
  it('saves and restores the project unchanged', () => {
    const storage = fakeStorage();
    const project = demo();
    expect(saveProject(project, { storage }).ok).toBe(true);
    const out = loadProject({ storage });
    expect(out.ok).toBe(true);
    expect(out.project).toEqual(project);
    expect(out.savedAt).toBeGreaterThan(0);
  });

  it('an empty store is "empty", not an error', () => {
    const out = loadProject({ storage: fakeStorage() });
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('empty');
  });

  it('clearProject removes it', () => {
    const storage = fakeStorage();
    saveProject(demo(), { storage });
    clearProject({ storage });
    expect(loadProject({ storage }).reason).toBe('empty');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('failures the customer must be TOLD about', () => {
  it('a full quota is reported, not swallowed', () => {
    const r = saveProject(demo(), { storage: fakeStorage({ throwOnWrite: 'quota' }) });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('quota');
    expect(r.message).toMatch(/Export before you close/i);
    expect(errSpy, 'a failed save must reach the console too').toHaveBeenCalled();
  });

  it('blocked storage is reported', () => {
    const r = saveProject(demo(), { storage: fakeStorage({ throwOnWrite: 'blocked' }) });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('no-storage');
  });

  it('no storage at all is reported rather than throwing', () => {
    const r = saveProject(demo(), { storage: null });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('no-storage');
    expect(loadProject({ storage: null }).reason).toBe('no-storage');
  });

  it('a read that throws does not take the editor down', () => {
    const out = loadProject({ storage: fakeStorage({ throwOnRead: true }) });
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('no-storage');
  });

  it('every reason has a sentence a person can act on', () => {
    for (const reason of ['no-storage', 'quota', 'corrupt', 'future-schema', 'empty']) {
      expect(explain(reason).length, `${reason} has no message`).toBeGreaterThan(10);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('a damaged save is kept, not destroyed', () => {
  it('unparseable JSON reports corrupt and hands back the raw bytes', () => {
    const storage = fakeStorage();
    storage.setItem(AUTOSAVE_KEY, '{not json at all');
    const out = loadProject({ storage });
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('corrupt');
    expect(out.raw).toBe('{not json at all');
  });

  it('valid JSON that is not a project is corrupt too', () => {
    const storage = fakeStorage();
    storage.setItem(AUTOSAVE_KEY, JSON.stringify({ schema: 1, project: { name: 'x' } }));
    expect(loadProject({ storage }).reason).toBe('corrupt');
  });

  it('setAside moves it out of the way instead of deleting it', () => {
    const storage = fakeStorage();
    storage.setItem(AUTOSAVE_KEY, '{broken');
    const where = setAside('{broken', { storage });
    expect(where).toBe(`${AUTOSAVE_KEY}:unreadable`);
    expect(storage.map.get(where), 'the only copy of their project was thrown away').toBe('{broken');
    expect(storage.map.has(AUTOSAVE_KEY)).toBe(false);
  });

  it('if it cannot be moved it is LEFT ALONE, not removed', () => {
    // Removing after a failed rescue is the one outcome worse than not trying.
    const storage = fakeStorage({ throwOnWrite: 'quota' });
    storage.map.set(AUTOSAVE_KEY, '{broken');
    expect(setAside('{broken', { storage })).toBe(null);
    expect(storage.map.get(AUTOSAVE_KEY)).toBe('{broken');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('a newer schema is refused, not half-read', () => {
  it('refuses a document from a newer deployment', () => {
    const storage = fakeStorage();
    storage.setItem(AUTOSAVE_KEY, JSON.stringify({
      schema: SCHEMA_VERSION + 1, savedAt: 1, project: demo(),
    }));
    const out = loadProject({ storage });
    expect(out.ok, 'old code read a newer document and would save a truncated copy back').toBe(false);
    expect(out.reason).toBe('future-schema');
    expect(out.message).toMatch(/newer version/i);
  });

  it('accepts the current schema', () => {
    const storage = fakeStorage();
    saveProject(demo(), { storage });
    expect(loadProject({ storage }).ok).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
function Harness({ project, storage, enabled = true, onState }) {
  const state = useAutosave(project, { storage, enabled });
  onState?.(state);
  return <span data-testid="status">{state.status}</span>;
}

describe('the hook', () => {
  it('debounces — a drag is one write, not sixty', () => {
    vi.useFakeTimers();
    const storage = fakeStorage();
    const spy = vi.spyOn(storage, 'setItem');
    const { rerender } = render(<Harness project={demo()} storage={storage} />);
    for (let i = 0; i < 20; i += 1) {
      rerender(<Harness project={{ ...demo(), name: `v${i}` }} storage={storage} />);
    }
    expect(spy).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(SAVE_DELAY + 50); });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('reports saved, with a time', () => {
    vi.useFakeTimers();
    let last;
    render(<Harness project={demo()} storage={fakeStorage()} onState={(s) => { last = s; }} />);
    act(() => { vi.advanceTimersByTime(SAVE_DELAY + 50); });
    expect(last.status).toBe('saved');
    expect(last.at).toBeGreaterThan(0);
  });

  it('surfaces a quota failure in the status, so the UI can say so', () => {
    vi.useFakeTimers();
    let last;
    render(<Harness project={demo()} storage={fakeStorage({ throwOnWrite: 'quota' })} onState={(s) => { last = s; }} />);
    act(() => { vi.advanceTimersByTime(SAVE_DELAY + 50); });
    expect(last.status).toBe('error');
    expect(last.error).toMatch(/no room left/i);
  });

  it('does nothing when disabled', () => {
    vi.useFakeTimers();
    const storage = fakeStorage();
    const spy = vi.spyOn(storage, 'setItem');
    render(<Harness project={demo()} storage={storage} enabled={false} />);
    act(() => { vi.advanceTimersByTime(SAVE_DELAY * 3); });
    expect(spy).not.toHaveBeenCalled();
  });

  it('flushes on pagehide — the debounce window must not eat the last edit', () => {
    // Closing the tab within SAVE_DELAY of the last change is the exact window
    // a debounce creates, and the exact moment autosave is supposed to help.
    vi.useFakeTimers();
    const storage = fakeStorage();
    render(<Harness project={demo()} storage={storage} />);
    expect(storage.map.has(AUTOSAVE_KEY)).toBe(false);
    act(() => { window.dispatchEvent(new Event('pagehide')); });
    expect(storage.map.has(AUTOSAVE_KEY), 'the last edit was lost to the debounce').toBe(true);
  });

  it('saveNow writes immediately', () => {
    vi.useFakeTimers();
    let last;
    const storage = fakeStorage();
    render(<Harness project={demo()} storage={storage} onState={(s) => { last = s; }} />);
    act(() => { last.saveNow(); });
    expect(storage.map.has(AUTOSAVE_KEY)).toBe(true);
  });
});
