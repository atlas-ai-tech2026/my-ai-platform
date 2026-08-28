// ─── library-bins.test.js ────────────────────────────────────────────────────
// Folders for the library.
//
// Two properties matter more than the rest, and most of these tests are one or
// the other:
//
//   1. DELETING A FOLDER NEVER DELETES WORK. A bin holds ids. "Delete" on a
//      folder full of pictures is the most frightening button in the panel,
//      and it has to be as harmless as it looks.
//   2. A CORRUPT VALUE DEGRADES TO "NO FOLDERS", NEVER TO A CRASH. The library
//      is the customer's own history; refusing to render it because a folder
//      name is malformed would be a terrible trade.

import { describe, it, expect } from 'vitest';
import {
  emptyBins, loadBins, saveBins, createBin, renameBin, removeBin,
  addToBin, removeFromBin, binsHolding, recordsInBin, countInBin,
  BINS_KEY, MAX_BINS, MAX_NAME,
} from './library-bins.js';

/** A localStorage that can be told to misbehave. */
function store(initial) {
  let v = initial;
  return {
    getItem: () => v,
    setItem: (_k, next) => { v = next; },
    read: () => v,
  };
}
const throwing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };

const withBin = (name = 'Workshop') => createBin(emptyBins(), name).state;
const recs = (...ids) => ids.map((id) => ({ id, prompt: `p${id}` }));

describe('PROPERTY 1 — a folder never holds the work itself', () => {
  it('deleting a folder leaves every generation alone', () => {
    let s = withBin();
    const id = s.bins[0].id;
    s = addToBin(s, id, 'g1').state;
    s = addToBin(s, id, 'g2').state;

    const records = recs('g1', 'g2', 'g3');
    s = removeBin(s, id).state;

    expect(s.bins).toHaveLength(0);
    // The library is untouched — this is the whole point.
    expect(records).toHaveLength(3);
  });

  it('a folder stores ids, not copies — so a renamed prompt is never stale', () => {
    let s = withBin();
    s = addToBin(s, s.bins[0].id, 'g1').state;
    expect(s.bins[0].items).toEqual(['g1']);
    expect(JSON.stringify(s)).not.toContain('prompt');
  });

  it('an id whose generation is gone simply does not appear', () => {
    // Self-healing: a deleted generation should not leave a hole to tidy up.
    let s = withBin();
    s = addToBin(s, s.bins[0].id, 'g1').state;
    s = addToBin(s, s.bins[0].id, 'deleted-one').state;
    expect(recordsInBin(s, s.bins[0].id, recs('g1', 'g2'))).toHaveLength(1);
  });

  it('the count on the chip matches what opening it shows', () => {
    // A chip saying 5 that opens on 3 is a chip that lies.
    let s = withBin();
    for (const id of ['g1', 'g2', 'gone']) s = addToBin(s, s.bins[0].id, id).state;
    const records = recs('g1', 'g2');
    expect(countInBin(s, s.bins[0].id, records)).toBe(recordsInBin(s, s.bins[0].id, records).length);
  });
});

describe('PROPERTY 2 — bad storage degrades, never crashes', () => {
  it('returns no folders when there is nothing stored', () => {
    expect(loadBins(store(null))).toEqual(emptyBins());
  });

  it('survives junk', () => {
    for (const junk of ['{', 'null', '[]', '{"bins":"nope"}', '{"bins":[null,3]}']) {
      expect(() => loadBins(store(junk))).not.toThrow();
      expect(loadBins(store(junk)).bins).toEqual([]);
    }
  });

  it('survives storage that throws — private mode is not worth breaking over', () => {
    expect(loadBins(throwing)).toEqual(emptyBins());
    expect(() => saveBins(emptyBins(), throwing)).not.toThrow();
  });

  it('drops a malformed folder rather than the whole set', () => {
    const raw = JSON.stringify({ bins: [{ id: 'b1', name: 'Good', items: ['g1'] }, { name: 'no id' }] });
    const out = loadBins(store(raw));
    expect(out.bins).toHaveLength(1);
    expect(out.bins[0].name).toBe('Good');
  });

  it('de-duplicates ids on READ as well as on write', () => {
    const raw = JSON.stringify({ bins: [{ id: 'b1', name: 'A', items: ['g1', 'g1', 'g2'] }] });
    expect(loadBins(store(raw)).bins[0].items).toEqual(['g1', 'g2']);
  });

  it('round-trips through storage', () => {
    const st = store(null);
    let s = withBin('Client brand');
    s = addToBin(s, s.bins[0].id, 'g7').state;
    saveBins(s, st);
    expect(loadBins(st)).toEqual(s);
  });
});

