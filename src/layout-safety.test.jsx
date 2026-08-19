// ─── layout-safety.test.jsx ──────────────────────────────────────────────────
// No table anywhere in the product may cut a column off the right edge.
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────────
// `UserTable` had `width: 100%` and no overflow container. It looked correct
// for months because the page happened to be wide enough. Then the sidebar
// took 232px away and the last three action buttons — Details, History,
// Reset PW — were cut off. Not greyed out, not wrapped: absent, with nothing
// on screen admitting it. The owner found it in a screenshot.
//
// A sweep for the same shape immediately found a second: HistoryModal, eight
// columns inside a modal narrower than the page, hiding "Reason" and "IP" on
// any laptop — sidebar or not, and for months before the sidebar existed.
//
// ── WHY IT PARSES INSTEAD OF GREPPING ──────────────────────────────────────
// The first version matched `overflowX: 'auto'` per FILE. That was wrong twice
// over: it flagged NotificationsTab and UsageTab, which were already correct by
// a different mechanism, and it would have passed a file where one of two
// tables was wrapped. Asserting a MECHANISM rather than the OUTCOME is how a
// test starts inventing work.
//
// This walks the real JSX tree and asks the only question that matters: does
// THIS table have an ancestor that can scroll, and is it allowed to stay wide
// enough for that scroll to engage? Inline styles and Tailwind classes both
// count — they achieve the same thing and neither is more correct.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Parser } from 'acorn';
import jsx from 'acorn-jsx';

const SRC = dirname(fileURLToPath(import.meta.url));
const JsxParser = Parser.extend(jsx());

function sourceFiles(dir = SRC, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { sourceFiles(p, out); continue; }
    if (p.endsWith('.jsx') && !p.includes('.test.')) out.push(p);
  }
  return out;
}

/** Text of a JSX attribute, however it is written — literal or expression. */
function attrText(node, name) {
  const a = (node.attributes || []).find(
    (x) => x.type === 'JSXAttribute' && x.name?.name === name);
  if (!a || !a.value) return '';
  if (a.value.type === 'Literal') return String(a.value.value);
  return a.raw ?? '';
}

/**
 * Module-level style constants that scroll — `const tableWrap = { overflowX: … }`.
 *
 * WITHOUT THIS the check reads only literal inline objects and reports every
 * `style={tableWrap}` as unprotected. It did exactly that on the first run:
 * four CostingTab tables flagged, all four correctly wrapped, the constant
 * declared ninety lines below them.
 *
 * That is the third time in one day a check of mine has been wrong ABOUT
 * WORKING CODE — always the same way, matching the shape I expected instead of
 * the effect that matters. A check that manufactures work is not a safety net;
 * it is a reason to stop reading the safety net.
 */
