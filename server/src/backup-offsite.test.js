// ─── backup-offsite.test.js ──────────────────────────────────────────────────
// M3 (security audit 2026-07-28): backups lived only in the same
// DigitalOcean account as the database they protect, and were stored
// unencrypted. These tests cover the encryption half (the part that must be
// exactly right — a backup you cannot decrypt is not a backup).

import { describe, it, expect } from 'vitest';
import zlib from 'node:zlib';
import {
  encryptBackup, decryptBackup,
  encryptionConfigured, offsiteConfigured, missingOffsiteVars, choosePrunable, MAX_PRUNE_PER_PASS } from './backup-offsite.js';

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
