// ─── backup-offsite.test.js ──────────────────────────────────────────────────
// M3 (security audit 2026-07-28): backups lived only in the same
// DigitalOcean account as the database they protect, and were stored
// unencrypted. These tests cover the encryption half (the part that must be
// exactly right — a backup you cannot decrypt is not a backup).

import { describe, it, expect } from 'vitest';
import zlib from 'node:zlib';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  encryptBackup, decryptBackup,
  encryptionConfigured, offsiteConfigured, missingOffsiteVars, choosePrunable, MAX_PRUNE_PER_PASS, prunePrimary,} from './backup-offsite.js';

const PASS = 'a-long-random-backup-passphrase-2026';
const sample = Buffer.from(JSON.stringify({ table: 'users', row: { id: 1, email: 'a@b.c' } }));

describe('M3 — backups are encrypted at rest', () => {
  it('round-trips exactly (a backup you cannot restore is worthless)', () => {
    const enc = encryptBackup(sample, PASS);
    expect(decryptBackup(enc, PASS)).toEqual(sample);
  });

  it('the ciphertext does not leak the plaintext', () => {
    const enc = encryptBackup(sample, PASS);
    expect(enc.includes(Buffer.from('a@b.c'))).toBe(false);
    expect(enc.includes(Buffer.from('users'))).toBe(false);
  });

  it('the WRONG passphrase fails loudly instead of returning garbage', () => {
    const enc = encryptBackup(sample, PASS);
    expect(() => decryptBackup(enc, 'wrong-passphrase')).toThrow();
  });

  it('TAMPERING is detected (GCM authentication)', () => {
    const enc = encryptBackup(sample, PASS);
    const tampered = Buffer.from(enc);
    tampered[tampered.length - 1] ^= 0xff;      // flip a ciphertext bit
    expect(() => decryptBackup(tampered, PASS)).toThrow();

    const tamperedTag = Buffer.from(enc);
    tamperedTag[40] ^= 0xff;                     // flip an auth-tag bit
    expect(() => decryptBackup(tamperedTag, PASS)).toThrow();
  });

  it('encrypting the same data twice gives different ciphertext (fresh salt+IV)', () => {
    const a = encryptBackup(sample, PASS);
    const b = encryptBackup(sample, PASS);
    expect(a.equals(b)).toBe(false);
    // …but both still decrypt.
    expect(decryptBackup(a, PASS)).toEqual(sample);
    expect(decryptBackup(b, PASS)).toEqual(sample);
  });

  it('works on a realistic gzipped NDJSON archive', () => {
    const ndjson = Array.from({ length: 500 }, (_, i) =>
      JSON.stringify({ table: 'users', row: { id: i, email: `user${i}@example.com` } })).join('\n');
    const gz = zlib.gzipSync(Buffer.from(ndjson));
    const restored = zlib.gunzipSync(decryptBackup(encryptBackup(gz, PASS), PASS));
    expect(restored.toString()).toBe(ndjson);
  });

  it('rejects a non-Voxel or truncated file with a clear message', () => {
    expect(() => decryptBackup(Buffer.from('not a backup'), PASS)).toThrow(/not a voxel backup/i);
    expect(() => decryptBackup(Buffer.alloc(4), PASS)).toThrow(/too short/i);
  });

  it('refuses to encrypt or decrypt without a passphrase', () => {
    expect(() => encryptBackup(sample, '')).toThrow(/PASSPHRASE/);
    expect(() => decryptBackup(encryptBackup(sample, PASS), '')).toThrow(/PASSPHRASE/);
  });
});

describe('M3 — configuration detection', () => {
  const full = {
    BACKUP_ENCRYPTION_PASSPHRASE: 'x',
    OFFSITE_S3_ENDPOINT: 'https://s3.example.com',
    OFFSITE_S3_REGION: 'us-west-004',
    OFFSITE_S3_BUCKET: 'voxel-offsite',
    OFFSITE_S3_KEY: 'k',
    OFFSITE_S3_SECRET: 's',
  };

  it('detects a fully configured offsite destination', () => {
    expect(offsiteConfigured(full)).toBe(true);
    expect(encryptionConfigured(full)).toBe(true);
    expect(missingOffsiteVars(full)).toEqual([]);
  });

  it('reports exactly which variables are missing', () => {
    const { OFFSITE_S3_SECRET, BACKUP_ENCRYPTION_PASSPHRASE, ...partial } = full;
    expect(offsiteConfigured(partial)).toBe(false);
    expect(missingOffsiteVars(partial).sort())
      .toEqual(['BACKUP_ENCRYPTION_PASSPHRASE', 'OFFSITE_S3_SECRET']);
  });

  it('treats blank values as missing (an empty env var is not configuration)', () => {
    expect(offsiteConfigured({ ...full, OFFSITE_S3_BUCKET: '   ' })).toBe(false);
    expect(encryptionConfigured({ BACKUP_ENCRYPTION_PASSPHRASE: '  ' })).toBe(false);
  });

  it('an empty environment reports every variable as missing', () => {
    expect(missingOffsiteVars({})).toHaveLength(6);
    expect(offsiteConfigured({})).toBe(false);
  });
});

