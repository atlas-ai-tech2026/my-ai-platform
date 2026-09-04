// ─── credit-batches.test.js ──────────────────────────────────────────────────
// One row per thing you did, not per person.
//
// Owner, 2026-09-04: "After the workshop I go manually to the promo codes and
// take the name, the number of credits, the promo code, the number of accounts
// that used it, then put it manually on the invoice. This will take headache."
//
// It did. The ledger holds one row per PERSON, so a 71-person top-up meant
// reading 71 rows and adding them up by hand.
//
// ☠ AND HIS OWN DATA IS WHY THE GROUPING IS LOOSE. The SPA 4 credits were
// typed THREE ways — "spa 4", "Spa 4", and "Spa 4." with a full stop. Grouped
// exactly, one workshop becomes three invoice lines and every total is wrong
// in a way that looks right.

import { describe, it, expect } from 'vitest';
import { groupBatches, totalBatches, batchType, batchName, codeIn, nameKey } from './credit-batches.js';

const row = (o) => ({ amount: 158, user_id: 1, created_at: '2026-09-04T14:00:00Z', ...o });

describe('what kind of thing a batch was', () => {
  it.each([
    [{ source: 'promo', reason: 'promo: VOXEL-X' }, 'Promo code'],
    [{ source: 'promo', reason: 'promo top-up: VOXEL-X 158 -> 250' }, 'Promo top-up'],
    [{ source: 'bulk', reason: 'bulk top-up: SPA' }, 'Bulk top-up'],
    [{ source: 'bulk', reason: 'bulk provision: Basic plan' }, 'Bulk - new accounts'],
    [{ source: 'gift', reason: 'gift card: ABC' }, 'Gift card'],
    [{ source: 'manual', reason: 'spa 4' }, 'Manual grant'],
  ])('%o is %s', (r, expected) => expect(batchType(r)).toBe(expected));

  it('an unlabelled row is "Other" rather than being guessed at', () => {
    expect(batchType({ source: null, reason: 'x' })).toBe('Other');
  });
});

describe('the name shown on the invoice line', () => {
  it('strips the machinery and keeps what a person typed', () => {
    expect(batchName('bulk top-up: SPA News Academy V1.2')).toBe('SPA News Academy V1.2');
    expect(batchName('bulk provision: Basic plan - SPA News V1.2')).toBe('SPA News V1.2');
    expect(batchName('promo: VOXEL-VPW9-DY93')).toBe('VOXEL-VPW9-DY93');
    expect(batchName('spa 4')).toBe('spa 4');
  });

  it('a batch with no reason says so, rather than showing an empty cell', () => {
    expect(batchName('')).toBe('(no reason given)');
    expect(batchName('bulk top-up: ')).toBe('(no reason given)');
  });

  it('finds the promo code when there is one, and nothing when there is not', () => {
    expect(codeIn('promo: VOXEL-VPW9-DY93')).toBe('VOXEL-VPW9-DY93');
    expect(codeIn('bulk top-up: SPA News Academy')).toBeNull();
  });
});

describe('☠ THREE SPELLINGS OF ONE WORKSHOP ARE ONE INVOICE LINE', () => {
  const spa = [
    row({ source: 'manual', reason: 'spa 4', amount: 395, user_id: 1, created_at: '2026-08-20T22:00:00Z' }),
    row({ source: 'manual', reason: 'Spa 4', amount: 395, user_id: 2, created_at: '2026-08-20T22:05:00Z' }),
    row({ source: 'manual', reason: 'Spa 4.', amount: 395, user_id: 3, created_at: '2026-08-20T22:07:00Z' }),
  ];

  it('collapses case and a trailing full stop into one batch', () => {
    const b = groupBatches(spa);
    expect(b).toHaveLength(1);
    expect(b[0].accounts).toBe(3);
    expect(b[0].credits).toBe(1185);
  });

  it('☠ and SAYS it absorbed three spellings, rather than hiding the mess', () => {
    const [b] = groupBatches(spa);
    expect(b.spellings).toBe(3);
    expect(b.spelt).toEqual(expect.arrayContaining(['spa 4', 'Spa 4', 'Spa 4.']));
  });

  it('shows the commonest spelling, never an invented tidy one', () => {
    const many = [...spa, row({ source: 'manual', reason: 'Spa 4', amount: 395, user_id: 4,
      created_at: '2026-08-20T22:09:00Z' })];
    expect(groupBatches(many)[0].name).toBe('Spa 4');   // 2 of them, the most
  });

  it('a batch named one way reports one spelling — the quiet case stays quiet', () => {
    expect(groupBatches([row({ source: 'bulk', reason: 'bulk top-up: SPA' })])[0].spellings).toBe(1);
  });

  it('☠ but genuinely different workshops stay apart', () => {
    // Over-merging would put two customers on one invoice line.
    const b = groupBatches([
      row({ source: 'bulk', reason: 'bulk top-up: SPA News 4', user_id: 1 }),
      row({ source: 'bulk', reason: 'bulk top-up: SPA News 5', user_id: 2 }),
    ]);
    expect(b).toHaveLength(2);
    expect(nameKey('SPA News 4')).not.toBe(nameKey('SPA News 5'));
  });
});

