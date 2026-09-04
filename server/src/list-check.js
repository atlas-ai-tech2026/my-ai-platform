// ─── list-check.js ───────────────────────────────────────────────────────────
// "A customer sent me 84 emails. Which of them already have accounts?"
//
// Until now there was no way to ask. The owner would paste a list into Bulk —
// which CREATES accounts and silently skips anyone who already has one — or
// into a promo code, and find out afterwards, from a report, that some people
// got two entries and some got none.
//
// ☠ WHAT THIS PREVENTS, IN THE OWNER'S OWN DATA. The SPA 4 credit report
// listed fifteen accounts that received credits TWICE on the same day, hours
// apart. That is what happens when nobody can see, before acting, which half
// of a list is already known. This screen is the missing look-before-you-act.
//
// ── IT MATCHES THE WAY SIGN-IN MATCHES ─────────────────────────────────────
// Every address goes through normalizeEmail first — the same function login,
// redeem and bulk use. That matters more than it sounds: on 2026-09-02 a list
// of 84 contained nine addresses with capital letters and one carrying an
// invisible right-to-left mark from Arabic Excel, and every one of them was
// treated as a stranger. Here, that would mean calling ten existing customers
// "new" and creating duplicate accounts for them.
//
// Read-only by construction: it takes a list and answers a question. Nothing
// here writes, charges, or creates.

import { normalizeEmail } from './email-normalize.js';
import { normalizeBulkEmails } from './bulk-helpers.js';

/**
 * Split a submitted list against the addresses that already have accounts.
 *
 * @param raw         whatever the admin pasted or uploaded
 * @param knownEmails addresses that exist, in any form — normalised here too,
 *                    so a stored "Ahmed@Gmail.com" still matches a typed one
 * @returns {{ existing, fresh, invalid, dupes, counts }}
 */
export function splitList(raw, knownEmails = []) {
  const { valid, invalid, dupes } = normalizeBulkEmails(raw);
  // Normalising BOTH sides is the whole point — see the header.
  const known = new Set([...knownEmails].map(normalizeEmail).filter(Boolean));

  const existing = [];
  const fresh = [];
  for (const email of valid) (known.has(email) ? existing : fresh).push(email);

  return {
    existing, fresh, invalid, dupes,
    counts: {
      submitted: existing.length + fresh.length + invalid.length + dupes,
      usable: valid.length,
      existing: existing.length,
      fresh: fresh.length,
      invalid: invalid.length,
      duplicates: dupes,
    },
  };
}

/**
 * One line a person can read out loud, for the top of the screen.
 *
 * Written as a sentence rather than four numbers because the decision it
 * supports is a sentence: "61 already have accounts, so top those up; 21 are
 * new, so create those."
 */
export function describeSplit({ counts }) {
  if (!counts.submitted) return 'Nothing to check yet — paste a list or upload a file.';
  const bits = [];
  if (counts.existing) bits.push(`${counts.existing} already ${counts.existing === 1 ? 'has an account' : 'have accounts'}`);
  if (counts.fresh) bits.push(`${counts.fresh} ${counts.fresh === 1 ? 'is' : 'are'} new`);
  if (counts.invalid) bits.push(`${counts.invalid} ${counts.invalid === 1 ? 'is not a usable address' : 'are not usable addresses'}`);
  if (counts.duplicates) bits.push(`${counts.duplicates} repeated in the list`);
  return `${counts.submitted} address${counts.submitted === 1 ? '' : 'es'} checked — ` + bits.join(', ') + '.';
}

/** A CSV of one group, ready to paste into Bulk or a promo code. */
export function toCsv(emails = [], header = 'email') {
  return [header, ...emails].join('\n') + '\n';
}