// ── offsite retention ──────────────────────────────────────────────────────
// Found from the owner's Backblaze screenshot on 2026-08-18: 1 GB used where
// ~200 MB was expected. NOTHING had ever deleted from the offsite bucket — the
// 14-day retention only ran against DigitalOcean Spaces. The second copy had
// kept every archive since 2 August.
//
// This code deletes customer backups, so the decision is a pure function and
// the tests below are about what it REFUSES to do.
describe('choosePrunable — what the offsite retention will remove', () => {
  const obj = (key, day) => ({ key, size: 100, modified: `2026-08-${String(day).padStart(2, '0')}T00:00:00Z` });
  const fourteen = Array.from({ length: 20 }, (_, i) => obj(`backups/voxel-auto-2026-08-${20 - i}.enc`, 20 - i));

  it('keeps the newest N and removes the rest', () => {
    const { doomed } = choosePrunable(fourteen, { prefix: 'backups/', keep: 14 });
    expect(doomed).toHaveLength(6);
    expect(doomed.every((o) => o.key.startsWith('backups/'))).toBe(true);
  });

  it('removes nothing when there are fewer than N', () => {
    expect(choosePrunable(fourteen.slice(0, 5), { prefix: 'backups/', keep: 14 }).doomed).toEqual([]);
  });

  // The one that matters: a listing bug must not reach production's archives
  // while cleaning up dev's.
  it('never touches a key outside the prefix', () => {
    const mixed = [obj('backups/prod-1.enc', 5), obj('dev-backups/dev-1.enc', 4), obj('backups/prod-2.enc', 3)];
    const { doomed } = choosePrunable(mixed, { prefix: 'dev-backups/', keep: 0 });
    expect(doomed.map((o) => o.key)).toEqual(['dev-backups/dev-1.enc']);
  });

  it('caps how much one pass may delete', () => {
    const many = Array.from({ length: 200 }, (_, i) => obj(`backups/f${i}.enc`, 1));
    const { doomed, capped } = choosePrunable(many, { prefix: 'backups/', keep: 0 });
    expect(doomed).toHaveLength(MAX_PRUNE_PER_PASS);
    expect(capped).toBe(200);
  });

  // A bare bucket listing is the difference between retention and data loss.
  it('REFUSES to run without a directory prefix', () => {
    for (const bad of ['', '/', null, undefined, 'backups']) {
      expect(() => choosePrunable(fourteen, { prefix: bad, keep: 14 }),
        JSON.stringify(bad)).toThrow(/refusing to prune/);
    }
  });

  it('refuses a nonsensical keep', () => {
    for (const bad of [-1, 1.5, '14', null]) {
      expect(() => choosePrunable(fourteen, { prefix: 'backups/', keep: bad })).toThrow(/invalid keep/);
    }
  });
});

// The offsite copy keeps LONGER than Spaces, and that is deliberate. Spaces is
// the convenient copy for an ordinary bad day; Backblaze is the copy that
// survives losing the DigitalOcean account — the case where a problem is most
// likely to go unnoticed for a while. A 14-day window means anything found on
// day 15 is gone, and 30 days costs ~160 MB against a 10 GB tier.
describe('retention policy: offsite outlives the primary', () => {
  const files = (n) => Array.from({ length: n }, (_, i) => ({
    key: `backups/voxel-auto-${String(i).padStart(3, '0')}.enc`,
    size: 5_300_000,
    modified: `2026-08-18T00:${String(i).padStart(2, '0')}:00Z`,
  }));

  it('keeps 30 offsite where Spaces keeps 14', () => {
    expect(choosePrunable(files(20), { prefix: 'backups/', keep: 30 }).doomed).toEqual([]);
    expect(choosePrunable(files(20), { prefix: 'backups/', keep: 14 }).doomed).toHaveLength(6);
  });

  it('deletes nothing from production at the current file count', () => {
    // 17 archives existed when this policy was chosen; 30 keeps them all.
    expect(choosePrunable(files(17), { prefix: 'backups/', keep: 30 }).doomed).toEqual([]);
  });

  it('30 days of archives is a rounding error against the free tier', () => {
    const bytes = 30 * 5_300_000;
    expect(bytes).toBeLessThan(0.02 * 10 * 1024 ** 3);   // under 2% of 10 GB
  });

  it('clears dev orphans completely — they protect nothing', () => {
    const dev = files(17).map((f) => ({ ...f, key: f.key.replace('backups/', 'dev-backups/') }));
    expect(choosePrunable(dev, { prefix: 'dev-backups/', keep: 0 }).doomed).toHaveLength(17);
  });
});

