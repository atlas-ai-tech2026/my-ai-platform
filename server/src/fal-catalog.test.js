// ─── fal-catalog.test.js ─────────────────────────────────────────────────────
// The strings below are VERBATIM from https://fal.ai/api/models (read
// 2026-08-06), not invented. A parser tested only against strings written by
// the same person who wrote the parser proves nothing.
//
// The most important tests here are the ones asserting null. A wrong cost is
// far worse than a missing one: it renders as a confident margin the owner
// would price against.

import { describe, it, expect } from 'vitest';
import {
  parseFalPrice, sellableModels, groupByFamily, newModelFamilies,
  fetchFalCatalog, SELLABLE_CATEGORIES,
} from './fal-catalog.js';

describe('parseFalPrice — shapes it must get right', () => {
  it('per-image', () => {
    expect(parseFalPrice(
      'Your request will cost **$0.08** per image. For **$1.00**, you can run this model **12** times.',
      'text-to-image',
    )).toEqual({ unit: 'image', usd: 0.08 });
  });

  it('per-image with a sub-cent price', () => {
    expect(parseFalPrice(
      'Your request will cost **$0.039** per image. For **$1.00**, you can run this model **25 times.**',
      'image-to-image',
    )).toEqual({ unit: 'image', usd: 0.039 });
  });

  it('per-second video with audio tiers takes the lower (audio off) rate', () => {
    expect(parseFalPrice(
      'For every second of video you generated, you will be charged **$0.112** (audio off) or **$0.168** (audio on)',
      'image-to-video',
    )).toEqual({ unit: 'second', usd: 0.112 });
  });

  it('per-second video with resolution tiers takes the lower (720p) rate', () => {
    expect(parseFalPrice(
      'For every second of 720p video you generated, you will be charged **$0.3034/second** and for 1080p you will be charged **$0.682/second**.',
      'image-to-video',
    )).toEqual({ unit: 'second', usd: 0.3034 });
  });
});

describe('parseFalPrice — surcharges must never be read as the base rate', () => {
  // Regression. Both strings are verbatim from the live catalogue, and both
  // broke the first version of this parser, which scanned the whole blurb and
  // took the smallest figure. Caught by cross-checking against fal-pricing.js,
  // whose $0.15 for Nano Banana Pro is confirmed from the workbook — the unit
  // tests alone were happy with the wrong answer.
  it('reads Nano Banana Pro as $0.15, NOT the $0.015 web-search surcharge', () => {
    const real = 'Your request will cost **$0.15** per image. For **$1.00**, you can run this model **7** times. 4K outputs will be charged at double the standard rate. If web search is used, an additional $0.015 will be charged. Note: Pricing may change in the future.';
    expect(parseFalPrice(real, 'text-to-image')).toEqual({ unit: 'image', usd: 0.15 });
  });

  it('reads Nano Banana 2 as $0.08, NOT a lower resolution-tier figure', () => {
    const real = 'Your request will cost **$0.08** per image. For **$1.00**, you can run this model **12** times. 2K and 4K outputs will be charged at **1.5** times and **2** times the standard rate, respectively. 0.5K (512px) resolution outputs will be charged **$0.002** per image.';
    expect(parseFalPrice(real, 'text-to-image')).toEqual({ unit: 'image', usd: 0.08 });
  });

  it('ignores the "for $1.00 you can run this N times" restatement', () => {
    expect(parseFalPrice(
      'Your request will cost **$0.50** per image. For **$1.00**, you can run this model **2** times.',
      'text-to-image',
    )).toEqual({ unit: 'image', usd: 0.50 });
  });
});

describe('parseFalPrice — "per generation" takes its unit from the category', () => {
  // Ideogram's object-removal model is image-to-image but prices "per
  // generation". Hard-coding that phrase to 'video' labelled an image model
  // as per-clip, which would carry the wrong unit into the costing row.
  it('image model → per image', () => {
    expect(parseFalPrice('Your request will cost **$0.03** per generation.', 'image-to-image'))
      .toEqual({ unit: 'image', usd: 0.03 });
  });
  it('video model → per video', () => {
    expect(parseFalPrice('Your request will cost **$0.40** per generation.', 'text-to-video'))
      .toEqual({ unit: 'video', usd: 0.40 });
  });
});

describe('parseFalPrice — shapes it must REFUSE', () => {
  // This is the test that matters most. "Text tokens (per 1M): $5.00 input"
  // parsed naively as a per-image cost reads as $5.00/image against a real
  // cost near $0.08 — a ~60x error, and it would surface as a confident margin.
  it('refuses token pricing rather than reading $5.00 as a per-image cost', () => {
    const real = 'Text tokens (per 1M): **$5.00** input, **$1.25** cached, **$10.00** output. Image tokens (per 1M): **$8.00** input, **$2.00** cached, **$30.00** output.';
    expect(parseFalPrice(real, 'text-to-image')).toBeNull();
  });

  it('refuses megapixel pricing, which depends on request shape', () => {
    expect(parseFalPrice(
      'Your request will cost **$0.03** for the first megapixel of output, plus **$0.015** per extra megapixel of input and output, rounded up to the nearest megapixel.',
      'text-to-image',
    )).toBeNull();
  });

  it('refuses per-additional-input-image pricing', () => {
    expect(parseFalPrice(
      'You will be charged for both input and output images. The first input image is not charged, and every additional input image will cost **$0.0045**.',
      'image-to-image',
    )).toBeNull();
  });

  it('refuses empty, missing and price-free text', () => {
    for (const v of [null, undefined, '', 'Contact us for pricing.', 'Free during preview.']) {
      expect(parseFalPrice(v, 'text-to-image')).toBeNull();
    }
  });
});

