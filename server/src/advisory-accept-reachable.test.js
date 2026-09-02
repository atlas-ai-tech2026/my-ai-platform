// ─── advisory-accept-reachable.test.js ───────────────────────────────────────
// ☠ acceptAdvisories() WAS WRITTEN, CORRECT, AND CALLED BY NOBODY.
//
// The SOP tab has told the owner to "review them once and accept them" since
// the day the advisory line shipped. There was no way to accept anything: no
// route, no button, not even a test called the function. So the line read
// "first check — N advisories found, none reviewed yet" every week for ever,
// and the instruction on the screen described an action that did not exist.
//
// THIS IS THE THIRD TIME THIS EXACT SHAPE HAS APPEARED IN THIS CODEBASE:
//   · copyAndRecord()  — offsite ledger. Fully tested. Called by nothing,
//                        while the backup recorded files it had never read back.
//   · upsertTask()     — task board. Tested and correct. The seed skipped
//                        existing rows, so nothing ever reached the screen.
//   · acceptAdvisories() — this one.
//
// Every one of them had passing unit tests. A unit test proves a function is
// right; it says nothing about whether anybody can reach it. So this file only
// asks the second question.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const server = (f) => readFileSync(join(here, f), 'utf8');
const web = (f) => readFileSync(join(here, '../../src', f), 'utf8');

