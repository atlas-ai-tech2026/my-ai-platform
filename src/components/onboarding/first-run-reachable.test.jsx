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

  it('☠ but NOT over the control panel', () => {
    // This guard was GREEN while the defect was live, which is the lesson:
    // it asserted the gate is mounted outside <Routes>, and that is exactly
    // what caused the bug. A test can be satisfied by the thing it exists to
    // prevent.
    //
    // On dev the flow is forced open on every page load. The admin route is
    // inside <Routes>, so the survey painted over the whole control panel at
    // zIndex 9000 against its 1000 — and the only way past was Skip, which
    // writes __skipped over the real answers the owner had come to read.
    const app = code('src/App.jsx');
    expect(app).toMatch(/pathname !== ADMIN_ROUTE && <FirstRunGate \/>/);
    expect(app, 'the pathname has to come from somewhere').toMatch(/useLocation/);
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
  it('three screens, and attribution is first', () => {
    // Three, not four: the "make one yourself" screen is withdrawn until its
    // Generate button actually generates. Amr's call — a red button that does
    // nothing is worse on production than one screen fewer.
    expect(SCREENS).toHaveLength(3);
    expect(SCREENS[0].id).toBe('source');
    expect(SCREENS[0].questions[0].id).toBe('found');
    expect(SCREENS.map((x) => x.id)).not.toContain('first');
  });

  it('☠ nothing offers a Generate button while nothing generates', () => {
    // The screen is coming back. Until it does, no screen may claim it.
    expect(SCREENS.some((x) => x.generate)).toBe(false);
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

// ─── ADDED after Amr tested it ───────────────────────────────────────────────
// Two things he reported, and one of them was a genuine bug rather than a
// preference: "the transition when I click continue must be smooth — this has
// not happened", and "if I did not check anything, you cannot move".
describe('☠ THE TRANSITION MUST ACTUALLY RUN', () => {
  const run = () => code('src/components/onboarding/FirstRun.jsx');

  it('the animated element is a real box, never display:contents', () => {
    // THE BUG. The first version put `.fr-enter` on a display:contents
    // wrapper. Such an element generates NO BOX, so opacity and transform have
    // nothing to act on — the animation never ran, and Amr saw the screens
    // snap. It looked perfectly correct in the source.
    const s = run();
    const at = s.indexOf('fr-content');
    expect(at, 'the content wrapper is gone').toBeGreaterThan(-1);
    expect(s).not.toMatch(/className=\{?`?fr-enter[^`"]*`?\}?\s+style=\{\{\s*display:\s*'contents'/);
    expect(s).toMatch(/\.fr-content\s*\{[^}]*display:\s*flex/);
  });

  it('leaves before it enters, so the change is not instant', () => {
    const s = run();
    expect(s).toMatch(/@keyframes frOut/);
    expect(s).toMatch(/fr-leave/);
    expect(s, 'nothing sets the leaving state').toMatch(/setLeaving\(true\)/);
  });

  it('and waits for the fade-out rather than swapping under it', () => {
    // A swap faster than the animation is the same as no animation.
    const s = run();
    expect(s).toMatch(/190/);
  });

  it('the whole thing still stops under reduced motion', () => {
    expect(run()).toMatch(/prefers-reduced-motion[\s\S]{0,220}fr-enter/);
  });
});

describe('☠ CONTINUE WILL NOT MOVE ON NOTHING', () => {
  const run = () => code('src/components/onboarding/FirstRun.jsx');

  it('every non-optional question must be answered first', () => {
    const s = run();
    expect(s).toMatch(/const canContinue = screen\.questions\.every\(\(q\) => q\.optional \|\| filled\(q\)\)/);
  });

  it('and the button is genuinely disabled, not merely faded', () => {
    expect(run()).toMatch(/disabled=\{busy \|\| !canContinue\}/);
  });

  it('☠ a disabled button says WHY — a dead control reads as broken', () => {
    const s = run();
    expect(s).toMatch(/Choose an answer, or Skip/);
    expect(s).toMatch(/Choose an answer to continue/);
  });

  it('the optional company field never blocks it', () => {
    // Marked optional in onboarding-questions.js, and canContinue honours that.
    expect(run()).toMatch(/q\.optional \|\| filled\(q\)/);
  });
});

// ─── ADDED 2026-09-01 ────────────────────────────────────────────────────────
// Amr: "stop this page from dev for every opening — if I need to test
// something it will open for me every time. Do it as per production exactly."
describe('☠ THE FORCE FLAG CANNOT REACH PRODUCTION', () => {
  it('the server ANDs it with the host check, so order protects it', () => {
    // If it were `req.body.force || isDev` a customer could reopen their own
    // onboarding, or anyone's, by adding a query string. AND means the host
    // decides first and the flag is inert everywhere else.
    const server = read('server/src/index.js');
    expect(server).toMatch(/onboardingDevHost\(req\) && req\.body\?\.force === true/);
  });

  it('and the client only sets it from an explicit ?firstrun=1', () => {
    const gate = code('src/components/onboarding/FirstRunGate.jsx');
    expect(gate).toMatch(/firstrun=1/);
    expect(gate).toMatch(/force:/);
  });

  it('☠ nothing shows the flow automatically any more', () => {
    // The old rule was `if (isDev) return true` with no condition. Its absence
    // is the whole change Amr asked for.
    const onb = read('server/src/onboarding.js');
    expect(onb).not.toMatch(/if \(isDev\) return true/);
  });
});
