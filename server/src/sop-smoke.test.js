// ─── sop-smoke.test.js ───────────────────────────────────────────────────────
// The owner asked for "a test for all the behaviour of the system" on the SOP
// tab. The honest boundary is that the 1,684-test suite runs at BUILD time,
// against mocks, in another process — it cannot tell you the live server can
// reach its database right now. These five can.
//
// So the tests below are about the two ways such a check betrays you: saying
// OK when it could not determine anything, and leaving something behind.

import { describe, it, expect, vi } from 'vitest';
import {
  checkDbRead, checkDbWrite, checkPricingResolves, checkStorage, checkConfig,
  runSmokeChecks, summariseSmoke,
} from './sop-smoke.js';

const okPool = (rows) => ({ query: vi.fn().mockResolvedValue({ rows }) });
const failPool = (msg) => ({ query: vi.fn().mockRejectedValue(new Error(msg)) });

describe('database read', () => {
  it('passes and reports what it saw', async () => {
    const r = await checkDbRead(okPool([{ n: 595 }]));
    expect(r.ok).toBe(true);
    expect(r.detail).toMatch(/595 users/);
  });

  it('fails with the real reason rather than a generic message', async () => {
    const r = await checkDbRead(failPool('connection terminated'));
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/connection terminated/);
  });
});

describe('database write', () => {
  // Read-only access looks identical to healthy until someone tries to sign
  // up, which is a bad moment to find out.
  it('proves the write path and ALWAYS rolls back', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [{ n: 1 }] }), release: vi.fn() };
    const pool = { connect: vi.fn().mockResolvedValue(client) };
    const r = await checkDbWrite(pool);
    expect(r.ok).toBe(true);
    const sql = client.query.mock.calls.map((c) => String(c[0]));
    expect(sql.some((q) => /ROLLBACK/.test(q)), 'must roll back').toBe(true);
    // `ON COMMIT DROP` contains the word COMMIT, so match a COMMIT STATEMENT.
    expect(sql.some((q) => /^\s*COMMIT\b/i.test(q)), 'must never commit').toBe(false);
    expect(client.release).toHaveBeenCalled();
  });

  it('rolls back and releases even when the write throws', async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({})                       // BEGIN
        .mockRejectedValueOnce(new Error('read-only transaction'))
        .mockResolvedValue({}),                          // ROLLBACK
      release: vi.fn(),
    };
    const r = await checkDbWrite({ connect: vi.fn().mockResolvedValue(client) });
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/read-only/);
    expect(client.release).toHaveBeenCalled();
  });
});

describe('pricing table — the C1 gate', () => {
  // A model the UI offers but pricing cannot price is charged NOTHING. The
  // generation is free and no error is raised, because there isn't one.
  it('passes on the real pricing table — all three shapes', () => {
    const r = checkPricingResolves();
    expect(r.ok, r.detail).toBe(true);
    expect(r.detail).toMatch(/models priced/);
  });

  // The first version understood only `byRes: { res: { off } }` and would have
  // reported gemini-omni (per-gen, byResDuration) as unpriced — a false alarm
  // about the charging table, on the screen meant to be trusted.
  it('understands per-sec, flat and per-gen alike', () => {
    const r = checkPricingResolves();
    expect(r.detail).not.toMatch(/gemini-omni/);
  });
});

describe('configuration', () => {
  it('catches mail silently in test mode', () => {
    const r = checkConfig({ MAIL_TEST_MODE: 'true', BACKUP_ENCRYPTION_PASSPHRASE: 'x', JWT_SECRET: 'y' });
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/no email is actually being sent/);
  });

  it('catches an unset backup passphrase — archives would be unreadable', () => {
    const r = checkConfig({ JWT_SECRET: 'y' });
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/BACKUP_ENCRYPTION_PASSPHRASE is unset/);
  });

  it('passes when all three are set', () => {
    expect(checkConfig({ BACKUP_ENCRYPTION_PASSPHRASE: 'x', JWT_SECRET: 'y' }).ok).toBe(true);
  });
});

describe('summarising — unknown is NOT ok', () => {
  it('is critical if anything failed', () => {
    expect(summariseSmoke([{ ok: true }, { ok: false }, { ok: null }])).toBe('critical');
  });

  // The rule the whole SOP screen is built on.
  it('is unknown — never ok — when something could not be determined', () => {
    expect(summariseSmoke([{ ok: true }, { ok: null }])).toBe('unknown');
  });

  it('is ok only when everything genuinely passed', () => {
    expect(summariseSmoke([{ ok: true }, { ok: true }])).toBe('ok');
  });
});

describe('runSmokeChecks', () => {
  it('returns one result per check and never throws', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [{ n: 1 }] }),
      connect: vi.fn().mockResolvedValue({
        query: vi.fn().mockResolvedValue({ rows: [{ n: 1 }] }), release: vi.fn(),
      }),
    };
    const out = await runSmokeChecks(pool, { env: { JWT_SECRET: 'y', BACKUP_ENCRYPTION_PASSPHRASE: 'x' } });
    expect(out).toHaveLength(5);
    for (const r of out) expect(typeof r.name).toBe('string');
  });

  // A check that crashes must REPORT, not vanish — a missing line reads as
  // "nothing wrong here".
  it('reports a check that throws instead of dropping it', async () => {
    const pool = { query: vi.fn().mockRejectedValue(new Error('boom')),
                   connect: vi.fn().mockRejectedValue(new Error('boom')) };
    const out = await runSmokeChecks(pool, { env: {} });
    expect(out).toHaveLength(5);
    expect(out.some((r) => r.ok === false)).toBe(true);
  });
});
