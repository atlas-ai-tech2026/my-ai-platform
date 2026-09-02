// ─── email-normalize.test.js ─────────────────────────────────────────────────
// ☠ THE PROMO BUG WAS THE SMALLEST OF FOUR.
//
// Fixing the invite-list comparison on 2026-09-02 showed the same fault in
// three more places, and one of them is worse than the bug that was reported.
//
// ── THE WORSE ONE: ACCOUNTS CREATED UNDER A NAME NOBODY CAN TYPE ────────────
// normalizeBulkEmails did `.trim().toLowerCase()` and validated with
// `/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/`. JavaScript's \s does NOT match a
// right-to-left mark, so `[^\s@]` accepts it: the address was classified VALID
// and an ACCOUNT WAS CREATED for it. Sign-in then fails, password reset finds
// nobody, and every admin screen displays an address that looks exactly right.
//
// The promo bug refused loudly. This one SUCCEEDED and left no error anywhere.
//
// ── AND THE ORDINARY ONE: PASTING YOUR OWN ADDRESS ──────────────────────────
// Register, sign in and forgot-password all lowercased and trimmed. Anyone
// copying their address out of an Arabic mail client brings the mark with it
// and is told their account does not exist.

import { describe, it, expect } from 'vitest';
import { normalizeEmail } from './email-normalize.js';
import { normalizeBulkEmails } from './bulk-helpers.js';
import { normaliseEmail as waitlistEmail } from './waitlist.js';

/**
 * Everything that survives a copy-paste and is not part of an address.
 *
 * Written as escapes rather than literal characters ON PURPOSE: the first
 * version of this table pasted the real glyphs, and the non-breaking space
 * arrived as an ordinary space — the test then asserted that a plain space is
 * stripped from the middle of an address, which it is not and must not be.
 * A table of invisible characters is the one place you cannot read the source.
 *
 * The RLM is also tested as a REAL character in promo-invite-matching.test.js,
 * because that is the one that actually happened.
 */
const MARKS = {
  'ZWSP U+200B': '\u200B', 'ZWNJ U+200C': '\u200C', 'ZWJ U+200D': '\u200D',
  'LRM U+200E': '\u200E', 'RLM U+200F': '\u200F', 'LRE U+202A': '\u202A',
  'RLE U+202B': '\u202B', 'PDF U+202C': '\u202C', 'LRO U+202D': '\u202D',
  'RLO U+202E': '\u202E', 'word joiner U+2060': '\u2060',
  'BOM U+FEFF': '\uFEFF', 'NBSP U+00A0': '\u00A0',
};

describe('normalizeEmail', () => {
  it('☠ strips every invisible, wherever it sits', () => {
    for (const [name, ch] of Object.entries(MARKS)) {
      expect(normalizeEmail(`${ch}ahmed@gmail.com`), name).toBe('ahmed@gmail.com');
      expect(normalizeEmail(`ahmed@gmail.com${ch}`), name).toBe('ahmed@gmail.com');
      expect(normalizeEmail(`ahm${ch}ed@gmail.com`), name).toBe('ahmed@gmail.com');
    }
  });

  it('lowercases and trims, as it always did', () => {
    expect(normalizeEmail('  Ahmed@Gmail.COM ')).toBe('ahmed@gmail.com');
  });

  it('☠ and stops there — two different people stay two different people', () => {
    // The failure this whole change could introduce. Gmail treats dots and
    // plus-addressing as noise; most providers do not, and letting the wrong
    // person into a paid seat or an account is worse than the bug being fixed.
    expect(normalizeEmail('a.hmed@gmail.com')).not.toBe(normalizeEmail('ahmed@gmail.com'));
    expect(normalizeEmail('ahmed+spa@gmail.com')).not.toBe(normalizeEmail('ahmed@gmail.com'));
    expect(normalizeEmail('ahmed@gmail.com')).not.toBe(normalizeEmail('ahmed@googlemail.com'));
  });

  it('survives nothing at all', () => {
    for (const junk of [null, undefined, '', '   ', 123]) {
      expect(() => normalizeEmail(junk)).not.toThrow();
    }
    expect(normalizeEmail(null)).toBe('');
    expect(normalizeEmail('\u200F')).toBe('');   // a mark and nothing else
  });
});

