// ─── slow-image-wired.test.js ────────────────────────────────────────────────
// The hand-off is not one piece of code — it is SIX, and it only works if all
// six are connected:
//
//   1. kie.js marks a give-up as `gaveUp` (not just a message)
//   2. the generate route catches THAT and records the job
//   3. the charge is tracked, so a later failure is still refundable
//   4. /api/image-status exists for the browser
//   5. a sweeper runs on a timer for the browsers that never come back
//   6. the table is created at migrate time
//
// Every one of those has been the missing link in some previous bug: the task
// board wrote rows nothing read, five endpoints had no button, the thumbnail
// backfill wrote a field the grid ignored. A module that is correct and
// unreachable is the house speciality, so this reads the wiring rather than
// the logic. The logic is tested in slow-image.test.js.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const read = (f) => fs.readFileSync(path.join(here, f), 'utf8');
/** Comments explain the bug and MENTION the broken values — scan code only. */
const code = (f) => read(f).split('\n')
  .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*'))
  .join('\n');

const index = code('index.js');
const kie = code('kie.js');
const db = code('db.js');

describe('1 — the provider client distinguishes impatience from failure', () => {
  it('the timeout throw carries gaveUp', () => {
    expect(kie).toMatch(/\.gaveUp\s*=\s*true/);
  });

  it('and no longer promises a refund it does not issue', () => {
    // The old message said "we stopped and refunded your credits". With the
    // hand-off in place that sentence is a lie in the common case.
    expect(kie).not.toMatch(/stopped and refunded your credits/);
  });
});

describe('2 & 3 — the route hands off instead of throwing away', () => {
  it('branches on gaveUp, NOT on the error message', () => {
    // Message-matching has produced three separate bugs in this codebase.
    expect(index).toMatch(/gaveUp/);
  });

  it('records the job before answering the customer', () => {
    // The USE, not the import line at the top of the file.
    const at = index.indexOf('pool.query(RECORD_SQL');
    const answer = index.indexOf('pending: true');
    expect(at, 'the job is never recorded').toBeGreaterThan(0);
    expect(at, 'answered before recording — a promise nothing keeps').toBeLessThan(answer);
  });

  it('tracks the charge, so a genuine failure is still refundable later', () => {
    const at = index.indexOf('pool.query(RECORD_SQL');
    expect(index.slice(at, at + 900)).toMatch(/trackVideoCharge/);
  });

  it('does NOT refund at hand-off time — the image is still coming', () => {
    const window = index.slice(index.indexOf('gaveUp'), index.indexOf('gaveUp') + 900);
    expect(window).not.toMatch(/refundCredits/);
  });
});

describe('4 — the browser has something to poll', () => {
  it('/api/image-status exists', () => {
    expect(index).toMatch(/app\.post\('\/api\/image-status'/);
  });

  it('is authenticated and rate-limited like /api/video-status (M5)', () => {
    const line = index.split('\n').find((l) => l.includes("'/api/image-status'"));
    expect(line).toMatch(/verifyJwt/);
    expect(line).toMatch(/requireNotBanned/);
    expect(line).toMatch(/statusLimiter/);
  });

  it('checks ownership by user id — polling someone else’s job 404s', () => {
    const window = index.slice(index.indexOf("'/api/image-status'"));
    expect(window.slice(0, 1200)).toMatch(/OWNS_SQL.*req\.user\.id|req\.user\.id\]/s);
  });

  it('an unknown error answers IN_PROGRESS, never FAILED', () => {
    // A blip must not refund an image that is on its way.
    const window = index.slice(index.indexOf("'/api/image-status'"), index.indexOf("'/api/image-status'") + 3000);
    const catchBlock = window.slice(window.lastIndexOf('} catch'));
    expect(catchBlock).toMatch(/IN_PROGRESS/);
    expect(catchBlock).not.toMatch(/FAILED/);
  });
});

describe('5 — the sweeper actually runs', () => {
  it('is scheduled at boot, not merely defined', () => {
    // The step that has been missed before: a function nobody calls.
    expect(index).toMatch(/function scheduleSlowImageSweep/);
    expect(index).toMatch(/^\s*scheduleSlowImageSweep\(\);/m);
  });

  it('runs every minute — an hourly sweep would make a 2-minute wait an hour', () => {
    const fn = index.slice(index.indexOf('function scheduleSlowImageSweep'));
    expect(fn.slice(0, 400)).toMatch(/setInterval\(run, 60 \* 1000\)/);
  });

  it('writes the history row itself — nothing else can, with the tab gone', () => {
    const fn = index.slice(index.indexOf('async function sweepSlowImages'));
    expect(fn.slice(0, 2500)).toMatch(/INSERT INTO entities[\s\S]*GenerationHistory/);
  });
});

describe('6 — the table is created', () => {
  it('migrate() runs the DDL', () => {
    expect(db).toMatch(/SLOW_IMAGE_DDL/);
  });

  it('and db.js imports it rather than keeping a second copy', () => {
    expect(read('db.js')).toMatch(/import \{ SLOW_IMAGE_DDL \} from '\.\/slow-image\.js'/);
  });
});

describe('the front end is connected too', () => {
  const page = fs.readFileSync(path.join(here, '../../src/pages/Image.jsx'), 'utf8');

  it('Image.jsx waits instead of reporting a failure', () => {
    expect(page).toMatch(/waitForImage/);
    expect(page).toMatch(/response\.data\?\.pending/);
  });

  it('a wait that is abandoned does not tell the customer it failed', () => {
    // The call, not the import at the top of the file.
    const at = page.indexOf('await waitForImage(');
    expect(at, 'waitForImage is imported but never called').toBeGreaterThan(0);
    const window = page.slice(at, at + 1400);
    expect(window).toMatch(/!out\.done/);
    // toast.info, never toast.error, on the give-up branch.
    const giveUp = window.slice(window.indexOf('!out.done'), window.indexOf('!out.done') + 400);
    expect(giveUp).toMatch(/toast\.info/);
    expect(giveUp).not.toMatch(/toast\.error/);
  });

  it('skips writing history when something else already did', () => {
    expect(page).toMatch(/alreadyInHistory/);
  });
});
