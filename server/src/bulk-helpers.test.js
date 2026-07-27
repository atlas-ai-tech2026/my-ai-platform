import { describe, it, expect } from 'vitest';
import { normalizeBulkEmails, generateBulkPassword } from './bulk-helpers.js';

describe('normalizeBulkEmails', () => {
  it('trims, lowercases, dedupes, and splits valid from invalid', () => {
    const r = normalizeBulkEmails([
      '  User@Example.com ', 'user@example.com', 'second@test.io',
      'not-an-email', 'missing@tld', '', null, 'third@ok.dev',
    ]);
    expect(r.valid).toEqual(['user@example.com', 'second@test.io', 'third@ok.dev']);
    expect(r.invalid).toEqual(['not-an-email', 'missing@tld']);
    expect(r.dupes).toBe(1);
  });

  it('handles non-array input and preserves first-seen order', () => {
    expect(normalizeBulkEmails(undefined)).toEqual({ valid: [], invalid: [], dupes: 0 });
    const r = normalizeBulkEmails(['b@x.co', 'a@x.co', 'b@x.co']);
    expect(r.valid).toEqual(['b@x.co', 'a@x.co']);
  });
});

describe('generateBulkPassword', () => {
  it('generates 14-char passwords from the unambiguous alphabet, all distinct', () => {
    const seen = new Set();
    for (let i = 0; i < 50; i++) {
      const pw = generateBulkPassword();
      expect(pw).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789]{14}$/);
      seen.add(pw);
    }
    expect(seen.size).toBe(50);
  });
});
