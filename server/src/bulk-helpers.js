// ─── bulk-helpers.js ─────────────────────────────────────────────────────────
// Pure helpers for the CRM Bulk user-provisioning endpoint — separate module
// so they're unit-testable without booting the server.

import { randomBytes } from 'node:crypto';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Normalize a raw email list from an uploaded sheet: trim, lowercase,
 * dedupe, split valid from invalid. Order of first appearance is kept.
 */
export function normalizeBulkEmails(raw) {
  const seen = new Set();
  const valid = [];
  const invalid = [];
  let dupes = 0;
  for (const item of Array.isArray(raw) ? raw : []) {
    const email = String(item ?? '').trim().toLowerCase();
    if (!email) continue;
    if (seen.has(email)) { dupes++; continue; }
    seen.add(email);
    (EMAIL_RE.test(email) && email.length <= 255 ? valid : invalid).push(email);
  }
  return { valid, invalid, dupes };
}

// Same unambiguous alphabet as gift-card codes (no 0/O/1/I/l) plus digits —
// 14 chars ≈ 68 bits of entropy, far beyond any offline-cracking horizon,
// which is what justifies the lighter bcrypt cost used for bulk creation.
const PW_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
export function generateBulkPassword(len = 14) {
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += PW_ALPHABET[bytes[i] % PW_ALPHABET.length];
  return out;
}
