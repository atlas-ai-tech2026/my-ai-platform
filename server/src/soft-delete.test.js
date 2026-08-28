// ─── soft-delete.test.js ─────────────────────────────────────────────────────
// The confirmation a customer reads says "you will have 30 days to undo this."
//
// Everything here exists to make that sentence true. Amr approved the delete
// button on the strength of it, so it is a commitment rather than a default,
// and the tests are ordered by how badly each failure would break it:
//
//   1. a picture inside the window can always be brought back
//   2. nobody can delete or restore somebody else's work
//   3. a second press cannot quietly extend "30 days" into 60
//   4. when the window really is up, the ROW goes before the FILE

import { describe, it, expect, vi } from 'vitest';
import {
  DELETE_SQL, RESTORE_SQL, RESTORE_OWN_SQL, RECOVERABLE_SQL,
  DUE_FOR_PURGE_SQL, PURGE_ROW_SQL, SOFT_DELETE_DDL,
  daysLeft, purgeRows, confirmText, RECOVERY_DAYS,
} from './soft-delete.js';

const ago = (days) => new Date(Date.now() - days * 86400000).toISOString();

describe('1 — THE PROMISE: 30 days, and the words match the code', () => {
  it('the window is 30 days', () => {
    expect(RECOVERY_DAYS).toBe(30);
  });

  it('the sentence the customer reads is built from the SAME constant', () => {
    // So a change to 7 days cannot leave a screen still promising 30.
    expect(confirmText(1)).toContain(String(RECOVERY_DAYS));
    expect(confirmText(40)).toContain(String(RECOVERY_DAYS));
  });

  it('and it reads correctly for one picture and for many', () => {
    expect(confirmText(1)).toMatch(/this picture\? You can bring it back/);
    expect(confirmText(40)).toMatch(/these 40 pictures\? You can bring them back/);
  });

  it('restore works right up to the edge of the window', () => {
    expect(RESTORE_SQL).toMatch(new RegExp(`INTERVAL '${RECOVERY_DAYS} days'`));
    expect(daysLeft(ago(29))).toBe(1);
    expect(daysLeft(ago(0))).toBe(30);
  });

  it('but NOT past it — the file may already be gone', () => {
    // Restoring an aged-out row would hand the customer a broken picture while
    // telling them it had been recovered.
    expect(RESTORE_SQL).toMatch(/deleted_at > NOW\(\) - INTERVAL/);
    expect(daysLeft(ago(31))).toBe(0);
  });
});

describe('2 — nobody touches anybody else’s work', () => {
  it('deleting is scoped to the owner IN THE SQL, not only in the route', () => {
    // So a later bug in a caller cannot turn this into a cross-account delete.
    expect(DELETE_SQL).toMatch(/user_id = \$2/);
    expect(DELETE_SQL).toMatch(/name = 'GenerationHistory'/);
  });

  it('a customer restoring their own is scoped too', () => {
    expect(RESTORE_OWN_SQL).toMatch(/user_id = \$2/);
  });

  it('only the ADMIN restore is unscoped, and that is the whole point of it', () => {
    // Support has to be able to put back a picture for an account that cannot
    // reach it themselves.
    expect(RESTORE_SQL).not.toMatch(/user_id = \$2/);
  });

  it('every statement names the entity type — nothing here can reach another table’s rows', () => {
    for (const sql of [DELETE_SQL, RESTORE_SQL, RESTORE_OWN_SQL, PURGE_ROW_SQL, DUE_FOR_PURGE_SQL]) {
      expect(sql).toMatch(/GenerationHistory/);
    }
  });
});

describe('3 — a second press cannot extend the window', () => {
  it('deleting only touches rows that are not already deleted', () => {
    // Re-stamping deleted_at would silently turn 30 days into 60 and make the
    // promise on screen untrue in the customer's favour — which is still
    // untrue, and would break the purge's arithmetic.
    expect(DELETE_SQL).toMatch(/AND deleted_at IS NULL/);
  });

  it('and restoring only touches rows that ARE deleted', () => {
    expect(RESTORE_SQL).toMatch(/deleted_at IS NOT NULL/);
  });
});

