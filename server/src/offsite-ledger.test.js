// ─── offsite-ledger.test.js ──────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════
// A LEDGER MUST NEVER REMEMBER A COPY THAT DID NOT HAPPEN.
// ═══════════════════════════════════════════════════════════════════════════
//
// This replaces "list the remote bucket" with "read our own record". That
// removes an operation that has failed for nine days — and introduces one new
// way to lose a backup completely:
//
//   record a key that was never actually copied → it is skipped FOREVER →
//   the file is never backed up → every screen says the backup is complete.
//
// A wrong "yes" here is silent and permanent. The listing failure it replaces
// at least announces itself. So almost every test below is one shape of that
// mistake, and the rule they all enforce is: given the choice between copying
// twice and not copying at all, ALWAYS COPY TWICE.

import { describe, it, expect, vi } from 'vitest';
import {
  planFromLedger, copyAndRecord, describeCoverage,
  LEDGER_DDL, RECORD_SQL, SEED_SQL, MISSING_SQL,
} from './offsite-ledger.js';

const ok = (bytes = 100) => ({
  copy: vi.fn(async () => ({ bytes })),
  verify: vi.fn(async () => bytes),
  record: vi.fn(async () => {}),
});

describe('☠ NOTHING IS RECORDED THAT WAS NOT VERIFIED', () => {
  it('a copy that cannot be verified is NOT recorded', async () => {
    // "Could not tell" must never become "done". The next run then retries it,
    // which costs one duplicate upload and loses nothing.
    const d = { ...ok(), verify: vi.fn(async () => null) };
    const r = await copyAndRecord(['a'], d);
    expect(d.record).not.toHaveBeenCalled();
    expect(r.recorded).toBe(0);
    expect(r.problems[0].why).toMatch(/could not be verified/);
  });

  it('a copy that read back the WRONG SIZE is not recorded', async () => {
    // A truncated upload reads back fine and is still wrong.
    const d = { ...ok(100), verify: vi.fn(async () => 40) };
    const r = await copyAndRecord(['a'], d);
    expect(d.record).not.toHaveBeenCalled();
    expect(r.problems[0].why).toMatch(/stored 40 bytes, sent 100/);
  });

  it('a copy that threw is not recorded', async () => {
    const d = { ...ok(), copy: vi.fn(async () => { throw new Error('bucket refused'); }) };
    const r = await copyAndRecord(['a'], d);
    expect(d.record).not.toHaveBeenCalled();
    expect(r.failed).toBe(1);
  });

  it('verification happens AFTER the copy and BEFORE the record — always', async () => {
    const order = [];
    await copyAndRecord(['a'], {
      copy: vi.fn(async () => { order.push('copy'); return { bytes: 1 }; }),
      verify: vi.fn(async () => { order.push('verify'); return 1; }),
      record: vi.fn(async () => { order.push('record'); }),
    });
    expect(order).toEqual(['copy', 'verify', 'record']);
  });

  it('one bad key never stops the rest, and each problem is named', async () => {
    let n = 0;
    const d = {
      copy: vi.fn(async () => { n += 1; if (n === 2) throw new Error('nope'); return { bytes: 5 }; }),
      verify: vi.fn(async () => 5),
      record: vi.fn(async () => {}),
    };
    const r = await copyAndRecord(['a', 'b', 'c'], d);
    expect(r.recorded).toBe(2);
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0].key).toBe('b');
  });
});

describe('the plan never needs the remote bucket', () => {
  it('asks the LEDGER which keys are missing, not the far side', async () => {
    const known = vi.fn(async (keys) => keys.filter((k) => k !== 'already-there'));
    const p = await planFromLedger(['a', 'already-there', 'b'], { known });
    expect(p.missing).toEqual(['a', 'b']);
    expect(p.considered).toBe(3);
  });

  it('caps a run, and SAYS SO — a silent cap reads as "all copied"', async () => {
    const many = Array.from({ length: 500 }, (_, i) => `k${i}`);
    const p = await planFromLedger(many, { known: async (k) => k, limit: 100 });
    expect(p.missing).toHaveLength(100);
    expect(p.truncated).toBe(true);
    expect(p.remaining).toBe(400);
  });

  it('a full run is not reported as truncated', async () => {
    const p = await planFromLedger(['a'], { known: async (k) => k, limit: 100 });
    expect(p.truncated).toBe(false);
  });

  it('nothing to do is a clean answer, not a crash', async () => {
    for (const src of [[], null, undefined, [null, '', 42]]) {
      const p = await planFromLedger(src, { known: async () => [] });
      expect(p.missing).toEqual([]);
    }
  });
});

describe('what the SOP line can say when the bucket cannot be listed', () => {
  it('states the WEAKER claim honestly', () => {
    // "We copied and verified N" is not "N are there right now", and the
    // difference is the whole reason the listing existed.
    const c = describeCoverage({ sourceCount: 100, ledgerCount: 100, listingWorked: false });
    expect(c.state).toBe('ok');
    expect(c.detail).toMatch(/our own record of verified copies/);
    expect(c.detail).toMatch(/could not be listed/);
  });

  it('and the stronger one when the listing DID work', () => {
    const c = describeCoverage({ sourceCount: 100, ledgerCount: 100, listingWorked: true });
    expect(c.detail).toMatch(/counted in the offsite bucket/);
  });

  it('nothing copied at all is CRITICAL, and says files exist in one place', () => {
    const c = describeCoverage({ sourceCount: 17020, ledgerCount: 0 });
    expect(c.state).toBe('critical');
    expect(c.detail).toMatch(/17,020 files exist in ONE place/);
  });

  it('behind is a warning that names the gap', () => {
    const c = describeCoverage({ sourceCount: 100, ledgerCount: 60 });
    expect(c.state).toBe('warn');
    expect(c.missing).toBe(40);
    expect(c.detail).toMatch(/40 not yet protected/);
  });

  it('unreadable numbers are UNKNOWN, never ok', () => {
    for (const bad of [{ sourceCount: null, ledgerCount: 5 }, { sourceCount: 5, ledgerCount: 'x' }]) {
      expect(describeCoverage(bad).state).toBe('unknown');
    }
  });

  it('no media at all is fine, not critical', () => {
    expect(describeCoverage({ sourceCount: 0, ledgerCount: 0 }).state).toBe('ok');
  });
});

describe('the table, and how it seeds without re-uploading 72 GB', () => {
  it('the key is the primary key, so a re-copy cannot duplicate a row', () => {
    expect(LEDGER_DDL).toMatch(/object_key TEXT PRIMARY KEY/);
  });

  it('recording is an upsert — copying twice is harmless', () => {
    expect(RECORD_SQL).toMatch(/ON CONFLICT \(object_key\) DO UPDATE/);
  });

  it('a successful listing SEEDS the ledger rather than being required by it', () => {
    // This is what lets it ship without re-uploading everything already there,
    // and what self-heals a lost record. The listing is demoted, not deleted.
    expect(SEED_SQL).toMatch(/ON CONFLICT \(object_key\) DO NOTHING/);
    expect(SEED_SQL).toMatch(/UNNEST/);
  });

  it('the missing-check is one query over an array, not one per key', () => {
    // 17,000 round trips per pass would replace a slow listing with something
    // slower.
    expect(MISSING_SQL).toMatch(/UNNEST\(\$1::text\[\]\)/);
    expect(MISSING_SQL).toMatch(/NOT EXISTS/);
  });
});
