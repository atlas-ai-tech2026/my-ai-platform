// ─── promo-invite-matching.test.js ───────────────────────────────────────────
// ☠ TEN OF EIGHTY-FOUR PEOPLE COULD NOT REDEEM THE CODE THEY WERE INVITED TO.
//
// Live, during the SPA New Academy workshop on 2026-09-02. At least four
// complained; osama.himselff@gmail.com tried TWELVE times in twenty minutes.
// Every one of them was told "This code is invalid, expired, or already used",
// which was false in all three particulars.
//
// ── THE CAUSE ──────────────────────────────────────────────────────────────
// mayRedeem normalised the TYPED address and trusted the STORED one:
//
//     const set = invited instanceof Set ? invited : new Set(invited.map(normalizeEmail));
//
// and the redeem route hands it a Set built straight from the database:
//
//     invited: new Set(rows.map((r) => r.email))
//
// So `ahmed@gmail.com` was compared against `Ahmed@Gmail.com` and refused.
// In that one sheet: NINE addresses with capital letters, plus one carrying an
// invisible RIGHT-TO-LEFT MARK that Arabic Excel had inserted silently.
//
// The invisible character is the memorable half; the capital letters are the
// bigger half, and they had been failing quietly since invite lists shipped.
//
// ── WHY BOTH SIDES, RATHER THAN CLEANING THE IMPORT ────────────────────────
// Normalising at COMPARISON repairs every list already in the database — no
// re-upload, nobody's row edited. Cleaning only the import would have fixed
// the next workshop and left this one broken.

import { describe, it, expect } from 'vitest';
import { mayRedeem, normalizeEmail } from './promo-audience.js';

/** Exactly what the redeem route builds: a Set of RAW database rows. */
const asStored = (...rows) => new Set(rows);

describe('☠ THE ADDRESS AS TYPED MUST MATCH THE ADDRESS AS STORED', () => {
  it('a stored address with CAPITALS still matches — nine people, silently', () => {
    expect(mayRedeem({ email: 'ahmed@gmail.com', invited: asStored('Ahmed@Gmail.com') }).allowed).toBe(true);
    expect(mayRedeem({ email: 'ahmed@gmail.com', invited: asStored('AHMED@GMAIL.COM') }).allowed).toBe(true);
  });

  it('☠ and one carrying an INVISIBLE right-to-left mark', () => {
    // A real U+200F, the character Arabic Excel put in front of the address.
    // It renders as nothing in Excel, in the invites drawer and in an email.
    const stored = '‏osama.himselff@gmail.com';
    expect(stored).not.toBe('osama.himselff@gmail.com');          // genuinely different bytes
    expect(mayRedeem({ email: 'osama.himselff@gmail.com', invited: asStored(stored) }).allowed).toBe(true);
  });

  it('and every other invisible that survives a copy-paste', () => {
    for (const [name, ch] of [
      ['ZWSP', '​'], ['ZWNJ', '‌'], ['ZWJ', '‍'], ['LRM', '‎'],
      ['RLM', '‏'], ['LRE', '‪'], ['RLO', '‮'],
      ['word joiner', '⁠'], ['BOM', '﻿'], ['NBSP', ' '],
    ]) {
      expect(mayRedeem({ email: 'a@b.com', invited: asStored(`${ch}a@b.com`) }).allowed,
        `a stored address with a ${name} could not be redeemed`).toBe(true);
    }
  });

  it('and stray spaces at either end', () => {
    expect(mayRedeem({ email: 'a@b.com', invited: asStored('  a@b.com  ') }).allowed).toBe(true);
  });

  it('the mess works in the other direction too', () => {
    // Somebody pasting their own address into the box brings the marks with it.
    expect(mayRedeem({ email: '‏  Ahmed@Gmail.COM ', invited: asStored('ahmed@gmail.com') }).allowed).toBe(true);
  });
});

