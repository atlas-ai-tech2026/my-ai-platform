// ─── projects.test.js ────────────────────────────────────────────────────────
// THE BOARD AMR AND MOHANED SHARE.
//
// Every judgement lives in projects.js without a database, so the numbers on
// the screen can be tested exhaustively. These are the ones that would be wrong
// quietly: a date that is late by a few hours, a total that counts archived
// rows, a "Completed · 60%" contradiction, and profit measured against the
// wrong column.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isOverdue, effectiveStatus, daysLeft, summarise, byOwner, byStatus,
  cleanProject, LIST_SQL, INSERT_SQL, UPDATE_SQL, DELETE_SQL, COLUMNS, valuesOf, STATUSES, toWire,
} from './projects.js';

const now = new Date('2026-09-02T12:00:00Z');
const p = (o = {}) => ({ name: 'x', status: 'In Progress', priority: 'Medium', progress: 0, archived: false, ...o });

describe('☠ OVERDUE IS DECIDED, NEVER STORED', () => {
  it('yesterday is overdue', () => {
    expect(isOverdue(p({ end_date: '2026-09-01' }), now)).toBe(true);
  });

  it('☠ TODAY is not overdue at noon — the whole day is still yours', () => {
    // A stored flag flipped at midnight would call this late at 00:01, which is
    // wrong by any human reading and would put a red badge on work due later
    // the same afternoon.
    expect(isOverdue(p({ end_date: '2026-09-02' }), now)).toBe(false);
  });

  it('tomorrow is not overdue', () => {
    expect(isOverdue(p({ end_date: '2026-09-03' }), now)).toBe(false);
  });

  it('a COMPLETED project is never overdue, however late it was', () => {
    // The board is for deciding what to do next, and there is nothing to do
    // about a finished thing.
    expect(isOverdue(p({ end_date: '2020-01-01', status: 'Completed' }), now)).toBe(false);
  });

  it('no end date is never overdue', () => {
    expect(isOverdue(p({ end_date: null }), now)).toBe(false);
  });

  it('and a nonsense date does not throw or accuse', () => {
    expect(isOverdue(p({ end_date: 'soon' }), now)).toBe(false);
  });

  it('the badge shows Overdue over the stored status', () => {
    expect(effectiveStatus(p({ end_date: '2026-08-01' }), now)).toBe('Overdue');
    expect(effectiveStatus(p({ end_date: '2026-12-01' }), now)).toBe('In Progress');
  });

  it('days left counts whole days, and goes negative when late', () => {
    expect(daysLeft(p({ end_date: '2026-09-09' }), now)).toBe(7);
    expect(daysLeft(p({ end_date: '2026-09-02' }), now)).toBe(0);
    expect(daysLeft(p({ end_date: '2026-08-30' }), now)).toBe(-3);
    expect(daysLeft(p({ end_date: null }), now)).toBeNull();
  });
});

describe('☠ ARCHIVED ROWS ARE NOT ON THE BOARD', () => {
  const rows = [
    p({ status: 'In Progress' }),
    p({ status: 'Completed' }),
    p({ status: 'Pending', archived: true }),
    p({ status: 'In Progress', archived: true, budget: 999 }),
  ];

  it('the counts exclude them — or the archive button looks broken', () => {
    const s = summarise(rows, now);
    expect(s.total).toBe(2);
    expect(s.in_progress).toBe(1);
    expect(s.pending).toBe(0);
  });

  it('and so do the money totals', () => {
    expect(summarise(rows, now).budget).toBe(0);
  });

  it('and the owner and status breakdowns', () => {
    const withOwners = [p({ owner: 'Amr' }), p({ owner: 'Mohaned', archived: true })];
    expect(byOwner(withOwners)).toEqual([{ owner: 'Amr', n: 1 }]);
    expect(byStatus(withOwners, now)).toEqual([{ status: 'In Progress', n: 1 }]);
  });

  it('a project with no owner is "Unassigned", not blank', () => {
    expect(byOwner([p({ owner: '  ' })])).toEqual([{ owner: 'Unassigned', n: 1 }]);
  });
});

