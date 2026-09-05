// ─── model-catalog.test.js ───────────────────────────────────────────────────
// The rule this file exists to hold: a model I could not read must NEVER be
// offered as addable. Amr asked for that explicitly, and it is the difference
// between a queue he can trust and one that quietly lies to him.

import { describe, it, expect, vi } from 'vitest';
import {
  fetchKieCatalog, buildRows, summarise, nameKey, kindOf, KNOWN_FAMILIES, DECISIONS,
} from './model-catalog.js';

const group = (over = {}) => ({
  id: 1, groupName: 'Kling 3.0', path: 'kling-3-0', count: 2,
  taskType: ['Text to Video', 'Image to Video'], provider: 'Kuaishou',
  tagline: 'a video model', ...over,
});

const reply = (data, ok = true, status = 200) => ({
  ok, status, json: async () => ({ data }),
});

describe('fetchKieCatalog', () => {
  it('follows pagination until it has them all', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(reply({ total: 104, list: Array.from({ length: 100 }, () => group()) }))
      .mockResolvedValueOnce(reply({ total: 104, list: Array.from({ length: 4 }, () => group()) }));
    const r = await fetchKieCatalog({ fetchImpl: f });
    expect(r.ok).toBe(true);
    expect(r.groups).toHaveLength(104);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('☠ REPORTS a failure instead of returning an empty list', async () => {
    // An empty list reads as "kie has no models" — a confident wrong answer.
    // Amr must see "could not reach kie" instead.
    const r = await fetchKieCatalog({ fetchImpl: vi.fn().mockResolvedValue(reply(null, false, 503)) });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('503');
  });

  it('reports a thrown network error rather than crashing the screen', async () => {
    const r = await fetchKieCatalog({ fetchImpl: vi.fn().mockRejectedValue(new Error('DNS failed')) });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('DNS failed');
  });

  it('stops when a page comes back empty', async () => {
    const f = vi.fn().mockResolvedValue(reply({ total: 999, list: [] }));
    const r = await fetchKieCatalog({ fetchImpl: f });
    expect(r.groups).toHaveLength(0);
    expect(f).toHaveBeenCalledTimes(1);   // not maxPages times
  });
});

describe('nameKey recognises the same model written two ways', () => {
  it('"Kling V2.1" and "Kling 2.1" are one model', () => {
    expect(nameKey('Kling V2.1')).toBe(nameKey('Kling 2.1'));
  });
  it('punctuation and case do not matter', () => {
    expect(nameKey('Nano-Banana Pro')).toBe(nameKey('nano banana pro'));
  });
  it('different models stay different', () => {
    expect(nameKey('Kling 2.1')).not.toBe(nameKey('Kling 3.0'));
  });
});

describe('kindOf', () => {
  it('reads the task types', () => {
    expect(kindOf(group({ taskType: ['Text to Video'] }))).toBe('video');
    expect(kindOf(group({ taskType: ['Text to Image'] }))).toBe('image');
    expect(kindOf(group({ taskType: ['Chat'] }))).toBe('chat');
    expect(kindOf(group({ taskType: [] }))).toBe('other');
  });
  it('a model doing both counts as video', () => {
    // Voxel prices video by the second; that is the harder half to get right.
    expect(kindOf(group({ taskType: ['Text to Image', 'Image to Video'] }))).toBe('video');
  });
});

describe('☠ a model I could not read is never offered', () => {
  it('cannot_read is not addable, and carries the reason', () => {
    const [row] = buildRows([group({ path: 'mystery' })], {
      readings: { mystery: { read: false, reason: 'kie returned 404 for its API page' } },
    });
    expect(row.read_state).toBe('cannot_read');
    expect(row.addable).toBe(false);
    expect(row.cannot_read_reason).toContain('404');
  });

  it('not yet read is not addable either', () => {
    const [row] = buildRows([group({ path: 'unseen' })]);
    expect(row.read_state).toBe('not_read');
    expect(row.addable).toBe(false);
  });

  it('read AND a familiar shape is addable', () => {
    const [row] = buildRows([group({ path: 'k' })], { readings: { k: { read: true, family: 'jobs' } } });
    expect(row.addable).toBe(true);
    expect(row.needs_code).toBe(false);
  });

  it('read but an UNFAMILIAR shape says needs_code and is not addable', () => {
    // "Add lands it on dev" is only true for a shape we already speak. The row
    // must say so BEFORE he clicks, not after.
    const [row] = buildRows([group({ path: 'weird' })], {
      readings: { weird: { read: true, family: 'something-new' } },
    });
    expect(row.needs_code).toBe(true);
    expect(row.addable).toBe(false);
  });

  it('every known family is genuinely accepted', () => {
    for (const family of KNOWN_FAMILIES) {
      const [row] = buildRows([group({ path: 'x' })], { readings: { x: { read: true, family } } });
      expect(row.addable, `${family} should be addable`).toBe(true);
    }
  });
});

describe('what Voxel already has, and what the owner decided', () => {
  it('marks a model we already sell — even spelled differently', () => {
    const [row] = buildRows([group({ groupName: 'Kling V3.0' })], { owned: ['Kling 3.0'] });
    expect(row.owned).toBe(true);
  });

  it('keeps my reading and his decision as separate facts', () => {
    const [row] = buildRows([group({ path: 'p' })], {
      readings: { p: { read: true, family: 'jobs' } },
      decisions: { p: { decision: 'hold', at: '2026-09-05', note: 'after the workshop' } },
    });
    expect(row.addable).toBe(true);        // mine
    expect(row.decision).toBe('hold');      // his
    expect(row.note).toBe('after the workshop');
  });

  it('ignores a decision it does not recognise', () => {
    const [row] = buildRows([group({ path: 'p' })], { decisions: { p: { decision: 'maybe' } } });
    expect(row.decision).toBe(null);
    expect(DECISIONS).not.toContain('maybe');
  });

  it('puts what needs his attention first', () => {
    const rows = buildRows(
      [group({ groupName: 'Owned', path: 'a' }), group({ groupName: 'Undecided', path: 'b' }),
       group({ groupName: 'Held', path: 'c' }), group({ groupName: 'Removed', path: 'd' })],
      { owned: ['Owned'], decisions: { c: { decision: 'hold' }, d: { decision: 'remove' } } },
    );
    expect(rows[0].name).toBe('Undecided');
    expect(rows[1].name).toBe('Held');
    expect(rows[rows.length - 1].name).toBe('Removed');
  });
});

describe('summarise', () => {
  it('counts what the top of the tab needs to say', () => {
    const rows = buildRows(
      [group({ groupName: 'A', path: 'a' }), group({ groupName: 'B', path: 'b' }),
       group({ groupName: 'C', path: 'c' }), group({ groupName: 'D', path: 'd' })],
      {
        owned: ['A'],
        decisions: { b: { decision: 'hold' } },
        readings: { c: { read: false, reason: 'no docs' }, d: { read: true, family: 'novel' } },
      },
    );
    const s = summarise(rows);
    expect(s).toMatchObject({ total: 4, owned: 1, held: 1, cannot_read: 1, needs_code: 1 });
    expect(s.undecided).toBe(2);   // C and D — neither owned nor decided
  });
});

// ─── THE SQL MUST BE CONSISTENT ABOUT ITS PARAMETER TYPES ───────────────────
// ☠ Amr pressed Add and nothing happened. Dev's log said:
//   [costing/catalog/decision] error: inconsistent types deduced for parameter $2
// The statement used $2 bare in the assignment (varchar(10)) and $2::text in
// the comparisons, and Postgres refused the whole thing. Every unit test passed
// — none of them ran SQL. This one reads the statement instead.
describe('the decision statement casts $2 the same way everywhere', () => {
  it('never mixes a bare $2 with $2::text in one statement', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const src = readFileSync(path.resolve(process.cwd(), 'server/src/costing-routes.js'), 'utf8');
    // Just the one UPDATE: from "SET decision" to its RETURNING clause.
    const from = src.indexOf('SET decision');
    expect(from, 'the decision UPDATE should exist').toBeGreaterThan(-1);
    // ☠ STRIP THE SQL COMMENTS FIRST. The first version of this test counted
    // the "$2" inside the comment EXPLAINING the fix and failed on correct
    // code — a check that cannot tell code from prose is a check that gets
    // switched off.
    const body = src.slice(from, src.indexOf('RETURNING', from))
      .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    const bare = (body.match(/\$2(?!::)/g) || []).length;
    const cast = (body.match(/\$2::text/g) || []).length;
    expect(cast, 'the casts should be there').toBeGreaterThan(0);
    expect(bare, `found ${bare} uncast $2 alongside ${cast} cast ones — Postgres will refuse this`)
      .toBe(0);
  });
});
