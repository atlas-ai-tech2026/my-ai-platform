// ─── cors-origins.test.js ────────────────────────────────────────────────────
// N14 (recheck 2026-08-03): ALLOWED_ORIGINS was not set in production —
// verified against the live App Platform spec — so production ran on the
// built-in fallback, which trusted http://localhost:5173/8080/3001. Combined
// with credentials:true that let software listening on a victim's own machine
// make credentialed calls and read the responses.
//
// Fixed in the DEFAULT rather than by setting the env var: a setting that has
// to be right is one that can be cleared, mistyped or forgotten on a new app —
// which is exactly what happened here, twice (production and the dev twin).

import { describe, it, expect } from 'vitest';

/** Mirrors the ALLOWED_ORIGINS construction in index.js. */
function allowedOrigins(env = {}) {
  const isProduction = env.NODE_ENV === 'production';
  const defaults = [
    'https://voxel-ai.ai',
    'https://www.voxel-ai.ai',
    ...(isProduction ? [] : [
      'http://localhost:5173',
      'http://localhost:8080',
      'http://localhost:3001',
    ]),
  ];
  return (env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.split(',') : defaults)
    .map((s) => s.trim())
    .filter(Boolean);
}

describe('N14 — production never inherits localhost origins', () => {
  it('excludes localhost when NODE_ENV is production', () => {
    const list = allowedOrigins({ NODE_ENV: 'production' });
    expect(list).toEqual(['https://voxel-ai.ai', 'https://www.voxel-ai.ai']);
    expect(list.some((o) => o.includes('localhost'))).toBe(false);
  });

  it('is safe even with no environment configured at all', () => {
    // The real production state: ALLOWED_ORIGINS unset. Before N14 this was
    // the branch that leaked localhost into the live allow-list.
    expect(allowedOrigins({ NODE_ENV: 'production' })).not.toContain('http://localhost:5173');
  });
});

describe('N14 — local development still works', () => {
  it('includes the dev origins when NODE_ENV is not production', () => {
    const list = allowedOrigins({});
    expect(list).toContain('http://localhost:5173');
    // :3001 is the single-process prod repro; a module <script crossorigin>
    // sends an Origin, so refusing it would 403 the app's own bundle — the
    // exact failure seen on the dev twin (see .do/app-dev.yaml).
    expect(list).toContain('http://localhost:3001');
  });
});

describe('N14 — an explicit setting still wins', () => {
  it('uses ALLOWED_ORIGINS verbatim when provided', () => {
    const list = allowedOrigins({
      NODE_ENV: 'production',
      ALLOWED_ORIGINS: 'https://voxel-app-dev-b8a2h.ondigitalocean.app, https://voxel-ai.ai',
    });
    expect(list).toEqual([
      'https://voxel-app-dev-b8a2h.ondigitalocean.app',
      'https://voxel-ai.ai',
    ]);
  });

  it('trims whitespace and drops empty entries', () => {
    expect(allowedOrigins({ ALLOWED_ORIGINS: ' https://a.example , , https://b.example ' }))
      .toEqual(['https://a.example', 'https://b.example']);
  });
});
