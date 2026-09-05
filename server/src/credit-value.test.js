// ─── credit-value.test.js ────────────────────────────────────────────────────
// One question — what is a credit worth — used to have four answers, and two
// money screens disagreed about the same workshop. These tests hold the answer
// to one place and pin the failure modes that would put a wrong number on an
// invoice without saying so.

import { describe, it, expect } from 'vitest';
import { readCreditValue, CREDIT_VALUE_FALLBACK } from './credit-value.js';

const poolReturning = (rows) => ({ query: async () => ({ rows }) });
const poolThatThrows = () => ({ query: async () => { throw new Error('no connection'); } });

describe('readCreditValue', () => {
  it('uses the value the database holds', async () => {
    // Production stores 0.06333333 — eight places, matching NUMERIC(12,8).
    expect(await readCreditValue(poolReturning([{ credit_value: '0.06333333' }]))).toBe(0.06333333);
  });

  it('keeps the full precision, not six places', async () => {
    // ☠ The whole bug. 151,671 credits at 0.063333 is $9,605.78; at 0.06333333
    // it is $9,605.83 — and Amr's two screens showed one each.
    const v = await readCreditValue(poolReturning([{ credit_value: '0.06333333' }]));
    expect((151671 * v).toFixed(2)).toBe('9605.83');
  });

  it('falls back when there is no settings row', async () => {
    expect(await readCreditValue(poolReturning([]))).toBe(CREDIT_VALUE_FALLBACK);
  });

  it('falls back rather than throwing when the query fails', async () => {
    // A money screen that 500s because a settings row is missing is worse than
    // one showing the documented default.
    expect(await readCreditValue(poolThatThrows())).toBe(CREDIT_VALUE_FALLBACK);
  });

  describe('values that would silently price a workshop at nothing', () => {
    // ☠ Number(null) is 0. Number('') is 0. Number(undefined) is NaN. Any of
    // these reaching a multiplication renders $0.00 for a real workshop — the
    // exact shape of bug this project keeps finding: no error, no warning, a
    // confident wrong number.
    for (const bad of [null, '', undefined, 0, '0', -1, 'abc', NaN]) {
      it(`refuses ${JSON.stringify(bad)}`, async () => {
        expect(await readCreditValue(poolReturning([{ credit_value: bad }])))
          .toBe(CREDIT_VALUE_FALLBACK);
      });
    }
  });

  it('the fallback matches the schema default in db.js', async () => {
    // A fallback that disagrees with the column default is just a second wrong
    // answer waiting to be displayed. db.js: NUMERIC(12,8) DEFAULT 0.06333333.
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    // vitest resolves import.meta.url to a non-file scheme here, so go via the
    // filesystem rather than the module URL.
    const db = readFileSync(path.resolve(process.cwd(), 'server/src/db.js'), 'utf8');
    const m = db.match(/credit_value\s+NUMERIC\(12,8\)\s+NOT NULL DEFAULT\s+([0-9.]+)/);
    expect(m, 'could not find the credit_value column default in db.js').toBeTruthy();
    expect(Number(m[1])).toBe(CREDIT_VALUE_FALLBACK);
  });
});