function scrollingStyleNames(src) {
  const names = new Set();
  for (const m of src.matchAll(/(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*\{([^}]*)\}/g)) {
    if (/overflowX:\s*['"](auto|scroll)['"]|overflow:\s*['"](auto|scroll)['"]/.test(m[2])) {
      names.add(m[1]);
    }
  }
  return names;
}

/** Can this element scroll sideways — by inline style, utility class, or a shared constant? */
function scrollsSideways(node, src, styleNames = new Set()) {
  const cls = attrText(node, 'className')
    || (node.attributes || [])
      .filter((x) => x.type === 'JSXAttribute' && x.name?.name === 'className')
      .map((x) => src.slice(x.start, x.end)).join(' ');
  if (/overflow-x-auto|overflow-x-scroll|\boverflow-auto\b|\boverflow-scroll\b/.test(cls)) return true;

  const styleAttr = (node.attributes || []).find(
    (x) => x.type === 'JSXAttribute' && x.name?.name === 'style');
  if (styleAttr) {
    const raw = src.slice(styleAttr.start, styleAttr.end);
    if (/overflowX:\s*['"](auto|scroll)['"]/.test(raw)) return true;
    if (/overflow:\s*['"](auto|scroll)['"]/.test(raw)) return true;
    // style={tableWrap} and style={{ ...tableWrap, maxWidth: 860 }}
    for (const n of styleNames) {
      if (new RegExp(`\\b${n}\\b`).test(raw)) return true;
    }
  }
  return false;
}

/** Is the table allowed to stay wider than its container, so scrolling engages? */
function holdsItsWidth(node, src) {
  const raw = src.slice(node.start, node.end);
  if (/minWidth:\s*\d/.test(raw)) return true;
  if (/\bmin-w-\[/.test(raw)) return true;
  return false;
}

/** Every <table> in a file, with the JSX elements enclosing it. */
function tablesWithAncestors(src) {
  const ast = JsxParser.parse(src, { ecmaVersion: 'latest', sourceType: 'module' });
  const found = [];
  const stack = [];
  (function walk(node) {
    if (!node || typeof node !== 'object') return;
    const isEl = node.type === 'JSXElement';
    if (isEl) {
      stack.push(node.openingElement);
      if (node.openingElement.name?.name === 'table') {
        found.push({ open: node.openingElement, ancestors: stack.slice(0, -1) });
      }
    }
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object' && v.type) walk(v);
    }
    if (isEl) stack.pop();
  }(ast));
  return found;
}

const FILES = sourceFiles();
const TABLES = FILES.flatMap((f) => {
  const src = readFileSync(f, 'utf8');
  if (!src.includes('<table')) return [];
  const styleNames = scrollingStyleNames(src);
  return tablesWithAncestors(src).map((t, i) => ({
    file: relative(SRC, f), index: i, src, styleNames, ...t,
  }));
});

describe('no table may hide a column', () => {
  // A sweep that silently matches nothing passes forever and protects nothing.
  it('actually finds the tables it claims to check', () => {
    expect(TABLES.length,
      'no <table> parsed out of src — this sweep is checking nothing'
    ).toBeGreaterThanOrEqual(10);
  });

  it.each(TABLES.map((t) => [`${t.file}#${t.index}`, t]))(
    '%s sits inside something that can scroll',
    (_name, t) => {
      const wrapped = t.ancestors.some((a) => scrollsSideways(a, t.src, t.styleNames));
      expect(wrapped,
        `${t.file}: this table has no scrollable ancestor. On a narrow window its `
        + 'right-hand columns are cut off and nothing on screen says so — which is how '
        + 'the Users table lost Details, History and Reset PW.'
      ).toBe(true);
    },
  );

  // A scroll container only helps if the table may stay wide. `width: 100%`
  // alone lets columns crush together until unreadable, and the scrollbar never
  // appears because nothing ever overflows.
  //
  // ── WHY THIS ONE IS CHECKED PER FILE, NOT PER TABLE ─────────────────────
  // Deliberately coarser than the ancestor check above, and the reason is not
  // laziness. Almost every table here styles its cells through file-scope
  // constants — `const td = { …, whiteSpace: 'nowrap' }` declared at the
  // BOTTOM of the file, far from the table that uses them. Reading only the
  // markup around each table flagged six files that were already correct.
  //
  // I made exactly that mistake this morning: asserted a MECHANISM near the
  // table rather than the OUTCOME anywhere in the file, and generated work
  // against working code. Resolving the constants properly would mean
  // evaluating the module, which is a lot of machinery to sharpen a check
  // whose loose form still catches the bug that started this.
  //
  // So: two ways to hold width — a minWidth, or cells that refuse to wrap —
  // and either one anywhere in the file counts.
  it.each([...new Set(TABLES.map((t) => t.file))].map((f) => [f, f]))(
    '%s keeps its tables wide enough for scrolling to engage',
    (_name, file) => {
      const src = TABLES.find((t) => t.file === file).src;
      const holds = /minWidth:\s*\d/.test(src)
        || /\bmin-w-\[/.test(src)
        || /whiteSpace:\s*['"]nowrap['"]/.test(src)
        || /whitespace-nowrap/.test(src);
      expect(holds,
        `${file}: neither a minWidth nor non-wrapping cells anywhere, so the columns `
        + 'compress into an unreadable mess before the scroll container ever engages.'
      ).toBe(true);
    },
  );
});
