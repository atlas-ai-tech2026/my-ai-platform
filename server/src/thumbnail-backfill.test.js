// ─── thumbnail-backfill.test.js ──────────────────────────────────────────────
// This is the module that WRITES, so the tests are mostly about what it
// refuses to write.
//
// The owner's condition for the whole piece of work was that nothing happens
// to customer data. Four promises were made. Each one has a test here, because
// a promise in a comment is not a mechanism.

import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { Jimp } from 'jimp';
import {
  makeThumbnail, backfillRows, SET_THUMB_SQL, THUMB_WIDTH, MAX_SOURCE_BYTES,
} from './thumbnail-backfill.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** A real PNG, so the resizer is exercised rather than mocked. */
async function png(w, h) {
  const img = new Jimp({ width: w, height: h, color: 0x3366ccff });
  return img.getBuffer('image/png');
}

/**
 * A NOISY png — random pixels, so it cannot be compressed away.
 *
 * The flat-colour one above encodes 1600×900 into under 2 KB, which is
 * nothing like a real generation and made "the thumbnail is smaller than the
 * original" fail against a module that was behaving correctly. A customer's
 * 8 MB photograph is closer to noise than to a solid rectangle.
 */
async function noisyPng(w, h) {
  const img = new Jimp({ width: w, height: h, color: 0x000000ff });
  crypto.randomFillSync(img.bitmap.data);
  return img.getBuffer('image/png');
}

const row = (over = {}) => ({
  id: `e-${Math.random().toString(36).slice(2, 8)}`,
  data: { type: 'image', status: 'completed', result_url: 'https://s/a.png', ...over },
});

/** A fetch that returns the given buffer. */
const server = (buf, ok = true, status = 200) => vi.fn(async () => ({
  ok, status, arrayBuffer: async () => buf,
}));

function harness({ fetchImpl, persistImpl, setThumbImpl } = {}) {
  const writes = [];
  const uploads = [];
  return {
    writes,
    uploads,
    deps: {
      fetchImpl,
      persist: persistImpl || (async (buf, ct, kind) => {
        uploads.push({ bytes: buf.length, contentType: ct, kind });
        return `https://cdn/generations/${kind}/${uploads.length}.jpg`;
      }),
      setThumb: setThumbImpl || (async (id, url) => { writes.push({ id, url }); }),
    },
  };
}