describe('☠ PROFIT IS REVENUE MINUS COST, NOT BUDGET MINUS COST', () => {
  it('a project fully delivered and entirely unpaid shows a LOSS', () => {
    // Budget is what was agreed. Cost is what it took. Revenue is what
    // arrived. Measuring profit against budget is how something looks
    // profitable while nobody has actually paid.
    const s = summarise([p({ budget: 10000, cost: 4000, revenue: 0 })], now);
    expect(s.profit).toBe(-4000);
    expect(s.budget).toBe(10000);
  });

  it('and paid work shows the real margin', () => {
    expect(summarise([p({ budget: 10000, cost: 4000, revenue: 9000 })], now).profit).toBe(5000);
  });
});

describe('due soon is counted separately from overdue', () => {
  it('something due in three days is "this week", not overdue', () => {
    const s = summarise([p({ end_date: '2026-09-05' })], now);
    expect(s.due_this_week).toBe(1);
    expect(s.overdue).toBe(0);
  });

  it('something already late is overdue and NOT counted as due soon', () => {
    const s = summarise([p({ end_date: '2026-08-20' })], now);
    expect(s.overdue).toBe(1);
    expect(s.due_this_week).toBe(0);
  });

  it('a completed project is neither', () => {
    const s = summarise([p({ end_date: '2026-09-03', status: 'Completed' })], now);
    expect(s.due_this_week).toBe(0);
    expect(s.overdue).toBe(0);
  });
});

describe('☠ WHAT THE FORM SENDS IS UNTRUSTED', () => {
  it('a nameless project is refused, with a sentence not a code', () => {
    const r = cleanProject({ name: '   ' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/needs a name/);
  });

  it('an unknown status falls back rather than reaching the database', () => {
    expect(cleanProject({ name: 'x', status: 'Whatever' }).value.status).toBe('Not Started');
    expect(cleanProject({ name: 'x', priority: '; DROP TABLE' }).value.priority).toBe('Medium');
  });

  it('☠ Completed always means 100% — never "Completed · 60%"', () => {
    // A contradiction on the board is something a person has to stop and
    // resolve, every time they look at it.
    expect(cleanProject({ name: 'x', status: 'Completed', progress: 60 }).value.progress).toBe(100);
  });

  it('progress is clamped both ways', () => {
    expect(cleanProject({ name: 'x', progress: 900 }).value.progress).toBe(100);
    expect(cleanProject({ name: 'x', progress: -5 }).value.progress).toBe(0);
    expect(cleanProject({ name: 'x', progress: 'lots' }).value.progress).toBe(0);
  });

  it('☠ an unparseable date becomes null, not "Invalid Date"', () => {
    // Postgres rejects that with a message nobody can act on.
    expect(cleanProject({ name: 'x', end_date: 'next tuesday' }).value.end_date).toBeNull();
    expect(cleanProject({ name: 'x', end_date: '2026-09-02' }).value.end_date).toBe('2026-09-02');
  });

  it('negative money is refused rather than stored', () => {
    expect(cleanProject({ name: 'x', budget: -50 }).value.budget).toBe(0);
  });

  it('tags accept a comma string or an array, and are trimmed', () => {
    expect(cleanProject({ name: 'x', tags: ' a , b ,, c ' }).value.tags).toEqual(['a', 'b', 'c']);
    expect(cleanProject({ name: 'x', tags: ['a', ' b '] }).value.tags).toEqual(['a', 'b']);
  });

  it('long text is cut rather than rejected — a paste should not lose the row', () => {
    expect(cleanProject({ name: 'y'.repeat(400) }).value.name).toHaveLength(200);
  });
});

describe('the SQL and the value list cannot drift apart', () => {
  it('valuesOf produces exactly the columns the statements bind', () => {
    // INSERT binds $1..$18 and UPDATE $1..$18 where the last is the id. One
    // list feeds both, so adding a column cannot silently shift the others.
    const v = valuesOf(cleanProject({ name: 'x' }).value);
    expect(v).toHaveLength(COLUMNS.length);
    expect(COLUMNS).toHaveLength(17);
    expect(INSERT_SQL).toMatch(/\$18\)/);
    expect(UPDATE_SQL).toMatch(/WHERE id=\$18/);
  });

  it('the list query hides archived rows unless asked', () => {
    expect(LIST_SQL).toMatch(/\$1::boolean IS TRUE OR archived = FALSE/);
  });

  it('and delete is the only statement that removes anything', () => {
    expect(DELETE_SQL).toMatch(/^\s*DELETE FROM projects/);
    expect(LIST_SQL).not.toMatch(/DELETE/);
    expect(INSERT_SQL).not.toMatch(/DELETE/);
    expect(UPDATE_SQL).not.toMatch(/DELETE/);
  });

  it('every status the UI offers is one the cleaner accepts', () => {
    for (const s of STATUSES) expect(cleanProject({ name: 'x', status: s }).value.status).toBe(s);
  });
});