describe('4 — the purge order: the safe failure is the leak', () => {
  const row = { id: 'a', result_url: 'https://spaces/a.png', thumb_url: 'https://spaces/a-t.jpg' };

  it('removes the row, then the files', async () => {
    const order = [];
    const r = await purgeRows([row], {
      dropRow: vi.fn(async () => { order.push('row'); return 1; }),
      dropFile: vi.fn(async () => { order.push('file'); }),
    });
    expect(order[0]).toBe('row');
    expect(r).toMatchObject({ purged: 1, filesRemoved: 2 });
  });

  it('a file that cannot be removed leaves the row GONE — an orphan, not a lie', async () => {
    // The other order would leave a row that still looks recoverable while its
    // picture no longer exists. A few wasted megabytes beat telling somebody
    // their work is back when it is not.
    const r = await purgeRows([row], {
      dropRow: vi.fn(async () => 1),
      dropFile: vi.fn(async () => { throw new Error('bucket refused'); }),
    });
    expect(r.purged).toBe(1);
    expect(r.filesRemoved).toBe(0);
    expect(r.problems).toHaveLength(2);
    expect(r.problems[0].why).toMatch(/bucket refused/);
  });

  it('a row that is NOT due deletes nothing, and no file is touched', async () => {
    // The statement re-checks the age itself, so a bad caller cannot purge
    // something still inside its window.
    const dropFile = vi.fn();
    const r = await purgeRows([row], { dropRow: vi.fn(async () => 0), dropFile });
    expect(r.purged).toBe(0);
    expect(dropFile).not.toHaveBeenCalled();
  });

  it('the purge statement carries the age check as well as the id', () => {
    expect(PURGE_ROW_SQL).toMatch(/deleted_at <= NOW\(\) - INTERVAL/);
  });

  it('one bad row does not stop the rest', async () => {
    let n = 0;
    const r = await purgeRows([row, { ...row, id: 'b' }, { ...row, id: 'c' }], {
      dropRow: vi.fn(async () => { n += 1; if (n === 2) throw new Error('db gone'); return 1; }),
      dropFile: vi.fn(async () => {}),
    });
    expect(r.considered).toBe(3);
    expect(r.purged).toBe(2);
    expect(r.problems[0]).toMatchObject({ id: 'b' });
  });

  it('a row with no urls is purged without complaint', async () => {
    const r = await purgeRows([{ id: 'x' }], { dropRow: vi.fn(async () => 1), dropFile: vi.fn() });
    expect(r).toMatchObject({ purged: 1, filesRemoved: 0, problems: [] });
  });

  it('an empty run is a clean report, not a crash', async () => {
    const deps = { dropRow: vi.fn(), dropFile: vi.fn() };
    expect(await purgeRows([], deps)).toMatchObject({ considered: 0, purged: 0 });
    expect(await purgeRows(null, deps)).toMatchObject({ considered: 0 });
  });
});

describe('the recovery list', () => {
  it('shows soonest-to-be-lost FIRST', () => {
    // Sorted by what needs a decision today, not by what was deleted most
    // recently.
    expect(RECOVERABLE_SQL).toMatch(/ORDER BY e\.deleted_at ASC/);
  });

  it('never lists something already past the window', () => {
    expect(RECOVERABLE_SQL).toMatch(/e\.deleted_at > NOW\(\) - INTERVAL/);
  });

  it('carries the account email, so a B2B call can be answered', () => {
    expect(RECOVERABLE_SQL).toMatch(/JOIN users u/);
    expect(RECOVERABLE_SQL).toMatch(/u\.email/);
  });

  it('every filter is optional and NULL means "do not filter"', () => {
    // An empty filter box must widen the list, never empty it.
    for (const p of ['$1::text IS NULL', '$2::text IS NULL', '$3::int  IS NULL']) {
      expect(RECOVERABLE_SQL.replace(/\s+/g, ' ')).toContain(p.replace(/\s+/g, ' '));
    }
  });

  it('computes days left in the query, so the screen cannot disagree with the purge', () => {
    expect(RECOVERABLE_SQL).toMatch(/days_left/);
    expect(RECOVERABLE_SQL).toMatch(/GREATEST\(0,/);
  });
});

describe('days left, for a screen', () => {
  it('is whole days and never negative', () => {
    expect(daysLeft(ago(100))).toBe(0);
    expect(daysLeft(ago(7.4))).toBe(23);
  });

  it('is null when there is nothing to measure', () => {
    for (const bad of [null, undefined, '', 'not a date']) {
      expect(daysLeft(bad)).toBeNull();
    }
  });
});

describe('the column', () => {
  it('is added without touching a single existing row', () => {
    // Nullable and IF NOT EXISTS: the whole table becomes "not deleted" the
    // moment it lands, and running it twice is harmless.
    // Scoped to the ALTER line: the index predicate below it legitimately
    // contains "IS NOT NULL", and a looser check matched that instead.
    const alter = SOFT_DELETE_DDL.split('\n').find((l) => l.includes('ALTER TABLE'));
    expect(alter).toMatch(/ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ/);
    expect(alter, 'a NOT NULL column would need a value for every existing row').not.toMatch(/NOT NULL TIMESTAMPTZ|TIMESTAMPTZ NOT NULL/);
    expect(alter, 'a DEFAULT would stamp every existing row as deleted').not.toMatch(/DEFAULT/);
  });

  it('is indexed only where it is set — deleted rows are the rare case', () => {
    expect(SOFT_DELETE_DDL).toMatch(/WHERE deleted_at IS NOT NULL/);
  });
});
