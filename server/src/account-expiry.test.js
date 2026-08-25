// ─── account-expiry.test.js ──────────────────────────────────────────────────
// Two features that close the gap found on 2026-08-11: 584 of 587 accounts had
// no expiry at all, because a promo code's expires_at governs when the CODE may
// be redeemed and says nothing about how long the credits then live. A
// "two-week workshop code" granted access forever.
//
// The dangerous half is the bulk switch. "Expire every account" is one careless
// query away from locking the owner out of the panel needed to undo it —
// recoverable only by editing the production database by hand. So the admin
// exclusion is asserted here against the real SQL, not trusted to a code review.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(here, 'index.js'), 'utf8');
const schema = readFileSync(path.join(here, 'db.js'), 'utf8');

/** The body of the bulk-expiry route. */
const expiryRoute = source.slice(
  source.indexOf("app.post('/api/admin/users/expiry'"),
  source.indexOf("app.post('/api/admin/users/:id/reset-password'")
);

describe('the bulk expiry switch cannot lock the owner out', () => {
  it('exists', () => {
    expect(expiryRoute.length).toBeGreaterThan(200);
  });

  // The one that matters. Without it, "expire everyone" includes the admin,
  // and the CRM needed to reverse it is the thing that just became unreachable.
  it("excludes admins in the SQL, not in a comment or a caller's memory", () => {
    expect(expiryRoute).toMatch(/WHERE\s+role\s*<>\s*'admin'/);
  });

  it('is behind the full admin gate (cookie auth + CSRF + audit)', () => {
    expect(expiryRoute).toMatch(/app\.post\('\/api\/admin\/users\/expiry',\s*adminGate/);
  });

  it('refuses to set an expiry without a valid date', () => {
    expect(expiryRoute).toMatch(/isNaN\(expiresAt\)/);
    expect(expiryRoute).toMatch(/A valid expiry date is required/);
  });

  it('supports clearing as well as setting — the undo path', () => {
    expect(expiryRoute).toMatch(/\['set',\s*'clear'\]/);
  });

  // Closing a cohort today must not sweep up someone who registers an hour
  // later; that person has their own code and their own access window.
  it('can limit the change to accounts that already existed', () => {
    expect(expiryRoute).toMatch(/created_at\s*<=\s*\$2/);
  });

  // Expiry is reversible precisely because it destroys nothing.
  it('writes ONLY expires_at — no deletes, no credit changes', () => {
    expect(expiryRoute).toMatch(/SET\s+expires_at\s*=\s*\$1/);
    expect(expiryRoute).not.toMatch(/DELETE|DROP|TRUNCATE/i);
    expect(expiryRoute).not.toMatch(/SET\s+credits/);
    expect(expiryRoute).not.toMatch(/banned\s*=/);
  });
});

describe('a promo code can carry an access period', () => {
  it('has the column, defaulting to open-ended', () => {
    expect(schema).toMatch(/ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS access_days INTEGER/);
    // No NOT NULL and no DEFAULT: every existing code keeps behaving as before.
    expect(schema).not.toMatch(/access_days INTEGER NOT NULL/);
  });

  it('is read when the code is redeemed', () => {
    expect(source).toMatch(/active, expires_at, access_days\s*\n\s*FROM promo_codes/);
  });

  // Rewritten 2026-08-25 for the owner's rule. access_days used to EXTEND the
  // account's lockout date (GREATEST(COALESCE(expires_at, NOW()) …)); accounts
  // never expire any more, so the window now bounds how long the CODE'S
  // CREDITS live instead, and redeeming must not touch users.expires_at.
  it("bounds the CREDITS' life, and a code with no window grants the 30-day standard", () => {
    expect(source).toMatch(/p\.access_days != null && Number\(p\.access_days\) > 0\s*\n?\s*\? Number\(p\.access_days\) : CREDIT_LIFE_DAYS/);
  });

  it('redeeming never writes an account lockout date', () => {
    const redeemRoute = source.slice(
      source.indexOf("app.post('/api/redeem-code'"),
      source.indexOf("app.get('/api/admin/2fa/status'"));
    expect(redeemRoute.length).toBeGreaterThan(200);
    expect(redeemRoute).not.toMatch(/SET\s+expires_at/);
  });

  it('validates the range on creation; blank now means the 30-day standard, not open-ended', () => {
    expect(source).toMatch(/accessDays < 1 \|\| accessDays > 3650/);
    expect(source).toMatch(/or blank for the standard 30-day credit life/);
  });
});

describe('an expired account is hidden from nobody', () => {
  // The owner asked explicitly: after expiring, can I still see these users?
  // The answer must stay yes — the list query has no expiry filter, and the
  // column is now returned so the CRM can show WHO is expired.
  it('the CRM user list filters nothing and returns expires_at', () => {
    const q = source.match(/SELECT id, email, credits, credit_limit, role, banned, package, created_at, last_login_at, last_login_ip[^`]*`/);
    expect(q).not.toBeNull();
    expect(q[0]).toMatch(/expires_at/);
    expect(q[0]).not.toMatch(/WHERE/);
  });
});

// ─── keeping one cohort alive while closing another ──────────────────────────
// Added 2026-08-12. Ending a workshop while a newer one is still running is the
// normal case. The owner supplied 7 promo codes to spare, covering 194 of 592
// accounts — so a mistake here is not academic: a single mistyped code protects
// nobody and expires the workshop it was meant to save.
describe('sparing the live workshop', () => {
  it('refuses the whole operation if any promo code is unknown', () => {
    // Fail closed and change NOTHING, rather than half-apply and expire people.
    expect(expiryRoute).toMatch(/do not exist:/);
    expect(expiryRoute).toMatch(/Nothing was changed/);
    expect(expiryRoute).toMatch(/return res\.status\(400\)/);
  });

  it('checks the codes BEFORE any UPDATE runs', () => {
    const guard = expiryRoute.indexOf('do not exist:');
    const firstUpdate = expiryRoute.indexOf('UPDATE users');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(firstUpdate);
  });

  it('matches codes case-insensitively, so a lowercase paste still protects', () => {
    expect(expiryRoute).toMatch(/toUpperCase\(\)/);
    expect(expiryRoute).toMatch(/upper\(p\.code\) = ANY/);
  });

  it('excludes anyone who redeemed a spared code', () => {
    expect(expiryRoute).toMatch(/id NOT IN \(/);
    expect(expiryRoute).toMatch(/FROM promo_redemptions r JOIN promo_codes p/);
  });

  // With no keep list the behaviour must be exactly what it was before.
  it('is a no-op on the query when no codes are given', () => {
    expect(expiryRoute).toMatch(/\$3::text\[\] IS NULL OR/);
    expect(expiryRoute).toMatch(/keepCodes\.length \? keepCodes : null/);
  });

  // The spared cohort gets time from THEIR OWN redemption day, not one shared
  // date — that is what "one month from activation" means.
  it('dates the kept window from each person\'s own redemption', () => {
    expect(expiryRoute).toMatch(/MAX\(r\.created_at\) \+ \(\$2 \|\| ' days'\)::INTERVAL/);
  });

  it('never shortens a window someone already has', () => {
    expect(expiryRoute).toMatch(/GREATEST\(COALESCE\(u\.expires_at, 'epoch'::timestamptz\), w\.until\)/);
  });

  // Belt and braces: the second statement must not be able to resurrect an
  // admin either.
  it('keeps admins out of the second statement too', () => {
    const second = expiryRoute.slice(expiryRoute.indexOf('UPDATE users u'));
    expect(second).toMatch(/u\.role <> 'admin'/);
  });

  it('reports how many were kept, not just how many were expired', () => {
    expect(expiryRoute).toMatch(/kept_by_promo_code/);
  });
});

// ─── every door must give the same answer ────────────────────────────────────
// Found 2026-08-16, checking what "expired" actually blocks before closing 397
// accounts. Password login refused an expired account; social sign-in did not —
// it read `banned` and never `expires_at`. Nothing could be SPENT either way
// (requireNotBanned re-reads the row on every request), so this was never a
// credit leak. But the person landed inside the app looking signed in and only
// learned their access had ended when a generation failed.
//
// Microsoft's callback redirects through google/complete, so one fix covers it.
describe('an expired account is refused at every sign-in path', () => {
  const guard = /Account has expired — contact support to renew\./g;
  const complete = source.slice(
    source.indexOf("app.post('/api/auth/google/complete'"),
    source.indexOf("app.get('/api/auth/microsoft'")
  );

  it('refuses at password login', () => {
    const login = source.slice(
      source.indexOf("app.post('/api/auth/login'"),
      source.indexOf("app.get('/api/auth/google'")
    );
    expect(login).toMatch(guard);
  });

  it('refuses at social sign-in completion', () => {
    expect(complete.length).toBeGreaterThan(200);
    expect(complete).toMatch(guard);
  });

  // A check against a column the query never selected reads as "not expired"
  // for everyone — passing tests, guard silently dead.
  it('actually selects expires_at there, or the check is always false', () => {
    expect(complete).toMatch(/SELECT[^`]*expires_at[^`]*FROM users WHERE id = \$1/);
  });

  it('blocks on every spending request, not just at login', () => {
    const mw = readFileSync(path.join(here, 'middleware', 'auth.js'), 'utf8');
    expect(mw).toMatch(/SELECT banned, expires_at/);
    expect(mw).toMatch(guard);
  });

  // The reason expiry bites immediately instead of at the next sign-in: the
  // row is re-read per request rather than trusted from the 7-day token.
  it('re-reads the account rather than trusting the token', () => {
    const mw = readFileSync(path.join(here, 'middleware', 'auth.js'), 'utf8');
    expect(mw).toMatch(/FROM users WHERE id = \$1/);
  });

  // If a new generation route ships without this guard, an expired account
  // could spend. Assert the gate on every route that charges.
  it('guards every credit-spending route', () => {
    const spending = [...source.matchAll(
      /app\.(?:post|put)\('(\/api\/(?:generate[\w-]*|edit-video-omni|node\/run-[\w-]+))',([^)]*?)async/g
    )];
    expect(spending.length).toBeGreaterThanOrEqual(8);
    for (const [, route, guards] of spending) {
      expect(guards, `${route} is missing requireNotBanned`).toMatch(/requireNotBanned/);
    }
  });
});