describe('what belongs on an invoice, and what does not', () => {
  it('☠ spending and refunds are excluded — a negative is not a line you bill', () => {
    const b = groupBatches([
      row({ source: 'bulk', reason: 'bulk top-up: SPA', amount: 158 }),
      row({ source: 'system', reason: 'video: Kling 3.0', amount: -12.5, user_id: 2 }),
      row({ source: 'manual', reason: 'took some back', amount: -50, user_id: 3 }),
    ]);
    expect(b).toHaveLength(1);
    expect(b[0].credits).toBe(158);
  });

  it('☠ the same batch across several days is ONE row, with the date range', () => {
    // This test used to assert the opposite — "a date is part of what it was".
    // The owner's data settled it: his SPA 4 grants ran on 20 AND 27 August,
    // and keying by day split one customer into two invoice lines each holding
    // a partial total. He asked for them consolidated. Nothing is lost: the
    // row carries the first date, the last, and how many days it spanned.
    const b = groupBatches([
      row({ source: 'manual', reason: 'spa 4', user_id: 1, amount: 395, created_at: '2026-08-20T22:00:00Z' }),
      row({ source: 'manual', reason: 'Spa 4.', user_id: 2, amount: 103, created_at: '2026-08-27T13:43:00Z' }),
    ]);
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ accounts: 2, credits: 498, days: 2,
      date: '2026-08-20', date_to: '2026-08-27' });
  });

  it('and a batch handed out in one afternoon says one day', () => {
    const b = groupBatches([
      row({ source: 'bulk', reason: 'bulk top-up: SPA', user_id: 1, created_at: '2026-09-04T10:00:00Z' }),
      row({ source: 'bulk', reason: 'bulk top-up: SPA', user_id: 2, created_at: '2026-09-04T10:05:00Z' }),
    ]);
    expect(b[0].days).toBe(1);
    expect(b[0].date).toBe(b[0].date_to);
  });

  it('the same person twice in one batch counts as ONE account', () => {
    const b = groupBatches([
      row({ source: 'bulk', reason: 'bulk top-up: SPA', user_id: 9 }),
      row({ source: 'bulk', reason: 'bulk top-up: SPA', user_id: 9 }),
    ]);
    expect(b[0].accounts).toBe(1);
    expect(b[0].entries).toBe(2);
    expect(b[0].credits).toBe(316);        // the money is still both
  });

  it('newest batch first — what you invoiced last is what you are looking for', () => {
    const b = groupBatches([
      row({ source: 'bulk', reason: 'bulk top-up: OLD', user_id: 1, created_at: '2026-08-01T10:00:00Z' }),
      row({ source: 'bulk', reason: 'bulk top-up: NEW', user_id: 2, created_at: '2026-09-04T10:00:00Z' }),
    ]);
    expect(b.map((x) => x.name)).toEqual(['NEW', 'OLD']);
  });
});

describe('the totals, which are the figures that reach the invoice', () => {
  it('add up credits and accounts across the batches shown', () => {
    const b = groupBatches([
      row({ source: 'bulk', reason: 'bulk top-up: A', user_id: 1, amount: 158 }),
      row({ source: 'bulk', reason: 'bulk top-up: A', user_id: 2, amount: 158 }),
      row({ source: 'promo', reason: 'promo: VOXEL-X', user_id: 3, amount: 100,
        created_at: '2026-09-03T10:00:00Z' }),
    ]);
    const t = totalBatches(b, { creditValueUsd: 0.063333 });
    expect(t).toMatchObject({ batches: 2, accounts: 3, credits: 416 });
    expect(t.usd).toBeCloseTo(26.35, 2);
  });

  it('an empty list totals zero, not NaN', () => {
    expect(totalBatches([])).toMatchObject({ batches: 0, accounts: 0, credits: 0, usd: 0 });
  });
});

