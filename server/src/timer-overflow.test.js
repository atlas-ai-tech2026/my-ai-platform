// ─── timer-overflow.test.js ──────────────────────────────────────────────────
// setTimeout and setInterval take a 32-bit SIGNED delay. Anything above
// 2,147,483,647 ms (~24.8 days) does not fit, and Node does not throw — it
// silently sets the delay to 1 ms.
//
// This is not hypothetical. On 2026-08-17 the backup restore verification
// shipped with `setInterval(run, 30 * 24 * 60 * 60 * 1000)`, intending monthly.
// 30 days is 2,592,000,000 ms. It ran 294 times in five seconds against the
// offsite backup bucket and exhausted the provider's download cap before the
// logs made it obvious. Every test passed; the schedule was never the thing
// under test.
//
// So the guard is a source sweep, not a unit test: it reads the real server
// files and fails on any timer whose delay is a literal arithmetic expression
// exceeding the limit. Long schedules must be driven by a short tick that
// checks elapsed time — which is more correct anyway, since a timer set for
// weeks away dies with the next deploy.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const MAX_DELAY = 2 ** 31 - 1;

const files = fs.readdirSync(DIR)
  .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'))
  .map((f) => ({ name: f, src: fs.readFileSync(path.join(DIR, f), 'utf8') }));

/** Multiplication chains of number literals, e.g. `30 * 24 * 60 * 60 * 1000`. */
const NUMERIC_CHAIN = /(?:^|[^\w.])((?:\d[\d_]*\s*\*\s*)+\d[\d_]*)/g;

/**
 * Everything between a timer's opening paren and its matching close.
 *
 * A non-greedy regex is NOT enough here and the self-check below proves it:
 * `setInterval(() => { run(); }, 30 * 24 * 60 * 60 * 1000)` makes it stop at
 * the `)` of `run()`, capturing a fragment with no numbers in it — a sweep
 * that reports "all clear" because it never looked. Counting depth is the
 * only version that reads the argument that actually matters.
 */
function timerArgs(src) {
  const out = [];
  const re = /\bset(?:Timeout|Interval)\s*\(/g;
  let m;
  while ((m = re.exec(src))) {
    const start = m.index + m[0].length;
    let i = start, depth = 1;
    while (i < src.length && depth > 0) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')') depth--;
      i++;
    }
    out.push(src.slice(start, i - 1));
  }
  return out;
}

/** Product of a `a * b * c` literal chain. Only digits and `*` are involved. */
const chainMs = (expr) => expr.replace(/_/g, '').split('*')
  .reduce((a, b) => a * Number(b.trim()), 1);

describe('no timer delay overflows a 32-bit signed integer', () => {
  it('found the server sources to scan', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('every literal delay is under ~24.8 days', () => {
    const offenders = [];
    for (const { name, src } of files) {
      for (const args of timerArgs(src)) {
        for (const chain of args.matchAll(NUMERIC_CHAIN)) {
          const ms = chainMs(chain[1]);
          if (ms > MAX_DELAY) offenders.push(`${name}: ${chain[1]} = ${ms}ms (limit ${MAX_DELAY})`);
        }
      }
    }
    expect(offenders,
      'Node coerces an out-of-range delay to 1ms — drive long schedules from a '
      + 'short tick that checks elapsed time instead:\n' + offenders.join('\n'))
      .toEqual([]);
  });

  // Proves the sweep can actually SEE an offender. Without this, a green run
  // means only "the matcher found nothing", which is what the first version of
  // this file did — it passed while blind.
  it('would catch the exact bug that shipped', () => {
    const bad = 'setInterval(() => { run(); }, 30 * 24 * 60 * 60 * 1000).unref?.();';
    const found = timerArgs(bad)
      .flatMap((a) => [...a.matchAll(NUMERIC_CHAIN)].map((c) => chainMs(c[1])))
      .filter((ms) => ms > MAX_DELAY);
    expect(found).toEqual([2592000000]);
  });

  it('does not flag ordinary short delays', () => {
    const ok = 'setInterval(tick, 60 * 60 * 1000); setTimeout(run, 5 * 60 * 1000);';
    const found = timerArgs(ok)
      .flatMap((a) => [...a.matchAll(NUMERIC_CHAIN)].map((c) => chainMs(c[1])))
      .filter((ms) => ms > MAX_DELAY);
    expect(found).toEqual([]);
  });
});
