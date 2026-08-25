// ─── credit-lots-wiring.test.js ──────────────────────────────────────────────
// The owner's rule, 2026-08-25, in their words: "Do not expire any account.
// Only expire the credit if it passed thirty days from the day that the
// credit added to any user." (The "thirteen" in the transcript was queried
// and corrected to THIRTY by the owner, twice.)
//
// credit-lots.test.js proves the engine and credit-backfill.test.js proves
// the retroactive attribution. This file pins the WIRING — the part where a
// correct engine helps nobody if a call site forgets it. Asserted against the
// real source, the same way the bulk-expiry admin exclusion is.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(here, 'index.js'), 'utf8');
const credits = readFileSync(path.join(here, 'credits.js'), 'utf8');
const lotsDb = readFileSync(path.join(here, 'credit-lots-db.js'), 'utf8');
const schema = readFileSync(path.join(here, 'db.js'), 'utf8');

describe('accounts never expire — nothing automatic writes a lockout date any more', () => {
  // The ONLY writer left in the routes is the deliberate manual bulk tool.
  // Everything that used to stamp dates as a side effect is gone.
  it('the manual bulk switch is the only place left that writes a lockout date', () => {
    const writers = source.match(/SET\s+expires_at\s*=/g) || [];
    // Exactly the bulk tool's two writes: the set, and the spared cohort's
    // own window. Anything beyond these two is a regression to the retired
    // model — a new automatic writer would fail this count.
    expect(writers).toHaveLength(2);
    const expiryRoute = source.slice(
      source.indexOf("app.post('/api/admin/users/expiry'"),
      source.indexOf("app.post('/api/admin/users/:id/reset-password'"));
    expect(expiryRoute).toMatch(/SET\s+expires_at\s*=\s*\$1/);
    expect(expiryRoute).toMatch(/SET\s+expires_at\s*=\s*GREATEST/);
    // And nothing outside that route writes one.
    const outside = source.replace(expiryRoute, '');
    expect(outside).not.toMatch(/SET\s+expires_at\s*=/);
  });

  it('a manual credit grant no longer stamps the account (the 2026-08-20 standard moved to the credits)', () => {
    expect(source).not.toMatch(/expiryAfterManualGrant/);
  });

  it('bulk-created accounts are born without a lockout date', () => {
    expect(source).not.toMatch(/INSERT INTO users \(email, password_hash, credits, credit_limit, role, package, expires_at/);
  });

  it('the lots layer touches users.expires_at only to CLEAR it — the unlock', () => {
    const writes = lotsDb.match(/SET\s+expires_at\s*=\s*(\S+)/g) || [];
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatch(/NULL/);
  });

  // Build before delete: the door checks stay until the new system has run
  // clean — they become inert the moment Activate clears the stored dates,
  // and a later cleanup removes them deliberately, not as a side effect.
  it('the sign-in doors still refuse a STORED date (inert once cleared), unchanged', () => {
    expect(source.match(/Account has expired — contact support to renew/g)?.length).toBe(2);
  });
});

describe('every credit addition becomes a dated lot', () => {
  it('the schema has the lots table with a life and a claim marker', () => {
    expect(schema).toMatch(/CREATE TABLE IF NOT EXISTS credit_lots/);
    expect(schema).toMatch(/remaining\s+NUMERIC\(10,2\)\s+NOT NULL/);
    expect(schema).toMatch(/expired_at\s+TIMESTAMPTZ/);
  });

  it('gift and promo redemptions — the shared helper plants the lot in the same transaction', () => {
    const helper = source.slice(
      source.indexOf('async function grantRedeemedCredits'),
      source.indexOf("app.post('/api/redeem-code'"));
    expect(helper).toMatch(/addLot\(client/);
  });

  it("a promo code's access_days is the lot's life; no window means the 30-day standard", () => {
    expect(source).toMatch(/\? Number\(p\.access_days\) : CREDIT_LIFE_DAYS/);
  });

  it('a manual grant plants a lot; a revoke drains lots like a spend would', () => {
    const grantRoute = source.slice(
      source.indexOf("app.post('/api/admin/users/:id/credits'"),
      source.indexOf('async function tryExpireOverdrawn') !== -1
        ? source.indexOf('async function tryExpireOverdrawn')
        : source.indexOf("app.post('/api/admin/users/:id/credits'") + 6000);
    expect(grantRoute).toMatch(/if \(delta > 0\)[\s\S]{0,200}?addLot\(client/);
    expect(grantRoute).toMatch(/else if \(delta < 0\)[\s\S]{0,120}?mirrorLotSpend\(client/);
  });

  it('bulk-provisioned starting credits get their lot', () => {
    expect(source).toMatch(/source: 'bulk',\s*\n\s*reason: `bulk provision/);
  });
});

describe('spending drains the dated lots, without ever risking the charge', () => {
  it('chargeCredits mirrors the spend INSIDE the transaction', () => {
    const inTx = credits.slice(credits.indexOf('async function chargeCredits') !== -1
      ? credits.indexOf('async function chargeCredits')
      : credits.indexOf('export async function chargeCredits'));
    const body = inTx.slice(0, inTx.indexOf('export async function refundCredits'));
    expect(body).toMatch(/mirrorSafely\(client, \(\) => mirrorSpend\(client/);
  });

  it('refunds land back in lots the same way', () => {
    expect(credits).toMatch(/mirrorSafely\(client, \(\) => mirrorRefund\(client/);
  });

  // A bare try/catch is NOT enough in Postgres: an error inside the
  // transaction poisons it and the COMMIT itself then fails, taking the
  // customer's charge down with the mirror. Only a savepoint isolates.
  it('the mirror is isolated behind a SAVEPOINT, so a lots bug cannot cost a generation', () => {
    expect(credits).toMatch(/SAVEPOINT lots_mirror/);
    expect(credits).toMatch(/ROLLBACK TO SAVEPOINT lots_mirror/);
  });

  it('inside the grace window a spend drains expired-but-unswept lots rather than drifting', () => {
    expect(lotsDb).toMatch(/\[\.\.\.live, \.\.\.expiredUnswept\]/);
  });

  it('drift is loud, never silent', () => {
    expect(lotsDb).toMatch(/\[credit-lots\] DRIFT/);
  });
});

describe('the sweep — thirty days on, the remainder goes, and only the remainder', () => {
  it('claims each lot exactly once (the two-instance guard is the SQL, not a hope)', () => {
    expect(lotsDb).toMatch(/remaining > 0 AND expired_at IS NULL AND expires_at <= NOW\(\)\s*\n?\s*FOR UPDATE/);
  });

  it('never touches an admin balance', () => {
    expect(lotsDb).toMatch(/u\.role <> 'admin'/);
  });

  it('caps at the balance — a sweep can never make credits negative', () => {
    expect(lotsDb).toMatch(/GREATEST\(credits - \$1, 0\)/);
  });

  it('every removal gets a ledger row naming the addition dates it took', () => {
    expect(lotsDb).toMatch(/'expire'/);
    expect(lotsDb).toMatch(/days after they were added \(added/);
  });

  it('takes nothing until the owner has pressed Activate', () => {
    expect(lotsDb).toMatch(/if \(!\(await activatedAt\(\)\)\) return;/);
  });
});

describe('activation — the one press that unlocks everyone and starts the rule', () => {
  it('refuses to run against numbers the admin has not just been shown', () => {
    expect(lotsDb).toMatch(/numbers-moved/);
    expect(source).toMatch(/expect_accounts and expect_credits are required/);
  });

  it('the unlock and the switch share one transaction — no half-activated state', () => {
    const act = lotsDb.slice(lotsDb.indexOf('export async function activateNow'));
    const tx = act.slice(act.indexOf("BEGIN"), act.indexOf('COMMIT'));
    expect(tx).toMatch(/SET expires_at = NULL WHERE expires_at IS NOT NULL/);
    expect(tx).toMatch(/INSERT INTO app_flags/);
  });

  it('boot backfills the dates once and puts the sweep on the hourly clock', () => {
    expect(source).toMatch(/backfillAllUsers\(\)\.catch/);
    expect(source).toMatch(/scheduleCreditLotSweep\(\{ ready: dbReady \}\)/);
  });
});

describe('the customer is warned before anything is taken', () => {
  it('/api/auth/me carries the soonest expiry and how much dies with it', () => {
    expect(source).toMatch(/credit_expiry: creditExpiry/);
  });
});
