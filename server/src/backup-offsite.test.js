// ─── backup-offsite.test.js ──────────────────────────────────────────────────
// M3 (security audit 2026-07-28): backups lived only in the same
// DigitalOcean account as the database they protect, and were stored
// unencrypted. These tests cover the encryption half (the part that must be
// exactly right — a backup you cannot decrypt is not a backup).

import { describe, it, expect } from 'vitest';
import zlib from 'node:zlib';
import {
  encryptBackup, decryptBackup,
  encryptionConfigured, offsiteConfigured, missingOffsiteVars,
} from './backup-offsite.js';

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
