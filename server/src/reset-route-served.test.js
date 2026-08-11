// ─── reset-route-served.test.js ──────────────────────────────────────────────
// The link in the reset email has to resolve to a page that is actually served.
//
// This was a real bug, found by curling the built server rather than by reading
// the code: the SEO audit turned the SPA fallback into an ALLOW-LIST
// (ROUTE_META), so any path not on that list answers HTTP 404. /reset-password
// was not on it. The shell still shipped, so the page rendered — but the status
// line said "not found", and the only person who would ever have discovered it
// is a customer who is already locked out of their account.
//
// The test deliberately checks the LINK against the LIST rather than hardcoding
// the string twice. If someone changes where the email points, this fails.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resetUrl } from './password-reset.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(here, 'index.js'), 'utf8');

/** The keys of the ROUTE_META object literal in index.js. */
function servedRoutes() {
  const block = source.match(/const ROUTE_META = \{([\s\S]*?)\n\};/);
  if (!block) throw new Error('ROUTE_META not found — the fallback was restructured');
  return [...block[1].matchAll(/^\s*'([^']*)':/gm)].map((m) => m[1]);
}

/** The path a customer actually lands on, taken from the emailed link. */
function emailedRoute() {
  const url = new URL(resetUrl('sample-token', { PUBLIC_BASE_URL: 'https://voxel-ai.ai' }));
  return url.pathname.replace(/^\/+|\/+$/g, '').toLowerCase();
}

describe('the reset link lands on a served route', () => {
  it('points at a path the SPA fallback recognises', () => {
    expect(servedRoutes()).toContain(emailedRoute());
  });

  it('is exactly the route the page is registered at', () => {
    expect(emailedRoute()).toBe('reset-password');
    const app = readFileSync(path.join(here, '../../src/App.jsx'), 'utf8');
    expect(app).toMatch(/path="\/reset-password"/);
  });

  // An unlisted route falls through to the 404 branch. That branch exists on
  // purpose (soft-404s were an audit finding) — this just proves the reset
  // page is not caught by it.
  it('is not left to the soft-404 branch', () => {
    const listed = servedRoutes();
    expect(listed.includes('reset-password')).toBe(true);
    // Sanity: the list is a real allow-list, not something that matches all.
    expect(listed).not.toContain('definitely-not-a-real-route');
  });
});

describe('a reset screen must not be indexable', () => {
  it('is marked noindex in the route table', () => {
    const entry = source.match(/'reset-password':\s*\{([^}]*)\}/);
    expect(entry).not.toBeNull();
    expect(entry[1]).toMatch(/noindex:\s*true/);
  });

  // Telling crawlers "ignore this page" and "this page is canonical" at once is
  // contradictory. Note what this actually guarantees: the fallback does not
  // REWRITE the canonical to the reset URL. The shell's own default canonical
  // (the homepage) is still present in the served HTML — harmless on a noindex
  // page, and changing the shell is a separate concern.
  it('does not rewrite the canonical to point at a noindex route', () => {
    expect(source).toMatch(/canonical:\s*meta\.noindex\s*\?\s*undefined\s*:/);
  });
});
