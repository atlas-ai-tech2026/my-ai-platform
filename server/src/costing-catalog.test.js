// ─── costing-catalog.test.js ─────────────────────────────────────────────────
// The provider-catalogue half of the daily sync: deciding which of fal's
// models are genuinely NEW to us, and recording them without ever clobbering
// the owner's dismissals.

import { describe, it, expect, vi } from 'vitest';
import {
  normaliseName, knownNameSet, alreadySold,
  syncProviderCatalog, defaultCatalogCutoff, runDailyModelSync,
} from './costing-sync.js';

describe('normaliseName — version formats must fold', () => {
  // Every pair below is the SAME product named differently by fal and by us.
  // These were found by running the matcher over the live catalogue against
  // our real 82 model names; each one was a false "new model" before the fold.
  it.each([
    ['Seedream 5.0 Pro',  'Seedream 5 Pro'],
    ['Kling v3 Turbo',    'Kling 3.0 Turbo'],
    ['Seedance 2.0',      'Seedance 2'],
    ['NANO BANANA PRO',   'Nano Banana Pro'],
    ['Flux-Kontext',      'Flux Kontext'],
  ])('%s === %s', (a, b) => {
    expect(normaliseName(a)).toBe(normaliseName(b));
  });

  it('does NOT fold genuinely different products together', () => {
    expect(normaliseName('Seedream 5 Pro')).not.toBe(normaliseName('Seedream 5 Lite'));
    expect(normaliseName('Kling 3.0')).not.toBe(normaliseName('Kling 2.6'));
    // 2.5 must not collapse to 2 — only a trailing ".0" is noise.
    expect(normaliseName('Kling 2.5')).not.toBe(normaliseName('Kling 2'));
  });
});

describe('alreadySold', () => {
  const known = knownNameSet(['Seedream 5 Pro', 'kling-3-turbo', 'Nano Banana Pro']);

  it('recognises a model we sell under a different version format', () => {
    expect(alreadySold('Seedream 5.0 Pro', known)).toBe(true);
  });

  it('lets a genuinely new product through', () => {
    expect(alreadySold('Flux 3', known)).toBe(false);
    expect(alreadySold('MiniMax H3', known)).toBe(false);
  });

  it('treats an unnameable family as known rather than surfacing junk', () => {
    expect(alreadySold('', known)).toBe(true);
    expect(alreadySold(null, known)).toBe(true);
  });

  it('does not match on a short fragment', () => {
    // A 5-char known name must not swallow every family containing it.
    expect(alreadySold('Reve 2.1', knownNameSet(['Reve']))).toBe(false);
  });
});

describe('syncProviderCatalog', () => {
  const catalogue = [
    { id: 'x/flux-3/t2v', title: 'Flux 3 T2V', modelFamily: 'Flux 3', modelLab: 'BFL',
      category: 'text-to-video', status: 'public', date: '2026-07-17',
      pricingInfoOverride: 'For every second of video you will be charged **$0.20**' },
    { id: 'x/seedream/pro', title: 'Seedream 5.0 Pro', modelFamily: 'Seedream 5.0 Pro',
      category: 'text-to-image', status: 'public', date: '2026-07-01' },
  ];

  function fakePool(existingNames = ['Seedream 5 Pro'], inserted = []) {
    return {
      inserted,
      query: vi.fn(async (sql, params) => {
        if (/SELECT model_name FROM pricing_models/.test(sql)) {
          return { rows: existingNames.map((n) => ({ model_name: n })) };
        }
        if (/INSERT INTO pricing_catalog_models/.test(sql)) {
          inserted.push(params);
          return { rowCount: 1, rows: [{ id: inserted.length }] };
        }
        return { rows: [], rowCount: 0 };
      }),
    };
  }

  it('records a new family and skips one we already sell', async () => {
    const inserted = [];
    const pool = fakePool(['Seedream 5 Pro'], inserted);
    const r = await syncProviderCatalog(pool, { fetchCatalog: async () => catalogue });
    expect(r.found).toBe(1);
    expect(r.added).toBe(1);
    expect(inserted).toHaveLength(1);
    expect(inserted[0][1]).toBe('Flux 3');       // family
    expect(inserted[0][0]).toBe('fal');          // provider
  });

  it('stores the parsed price and unit', async () => {
    const inserted = [];
    await syncProviderCatalog(fakePool(['Seedream 5 Pro'], inserted), { fetchCatalog: async () => catalogue });
    expect(inserted[0][5]).toBe(0.20);   // price_usd
    expect(inserted[0][6]).toBe('second'); // price_unit
  });

  it('stores NULL price rather than 0 when the provider price is unparseable', async () => {
    const inserted = [];
    await syncProviderCatalog(fakePool([], inserted), {
      fetchCatalog: async () => [{ id: 'a/b', title: 'Mystery', modelFamily: 'Mystery',
        category: 'text-to-image', status: 'public', date: '2026-07-01' }],
    });
    // A 0 here would render as a 100% margin — the same trap as pricing_models.
    expect(inserted[0][5]).toBeNull();
    expect(inserted[0][5]).not.toBe(0);
  });

  it('uses ON CONFLICT DO NOTHING so a dismissal is never resurrected', async () => {
    const pool = fakePool([], []);
    await syncProviderCatalog(pool, { fetchCatalog: async () => catalogue });
    const insertSql = pool.query.mock.calls.map((c) => c[0]).find((s) => /INSERT INTO pricing_catalog_models/.test(s));
    expect(insertSql).toMatch(/ON CONFLICT \(provider, family\) DO NOTHING/);
    expect(insertSql).not.toMatch(/DO UPDATE/);
  });
});

describe('runDailyModelSync — a provider outage must not break the local check', () => {
  it('still reports local additions when the fal fetch throws', async () => {
    const pool = { query: vi.fn(async (sql) => {
      if (/SELECT model_name FROM pricing_models/.test(sql)) return { rows: [] };
      return { rows: [], rowCount: 0 };
    }) };
    const out = await runDailyModelSync(pool, () => true, {
      fetchCatalog: async () => { throw new Error('fal is down'); },
    });
    expect(out.catalogError).toMatch(/fal is down/);
    expect(Array.isArray(out.added)).toBe(true);   // local half still ran
  });

  it('does nothing at all when the database is not ready', async () => {
    const pool = { query: vi.fn() };
    await runDailyModelSync(pool, () => false);
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe('defaultCatalogCutoff', () => {
  it('is three months back, so the queue stays readable', () => {
    const cutoff = new Date(defaultCatalogCutoff(new Date('2026-08-06T00:00:00Z')));
    expect(cutoff.toISOString().slice(0, 7)).toBe('2026-05');
  });
});
