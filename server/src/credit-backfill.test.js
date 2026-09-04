// ─── credit-backfill.test.js ─────────────────────────────────────────────────
// Labelling the credit rows written before `source` existed.
//
// ☠ THE ONLY RULE THAT MATTERS HERE: A ROW WE CANNOT PLACE IS LEFT ALONE.
//
// It would be easy to sweep the awkward cases into 'system' and report a tidy
// 100%. That is the exact failure this project keeps finding — a number that
// looks complete because the difficult rows were quietly absorbed. This is the
// owner's money: $9,605 of it in one workshop alone. A small honest gap beats
// a large confident lie.

import { describe, it, expect } from 'vitest';
import { classifyRow, previewBackfill, BULK_REASON } from './credit-backfill.js';

describe('what an old credit row gets labelled', () => {
  it('a code redemption is promo, a gift card is gift', () => {
    expect(classifyRow({ action: 'promo', reason: 'promo: VOXEL-VPW9-DY93' })).toBe('promo');
    expect(classifyRow({ action: 'gift', reason: 'gift card: ABC' })).toBe('gift');
  });

  it('everything the system does on its own is system', () => {
    for (const action of ['spend', 'refund', 'expire', 'signup', 'ban', 'unban', 'password_reset']) {
      expect(classifyRow({ action }), action).toBe('system');
    }
  });

  it('☠ a grant with bulk\'s own sentence is BULK, not manual', () => {
    // The distinction the whole feature rests on. Bulk provisioning and the
    // panel's credit box both wrote action 'grant'; only this sentence, which
    // no human typed, ever separated them.
    expect(classifyRow({ action: 'grant', reason: 'bulk provision: Basic plan' })).toBe('bulk');
    expect(classifyRow({ action: 'grant', reason: 'bulk provision: Free plan' })).toBe('bulk');
  });

  it('and any other grant is manual — including the real SPA 4 reasons', () => {
    for (const reason of ['spa 4', 'Spa 4', 'Spa 4.', 'SPA4',
      'Spa 4 its was his credit and we removed and then we returned agian', '']) {
      expect(classifyRow({ action: 'grant', reason }), JSON.stringify(reason)).toBe('manual');
    }
  });

  it('revoke and set were always a person deciding something', () => {
    expect(classifyRow({ action: 'revoke', reason: 'took back' })).toBe('manual');
    expect(classifyRow({ action: 'set', reason: 'corrected' })).toBe('manual');
  });

  it('☠ a row it cannot place is LEFT ALONE, never swept into system', () => {
    // The tempting shortcut, refused. An action from a path since removed is
    // not evidence of anything; guessing would put unknown money in a total
    // the owner reads as fact.
    expect(classifyRow({ action: 'topup', reason: 'x' })).toBeNull();
    expect(classifyRow({ action: 'create', reason: '' })).toBeNull();
    expect(classifyRow({ action: '', reason: 'anything' })).toBeNull();
    expect(classifyRow({})).toBeNull();
  });

  it('is not fooled by case or stray spacing in the action', () => {
    expect(classifyRow({ action: ' GRANT ', reason: 'spa 4' })).toBe('manual');
    expect(classifyRow({ action: 'Promo' })).toBe('promo');
  });

  it('☠ and a customer cannot talk their way into being "bulk"', () => {
    // `reason` on a manual grant is free text an admin types. If the match
    // were loose, typing the words anywhere would relabel money.
    expect(classifyRow({ action: 'grant', reason: 'refund for the bulk provision: mistake' })).toBe('manual');
    expect(classifyRow({ action: 'grant', reason: 'not a bulk provision' })).toBe('manual');
    expect(BULK_REASON.source.startsWith('^')).toBe(true);   // anchored, deliberately
  });
});