describe('sellableModels', () => {
  const items = [
    { id: 'a', category: 'text-to-image',  status: 'public' },
    { id: 'b', category: 'training',       status: 'public' },      // not sold
    { id: 'c', category: 'text-to-image',  status: 'private' },     // not public
    { id: 'd', category: 'image-to-video', status: 'public', deprecated: true },
    { id: 'e', category: 'image-to-video', status: 'public', removed: true },
    { id: 'f', category: 'text-to-speech', status: 'public' },
  ];
  it('keeps only public, current models in categories we sell', () => {
    expect(sellableModels(items).map((m) => m.id)).toEqual(['a', 'f']);
  });
  it('every sellable category is one the platform actually offers', () => {
    expect(SELLABLE_CATEGORIES).toContain('text-to-image');
    expect(SELLABLE_CATEGORIES).toContain('image-to-video');
    expect(SELLABLE_CATEGORIES).not.toContain('training');
    expect(SELLABLE_CATEGORIES).not.toContain('llm');
  });
});

describe('groupByFamily', () => {
  // Flux 3 really does ship as 8 endpoints. The owner decides about ONE product.
  const flux3 = [
    { id: 'blackforestlabs/flux-3/text-to-video/draft',  title: 'Flux 3 Text To Video Draft',  category: 'text-to-video',  modelFamily: 'Flux 3', modelLab: 'Black Forest Labs', date: '2026-08-04', pricingInfoOverride: 'For every second of video you generated, you will be charged **$0.20**' },
    { id: 'blackforestlabs/flux-3/image-to-video/draft', title: 'Flux 3 Image To Video Draft', category: 'image-to-video', modelFamily: 'Flux 3', modelLab: 'Black Forest Labs', date: '2026-07-17' },
  ];

  it('collapses endpoints into one product row', () => {
    const g = groupByFamily(flux3);
    expect(g).toHaveLength(1);
    expect(g[0].family).toBe('Flux 3');
    expect(g[0].endpoints).toHaveLength(2);
    expect(g[0].lab).toBe('Black Forest Labs');
  });

  it('reports the NEWEST endpoint date for the family', () => {
    expect(groupByFamily(flux3)[0].first_seen).toBe('2026-08-04');
  });

  it('carries a parsed price when any endpoint states one', () => {
    expect(groupByFamily(flux3)[0].price).toEqual({ unit: 'second', usd: 0.20 });
  });

  it('leaves price null when no endpoint states a parseable one', () => {
    expect(groupByFamily([{ id: 'x', title: 'Mystery', category: 'text-to-image', date: '2026-01-01' }])[0].price).toBeNull();
  });

  it('falls back to the title when fal set no family', () => {
    expect(groupByFamily([{ id: 'x', title: 'Lone Model', category: 'text-to-image', date: '2026-01-01' }])[0].family)
      .toBe('Lone Model');
  });
});

describe('newModelFamilies', () => {
  const items = [
    { id: 'fal-ai/known',  title: 'Known',  category: 'text-to-image', modelFamily: 'Known',  status: 'public', date: '2026-07-01' },
    { id: 'fal-ai/fresh',  title: 'Fresh',  category: 'text-to-image', modelFamily: 'Fresh',  status: 'public', date: '2026-07-02' },
    { id: 'fal-ai/stale',  title: 'Stale',  category: 'text-to-image', modelFamily: 'Stale',  status: 'public', date: '2024-01-01' },
  ];

  it('excludes models the server already dispatches to', () => {
    const fams = newModelFamilies(items, new Set(['fal-ai/known']));
    expect(fams.map((f) => f.family)).not.toContain('Known');
  });

  it('excludes families older than the cutoff', () => {
    const fams = newModelFamilies(items, new Set(), { since: '2026-01-01' }).map((f) => f.family);
    expect(fams).not.toContain('Stale');   // dated 2024 — old news, not "new"
    expect(fams).toEqual(['Fresh', 'Known']);
  });

  it('sorts newest first', () => {
    const fams = newModelFamilies(items, new Set());
    expect(fams[0].family).toBe('Fresh');
  });

  it('an empty catalogue yields an empty list, not a crash', () => {
    expect(newModelFamilies([], new Set())).toEqual([]);
  });
});

describe('fetchFalCatalog', () => {
  const page = (items, pages) => ({
    ok: true, status: 200, json: async () => ({ items, page: 1, pages, size: 40, total: items.length }),
  });

  it('follows pagination and concatenates every page', async () => {
    let seen = [];
    const fetchImpl = async (url) => {
      seen.push(url);
      const n = Number(new URL(url).searchParams.get('page'));
      return page([{ id: `m${n}` }], 3);
    };
    const items = await fetchFalCatalog({ fetchImpl });
    expect(items.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
    expect(seen).toHaveLength(3);
  });

  it('stops at maxPages so a bad `pages` value cannot loop forever', async () => {
    const fetchImpl = async () => page([{ id: 'x' }], 99999);
    const items = await fetchFalCatalog({ fetchImpl, maxPages: 4 });
    expect(items).toHaveLength(4);
  });

  it('throws rather than silently returning a partial catalogue', async () => {
    const fetchImpl = async () => ({ ok: false, status: 503, json: async () => ({}) });
    await expect(fetchFalCatalog({ fetchImpl })).rejects.toThrow(/503/);
  });
});
