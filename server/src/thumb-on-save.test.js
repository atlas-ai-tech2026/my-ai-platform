// ─── thumb-on-save.test.js ───────────────────────────────────────────────────
// One contract, and almost every test here is it:
//
//   MAKING A THUMBNAIL CAN NEVER COST THE CUSTOMER THEIR PICTURE.
//
// This runs between the model finishing and the customer receiving the image
// they just paid for — the most expensive place in the whole app to throw. A
// missing thumbnail costs one slow grid cell. An exception costs the picture.
//
// So: every thumbnail failure returns null, and the original url comes back
// unchanged. There is no third state and nothing upstream to handle.

import { describe, it, expect, vi } from 'vitest';
import { saveWithThumbnail, shouldThumbnail, THUMB_BUDGET_MS } from './thumb-on-save.js';

const big = Buffer.alloc(8000, 1);
const small = Buffer.alloc(400, 2);

function harness(over = {}) {
  const stored = [];
  return {
    stored,
    deps: {
      download: vi.fn(async () => ({ buf: big, contentType: 'image/png' })),
      store: vi.fn(async (buf, ct, kind) => { stored.push({ kind, bytes: buf.length, ct }); return `https://spaces/${kind}.x`; }),
      thumbnail: vi.fn(async () => small),
      onNote: vi.fn(),
      ...over,
    },
  };
}

describe('THE CONTRACT — the picture always survives', () => {
  const breakages = [
    ['the resizer throws', { thumbnail: vi.fn(async () => { throw new Error('cannot decode'); }) }],
    ['the resizer hangs', { thumbnail: () => new Promise(() => {}), budgetMs: 20 }],
    ['the resizer returns nothing', { thumbnail: vi.fn(async () => null) }],
    ['the resizer returns an empty buffer', { thumbnail: vi.fn(async () => Buffer.alloc(0)) }],
  ];

  it.each(breakages)('%s → the image url still comes back', async (_name, over) => {
    const h = harness(over);
    const out = await saveWithThumbnail('https://kie/a.png', 'output', h.deps);
    expect(out.url).toBe('https://spaces/output.x');
    expect(out.thumbUrl).toBeNull();
  });

  it.each(breakages)('%s → and nothing is thrown', async (_name, over) => {
    const h = harness(over);
    await expect(saveWithThumbnail('u', 'output', h.deps)).resolves.toBeTruthy();
  });

  it('the thumbnail UPLOAD failing also costs nothing', async () => {
    let n = 0;
    const h = harness({
      store: vi.fn(async (buf, ct, kind) => {
        n += 1;
        if (n === 2) throw new Error('bucket refused the thumbnail');
        return `https://spaces/${kind}.x`;
      }),
    });
    const out = await saveWithThumbnail('u', 'output', h.deps);
    expect(out.url).toBe('https://spaces/output.x');
    expect(out.thumbUrl).toBeNull();
  });

  it('every skip is NOTED, so a silently thumbnail-less platform is visible', async () => {
    const h = harness({ thumbnail: vi.fn(async () => { throw new Error('cannot decode'); }) });
    await saveWithThumbnail('u', 'output', h.deps);
    expect(h.deps.onNote).toHaveBeenCalledWith(expect.stringMatching(/cannot decode/));
  });
});

describe('but a REAL failure to store the picture must still propagate', () => {
  it('the original upload failing throws — the caller has a fallback for that', async () => {
    // Swallowing this would return a url that is not there, and the customer
    // would get a broken picture instead of the provider's own working one.
    const h = harness({ store: vi.fn(async () => { throw new Error('spaces down'); }) });
    await expect(saveWithThumbnail('u', 'output', h.deps)).rejects.toThrow(/spaces down/);
  });

  it('a failed download throws too', async () => {
    const h = harness({ download: vi.fn(async () => { throw new Error('404'); }) });
    await expect(saveWithThumbnail('u', 'output', h.deps)).rejects.toThrow(/404/);
  });
});

describe('the happy path', () => {
  it('stores the original and a smaller thumbnail', async () => {
    const h = harness();
    const out = await saveWithThumbnail('u', 'output', h.deps);
    expect(out).toEqual({ url: 'https://spaces/output.x', thumbUrl: 'https://spaces/thumb.x' });
    expect(h.stored).toEqual([
      { kind: 'output', bytes: 8000, ct: 'image/png' },
      { kind: 'thumb', bytes: 400, ct: 'image/jpeg' },
    ]);
  });

  it('downloads ONCE — the buffer is reused for both', async () => {
    // Two downloads of a 7.5 MB file would add the customer's wait right back.
    const h = harness();
    await saveWithThumbnail('u', 'output', h.deps);
    expect(h.deps.download).toHaveBeenCalledTimes(1);
  });

  it('the thumbnail goes under its own prefix, not with the originals', async () => {
    const h = harness();
    await saveWithThumbnail('u', 'output', h.deps);
    expect(h.stored[1].kind).toBe('thumb');
  });
});

describe('a "thumbnail" bigger than its source is not one', () => {
  it('is skipped rather than stored', async () => {
    // Flat images encode so well this genuinely happens — it is the bug that
    // made the backfill's first test fail against correct code.
    const h = harness({ thumbnail: vi.fn(async () => Buffer.alloc(9000, 3)) });
    const out = await saveWithThumbnail('u', 'output', h.deps);
    expect(out.thumbUrl).toBeNull();
    expect(h.stored).toHaveLength(1);
    expect(h.deps.onNote).toHaveBeenCalledWith(expect.stringMatching(/not smaller/));
  });
});

describe('what is worth thumbnailing at all', () => {
  it('pictures, yes', () => {
    for (const t of ['image/png', 'image/jpeg', 'image/webp', 'IMAGE/PNG']) {
      expect(shouldThumbnail(t, 'output')).toBe(true);
    }
  });

  it('video, NO — Jimp cannot read an mp4 and would burn the budget finding out', () => {
    expect(shouldThumbnail('video/mp4', 'output')).toBe(false);
  });

  it('gif and svg are skipped on purpose', () => {
    expect(shouldThumbnail('image/gif', 'output')).toBe(false);
    expect(shouldThumbnail('image/svg+xml', 'output')).toBe(false);
  });

  it('a missing or junk content-type is not assumed to be an image', () => {
    for (const t of [null, undefined, '', 'application/octet-stream']) {
      expect(shouldThumbnail(t, 'output')).toBe(false);
    }
  });

  it('reference uploads are left alone — only generated OUTPUT gets one', () => {
    expect(shouldThumbnail('image/png', 'reference')).toBe(false);
    expect(shouldThumbnail('image/png', 'thumb')).toBe(false);
  });

  it('never recurses — a thumbnail of a thumbnail is refused by kind', () => {
    expect(shouldThumbnail('image/jpeg', 'thumb')).toBe(false);
  });
});

describe('the budget', () => {
  it('is generous against a resize and small against a generation', () => {
    expect(THUMB_BUDGET_MS).toBeGreaterThan(1000);
    expect(THUMB_BUDGET_MS).toBeLessThan(15_000);
  });

  it('a hung resize gives up and hands over the picture', async () => {
    const h = harness({ thumbnail: () => new Promise(() => {}), budgetMs: 30 });
    const out = await saveWithThumbnail('u', 'output', h.deps);
    expect(out.url).toBeTruthy();
    expect(h.deps.onNote).toHaveBeenCalledWith(expect.stringMatching(/longer than 30ms/));
  });
});
