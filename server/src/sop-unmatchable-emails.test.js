// ─── sop-unmatchable-emails.test.js ──────────────────────────────────────────
// ☠ AN ACCOUNT THAT EXISTS, IS PAID FOR, AND CANNOT BE SIGNED IN TO.
//
// Login runs `WHERE email = $1` — an EXACT match — against an address the app
// lowercases and strips. So a `users` row that is not already clean is
// unreachable: the person types what looks exactly like their own address and
// is told no such account exists. Nothing errors. Nothing is logged. Every
// admin screen displays the address looking perfectly correct.
//
// Found on 2026-09-02, the day ten of eighty-four workshop attendees could not
// redeem the code they had been invited to. Nine had capital letters; one
// carried a right-to-left mark that Arabic Excel had inserted silently.
//
// ── WHY THIS IS A CHECK AND NOT A ONE-OFF SCRIPT ───────────────────────────
// Because it could not be answered any other way. Both databases accept
// connections only from their own app — verified 2026-09-02 — so no script run
// from a laptop can count these, today or in six months. The answer has to
// come from inside the app, which means it may as well come every week.

import { describe, it, expect } from 'vitest';
import { findUnmatchableEmails } from './sop-integrity.js';

/** A pool that answers the two queries this check makes, and nothing else. */
const poolOf = (users, invites = []) => ({
  query: async (sql) => {
    if (/FROM users/.test(sql)) return { rows: users, rowCount: users.length };
    if (/promo_code_emails/.test(sql)) return { rows: invites, rowCount: invites.length };
    throw new Error(`unexpected query: ${sql.slice(0, 60)}`);
  },
});

describe('☠ ACCOUNTS THAT CANNOT BE SIGNED IN TO', () => {
  it('finds all three faults, and names each one in words a person can act on', async () => {
    const out = await findUnmatchableEmails(poolOf([
      { id: 1, email: 'Ahmed@Gmail.com' },
      { id: 2, email: '‏osama@gmail.com' },
      { id: 3, email: '  spaced@gmail.com  ' },
      { id: 4, email: 'perfectly.fine@gmail.com' },
    ]));
    expect(out.users).toHaveLength(3);
    expect(out.users.map((u) => u.fault)).toEqual(['capitals', 'invisible mark', 'spaces']);
    expect(out.users.map((u) => u.clean))
      .toEqual(['ahmed@gmail.com', 'osama@gmail.com', 'spaced@gmail.com']);
  });

  it('an address with a mark AND capitals reports both', async () => {
    const out = await findUnmatchableEmails(poolOf([{ id: 1, email: '‏Ahmed@Gmail.com' }]));
    expect(out.users[0].fault).toBe('capitals + invisible mark');
  });

  it('☠ and flags the one case a repair script must NOT touch', async () => {
    // Two rows that normalise to the same address. Correcting the dirty one
    // would violate the UNIQUE constraint at best, and merge two different
    // people's accounts at worst. A person has to decide which one keeps it.
    const out = await findUnmatchableEmails(poolOf([
      { id: 1, email: 'Ahmed@Gmail.com' },
      { id: 2, email: 'ahmed@gmail.com' },
      { id: 3, email: 'Sara@Gmail.com' },
    ]));
    expect(out.users.find((u) => u.id === 1).collides).toBe(true);
    expect(out.users.find((u) => u.id === 3).collides).toBe(false);
  });

  it('a clean database reports nothing, and says how much it looked at', async () => {
    const out = await findUnmatchableEmails(poolOf(
      [{ id: 1, email: 'a@b.com' }, { id: 2, email: 'c@d.com' }],
      [{ code: 'X', email: 'a@b.com', redeemed: false }]));
    expect(out.users).toEqual([]);
    expect(out.invites).toEqual([]);
    // A check that finds nothing must still prove it looked — "0 found" and
    // "0 scanned" are very different statements.
    expect(out.scanned).toEqual({ users: 2, invites: 1 });
  });

  it('invitations are reported separately, with the code they belong to', async () => {
    const out = await findUnmatchableEmails(poolOf(
      [{ id: 1, email: 'clean@gmail.com' }],
      [{ code: 'SPA-NEW-ACADEMY', email: '‏osama.himselff@gmail.com', redeemed: false }]));
    expect(out.users).toEqual([]);
    expect(out.invites).toHaveLength(1);
    expect(out.invites[0].code).toBe('SPA-NEW-ACADEMY');
    expect(out.invites[0].clean).toBe('osama.himselff@gmail.com');
  });
});

describe('☠ IT USES THE SAME COMPARISON AS THE THING IT CHECKS', () => {
  // The whole lesson of 2026-09-02: the fault was two places disagreeing about
  // what "the same address" means. A checker with its own private definition
  // would reproduce the bug it was written to find.
  const src = () => require('node:fs')
    .readFileSync(require('node:path').join(__dirname, 'sop-integrity.js'), 'utf8');

  it('imports normalizeEmail rather than defining its own', () => {
    expect(src()).toMatch(/import \{ normalizeEmail \} from '\.\/email-normalize\.js'/);
  });

  it('☠ and keeps NO second list of invisible characters', () => {
    // "Is a mark present" is asked as "does stripping change anything that
    // lowercasing and trimming would not". Nothing to keep in step.
    const body = src().slice(src().indexOf('export async function findUnmatchableEmails'));
    expect(body).not.toMatch(/\\u200[BCDEF]|\\u202[ABCDE]|\\uFEFF|\\u00A0/);
    expect(body).toMatch(/normalizeEmail\(e\) !== String\(e\)\.trim\(\)\.toLowerCase\(\)/);
  });
});

describe('the line it becomes', () => {
  const routes = () => require('node:fs')
    .readFileSync(require('node:path').join(__dirname, 'sop-routes.js'), 'utf8');

  it('☠ goes RED for accounts — the one line in this zone that may', () => {
    // Everything else in the Structure zone is a heuristic with honest false
    // positives, so nothing else is ever worse than a warning. This is a fact,
    // and people are locked out of accounts they paid for.
    expect(routes()).toMatch(/state: um\.users\.length \? STATE\.CRITICAL : STATE\.OK/);
  });

  it('but only a warning for invitations, which the redeem fix already unstuck', () => {
    expect(routes()).toMatch(/state: um\.invites\.length \? STATE\.WARN : STATE\.OK/);
  });

  it('shows the actual addresses — a lockout you cannot act on is not a report', () => {
    expect(routes()).toMatch(/\$\{u\.email\.trim\(\)\} → \$\{u\.clean\}/);
  });

  it('and says so when it has bounded the list, per the standing rule', () => {
    expect(routes()).toMatch(/… and \$\{rows\.length - 6\} more/);
  });
});
