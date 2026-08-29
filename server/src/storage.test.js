// ─── storage.test.js ─────────────────────────────────────────────────────────
// keyFromUrl — the input to a DELETE.
//
// This feeds the 30-day purge, which removes a customer's file for good. A url
// it does not recognise must produce NOTHING, never a guess: guessing deletes
// the wrong object, and there is no undo beneath this layer.
//
// So the tests are almost entirely about refusing, and the one positive case
// exists so the guard cannot pass by simply never matching anything.

import { describe, it, expect } from 'vitest';
import { keyFromUrl } from './storage.js';

// The bucket these tests reason about. Built the same way storage.js builds it,
// so the assertions describe the real shape rather than a made-up one.
const ORIGIN = 'https://voxel-ai-store.nyc3.digitaloceanspaces.com';
const CDN = 'https://voxel-ai-store.nyc3.cdn.digitaloceanspaces.com';
// Injected, because the env is not configured under test. Without this the
// positive cases could not run at all — and a guard exercised only on its
// refusal path is one that might match nothing in production.
const key = (u) => keyFromUrl(u, { origin: ORIGIN, cdnBase: CDN });

describe('it refuses everything that is not ours', () => {
  it('provider urls, other hosts, junk', () => {
    for (const u of [
      null, undefined, '', 42, {}, [],
      'https://v3.fal.media/files/abc.png',
      'https://tempfile.aiquickdraw.com/x.png',
      'data:image/png;base64,AAAA',
      '/generations/output/a.png',
      'generations/output/a.png',
      'https://voxel-ai-store.nyc3.digitaloceanspaces.com.evil.com/a.png',
    ]) {
      expect(key(u), JSON.stringify(u)).toBeNull();
    }
  });

  it('a host that merely CONTAINS ours is not ours', () => {
    // startsWith on the full prefix, so this cannot match — but it is the
    // mistake that turns a delete into somebody else's problem.
    expect(key('https://evil.com/https://voxel-ai-store.nyc3.digitaloceanspaces.com/a.png'))
      .toBeNull();
  });

  it('a key that climbs out of its own prefix is refused', () => {
    expect(key(`${ORIGIN}/../../secrets/keys.json`)).toBeNull();
    expect(key(`${ORIGIN}/generations/../../../etc/passwd`)).toBeNull();
  });

  it('an empty key is refused rather than deleting the bucket root', () => {
    expect(key(`${ORIGIN}/`)).toBeNull();
  });
});

describe('and it does recognise a real one', () => {
  // Without this the whole guard could pass by never matching anything at all,
  // and the purge would silently delete no files while reporting success.
  it('returns the key for one of our own urls', () => {
    expect(key(`${ORIGIN}/generations/image/abc-123.png`))
      .toBe('generations/image/abc-123.png');
  });

  it('drops a query string — a signed url is still the same object', () => {
    expect(key(`${ORIGIN}/generations/image/a.png?v=2`))
      .toBe('generations/image/a.png');
  });

  it('recognises the CDN spelling too — history holds both', () => {
    // Files written before the CDN existed carry the origin host; the same
    // object is read through the edge now. Both are the same file.
    expect(key(`${CDN}/generations/image/abc-123.png`)).toBe('generations/image/abc-123.png');
  });

  it('decodes an escaped key, because that is how it is stored', () => {
    expect(key(`${ORIGIN}/generations/image/a b.png`.replace(' ', '%20')))
      .toBe('generations/image/a b.png');
  });
});
