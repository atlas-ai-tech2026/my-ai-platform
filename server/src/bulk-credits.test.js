// ─── bulk-credits.test.js ────────────────────────────────────────────────────
// Giving credits to a list of people who ALREADY have accounts.
//
// ☠ THIS SPENDS REAL MONEY. 61 accounts × 158 credits is 9,638 credits, about
// $610. A confirm box asking "are you sure?" is not consent to that — a number
// is. So the preview states accounts, credits AND dollars before anything
// moves, and applying is refused if the list changed after it was approved.
//
// ── AND THE HALF THAT USUALLY GETS LOST ────────────────────────────────────
// An address with no account receives nothing. Bulk's habit is to skip such
// rows quietly; that is precisely what cost ten people their promo codes on
// 2026-09-02. Here it is its own number, in its own sentence.

import { describe, it, expect } from 'vitest';
import { planTopUp, topUpReason, STANDARD_CREDIT_DAYS } from './bulk-credits.js';

const known = ['ahmed@gmail.com', 'sara@gmail.com', 'omar@gmail.com'];

describe('what a top-up would do, before it does it', () => {
  it('counts only the accounts that exist, and prices them', () => {
    const p = planTopUp(['ahmed@gmail.com', 'sara@gmail.com', 'nobody@gmail.com'], known,
      { credits: 158, creditValueUsd: 0.063333 });
    expect(p.accounts).toBe(2);
    expect(p.total_credits).toBe(316);
    expect(p.total_usd).toBeCloseTo(20.01, 2);
  });

  it('☠ names the people it CANNOT reach as their own number', () => {
    const p = planTopUp(['ahmed@gmail.com', 'newcomer@gmail.com', 'another@gmail.com'], known,
      { credits: 100 });
    expect(p.no_account).toEqual(['newcomer@gmail.com', 'another@gmail.com']);
    expect(p.sentence).toMatch(/2 addresses have no account and would receive nothing/);
  });

  it('says the bill as a sentence, because that is what is being approved', () => {
    const p = planTopUp(['ahmed@gmail.com', 'sara@gmail.com'], known,
      { credits: 158, creditValueUsd: 0.063333 });
    expect(p.sentence).toBe(
      '2 accounts would receive 158 credits each — 316 credits, about $20.01.');
  });

  it('☠ recognises an account stored with capitals or an invisible mark', () => {
    // Otherwise a returning customer is called "new" and receives nothing,
    // while the screen reports success.
    const p = planTopUp(['Ahmed@Gmail.com', '‏sara@gmail.com'], known, { credits: 50 });
    expect(p.accounts).toBe(2);
    expect(p.no_account).toEqual([]);
  });

  it('refuses to price anything until the credits are given', () => {
    for (const c of [undefined, '', 0, -5, 'abc']) {
      const p = planTopUp(['ahmed@gmail.com'], known, { credits: c });
      expect(p.credits_each, String(c)).toBeNull();
      expect(p.total_credits).toBe(0);
      expect(p.sentence).toMatch(/Enter how many credits/);
    }
  });

  it('☠ says plainly when NOBODY on the list has an account', () => {
    // The worst outcome to discover afterwards: a batch that ran and did
    // nothing, reported as success.
    const p = planTopUp(['a@new.com', 'b@new.com'], known, { credits: 158 });
    expect(p.accounts).toBe(0);
    expect(p.sentence).toMatch(/None of these 2 addresses has an account yet/);
    expect(p.sentence).toMatch(/Create them first/);
  });
});

describe('how long the credits live — the same idea as a promo code', () => {
  it('blank means the standard thirty days', () => {
    for (const v of [null, undefined, '']) {
      expect(planTopUp(['ahmed@gmail.com'], known, { credits: 10, accessDays: v }).days)
        .toBe(STANDARD_CREDIT_DAYS);
    }
    expect(STANDARD_CREDIT_DAYS).toBe(30);
  });

  it('a number means that many days — what a longer workshop needs', () => {
    expect(planTopUp(['ahmed@gmail.com'], known, { credits: 10, accessDays: 120 }).days).toBe(120);
  });
});

describe('the words written into the ledger', () => {
  it('marks the entry as a bulk top-up and keeps what was typed', () => {
    expect(topUpReason('SPA News Academy 5th')).toBe('bulk top-up: SPA News Academy 5th');
  });

  it('☠ and cannot be mistaken for a bulk PROVISION', () => {
    // classifyRow() reads "bulk provision:" to mean an account was created.
    // A top-up is not that, and must not borrow its words.
    expect(topUpReason('x')).not.toMatch(/^bulk provision:/);
  });

  it('survives an empty or oversized reason without breaking the row', () => {
    expect(topUpReason('')).toBe('bulk top-up: ');
    expect(topUpReason('x'.repeat(900)).length).toBeLessThan(430);
  });
});

describe('☠ THE ROUTE REFUSES TO SPEND AGAINST A LIST THAT MOVED', () => {
  const code = () => require('node:fs')
    .readFileSync(require('node:path').join(__dirname, 'index.js'), 'utf8')
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

  it('apply demands the account count the preview showed', () => {
    expect(code()).toMatch(/expected !== found\.length/);
    expect(code()).toMatch(/Press Check again so you are approving what is actually there/);
  });

  it('a reason is REQUIRED, as it is on the panel\'s own credit box', () => {
    expect(code()).toMatch(/Say what these credits are for/);
  });

  it('☠ the grant is recorded as bulk, NOT manual', () => {
    // A batch from the Bulk screen is a standard flow. Labelling it 'manual'
    // would put it on the Manual Credits screen and make that screen a lie.
    expect(code()).toMatch(/source: 'bulk'/);
  });

  it('and it names the admin, so "Added by" is not a dash', () => {
    expect(code()).toMatch(/adminEmail: req\.user\?\.email \|\| ADMIN_EMAIL/);
  });

  it('the whole batch is one transaction — all credited, or none', () => {
    const body = code().slice(code().indexOf("'/api/admin/users/bulk-credits/apply'"));
    expect(body).toMatch(/BEGIN/);
    expect(body).toMatch(/COMMIT/);
    expect(body).toMatch(/ROLLBACK/);
  });

  it('and the people with no account are reported in the RESULT too', () => {
    expect(code()).toMatch(/had no account and received NOTHING/);
  });
});
