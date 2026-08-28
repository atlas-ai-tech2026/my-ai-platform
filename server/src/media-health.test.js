// ─── media-health.test.js ────────────────────────────────────────────────────
// Counting records whose file is gone.
//
// The dangerous failure of a health check is not missing a problem — it is
// REPORTING ZERO when it could not look. "0 lost" and "I could not tell" look
// identical on a dashboard and mean opposite things, and the reassuring one
// gets believed. Several tests below exist only to keep those apart.

import { describe, it, expect, vi } from 'vitest';
import {
  classifyUrl, ourMediaHosts, stillThere, checkSample, summarise,
  HOST_BREAKDOWN_SQL, AT_RISK_SAMPLE_SQL,
} from './media-health.js';

const OURS = ['voxel-ai-store.nyc3.digitaloceanspaces.com', 'voxel-ai-store.nyc3.cdn.digitaloceanspaces.com'];
const opts = { ourHosts: OURS };

describe('where a record points', () => {
  it('recognises our own bucket', () => {
    expect(classifyUrl('https://voxel-ai-store.nyc3.digitaloceanspaces.com/generations/image/a.png', opts)).toBe('ours');
  });

  it('recognises our CDN edge as ours too', () => {
    expect(classifyUrl('https://voxel-ai-store.nyc3.cdn.digitaloceanspaces.com/generations/image/a.png', opts)).toBe('ours');
  });

  it('flags a provider host as at risk — those links expire', () => {
    expect(classifyUrl('https://v3.fal.media/files/penguin/abc.png', opts)).toBe('provider');
    expect(classifyUrl('https://tempfile.aiquickdraw.com/s/xyz.mp4', opts)).toBe('provider');
  });

  it('is not fooled by a host that merely CONTAINS our bucket name', () => {
    // voxel-ai-store.evil.com contains our bucket name. Substring matching
    // would call somebody else's server durable.
    expect(classifyUrl('https://voxel-ai-store.evil.com/a.png', opts)).toBe('provider');
  });

  it('is not fooled by our name appearing in the PATH', () => {
    expect(classifyUrl('https://elsewhere.com/voxel-ai-store.nyc3.digitaloceanspaces.com/a.png', opts)).toBe('provider');
  });

  it('calls an empty or absent url missing, not ours', () => {
    for (const v of ['', null, undefined, '   ']) expect(classifyUrl(v, opts)).toBe('missing');
  });

  it('calls a data: URI or a relative path "other", not a broken file', () => {
    expect(classifyUrl('data:image/png;base64,iVBOR', opts)).toBe('other');
    expect(classifyUrl('/media/hero.mp4', opts)).toBe('other');
  });
});

describe('working out which hosts are ours', () => {
  it('derives the bucket origin from the endpoint', () => {
    expect(ourMediaHosts({
      endpoint: 'https://nyc3.digitaloceanspaces.com', bucket: 'voxel-ai-store',
    })).toContain('voxel-ai-store.nyc3.digitaloceanspaces.com');
  });

  it('includes the CDN when one is configured', () => {
    const h = ourMediaHosts({
      endpoint: 'https://nyc3.digitaloceanspaces.com',
      bucket: 'voxel-ai-store',
      cdnBase: 'https://voxel-ai-store.nyc3.cdn.digitaloceanspaces.com',
    });
    expect(h).toHaveLength(2);
  });

  it('does not throw when nothing is configured', () => {
    expect(() => ourMediaHosts({})).not.toThrow();
    expect(ourMediaHosts({})).toEqual([]);
  });
});

describe('is the file still there', () => {
  const respond = (status, ok = status < 400) => vi.fn(async () => ({ status, ok }));

  it('404 means gone', async () => {
    expect(await stillThere('https://x/a.png', { fetchImpl: respond(404) })).toBe(false);
  });

  it('403 and 410 also mean gone — an expired provider link often 403s', async () => {
    expect(await stillThere('https://x/a.png', { fetchImpl: respond(403) })).toBe(false);
    expect(await stillThere('https://x/a.png', { fetchImpl: respond(410) })).toBe(false);
  });

  it('200 means there', async () => {
    expect(await stillThere('https://x/a.png', { fetchImpl: respond(200) })).toBe(true);
  });

  it('a network failure is UNKNOWN, never "gone"', async () => {
    // A hiccup is not a lost file. Counting it as one would cry wolf and get
    // the whole check ignored.
    const boom = vi.fn(async () => { throw new Error('ECONNRESET'); });
    expect(await stillThere('https://x/a.png', { fetchImpl: boom })).toBe(null);
  });

  it('a 500 from the host is unknown, not gone', async () => {
    expect(await stillThere('https://x/a.png', { fetchImpl: respond(500) })).toBe(null);
  });

  it('asks with HEAD, never downloading the file', async () => {
    const f = respond(200);
    await stillThere('https://x/a.png', { fetchImpl: f });
    expect(f.mock.calls[0][1].method).toBe('HEAD');
  });
});

