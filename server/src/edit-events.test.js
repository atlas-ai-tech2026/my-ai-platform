// ─── edit-events.test.js ─────────────────────────────────────────────────────
// This table exists to answer ONE question in a month's time: does anybody
// actually edit? Everything here protects that answer from being wrong in a way
// that still looks like a number.
//
// NOT VERIFIED AGAINST A REAL POSTGRES. Previous work in this repo checked
// storage modules against PG 17 in Docker; Docker is not available on this
// machine today, so the SQL shape is asserted against a recording pool instead.
// That catches the logic and the parameters — it does not catch a syntax error
// Postgres would reject. The queries are deliberately plain for that reason,
// and the first run on dev is the real check.

import { describe, it, expect, vi } from 'vitest';

import { recordEdit, editSummary } from './edit-events.js';

/** A pool that records what it was asked, and answers with what it is told. */
const fakePool = (answers = []) => {
  const calls = [];
  let i = 0;
  return {
    calls,
    query: vi.fn(async (text, params) => {
      calls.push({ text, params });
      // CREATE TABLE / CREATE INDEX are setup, not part of the answer sequence.
      if (/^\s*CREATE/i.test(text)) return { rows: [] };
      return answers[i++] ?? { rows: [] };
    }),
  };
};

const inserts = (pool) => pool.calls.filter((c) => /INSERT INTO edit_events/.test(c.text));

describe('recordEdit', () => {
  it('stores which operations ran and how many', async () => {
    const pool = fakePool();
    await recordEdit(pool, { userId: 7, operations: ['trim', 'resize'], steps: 2 });

    const [{ params }] = inserts(pool);
    expect(params[0]).toBe(7);
    expect(params[1]).toEqual(['trim', 'resize']);
    expect(params[2]).toBe(2);
  });

  it('DROPS an operation name it does not recognise', async () => {
    // A client that starts sending something new would otherwise quietly widen
    // what this table holds, and the summary would grow a row nobody chose.
    const pool = fakePool();
    await recordEdit(pool, { userId: 1, operations: ['trim', 'exfiltrate', 'resize'], steps: 3 });
    expect(inserts(pool)[0].params[1]).toEqual(['trim', 'resize']);
  });

  it('stores NOTHING about the customer’s content', async () => {
    // Editing happens on their machine. A prompt or filename reaching this
    // table would create a record of private work for a number that does not
    // need it.
    const pool = fakePool();
    await recordEdit(pool, {
      userId: 1, operations: ['trim'], steps: 1,
      prompt: 'a private client video', url: 'https://spaces/secret.mp4',
    });
    const text = JSON.stringify(inserts(pool)[0]);
    expect(text).not.toMatch(/private client/);
    expect(text).not.toMatch(/secret\.mp4/);
  });

  it('never lets a hostile payload set an absurd step count', async () => {
    const pool = fakePool();
    await recordEdit(pool, { userId: 1, operations: ['trim'], steps: 999999 });
    expect(inserts(pool)[0].params[2]).toBeLessThanOrEqual(20);

    const pool2 = fakePool();
    await recordEdit(pool2, { userId: 1, operations: ['trim'], steps: -5 });
    expect(inserts(pool2)[0].params[2]).toBeGreaterThanOrEqual(0);
  });

  it('survives operations arriving as something other than an array', async () => {
    const pool = fakePool();
    await recordEdit(pool, { userId: 1, operations: 'trim', steps: 1 });
    expect(inserts(pool)[0].params[1]).toEqual([]);
  });
});

describe('editSummary — the Phase 2 decision', () => {
  const answer = ({ edits, people, avg = 2 }) => ([
    { rows: [{ edits, people, avg_steps: avg }] },
    { rows: [{ op: 'resize', uses: edits }] },
    { rows: [{ day: '2026-08-21', edits }] },
  ]);

  it('says plainly that nobody has edited', async () => {
    const s = await editSummary(fakePool(answer({ edits: 0, people: 0 })));
    expect(s.edits).toBe(0);
    expect(s.verdict).toMatch(/not worth buying/i);
  });

  // THE DISTINCTION THE WHOLE DECISION TURNS ON.
  it('does NOT mistake one enthusiast for demand', async () => {
    // 500 edits by one person is a hobby. Reporting only the total would make
    // it read as a product everybody wants, and buy a worker for one user.
    const s = await editSummary(fakePool(answer({ edits: 500, people: 1 })));
    expect(s.verdict).toMatch(/only 1 person/i);
    expect(s.verdict).not.toMatch(/Real usage/);
  });

  it('recognises real spread across customers', async () => {
    const s = await editSummary(fakePool(answer({ edits: 50, people: 40 })));
    expect(s.verdict).toMatch(/Real usage/);
    // The cost is restated in the unit the owner decides in — subscriptions.
    expect(s.verdict).toMatch(/Basic subscription/);
  });

  it('reports PEOPLE separately from edits, always', async () => {
    const s = await editSummary(fakePool(answer({ edits: 12, people: 5 })));
    expect(s).toMatchObject({ edits: 12, people: 5 });
    expect(s.byOperation[0]).toMatchObject({ op: 'resize' });
    expect(s.daily).toHaveLength(1);
  });

  it('windows the query by the requested number of days', async () => {
    const pool = fakePool(answer({ edits: 1, people: 1 }));
    await editSummary(pool, { days: 7 });
    const windowed = pool.calls.filter((c) => c.params?.[0] === 7);
    expect(windowed.length, 'every query must share the same window').toBe(3);
  });
});
