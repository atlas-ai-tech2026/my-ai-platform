// ─── every-import-resolves.test.js ───────────────────────────────────────────
// ☠ 4,848 TESTS PASSED AND THE SERVER WOULD NOT START.
//
// On 2026-09-04 I created server/src/credit-backfill.js — a file that ALREADY
// EXISTED. `cat >` overwrote 92 lines belonging to the credit-lots system,
// taking `planBackfill` and `CREDIT_LIFE_DAYS` with it. The whole suite went
// green, lint was clean, and dev died on boot:
//
//     import { planBackfill, CREDIT_LIFE_DAYS } from './credit-backfill.js';
//     SyntaxError: The requested module './credit-backfill.js'
//                  does not provide an export named 'CREDIT_LIFE_DAYS'
//     ERROR component terminated with non-zero exit code: 1
//
// DigitalOcean rolled back to the previous image, so dev kept serving old
// code while I believed the new code was live. The owner had already approved
// a production deploy. Only the rule "dev before main" stopped it shipping.
//
// ── WHY NOTHING CAUGHT IT ──────────────────────────────────────────────────
// Node resolves named exports when it INSTANTIATES a module. No test imported
// credit-lots-db.js, so nothing ever asked. Unit tests prove the pieces work;
// none of them proves the program can start. That is RULE 2 in CLAUDE.md in
// its purest form — a passing test on the piece you built says nothing about
// whether anyone can see the result.
//
// This check reads every `import { … } from './x.js'` in the server and
// confirms x.js actually exports those names. Static, so it costs nothing and
// starts no servers, and it fails on the exact thing that reached deploy.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = __dirname;
const files = readdirSync(DIR).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'));

/** Names a module exports, in every form this codebase uses. */
function exportsOf(src) {
  const names = new Set();
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of src.matchAll(/export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  // export { a, b as c }  — with or without a `from`
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const as = part.split(/\bas\b/);
      const name = (as[1] ?? as[0]).trim();
      if (name) names.add(name);
    }
  }
  if (/export\s+default/.test(src)) names.add('default');
  // A star re-export can supply anything; treat the module as unknowable
  // rather than claim a name is missing.
  if (/export\s*\*\s*from/.test(src)) names.add('*');
  return names;
}

/**
 * Every `import { a, b } from './x.js'` in a file.
 *
 * ☠ COMMENTS LIVE INSIDE IMPORT BRACES IN THIS CODEBASE, and the first version
 * of this parser read them as names — reporting that download-guard.js "does
 * not export '// N10: the character-element route reuses…'". Same mistake as
 * the <Router> regex and the LOWER(email) one: a check that reads prose is not
 * reading the program. Comments are stripped before the names are split.
 */
function namedImports(src) {
  const out = [];
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'(\.[^']+)'/g)) {
    const body = m[1]
      .replace(/\/\*[\s\S]*?\*\//g, ' ')     // block comments
      .replace(/\/\/[^\n]*/g, ' ');            // line comments
    const names = body.split(',')
      .map((p) => p.split(/\bas\b/)[0].trim())
      .filter((n) => /^[A-Za-z_$][\w$]*$/.test(n));   // a real identifier, nothing else
    out.push({ from: m[2], names });
  }
  return out;
}

const exportCache = new Map();
function exportsFor(rel) {
  if (!exportCache.has(rel)) {
    const file = rel.replace(/^\.\//, '');
    try { exportCache.set(rel, exportsOf(readFileSync(join(DIR, file), 'utf8'))); }
    catch { exportCache.set(rel, null); }          // module missing entirely
  }
  return exportCache.get(rel);
}

describe('☠ EVERY IMPORT THE SERVER MAKES MUST RESOLVE', () => {
  const work = files.map((f) => [f, namedImports(readFileSync(join(DIR, f), 'utf8'))])
    .filter(([, imps]) => imps.length);

  it('found imports to check — a check over nothing is not a check', () => {
    expect(work.length).toBeGreaterThan(10);
  });

  it.each(work)('%s', (file, imports) => {
    const broken = [];
    for (const { from, names } of imports) {
      const have = exportsFor(from);
      if (have === null) { broken.push(`${from} — no such module`); continue; }
      if (have.has('*')) continue;                 // star re-export, unknowable
      for (const n of names) {
        if (!have.has(n)) broken.push(`${from} does not export '${n}'`);
      }
    }
    expect(broken,
      `${file} imports names that do not exist. Node resolves these when it starts, so this is `
      + `a server that will not boot — exactly how dev died on 2026-09-04 with the whole test `
      + `suite green.`).toEqual([]);
  });
});

describe('and the specific collision that caused it', () => {
  it('☠ credit-backfill.js still exports what credit-lots-db.js needs', () => {
    const have = exportsFor('./credit-backfill.js');
    expect(have, 'credit-backfill.js has been deleted or renamed').not.toBeNull();
    expect(have.has('planBackfill')).toBe(true);
    expect(have.has('CREDIT_LIFE_DAYS')).toBe(true);
  });

  it('and the source-classifier lives under its own name, not on top of it', () => {
    const mine = exportsFor('./credit-source-backfill.js');
    expect(mine, 'the source classifier is missing').not.toBeNull();
    expect(mine.has('classifyRow')).toBe(true);
    expect(mine.has('previewBackfill')).toBe(true);
    // and it has NOT absorbed the other module's job
    expect(mine.has('planBackfill')).toBe(false);
  });
});