describe('☠ AND SOMEBODY GENUINELY UNINVITED IS STILL REFUSED', () => {
  it('a different address does not get in', () => {
    const v = mayRedeem({ email: 'stranger@gmail.com', invited: asStored('ahmed@gmail.com') });
    expect(v.allowed).toBe(false);
    expect(v.reason).toBe('not-invited');
  });

  it('☠ stripping does not make two DIFFERENT people equal', () => {
    // The failure this fix could plausibly introduce: strip too much and
    // separate addresses collide, letting the wrong person redeem.
    expect(normalizeEmail('a.hmed@gmail.com')).not.toBe(normalizeEmail('ahmed@gmail.com'));
    expect(normalizeEmail('ahmed+1@gmail.com')).not.toBe(normalizeEmail('ahmed@gmail.com'));
    expect(normalizeEmail('ahmed@gmail.com')).not.toBe(normalizeEmail('ahmed@gmail.co'));
    expect(mayRedeem({ email: 'a.hmed@gmail.com', invited: asStored('ahmed@gmail.com') }).allowed).toBe(false);
  });

  it('an empty or absent address is refused, not treated as a match', () => {
    for (const e of ['', '   ', '‏', null, undefined]) {
      expect(mayRedeem({ email: e, invited: asStored('ahmed@gmail.com') }).allowed,
        `${JSON.stringify(e)} was allowed in`).toBe(false);
    }
  });

  it('an already-redeemed person is still refused first', () => {
    const v = mayRedeem({ email: 'ahmed@gmail.com', invited: asStored('Ahmed@Gmail.com'), alreadyRedeemed: true });
    expect(v.reason).toBe('already-redeemed');
  });

  it('and an OPEN code is still open — the live codes are unchanged', () => {
    expect(mayRedeem({ email: 'anyone@gmail.com', invited: null }).reason).toBe('open-code');
    expect(mayRedeem({ email: 'anyone@gmail.com', invited: new Set() }).reason).toBe('open-code');
  });
});

describe('lists already in the database are repaired without re-uploading', () => {
  it('the comparison normalises the STORED side, not just the import', () => {
    // This is the half that matters today: the SPA list is already uploaded,
    // and those ten people are stuck right now. Cleaning only new imports
    // would fix the next workshop and leave this one broken.
    const alreadyInTheDatabase = asStored('‏osama.himselff@gmail.com', 'Reema7133@Gmail.com');
    expect(mayRedeem({ email: 'osama.himselff@gmail.com', invited: alreadyInTheDatabase }).allowed).toBe(true);
    expect(mayRedeem({ email: 'reema7133@gmail.com', invited: alreadyInTheDatabase }).allowed).toBe(true);
  });

  it('and new imports are stored clean, so the drawer is readable', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const src = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
    expect(src).toMatch(/\[created\.id, normalizeEmail\(email\)\]/);
  });
});

describe('☠ AND THE SEAT IS TICKED OFF AS TAKEN', () => {
  // The second half of the same bug, and the half nobody would have reported.
  //
  // The tick-off ran in SQL as `LOWER(email) = LOWER($3)`. That agrees with
  // mayRedeem about CAPITALS and disagrees about an INVISIBLE MARK — so once
  // the fix above let osama through, he would have redeemed successfully and
  // his invitation would have stayed open forever. `redeemed_by` is the column
  // the owner reads to see who has taken up their seat: it would have shown
  // the code as fully redeemed and every seat still empty.
  //
  // Fixed by choosing the ROW in JS, with the same comparison that admitted
  // the person, and updating by primary key.

  const src = () => require('node:fs')
    .readFileSync(require('node:path').join(__dirname, 'index.js'), 'utf8');

  /**
   * The source with whole-line `//` comments dropped.
   *
   * Needed because the comment recording this fix QUOTES the SQL it removed,
   * and the first version of the test below matched its own explanation and
   * failed. A test that reads prose is not reading the program.
   */
  const code = () => src().split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

  it('the tick-off no longer re-decides the match in SQL', () => {
    expect(code()).not.toMatch(/LOWER\(email\) = LOWER\(\$3\)/);
    // and the stripper really is looking at the program, not at nothing
    expect(code()).toMatch(/UPDATE promo_code_emails/);
  });

  it('it updates the row mayRedeem matched, by primary key', () => {
    expect(src()).toMatch(/UPDATE promo_code_emails SET redeemed_by = \$2, redeemed_at = NOW\(\)\s*\n\s*WHERE id = \$1 AND redeemed_at IS NULL/);
    expect(src()).toMatch(/invitedRows\.rows\.find\(\(r\) => normalizeEmail\(r\.email\) === mine\)/);
  });

  it('and the row it picks is the one with the mark, not a lookalike', () => {
    // The selection expression, run on rows shaped like the database's.
    const rows = [
      { id: 11, email: 'someone.else@gmail.com' },
      { id: 22, email: '‏osama.himselff@gmail.com' },   // real U+200F
      { id: 33, email: 'Osama.Himselff@Hotmail.com' },  // a genuinely different person
    ];
    const mine = normalizeEmail('osama.himselff@gmail.com');
    expect(rows.find((r) => normalizeEmail(r.email) === mine)?.id).toBe(22);
  });

  it('an open code picks no row at all, and skips the update', () => {
    const mine = normalizeEmail('anyone@gmail.com');
    expect([].find((r) => normalizeEmail(r.email) === mine)).toBeUndefined();
    expect(src()).toMatch(/if \(invitation\) \{/);
  });
});
