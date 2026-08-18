// ─── boot-order.test.js ──────────────────────────────────────────────────────
// A `const` is not hoisted. If a statement that runs AT MODULE LOAD references
// one declared further down the file, the server throws on boot — and
// `node --check` cannot see it, because the syntax is perfectly valid.
//
// This has now shipped twice:
//   · the duplicate-charge guard, declared below the routes that used it
//   · waitlistLimiter, declared ~900 lines below registerWaitlistRoutes()
// Both crashed the server on start with a completely green test suite.
//
// ESLint's no-use-before-define is the obvious tool and it is the WRONG one
// here: it also flags a const used inside a function body, which is safe
// because the function runs later. On this codebase that is 23 false positives
// and zero real bugs — a check that noisy gets switched off, and then it
// protects nothing.
//
// So this looks at exactly the dangerous case: TOP-LEVEL statements, which
// execute during import, referencing a top-level const declared after them.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const files = fs.readdirSync(DIR)
  .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'))
  .map((f) => ({ name: f, src: fs.readFileSync(path.join(DIR, f), 'utf8') }));

/** Strip strings, template literals and comments so their contents never read
 *  as identifiers — SQL is full of words that look like variable names. */
function blank(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length))
    .replace(/`(?:\\.|[^`\\])*`/gs, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/'(?:\\.|[^'\\])*'/g, (m) => ' '.repeat(m.length))
    .replace(/"(?:\\.|[^"\\])*"/g, (m) => ' '.repeat(m.length));
}

/** Top-level `const NAME =` declarations → line number. */
function topLevelConsts(lines) {
  const out = new Map();
  for (let i = 0; i < lines.length; i++) {
    const m = /^(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=/.exec(lines[i]);
    if (m && !out.has(m[1])) out.set(m[1], i);
  }
  return out;
}

/**
 * Statements that RUN at import time: a top-level line that is a call or a
 * member call, not a declaration. Spans until brackets balance, so arguments
 * on indented continuation lines belong to the statement that opened them.
 */
function topLevelStatements(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/^[A-Za-z_$][\w$.]*\s*\(/.test(line)) continue;   // not a top-level call
    if (/^(?:const|let|var|function|class|import|export)\b/.test(line)) continue;
    let depth = 0, text = '', j = i;
    do {
      text += lines[j] + '\n';
      for (const ch of lines[j]) {
        if ('([{'.includes(ch)) depth++;
        else if (')]}'.includes(ch)) depth--;
      }
      j++;
    } while (depth > 0 && j < lines.length);
    out.push({ start: i, end: j - 1, text });
    i = j - 1;
  }
  return out;
}

describe('nothing runs at import time that is declared later', () => {
  it('found the server sources to scan', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('every top-level statement only uses names already declared', () => {
    const offenders = [];
    for (const { name, src } of files) {
      const lines = blank(src).split('\n');
      const decls = topLevelConsts(lines);
      for (const stmt of topLevelStatements(lines)) {
        const used = new Set(stmt.text.match(/[A-Za-z_$][\w$]*/g) || []);
        for (const id of used) {
          const declLine = decls.get(id);
          if (declLine !== undefined && declLine > stmt.end) {
            offenders.push(`${name}:${stmt.start + 1} uses "${id}", declared at line ${declLine + 1}`);
          }
        }
      }
    }
    expect(offenders,
      'a const is NOT hoisted — these would throw at boot, and `node --check` '
      + 'cannot see it:\n' + offenders.join('\n')).toEqual([]);
  });

  // Proves the scan can see the real thing, so green means "nothing found"
  // rather than "the matcher never matched".
  it('would catch the exact bug that shipped', () => {
    const bad = [
      'registerWaitlistRoutes(app, {',
      '  pool, dbReady, adminGate, limiter: waitlistLimiter,',
      '});',
      'const waitlistLimiter = rateLimit({ max: 10 });',
    ];
    const decls = topLevelConsts(bad);
    const found = topLevelStatements(bad).flatMap((s) =>
      [...new Set(s.text.match(/[A-Za-z_$][\w$]*/g) || [])]
        .filter((id) => decls.get(id) !== undefined && decls.get(id) > s.end));
    expect(found).toEqual(['waitlistLimiter']);
  });

  it('does not flag a const used inside a function body', () => {
    const ok = [
      'function later() { return helper(); }',
      'const helper = () => 1;',
    ];
    const decls = topLevelConsts(ok);
    const found = topLevelStatements(ok).flatMap((s) =>
      [...new Set(s.text.match(/[A-Za-z_$][\w$]*/g) || [])]
        .filter((id) => decls.get(id) !== undefined && decls.get(id) > s.end));
    expect(found).toEqual([]);
  });
});
