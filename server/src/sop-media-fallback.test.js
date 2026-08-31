// ─── sop-media-fallback.test.js ──────────────────────────────────────────────
// "Customer media backed up" read NOT CHECKED for eleven days.
//
// The whole time, the backup was copying perfectly. The line only knew one way
// to answer — count the far side — and counting the far side was exactly what
// the socket leak had broken. offsite-ledger.js was built for this case and
// describeCoverage() was written AND TESTED for this case, and nothing ever
// called it. The fallback existed and could not be reached: this project's
// signature failure, in the code meant to detect that failure.
//
// These tests are about the WIRING, because the function was never the problem.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeCoverage } from './offsite-ledger.js';

const SRC = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'sop-routes.js'), 'utf8');

describe('☠ THE FALLBACK IS ACTUALLY CALLED', () => {
  it('sop-routes imports describeCoverage', () => {
    expect(SRC).toMatch(/import \{[^}]*describeCoverage[^}]*\} from '\.\/offsite-ledger\.js'/);
  });

  it('and CALLS it, not merely imports it', () => {
    // Importing without calling is exactly the state this line was in.
    expect(SRC).toMatch(/describeCoverage\(\{/);
  });

  it('the call sits in the FAILURE path of the media-backup line', () => {
    // It has to run where the listing threw. Wired into the success path it
    // would be decoration.
    const at = SRC.indexOf('describeCoverage({');
    const catchAt = SRC.lastIndexOf('} catch (e) {', at);
    expect(catchAt).toBeGreaterThan(-1);
    expect(at - catchAt).toBeLessThan(1200);
  });

  it('and it tells the ledger the listing did NOT work', () => {
    // describeCoverage words its own answer differently depending on this, so
    // passing it wrong would make a weaker claim read as a stronger one.
    const near = SRC.slice(SRC.indexOf('describeCoverage({'), SRC.indexOf('describeCoverage({') + 300);
    expect(near).toMatch(/listingWorked:\s*false/);
  });
});

describe('what the line says when it falls back', () => {
  it('says PROTECTED when our own record covers everything', () => {
    const v = describeCoverage({ sourceCount: 100, ledgerCount: 100, listingWorked: false });
    expect(v.state).toBe('ok');
    // The weaker basis must be visible in the words, not hidden.
    expect(v.detail).toMatch(/our own record/i);
    expect(v.detail).toMatch(/could not be listed/i);
  });

  it('warns, with a number, when files are not yet copied', () => {
    const v = describeCoverage({ sourceCount: 100, ledgerCount: 60, listingWorked: false });
    expect(v.state).toBe('warn');
    expect(v.missing).toBe(40);
  });

  it('☠ is CRITICAL when nothing at all is recorded', () => {
    const v = describeCoverage({ sourceCount: 100, ledgerCount: 0, listingWorked: false });
    expect(v.state).toBe('critical');
    expect(v.detail).toMatch(/ONE place/);
  });

  it('☠ stays UNKNOWN when the numbers cannot be read — never green', () => {
    // Number(null) is 0 and 0 is finite. That trap has already put a green
    // tick on a backup screen that had read nothing.
    for (const bad of [null, undefined, '']) {
      expect(describeCoverage({ sourceCount: bad, ledgerCount: 5 }).state).toBe('unknown');
      expect(describeCoverage({ sourceCount: 5, ledgerCount: bad }).state).toBe('unknown');
    }
  });
});

describe('when BOTH sides are unreadable it must still say "not checked"', () => {
  it('the fallback has its own catch, and does not swallow into a green', () => {
    const at = SRC.indexOf('describeCoverage({');
    const after = SRC.slice(at, at + 1400);
    expect(after).toMatch(/catch \(inner\)/);
    // A failure to fall back must leave the line UNKNOWN, not OK.
    expect(after).toMatch(/STATE\.UNKNOWN/);
    expect(after).toMatch(/not checked/);
  });
});

// ─── ADDED with #79 ──────────────────────────────────────────────────────────
// The SOP screen's own blind spot. Every other line runs INSIDE the app, so
// none can report an outage — a dead app runs no checks. This one reports
// whether anything OUTSIDE is watching.
describe('☠ THE "SOMETHING OUTSIDE IS WATCHING" LINE IS WIRED', () => {
  it('sop-routes imports judgeWitness AND calls it', () => {
    expect(SRC).toMatch(/import \{[^}]*judgeWitness[^}]*\} from '\.\/uptime-witness\.js'/);
    expect(SRC).toMatch(/judgeWitness\(/);
  });

  it('the line is actually pushed onto the screen', () => {
    // Importing and computing without pushing is a check nobody can see —
    // this project's most repeated failure.
    expect(SRC).toMatch(/key: 'external-monitor'/);
  });

  it('reads the flag rather than asking anything at request time', () => {
    // Asking anything live would only prove WE are alive, which is exactly
    // the question this line refuses to answer.
    expect(SRC).toMatch(/WITNESS_READ_SQL/);
  });

  it('and if the read fails it says "not checked", never that a monitor exists', () => {
    const at = SRC.indexOf("key: 'external-monitor'");
    const after = SRC.slice(at, at + 2600);
    expect(after).toMatch(/STATE\.UNKNOWN/);
    expect(after).toMatch(/not checked/);
  });
});
