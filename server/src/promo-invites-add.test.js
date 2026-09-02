// ─── promo-invites-add.test.js ───────────────────────────────────────────────
// #97 — adding somebody to a list that already exists.
//
// The gap was found the hard way. On 2026-09-02, one attendee of 84 could not
// redeem, and the only two answers available were "issue a whole second code"
// or "grant the credits by hand". Amr issued a second code and wrote himself a
// note not to forget it. A week later, the code's own screen shows nothing
// about any of it — the seat was spent somewhere the record does not go.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { capAfterAdding, capForInvites } from './promo-audience.js';

const route = () => readFileSync(join(__dirname, 'index.js'), 'utf8');

describe('☠ THE CAP — the one decision in this feature', () => {
  it('follows the list when the LIST set it', () => {
    // "One hundred emails, one hundred uses". Adding a 101st person to a code
    // capped at 100 would produce exactly the failure the button exists to
    // fix: someone on the list, refused at the door.
    expect(capAfterAdding({ currentCap: 84, listBefore: 84, added: 1 }))
      .toEqual({ cap: 85, raised: true, short: false });
  });

  it('and the derived cap it recognises is the one capForInvites produces', () => {
    // Stated as a round trip, so the two cannot drift apart silently.
    const created = capForInvites({ inviteCount: 84, requested: null });
    expect(capAfterAdding({ currentCap: created, listBefore: 84, added: 1 }).raised).toBe(true);
  });

  it('☠ but a cap a PERSON typed is left exactly where it is', () => {
    // Fifty seats released to a list of a hundred is a real thing to want, and
    // widening it silently spends seats nobody agreed to spend — on this
    // platform, seats an organisation was invoiced for.
    const r = capAfterAdding({ currentCap: 50, listBefore: 84, added: 1 });
    expect(r.cap).toBe(50);
    expect(r.raised).toBe(false);
  });

  it('and when that hand-set cap is now too small, it SAYS so', () => {
    // Otherwise the person just added is refused, and nothing anywhere
    // explains why — which is the bug this whole day was about.
    expect(capAfterAdding({ currentCap: 50, listBefore: 84, added: 1 }).short).toBe(true);
    expect(capAfterAdding({ currentCap: 90, listBefore: 84, added: 1 }).short).toBe(false);
  });

  it('an unlimited cap needs nothing done to it', () => {
    expect(capAfterAdding({ currentCap: null, listBefore: 84, added: 5 }))
      .toEqual({ cap: null, raised: false, short: false });
  });

  it('adding nobody changes nothing', () => {
    expect(capAfterAdding({ currentCap: 84, listBefore: 84, added: 0 }))
      .toEqual({ cap: 84, raised: false, short: false });
  });

  it('several at once move the cap by the number that actually landed', () => {
    // `added` is the INSERT count, not what was typed — duplicates do not
    // buy seats.
    expect(capAfterAdding({ currentCap: 84, listBefore: 84, added: 3 }).cap).toBe(87);
  });
});

describe('the route around it', () => {
  it('☠ refuses to add an address to an OPEN code', () => {
    // A code with no list is open to anyone holding it. Adding one address
    // would LOCK it to that person and shut everyone else out — the opposite
    // of what anybody clicking "add" expects, and unrecoverable by clicking
    // again.
    expect(route()).toMatch(/is open to anyone who has the code\. Adding an address would `\s*\n\s*\+ `LOCK it/);
    expect(route()).toMatch(/if \(listBefore === 0\) \{/);
  });

  it('reads the code FOR UPDATE, so two admins cannot both undercount the list', () => {
    expect(route()).toMatch(/SELECT id, code, max_redemptions FROM promo_codes WHERE id = \$1 FOR UPDATE/);
  });

  it('stores the address through the same normaliser as everything else', () => {
    // normalizeBulkEmails routes through normalizeEmail as of today; using it
    // here is what stops this button re-creating the bug it was built for.
    expect(route()).toMatch(/const \{ valid, invalid \} = normalizeBulkEmails\(raw\);/);
  });

  it('counts a duplicate as a duplicate rather than as an addition', () => {
    expect(route()).toMatch(/if \(r\.rowCount === 1\) added\+\+; else duplicate\.push\(email\)/);
  });

  it('and accepts either one address or a pasted handful', () => {
    expect(route()).toMatch(/split\(\/\[\\s,;\]\+\/\)/);
  });
});
