// ─── boot-order.test.js ──────────────────────────────────────────────────────
// A `const` is not hoisted. If a statement that runs AT MODULE LOAD references
// one declared further down the file, the server throws on boot — and
// `node --check` cannot see it, because the syntax is perfectly valid.
//
// This has shipped twice:
//   · the duplicate-charge guard, declared below the routes that used it
//   · waitlistLimiter, declared ~900 lines below the registration using it
// Both crashed the server on start with a completely green test suite.
//
// ── WHY THIS FILE USES A REAL PARSER ────────────────────────────────────────
// The first version of this test blanked comments and strings with regexes and
// then scanned lines. On index.js that removed TWO THIRDS OF THE FILE — the
// top-level `const` count fell from 73 to 24 — so it reported "all clear"
// because it could no longer see anything. It passed while blind, which is
// worse than not existing: it was evidence of safety that had checked nothing.
//
// That is the third time in one day that regex-parsing JavaScript produced a
// confidently wrong answer here. acorn is already a dependency; scanning a
// 6,300-line file by hand-rolled pattern was never the right tool.
//
// ── WHY NOT ESLint's no-use-before-define ───────────────────────────────────
// It also flags a const used INSIDE a function body, which is safe because the
// function runs later. On this codebase that is 23 false positives and zero
// real bugs — and a check that noisy gets switched off, after which it protects
// nothing. The AST walk below deliberately does NOT descend into function
// bodies, so it sees only what actually executes at import time.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const FILES = fs.readdirSync(DIR)
  .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'));

const parse = (src) =>
  acorn.parse(src, { ecmaVersion: 2022, sourceType: 'module', locations: true });

/** Nodes whose bodies are DEFERRED — they run when called, not at import. */
const DEFERS = new Set([
  'FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression',
  'ClassBody', 'MethodDefinition',
]);

/**
 * Identifier references reachable at module-evaluation time from `node`,
 * NOT descending into anything deferred.
 */
function eagerRefs(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) { for (const n of node) eagerRefs(n, out); return out; }
  if (!node.type) return out;
  if (DEFERS.has(node.type)) return out;                 // body runs later — safe
  if (node.type === 'Identifier') { out.push(node); return out; }
  if (node.type === 'MemberExpression' && !node.computed) {
    eagerRefs(node.object, out);                          // `a.b` only references `a`
    return out;
  }
  if (node.type === 'Property' && !node.computed) {
    eagerRefs(node.value, out);                           // `{ key: value }` — key is not a ref
    return out;
  }
  for (const k of Object.keys(node)) {
    if (k === 'type' || k === 'loc' || k === 'start' || k === 'end') continue;
    eagerRefs(node[k], out);
  }
  return out;
}

/** Every top-level `const`/`let` binding name → the line it is declared on. */
function topLevelBindings(program) {
  const decls = new Map();
  for (const node of program.body) {
    if (node.type !== 'VariableDeclaration') continue;
    if (node.kind === 'var') continue;                    // var IS hoisted
    for (const d of node.declarations) {
      const stack = [d.id];
      while (stack.length) {
        const id = stack.pop();
        if (!id) continue;
        if (id.type === 'Identifier') decls.set(id.name, node.loc.start.line);
        else if (id.type === 'ObjectPattern') stack.push(...id.properties.map((p) => p.value || p.argument));
        else if (id.type === 'ArrayPattern') stack.push(...id.elements);
        else if (id.type === 'RestElement') stack.push(id.argument);
        else if (id.type === 'AssignmentPattern') stack.push(id.left);
      }
    }
  }
  return decls;
}

function offendersIn(src, name) {
  const program = parse(src);
  const decls = topLevelBindings(program);
  const found = [];
  for (const node of program.body) {
    // Only statements that EXECUTE during import.
    if (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') continue;
    if (node.type.startsWith('Import') || node.type.startsWith('Export')) continue;
    for (const ref of eagerRefs(node)) {
      const declLine = decls.get(ref.name);
      if (declLine !== undefined && declLine > ref.loc.start.line) {
        found.push(`${name}:${ref.loc.start.line} uses "${ref.name}", declared at line ${declLine}`);
      }
    }
  }
  return found;
}

describe('nothing that runs at import time is declared later', () => {
  it('parses every server source — a file it cannot read is not a file it approves', () => {
    for (const f of FILES) {
      const src = fs.readFileSync(path.join(DIR, f), 'utf8');
      expect(() => parse(src), `${f} failed to parse`).not.toThrow();
    }
    expect(FILES.length).toBeGreaterThan(10);
  });

  // The previous version of this test blanked strings with regexes and went
  // blind on index.js. Proving the parser still SEES the file is the guard
  // against a green result that means "found nothing to look at".
  it('actually sees index.js — 60+ top-level bindings, not a handful', () => {
    const program = parse(fs.readFileSync(path.join(DIR, 'index.js'), 'utf8'));
    expect(topLevelBindings(program).size).toBeGreaterThan(60);
  });

  it('every top-level statement only uses names already declared', () => {
    const offenders = FILES.flatMap((f) =>
      offendersIn(fs.readFileSync(path.join(DIR, f), 'utf8'), f));
    expect(offenders,
      'a const is NOT hoisted — these throw at boot, and `node --check` cannot '
      + 'see them:\n' + offenders.join('\n')).toEqual([]);
  });

  it('catches the exact bug that shipped', () => {
    const bad = `
      registerWaitlistRoutes(app, { limiter: waitlistLimiter });
      const waitlistLimiter = rateLimit({ max: 10 });
    `;
    expect(offendersIn(bad, 'x.js')).toHaveLength(1);
  });

  it('does NOT flag a const used inside a function body, which runs later', () => {
    const ok = `
      function later() { return helper(); }
      register(app, { get: () => helper() });
      const helper = () => 1;
      const register = () => {};
    `;
    // `register` IS used before declaration and must be caught; `helper` inside
    // the arrow and the function body must not be.
    const found = offendersIn(ok, 'x.js');
    expect(found.join(' ')).toMatch(/register/);
    expect(found.join(' ')).not.toMatch(/helper/);
  });

  it('does not mistake an object KEY for a reference', () => {
    expect(offendersIn('run({ pool: 1 });\nconst pool = 2;', 'x.js')).toEqual([]);
  });
});
