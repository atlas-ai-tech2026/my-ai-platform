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
  presentAdvisoryRun,
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

// ─── running it weekly instead of on every page load ─────────────────────────
// `npm audit` is a network call with a 90-second ceiling, and it was wired into
// a zone rebuilt on EVERY load of the SOP screen. Opening the page twice ran it
// twice and the page waited for the slower one.
//
// Storing the result is only safe if the screen is HONEST about its age. A line
// that says "checked just now" over Tuesday's answer is the same failure as the
// backup line that reported process memory: it cannot tell "fine" from "the job
// stopped a fortnight ago".

describe('the stored result', () => {
  const at = (daysAgo) => new Date(Date.UTC(2026, 7, 20) - daysAgo * 864e5).toISOString();
  const NOW = Date.UTC(2026, 7, 20);
  const run = (daysAgo, over = {}) => ({
    state: 'ok', detail: 'no new advisories · 11 already reviewed', action: '',
    added: [], checkedAt: at(daysAgo), ...over,
  });

  it('before it has ever run, says so — and is not ok', () => {
    const p = presentAdvisoryRun(null, { now: NOW });
    expect(p.state).toBe('unknown');
    expect(p.state).not.toBe('ok');
    expect(p.detail).toMatch(/not checked yet/);
    expect(p.checkedAt, 'a never-run check carried a timestamp').toBeNull();
  });

  it('carries the date the audit actually ran, not the moment the page opened', () => {
    const p = presentAdvisoryRun(run(3), { now: NOW });
    expect(p.checkedAt).toBe(at(3));
    expect(p.detail).toMatch(/checked 3 days ago/);
  });

  // The failure this is really guarding: the weekly job dies, and the screen
  // keeps showing last month's green because the answer it stored was green.
  it('a result older than the cadence stops counting as a pass', () => {
    const p = presentAdvisoryRun(run(21), { now: NOW });
    expect(p.state, 'a three-week-old result was still reported as ok').toBe('unknown');
    expect(p.detail).toMatch(/last checked 21 days ago/);
    expect(p.action).toMatch(/why the weekly job stopped/);
  });

  it('a recent result is still shown at its real state', () => {
    expect(presentAdvisoryRun(run(6), { now: NOW }).state).toBe('ok');
    expect(presentAdvisoryRun(run(6, { state: 'critical' }), { now: NOW }).state).toBe('critical');
  });

  // Deliberately NOT a read-through cache. Refilling on read is the page-load
  // cost coming back through a side door, under whichever request arrived first.
  it('never runs the audit as a side effect of being displayed', () => {
    let ran = false;
    const spy = () => { ran = true; };
    presentAdvisoryRun(null, { now: NOW, exec: spy });
    presentAdvisoryRun(run(40), { now: NOW, exec: spy });
    expect(ran, 'displaying the line triggered an audit').toBe(false);
  });
});

// ─── the first run is a baseline, not eleven emergencies ─────────────────────
// Seen for real on dev, 2026-08-20: the very first audit reported "11 NEW
// advisories since the last check" and turned the line CRITICAL on a day when
// nothing had happened. There was no last check. Everything diffs as new when
// nothing is reviewed yet.
//
// This module's whole argument is that a check reporting totals teaches
// dismissal. Shipping it in a state where day one reports totals — dressed as
// change — would have taught that lesson on the first morning anyone looked.
describe('the very first check', () => {
  const parsed = () => parseAudit(REAL, { productionDeps: PROD });

  it('says "first check", not "NEW since the last check"', () => {
    const v = judgeAdvisories({ parsed: parsed(), known: [] });
    expect(v.detail).toMatch(/first check/);
    expect(v.detail, 'a baseline was described as a change').not.toMatch(/NEW/);
    expect(v.baseline).toBe(true);
  });

  it('is not CRITICAL, because nothing happened', () => {
    const v = judgeAdvisories({ parsed: parsed(), known: [] });
    expect(v.state, 'day one turned the screen red on its own arrival').not.toBe('critical');
    expect(v.state).toBe('warn');
  });

  // Not silent either. Four unreviewed advisories in production is worth a look.
  it('still counts them, and says how many reach a customer', () => {
    const v = judgeAdvisories({ parsed: parsed(), known: [] });
    expect(v.detail).toMatch(/4 advisories found/);
    expect(v.detail).toMatch(/2 in production dependencies/);
  });

  it('points at the one worth starting with, and whether a fix exists', () => {
    const v = judgeAdvisories({ parsed: parsed(), known: [] });
    expect(v.action).toMatch(/xlsx/);
    expect(v.action).toMatch(/production dependency/);
    expect(v.action).toMatch(/no upstream fix/);
  });

  // The baseline must not swallow a genuine change later on.
  it('once anything is reviewed, a new advisory is reported as new again', () => {
    const known = parsed().advisories.filter((a) => a.name !== 'nanoid').map(advisoryKey);
    const v = judgeAdvisories({ parsed: parsed(), known });
    expect(v.baseline).toBeUndefined();
    expect(v.detail).toMatch(/1 NEW advisory/);
  });

  // An EMPTY audit with nothing reviewed is a clean project, not a baseline.
  it('a clean project is simply ok', () => {
    const v = judgeAdvisories({ parsed: parseAudit(auditJson({})), known: [] });
    expect(v.state).toBe('ok');
    expect(v.baseline).toBeUndefined();
  });
});
