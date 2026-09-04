// ─── promo-topup.test.js ─────────────────────────────────────────────────────
// Raising a promo code's value, and levelling up everyone who already used it.
//
// Owner, 2026-09-04: "They told me, please, we need to keep it with the same
// promo code, and I need to increase the credit." Telling a paying customer
// "no, take a second code" is a bad answer — and it is how four codes ended up
// named "SPA News Academy 5th".
//
// ☠ RAISING THE NUMBER ALONE WOULD DO NOTHING FOR THEM. A code grants its
// credits AT REDEMPTION. Change the figure and only future redeemers are
// affected; the 59 who already used it get nothing, and cannot redeem again —
// the database allows one redemption per person per code, and that rule is
// protecting the owner. So the top-up does both: the value goes up, and
// everyone who already redeemed receives the difference.

import { describe, it, expect } from 'vitest';
import { planTopUp, topUpReason } from './promo-topup.js';

const CODE = { code: 'VOXEL-VPW9-DY93', credits: 158 };

describe('what raising a code would do', () => {
  it("gives everyone who already redeemed the DIFFERENCE, not the whole new value", () => {
    // Paying the full 250 to someone who already has 158 would hand them 408.
    const p = planTopUp(CODE, 59, 250, { creditValueUsd: 0.063333 });
    expect(p.ok).toBe(true);
    expect(p.each).toBe(92);
    expect(p.total_credits).toBe(5428);
    expect(p.total_usd).toBeCloseTo(343.77, 2);
  });

  it('says the bill in words, because that is what is being approved', () => {
    expect(planTopUp(CODE, 59, 250).sentence).toBe(
      'Raise VOXEL-VPW9-DY93 from 158 to 250 credits. 59 people who have already redeemed it '
      + 'will each receive 92 more — 5,428 credits, about $343.77. '
      + 'Anyone redeeming from now on gets 250.');
  });

  it('a code nobody has used yet costs nothing today, and says so', () => {
    const p = planTopUp(CODE, 0, 250);
    expect(p.ok).toBe(true);
    expect(p.total_credits).toBe(0);
    expect(p.sentence).toMatch(/Nobody has redeemed it yet, so no credits are given out now/);
  });

  it('gets one person right — a screen that says "1 people" reads as broken', () => {
    expect(planTopUp(CODE, 1, 200).sentence).toMatch(/1 person who has already redeemed it/);
  });
});

describe('☠ WHAT IT REFUSES, AND WHY', () => {
  it('refuses to LOWER a code, out loud', () => {
    // Credits already spent cannot be taken back, so a reduction would either
    // do nothing or leave balances that disagree with the code.
    const p = planTopUp(CODE, 59, 100);
    expect(p.ok).toBe(false);
    expect(p.reason).toBe('lower');
    expect(p.sentence).toMatch(/cannot be lowered/);
    expect(p.sentence).toMatch(/Deactivate it and issue a new one instead/);
  });

  it('refuses a no-op rather than granting zero to everybody', () => {
    const p = planTopUp(CODE, 59, 158);
    expect(p.ok).toBe(false);
    expect(p.sentence).toMatch(/already worth 158 credits/);
  });

  it('refuses nonsense instead of guessing', () => {
    for (const v of [undefined, '', 0, -50, 'abc', null]) {
      expect(planTopUp(CODE, 59, v).ok, String(v)).toBe(false);
    }
  });

  it('and refuses a code whose own value cannot be read', () => {
    expect(planTopUp({ code: 'X', credits: null }, 5, 200).ok).toBe(false);
  });
});

describe('the ledger entry explains itself a year later', () => {
  it('names the code and both values', () => {
    expect(topUpReason('VOXEL-VPW9-DY93', 158, 250))
      .toBe('promo top-up: VOXEL-VPW9-DY93 158 → 250');
  });
});

describe('☠ THE ROUTE REFUSES TO SPEND AGAINST A HEADCOUNT THAT MOVED', () => {
  const code = () => require('node:fs')
    .readFileSync(require('node:path').join(__dirname, 'index.js'), 'utf8')
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

  it('apply demands the number of people the preview showed', () => {
    // Someone redeeming in between would already have received the NEW value
    // at redemption — topping them up as well pays them twice.
    expect(code()).toMatch(/expected !== red\.length/);
    expect(code()).toMatch(/status\(409\)/);
  });

  it('reads the code FOR UPDATE, so two admins cannot both grant the difference', () => {
    expect(code()).toMatch(/SELECT id, code, credits, access_days FROM promo_codes WHERE id = \$1 FOR UPDATE/);
  });

  it('☠ the credits live as long as the CODE says, not a flat 30 days', () => {
    // A top-up that outlives its workshop, or dies before it, is a different
    // promise from the one the code made.
    expect(code()).toMatch(/code\.access_days != null && Number\(code\.access_days\) > 0/);
  });

  it('is recorded as promo, so it stays attached to the workshop', () => {
    // The whole reason for a top-up rather than a bulk grant: Workshops & P&L
    // joins a workshop to its people BY CODE.
    expect(code()).toMatch(/action: 'promo', reason, days,\s*\n\s*source: 'promo'/);
  });

  it('raises the code itself, so future redeemers get the new value too', () => {
    expect(code()).toMatch(/UPDATE promo_codes SET credits = \$2 WHERE id = \$1/);
  });

  it('the whole thing is one transaction — all levelled up, or none', () => {
    const body = code().slice(code().indexOf("'/api/admin/promocodes/:id/topup'"));
    expect(body).toMatch(/BEGIN/); expect(body).toMatch(/COMMIT/); expect(body).toMatch(/ROLLBACK/);
  });
});
