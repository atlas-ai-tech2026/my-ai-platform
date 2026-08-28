// ─── thumbnail-scale.test.js ─────────────────────────────────────────────────
// The count that has to exist BEFORE a job is switched on across 601
// customers' history.
//
// Amr asked "do you need to press it many times?" — his partner's account
// alone needs seven presses, so plainly a background job is right. But turning
// one on across everybody without knowing how many pictures and how much data
// is the habit this project keeps having to unlearn. Hence: count exactly,
// sample for size, and never let an estimate wear the clothes of a
// measurement.

import { describe, it, expect } from 'vitest';
import { summariseScale, SCALE_SQL, SAMPLE_SQL } from './thumbnail-scale.js';

const MB = 1048576;
const counts = { need: 12000, have: 3000, accounts_waiting: 480, accounts_total: 601 };
const sizes = Array.from({ length: 40 }, () => 7.6 * MB);

describe('the numbers that answer the actual question', () => {
  it('says how many presses a human would otherwise make', () => {
    // This is the number that made a background job obviously correct.
    const s = summariseScale(counts, sizes);
    expect(s.presses_by_hand).toBe(240);
  });

  it('and how long it would take at the pace measured on production', () => {
    // 20 pictures in 24 seconds, from the real run on aiworkshop965@gmail.com.
    const s = summariseScale(counts, sizes);
    expect(s.estimated_hours).toBe(4);
  });

  it('counts the data BOTH ways — downloaded once, re-uploaded once', () => {
    // Counting one direction would halve the bill in the report and not in
    // reality.
    const s = summariseScale({ need: 1000, have: 0 }, [10 * MB]);
    expect(s.estimated_gb_moved).toBeCloseTo(19.5, 1);
  });

  it('reports how far along it already is', () => {
    expect(summariseScale(counts, sizes).done_pct).toBe(20);
  });
});

describe('AN ESTIMATE NEVER WEARS THE CLOTHES OF A MEASUREMENT', () => {
  it('no sample → the data cost is NULL, never zero', () => {
    // Zero would read as "this costs nothing", which is the most expensive
    // possible wrong answer to give somebody deciding whether to run it.
    const s = summariseScale(counts, []);
    expect(s.estimated_gb_moved).toBeNull();
    expect(s.avg_mb).toBeNull();
  });

  it('and the verdict says so in words, not just in a null', () => {
    expect(summariseScale(counts, []).verdict).toMatch(/could not be measured/);
    expect(summariseScale(counts, []).verdict).toMatch(/not as zero/);
  });

  it('failed HEAD requests are discarded, not counted as zero-byte files', () => {
    // A null mixed into the average would drag the estimate down and make the
    // job look cheaper than it is.
    const s = summariseScale({ need: 100, have: 0 }, [null, 8 * MB, undefined, 0, 8 * MB]);
    expect(s.sampled).toBe(2);
    expect(s.avg_mb).toBe(8);
  });

  it('says how many files the estimate rests on', () => {
    expect(summariseScale(counts, sizes).sampled).toBe(40);
  });
});

describe('nothing to do is said plainly', () => {
  it('zero needed reads as finished, not as an error', () => {
    const s = summariseScale({ need: 0, have: 15000, accounts_waiting: 0, accounts_total: 601 }, []);
    expect(s.verdict).toMatch(/Every picture already has/);
    expect(s.presses_by_hand).toBe(0);
    expect(s.estimated_hours).toBe(0);
  });

  it('an empty database does not divide by zero', () => {
    const s = summariseScale({ need: 0, have: 0 }, []);
    expect(s.done_pct).toBeNull();
    expect(Number.isFinite(s.estimated_hours)).toBe(true);
  });

  it('junk counts degrade to zero rather than NaN', () => {
    const s = summariseScale({ need: 'x', have: null }, []);
    expect(s.need).toBe(0);
    expect(s.presses_by_hand).toBe(0);
  });
});

describe('THIS MODULE CANNOT WRITE', () => {
  it('neither query stores, updates or deletes', async () => {
    // The same property thumbnail-survey.js has, checked the same way: a
    // read-only tool proven read-only, not described as read-only.
    for (const sql of [SCALE_SQL, SAMPLE_SQL]) {
      expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/i);
      expect(sql).toMatch(/^\s*SELECT/i);
    }
  });

  it('and the file itself contains no write anywhere', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const src = fs.readFileSync(
      path.join(path.dirname(url.fileURLToPath(import.meta.url)), 'thumbnail-scale.js'), 'utf8')
      .split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
    expect(src).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
  });
});

describe('the queries themselves', () => {
  it('count only IMAGES with a real url — videos are a different problem', () => {
    expect(SCALE_SQL).toMatch(/data->>'type' = 'image'/);
    expect(SCALE_SQL).toMatch(/result_url/);
  });

  it('treat an EMPTY thumb_url as missing, not as done', () => {
    // `thumb_url: ''` would otherwise count as finished and leave the picture
    // slow forever — and make the grid render a broken image.
    expect(SCALE_SQL).toMatch(/COALESCE\(data->>'thumb_url',''\) = ''/);
  });

  it('sample RANDOMLY — the newest are not typical of eight months', () => {
    expect(SAMPLE_SQL).toMatch(/ORDER BY random\(\)/);
  });
});