describe('PROMISE 2 — result_url cannot be changed', () => {
  const src = fs.readFileSync(path.join(HERE, 'thumbnail-backfill.js'), 'utf8');
  const codeOnly = src.split('\n')
    .filter((l) => { const t = l.trim(); return t && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*'); })
    .join('\n');

  it('writes through jsonb_set on exactly one path', () => {
    expect(SET_THUMB_SQL).toMatch(/jsonb_set\(data, '\{thumb_url\}'/);
  });

  it('has no statement able to reach any other key', () => {
    expect(SET_THUMB_SQL).not.toMatch(/result_url/);
    // `data = data ||` is the shallow-merge the generic PUT route uses; it
    // CAN overwrite result_url, which is exactly why it is not used here.
    //
    // Checked against the SQL ONLY. The first version scanned the whole file
    // and matched `row.data || row` — JavaScript's default-value operator, not
    // JSONB concat — flagging correct code. Scanning prose for SQL is the same
    // mistake as scanning comments for code.
    expect(SET_THUMB_SQL, 'a merge write could reach result_url').not.toMatch(/data\s*\|\|/);
    expect(codeOnly, 'the only write must be the guarded one').toContain('SET_THUMB_SQL');
  });

  it('scopes every write to one row AND one user', () => {
    expect(SET_THUMB_SQL).toMatch(/id = \$2/);
    expect(SET_THUMB_SQL).toMatch(/user_id = \$3/);
  });

  it('contains no destructive verb at all', () => {
    for (const verb of ['DELETE', 'DROP ', 'TRUNCATE', 'ALTER']) {
      expect(codeOnly.toUpperCase()).not.toContain(verb);
    }
  });
});

describe('PROMISE 3 — a customer history does not look modified', () => {
  it('never bumps updated_date', () => {
    // Bumping it would make every row look changed today and reorder things
    // that must not move. A backfill should be invisible.
    expect(SET_THUMB_SQL, 'the whole history would jump to the top').not.toMatch(/updated_date/);
  });
});

describe('PROMISE 1 — the original is never touched', () => {
  it('reads the source and uploads only the NEW thumbnail', async () => {
    const h = harness({ fetchImpl: server(await png(1600, 900)) });
    await backfillRows([row()], h.deps);
    expect(h.uploads).toHaveLength(1);
    expect(h.uploads[0].kind, 'it wrote into the originals space').toBe('thumb');
    expect(h.uploads[0].contentType).toBe('image/jpeg');
  });

  it('the thumbnail gets a fresh key, so it cannot overwrite anything', async () => {
    const h = harness({ fetchImpl: server(await png(1600, 900)) });
    await backfillRows([row({ result_url: 'https://s/original.png' })], h.deps);
    expect(h.writes[0].url).not.toContain('original');
  });
});

describe('PROMISE 4 — resumable and idempotent', () => {
  it('skips a row that already has a thumbnail', async () => {
    const h = harness({ fetchImpl: server(await png(800, 600)) });
    const r = await backfillRows([row({ thumb_url: 'https://cdn/t.jpg' })], h.deps);
    expect(r.attempted).toBe(0);
    expect(h.writes).toHaveLength(0);
  });

  it('a second run over the same rows does nothing', async () => {
    const buf = await png(1200, 800);
    const h = harness({ fetchImpl: server(buf) });
    const rows = [row()];
    await backfillRows(rows, h.deps);
    // Simulate the row now carrying what the first run wrote.
    rows[0].data.thumb_url = h.writes[0].url;
    const second = await backfillRows(rows, h.deps);
    expect(second.attempted).toBe(0);
  });

  it('respects a limit, so a first run can be small', async () => {
    const h = harness({ fetchImpl: server(await png(600, 400)) });
    const r = await backfillRows([row(), row(), row(), row()], { ...h.deps, limit: 2 });
    expect(r.attempted).toBe(2);
    expect(h.writes).toHaveLength(2);
  });
});

describe('a row that fails is counted, never written, never fatal', () => {
  it('survives a source that will not download', async () => {
    const h = harness({ fetchImpl: server(Buffer.alloc(0), false, 404) });
    const r = await backfillRows([row()], h.deps);
    expect(r.failed).toBe(1);
    expect(r.done).toBe(0);
    expect(h.writes, 'it recorded a thumbnail that does not exist').toHaveLength(0);
    expect(r.problems[0].why).toMatch(/404/);
  });

  it('survives a file that is not an image', async () => {
    const h = harness({ fetchImpl: server(Buffer.from('this is not a png')) });
    const r = await backfillRows([row()], h.deps);
    expect(r.failed).toBe(1);
    expect(h.writes).toHaveLength(0);
  });

  it('one bad row does not stop the good ones', async () => {
    const good = await png(1000, 700);
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      if (call === 2) return { ok: false, status: 500, arrayBuffer: async () => Buffer.alloc(0) };
      return { ok: true, status: 200, arrayBuffer: async () => good };
    });
    const h = harness({ fetchImpl });
    const r = await backfillRows([row(), row(), row()], h.deps);
    expect(r.done).toBe(2);
    expect(r.failed).toBe(1);
  });

  it('does not write when the UPLOAD fails', async () => {
    const h = harness({
      fetchImpl: server(await png(900, 600)),
      persistImpl: async () => { throw new Error('bucket refused'); },
    });
    const r = await backfillRows([row()], h.deps);
    expect(r.failed).toBe(1);
    expect(h.writes, 'the row points at an upload that never happened').toHaveLength(0);
  });
});

describe('the thumbnail itself', () => {
  it('is much smaller than a realistic original', async () => {
    const big = await noisyPng(1200, 800);          // ~MBs, like a real photo
    const small = await makeThumbnail(big);
    expect(big.length, 'the fixture is not realistic').toBeGreaterThan(500_000);
    expect(small.length).toBeLessThan(big.length / 10);
  });

  it('stays small no matter how large the source is', async () => {
    // The property that actually matters: a grid cell costs about the same
    // whether the original was 1 MB or 24 MB.
    const small = await makeThumbnail(await noisyPng(2400, 1600));
    expect(small.length).toBeLessThan(120 * 1024);
  });

  it('is 320px wide, for a 160px grid cell on a retina screen', async () => {
    const out = await makeThumbnail(await png(1600, 900));
    const back = await Jimp.read(out);
    expect(back.bitmap.width).toBe(THUMB_WIDTH);
  });

  it('keeps the shape of the original', async () => {
    const back = await Jimp.read(await makeThumbnail(await png(1600, 800)));
    expect(back.bitmap.width / back.bitmap.height).toBeCloseTo(2, 1);
  });

  it('never ENLARGES a source that is already small', async () => {
    // Upscaling would spend bytes to make it blurrier.
    const back = await Jimp.read(await makeThumbnail(await png(120, 90)));
    expect(back.bitmap.width).toBe(120);
  });

  it('refuses something absurd before decoding it', async () => {
    await expect(makeThumbnail(Buffer.alloc(MAX_SOURCE_BYTES + 1))).rejects.toThrow(/too large/);
  });

  it('refuses an empty buffer', async () => {
    await expect(makeThumbnail(Buffer.alloc(0))).rejects.toThrow(/empty/);
  });
});

describe('the report', () => {
  it('says what was done and what it saved', async () => {
    const h = harness({ fetchImpl: server(await noisyPng(1200, 800)) });
    const r = await backfillRows([row(), row()], h.deps);
    expect(r.done).toBe(2);
    expect(r.failed).toBe(0);
    expect(r.originalsMB).toBeGreaterThan(r.thumbnailsMB);
    expect(r.savedMB).toBeGreaterThan(0);
  });

  it('names the problems rather than only counting them', async () => {
    const h = harness({ fetchImpl: server(Buffer.alloc(0), false, 403) });
    const r = await backfillRows([row()], h.deps);
    expect(r.problems[0]).toHaveProperty('id');
    expect(r.problems[0]).toHaveProperty('why');
  });

  it('handles an account with nothing eligible', async () => {
    const h = harness({ fetchImpl: server(Buffer.alloc(0)) });
    const r = await backfillRows([], h.deps);
    expect(r).toMatchObject({ attempted: 0, done: 0, failed: 0 });
  });
});