describe('☠ THE ROUTE LEAVES NOTHING OUT SILENTLY', () => {
  const code = () => require('node:fs')
    .readFileSync(require('node:path').join(__dirname, 'index.js'), 'utf8')
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

  it('excludes system rows — spend, refund, expiry, signup', () => {
    expect(code()).toMatch(/COALESCE\(ch\.source, ''\) <> 'system'/);
  });

  it('and additions only', () => {
    expect(code()).toMatch(/const where = \['ch\.amount > 0'\]/);
  });

  it('only accepts the four real kinds in the type filter', () => {
    // An unrecognised value must narrow to nothing rather than be ignored,
    // which would silently widen the total.
    expect(code()).toMatch(/\['manual', 'bulk', 'promo', 'gift'\]\.includes\(x\)/);
  });
});

describe('☠ THE HAND-TYPED WORKSHOPS, WHICH WERE NAMED FREELY', () => {
  // Owner, 2026-09-04: "Anything starting with SPA alone, and there is SPA
  // two, and there is SPA four. Anything else is very small and was testing."
  //
  // His grants carry "spa", "spa 2", "spa 3 promo code", "SPA4", "Spa 4.",
  // and one reading "Spa 4 its was his credit and we removed and then we
  // returned agian" — three or four workshops split across NINE invoice lines.
  const grants = [
    'spa', 'SPA', 'Spa',
    'spa 2', 'Spa 2',
    'spa 3', 'spa 3 promo code',
    'spa 4', 'Spa 4', 'Spa 4.', 'SPA4',
    'Spa 4 its was his credit and we removed and then we returned agian',
    'director from spain', 'imad test',
  ].map((reason, i) => ({
    source: 'manual', reason, amount: 395, user_id: i + 1,
    created_at: '2026-08-20T22:00:00Z',
  }));

  const byName = () => Object.fromEntries(
    groupBatches(grants).map((b) => [b.name.toLowerCase(), b]));

  it('SPA4 with no space is the same workshop as spa 4', () => {
    expect(nameKey('SPA4')).toBe(nameKey('spa 4'));
    expect(byName()['spa 4'].accounts).toBe(5);
  });

  it('a reason that STARTS with a workshop belongs to it, whatever follows', () => {
    // "spa 3 promo code" is that workshop's money, not a fifth workshop.
    expect(nameKey('spa 3 promo code')).toBe(nameKey('spa 3'));
    expect(byName()['spa 3'].accounts).toBe(2);
  });

  it('including the long correction note', () => {
    expect(nameKey('Spa 4 its was his credit and we removed and then we returned agian'))
      .toBe(nameKey('spa 4'));
  });

  it('☠ but "director from spain" is NOT a workshop', () => {
    // Without a word boundary after the prefix, "spain" matches "spa" and a
    // person's note becomes a workshop — money filed under the wrong customer.
    expect(nameKey('director from spain')).not.toBe(nameKey('spa'));
    expect(byName()['director from spain'].accounts).toBe(1);
  });

  it('SPA, SPA 2, SPA 3 and SPA 4 stay four separate workshops', () => {
    const names = groupBatches(grants).map((b) => nameKey(b.name));
    for (const k of ['spa', 'spa 2', 'spa 3', 'spa 4']) expect(names).toContain(k);
    expect(new Set(names).size).toBe(6);      // four workshops + two one-offs
  });

  it('and the count of spellings is still reported, so nothing is hidden', () => {
    expect(byName()['spa 4'].spellings).toBe(5);
  });

  it('☠ and the owner\'s CURRENT workshop is NOT folded into the old ones', () => {
    // The bug the first version of this rule had: /^spa\\s*(\\d+)?\\b/ matched
    // "SPA News Academy V1.2" and collapsed it into the old "spa" grants —
    // September's money filed under August's workshop. An existing test
    // caught it. The number is what makes it a match.
    expect(nameKey('SPA News Academy V1.2')).not.toBe('spa');
    expect(nameKey('SPA News 4')).not.toBe(nameKey('spa 4'));
    expect(nameKey('SPA News 4')).not.toBe(nameKey('SPA News 5'));
  });
});
