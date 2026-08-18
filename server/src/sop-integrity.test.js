// ─── sop-integrity.test.js ───────────────────────────────────────────────────
// Each check here is written against a fault that ACTUALLY shipped, so the
// tests are phrased as "would this have caught it". A check that only passes
// on healthy input tells you nothing about the day it matters.

import { describe, it, expect } from 'vitest';
import {
  canonical, deadPaths, uncalledRoutes, unreferencedTables, describeNullColumns,
  registeredRoutes, requestedPaths, EXPECTED_UNCALLED, extractApiStrings,
} from './sop-integrity.js';

describe('canonical — comparing paths that are written differently', () => {
  it('strips query strings and normalises parameters', () => {
    expect(canonical('/api/admin/users/${id}/history?limit=10000'))
      .toBe('/api/admin/users/:p/history');
    expect(canonical('/api/admin/users/:id/history')).toBe('/api/admin/users/:p/history');
  });

  it('makes the express form and the template form compare equal', () => {
    expect(canonical('/api/admin/customers/${user.id}/overview'))
      .toBe(canonical('/api/admin/customers/:id/overview'));
  });

  it('ignores a trailing slash', () => {
    expect(canonical('/api/waitlist/')).toBe('/api/waitlist');
  });
});

describe('dead paths — the /edit waitlist bug, as a check', () => {
  // The exact fault: a form posting to an endpoint that did not exist.
  it('catches an interface calling an endpoint nothing serves', () => {
    const found = deadPaths({
      requested: new Set(['/api/waitlist', '/api/health']),
      routes: new Set(['GET /api/health']),
    });
    expect(found).toEqual(['/api/waitlist']);
  });

  it('is quiet once the endpoint exists', () => {
    expect(deadPaths({
      requested: new Set(['/api/waitlist']),
      routes: new Set(['POST /api/waitlist']),
    })).toEqual([]);
  });

  it('matches a parameterised route against a template literal call', () => {
    expect(deadPaths({
      requested: new Set(['/api/admin/users/${id}/history']),
      routes: new Set(['GET /api/admin/users/:id/history']),
    })).toEqual([]);
  });

  // Method mismatch is deliberately NOT reported: a path served by any verb is
  // reachable, and flagging GET-vs-POST would be noise on a warning-level check.
  it('does not flag a path served under a different method', () => {
    expect(deadPaths({
      requested: new Set(['/api/waitlist']),
      routes: new Set(['POST /api/waitlist']),
    })).toEqual([]);
  });
});

describe('uncalled routes', () => {
  it('flags an endpoint no interface asks for', () => {
    expect(uncalledRoutes({
      requested: new Set(['/api/a']),
      routes: new Set(['GET /api/a', 'GET /api/orphan']),
      expected: [],
    })).toEqual(['GET /api/orphan']);
  });

  // Health checks and webhooks have no frontend caller by design. Without this
  // the check reports them forever and gets ignored.
  it('respects the expected list, so it does not cry wolf', () => {
    expect(uncalledRoutes({
      requested: new Set(),
      routes: new Set(['GET /api/health']),
    })).toEqual([]);
    expect(EXPECTED_UNCALLED).toContain('/api/health');
  });
});

describe('unreferenced tables', () => {
  it('flags a table no server file mentions', () => {
    const found = unreferencedTables({
      tables: ['users', 'forgotten_table'],
      serverFiles: [{ src: 'SELECT * FROM users WHERE id = $1' }],
      expected: [],
    });
    expect(found).toEqual(['forgotten_table']);
  });

  // `users` must not be considered "mentioned" by `failed_logins`.
  it('matches on word boundaries, not substrings', () => {
    const found = unreferencedTables({
      tables: ['logins'],
      serverFiles: [{ src: 'SELECT * FROM failed_logins' }],
      expected: [],
    });
    expect(found).toEqual(['logins']);
  });
});

describe('all-NULL columns — the model_label bug, as a check', () => {
  it('catches a column that is empty in every row', () => {
    const found = describeNullColumns([
      { table_name: 'pending_video_charges', column_name: 'model_label', total: 3046, non_null: 0 },
    ], {});
    expect(found).toEqual([{ column: 'pending_video_charges.model_label', rows: 3046, expected: null }]);
  });

  it('says nothing about an empty TABLE — there is no promise to break yet', () => {
    expect(describeNullColumns([
      { table_name: 'brand_new', column_name: 'x', total: 0, non_null: 0 },
    ], {})).toEqual([]);
  });

  it('is quiet once the column is being written', () => {
    expect(describeNullColumns([
      { table_name: 't', column_name: 'c', total: 100, non_null: 4 },
    ], {})).toEqual([]);
  });

  // Some columns are legitimately empty. Requiring a stated reason keeps the
  // exception list from becoming a place to hide findings.
  it('honours a documented exception', () => {
    expect(describeNullColumns(
      [{ table_name: 'users', column_name: 'last_login_ip', total: 595, non_null: 0 }],
      { 'users.last_login_ip': 'null until a first sign-in' },
    )).toEqual([]);
  });

  it('puts the biggest table first — that is where the broken promise costs most', () => {
    const found = describeNullColumns([
      { table_name: 'small', column_name: 'a', total: 5, non_null: 0 },
      { table_name: 'big', column_name: 'b', total: 5000, non_null: 0 },
    ], {});
    expect(found.map((f) => f.column)).toEqual(['big.b', 'small.a']);
  });
});

