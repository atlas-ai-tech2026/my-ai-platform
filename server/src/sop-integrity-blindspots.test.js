// ─── sop-integrity-blindspots.test.js ────────────────────────────────────────
// ☠ THE CHECK THAT FINDS UNREACHABLE CODE WAS ITSELF REPORTING LIVE CODE AS DEAD.
//
// The Structure zone existed to catch "a screen promising something no table
// keeps". On production it reported:
//
//     Screens calling nothing   3
//     Endpoints nothing calls  22
//
// Of those 25, most were wrong. Three blind spots, each of which made the
// scanner describe working code as broken:
//
//   1. invoke() — `base44.functions.invoke('history/search')` builds its URL at
//      RUNTIME, so the string "/api/history/search" appears nowhere. A dozen
//      live endpoints — the whole history search, onboarding, the edit agent,
//      the pollers — were reported as called by nobody.
//
//   2. app.all([...]) — /api/history/models and /api/history/deleted are
//      registered with an ARRAY. The regex expected app.post('/api/…') exactly,
//      so two routes answering 401 on production were reported as paths the
//      interface calls and the server does not serve.
//
//   3. Express 5 wildcards — `/api/speech/model/*splat` serves
//      `/api/speech/model/whisper-tiny/config.json`. That path was reported as
//      a screen calling nothing WHILE I was fetching it from production and
//      getting 200s.
//
// A structural check that cries wolf 25 times is worse than no check: the
// number can never fall, so nobody reads it, so the one real finding is missed.
// That is precisely the failure this module was written to prevent, arriving in
// the module itself.

import { describe, it, expect } from 'vitest';
import {
  registeredRoutes, requestedPaths, extractInvokeNames,
  deadPaths, uncalledRoutes, EXPECTED_UNCALLED,
} from './sop-integrity.js';

const f = (src) => [{ file: 'x.js', src }];

describe('☠ 1. invoke() IS A CALL', () => {
  it('sees invoke(\'history/search\') as /api/history/search', () => {
    expect(extractInvokeNames("base44.functions.invoke('history/search', q)"))
      .toEqual(['/api/history/search']);
  });

  it('all three quote styles', () => {
    expect(extractInvokeNames(`invoke('a'); invoke("b"); invoke(\`c\`)`))
      .toEqual(['/api/a', '/api/b', '/api/c']);
  });

  it('a leading slash is not doubled', () => {
    expect(extractInvokeNames("invoke('/onboarding')")).toEqual(['/api/onboarding']);
  });

  it('☠ but a TEMPLATE name is skipped, not guessed at', () => {
    // invoke(`history/${kind}`) could be anything. Inventing a path would put a
    // route that does not exist into the "dead" column — the same lie in the
    // other direction.
    expect(extractInvokeNames('invoke(`history/${kind}`)')).toEqual([]);
  });

  it('and requestedPaths includes them alongside literal strings', () => {
    const p = requestedPaths(f("fetch('/api/health'); invoke('onboarding/step')"));
    expect([...p].sort()).toEqual(['/api/health', '/api/onboarding/step']);
  });

  it('☠ an endpoint reached ONLY through invoke is no longer reported as uncalled', () => {
    const routes = registeredRoutes(f("app.post('/api/history/search', h)"));
    const requested = requestedPaths(f("invoke('history/search', q)"));
    expect(uncalledRoutes({ requested, routes })).toEqual([]);
  });
});

describe('☠ 2. app.all AND THE ARRAY FORM ARE REGISTRATIONS', () => {
  it('sees app.all with an array — the real shape of /api/history/models', () => {
    const r = registeredRoutes(f("app.all(['/api/history/models'], verifyJwt, h)"));
    expect([...r]).toEqual(['ALL /api/history/models']);
  });

  it('an array registering several paths registers ALL of them', () => {
    const r = registeredRoutes(f("app.all(['/api/a', '/api/b'], h)"));
    expect([...r].sort()).toEqual(['ALL /api/a', 'ALL /api/b']);
  });

  it('ordinary registrations still work', () => {
    const r = registeredRoutes(f("app.get('/api/x', h); app.post('/api/y', h)"));
    expect([...r].sort()).toEqual(['GET /api/x', 'POST /api/y']);
  });

  it('☠ and a path served by app.all is no longer a "screen calling nothing"', () => {
    const routes = registeredRoutes(f("app.all(['/api/history/models'], h)"));
    const requested = requestedPaths(f("invoke('history/models', {})"));
    expect(deadPaths({ requested, routes })).toEqual([]);
  });
});

describe('☠ 3. A WILDCARD SERVES EVERYTHING BENEATH IT', () => {
  it('/api/speech/model/*splat serves the file the browser asks for', () => {
    const routes = registeredRoutes(f("app.get('/api/speech/model/*splat', h)"));
    const requested = requestedPaths(f("const base='/api/speech/model/whisper-tiny/config.json'"));
    expect(deadPaths({ requested, routes })).toEqual([]);
  });

  it('and the wildcard route counts as called when anything beneath it is', () => {
    const routes = registeredRoutes(f("app.get('/api/speech/model/*splat', h)"));
    const requested = requestedPaths(f("const b='/api/speech/model/'"));
    expect(uncalledRoutes({ requested, routes })).toEqual([]);
  });

  it('a wildcard does NOT excuse an unrelated path', () => {
    // The prefix must actually match, or one wildcard would silence the check.
    const routes = registeredRoutes(f("app.get('/api/speech/model/*splat', h)"));
    const requested = requestedPaths(f("fetch('/api/something/else')"));
    expect(deadPaths({ requested, routes })).toEqual(['/api/something/else']);
  });
});

describe('a placeholder in a REQUESTED path is a call, not a phantom', () => {
  it('/api/auth/${provider} matches the routes it can reach', () => {
    const routes = registeredRoutes(f("app.get('/api/auth/google', h); app.get('/api/auth/microsoft', h)"));
    const requested = requestedPaths(f('window.location.assign(`/api/auth/${provider}`)'));
    expect(deadPaths({ requested, routes })).toEqual([]);
  });

  it('but one that matches NOTHING is still reported', () => {
    const routes = registeredRoutes(f("app.get('/api/other/thing', h)"));
    const requested = requestedPaths(f('fetch(`/api/missing/${id}`)'));
    expect(deadPaths({ requested, routes })).toEqual(['/api/missing/:p']);
  });
});

describe('the endpoint we can PROVE is called is not reported as uncalled', () => {
  it('/api/ready is on the expected list', () => {
    // Called by UptimeRobot from outside every 5 minutes — and it is the very
    // endpoint whose visits the SOP tab records. The one route with proof of a
    // caller was the one being reported as called by nobody.
    expect(EXPECTED_UNCALLED).toContain('/api/ready');
  });
});
