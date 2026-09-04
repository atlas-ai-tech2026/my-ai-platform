// ─── bulk-provision-reason.test.js ───────────────────────────────────────────
// ☠ AN ACCOUNT CREATED IN BULK USED TO CARRY NO LINK TO THE WORKSHOP.
//
// The ledger said `bulk provision: Basic plan`. The PLAN — never the customer,
// never the workshop. And Workshops & P&L joins a workshop to its people by
// promo code:
//
//     const spend = w.promo_code ? await cohortSpend(pool, w.promo_code) : [];
//
// So people created through Bulk, who never redeemed a code, were invisible to
// the profit number. Amr asked the right question before building dashboards
// on top of it: "if I add ten from bulk and ten from a promo code, is there a
// problem for calculation or reporting?" There was. Half a cohort could
// disappear with nothing to say so.
//
// Now the batch says what it was for, and the credits can live longer than
// thirty days — the same Access days a promo code has always had.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { classifyRow } from './credit-source-backfill.js';

const code = () => readFileSync(join(__dirname, 'index.js'), 'utf8')
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

describe('a bulk batch records what it was for', () => {
  it('the typed reason is appended to the provisioning sentence', () => {
    expect(code()).toMatch(/bulk provision: \$\{pkg\} plan — \$\{batchReason\}/);
  });

  it('☠ and ONE sentence is built once, used by both writes', () => {
    // The ledger row and the credit lot must never describe the same batch
    // differently — that is how a screen and a report disagree about money.
    expect(code()).toMatch(/const provisionReason = batchReason/);
    expect(code()).toMatch(/reason: provisionReason,/);
    expect(code()).toMatch(/ADMIN_EMAIL, provisionReason\]/);
    // and the old hard-coded string is gone from both call sites
    expect((code().match(/`bulk provision: \$\{pkg\} plan`/g) || []).length).toBeLessThanOrEqual(1);
  });

  it('a batch with no reason still works — it is optional, not required', () => {
    expect(code()).toMatch(/String\(req\.body\?\.reason \|\| ''\)\.trim\(\)/);
  });
});

describe('☠ THE CLASSIFIER MUST STILL CALL THESE BULK', () => {
  // If adding the workshop name pushed these rows into 'manual', every bulk
  // batch would appear on the Manual Credits screen — making that screen a
  // lie, which is the exact thing it was built to stop.
  it('the old form is still bulk', () => {
    expect(classifyRow({ action: 'grant', reason: 'bulk provision: Basic plan' })).toBe('bulk');
  });

  it('and the new form, with the workshop appended, is still bulk', () => {
    expect(classifyRow({ action: 'grant', reason: 'bulk provision: Basic plan — SPA News Academy 5th' }))
      .toBe('bulk');
    expect(classifyRow({ action: 'grant', reason: 'bulk provision: Free plan — apology for 2 Sept' }))
      .toBe('bulk');
  });

  it('☠ while a hand-typed grant that merely MENTIONS it stays manual', () => {
    // The match is anchored for exactly this reason.
    expect(classifyRow({ action: 'grant', reason: 'fixing a bulk provision: mistake' })).toBe('manual');
  });
});

describe('how long the credits live', () => {
  it('access days is accepted and validated like a promo code', () => {
    expect(code()).toMatch(/bulkDays = parseInt\(req\.body\.access_days, 10\)/);
    expect(code()).toMatch(/bulkDays < 1 \|\| bulkDays > 3650/);
  });

  it('☠ and it actually reaches the credit lot — not accepted and ignored', () => {
    // The retired "Expires" field was accepted and thrown away for weeks. A
    // control that silently does nothing is worse than no control.
    expect(code()).toMatch(/days: bulkDays \?\? CREDIT_LIFE_DAYS/);
  });

  it('blank still means the standard thirty days', () => {
    expect(code()).toMatch(/let bulkDays = null/);
  });
});
