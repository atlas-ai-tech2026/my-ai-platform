// ─── versions.test.js ────────────────────────────────────────────────────────
// The thing that must never happen: a save point the customer believes exists
// and does not. That is worse than having no versions at all, because they
// stop keeping their own copies.
//
// So most of this file is failure. A full quota, a corrupted key, storage that
// is missing entirely, an unknown id — every one of them has to either work or
// say so, and none of them may touch the live edit.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  MAX_VERSIONS, versionsKey, listVersions, autoLabel,
  saveVersion, restoreVersion, deleteVersion, describeVersion,
} from './versions.js';

/** A localStorage that can be told to run out of room. */
function fakeStore({ failAfterBytes = Infinity } = {}) {
  const map = new Map();
  return {
    _map: map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      if (String(v).length > failAfterBytes) throw new Error('QuotaExceededError');
      map.set(k, v);
    },
  };
}

const project = (clips = 1) => ({
  tracks: [{
    id: 't1', kind: 'video', name: 'Video 1',
    clips: Array.from({ length: clips }, (_, i) => ({
      id: `c${i}`, kind: 'video', start: i * 5, in: 0, out: 5, speed: 1,
    })),
  }],
});

let storage;
beforeEach(() => { storage = fakeStore(); });

describe('taking a snapshot', () => {
  it('saves and reads back', () => {
    const r = saveVersion('p1', project(2), { storage, now: 1000, label: 'before the fast cut' });
    expect(r.ok).toBe(true);
    const list = listVersions('p1', { storage });
    expect(list).toHaveLength(1);
    expect(list[0].label).toBe('before the fast cut');
  });

  it('puts the newest FIRST — that is the one you want', () => {
    saveVersion('p1', project(1), { storage, now: 1000, id: 'a' });
    saveVersion('p1', project(2), { storage, now: 2000, id: 'b' });
    expect(listVersions('p1', { storage }).map((v) => v.id)).toEqual(['b', 'a']);
  });

  it('labels itself with the TIME when nobody names it', () => {
    // The label you can scan for "the one before lunch" without opening it.
    const at = new Date(2026, 7, 26, 14, 5).getTime();
    expect(autoLabel(at)).toBe('14:05');
  });

  it('keeps projects apart', () => {
    saveVersion('p1', project(1), { storage, now: 1 });
    saveVersion('p2', project(1), { storage, now: 2 });
    expect(listVersions('p1', { storage })).toHaveLength(1);
    expect(versionsKey('p1')).not.toBe(versionsKey('p2'));
  });

  it('caps the list, dropping the OLDEST', () => {
    for (let i = 0; i < MAX_VERSIONS + 5; i += 1) {
      saveVersion('p1', project(1), { storage, now: i + 1, id: `v${i}` });
    }
    const list = listVersions('p1', { storage });
    expect(list).toHaveLength(MAX_VERSIONS);
    expect(list[0].id).toBe(`v${MAX_VERSIONS + 4}`);      // newest kept
    expect(list.some((v) => v.id === 'v0')).toBe(false);   // oldest dropped
  });
});

describe('when there is no room', () => {
  it('prunes the oldest and succeeds rather than giving up', () => {
    // A project with many clips plus twenty snapshots can genuinely hit the
    // quota, and the oldest snapshot is the cheapest thing to give up.
    const small = fakeStore({ failAfterBytes: 900 });
    for (let i = 0; i < 12; i += 1) {
      saveVersion('p1', project(2), { storage: small, now: i + 1, id: `v${i}` });
    }
    const list = listVersions('p1', { storage: small });
    expect(list.length).toBeGreaterThan(0);
    expect(list[0].id).toBe('v11');   // the newest still made it
  });

  it('FAILS LOUDLY when even one will not fit, and says the edit is safe', () => {
    // Losing the live edit to store a snapshot of it would be an absurd way
    // to lose work. The message has to say which one survived.
    const tiny = fakeStore({ failAfterBytes: 10 });
    const r = saveVersion('p1', project(3), { storage: tiny, now: 1 });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/no room/i);
    expect(r.reason).toMatch(/edit is safe/i);
  });

  it('never half-writes — a failed save leaves what was there', () => {
    const s = fakeStore();
    saveVersion('p1', project(1), { storage: s, now: 1, id: 'keep' });
    const before = s.getItem(versionsKey('p1'));
    s.setItem = () => { throw new Error('QuotaExceededError'); };
    saveVersion('p1', project(9), { storage: s, now: 2, id: 'nope' });
    expect(s.getItem(versionsKey('p1'))).toBe(before);
  });
});

describe('coming back to one', () => {
  it('returns the project exactly as it was', () => {
    const p = project(3);
    saveVersion('p1', p, { storage, now: 1, id: 'v1' });
    expect(restoreVersion('p1', 'v1', { storage })).toEqual(p);
  });

  it('returns NULL for an id it does not know', () => {
    // A caller must never restore `undefined` over a live edit.
    expect(restoreVersion('p1', 'ghost', { storage })).toBeNull();
  });

  it('deleting one leaves the others', () => {
    saveVersion('p1', project(1), { storage, now: 1, id: 'a' });
    saveVersion('p1', project(1), { storage, now: 2, id: 'b' });
    expect(deleteVersion('p1', 'a', { storage }).map((v) => v.id)).toEqual(['b']);
  });
});

describe('surviving a broken world', () => {
  it('a corrupted key reads as no versions, not a crash', () => {
    const s = fakeStore();
    s.setItem(versionsKey('p1'), '{not json');
    expect(listVersions('p1', { storage: s })).toEqual([]);
  });

  it('a key holding the wrong SHAPE also reads as none', () => {
    const s = fakeStore();
    s.setItem(versionsKey('p1'), '"a string"');
    expect(listVersions('p1', { storage: s })).toEqual([]);
  });

  it('no storage IN THE BROWSER AT ALL is a clear refusal, not an exception', () => {
    // Private mode, or storage switched off. `{ storage: null }` is NOT this
    // case — it means "use the default", which is why my first version of this
    // test passed for the wrong reason: jsdom has a real localStorage and the
    // save genuinely worked.
    const real = globalThis.localStorage;
    try {
      // eslint-disable-next-line no-global-assign
      Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true });
      expect(listVersions('p1')).toEqual([]);
      const r = saveVersion('p1', project(1));
      expect(r.ok).toBe(false);
      expect(r.reason).toMatch(/not storing anything/i);
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { value: real, configurable: true });
    }
  });

  it('refuses to snapshot something that is not a project', () => {
    expect(saveVersion('p1', null, { storage }).ok).toBe(false);
    expect(saveVersion('p1', { nope: true }, { storage }).ok).toBe(false);
  });
});

describe('telling two snapshots apart at a glance', () => {
  it('counts the clips and the length', () => {
    const d = describeVersion({ project: project(3) });
    expect(d.clips).toBe(3);
    expect(d.summary).toMatch(/3 clips/);
  });

  it('says "1 clip", not "1 clips"', () => {
    expect(describeVersion({ project: project(1) }).summary).toMatch(/1 clip ·/);
  });

  it('survives an empty or missing project', () => {
    expect(describeVersion({ project: { tracks: [] } }).clips).toBe(0);
    expect(() => describeVersion(null)).not.toThrow();
  });
});
