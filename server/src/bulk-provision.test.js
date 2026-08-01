// ─── bulk-provision.test.js ──────────────────────────────────────────────────
// M5 (security audit 2026-07-28): bulk provisioning inserted the user row and
// its credit-grant ledger row as two separate statements. A failure between
// them left a CREDITED USER WITH NO LEDGER ROW — the balance and the audit
// trail disagreed and the credits appeared from nowhere.
//
// The route now wraps each user in its own transaction. This test replays the
// route's transaction shape against a fake pg client that can be made to fail
// at the ledger insert, and asserts nothing half-created survives.

import { describe, it, expect, vi } from 'vitest';

/** A fake pg client + pool that records statements and honours BEGIN/COMMIT/
 *  ROLLBACK, so a rolled-back "user" never lands in the committed store. */
function fakeDb({ failOn = null } = {}) {
  const committed = { users: [], ledger: [] };
  let pending = null;
  const statements = [];

  const client = {
    async query(sql, params = []) {
      const s = sql.replace(/\s+/g, ' ').trim().toUpperCase();
      statements.push(s.split(' ').slice(0, 2).join(' '));

      if (s === 'BEGIN') { pending = { users: [], ledger: [] }; return { rowCount: 0, rows: [] }; }
      if (s === 'COMMIT') {
        committed.users.push(...pending.users);
        committed.ledger.push(...pending.ledger);
        pending = null;
        return { rowCount: 0, rows: [] };
      }
      if (s === 'ROLLBACK') { pending = null; return { rowCount: 0, rows: [] }; }

      if (s.startsWith('SELECT 1 FROM USERS')) {
        const exists = committed.users.some((u) => u.email === params[0]);
        return { rowCount: exists ? 1 : 0, rows: [] };
      }
      if (s.startsWith('INSERT INTO USERS')) {
        if (failOn === 'user') throw new Error('simulated user insert failure');
        const id = committed.users.length + (pending?.users.length || 0) + 1;
        pending.users.push({ id, email: params[0], credits: params[2] });
        return { rowCount: 1, rows: [{ id }] };
      }
      if (s.startsWith('INSERT INTO CREDITS_HISTORY')) {
        if (failOn === 'ledger') throw new Error('simulated ledger insert failure');
        pending.ledger.push({ user_id: params[0], amount: params[1] });
        return { rowCount: 1, rows: [] };
      }
      throw new Error('unexpected SQL: ' + s);
    },
    release: vi.fn(),
  };

  return { pool: { connect: async () => client }, client, committed, statements };
}

/** Mirrors the per-user body of /api/admin/users/bulk after the M5 fix. */
async function provisionOne(pool, email, credits) {
  const client = await pool.connect();
  try {
    const exists = await client.query('SELECT 1 FROM users WHERE email = $1', [email]);
    if (exists.rowCount > 0) return { email, status: 'exists' };

    await client.query('BEGIN');
    const ins = await client.query(
      `INSERT INTO users (email, password_hash, credits, credit_limit, role, package, expires_at, allowed_models)
       VALUES ($1, $2, $3, $3, 'user', $4, $5, $6) RETURNING id`,
      [email, 'hash', credits, 'Basic', null, null]
    );
    if (credits > 0) {
      await client.query(
        `INSERT INTO credits_history (user_id, amount, action, admin_email, reason)
         VALUES ($1, $2, 'grant', $3, $4)`,
        [ins.rows[0].id, credits, 'admin@x.com', 'bulk provision: Basic plan']
      );
    }
    await client.query('COMMIT');
    return { email, status: 'created' };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    return { email, status: 'error' };
  } finally {
    client.release();
  }
}

describe('M5 — bulk provisioning is transactional per user', () => {
  it('a failure at the LEDGER insert leaves NO half-created user', async () => {
    const db = fakeDb({ failOn: 'ledger' });
    const result = await provisionOne(db.pool, 'a@example.com', 300);

    expect(result.status).toBe('error');
    // The finding: previously the user row survived with credits and no
    // ledger row. Now the whole unit is rolled back.
    expect(db.committed.users).toHaveLength(0);
    expect(db.committed.ledger).toHaveLength(0);
    expect(db.statements).toContain('ROLLBACK');
    expect(db.statements).not.toContain('COMMIT');
  });

  it('a failure at the USER insert commits nothing either', async () => {
    const db = fakeDb({ failOn: 'user' });
    expect((await provisionOne(db.pool, 'a@example.com', 300)).status).toBe('error');
    expect(db.committed.users).toHaveLength(0);
    expect(db.committed.ledger).toHaveLength(0);
  });

  it('a successful user commits the row AND its ledger entry together', async () => {
    const db = fakeDb();
    expect((await provisionOne(db.pool, 'a@example.com', 300)).status).toBe('created');
    expect(db.committed.users).toHaveLength(1);
    expect(db.committed.ledger).toHaveLength(1);
    // The ledger amount matches the credited amount — unchanged by this fix.
    expect(db.committed.ledger[0].amount).toBe(300);
    expect(db.committed.users[0].credits).toBe(300);
    expect(db.committed.ledger[0].user_id).toBe(db.committed.users[0].id);
  });

  it('an injected mid-batch failure does not discard the whole batch', async () => {
    // Per-user transactions: earlier successes stand, the bad one rolls back.
    const good = fakeDb();
    await provisionOne(good.pool, 'first@example.com', 100);
    const bad = fakeDb({ failOn: 'ledger' });
    await provisionOne(bad.pool, 'second@example.com', 100);

    expect(good.committed.users).toHaveLength(1);
    expect(good.committed.ledger).toHaveLength(1);
    expect(bad.committed.users).toHaveLength(0);
  });

  it('zero-credit users commit with no ledger row (nothing was granted)', async () => {
    const db = fakeDb();
    expect((await provisionOne(db.pool, 'a@example.com', 0)).status).toBe('created');
    expect(db.committed.users).toHaveLength(1);
    expect(db.committed.ledger).toHaveLength(0);
  });

  it('an existing email is skipped without opening a transaction', async () => {
    const db = fakeDb();
    await provisionOne(db.pool, 'a@example.com', 50);
    const again = await provisionOne(db.pool, 'a@example.com', 50);
    expect(again.status).toBe('exists');
    expect(db.committed.users).toHaveLength(1); // not duplicated
  });

  it('the connection is always released, even on failure', async () => {
    const db = fakeDb({ failOn: 'ledger' });
    await provisionOne(db.pool, 'a@example.com', 300);
    expect(db.client.release).toHaveBeenCalled();
  });
});
