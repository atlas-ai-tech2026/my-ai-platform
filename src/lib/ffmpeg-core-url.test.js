// ─── ffmpeg-core-url.test.js ─────────────────────────────────────────────────
// How the ffmpeg core is addressed is a two-environment problem that broke in
// production while every test passed and localhost worked perfectly.
//
// WHAT HAPPENED, 2026-08-23. The loader handed ffmpeg a blob: URL, because the
// Vite dev server rewrites the plain path and refuses to serve it. On the
// deployed site there is no Vite — but there IS a Content-Security-Policy, and
// script-src is 'self' 'wasm-unsafe-eval'. The worker's import() of a blob:
// URL was refused, and export failed for every customer.
//
// The two environments fail in OPPOSITE directions, so neither one alone can
// tell you the answer, and the error messages are IDENTICAL — both say "Failed
// to fetch dynamically imported module". The dev fix looks exactly like the dev
// bug.
//
// Nothing catches this except running it where the CSP is real, so these tests
// pin the two decisions that came out of it. They read source text, in the
// style of the no-undef guard in lint-clean.test.js, because the thing worth
// protecting is a DECISION rather than a return value.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('the ffmpeg core URL', () => {
  const code = stripComments(read('src/lib/edit-exec-browser.js'));

  it('only uses blob: URLs under the dev server', () => {
    // An unconditional toBlobURL is the exact regression: it works on
    // localhost, passes every test, and breaks export on the deployed site.
    expect(code, 'toBlobURL is no longer used at all — if that is deliberate, delete this test')
      .toMatch(/toBlobURL/);
    expect(code, 'toBlobURL must be reached only when import.meta.env.DEV is true')
      .toMatch(/import\.meta\.env\??\.DEV[\s\S]{0,400}toBlobURL/);
  });

  it('falls back to a same-origin path, not a CDN', () => {
    // 'self' covers our own origin and nothing else. A CDN here would need a
    // new CSP entry, which is the thing this whole file exists to avoid.
    expect(code).toMatch(/\$\{CORE_BASE\}\/ffmpeg-core\.js/);
    expect(code).not.toMatch(/https?:\/\/(unpkg|cdn|jsdelivr)/i);
  });
});

describe('the CSP was not widened to make this work', () => {
  // Deliberately NOT comment-stripped. index.js contains a `/*` that pairs
  // with a distant `*/`, so a naive block-comment strip swallows the whole
  // Helmet config and leaves this guard matching an empty string — silently
  // passing forever. Caught by the "finds the directive at all" test below,
  // which is why that test is here rather than being obvious padding.
  //
  // Stripping is unnecessary anyway: the match is on the literal
  // `scriptSrc: [ ... ]` array, and the assertion only ever sees what is
  // inside those brackets.
  const server = read('server/src/index.js');
  const scriptSrc = server.match(/scriptSrc:\s*\[([^\]]*)\]/)?.[1] || '';

  it('finds the scriptSrc directive at all', () => {
    expect(scriptSrc, 'scriptSrc could not be located — this guard is now blind').not.toBe('');
  });

  it('has no blob: in script-src', () => {
    // The one-line "fix" for the failure above was to add blob: here. It was
    // refused: blob: in script-src is a standard way to turn a small injection
    // into arbitrary script execution, and it would widen the policy for the
    // WHOLE site to save a branch in one file.
    expect(scriptSrc, 'blob: in script-src widens the whole site to avoid one branch in edit-exec-browser.js')
      .not.toMatch(/blob:/);
  });

  it("still has 'wasm-unsafe-eval', or the engine cannot start at all", () => {
    expect(scriptSrc).toMatch(/wasm-unsafe-eval/);
  });
});
