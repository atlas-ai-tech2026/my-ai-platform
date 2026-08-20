// ─── sop-advisories.test.js ──────────────────────────────────────────────────
// "Ten advisories were accepted deliberately and nothing would report an
//  eleventh." — the reason this exists.
//
// The tests that matter here are about NOT crying wolf. A line reporting
// "11 advisories, 1 critical" every week is alarming, unchanging, and mostly
// noise — so it teaches dismissal, and then the real one gets dismissed too.
//
// And severity is not risk. Today's single CRITICAL is in vitest, a test runner
// that never reaches a customer. The advisory that actually matters is a HIGH
// in xlsx: prototype pollution, production dependency, no upstream fix.

import { describe, it, expect } from 'vitest';
import {
  parseAudit, diffAdvisories, judgeAdvisories, advisoryKey, byRealRisk,
} from './sop-advisories.js';

const auditJson = (vulns) => JSON.stringify({ vulnerabilities: vulns });

const V = (severity, title, fixAvailable = true) => ({
  severity, fixAvailable, via: [{ title }],
});

// Modelled on the real output from 2026-08-20.
const REAL = auditJson({
  vitest: V('critical', '@vitest/mocker'),
  vite: V('high', 'Vite Vulnerable to Path Traversal'),
  nanoid: V('high', 'nanoid: custom generators can loop indefinitely'),
  xlsx: V('high', 'Prototype Pollution in sheetJS', false),
});
const PROD = new Set(['vite', 'xlsx']);

describe('reading npm audit', () => {
  it('pulls out name, severity, fix and title', () => {
    const { advisories } = parseAudit(REAL, { productionDeps: PROD });
    const x = advisories.find((a) => a.name === 'xlsx');
    expect(x).toMatchObject({ severity: 'high', fixAvailable: false, production: true });
    expect(x.title).toMatch(/Prototype Pollution/);
  });

  it('knows which ones reach a customer', () => {
    const { advisories } = parseAudit(REAL, { productionDeps: PROD });
    expect(advisories.find((a) => a.name === 'vitest').production).toBe(false);
    expect(advisories.find((a) => a.name === 'xlsx').production).toBe(true);
  });

  // npm has changed this format more than once. A parser that throws would take
  // the whole SOP screen with it — and an unreadable report must be REPORTED,
  // never quietly treated as "nothing found".
  it.each([
    ['not json at all', 'this is not json'],
    ['json with no vulnerabilities section', '{"metadata":{}}'],
    ['an empty string', ''],
  ])('reports %s as an error rather than as clean', (_label, raw) => {
    const r = parseAudit(raw);
    expect(r.error, 'a broken audit was treated as finding nothing').toBeTruthy();
    expect(r.advisories).toEqual([]);
  });

  it('an unreadable audit renders as UNKNOWN, never ok', () => {
    const v = judgeAdvisories({ parsed: parseAudit('broken') });
    expect(v.state).toBe('unknown');
    expect(v.state).not.toBe('ok');
  });
});

describe('reporting change, not totals', () => {
  const parsed = () => parseAudit(REAL, { productionDeps: PROD });
  const allKnown = () => parsed().advisories.map(advisoryKey);

  // THE WHOLE POINT. Eleven advisories that were all reviewed last week is not
  // news, and saying it every morning is how a check becomes wallpaper.
  it('says nothing alarming when every advisory is already reviewed', () => {
    const v = judgeAdvisories({ parsed: parsed(), known: allKnown() });
    expect(v.state).toBe('ok');
    expect(v.detail).toMatch(/no new advisories/);
    expect(v.action).toBeNull();
  });

  it('still says how many are carried, so "ok" is not mistaken for "none"', () => {
    const v = judgeAdvisories({ parsed: parsed(), known: allKnown() });
    expect(v.detail).toMatch(/4 already reviewed/);
    expect(v.detail, 'it never mentions that some are in production').toMatch(/production/);
  });

  it('speaks up the moment one is new', () => {
    const known = allKnown().filter((k) => !k.startsWith('nanoid'));
    const v = judgeAdvisories({ parsed: parsed(), known });
    expect(v.state).not.toBe('ok');
    expect(v.detail).toMatch(/1 NEW advisory/);
    expect(v.detail).toMatch(/nanoid/);
  });

  it('notices when one is resolved, so the accepted list can be cleaned', () => {
    const known = [...allKnown(), 'somepkg@high'];
    const v = judgeAdvisories({ parsed: parsed(), known });
    expect(v.resolved).toContain('somepkg@high');
  });

  it('treats a severity CHANGE on the same package as new', () => {
    const known = ['xlsx@moderate'];
    const { added } = diffAdvisories(parsed().advisories, known);
    expect(added.map((a) => a.name), 'xlsx going moderate→high went unreported')
      .toContain('xlsx');
  });
});

describe('severity is not risk', () => {
  // A CRITICAL in a test runner never reaches a customer. A HIGH in a library
  // that parses customer spreadsheets does. Ranking by npm's badge would put
  // the harmless one first every single time.
  it('puts a production HIGH above a development CRITICAL', () => {
    const { advisories } = parseAudit(REAL, { productionDeps: PROD });
    const worst = [...advisories].sort(byRealRisk)[0];
    expect(worst.production, 'a development advisory outranked a production one').toBe(true);
    expect(['xlsx', 'vite']).toContain(worst.name);
  });

  // A new advisory in something customers touch is a different morning from a
  // new one in a build tool.
  it('escalates harder when the new one is in production', () => {
    const parsed = parseAudit(REAL, { productionDeps: PROD });
    const devOnly = judgeAdvisories({
      parsed, known: parsed.advisories.filter((a) => a.name !== 'vitest').map(advisoryKey),
    });
    const inProd = judgeAdvisories({
      parsed, known: parsed.advisories.filter((a) => a.name !== 'xlsx').map(advisoryKey),
    });
    expect(devOnly.state).toBe('warn');
    expect(inProd.state).toBe('critical');
  });

  it('points at the one worth starting with, and says if a fix exists', () => {
    const parsed = parseAudit(REAL, { productionDeps: PROD });
    const v = judgeAdvisories({
      parsed, known: parsed.advisories.filter((a) => a.name !== 'xlsx').map(advisoryKey),
    });
    expect(v.action).toMatch(/xlsx/);
    expect(v.action).toMatch(/production dependency/);
    expect(v.action).toMatch(/fix available/);
  });
});
