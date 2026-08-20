// ─── promo-audience.test.js ──────────────────────────────────────────────────
// A promo code used to be a bearer token: know the string, spend a seat. The
// redemption path asked five questions and none of them was WHO.
//
// These codes are how an organisation's PAID seats get handed out. A hundred-use
// workshop code forwarded into a group chat is spent by a hundred strangers,
// and the attendees the customer paid for meet "invalid, expired, or already
// used" during a live session.
//
// The owner, 2026-08-20: "nobody can use this promo code except these emails,
// and each email can use it only for one time."

import { describe, it, expect } from 'vitest';
import {
  mayRedeem, capForInvites, splitInvites, normalizeEmail, REFUSAL,
} from './promo-audience.js';

const INVITED = ['ahmed@company.com', 'Sara@Company.com', ' ali@company.com '];

describe('who may redeem', () => {
  it('lets an invited address through', () => {
    expect(mayRedeem({ email: 'ahmed@company.com', invited: INVITED }).allowed).toBe(true);
  });

  it('refuses an address that is not on the list', () => {
    const r = mayRedeem({ email: 'stranger@gmail.com', invited: INVITED });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('not-invited');
  });

  // The whole point of the feature: a leaked code is worth nothing to whoever
  // it leaked to.
  it('a leaked code buys a stranger nothing', () => {
    for (const who of ['someone@else.com', 'attacker@evil.test', '']) {
      expect(mayRedeem({ email: who, invited: INVITED }).allowed).toBe(false);
    }
  });

  it('matches regardless of case or stray spacing', () => {
    expect(mayRedeem({ email: 'SARA@company.com', invited: INVITED }).allowed).toBe(true);
    expect(mayRedeem({ email: '  ali@COMPANY.com  ', invited: INVITED }).allowed).toBe(true);
  });

  it('accepts a Set as well as an array, so a hot path can pre-build one', () => {
    const set = new Set(INVITED.map(normalizeEmail));
    expect(mayRedeem({ email: 'ahmed@company.com', invited: set }).allowed).toBe(true);
    expect(mayRedeem({ email: 'nope@x.com', invited: set }).allowed).toBe(false);
  });

  it('once per person, whoever they are', () => {
    const r = mayRedeem({ email: 'ahmed@company.com', invited: INVITED, alreadyRedeemed: true });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('already-redeemed');
  });

  // ── EVERY CODE ALREADY IN PRODUCTION MUST BE UNAFFECTED ──────────────────
  // There are live codes out there. A feature that silently restricted them
  // would break redemptions nobody asked to change.
  it.each([[null], [undefined], [[]], [new Set()]])(
    'a code with no list (%s) stays open, exactly as today', (invited) => {
      expect(mayRedeem({ email: 'anyone@anywhere.com', invited }).allowed).toBe(true);
    });
});

describe('the refusal never says which door was locked', () => {
  // "You are not on the list" tells whoever holds a leaked code that the code
  // itself is good and only mis-addressed — the one thing worth learning from
  // a failed attempt.
  it('is the same sentence used for expired and used-up codes', () => {
    expect(REFUSAL).toBe('This code is invalid, expired, or already used.');
  });

  it('gives away neither the list nor the code', () => {
    expect(REFUSAL).not.toMatch(/list|invite|allowed|permitted|your email/i);
  });
});

describe('the list is the cap', () => {
  // "one hundred emails, one hundred uses" — derived, so the two cannot drift.
  it('defaults the redemption cap to the number of invitations', () => {
    expect(capForInvites({ inviteCount: 100 })).toBe(100);
    expect(capForInvites({ inviteCount: 100, requested: '' })).toBe(100);
  });

  it('honours a smaller deliberate cap — fifty seats of a hundred', () => {
    expect(capForInvites({ inviteCount: 100, requested: 50 })).toBe(50);
  });

  // A cap above the list size is meaningless: the list can never satisfy it,
  // and leaving it would show "0 of 200 redeemed" for a code that tops out at
  // a hundred.
  it('never allows a cap the list cannot reach', () => {
    expect(capForInvites({ inviteCount: 100, requested: 500 })).toBe(100);
  });

  it('leaves an open code alone', () => {
    expect(capForInvites({ inviteCount: 0, requested: 25 })).toBe(25);
    expect(capForInvites({ inviteCount: 0, requested: null })).toBeNull();
  });
});

describe('who has not turned up yet', () => {
  // The screen that earns its keep before a workshop. The predictable failure
  // is not fraud — it is being invited as ahmed@company.com and signing up as
  // ahmed.k@gmail.com.
  const rows = [
    { email: 'a@x.com', redeemed_at: '2026-08-20T10:00:00Z' },
    { email: 'b@x.com', redeemed_at: null },
    { email: 'c@x.com', redeemed_at: null },
  ];

  it('separates who has redeemed from who is still outstanding', () => {
    const s = splitInvites(rows);
    expect(s.total).toBe(3);
    expect(s.redeemedCount).toBe(1);
    expect(s.waitingCount).toBe(2);
    expect(s.waiting.map((r) => r.email)).toEqual(['b@x.com', 'c@x.com']);
  });

  it('handles a list nobody has touched', () => {
    const s = splitInvites([{ email: 'a@x.com', redeemed_at: null }]);
    expect(s.redeemedCount).toBe(0);
    expect(s.waitingCount).toBe(1);
  });

  it('does not fall over on an open code with no list at all', () => {
    expect(splitInvites().total).toBe(0);
    expect(splitInvites([]).waitingCount).toBe(0);
  });
});