describe('the sample', () => {
  const mixed = vi.fn(async (url) => {
    if (url.includes('gone')) return { status: 404, ok: false };
    if (url.includes('boom')) throw new Error('network');
    return { status: 200, ok: true };
  });

  it('separates gone, alive and could-not-tell', async () => {
    const rows = [
      { id: '1', url: 'https://x/gone1.png' },
      { id: '2', url: 'https://x/ok.png' },
      { id: '3', url: 'https://x/boom.png' },
      { id: '4', url: 'https://x/gone2.png' },
    ];
    const r = await checkSample(rows, { fetchImpl: mixed });
    expect(r).toMatchObject({ sampled: 4, gone: 2, alive: 1, unknown: 1 });
  });

  it('names examples, so the finding can be checked by hand', async () => {
    const r = await checkSample([{ id: 'e1', url: 'https://x/gone.png' }], { fetchImpl: mixed });
    expect(r.examples[0]).toMatchObject({ id: 'e1' });
  });
});

describe('the summary — and the answer it must NEVER give', () => {
  const breakdown = [
    { bucket_class: 'ours', rows: 18000, accounts: 540 },
    { bucket_class: 'provider', rows: 2000, accounts: 210 },
    { bucket_class: 'missing', rows: 40, accounts: 12 },
  ];

  it('extrapolates from the measured failure rate', () => {
    const s = summarise(breakdown, { gone: 30, alive: 70, unknown: 0, sampled: 100, examples: [] });
    expect(s.atRiskOnProviderHost).toBe(2000);
    expect(s.estimatedLost).toBe(600);          // 30% of 2000
    expect(s.note).toMatch(/30\.0%/);
  });

  it('reports NO estimate — not zero — when nothing could be tested', () => {
    // This is the whole point. A zero here reads as "all healthy", which is
    // the most dangerous wrong answer this check could give.
    const s = summarise(breakdown, { gone: 0, alive: 0, unknown: 25, sampled: 25, examples: [] });
    expect(s.estimatedLost).toBe(null);
    expect(s.note).toMatch(/NOT a clean bill of health/i);
  });

  it('counts rows with no url at all separately from lost ones', () => {
    // Already broken, and for a different reason — never conflate them.
    expect(summarise(breakdown, null).noUrlAtAll).toBe(40);
  });

  it('says how many ACCOUNTS are affected, not only how many rows', () => {
    // 2000 rows across 1 customer and across 210 is the same number and a
    // completely different problem.
    expect(summarise(breakdown, null).accountsAffected).toBe(210);
  });

  it('totals everything it saw', () => {
    expect(summarise(breakdown, null).totalGenerations).toBe(20040);
  });

  it('survives an empty database without pretending it is healthy', () => {
    const s = summarise([], null);
    expect(s.totalGenerations).toBe(0);
    expect(s.estimatedLost).toBe(null);
  });
});

describe('the queries', () => {
  it('the breakdown counts in the DATABASE, not by pulling every row back', () => {
    expect(HOST_BREAKDOWN_SQL).toMatch(/count\(\*\)/i);
    expect(HOST_BREAKDOWN_SQL).toMatch(/GROUP BY/i);
  });

  it('both queries only ever read', () => {
    for (const sql of [HOST_BREAKDOWN_SQL, AT_RISK_SAMPLE_SQL]) {
      for (const verb of ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER']) {
        expect(sql.toUpperCase()).not.toContain(verb);
      }
    }
  });

  it('the sample is drawn from the whole history, not just the oldest', () => {
    // Ordering by date would sample only the oldest corner, where everything
    // is expired, and report a failure rate far worse than the truth.
    expect(AT_RISK_SAMPLE_SQL).toMatch(/random\(\)/i);
  });
});