describe('☠ BULK PROVISIONING NO LONGER CREATES UNREACHABLE ACCOUNTS', () => {
  it('an address with a mark is cleaned, not accepted as-is', () => {
    const { valid, invalid } = normalizeBulkEmails(['\u200Fosama.himselff@gmail.com']);
    expect(valid).toEqual(['osama.himselff@gmail.com']);
    expect(invalid).toEqual([]);
  });

  it('☠ and the account it creates is one its owner can sign in to', () => {
    // The whole point, stated as the thing the customer experiences.
    const [created] = normalizeBulkEmails(['\u200FOsama.Himselff@Gmail.com']).valid;
    const typedAtTheLoginBox = normalizeEmail('osama.himselff@gmail.com');
    expect(created).toBe(typedAtTheLoginBox);
  });

  it('the marked and unmarked forms now DEDUPE instead of making two rows', () => {
    // Two rows meant two accounts, two passwords emailed, and one of them dead.
    const { valid, dupes } = normalizeBulkEmails(['ahmed@gmail.com', '\u200Fahmed@gmail.com', 'AHMED@GMAIL.COM']);
    expect(valid).toEqual(['ahmed@gmail.com']);
    expect(dupes).toBe(2);
  });

  it('genuine rubbish is still rejected, not silently cleaned into something', () => {
    const { valid, invalid } = normalizeBulkEmails(['not-an-email', 'a@b', '\u200F', 'ok@example.com']);
    expect(valid).toEqual(['ok@example.com']);
    expect(invalid).toEqual(['not-an-email', 'a@b']);   // the bare mark is empty, so skipped
  });
});

describe('the waitlist keeps a row that can be matched to a sign-up', () => {
  it('accepts a pasted address with a mark', () => {
    expect(waitlistEmail('\u200Fahmed@gmail.com')).toBe('ahmed@gmail.com');
  });

  it('and still refuses what cannot be delivered', () => {
    for (const junk of ['', 'nope', 'a@b', 'two@at@signs.com', 'x@y.']) {
      expect(waitlistEmail(junk), junk).toBeNull();
    }
  });
});

describe('☠ WHAT WAS DELIBERATELY LEFT ALONE', () => {
  const read = (f) => require('node:fs')
    .readFileSync(require('node:path').join(__dirname, f), 'utf8');

  it('the unsubscribe token still hashes the OLD form — links already sent must keep working', () => {
    // unsubscribeToken() is an HMAC over `.trim().toLowerCase()` of the
    // address, and /api/unsubscribe verifies against it. Normalising ONE side
    // would break every unsubscribe link already in someone's inbox, and
    // normalising both would break the ones minted before the change.
    // A dirty address here costs a failed unsubscribe click; changing it costs
    // every unsubscribe click. Left as it is, on purpose.
    expect(read('mailer.js')).toMatch(/\.update\(String\(email\)\.trim\(\)\.toLowerCase\(\)\)/);
    expect(read('index.js')).toMatch(/const email = String\(req\.query\?\.email \|\| ''\)\.trim\(\)\.toLowerCase\(\);/);
  });

  it('and the paths a person actually types into DO normalise', () => {
    const src = read('index.js');
    // register, login, forgot-password, and the admin lookups by pasted address
    expect((src.match(/normalizeEmail\(req\.body\?\.email\)/g) || []).length).toBeGreaterThanOrEqual(5);
    expect((src.match(/normalizeEmail\(req\.query\.email\)/g) || []).length).toBe(3);
  });
});