describe('☠ THE WHOLE CHAIN EXISTS, END TO END', () => {
  it('1. the function is called by something other than itself', () => {
    const routes = server('sop-routes.js');
    expect(routes, 'acceptAdvisories is not imported by the routes').toMatch(/acceptAdvisories/);
    expect(routes, 'imported but never called — the exact original bug')
      .toMatch(/await acceptAdvisories\(pool,/);
  });

  it('2. a route exposes it, and is admin-gated', () => {
    const routes = server('sop-routes.js');
    expect(routes).toMatch(/app\.post\('\/api\/admin\/sop\/advisories\/accept', adminGate/);
    // A POST cannot be run from the address bar — only adminApi sends the CSRF
    // header — so an ungated one is not merely a hole, it is an unusable hole.
    expect(routes).toMatch(/app\.get\('\/api\/admin\/sop\/advisories', adminGate/);
  });

  it('3. the API client can call both', () => {
    const api = web('lib/adminApi.js');
    expect(api).toMatch(/acceptAdvisories:[^\n]*'\/api\/admin\/sop\/advisories\/accept'/);
    expect(api).toMatch(/advisories:[^\n]*'\/api\/admin\/sop\/advisories'/);
  });

  it('4. ☠ AND A CONTROL A PERSON CAN ACTUALLY PRESS', () => {
    // The step every one of the three bugs was missing. Code, route and client
    // can all be perfect while the screen offers nothing to press.
    const panel = web('components/admin/MaintenancePanel.jsx');
    expect(panel, 'no job calls acceptAdvisories').toMatch(/run:\s*\(\)\s*=>\s*adminApi\.acceptAdvisories\(\)/);
    expect(panel, 'no preview — this list is dismissed permanently')
      .toMatch(/preview:\s*\(\)\s*=>\s*adminApi\.advisories\(\)/);
  });

  it('5. and the result is rendered rather than swallowed', () => {
    const outcome = web('lib/maintenance-outcome.js');
    expect(outcome, "outcomeOf has no case for 'advisories' — the panel would say 'Unknown job.'")
      .toMatch(/case 'advisories'/);
  });
});

describe('☠ IT ACCEPTS WHAT WAS READ, NOT WHAT IS FOUND LATER', () => {
  it('the full list is stored, not just what was new', () => {
    // `added` is empty on a first check by design, so there was nothing for an
    // accept to act on even if a button had existed.
    const adv = server('sop-advisories.js');
    expect(adv).toMatch(/ADD COLUMN IF NOT EXISTS found JSONB/);
    expect(adv, 'saveAdvisoryRun does not persist the full list').toMatch(/found = EXCLUDED\.found/);
    expect(adv, 'latestAdvisoryRun does not return it').toMatch(/found: r\.found \|\| \[\]/);
  });

  it('the column is added by MIGRATION, not only in the CREATE', () => {
    // A column added only to CREATE TABLE never appears anywhere the table
    // already exists — which is every environment that matters. The file says
    // so itself about logic_version; this follows it.
    const adv = server('sop-advisories.js');
    const create = adv.indexOf('CREATE TABLE IF NOT EXISTS advisory_runs');
    const alter = adv.indexOf('ADD COLUMN IF NOT EXISTS found');
    expect(alter).toBeGreaterThan(create);
  });

  it('the accept route reads the STORED list, never a fresh audit', () => {
    // Re-running npm audit at accept time would dismiss whatever it found a
    // minute later — including an advisory that appeared in between and was
    // read by nobody.
    const routes = server('sop-routes.js');
    const at = routes.indexOf("app.post('/api/admin/sop/advisories/accept'");
    const body = routes.slice(at, at + 1800);
    expect(body).toMatch(/latestAdvisoryRun\(pool\)/);
    expect(body, 'the accept path runs a fresh audit').not.toMatch(/refreshAdvisories|runAudit/);
  });

  it('an empty list is reported as such, never as a successful accept', () => {
    // "accepted 0" and "there was nothing to accept" are different facts, and
    // only one of them means the button worked.
    const routes = server('sop-routes.js');
    const at = routes.indexOf("app.post('/api/admin/sop/advisories/accept'");
    expect(routes.slice(at, at + 1800)).toMatch(/nothing_to_accept: true/);
  });

  it('and the line is re-judged immediately, not a week later', () => {
    // A button whose effect is invisible until next Tuesday is a button people
    // press twice.
    const routes = server('sop-routes.js');
    const at = routes.indexOf("app.post('/api/admin/sop/advisories/accept'");
    const body = routes.slice(at, at + 1800);
    expect(body).toMatch(/judgeAdvisories\(/);
    expect(body).toMatch(/saveAdvisoryRun\(pool, judged\)/);
  });
});

describe('☠ "THERE ARE NONE" AND "I DO NOT HAVE THE LIST" ARE DIFFERENT FACTS', () => {
  // Amr pressed Preview on production and got "Nothing to accept. The last
  // audit recorded no advisories to accept." — directly under a line reading
  // "16 advisories found, none reviewed yet". Both cannot be true, and a screen
  // that argues with itself is one nobody trusts again.
  //
  // The cause was benign: advisory_runs.found was added by the SAME deploy that
  // added the button, so the last weekly run had no list to give. But the
  // WORDING claimed there were no advisories, which was false and visibly so.
  const routes = server('sop-routes.js');

  it('the two cases have separate wording', () => {
    expect(routes).toMatch(/nothingToAcceptReason/);
    const at = routes.indexOf('const nothingToAcceptReason');
    const body = routes.slice(at, routes.indexOf('\n  };', at));
    // no run at all · a run that predates the column · a run that truly found none
    expect(body).toMatch(/No audit has run yet/);
    expect(body).toMatch(/did not record which/);
    expect(body).toMatch(/genuinely nothing to accept/);
  });

  it('☠ and the stale case tells you which button to press', () => {
    const at = routes.indexOf('const nothingToAcceptReason');
    const body = routes.slice(at, routes.indexOf('\n  };', at));
    // A dead end is what the lifecycle job did to him on 2026-08-31. Not again.
    expect(body).toMatch(/Press "Check now"/);
  });

  it('it is decided by the run\'s own verdict, not by guessing', () => {
    const at = routes.indexOf('const nothingToAcceptReason');
    const body = routes.slice(at, routes.indexOf('\n  };', at));
    // state !== 'ok' means the audit DID find advisories — so an empty list is
    // a missing record, not an empty world.
    expect(body).toMatch(/run\.state && run\.state !== 'ok'/);
  });

  it('and the preview carries the reason to the screen', () => {
    expect(routes).toMatch(/why_empty:/);
    const outcome = web('lib/maintenance-outcome.js');
    expect(outcome).toMatch(/r\.why_empty/);
  });
});
