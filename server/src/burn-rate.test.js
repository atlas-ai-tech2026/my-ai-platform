// ─── burn-rate.test.js ───────────────────────────────────────────────────────
// ☠ "DAYS OF RUNWAY" HAS NEVER ONCE APPEARED, ON THE LINE BUILT TO SHOW IT.
//
// balanceLine's own comment: "41,203 credits means nothing at a glance; 6 days
// books a top-up." Amr read it on production on 2026-09-02 and it said:
//
//     Supplier balance  74,066
//     Comfortable. No burn rate yet, so days of runway cannot be worked out
//     from credits alone.
//
// Every previous screenshot says the same — 95,441 · Comfortable, 82,422 ·
// Comfortable. The feature the line exists for has never worked, on the check
// that is supposed to prevent a repeat of 8 August.
//
// TWO BUGS, and the first hid the second:
//
//   1. WRONG SIGN. A spend is written as `-cost`, so SUM(amount) is negative.
//      balanceLine asks `burnPerDay > 0` and gets false, so it returns null and
//      says nothing. Four other places in this codebase write SUM(-amount);
//      this one did not.
//
//   2. WRONG UNIT — which fixing the sign would have concealed behind a
//      plausible number. `amount` is VOXEL credits, what the customer pays. The
//      balance is the KIE balance, what WE pay. Dividing one by the other is
//      not days of anything.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { balanceLine, STATE } from './sop-engine.js';

const here = dirname(fileURLToPath(import.meta.url));
const src = (f) => readFileSync(join(here, f), 'utf8');

/** The burn query, as it is actually written. */
function burnQuery() {
  const s = src('alerts-routes.js');
  const at = s.indexOf('AS per_day');
  expect(at, 'the burn query is gone or renamed').toBeGreaterThan(-1);
  const start = s.lastIndexOf('`', s.lastIndexOf('SELECT', at));
  // To the closing backtick, so the WHERE clause is inside the slice.
  return s.slice(start, s.indexOf('`', at));
}

describe('☠ IT MEASURES WHAT IT IS DIVIDING INTO', () => {
  it('uses kie_credits — the balance being judged is the KIE balance', () => {
    expect(burnQuery()).toMatch(/SUM\(kie_credits\)/);
  });

  it('☠ and NOT amount, which is a different currency entirely', () => {
    // Voxel credits per day divided into kie credits is not a number of days.
    // It would have looked completely reasonable on screen.
    expect(burnQuery(), 'amount is what the CUSTOMER pays, not what we pay')
      .not.toMatch(/SUM\(amount\)/);
  });

  it('kie_credits is positive, so it is not negated', () => {
    // credits.js writes `amount: -cost` but `kie_credits: kie` — a consumption
    // estimate, already positive. Negating it would reintroduce bug 1.
    expect(burnQuery()).not.toMatch(/SUM\(-kie_credits\)/);
  });

  it('and it is still scoped to spends over seven days', () => {
    const q = burnQuery();
    expect(q).toMatch(/action = 'spend'/);
    expect(q).toMatch(/INTERVAL '7 days'/);
  });
});

describe('☠ THE SHAPE OF THE ORIGINAL FAILURE', () => {
  const now = new Date().toISOString();

  it('a NEGATIVE burn rate produces no days at all — silently', () => {
    // Exactly what production has been doing. The line looks healthy and the
    // one number worth reading is simply absent.
    const l = balanceLine({ credits: 74066, burnPerDay: -2500, now });
    expect(l.value).toBe('74,066');
    expect(l.value).not.toMatch(/days/);
  });

  it('a POSITIVE burn rate finally produces them', () => {
    const l = balanceLine({ credits: 74066, burnPerDay: 2500, now });
    expect(l.value).toMatch(/74,066 · ~29 days/);
  });

  it('and the runway drives the verdict, not just the wording', () => {
    // Under three days is CRITICAL before a workshop — the threshold that
    // exists because a room burns faster than an average day. With burnPerDay
    // stuck at null that branch was unreachable in production.
    const l = balanceLine({ credits: 5000, burnPerDay: 2500, now });
    expect(l.state).toBe(STATE.CRITICAL);
    expect(l.detail).toMatch(/Runs out in about 2 days/);
  });

  it('no spending at all is still "no burn rate", not a division by zero', () => {
    const l = balanceLine({ credits: 74066, burnPerDay: null, now });
    expect(l.state).toBe(STATE.OK);
    expect(l.value).toBe('74,066');
  });
});
