// ─── uploadToFal.test.js ─────────────────────────────────────────────────────
// Production bug, 2026-08-01: attaching a pasted/base64 image failed with an
// opaque "Failed to fetch". Cause: the code called fetch() on a `data:` URI,
// but the CSP's connect-src is "'self' blob: https:" — data: is not allowed,
// so the browser blocked the request. Pre-existing (the CSP predates the
// security-audit work), surfaced when the owner tested uploads.
//
// The fix decodes base64 in JS, so NO network request happens at all and the
// CSP is irrelevant. These tests also lock in the MIME-type behaviour: the
// old code hardcoded image/png, which would now be rejected with 415 by the
// server's magic-byte check (H2) whenever the real image wasn't a PNG.

import { describe, it, expect, vi } from 'vitest';
import { dataUriToFile, extForMime } from './uploadToFal.js';

// jsdom's File has no .arrayBuffer(); FileReader is supported.
const readBytes = (file) => new Promise((resolve, reject) => {
  const fr = new FileReader();
  fr.onload = () => resolve(new Uint8Array(fr.result));
  fr.onerror = () => reject(fr.error);
  fr.readAsArrayBuffer(file);
});

// Real 1x1 pixels, so the bytes are genuinely of the claimed format.
const PNG_1PX_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const JPEG_1PX_B64 =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

describe('data: URI upload — the CSP bug', () => {
  it('decodes WITHOUT calling fetch (the CSP-blocked path)', () => {
    // If the implementation regressed to fetch(dataUri), this spy would fire
    // and — in a real browser — the CSP would block it.
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const file = dataUriToFile(`data:image/png;base64,${PNG_1PX_B64}`, 'x');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(file).toBeInstanceOf(File);
    expect(file.size).toBeGreaterThan(0);
    fetchSpy.mockRestore();
  });

  it('produces the real PNG bytes (magic number intact)', async () => {
    const file = dataUriToFile(`data:image/png;base64,${PNG_1PX_B64}`, 'x');
    const bytes = await readBytes(file);
    expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]); // \x89PNG
  });

  it('keeps the DECLARED type matching the real bytes — no false 415', async () => {
    // The old code hardcoded image/png. A JPEG paste would then declare PNG
    // while carrying JPEG bytes, and the server's H2 check rejects that.
    const file = dataUriToFile(`data:image/jpeg;base64,${JPEG_1PX_B64}`, 'x');
    expect(file.type).toBe('image/jpeg');
    const bytes = await readBytes(file);
    expect([...bytes.slice(0, 3)]).toEqual([0xff, 0xd8, 0xff]);       // JPEG SOI
    expect(file.name.endsWith('.jpg')).toBe(true);
  });

  it('handles webp and gif data URIs', () => {
    expect(dataUriToFile('data:image/webp;base64,UklGRgA=', 'x').type).toBe('image/webp');
    expect(dataUriToFile('data:image/gif;base64,R0lGODlh', 'x').type).toBe('image/gif');
  });

  it('handles a percent-encoded (non-base64) data URI', () => {
    const file = dataUriToFile('data:image/svg+xml,%3Csvg%3E%3C/svg%3E', 'x');
    expect(file.type).toBe('image/svg+xml');
    expect(file.size).toBeGreaterThan(0);
  });

  it('defaults to image/png when the URI omits a type', () => {
    expect(dataUriToFile(`data:;base64,${PNG_1PX_B64}`, 'x').type).toBe('image/png');
  });

  it('throws a clear error on a malformed URI instead of failing silently', () => {
    expect(() => dataUriToFile('data:image/png;base64')).toThrow(/malformed/i);
  });
});

describe('extForMime', () => {
  it('maps the types the app actually uploads', () => {
    expect(extForMime('image/jpeg')).toBe('jpg');
    expect(extForMime('image/webp')).toBe('webp');
    expect(extForMime('image/gif')).toBe('gif');
    expect(extForMime('video/mp4')).toBe('mp4');
    expect(extForMime('video/quicktime')).toBe('mov');
    expect(extForMime('audio/mpeg')).toBe('mp3');
    expect(extForMime('image/png')).toBe('png');
  });

  it('falls back to png for anything unrecognised', () => {
    expect(extForMime('')).toBe('png');
    expect(extForMime(undefined)).toBe('png');
    expect(extForMime('application/weird')).toBe('png');
  });
});
