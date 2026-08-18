// ─── tasks.test.js ───────────────────────────────────────────────────────────
// The board is the single source of truth for what is outstanding, so the ways
// it can betray you are: losing a task, duplicating one, or silently undoing a
// status the owner already set.

import { describe, it, expect, vi } from 'vitest';
import { sortTasks, summarise, validate, upsertTask, setStatus, OWNERS, STATUSES } from './tasks.js';
import { SEED } from './tasks-seed.js';

describe('ordering — what needs doing, in the order to do it', () => {
  const rows = [
    { id: 1, status: 'done', priority: 1, done_at: '2026-08-18T10:00:00Z' },
    { id: 2, status: 'pending', priority: 50 },
    { id: 3, status: 'in_progress', priority: 90 },
    { id: 4, status: 'blocked', priority: 10 },
    { id: 5, status: 'pending', priority: 20 },
  ];

  it('puts what is being done first, finished work last', () => {
    expect(sortTasks(rows).map((r) => r.id)).toEqual([3, 4, 5, 2, 1]);
  });

  it('orders waiting work by priority, not by id', () => {
    const out = sortTasks(rows).filter((r) => r.status === 'pending');
    expect(out.map((r) => r.priority)).toEqual([20, 50]);
  });
});

describe('the summary the owner reads at a glance', () => {
  it('counts each side separately', () => {
    const s = summarise([
      { owner: 'owner', status: 'pending' }, { owner: 'owner', status: 'done' },
      { owner: 'claude', status: 'pending' }, { owner: 'claude', status: 'blocked' },
    ]);
    expect(s.owner).toEqual({ pending: 1, blocked: 0, done: 1 });
    expect(s.claude).toEqual({ pending: 1, blocked: 1, done: 0 });
    expect(s.open).toBe(3);
  });
});

describe('validation', () => {
  it('needs a title', () => {
    expect(validate({ title: '' }).ok).toBe(false);
    expect(validate({ title: '   ' }).ok).toBe(false);
  });
  it('only accepts known owners and statuses', () => {
    expect(validate({ title: 'x', owner: 'someone' }).ok).toBe(false);
    expect(validate({ title: 'x', status: 'maybe' }).ok).toBe(false);
    expect(validate({ title: 'x', owner: 'owner', status: 'blocked' }).ok).toBe(true);
  });
});

describe('SQL parameter reuse — the bug that killed the first seed', () => {
  // Postgres could not deduce a type for a placeholder used BOTH as a column
  // value and inside a comparison: "inconsistent types deduced for parameter
  // $6". node --check cannot see SQL, and no unit test would have run it.
  // THE RULE, learned the hard way: a placeholder may appear more than once
  // ONLY if every occurrence carries the SAME explicit cast. Used once as a
  // column value and once bare in a comparison, Postgres deduces varchar from
  // the column and text from the comparison and refuses. Adding ::text to just
  // one side does not help — it makes the conflict explicit.
  it('never leaves a re-used parameter without a consistent cast', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ id: 1 }] }) };
    await upsertTask(pool, { ref: '1', title: 'x', status: 'done' });
    await upsertTask(pool, { title: 'y', status: 'pending' });
    await setStatus(pool, 1, 'done');

    for (const [sql] of pool.query.mock.calls) {
      const q = String(sql);
      if (!/INSERT INTO tasks|UPDATE tasks/.test(q)) continue;
      const uses = {};
      for (const m of q.matchAll(/\$(\d+)(::[a-z]+)?/g)) {
        (uses[m[1]] ||= []).push(m[2] || '');
      }
      for (const [n, casts] of Object.entries(uses)) {
        if (casts.length < 2) continue;
        expect(new Set(casts).size,
          `$${n} appears ${casts.length} times with different casts: ${JSON.stringify(casts)}`).toBe(1);
        expect(casts[0], `$${n} is re-used with no cast at all`).not.toBe('');
      }
    }
  });

  it('passes exactly as many arguments as the query has placeholders', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ id: 1 }] }) };
    await upsertTask(pool, { title: 'no ref', status: 'pending' });
    const [sql, args] = pool.query.mock.calls.at(-1);
    const highest = Math.max(...[...String(sql).matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
    expect(args.length).toBe(highest);
  });
});

describe('the seed', () => {
  it('carries the whole history, not just the backlog', () => {
    expect(SEED.length).toBeGreaterThan(50);
    expect(SEED.filter((t) => t.status === 'done').length).toBeGreaterThan(25);
  });

  it('has no duplicate references — a duplicate is a task counted twice', () => {
    const refs = SEED.map((t) => t.ref);
    expect(refs.filter((r, i) => refs.indexOf(r) !== i)).toEqual([]);
  });

  it('uses only valid owners and statuses', () => {
    for (const t of SEED) {
      expect(OWNERS, t.ref).toContain(t.owner);
      expect(STATUSES, t.ref).toContain(t.status);
    }
  });

  // A blocked task with no stated reason is one nobody wants to look at.
  it('says what is blocking every blocked task', () => {
    for (const t of SEED.filter((x) => x.status === 'blocked')) {
      expect(t.blocked_by, `${t.ref} is blocked by nothing stated`).toBeTruthy();
    }
  });

  // The owner pushed back that tasks were missing, and was right — I had
  // folded some into others. A task merged into another stops being tracked.
  it('includes the ones I had folded away', () => {
    const refs = SEED.map((t) => t.ref);
    for (const r of ['18', '20', '28', '31', '32']) expect(refs, `#${r} missing`).toContain(r);
  });
});

// Third attempt at this one query, so the rule is written down as a test.
// `ON CONFLICT (col)` matches a PARTIAL unique index only if the statement
// repeats the same WHERE clause. It is far easier to keep the index plain.
describe('ON CONFLICT must match the index that exists', () => {
  it('creates a NON-partial unique index for the column it conflicts on', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const { ensureTasksTable } = await import('./tasks.js');
    await ensureTasksTable(pool);
    const ddl = pool.query.mock.calls.map((c) => String(c[0])).join('\n');

    const idx = ddl.match(/CREATE UNIQUE INDEX[^;`]*\(ref\)[^;`]*/i);
    expect(idx, 'no unique index on ref').toBeTruthy();
    expect(idx[0], 'a PARTIAL index will not satisfy ON CONFLICT (ref)').not.toMatch(/WHERE/i);
  });

  it('conflicts on a column the index actually covers', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ id: 1 }] }) };
    await upsertTask(pool, { ref: '1', title: 'x' });
    const insert = pool.query.mock.calls.map((c) => String(c[0])).find((q) => /ON CONFLICT/.test(q));
    expect(insert).toMatch(/ON CONFLICT \(ref\)/);
    // If the statement ever grows a WHERE, the index must grow the same one.
    expect(insert).not.toMatch(/ON CONFLICT \(ref\)\s*WHERE/);
  });
});
