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
import { groupBatches, totalBatches, batchType, batchName, codeIn, nameKey, unredeemedCodes } from './credit-batches.js';

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

// ─── THE SHAPE THE DATABASE ACTUALLY SENDS ──────────────────────────────────
// Every test above this line feeds ISO strings, because that is the shape I
// invented while writing the function. node-postgres does not send strings: a
// timestamptz column arrives as a JS Date OBJECT. `String(aDate).slice(0, 10)`
// is "Thu Aug 20", so every row on the owner's screen read "Invalid Date" and
// the table was ordered alphabetically by the name of the weekday — while
// 4,900 tests passed.
//
// RULE 2, exactly: the function was correct, and nobody could read the screen.
// These tests pass rows in BOTH shapes, and assert the OUTPUT is a date a
// browser can parse — not merely that a string came back.
describe('rows arriving as pg Date objects, not ISO strings', () => {
  const bothShapes = {
    'pg Date objects': (iso) => new Date(iso),
    'ISO strings': (iso) => iso,
  };

  for (const [shape, at] of Object.entries(bothShapes)) {
    it(`emits parseable dates from ${shape}`, () => {
      const batches = groupBatches([
        { amount: 100, reason: 'spa 4', user_id: 1, created_at: at('2026-08-20T09:00:00Z') },
        { amount: 200, reason: 'Spa 4.', user_id: 2, created_at: at('2026-08-27T09:00:00Z') },
      ]);
      expect(batches).toHaveLength(1);
      for (const key of ['date', 'date_to']) {
        // A browser renders these with `new Date(b.date + 'T00:00:00')`.
        expect(Number.isNaN(new Date(`${batches[0][key]}T00:00:00`).getTime())).toBe(false);
        expect(batches[0][key]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
      expect(batches[0].date).toBe('2026-08-20');
      expect(batches[0].date_to).toBe('2026-08-27');
      expect(batches[0].days).toBe(2);
      // first/last go to the browser to be formatted in local time.
      expect(Number.isNaN(new Date(batches[0].first).getTime())).toBe(false);
    });

    it(`sorts newest first from ${shape} — not by the name of the weekday`, () => {
      // ☠ THE DATES ARE CHOSEN, NOT ARBITRARY. Weekday names sort
      // Fri < Mon < Sat < Sun < Thu < Tue < Wed, so for a descending STRING
      // sort to disagree with a chronological one the newest date must fall on
      // a Friday and the oldest on a Wednesday. My first attempt used three
      // dates whose two orderings happened to coincide, so it passed against
      // the broken sort and proved nothing.
      //   Wed 7 Jan 2026  <  Mon 1 Jun 2026  <  Fri 4 Dec 2026
      const batches = groupBatches([
        { amount: 10, reason: 'january', user_id: 1, created_at: at('2026-01-07T09:00:00Z') },
        { amount: 10, reason: 'august', user_id: 2, created_at: at('2026-06-01T09:00:00Z') },
        { amount: 10, reason: 'december', user_id: 3, created_at: at('2026-12-04T09:00:00Z') },
      ]);
      expect(batches.map((b) => b.name)).toEqual(['december', 'august', 'january']);
    });
  }
});

// ─── A PROMO BATCH IS NAMED BY ITS DESCRIPTION ──────────────────────────────
// Owner, 2026-09-05: "There is one column called promo code and you write it
// there. It is not necessary to write it two times. The name will be the
// description of the promo code, and keep the promo code as is."
describe('promo batches are named by the description, not the code', () => {
  const describe_ = {
    'VOXEL-VPW9-DY93': 'SPA News Academy 5th 4th',
    'VOXEL-V8YK-H7A7': 'Ali Bin Awad Demo',
    'VOXEL-A2RF-VR54': 'Ali Bin Awad Demo',
  };
  const promoRow = (code, user_id) => ({
    amount: 158, reason: `promo: ${code}`, source: 'promo', user_id,
    created_at: new Date('2026-09-03T09:00:00Z'),
  });

  it('shows the description in Name and the code in Promo code', () => {
    const [b] = groupBatches([promoRow('VOXEL-VPW9-DY93', 1)], { describe: describe_ });
    expect(b.name).toBe('SPA News Academy 5th 4th');
    expect(b.code).toBe('VOXEL-VPW9-DY93');
  });

  it('never writes the same string in both columns', () => {
    const batches = groupBatches(
      Object.keys(describe_).map((c, i) => promoRow(c, i + 1)), { describe: describe_ });
    expect(batches).toHaveLength(3);
    for (const b of batches) expect(b.name).not.toBe(b.code);
  });

  it('keeps two codes that share one description as SEPARATE rows', () => {
    // "Ali Bin Awad Demo" is two codes on production. Merging them would put
    // one code's string beside another code's money.
    const batches = groupBatches(
      [promoRow('VOXEL-V8YK-H7A7', 1), promoRow('VOXEL-A2RF-VR54', 2)], { describe: describe_ });
    expect(batches).toHaveLength(2);
    expect(batches.map((b) => b.code).sort())
      .toEqual(['VOXEL-A2RF-VR54', 'VOXEL-V8YK-H7A7']);
    expect(new Set(batches.map((b) => b.name))).toEqual(new Set(['Ali Bin Awad Demo']));
  });

  it('falls back to the code when there is no description', () => {
    // A blank Name column would be worse than the repetition it replaces.
    for (const d of [{}, { 'VOXEL-ZZZZ-0000': '' }, { 'VOXEL-ZZZZ-0000': '   ' }, null]) {
      const [b] = groupBatches([promoRow('VOXEL-ZZZZ-0000', 1)], { describe: d });
      expect(b.name).toBe('VOXEL-ZZZZ-0000');
    }
  });

  it('leaves hand-typed grants alone — they have no code to describe', () => {
    const [b] = groupBatches(
      [{ amount: 50, reason: 'spa 4', user_id: 1, created_at: new Date('2026-08-20T09:00:00Z') }],
      { describe: describe_ });
    expect(b.name).toBe('spa 4');
    expect(b.code).toBe(null);
  });

  it('matches the code case-insensitively', () => {
    const [b] = groupBatches([promoRow('voxel-vpw9-dy93', 1)], { describe: describe_ });
    expect(b.name).toBe('SPA News Academy 5th 4th');
  });
});

// ─── CODES THAT EXIST BUT WERE NEVER USED ───────────────────────────────────
// Amr, 2026-09-05: "The total number of promo codes on production is 27. I
// don't know why it's less than this. Maybe because you only add the activated
// one?" Active is never consulted — only whether anybody redeemed it.
describe('unredeemedCodes', () => {
  const promos = [
    { code: 'VOXEL-USED-0001', description: 'SPA News Academy', active: true },
    { code: 'VOXEL-DEAD-0002', description: 'Old workshop', active: false },
    { code: 'VOXEL-NEVR-0003', description: 'Made but never handed out', active: true },
    { code: 'VOXEL-NEVR-0004', description: null, active: true },
  ];
  const reasons = [
    'promo: VOXEL-USED-0001',
    'promo top-up: VOXEL-DEAD-0002 raised to 158',
    'bulk top-up: SPA News Academy V1.2',
  ];

  it('lists only the codes nobody redeemed', () => {
    expect(unredeemedCodes(promos, reasons).map((c) => c.code))
      .toEqual(['VOXEL-NEVR-0003', 'VOXEL-NEVR-0004']);
  });

  it('a DEACTIVATED code that was used is NOT listed — active is irrelevant', () => {
    // The whole point of his question. A code redeemed 60 times and then
    // switched off is real money and belongs on an invoice.
    expect(unredeemedCodes(promos, reasons).map((c) => c.code))
      .not.toContain('VOXEL-DEAD-0002');
  });

  it('an ACTIVE code that was never used IS listed', () => {
    expect(unredeemedCodes(promos, reasons).map((c) => c.code))
      .toContain('VOXEL-NEVR-0003');
  });

  it('counts a top-up as use — the code still moved money', () => {
    expect(unredeemedCodes(
      [{ code: 'VOXEL-TOPU-0005', description: 'x', active: true }],
      ['promo top-up: VOXEL-TOPU-0005 raised from 100 to 158'],
    )).toEqual([]);
  });

  it('carries the description and whether it is switched off', () => {
    const [a, b] = unredeemedCodes(promos, reasons);
    expect(a).toEqual({
      code: 'VOXEL-NEVR-0003', description: 'Made but never handed out', active: true,
    });
    expect(b.description).toBe(null);
  });

  it('matches the code however the reason was cased', () => {
    expect(unredeemedCodes(
      [{ code: 'VOXEL-CASE-0006', active: true }], ['promo: voxel-case-0006'],
    )).toEqual([]);
  });

  it('says everything is unredeemed when the ledger query failed', () => {
    // The endpoint swallows a failed query into []. Better to over-report the
    // gap than to claim every code was used.
    expect(unredeemedCodes(promos, []).map((c) => c.code)).toHaveLength(4);
  });

  it('survives empty and missing input', () => {
    expect(unredeemedCodes()).toEqual([]);
    expect(unredeemedCodes([], [])).toEqual([]);
    expect(unredeemedCodes([{ description: 'no code at all' }], [])).toEqual([]);
  });
});

// ─── BATCHES THE OWNER DOES NOT BILL FOR ────────────────────────────────────
// Amr, 2026-09-05: "Is it a good idea deploying with test [rows]? If there is
// something we need to do to remove it from the table, because it's not
// logical. I just want the actual data which I have."
//
// "dahi test" and "radwan from senyar agency ( test )" must not sit inside a
// figure he invoices from. They must ALSO not be deleted: those people hold
// the credits, the lots are real, and removing a credits_history row to tidy a
// report would break a balance. So the row stays and leaves the total.
describe('excluded batches', () => {
  const rows = [
    { amount: 9480, reason: 'promo: VOXEL-REAL-0001', source: 'promo', user_id: 1,
      created_at: new Date('2026-09-03T09:00:00Z') },
    { amount: 100, reason: 'dahi test', user_id: 2, created_at: new Date('2026-09-02T09:00:00Z') },
  ];
  const keyOf = (name) => groupBatches(rows).find((b) => b.name === name).key;

  it('marks the batch instead of dropping it', () => {
    const out = groupBatches(rows, { excluded: [keyOf('dahi test')] });
    expect(out).toHaveLength(2);
    expect(out.find((b) => b.name === 'dahi test').excluded).toBe(true);
    expect(out.find((b) => b.name !== 'dahi test').excluded).toBe(false);
  });

  it('leaves it out of the total', () => {
    const out = groupBatches(rows, { excluded: [keyOf('dahi test')] });
    const t = totalBatches(out);
    expect(t.credits).toBe(9480);
    expect(t.accounts).toBe(1);
    expect(t.batches).toBe(1);
  });

  it('SAYS what it left out — the cure cannot be a second silence', () => {
    const t = totalBatches(groupBatches(rows, { excluded: [keyOf('dahi test')] }));
    expect(t.excluded).toBe(1);
    expect(t.excluded_credits).toBe(100);
  });

  it('counts everything when nothing is excluded', () => {
    const t = totalBatches(groupBatches(rows));
    expect(t.credits).toBe(9580);
    expect(t.excluded).toBe(0);
    expect(t.excluded_credits).toBe(0);
  });

  it('ignores a key that no longer matches any batch', () => {
    const t = totalBatches(groupBatches(rows, { excluded: ['Manual grant|gone'] }));
    expect(t.credits).toBe(9580);
    expect(t.excluded).toBe(0);
  });

  it('is reversible — nothing about the batch itself changed', () => {
    const on = groupBatches(rows, { excluded: [keyOf('dahi test')] })
      .find((b) => b.name === 'dahi test');
    const off = groupBatches(rows).find((b) => b.name === 'dahi test');
    expect(on.credits).toBe(off.credits);
    expect(on.accounts).toBe(off.accounts);
    expect({ ...on, excluded: false }).toEqual(off);
  });
});

// ─── A PROMO ROW IS DATED BY THE DAY THE CODE WAS GENERATED ─────────────────
// Amr, 2026-09-05: "I attach for you the whole promo code created day. You can
// put it on the same place of the promo code."
//
// The ledger only knows when people REDEEMED. That is a fact about the
// attendees' afternoon, not about the workshop he bills for — VOXEL-VPW9-DY93
// was generated on 3 September and its Promo Codes row says 9/3/2026, so that
// is the invoice date whether the first person used it that night or the next.
describe('promo batches are dated by the code, not the redemption', () => {
  const redeemed = (code, iso, user_id) => ({
    amount: 158, reason: `promo: ${code}`, source: 'promo', user_id, created_at: new Date(iso),
  });
  const describe_ = { 'VOXEL-VPW9-DY93': 'SPA News Academy 5th 4th' };
  const issued = { 'VOXEL-VPW9-DY93': new Date('2026-09-03T12:00:00Z') };

  it('uses the code creation day even when redemption came later', () => {
    const [b] = groupBatches([redeemed('VOXEL-VPW9-DY93', '2026-09-04T22:00:00Z', 1)],
      { describe: describe_, issued });
    expect(b.date).toBe('2026-09-03');
    expect(b.first_used).toBe('2026-09-04');
  });

  it('keeps the redemption day rather than overwriting it', () => {
    // The audit trail is the reason this is safe: nothing is lost, it is just
    // not the number on the invoice.
    const [b] = groupBatches([
      redeemed('VOXEL-VPW9-DY93', '2026-09-04T09:00:00Z', 1),
      redeemed('VOXEL-VPW9-DY93', '2026-09-06T09:00:00Z', 2),
    ], { describe: describe_, issued });
    expect(b.date).toBe('2026-09-03');
    expect(b.first_used).toBe('2026-09-04');
    expect(b.date_to).toBe('2026-09-06');
    expect(b.issued).toMatch(/^2026-09-03T/);
  });

  it('leaves grants and bulk on their first ledger day', () => {
    // For a hand-typed grant the ledger entry IS the moment it was generated,
    // which is the date Amr gave for spa 4: 20 August.
    const [b] = groupBatches(
      [{ amount: 395, reason: 'spa 4', user_id: 1, created_at: new Date('2026-08-20T20:00:00Z') }],
      { describe: describe_, issued });
    expect(b.date).toBe('2026-08-20');
    expect(b.issued).toBe(null);
  });

  it('falls back to the first ledger day for a code with no creation date', () => {
    const [b] = groupBatches([redeemed('VOXEL-GONE-0000', '2026-09-04T09:00:00Z', 1)], { issued });
    expect(b.date).toBe('2026-09-04');
    expect(b.issued).toBe(null);
  });

  it('orders the table by the date it shows, not by a hidden one', () => {
    // A column ordered by a number it does not display looks unsorted.
    const out = groupBatches([
      redeemed('VOXEL-VPW9-DY93', '2026-09-10T09:00:00Z', 1),  // made 3 Sep, used 10 Sep
      { amount: 50, reason: 'later grant', user_id: 2, created_at: new Date('2026-09-05T09:00:00Z') },
    ], { describe: describe_, issued });
    expect(out.map((b) => b.date)).toEqual(['2026-09-05', '2026-09-03']);
  });

  it('matches the code case-insensitively', () => {
    const [b] = groupBatches([redeemed('voxel-vpw9-dy93', '2026-09-09T09:00:00Z', 1)],
      { describe: describe_, issued });
    expect(b.date).toBe('2026-09-03');
  });
});
