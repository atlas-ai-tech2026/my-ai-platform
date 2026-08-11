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

  // Extending rather than overwriting: someone with 30 days who redeems a
  // 7-day code must not lose three weeks they already hold.
  it('EXTENDS the existing expiry and never shortens it', () => {
    expect(source).toMatch(/GREATEST\(\s*\n?\s*COALESCE\(expires_at, NOW\(\)\)/);
  });

  it('does nothing at all when the code has no access period', () => {
    expect(source).toMatch(/if \(p\.access_days != null && Number\(p\.access_days\) > 0\)/);
  });

  it('validates the range on creation and allows blank for open-ended', () => {
    expect(source).toMatch(/accessDays < 1 \|\| accessDays > 3650/);
    expect(source).toMatch(/or blank for open-ended/);
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