describe('the preview the owner approves', () => {
  const rows = [
    { action: 'grant', reason: 'spa 4', amount: 395, email: 'a@b.com', created_at: '2026-08-20' },
    { action: 'grant', reason: 'Spa 4', amount: 395, email: 'c@d.com', created_at: '2026-08-20' },
    { action: 'grant', reason: 'bulk provision: Basic plan', amount: 100, email: 'e@f.com' },
    { action: 'promo', reason: 'promo: VOXEL-X', amount: 158, email: 'g@h.com' },
    { action: 'spend', reason: 'Kling 3.0', amount: -12.5, email: 'a@b.com' },
    { action: 'topup', reason: 'from a path that no longer exists', amount: 50, email: 'i@j.com' },
  ];

  it('groups by what each row would become, biggest first', () => {
    const p = previewBackfill(rows);
    expect(p.groups.map((g) => g.source)).toEqual(
      expect.arrayContaining(['manual', 'bulk', 'promo', 'system', 'unclassified']));
    expect(p.groups[0].source).toBe('manual');       // 2 rows, the largest group
    expect(p.groups[0].rows).toBe(2);
  });

  it('says what it would NOT touch, as its own number', () => {
    const p = previewBackfill(rows);
    expect(p.total_rows).toBe(6);
    expect(p.unclassified).toBe(1);
    expect(p.would_write).toBe(5);
  });

  it('puts money on each group, because that is what makes it checkable', () => {
    const p = previewBackfill(rows, { creditValueUsd: 0.063333 });
    const manual = p.groups.find((g) => g.source === 'manual');
    expect(manual.credits).toBe(790);
    expect(manual.usd).toBeCloseTo(50.03, 2);
  });

  it('☠ shows REAL examples, so a person can say "those are not manual"', () => {
    // A count cannot be checked. Three rows can.
    const p = previewBackfill(rows);
    const manual = p.groups.find((g) => g.source === 'manual');
    expect(manual.examples[0]).toMatchObject({ email: 'a@b.com', reason: 'spa 4', amount: 395 });
    expect(manual.examples).toHaveLength(2);
  });

  it('states the whole thing as one sentence a person can approve', () => {
    const p = previewBackfill(rows);
    expect(p.sentence).toMatch(/^6 unlabelled rows — /);
    expect(p.sentence).toMatch(/The unclassified ones stay untouched\./);
  });

  it('an already-labelled ledger says so, instead of showing an empty table', () => {
    expect(previewBackfill([]).sentence).toMatch(/every row already carries a source/);
    expect(previewBackfill([]).would_write).toBe(0);
  });

  it('every row lands in exactly one group', () => {
    const p = previewBackfill(rows);
    expect(p.groups.reduce((n, g) => n + g.rows, 0)).toBe(rows.length);
  });
});

describe('☠ THE ROUTE REFUSES TO WRITE AGAINST A PICTURE THAT MOVED', () => {
  const src = () => require('node:fs')
    .readFileSync(require('node:path').join(__dirname, 'index.js'), 'utf8');
  const code = () => src().split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

  it('the preview only reads — no UPDATE, no INSERT', () => {
    const body = code().slice(code().indexOf("'/api/admin/credits/backfill-preview'"),
                              code().indexOf("'/api/admin/credits/backfill-apply'"));
    expect(body).not.toMatch(/UPDATE credits_history/);
    expect(body).not.toMatch(/INSERT INTO/);
    expect(body).toMatch(/WHERE ch\.source IS NULL/);
  });

  it('apply demands the number the owner was actually shown', () => {
    // An approval is for a specific picture. If rows arrived or vanished in
    // between, that approval was for something else.
    expect(code()).toMatch(/expected !== rows\.length/);
    expect(code()).toMatch(/status\(409\)/);
  });

  it('☠ it never overwrites a source already decided', () => {
    // Re-running must be safe. Without the guard a second pass could relabel
    // rows the first pass — or a human — had already settled.
    expect(code()).toMatch(/SET source = \$1 WHERE id = ANY\(\$2\) AND source IS NULL/);
  });

  it('and writes in chunks rather than one lock over the whole ledger', () => {
    // credits_history is written by every generation. A single UPDATE over
    // tens of thousands of ids holds a lock across all of them.
    expect(code()).toMatch(/i \+= 500/);
  });

  it('rows it cannot place are skipped, not defaulted', () => {
    expect(code()).toMatch(/if \(!source\) continue;/);
  });

  it('the whole thing is one transaction — all labelled, or none', () => {
    const body = code().slice(code().indexOf("'/api/admin/credits/backfill-apply'"));
    expect(body).toMatch(/BEGIN/);
    expect(body).toMatch(/COMMIT/);
    expect(body).toMatch(/ROLLBACK/);
  });
});
