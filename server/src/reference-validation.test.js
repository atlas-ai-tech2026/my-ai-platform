// ─── reference-validation.test.js ────────────────────────────────────────────
// N6 (recheck 2026-08-03): reference images sent as data: URIs bypassed the
// upload guard completely. /api/upload runs validateUpload on the multipart
// path, but resolveReferenceUrls decoded the base64 and handed the bytes —
// plus the CALLER'S OWN Content-Type — straight to persistBuffer, which writes
// to Spaces with ACL 'public-read'.
//
// Result: any signed-in user could host arbitrary content on our bucket, under
// our domain, for free. The object survived even when the generation failed and
// the credits were refunded, so the effective cost was zero.
//
// These tests pin the payloads that mattered, and — just as important — that
// genuine images still pass, including HEIC from iPhones.

import { describe, it, expect } from 'vitest';
import { validateUpload } from './upload-guard.js';

/** Build what a data: URI decodes to: a declared type plus raw bytes. */
function decoded(mimetype, bytes) {
  return { mimetype, buffer: Buffer.from(bytes) };
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13];
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1];
const GIF = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0x80, 0];
const HEIC = [0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]; // ....ftypheic

describe('N6 — hostile data: URIs are refused before anything is written', () => {
  it('refuses text/html, the payload that made the bucket a free web host', () => {
    // data:text/html;base64,PHNjcmlwdD4... — previously stored public-read
    // WITH Content-Type text/html, so a browser would render it.
    const v = validateUpload(decoded('text/html', Buffer.from('<script>alert(1)</script>')));
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/unsupported file type/i);
  });

  it('refuses SVG, which can carry script even though it is an image type', () => {
    const v = validateUpload(decoded('image/svg+xml', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>')));
    expect(v.ok).toBe(false);
  });

  it('refuses HTML disguised with an allowed Content-Type', () => {
    // The declared type is fine; the bytes are not. Magic-byte sniffing is
    // what closes this, since the caller controls the declared type entirely.
    const v = validateUpload(decoded('image/png', Buffer.from('<html><body>not a png at all</body></html>')));
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/not a recognised|does not match/i);
  });

  it('refuses an executable renamed as an image', () => {
    const MZ = [0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 4, 0, 0, 0];
    expect(validateUpload(decoded('image/png', MZ)).ok).toBe(false);
  });

  it('refuses an empty or truncated payload', () => {
    expect(validateUpload(decoded('image/png', [])).ok).toBe(false);
    expect(validateUpload(decoded('image/png', [0x89, 0x50])).ok).toBe(false);
  });

  it('refuses a missing Content-Type', () => {
    expect(validateUpload({ mimetype: '', buffer: Buffer.from(PNG) }).ok).toBe(false);
  });
});

describe('N6 — real reference images still work', () => {
  // The whole point of resolveReferenceUrls is that a user's uploaded
  // reference reaches the provider. Rejecting genuine images here would break
  // image-to-image, start frames and the node canvas.
  it('accepts PNG', () => expect(validateUpload(decoded('image/png', PNG)).ok).toBe(true));
  it('accepts JPEG', () => expect(validateUpload(decoded('image/jpeg', JPEG)).ok).toBe(true));
  it('accepts GIF', () => expect(validateUpload(decoded('image/gif', GIF)).ok).toBe(true));

  it('accepts HEIC — iPhone photos arrive in this format', () => {
    expect(validateUpload(decoded('image/heic', HEIC)).ok).toBe(true);
  });

  it('accepts a Content-Type carrying parameters', () => {
    // data:image/png;charset=utf-8;base64,... is legal.
    expect(validateUpload(decoded('image/png; charset=utf-8', PNG)).ok).toBe(true);
  });
});

describe('N6 — the guard is actually wired into the data: URI path', () => {
  // The tests above prove validateUpload rejects these payloads. This one
  // proves resolveReferenceUrls actually CALLS it — the bug was never that the
  // validator was wrong, it was that this path never reached it.
  it('resolveReferenceUrls validates before it persists', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const path = await import('node:path');
    const src = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.js'), 'utf8'
    );
    const start = src.indexOf('async function resolveReferenceUrls');
    expect(start, 'resolveReferenceUrls not found — renamed?').toBeGreaterThan(-1);
    const raw = src.slice(start, src.indexOf('\n}', src.indexOf('persistBuffer', start)));
    // Strip comments first. The explanatory comment above the guard MENTIONS
    // validateUpload, so a naive search matches even when the call is gone —
    // this test silently passed against a deliberately removed guard until the
    // comments were stripped.
    const body = raw.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

    const validateAt = body.indexOf('validateUpload(');
    const persistAt = body.indexOf('persistBuffer(');
    expect(validateAt, 'data: URI references reach storage without validateUpload').toBeGreaterThan(-1);
    expect(
      validateAt < persistAt,
      'validateUpload must run BEFORE persistBuffer — otherwise the object is ' +
      'already public on our bucket by the time it is rejected.'
    ).toBe(true);
  });
});