// ─── the gap: nothing ever pruned the PRIMARY copy ───────────────────────────
// pruneOffsite has always covered Backblaze. Nothing covered Spaces, so the
// primary grew without limit and — the worse half — without anyone able to see
// that it was growing. The two copies were quietly diverging: offsite trimmed
// to a retention, primary unbounded.
//
// It ships DRY. The last time backups were pruned the owner read the list first
// and the outcome was to WIDEN retention rather than delete, because those
// archives are the only copies reaching back and storage is not a constraint.
describe('pruning the primary copy', () => {
  const objects = Array.from({ length: 40 }, (_, i) => ({
    key: `backups/voxel-auto-2026-07-${String(i + 1).padStart(2, '0')}.ndjson.gz.enc`,
    size: 1000 + i,
  }));
  const listing = () => Promise.resolve(objects);

  it('reports without deleting, by default', async () => {
    const removed = [];
    const r = await prunePrimary({
      prefix: 'backups/', keep: 30, list: listing, remove: (k) => removed.push(k),
    });
    expect(r.dryRun).toBe(true);
    expect(r.doomed).toHaveLength(10);
    expect(r.deleted).toBe(0);
    expect(removed, 'a dry run deleted something').toEqual([]);
  });

  it('deletes only when told to, and only the ones beyond the retention', async () => {
    const removed = [];
    const r = await prunePrimary({
      prefix: 'backups/', keep: 30, dryRun: false,
      list: listing, remove: async (k) => { removed.push(k); },
    });
    expect(r.deleted).toBe(10);
    expect(removed).toHaveLength(10);
    expect(removed.every((k) => k.startsWith('backups/'))).toBe(true);
  });

  it('keeps everything when the retention covers the lot', async () => {
    const r = await prunePrimary({ prefix: 'backups/', keep: 100, list: listing, remove: () => {} });
    expect(r.doomed).toEqual([]);
  });

  // The same refusal its sibling carries. A prefix bug must not become a
  // bucket-wide delete.
  it('refuses a key that falls outside the prefix it was given', async () => {
    const removed = [];
    await prunePrimary({
      prefix: 'backups/', keep: 0, dryRun: false,
      list: () => Promise.resolve([
        { key: 'backups/ok.enc', size: 1 },
        { key: 'generations/customer-image.png', size: 1 },   // must never go
      ]),
      remove: async (k) => { removed.push(k); },
    });
    expect(removed, 'customer media was inside a backup prune').toEqual(['backups/ok.enc']);
  });

  it('refuses to run with no prefix at all, rather than treating it as everything', async () => {
    await expect(prunePrimary({ prefix: '', keep: 1, list: listing, remove: () => {} }))
      .rejects.toThrow(/refusing to prune without a directory prefix/);
  });

  // Both copies obey ONE definition of what may be removed. A second, slightly
  // different rule is exactly how the two would drift apart again.
  it('uses the same chooser as the offsite prune', async () => {
    const r = await prunePrimary({ prefix: 'backups/', keep: 30, list: listing, remove: () => {} });
    const { doomed } = choosePrunable(objects, { prefix: 'backups/', keep: 30 });
    expect(r.doomed).toEqual(doomed);
  });
});

// ─── TWO POOLS, SO UPLOADS CANNOT STARVE LISTINGS (2026-08-28) ──────────────
// Production stalled for two and a half hours tonight: every listing failed
// with "the request socket did not establish a connection", four hours after a
// clean restart, directly behind a 235 MiB upload batch. The sync must list
// the destination before it can copy, so nothing went offsite while customers
// generated video all evening.
//
// These read the source rather than the behaviour, because the thing that must
// be true is a WIRING fact: reads and writes use different clients. A unit test
// on either function would pass however they are wired.
describe('listings and uploads do not share a connection pool', () => {
  const src = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'backup-offsite.js'), 'utf8')
    .split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//')).join('\n');

  it('there are two clients, cached separately', () => {
    expect(src).toMatch(/let cachedClient = null/);
    expect(src).toMatch(/let cachedReader = null/);
  });

  it('every LIST goes through the reader', () => {
    expect(src).not.toMatch(/offsiteClient\(env\)\.send\(new ListObjectsV2Command/);
    expect(src).toMatch(/offsiteReader\(env\)\.send\(new ListObjectsV2Command/);
  });

  it('and every WRITE stays on the upload client — a slow PUT is normal', () => {
    // Uploads of whole videos to another continent legitimately take minutes.
    // Giving them the listing's shorter deadline would break the backup to fix
    // the check that watches it.
    expect(src).toMatch(/offsiteClient\(env\)\.send\(new PutObjectCommand/);
    expect(src).not.toMatch(/offsiteReader\(env\)\.send\(new PutObjectCommand/);
  });

  it('the reader gives up sooner than an upload does', () => {
    const reader = src.slice(src.indexOf('function offsiteReader'), src.indexOf('function offsiteClient'));
    expect(reader).toMatch(/requestTimeout: 30_000/);
  });

  it('neither client is left without a deadline — that caused the 3-hour silence', () => {
    for (const fn of ['offsiteReader', 'offsiteClient']) {
      const block = src.slice(src.indexOf(`function ${fn}`), src.indexOf(`function ${fn}`) + 400);
      expect(block, `${fn} has no connectionTimeout`).toMatch(/connectionTimeout/);
      expect(block, `${fn} has no requestTimeout`).toMatch(/requestTimeout/);
    }
  });
});
