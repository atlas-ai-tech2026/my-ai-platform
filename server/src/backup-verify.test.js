// ─── backup-verify.test.js ───────────────────────────────────────────────────
// The point of this file is narrow and worth stating: a test that only proves
// a GOOD archive passes would have passed on day one, while nobody had ever
// restored anything. backup-offsite.test.js already proves the encryption
// round-trips — and it did, all along, while the real question went unasked.
//
// So every test below breaks a real archive in a specific way and asserts the
// break is CAUGHT and NAMED. Each corresponds to one of the five failure modes
// documented at the top of backup-verify.js.

import { describe, it, expect } from 'vitest';
import zlib from 'node:zlib';
import { encryptBackup } from './backup-offsite.js';
import {
  parseArchive, verifyParsed, collectRows,
  CRITICAL_TABLES, MAX_ARCHIVE_AGE_HOURS,
} from './backup-verify.js';

const PASS = 'test-passphrase-not-a-real-one';
const NOW = new Date('2026-08-17T12:00:00Z');

/** Build a real archive the same way runAutomatedBackup does: NDJSON → gzip
 *  → encrypt. Using the actual encryptBackup keeps this honest — if the format
 *  changes, these tests break rather than testing a fiction. */
function buildArchive({
  exportedAt = '2026-08-17T06:00:00Z',
  counts = { users: 3, credits_history: 2, promo_codes: 1, promo_redemptions: 1 },
  rows = null,
  omitManifest = false,
  omitMeta = false,
  tableErrors = [],
  extraLines = [],
  passphrase = PASS,
} = {}) {
  const lines = [];
  if (!omitMeta) {
    lines.push(JSON.stringify({
      meta: { exported_at: exportedAt, tables: Object.keys(counts), version: 1, kind: 'auto' },
    }));
  }
  const actual = rows || counts;
  for (const [table, n] of Object.entries(actual)) {
    for (let i = 0; i < n; i++) {
      lines.push(JSON.stringify({ table, row: { id: i + 1, name: `${table}-${i}` } }));
    }
  }
  for (const te of tableErrors) lines.push(JSON.stringify({ table: te.table, error: te.error }));
  lines.push(...extraLines);
  if (!omitManifest) lines.push(JSON.stringify({ done: true, counts }));

  return encryptBackup(zlib.gzipSync(Buffer.from(lines.join('\n') + '\n')), passphrase);
}

const verify = (buf, opts = {}) => verifyParsed(parseArchive(buf, PASS), { now: NOW, ...opts });

describe('a healthy archive passes', () => {
  it('accepts a complete, current backup', () => {
    const v = verify(buildArchive());
    expect(v.problems).toEqual([]);
    expect(v.ok).toBe(true);
    expect(v.rowsTotal).toBe(7);
    expect(v.counts.users).toBe(3);
  });

  it('reports what it actually found, not what it was told', () => {
    const v = verify(buildArchive());
    expect(v.exportedAt).toBe('2026-08-17T06:00:00Z');
    expect(v.tables).toBe(4);
  });
});

// ── failure 1: the passphrase ──────────────────────────────────────────────
describe('1. a wrong or lost passphrase', () => {
  it('throws rather than returning plausible garbage', () => {
    const buf = buildArchive({ passphrase: 'a-different-passphrase' });
    // AES-GCM authenticates: the wrong key cannot silently produce output.
    expect(() => parseArchive(buf, PASS)).toThrow();
  });

  it('is the single most important thing this catches', () => {
    // Stated as a test because it is the failure that makes EVERY archive
    // worthless at once, and the only signal is that decrypt throws.
    expect(() => parseArchive(buildArchive(), 'wrong')).toThrow();
  });
});

// ── failure 3: corruption ──────────────────────────────────────────────────
describe('3. a corrupt archive', () => {
  it('is rejected when a byte changes in storage', () => {
    const buf = buildArchive();
    const tampered = Buffer.from(buf);
    tampered[tampered.length - 5] ^= 0xff;      // flip a bit in the ciphertext
    expect(() => parseArchive(tampered, PASS)).toThrow();
  });

  it('is rejected when the file is not a Voxel archive at all', () => {
    expect(() => parseArchive(Buffer.from('hello world'), PASS)).toThrow(/not a voxel backup/i);
  });
});

