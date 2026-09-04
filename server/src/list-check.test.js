// ─── list-check.test.js ──────────────────────────────────────────────────────
// ☠ FIFTEEN ACCOUNTS RECEIVED CREDITS TWICE ON THE SAME DAY.
//
// From the owner's own SPA 4 report, 2026-09-03: faai-2011@hotmail.com got 79
// credits at 14:18 and another 395 at 22:17. Fourteen others the same. Nobody
// intended it — there was simply no way to look at a list of 84 addresses and
// see which half was already known before acting on it.
//
// Bulk CREATES accounts and silently skips anyone who already has one. A promo
// code INVITES and silently refuses anyone it does not recognise. Both answer
// "who is already here?" far too late — in a report, after the money moved.
//
// This is the look-before-you-act. Read-only: it takes a list and answers a
// question.

import { describe, it, expect } from 'vitest';
import { splitList, describeSplit, toCsv } from './list-check.js';

describe('splitting a customer list against the accounts we have', () => {
  it('separates the people we know from the people we do not', () => {
    const r = splitList(
      ['ahmed@gmail.com', 'sara@gmail.com', 'newcomer@gmail.com'],
      ['ahmed@gmail.com', 'sara@gmail.com', 'someone.else@gmail.com']);
    expect(r.existing).toEqual(['ahmed@gmail.com', 'sara@gmail.com']);
    expect(r.fresh).toEqual(['newcomer@gmail.com']);
    expect(r.counts).toMatchObject({ submitted: 3, existing: 2, fresh: 1, invalid: 0 });
  });

  it('☠ recognises an account stored with CAPITALS — nine of the 84 were like this', () => {
    // Without normalising the stored side these come back as "new", and the
    // next click creates a SECOND account for a customer who already has one.
    const r = splitList(['ahmed@gmail.com'], ['Ahmed@Gmail.com']);
    expect(r.existing).toEqual(['ahmed@gmail.com']);
    expect(r.fresh).toEqual([]);
  });

  it('☠ and one carrying an invisible mark — the tenth', () => {
    const r = splitList(['osama.himselff@gmail.com'], ['‏osama.himselff@gmail.com']);
    expect(r.existing).toEqual(['osama.himselff@gmail.com']);
  });

  it('and cleans the SUBMITTED side too — Excel puts marks in both', () => {
    const r = splitList(['‏  Ahmed@Gmail.COM '], ['ahmed@gmail.com']);
    expect(r.existing).toEqual(['ahmed@gmail.com']);
  });

  it('counts an address repeated inside the list, rather than double-counting it', () => {
    const r = splitList(['a@b.com', 'a@b.com', 'A@B.com'], []);
    expect(r.fresh).toEqual(['a@b.com']);
    expect(r.counts.duplicates).toBe(2);
  });

  it('reports what cannot be delivered instead of quietly dropping it', () => {
    const r = splitList(['good@example.com', 'not-an-email', 'a@b'], []);
    expect(r.fresh).toEqual(['good@example.com']);
    expect(r.invalid).toEqual(['not-an-email', 'a@b']);
  });

  it('☠ does NOT merge two different people', () => {
    // The failure this could introduce: over-normalising until separate
    // customers collide and one is told they already have the other's account.
    const r = splitList(['a.hmed@gmail.com', 'ahmed+spa@gmail.com'], ['ahmed@gmail.com']);
    expect(r.existing).toEqual([]);
    expect(r.fresh).toEqual(['a.hmed@gmail.com', 'ahmed+spa@gmail.com']);
  });

  it('an empty list is a valid answer, not an error', () => {
    for (const input of [[], '', null, undefined]) {
      expect(() => splitList(input, [])).not.toThrow();
    }
    expect(splitList([], []).counts.submitted).toBe(0);
  });

  it('every submitted address lands in exactly one group', () => {
    const list = ['a@b.com', 'Ahmed@Gmail.com', 'nope', 'a@b.com', 'x@y.com'];
    const r = splitList(list, ['ahmed@gmail.com']);
    const { submitted, existing, fresh, invalid, duplicates } = r.counts;
    expect(existing + fresh + invalid + duplicates).toBe(submitted);
  });
});

describe('the sentence at the top of the screen', () => {
  it('says the decision out loud, not four bare numbers', () => {
    const r = splitList(
      ['known@a.com', 'new1@a.com', 'new2@a.com', 'rubbish'],
      ['known@a.com']);
    expect(describeSplit(r)).toBe(
      '4 addresses checked — 1 already has an account, 2 are new, 1 is not a usable address.');
  });

  it('gets singular and plural right — a screen that says "1 are new" reads as broken', () => {
    expect(describeSplit(splitList(['a@b.com'], []))).toContain('1 is new');
    expect(describeSplit(splitList(['a@b.com', 'c@d.com'], []))).toContain('2 are new');
    expect(describeSplit(splitList(['a@b.com'], ['a@b.com']))).toContain('1 already has an account');
    expect(describeSplit(splitList(['a@b.com', 'c@d.com'], ['a@b.com', 'c@d.com'])))
      .toContain('2 already have accounts');
  });

  it('says what to do when nothing has been checked yet', () => {
    expect(describeSplit(splitList([], []))).toMatch(/paste a list or upload a file/);
  });
});

describe('each group downloads as a CSV you can paste straight into the next tool', () => {
  it('one address per line, with a header', () => {
    expect(toCsv(['a@b.com', 'c@d.com'])).toBe('email\na@b.com\nc@d.com\n');
  });
  it('an empty group is still a valid file, not a broken one', () => {
    expect(toCsv([])).toBe('email\n');
  });
});
