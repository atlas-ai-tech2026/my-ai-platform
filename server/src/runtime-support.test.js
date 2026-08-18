// ─── runtime-support.test.js ─────────────────────────────────────────────────
// Production ran Node 20 for 110 days AFTER it stopped receiving security
// patches, and neither of us noticed. Node 20 reached end of life on
// 2026-04-30; this was found on 2026-08-18, by looking, not by any alarm.
//
// ── THE DISTINCTION THAT MATTERS ────────────────────────────────────────────
// My recorded position had been "do not check for Node/React updates — low
// value, high noise". That conflated two different things:
//
//   "a newer version exists"  → noise. There is always a newer version, and
//                               alerting on it teaches you to dismiss alerts.
//   "this version stops       → a DEADLINE with a security consequence, known
//    receiving security         years in advance, and completely checkable.
//    fixes on <date>"
//
// Only the second is worth an alarm. This test is that alarm, and it fails
// BEFORE the date rather than after it.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * From the official Node.js release schedule:
 *   https://raw.githubusercontent.com/nodejs/Release/main/schedule.json
 * Verified 2026-08-18. Dates move rarely; when one does, update it here — the
 * point of writing them down is that the check cannot drift silently.
 */
export const NODE_EOL = {
  18: '2025-04-30',
  20: '2026-04-30',   // ← what production was pinned to, months after this date
  22: '2027-04-30',
  24: '2028-04-30',
};

/** Warn this far ahead, so a migration is planned rather than scrambled. */
const WARN_DAYS = 120;

const majorOf = (range) => {
  const m = /(\d+)/.exec(String(range || ''));
  return m ? Number(m[1]) : null;
};

describe('the Node version we deploy is still supported', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const pinned = pkg.engines?.node;

  it('pins a Node major at all — an unpinned runtime is whatever the host felt like', () => {
    expect(pinned, 'package.json engines.node is missing').toBeTruthy();
    expect(majorOf(pinned)).toBeGreaterThan(0);
  });

  it('is NOT past end of life', () => {
    const major = majorOf(pinned);
    const eol = NODE_EOL[major];
    expect(eol, `Node ${major} is not in the schedule above — add it`).toBeTruthy();
    const daysLeft = Math.floor((Date.parse(eol) - Date.now()) / 864e5);
    expect(daysLeft,
      `Node ${major} reached end of life on ${eol} — it receives NO security `
      + 'patches. Bump engines.node in package.json.').toBeGreaterThan(0);
  });

  // Fails ahead of the date, so the migration is planned rather than urgent.
  it('has more than four months of support left', () => {
    const major = majorOf(pinned);
    const daysLeft = Math.floor((Date.parse(NODE_EOL[major]) - Date.now()) / 864e5);
    expect(daysLeft,
      `Node ${major} loses security support in ${daysLeft} days (${NODE_EOL[major]}). `
      + 'Plan the upgrade now rather than after it lapses.').toBeGreaterThan(WARN_DAYS);
  });

  // The failure that actually happened, asserted so the check cannot rot into
  // passing by looking at nothing.
  it('would have caught Node 20 in August 2026', () => {
    const daysLeft = Math.floor((Date.parse(NODE_EOL[20]) - Date.parse('2026-08-18')) / 864e5);
    expect(daysLeft).toBeLessThan(0);
  });
});
