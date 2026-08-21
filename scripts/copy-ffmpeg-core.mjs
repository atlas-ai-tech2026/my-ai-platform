#!/usr/bin/env node
// ─── copy-ffmpeg-core.mjs ────────────────────────────────────────────────────
// Put the ffmpeg WebAssembly binary somewhere our own origin can serve it.
//
// ── WHY NOT A CDN, WHICH IS WHAT EVERY EXAMPLE DOES ────────────────────────
// The ffmpeg.wasm docs load the core from unpkg. That cannot work here: the
// site runs a real Content-Security-Policy, and `connectSrc` lists 'self',
// blob:, data: and a short set of media hosts. unpkg is not on it and must not
// be — the CSP is one of the July audit's outcomes, and widening it to a public
// CDN would mean anything published there could execute inside a signed-in
// customer's session.
//
// So the binary is copied out of node_modules and served from our own origin,
// where the existing 'self' rule already covers it and nothing has to be
// loosened.
//
// ── WHY IT IS COPIED RATHER THAN IMPORTED ──────────────────────────────────
// The .wasm is 32 MB. Putting it through the bundler would slow every build and
// risk it landing in the main chunk, where it would be downloaded by every
// visitor to the home page — including the ones who never open the editor.
// public/ is copied verbatim by Vite, so the file stays a plain static asset
// that is fetched only when an edit actually runs.
//
// ── AND WHY IT IS NOT IN GIT ───────────────────────────────────────────────
// A 32 MB binary in the repository would be paid for on every clone, forever,
// and it is already pinned in package-lock.json. It is generated at install and
// build time instead, and public/ffmpeg/ is gitignored.

import { mkdirSync, copyFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// ── esm, NOT umd — and the difference is not cosmetic ──────────────────────
// @ffmpeg/ffmpeg creates its worker with `type: "module"`. Its loader tries
// importScripts() first and falls back to a dynamic import():
//
//     try { importScripts(coreURL); }          // classic worker
//     catch { (await import(coreURL)).default } // module worker  ← ours
//
// importScripts does not exist in a module worker, so the catch ALWAYS runs.
// Handed the UMD build, that import() succeeds but yields a module with no
// default export, and ffmpeg reports "failed to import ffmpeg-core.js" — a
// file that fetches with HTTP 200 and the right byte count.
//
// The esm build ends in `export default createFFmpegCore`, which is exactly
// what that line reads. Chosen by looking at the library's loader on
// 2026-08-21, after the umd build failed in a real browser.
const from = join(root, 'node_modules', '@ffmpeg', 'core', 'dist', 'esm');
const to = join(root, 'public', 'ffmpeg');

// The single-threaded core, deliberately.
//
// The multi-threaded build (@ffmpeg/core-mt) is faster, but it needs
// SharedArrayBuffer, which needs cross-origin isolation (COOP + COEP). Turning
// that on would break every cross-origin resource the site embeds — the
// customer's own media served from DigitalOcean Spaces, and the Clarity tag.
// Paying for a faster render with a site that cannot show anyone their own
// videos is not a trade worth making.
const FILES = ['ffmpeg-core.js', 'ffmpeg-core.wasm'];

if (!existsSync(from)) {
  // Not fatal. A developer who has not installed dependencies yet, or a CI job
  // that only lints, should not be stopped by this — but silence here would
  // surface later as an editor that fails to start with no explanation, so it
  // says exactly what is missing.
  console.warn('[ffmpeg-core] @ffmpeg/core is not installed — skipping copy.');
  console.warn('[ffmpeg-core] The editor will not run until `npm install` has been run.');
  process.exit(0);
}

mkdirSync(to, { recursive: true });

let total = 0;
for (const file of FILES) {
  const src = join(from, file);
  if (!existsSync(src)) {
    console.error(`[ffmpeg-core] MISSING: ${src}`);
    console.error('[ffmpeg-core] The editor cannot run without it. Failing the build rather');
    console.error('[ffmpeg-core] than shipping an /edit page that breaks on first click.');
    process.exit(1);
  }
  copyFileSync(src, join(to, file));
  total += statSync(src).size;
}

console.log(`[ffmpeg-core] ${FILES.length} files → public/ffmpeg/ `
  + `(${(total / 1048576).toFixed(1)} MB, ~9.8 MB gzipped over the wire)`);
