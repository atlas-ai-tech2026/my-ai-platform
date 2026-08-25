// ─── edit-cut-gated.test.js ──────────────────────────────────────────────────
// NO route may put Voxel Edit Cut on screen without asking the flag first.
//
// ── WHY A SOURCE SWEEP AND NOT A RENDER TEST ───────────────────────────────
// The risk is not that today's two routes are wrong — they were just written
// and are tested. It is that a THIRD one arrives in a month, imports EditCut
// the obvious way, and nobody remembers there is a flag. That is precisely how
// /TimelinePreview came to exist: a scratch route that renders the whole
// editor with no sign-in at all, which would have been the one door left open
// on production while /edit itself was switched off.
//
// A render test proves the routes I know about. This proves the ones I do not.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = dirname(fileURLToPath(import.meta.url));

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) { walk(full, out); continue; }
    if (/\.(jsx?|tsx?)$/.test(entry) && !/\.test\./.test(entry)) out.push(full);
  }
  return out;
}

/** Files that RENDER EditCut — i.e. import the component itself, not the
 *  pieces it is built from. */
const renderers = walk(SRC).filter((f) => {
  const src = readFileSync(f, 'utf8');
  return /import\s+EditCut\s+from/.test(src);
});

describe('Edit Cut cannot reach a customer without the flag', () => {
  it('finds the files that render it — the sweep must not be silently empty', () => {
    // A matcher that stops matching would make every assertion below vacuous.
    expect(renderers.length, 'no file imports EditCut — has it been renamed?').toBeGreaterThan(0);
  });

  it('every one of them asks editCutVisible() first', () => {
    const ungated = renderers
      .filter((f) => !/editCutVisible/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(SRC, f));

    expect(
      ungated,
      `these render Voxel Edit Cut without checking the flag, so they would show it '
      + 'to every signed-in customer on voxel-ai.ai: ${ungated.join(', ')}`,
    ).toEqual([]);
  });

  it('the flag defaults to HIDDEN, so a new route fails safe', () => {
    // Re-stated here because it is the property the whole deploy rests on:
    // 91 commits ship together only because the unfinished half is off by
    // default rather than on by default.
    const flag = readFileSync(join(SRC, 'lib', 'edit-cut-flag.js'), 'utf8');
    expect(flag).toMatch(/DEV_HOSTS/);
    // The last statement decides the default. It must consult the host list,
    // never return a bare true.
    expect(flag).not.toMatch(/return\s+true;\s*\n\}/);
  });
});
