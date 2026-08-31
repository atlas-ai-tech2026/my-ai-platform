// ─── ledger-audit.test.js ────────────────────────────────────────────────────
// Checking the files copied while the backup was blind.
//
// The single most important property here is the one this project keeps
// getting wrong: NOTHING CHECKED MUST NEVER READ AS A PASS. "0 of 0 failed" is
// arithmetically true and is how a screen ends up reassuring somebody about a
// check that never ran.

import { describe, it, expect, vi } from 'vitest';
import {
  auditSample, verdict, SAMPLE_SQL, COUNT_SQL, BLIND_FROM, BLIND_UNTIL, DEFAULT_SAMPLE,
} from './ledger-audit.js';

const rows = (n) => Array.from({ length: n }, (_, i) => ({ object_key: `k${i}`, bytes: 10 }));
const quiet = { log() {}, error() {} };

describe('☠ NOTHING CHECKED IS NOT A PASS', () => {
  it('an empty sample is "unknown", never ok', () => {
    expect(verdict({ checked: 0, ok: 0, bad: [] }).tone).toBe('unknown');
    expect(verdict({ checked: 0, ok: 0, bad: [] }).headline).toMatch(/nothing was checked/i);
  });

  it('and it says so rather than implying success', () => {
    expect(verdict({ checked: 0 }).detail).toMatch(/not a pass/i);
  });

  it('but genuinely having no rows is explained, not alarming', () => {
    // There is a real difference between "nothing to check" and "the check
    // could not run", and the screen must not blur them.
    expect(verdict({ checked: 0, total: 0 }).detail).toMatch(/no ledger rows/i);
  });
});

describe('reading the files back', () => {
  it('passes when every file is there at the right size', async () => {
    const out = await auditSample({
      rows: rows(5), read: async () => ({ contentLength: 10 }), log: quiet,
    });
    expect(out).toMatchObject({ checked: 5, ok: 5 });
    expect(out.bad).toEqual([]);
    expect(verdict({ ...out, total: 17000 }).tone).toBe('ok');
  });

  it('☠ a file that cannot be read is a FINDING, not a warning', async () => {
    const out = await auditSample({
      rows: rows(3),
      read: async (k) => { if (k === 'k1') throw new Error('NoSuchKey'); return { contentLength: 10 }; },
      log: quiet,
    });
    expect(out.ok).toBe(2);
    expect(out.bad).toHaveLength(1);
    const v = verdict(out);
    expect(v.tone).toBe('bad');
    // The whole point: one failure invalidates sampling as a method.
    expect(v.detail).toMatch(/not just a sample|needs reading back/i);
  });

  it('☠ a TRUNCATED file counts as bad even though it exists', async () => {
    const out = await auditSample({
      rows: [{ object_key: 'a', bytes: 100 }],
      read: async () => ({ contentLength: 3 }),
      log: quiet,
    });
    expect(out.bad[0].why).toMatch(/size does not match/);
  });

  it('a row with no recorded size still proves the file EXISTS', async () => {
    // Counted as ok, because existence is most of the question — but it must
    // not be silently treated as a size check that passed.
    const out = await auditSample({
      rows: [{ object_key: 'a', bytes: null }],
      read: async () => ({ contentLength: 999 }),
      log: quiet,
    });
    expect(out.ok).toBe(1);
  });

  it('a read that returns no size at all is bad, not ok', async () => {
    const out = await auditSample({
      rows: [{ object_key: 'a', bytes: 10 }], read: async () => ({}), log: quiet,
    });
    expect(out.bad[0].why).toMatch(/no size/i);
  });

  it('never throws, however badly the reads behave', async () => {
    await expect(auditSample({
      rows: [{ object_key: 'a', bytes: 1 }, null, { bytes: 2 }],
      read: async () => { throw new Error('boom'); },
      log: quiet,
    })).resolves.toBeTruthy();
  });
});

describe('the query', () => {
  it('is scoped to the blind window, not the whole table', () => {
    expect(SAMPLE_SQL).toMatch(/copied_at >= \$1 AND copied_at < \$2/);
    expect(COUNT_SQL).toMatch(/copied_at >= \$1 AND copied_at < \$2/);
  });

  it('samples RANDOMLY, not the first N', () => {
    // The rows are written in time order, so LIMIT without ORDER BY random()
    // would only ever check the first hours of the window.
    expect(SAMPLE_SQL).toMatch(/ORDER BY random\(\)/);
  });

  it('does not use TABLESAMPLE, which samples pages rather than rows', () => {
    // On a table clustered by insertion time that picks a few contiguous runs
    // and misses the rest of the window — the one thing this must not do.
    expect(SAMPLE_SQL).not.toMatch(/TABLESAMPLE/i);
  });

  it('reads nothing outside the dates the failure actually spanned', () => {
    expect(BLIND_FROM).toMatch(/^2026-08-20/);
    expect(BLIND_UNTIL).toMatch(/^2026-08-31/);
    expect(new Date(BLIND_FROM) < new Date(BLIND_UNTIL)).toBe(true);
  });

  it('☠ WRITES NOTHING — it is a check, not a repair', () => {
    for (const sql of [SAMPLE_SQL, COUNT_SQL]) {
      expect(sql).not.toMatch(/\b(UPDATE|DELETE|INSERT|DROP|ALTER)\b/i);
    }
  });

  it('the sample is big enough to mean something', () => {
    expect(DEFAULT_SAMPLE).toBeGreaterThanOrEqual(100);
  });
});
