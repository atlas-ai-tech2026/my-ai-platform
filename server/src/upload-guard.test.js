// ─── upload-guard.test.js ────────────────────────────────────────────────────
// H2 (security audit 2026-07-28): /api/upload accepted any file type from
// anyone. These tests prove the content-type policy: only image/video/audio
// are accepted, and the file's real magic bytes must match the declared type
// (a renamed executable is rejected).

import { describe, it, expect } from 'vitest';
import {
  validateUpload,
  isAllowedUploadMime,
  sniffMediaFamily,
} from './upload-guard.js';

// Minimal but realistic file headers (padded to >= 12 bytes).
const pad = (bytes) => Buffer.concat([Buffer.from(bytes), Buffer.alloc(16)]);
const PNG  = pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = pad([0xff, 0xd8, 0xff, 0xe0]);
const GIF  = pad([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(8)]);
const WAV  = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.alloc(8)]);
const MP4  = Buffer.concat([Buffer.alloc(4), Buffer.from('ftyp'), Buffer.from('isom'), Buffer.alloc(8)]);
const MOV  = Buffer.concat([Buffer.alloc(4), Buffer.from('ftyp'), Buffer.from('qt  '), Buffer.alloc(8)]);
const M4A  = Buffer.concat([Buffer.alloc(4), Buffer.from('ftyp'), Buffer.from('M4A '), Buffer.alloc(8)]);
const WEBM = pad([0x1a, 0x45, 0xdf, 0xa3]);
const MP3  = pad([0x49, 0x44, 0x33, 0x03]);
const EXE  = pad([0x4d, 0x5a, 0x90, 0x00]);
const ELF  = pad([0x7f, 0x45, 0x4c, 0x46]);
const ZIP  = pad([0x50, 0x4b, 0x03, 0x04]);
const PDF  = pad([0x25, 0x50, 0x44, 0x46]);
const HTML = pad(Array.from(Buffer.from('<html><script>')));

describe('H2 — dangerous uploads are rejected (415)', () => {
  it('rejects an executable renamed as a PNG', () => {
    const v = validateUpload({ mimetype: 'image/png', buffer: EXE });
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/not an image, video or audio/i);
  });

  it('rejects an ELF binary claiming to be a video', () => {
    expect(validateUpload({ mimetype: 'video/mp4', buffer: ELF }).ok).toBe(false);
  });

  it('rejects zip/office archives and PDFs', () => {
    expect(validateUpload({ mimetype: 'image/png', buffer: ZIP }).ok).toBe(false);
    expect(validateUpload({ mimetype: 'image/png', buffer: PDF }).ok).toBe(false);
  });

  it('rejects HTML (stored-XSS vector) even with an image content type', () => {
    expect(validateUpload({ mimetype: 'image/png', buffer: HTML }).ok).toBe(false);
  });

  it('rejects disallowed MIME types outright', () => {
    ['application/pdf', 'text/html', 'application/x-msdownload',
     'application/octet-stream', 'text/plain', ''].forEach((m) => {
      expect(isAllowedUploadMime(m), m).toBe(false);
      expect(validateUpload({ mimetype: m, buffer: PNG }).ok, m).toBe(false);
    });
  });

  it('rejects a real image declared as the WRONG family', () => {
    // PNG bytes but declared video/mp4 — content/type mismatch.
    const v = validateUpload({ mimetype: 'video/mp4', buffer: PNG });
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/does not match/i);
  });

  it('rejects empty or truncated files', () => {
    expect(validateUpload({ mimetype: 'image/png', buffer: Buffer.alloc(0) }).ok).toBe(false);
    expect(validateUpload({ mimetype: 'image/png', buffer: Buffer.from([0x89, 0x50]) }).ok).toBe(false);
  });
});

describe('H2 — legitimate uploads still work', () => {
  it('accepts the image formats the app uses', () => {
    expect(validateUpload({ mimetype: 'image/png',  buffer: PNG  }).ok).toBe(true);
    expect(validateUpload({ mimetype: 'image/jpeg', buffer: JPEG }).ok).toBe(true);
    expect(validateUpload({ mimetype: 'image/gif',  buffer: GIF  }).ok).toBe(true);
    expect(validateUpload({ mimetype: 'image/webp', buffer: WEBP }).ok).toBe(true);
  });

  it('accepts video for Motion Control / Edit Video', () => {
    expect(validateUpload({ mimetype: 'video/mp4', buffer: MP4 }).ok).toBe(true);
    expect(validateUpload({ mimetype: 'video/quicktime', buffer: MOV }).ok).toBe(true);
    expect(validateUpload({ mimetype: 'video/webm', buffer: WEBM }).ok).toBe(true);
  });

  it('accepts audio for the voice canvas / Seedance audio refs', () => {
    expect(validateUpload({ mimetype: 'audio/mpeg', buffer: MP3 }).ok).toBe(true);
    expect(validateUpload({ mimetype: 'audio/wav',  buffer: WAV }).ok).toBe(true);
    expect(validateUpload({ mimetype: 'audio/mp4',  buffer: M4A }).ok).toBe(true);
    expect(validateUpload({ mimetype: 'audio/webm', buffer: WEBM }).ok).toBe(true);
  });

  it('tolerates a charset suffix on the content type', () => {
    expect(isAllowedUploadMime('image/png; charset=binary')).toBe(true);
  });
});

describe('magic-byte sniffing', () => {
  it('identifies families correctly', () => {
    expect(sniffMediaFamily(PNG)).toBe('image');
    expect(sniffMediaFamily(MP4)).toBe('video');
    expect(sniffMediaFamily(M4A)).toBe('audio');
    expect(sniffMediaFamily(WAV)).toBe('audio');
    expect(sniffMediaFamily(WEBM)).toBe('matroska');
    expect(sniffMediaFamily(EXE)).toBe('executable');
    expect(sniffMediaFamily(ZIP)).toBe('archive');
    expect(sniffMediaFamily(PDF)).toBe('document');
    expect(sniffMediaFamily(Buffer.alloc(4))).toBe(null);
  });
});