describe('the source scanners find real things', () => {
  it('extracts registered routes with their method', () => {
    const routes = registeredRoutes([{ src: `
      app.get('/api/health', h);
      app.post("/api/waitlist", limiter, h);
      app.delete(\`/api/admin/x/:id\`, gate, h);
    ` }]);
    expect(routes).toContain('GET /api/health');
    expect(routes).toContain('POST /api/waitlist');
    expect(routes).toContain('DELETE /api/admin/x/:id');
  });

  it('extracts the paths an interface asks for, including template literals', () => {
    const asked = requestedPaths([{ src: `
      fetch('/api/waitlist', { method: 'POST' });
      request('GET', \`/api/admin/users/\${id}/history?limit=10\`);
    ` }]);
    expect([...asked].map(canonical)).toEqual(
      expect.arrayContaining(['/api/waitlist', '/api/admin/users/:p/history']));
  });

  // If the scanner found nothing, a green result would mean "did not look".
  it('returns nothing on empty input rather than throwing', () => {
    expect(registeredRoutes([]).size).toBe(0);
    expect(requestedPaths([]).size).toBe(0);
  });
});

// The first scanner used a regex and manufactured three phantom paths from
// `/api/admin/live${q.toString() ? `?${q}` : ''}` — it stopped at the INNER
// backtick. Those phantoms then appeared in both the dead-path and the
// uncalled-route list, which is the signature of a broken scanner rather than
// a finding. A check that invents findings gets switched off.
describe('extractApiStrings survives real template literals', () => {
  it('reads a nested template as ONE path, not a truncated fragment', () => {
    const found = extractApiStrings("request('GET', `/api/admin/live${q.toString() ? `?${q}` : ''}`)");
    expect(found).toHaveLength(1);
    expect(canonical(found[0])).toBe('/api/admin/live');
  });

  it('handles a placeholder containing an object literal', () => {
    const found = extractApiStrings('fetch(`/api/x/${ {a:1}.a }/y`)');
    expect(canonical(found[0])).toBe('/api/x/:p/y');
  });

  it('reads ordinary quoted paths unchanged', () => {
    expect(extractApiStrings(`fetch('/api/waitlist')`)).toEqual(['/api/waitlist']);
    expect(extractApiStrings(`fetch("/api/health")`)).toEqual(['/api/health']);
  });

  it('ignores strings that are not api paths', () => {
    expect(extractApiStrings(`const s = 'hello'; const t = "/apixyz";`)).toEqual([]);
  });

  it('is not derailed by an escaped quote', () => {
    expect(extractApiStrings(`x('/api/a\\'b')`)[0]).toContain('/api/a');
  });

  // The exact regression: the phantom must not appear at all.
  it('no longer manufactures a path containing a placeholder fragment', () => {
    const found = extractApiStrings("request('GET', `/api/admin/logs${qs ? `?${qs}` : ''}`)");
    expect(found.some((p) => p.includes('toString') || p.endsWith('${qs '))).toBe(false);
  });
});

describe('canonical tells a path segment from a glued-on placeholder', () => {
  it('treats `/x/${id}/y` as a segment', () => {
    expect(canonical('/api/x/${id}/y')).toBe('/api/x/:p/y');
  });

  // `/api/admin/live${qs}` builds a QUERY STRING, not another path level.
  it('drops a placeholder glued to a segment', () => {
    expect(canonical('/api/admin/live${q ? `?${q}` : ""}')).toBe('/api/admin/live');
    expect(canonical('/api/admin/logs${qs}')).toBe('/api/admin/logs');
  });

  it('still distinguishes two genuinely different routes', () => {
    expect(canonical('/api/a/${id}')).not.toBe(canonical('/api/a'));
  });
});

// offers-routes.js registers pause/resume in a loop:
//     app.post(`/api/offers/:id/${path}`, …)
// Those are real routes at runtime. Without this the check invents two dead
// paths that work perfectly — and a check that invents findings gets ignored.
describe('routes registered in a loop are still routes', () => {
  it('does not call a looped registration a dead path', () => {
    const found = deadPaths({
      requested: new Set(['/api/offers/${id}/pause', '/api/offers/${id}/resume']),
      routes: new Set(['POST /api/offers/:id/${path}']),
    });
    expect(found).toEqual([]);
  });

  it('still reports something genuinely outside that prefix', () => {
    const found = deadPaths({
      requested: new Set(['/api/offers/${id}/pause', '/api/nothing-here']),
      routes: new Set(['POST /api/offers/:id/${path}']),
    });
    expect(found).toEqual(['/api/nothing-here']);
  });
});
