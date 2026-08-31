// ─── first-run-reachable.test.jsx ────────────────────────────────────────────
// BUILT AND UNREACHABLE is this project's most repeated failure, and a
// first-run flow is unusually easy to build that way: it renders for almost
// nobody, so nothing looks wrong when it never renders at all.
//
// These read the real files and check the chain end to end — mounted, gated,
// saved, and shown on a screen Amr can open.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCREENS, SKIPPED, STARTER_PROMPTS, starterFor } from '@/lib/onboarding-questions';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/** Source with comments removed.
 *
 *  The first version of these tests searched the raw file and matched its own
 *  explanatory comments — "Outside <Routes> on purpose" counted as a <Routes>,
 *  and "deciding from localStorage would be wrong" counted as using
 *  localStorage. Both failed against code that was correct. A guard that reads
 *  prose is a guard that reports on prose. */
const code = (p) => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

describe('☠ THE CHAIN IS COMPLETE', () => {
  it('App mounts the gate, OUTSIDE the routes', () => {
    // Inside <Routes> it would only appear on one path, and a customer landing
    // anywhere else would never be asked.
    const app = code('src/App.jsx');
    const mounted = app.indexOf('<FirstRunGate />');
    const routes = app.indexOf('<Routes>');
    // ── THE ABSENT CASE FIRST ────────────────────────────────────────────
    // indexOf returns -1 when it is not there, and -1 is less than every real
    // index — so the ordering assertion alone PASSED with the component
    // deleted from App.jsx entirely. Caught by removing it and watching this
    // file stay green, which is the only way that kind of hole is ever found.
    expect(mounted, 'FirstRunGate is not mounted in App.jsx at all').toBeGreaterThan(-1);
    expect(routes).toBeGreaterThan(-1);
    expect(mounted).toBeLessThan(routes);
  });

  it('the gate asks the SERVER, not the browser', () => {
    // localStorage would ask twice: sign up on a phone, open a laptop.
    const gate = code('src/components/onboarding/FirstRunGate.jsx');
    expect(gate).toMatch(/invoke\('onboarding'/);
    expect(gate).not.toMatch(/localStorage/);
  });

  it('every route the client calls exists on the server', () => {
    const server = read('server/src/index.js');
    for (const p of ['/api/onboarding', '/api/onboarding/step', '/api/onboarding/done']) {
      expect(server, `${p} is missing`).toMatch(new RegExp(`app\\.post\\('${p.replace(/\//g, '\\/')}'`));
    }
  });

  it('and the statistics are reachable by an admin', () => {
    expect(read('server/src/index.js')).toMatch(/\/api\/admin\/onboarding-stats/);
    expect(read('src/lib/adminApi.js')).toMatch(/onboardingStats/);
  });

  it('☠ the statistics are RENDERED, on a tab that already exists', () => {
    // A component nobody renders is the failure this whole file exists for.
    const aud = read('src/components/admin/AudienceTab.jsx');
    expect(aud).toMatch(/import FirstRunStats/);
    expect(aud).toMatch(/<FirstRunStats/);
  });
});

describe('☠ IT CAN NEVER LOCK SOMEBODY OUT', () => {
  it('a failed check lets them into the product', () => {
    const gate = read('src/components/onboarding/FirstRunGate.jsx');
    expect(gate).toMatch(/\.catch\(\(\) => \{ if \(alive\) setShow\(false\)/);
  });

  it('a failed save still advances the screen', () => {
    // A survey must not keep a paying customer out of the thing they paid for.
    const run = read('src/components/onboarding/FirstRun.jsx');
    const at = run.indexOf('await api[last');
    expect(at).toBeGreaterThan(0);
    expect(run.slice(at, at + 200)).toMatch(/catch/);
  });

  it('and the server answers 200 even when it cannot save', () => {
    const server = read('server/src/index.js');
    const at = server.indexOf("app.post('/api/onboarding/step'");
    expect(server.slice(at, at + 900)).toMatch(/res\.json\(\{ ok: false \}\)/);
  });
});

describe('the questions themselves', () => {
  it('four screens, and attribution is first', () => {
    expect(SCREENS).toHaveLength(4);
    expect(SCREENS[0].id).toBe('source');
    expect(SCREENS[0].questions[0].id).toBe('found');
  });

  it('“A Voxel workshop” is the first option, so the commonest answer needs no reading', () => {
    expect(SCREENS[0].questions[0].options[0]).toBe('A Voxel workshop');
  });

  it('☠ only the screen that decides where to send them refuses a skip', () => {
    const noSkip = SCREENS.filter((s) => !s.skippable).map((s) => s.id);
    expect(noSkip).toEqual(['use']);
  });

  it('the organisation question exists and is optional', () => {
    const about = SCREENS.find((s) => s.id === 'about');
    const org = about.questions.find((q) => q.id === 'org');
    expect(org).toBeTruthy();
    expect(org.optional).toBe(true);
  });

  it('there are THREE starter prompts, not one', () => {
    // One means twenty people in the same room generate the identical picture,
    // which looks broken and kills the moment.
    expect(STARTER_PROMPTS.length).toBeGreaterThanOrEqual(3);
    expect(new Set([starterFor(1), starterFor(2), starterFor(3)]).size).toBe(3);
  });

  it('and the skip marker is a real value', () => {
    expect(SKIPPED).toBe('__skipped');
  });
});