describe('making and naming folders', () => {
  it('creates one', () => {
    const r = createBin(emptyBins(), 'Workshop Tuesday');
    expect(r.ok).toBe(true);
    expect(r.state.bins[0]).toMatchObject({ name: 'Workshop Tuesday', items: [] });
  });

  it('refuses an empty name, and says why', () => {
    for (const n of ['', '   ', null]) {
      const r = createBin(emptyBins(), n);
      expect(r.ok).toBe(false);
      expect(r.reason).toMatch(/name/i);
    }
  });

  it('refuses a duplicate name, whatever the capitals', () => {
    const r = createBin(withBin('Workshop'), 'workshop');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/already/i);
  });

  it('stops at the limit rather than growing a second navigation problem', () => {
    let s = emptyBins();
    for (let i = 0; i < MAX_BINS; i += 1) s = createBin(s, `f${i}`).state;
    const r = createBin(s, 'one more');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(new RegExp(String(MAX_BINS)));
  });

  it('trims a very long name instead of refusing it', () => {
    const s = createBin(emptyBins(), 'x'.repeat(200)).state;
    expect(s.bins[0].name).toHaveLength(MAX_NAME);
  });

  it('renames, and still refuses a clash', () => {
    let s = withBin('A');
    s = createBin(s, 'B').state;
    expect(renameBin(s, s.bins[0].id, 'B').ok).toBe(false);
    const ok = renameBin(s, s.bins[0].id, 'C');
    expect(ok.ok).toBe(true);
    expect(ok.state.bins[0].name).toBe('C');
  });

  it('lets a folder keep its own name when renamed to itself', () => {
    const s = withBin('A');
    expect(renameBin(s, s.bins[0].id, 'A').ok).toBe(true);
  });
});

describe('filing things', () => {
  it('adds and removes', () => {
    let s = withBin();
    const id = s.bins[0].id;
    s = addToBin(s, id, 'g1').state;
    expect(s.bins[0].items).toEqual(['g1']);
    s = removeFromBin(s, id, 'g1').state;
    expect(s.bins[0].items).toEqual([]);
  });

  it('filing the same thing twice changes nothing', () => {
    let s = withBin();
    const id = s.bins[0].id;
    s = addToBin(s, id, 'g1').state;
    const again = addToBin(s, id, 'g1');
    expect(again.already).toBe(true);
    expect(again.state.bins[0].items).toEqual(['g1']);
  });

  it('refuses to file into a folder that is gone, rather than inventing one', () => {
    expect(addToBin(emptyBins(), 'nope', 'g1').ok).toBe(false);
  });

  it('one generation can be in several folders', () => {
    let s = withBin('A');
    s = createBin(s, 'B').state;
    s = addToBin(s, s.bins[0].id, 'g1').state;
    s = addToBin(s, s.bins[1].id, 'g1').state;
    expect(binsHolding(s, 'g1').map((b) => b.name)).toEqual(['A', 'B']);
  });

  it('removing from one folder leaves the other alone', () => {
    let s = withBin('A');
    s = createBin(s, 'B').state;
    s = addToBin(s, s.bins[0].id, 'g1').state;
    s = addToBin(s, s.bins[1].id, 'g1').state;
    s = removeFromBin(s, s.bins[0].id, 'g1').state;
    expect(binsHolding(s, 'g1').map((b) => b.name)).toEqual(['B']);
  });
});

describe('what a folder shows', () => {
  it('keeps the LIBRARY order, not the order things were filed', () => {
    // A folder that reshuffles itself as you file things reads as broken.
    let s = withBin();
    const id = s.bins[0].id;
    s = addToBin(s, id, 'g3').state;
    s = addToBin(s, id, 'g1').state;
    expect(recordsInBin(s, id, recs('g1', 'g2', 'g3')).map((r) => r.id)).toEqual(['g1', 'g3']);
  });

  it('an unknown folder shows nothing rather than everything', () => {
    // Failing open here would show the customer their entire history under a
    // folder they did not open.
    expect(recordsInBin(withBin(), 'nope', recs('g1'))).toEqual([]);
  });

  it('does not throw on missing records', () => {
    const s = withBin();
    for (const bad of [null, undefined, []]) {
      expect(() => recordsInBin(s, s.bins[0].id, bad)).not.toThrow();
    }
  });
});

describe('the key it stores under', () => {
  it('is namespaced with the editor’s other remembered settings', () => {
    expect(BINS_KEY).toMatch(/^voxel\./);
  });
});
