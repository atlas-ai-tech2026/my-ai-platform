// ─── character-element.test.js ───────────────────────────────────────────────
// N10 (recheck 2026-08-03): /api/check-character-eligibility returned
// approved:true for any string beginning with 'http' — it inspected nothing —
// while the interface presented it as a moderation control: a shield icon,
// "Check eligibility", and "Character approved as @Element1". A user could
// upload a real person's likeness and the platform stamped it approved.
//
// That is a false compliance record rather than a code defect, so the fix is
// honesty: the endpoint validates only what it can (the reference is an https
// URL on a host we serve media from) and no wording claims otherwise.
//
// These tests guard the claim, not just the logic — the danger here is that
// someone reintroduces approval language over an endpoint that approves nothing.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
/** Comments quote the old code they replaced, so a naive search matches the
 *  explanation rather than the behaviour — the same trap that silently
 *  disarmed the N6 wiring test. Strip them before asserting. */
const decomment = (src) => src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

const SERVER = readFileSync(path.join(dir, 'index.js'), 'utf8');
const VIDEO = decomment(readFileSync(path.join(dir, '../../src/pages/Video.jsx'), 'utf8'));
const GRID = decomment(readFileSync(path.join(dir, '../../src/components/video/SeedanceMediaGrid.jsx'), 'utf8'));

function routeBody() {
  const start = SERVER.indexOf("app.post('/api/check-character-eligibility'");
  expect(start, 'route not found — renamed?').toBeGreaterThan(-1);
  return SERVER.slice(start, SERVER.indexOf('\napp.', start + 1));
}

describe('N10 — the endpoint no longer rubber-stamps everything', () => {
  it('does not approve on the mere presence of "http"', () => {
    const body = routeBody().replace(/\/\/.*$/gm, '');
    expect(
      body.includes("startsWith('http')"),
      'the stub check is back: any string starting with http is approved'
    ).toBe(false);
  });

  it('validates the host against the shared allow-list', () => {
    const body = routeBody().replace(/\/\/.*$/gm, '');
    expect(body).toMatch(/isAllowedDownloadHost/);
    expect(body).toMatch(/https:/);
  });

  it('requires a login and a rate limit', () => {
    const head = routeBody().split('\n')[0];
    expect(head).toMatch(/verifyJwt/);
    expect(head).toMatch(/requireNotBanned/);
    expect(head).toMatch(/statusLimiter/);
  });

  it('no longer sleeps to fake a moderation delay', () => {
    expect(routeBody()).not.toMatch(/setTimeout\(\s*r\s*,\s*2000\s*\)/);
  });
});

describe('N10 — the client cannot treat a failure as approval', () => {
  it('does not use the fail-open comparison', () => {
    // `data.approved !== false` meant an error body, a 500, or a typo in the
    // field name all counted as approval.
    expect(
      VIDEO.includes('approved !== false'),
      'fail-open is back: a server error would count as an approval'
    ).toBe(false);
  });

  it('accepts only an explicit yes from a successful response', () => {
    expect(VIDEO).toMatch(/res\.ok\s*&&\s*data\.accepted === true/);
  });
});

describe('N10 — nothing in the UI claims moderation happened', () => {
  it('does not tell the user a character was "approved"', () => {
    expect(
      VIDEO.includes('Character approved'),
      'the UI claims an approval decision the server never makes'
    ).toBe(false);
  });

  it('does not label the action an eligibility check', () => {
    expect(GRID.includes('Check eligibility')).toBe(false);
  });

  it('does not use shield iconography, which reads as a safety gate', () => {
    expect(GRID.includes('ShieldCheck')).toBe(false);
    expect(GRID.includes('ShieldX')).toBe(false);
  });
});
