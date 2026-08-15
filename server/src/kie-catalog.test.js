// ─── kie-catalog.test.js ─────────────────────────────────────────────────────
// Reading kie.ai's catalogue. Written against the REAL response shape captured
// from api.kie.ai on 2026-08-16, not an invented one — the whole reason this
// module exists is that a remembered assumption about kie turned out to be
// wrong twice.
//
// The traps this file is aimed at:
//
//   · `marketPrice` is NOT a price. It holds the UNIT ("image", "5s"). Reading
//     it as money is the same class of error that left our fal costs 16% high.
//   · `priceInfoJson` is a JSON string INSIDE the JSON, and is empty for 89 of
//     98 groups. Empty must mean "kie does not publish it", never "free".
//   · pageSize over 100 is a hard 422, not a hint.

import { describe, it, expect, vi } from 'vitest';
import {
  parseKiePrice, toIsoDate, normaliseKieGroups, fetchKieCatalog, KIE_MAX_PAGE,
} from './kie-catalog.js';

// Verbatim from the live API.
const REAL_PRICED = {
  id: 132, groupName: 'Seedream 4.5', count: 3, path: 'seedream-4-5',
  tagline: 'Seedream 4.5 …', taskType: ['Text to Image', 'Image to Image'],
  provider: 'ByteDance', createTime: 1782000000000,
  priceInfoJson: '{"price":"0.032","discount":"19%","credits":"6.5","marketPrice":"image"}',
};
const REAL_UNPRICED = {
  id: 141, groupName: 'Kling O3', count: 4, path: 'kling-o3',
  tagline: 'Kling O3 …', taskType: ['Text to Video', 'Image to Video'],
  provider: 'Kling', createTime: 1786690260000,
  priceInfoJson: '{"price":"","discount":"","credits":"","marketPrice":""}',
};

describe('reading a kie price', () => {
  it('pulls the USD price, unit and credits out of the nested JSON string', () => {
    const p = parseKiePrice(REAL_PRICED.priceInfoJson);
    expect(p).toEqual({ usd: 0.032, unit: 'image', credits: 6.5, discount: '19%' });
  });

  // The one that would silently corrupt every kie cost.
  it('never mistakes marketPrice (a unit) for a price', () => {
    const p = parseKiePrice('{"price":"0.28","discount":"20%","credits":"55","marketPrice":"5s"}');
    expect(p.usd).toBe(0.28);
    expect(p.unit).toBe('5s');
    expect(p.usd).not.toBe(5);
  });

  // 89 of 98 groups look like this. Free is a price; unknown is not.
  it('returns null for an unpriced model rather than zero', () => {
    expect(parseKiePrice(REAL_UNPRICED.priceInfoJson)).toBeNull();
    expect(parseKiePrice('{"price":"0"}')).toBeNull();
    expect(parseKiePrice('')).toBeNull();
    expect(parseKiePrice(null)).toBeNull();
    expect(parseKiePrice('not json')).toBeNull();
  });
});

describe('the added date', () => {
  it('converts kie millisecond epochs to ISO dates', () => {
    expect(toIsoDate(1786690260000)).toBe('2026-08-14');
  });

  it('refuses junk instead of inventing 1970', () => {
    for (const bad of [0, -1, null, undefined, 'x', NaN]) expect(toIsoDate(bad)).toBeNull();
  });
});

describe('normalising into the shape the sweep already speaks', () => {
  it('matches fal-catalog: family, lab, category, first_seen, endpoints, price', () => {
    const [g] = normaliseKieGroups([REAL_PRICED]);
    expect(g.family).toBe('Seedream 4.5');
    expect(g.lab).toBe('ByteDance');
    expect(g.first_seen).toBe('2026-06-21');
    expect(g.price).toEqual({ usd: 0.032, unit: 'image' });
    expect(g.endpoints).toHaveLength(3);          // `count` from the API
    expect(g.path).toBe('seedream-4-5');
  });

  // kie's "provider" is the LAB. Calling it provider here would collide with
  // provider meaning kie-vs-fal everywhere else in the costing code.
  it("maps kie's provider field to lab, not provider", () => {
    const [g] = normaliseKieGroups([REAL_PRICED]);
    expect(g.lab).toBe('ByteDance');
    expect(g.provider).toBeUndefined();
  });

  it('keeps an unpriced model with a null price', () => {
    const [g] = normaliseKieGroups([REAL_UNPRICED]);
    expect(g.family).toBe('Kling O3');
    expect(g.price).toBeNull();
  });

  it('drops nameless rows rather than creating blank entries', () => {
    expect(normaliseKieGroups([{}, null, { groupName: '' }])).toHaveLength(0);
  });
});

describe('fetching the catalogue', () => {
  const page = (records, total) => ({
    ok: true, json: async () => ({ code: 200, msg: 'success', data: { records, total } }),
  });

  it('pages until it has them all', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(page([REAL_PRICED], 2))
      .mockResolvedValueOnce(page([REAL_UNPRICED], 2));
    const out = await fetchKieCatalog({ fetchImpl, pageSize: 1 });
    expect(out).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  // Over 100 is a 422 from kie, so the cap has to be enforced our side.
  it('never asks for more than kie allows', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(page([REAL_PRICED], 1));
    await fetchKieCatalog({ fetchImpl, pageSize: 500 });
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.pageSize).toBe(KIE_MAX_PAGE);
    expect(KIE_MAX_PAGE).toBe(100);
  });

  it('stops on an empty page instead of looping to the cap', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(page([], 999));
    await fetchKieCatalog({ fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('throws a readable error rather than returning half a catalogue silently', async () => {
    await expect(fetchKieCatalog({
      fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }),
    })).rejects.toThrow(/503/);

    await expect(fetchKieCatalog({
      fetchImpl: async () => ({ ok: true, json: async () => ({ code: 422, msg: '分页参数不能超过100' }) }),
    })).rejects.toThrow(/分页参数/);
  });
});
