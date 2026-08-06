// ─── offers-segments.test.js ─────────────────────────────────────────────────
// Audience filters become SQL. Two properties matter more than any other:
//
//   1. No caller-supplied value is ever interpolated into the statement.
//   2. The preview and the real send use the SAME builder, so the count the
//      owner approves is the set that actually receives the offer.

import { describe, it, expect, vi } from 'vitest';
import {
  buildSegmentQuery, previewSegment, clientMatchesSegment,
  UnknownFilterError, SEGMENT_KEYS,
} from './offers-segments.js';

describe('buildSegmentQuery — parameterisation', () => {
  it('puts every value in params, never in the SQL text', () => {
    const { where, params } = buildSegmentQuery({
      plans: ['Basic'], months_min: 6, usage_min: 100, inactive_min: 30, remaining_lt: 20,
    });
    expect(params).toEqual([['Basic'], 6, 30, 20, 100]);
    for (const v of ['Basic', '6', '100', '30', '20']) {
      // The literal must not appear anywhere in the statement.
      expect(where).not.toContain(`'${v}'`);
    }
    expect(where).toMatch(/\$1/);
  });

  // The reason this module exists.
  it('cannot be injected through a plan name', () => {
    const evil = "Basic'; DROP TABLE users; --";
    const { where, params } = buildSegmentQuery({ plans: [evil] });
    expect(where).not.toContain('DROP TABLE');
    expect(where).not.toContain(evil);
    expect(params[0]).toEqual([evil]);   // travels as data, harmlessly
  });

  it('cannot be injected through a numeric field', () => {
    const { where, params } = buildSegmentQuery({ months_min: '6; DROP TABLE users' });
    // Unparseable as a number → the filter is dropped entirely, not passed on.
    expect(where).not.toContain('DROP');
    expect(params).not.toContain('6; DROP TABLE users');
  });

  // Silently ignoring an unknown key would show a preview for one audience and
  // send to another — the exact mismatch this feature must not have.
  it('rejects an unrecognised filter instead of ignoring it', () => {
    expect(() => buildSegmentQuery({ nonsense: 1 })).toThrow(UnknownFilterError);
    expect(() => buildSegmentQuery({ plans: ['Basic'], sneaky: 'x' })).toThrow(/Unknown segment filter/);
  });

  it('accepts every documented key', () => {
    expect(() => buildSegmentQuery(Object.fromEntries(SEGMENT_KEYS.map((k) => [k, null])))).not.toThrow();
  });
});

describe('buildSegmentQuery — audience correctness', () => {
  it('always excludes banned and expired accounts', () => {
    const { where } = buildSegmentQuery({});
    expect(where).toMatch(/u\.banned = FALSE/);
    expect(where).toMatch(/expires_at IS NULL OR u\.expires_at > NOW\(\)/);
  });

  // A never-logged-in user is the most dormant of all; excluding them would
  // silently drop the very people a win-back campaign targets.
  it('counts a user who has never logged in as inactive', () => {
    const { where } = buildSegmentQuery({ inactive_min: 30 });
    expect(where).toMatch(/last_login_at IS NULL OR/);
  });

  it('does not divide by a zero credit limit', () => {
    const { where } = buildSegmentQuery({ remaining_lt: 20 });
    expect(where).toMatch(/credit_limit > 0 AND/);
  });

  it('omits a filter that was left blank', () => {
    const { where, params } = buildSegmentQuery({ months_min: '', usage_min: null, plans: [] });
    expect(params).toEqual([]);
    expect(where).not.toMatch(/INTERVAL/);
  });

  it('measures spend, not grants, for credits-used', () => {
    const { where } = buildSegmentQuery({ usage_min: 50 });
    expect(where).toMatch(/ch\.action = 'spend'/);
    expect(where).toMatch(/ABS\(SUM\(ch\.amount\)\)/);   // spends are negative
  });
});

describe('previewSegment', () => {
  const pool = (count, sample = []) => ({
    query: vi.fn(async (sql) => (/COUNT/.test(sql) ? { rows: [{ n: count }] } : { rows: sample })),
  });

  it('returns a count and a bounded sample', async () => {
    const p = pool(412, [{ id: 1, email: 'a@b.c' }]);
    const r = await previewSegment(p, { plans: ['Basic'] });
    expect(r.count).toBe(412);
    expect(r.sample).toHaveLength(1);
  });

  it('caps the sample so a preview cannot pull the whole user table', async () => {
    const p = pool(0);
    await previewSegment(p, {}, { sample: 100000 });
    const sampleSql = p.query.mock.calls.map((c) => c[0]).find((s) => /LIMIT/.test(s));
    expect(sampleSql).toMatch(/LIMIT 50/);
  });

  it('uses identical WHERE text for the count and the sample', async () => {
    const p = pool(5);
    await previewSegment(p, { plans: ['Basic'], months_min: 6 });
    const [countSql, sampleSql] = p.query.mock.calls.map((c) => c[0]);
    const whereOf = (s) => s.slice(s.indexOf('WHERE'));
    expect(whereOf(countSql).replace(/\s+/g, ' ').split('ORDER')[0].trim())
      .toBe(whereOf(sampleSql).replace(/\s+/g, ' ').split('ORDER')[0].trim());
  });
});

describe('clientMatchesSegment — re-checked at redemption', () => {
  it('is true when the client still matches', async () => {
    const pool = { query: vi.fn(async () => ({ rows: [{ '?column?': 1 }] })) };
    await expect(clientMatchesSegment(pool, 7, { plans: ['Basic'] })).resolves.toBe(true);
  });

  it('is false once they no longer match', async () => {
    const pool = { query: vi.fn(async () => ({ rows: [] })) };
    await expect(clientMatchesSegment(pool, 7, { plans: ['Basic'] })).resolves.toBe(false);
  });

  it('passes the client id as the LAST parameter, after the filters', async () => {
    const pool = { query: vi.fn(async () => ({ rows: [] })) };
    await clientMatchesSegment(pool, 7, { plans: ['Basic'], months_min: 6 });
    const [, params] = pool.query.mock.calls[0];
    expect(params[params.length - 1]).toBe(7);
  });
});