// ── failure 4: incompleteness ──────────────────────────────────────────────
describe('4. an incomplete backup that still "succeeded"', () => {
  it('catches a truncated dump — the manifest line never arrived', () => {
    const v = verify(buildArchive({ omitManifest: true }));
    expect(v.ok).toBe(false);
    expect(v.problems.join(' ')).toMatch(/truncated, not finished/);
  });

  // The backup job writes {table, error} into the archive and carries on, then
  // reports success. Without this, a table erroring every night is invisible.
  it('surfaces a table that errored DURING the backup', () => {
    const v = verify(buildArchive({ tableErrors: [{ table: 'entities', error: 'relation does not exist' }] }));
    expect(v.ok).toBe(false);
    expect(v.problems.join(' ')).toMatch(/entities.*failed during backup.*relation does not exist/);
  });

  it('catches an archive that lies about its own row counts', () => {
    // Manifest claims 3 users; only 1 is really in the file.
    const v = verify(buildArchive({
      counts: { users: 3, credits_history: 2, promo_codes: 1, promo_redemptions: 1 },
      rows:   { users: 1, credits_history: 2, promo_codes: 1, promo_redemptions: 1 },
    }));
    expect(v.ok).toBe(false);
    expect(v.mismatches).toEqual([{ table: 'users', expected: 3, actual: 1 }]);
    expect(v.problems.join(' ')).toMatch(/users: manifest says 3 rows, archive contains 1/);
  });

  it('refuses a backup with no users — whatever else it contains', () => {
    const v = verify(buildArchive({
      counts: { users: 0, credits_history: 5, promo_codes: 1, promo_redemptions: 1 },
    }));
    expect(v.ok).toBe(false);
    expect(v.problems.join(' ')).toMatch(/critical table "users" is empty or absent/);
  });

  it('names every missing critical table, not just the first', () => {
    const v = verify(buildArchive({ counts: { users: 2 } }));
    const joined = v.problems.join(' ');
    for (const t of ['credits_history', 'promo_codes', 'promo_redemptions']) {
      expect(joined, `should name ${t}`).toMatch(new RegExp(`critical table "${t}"`));
    }
  });

  it('flags unparseable lines instead of skipping them quietly', () => {
    const v = verify(buildArchive({ extraLines: ['{this is not json'] }));
    expect(v.ok).toBe(false);
    expect(v.problems.join(' ')).toMatch(/1 unparseable line/);
  });
});

// ── failure 2: staleness ───────────────────────────────────────────────────
describe('2. a backup that stopped running', () => {
  it('accepts an archive from this morning', () => {
    expect(verify(buildArchive({ exportedAt: '2026-08-17T06:00:00Z' })).ok).toBe(true);
  });

  it('rejects one older than the age limit', () => {
    const old = new Date(NOW.getTime() - (MAX_ARCHIVE_AGE_HOURS + 24) * 36e5).toISOString();
    const v = verify(buildArchive({ exportedAt: old }));
    expect(v.ok).toBe(false);
    expect(v.problems.join(' ')).toMatch(/day\(s\) old — the daily backup is not running/);
  });

  // One missed night is a blip; two is a broken job. Asserting the boundary so
  // a future tweak to the constant is a deliberate act.
  it('tolerates a single missed night', () => {
    const oneDay = new Date(NOW.getTime() - 26 * 36e5).toISOString();
    expect(verify(buildArchive({ exportedAt: oneDay })).ok).toBe(true);
  });

  it('warns rather than failing when there is no timestamp to judge', () => {
    const v = verify(buildArchive({ omitMeta: true }));
    expect(v.warnings.join(' ')).toMatch(/age unknown/);
  });
});

describe('collectRows', () => {
  it('returns real rows for the load test, bounded', () => {
    const rows = collectRows(buildArchive({ counts: { users: 50, credits_history: 1, promo_codes: 1, promo_redemptions: 1 } }),
      PASS, { limit: 10 });
    expect(rows.users).toHaveLength(10);
    expect(rows.users[0]).toHaveProperty('id');
  });

  it('only collects the tables asked for', () => {
    const rows = collectRows(buildArchive(), PASS, { tables: ['users'] });
    expect(Object.keys(rows)).toEqual(['users']);
  });
});

describe('the critical table list is the business, not a guess', () => {
  it('covers who the customers are, what they were charged, and what they redeemed', () => {
    expect(CRITICAL_TABLES).toEqual(
      expect.arrayContaining(['users', 'credits_history', 'promo_codes', 'promo_redemptions']));
  });
});