// ─── ADDED BEFORE THE FIRST REAL DEADLINE WENT IN ────────────────────────────
describe('☠ A DATE IS A DAY, NOT A MOMENT', () => {
  // Postgres DATE comes back through the driver as a JS Date at LOCAL midnight,
  // and JSON turns that into an instant: 2026-09-02 leaves the server as
  // "2026-09-01T21:00:00.000Z". Rendered in a browser behind the server it is a
  // DAY EARLY, and the overdue comparison is wrong by a day with it.
  //
  // MEASURED: stored 2026-09-02 renders as 02 Sept in Kuwait and 01 Sept in
  // London, New York and Los Angeles. Correct for the two people who will use
  // this, wrong for everyone else — which is how a bug like this survives.

  it('an instant from the driver becomes the day it was meant to be', () => {
    const wired = toWire({ end_date: new Date('2026-09-02T00:00:00'), start_date: null });
    expect(wired.end_date).toBe('2026-09-02');
    expect(wired.start_date).toBeNull();
  });

  it('a string is passed through, already trimmed to the day', () => {
    expect(toWire({ end_date: '2026-09-02T21:00:00.000Z' }).end_date).toBe('2026-09-02');
    expect(toWire({ end_date: '2026-09-02' }).end_date).toBe('2026-09-02');
  });

  it('and rubbish becomes null rather than "Invalid Date"', () => {
    expect(toWire({ end_date: 'whenever' }).end_date).toBeNull();
  });

  it('☠ overdue is a comparison of DAYS, so it cannot shift by a timezone', () => {
    const t = new Date('2026-09-02T00:30:00');       // just after midnight, locally
    expect(isOverdue({ end_date: '2026-09-01', status: 'Pending' }, t)).toBe(true);
    expect(isOverdue({ end_date: '2026-09-02', status: 'Pending' }, t)).toBe(false);
    const late = new Date('2026-09-02T23:30:00');    // last half hour of the day
    expect(isOverdue({ end_date: '2026-09-02', status: 'Pending' }, late)).toBe(false);
  });

  it('and days left is whole days, from the day parts', () => {
    const t = new Date('2026-09-02T18:00:00');
    expect(daysLeft({ end_date: '2026-09-09' }, t)).toBe(7);
    expect(daysLeft({ end_date: '2026-09-02' }, t)).toBe(0);
    expect(daysLeft({ end_date: '2026-08-31' }, t)).toBe(-2);
  });

  it('the routes send every row through it, so nothing leaks a raw Date', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const routes = readFileSync(join(here, 'projects-routes.js'), 'utf8');
    expect(routes).toMatch(/rows\.map\(toWire\)/);
    // create / update / archive all return a single row
    expect((routes.match(/toWire\(rows\[0\]\)/g) || []).length).toBeGreaterThanOrEqual(3);
  });
});
