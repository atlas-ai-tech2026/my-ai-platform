// ─── cdn-rewrite.test.js ─────────────────────────────────────────────────────
// Serving history from the CDN edge WITHOUT rewriting any stored record.
//
// Every file made before the CDN existed carries the origin host in its row.
// A migration would fix that and is the wrong tool: it edits customer history
// in place to gain a faster hostname, and if the CDN is ever switched off,
// every rewritten record points at something that no longer serves.
//
// So the swap happens on the way out, in rowToItem. These tests hold the two
// properties that make that safe:
//
//   1. With no CDN configured it changes NOTHING — so deploying it ahead of
//      the switch cannot affect anybody.
//   2. It only ever touches OUR OWN bucket's urls. A provider url left behind
//      by a failed re-host, someone else's CDN, a data: URI, a relative path —
//      all pass through untouched.

import { describe, it, expect } from 'vitest';
import { toCdn, cdnifyDeep } from './storage.js';

const ORIGIN = 'https://voxel-ai-store.nyc3.digitaloceanspaces.com';
const CDN = 'https://voxel-ai-store.nyc3.cdn.digitaloceanspaces.com';
const opts = { cdnBase: CDN, origin: ORIGIN };

describe('it is inert until the CDN is configured', () => {
  it('changes nothing when there is no cdn base', () => {
    const url = `${ORIGIN}/generations/image/abc.png`;
    expect(toCdn(url, { cdnBase: '', origin: ORIGIN })).toBe(url);
  });

  it('leaves a whole record alone when there is no cdn base', () => {
    const rec = { result_url: `${ORIGIN}/generations/video/x.mp4`, prompt: 'a car' };
    expect(cdnifyDeep(rec, { cdnBase: '', origin: ORIGIN })).toEqual(rec);
  });
});

describe('it swaps our own origin for the edge', () => {
  it('rewrites the host and keeps the key exactly', () => {
    expect(toCdn(`${ORIGIN}/generations/image/f5f2704d.png`, opts))
      .toBe(`${CDN}/generations/image/f5f2704d.png`);
  });

  it('keeps a query string intact', () => {
    expect(toCdn(`${ORIGIN}/generations/video/a.mp4?x=1`, opts))
      .toBe(`${CDN}/generations/video/a.mp4?x=1`);
  });

  it('is idempotent — a url already on the CDN is left alone', () => {
    // rowToItem could run twice on a cached row; a second pass must not
    // produce https://cdn/https://cdn/...
    const already = `${CDN}/generations/image/a.png`;
    expect(toCdn(already, opts)).toBe(already);
  });
});

describe('it never touches anything that is not ours', () => {
  const untouched = [
    'https://v3.fal.media/files/penguin/abc.png',          // provider url, re-host failed
    'https://tempfile.aiquickdraw.com/s/xyz.mp4',          // kie url
    'https://voxel-ai-store-dev.nyc3.digitaloceanspaces.com/x.png', // the OTHER bucket
    'https://evil.com/voxel-ai-store.nyc3.digitaloceanspaces.com/x', // lookalike path
    '/media/seedance-2-hero.mp4',                          // local asset
    'data:image/png;base64,iVBORw0KGgo=',                  // inline
    'blob:https://dev.voxel-ai.ai/9f2a-4c',                // in-browser
    '',
  ];
  for (const url of untouched) {
    it(`leaves ${url.slice(0, 44) || '(empty string)'} alone`, () => {
      expect(toCdn(url, opts)).toBe(url);
    });
  }

  it('does not rewrite a bucket whose name merely STARTS with ours', () => {
    // voxel-ai-store-dev starts with voxel-ai-store. Matching on the host
    // without the trailing slash would silently point dev files at prod's CDN.
    const dev = 'https://voxel-ai-store-dev.nyc3.digitaloceanspaces.com/generations/image/a.png';
    expect(toCdn(dev, opts)).toBe(dev);
  });
});

describe('a whole generation record', () => {
  it('rewrites EVERY url it carries, not just result_url', () => {
    // Video records carry source_video_url and motion_video_url too. A named
    // list would miss whichever field is added next, and the symptom — one
    // thumbnail slower than its neighbours — is the kind nobody reports.
    const rec = {
      result_url: `${ORIGIN}/generations/video/out.mp4`,
      source_video_url: `${ORIGIN}/generations/video/src.mp4`,
      motion_video_url: `${ORIGIN}/generations/video/motion.mp4`,
      character_image_url: `${ORIGIN}/generations/image/face.png`,
      prompt: 'a yellow race car',
      model: 'Seedance 2.5',
      duration: 12,
      saved: true,
    };
    const out = cdnifyDeep(rec, opts);
    for (const k of ['result_url', 'source_video_url', 'motion_video_url', 'character_image_url']) {
      expect(out[k], `${k} was missed`).toBe(rec[k].replace(ORIGIN, CDN));
    }
  });

  it('leaves everything that is not a url completely alone', () => {
    const rec = { prompt: 'a car', duration: 12, saved: true, camera: null, tags: ['a', 'b'] };
    expect(cdnifyDeep(rec, opts)).toEqual(rec);
  });

  it('handles nested references without choking', () => {
    const rec = { refs: [{ url: `${ORIGIN}/a.png` }, { url: `${ORIGIN}/b.png` }] };
    const out = cdnifyDeep(rec, opts);
    expect(out.refs.map((r) => r.url)).toEqual([`${CDN}/a.png`, `${CDN}/b.png`]);
  });

  it('survives null, undefined and a record that is not an object', () => {
    expect(cdnifyDeep(null, opts)).toBe(null);
    expect(cdnifyDeep(undefined, opts)).toBe(undefined);
    expect(cdnifyDeep(42, opts)).toBe(42);
  });

  it('does not recurse forever on something deeply nested', () => {
    let deep = { url: `${ORIGIN}/a.png` };
    for (let i = 0; i < 40; i += 1) deep = { inner: deep };
    expect(() => cdnifyDeep(deep, opts)).not.toThrow();
  });
});

describe('the read path actually calls it', () => {
  // The lesson from the task board: a correct function nobody calls changes
  // nothing, and a unit test on the function says so in a reassuring voice.
  it('rowToItem passes the record through cdnifyDeep', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const src = fs.readFileSync(path.join(here, 'index.js'), 'utf8');
    const fn = src.slice(src.indexOf('function rowToItem'), src.indexOf('function rowToItem') + 1200);
    expect(fn, 'rowToItem spreads row.data raw — old history never reaches the edge')
      .toMatch(/\.\.\.cdnifyDeep\(row\.data/);
  });
});
