#!/usr/bin/env node
// ─── copy-onnx-runtime.mjs ───────────────────────────────────────────────────
// Put the ONNX Runtime WebAssembly binaries where our own origin can serve
// them. The direct sibling of copy-ffmpeg-core.mjs, for the same reason.
//
// ── WHY NOT THE CDN, WHICH IS WHAT EVERY EXAMPLE DOES ──────────────────────
// transformers.js defaults to fetching these from jsDelivr. The site runs a
// real Content-Security-Policy whose connectSrc lists 'self', blob:, data: and
// a short set of media hosts. jsDelivr is not on it and must not be — adding a
// public CDN would mean anything published there could execute inside a
// signed-in customer's session, which is exactly what the July audit closed.
//
// This is also the failure that is IMPOSSIBLE TO SEE LOCALLY. Vite's dev
// server sends no CSP at all, so a build that fetches from a CDN works
// perfectly on this laptop and is refused for every real user. That has
// already happened once on this project, to Export. Not again.
//
// ── WHY COPIED RATHER THAN BUNDLED ─────────────────────────────────────────
// These are 12–25 MB binaries. Through the bundler they would slow every build
// and could land in a chunk downloaded by people who never dictate anything.
// public/ is copied verbatim by Vite, so they stay static files fetched only
// when somebody actually presses the microphone.
//
// ── AND WHY NOT IN GIT ─────────────────────────────────────────────────────
// 37 MB paid for on every clone, forever, when package-lock.json already pins
// the version. Generated at install and build time; public/onnx/ is gitignored.

import { mkdirSync, copyFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'node_modules', 'onnxruntime-web', 'dist');
const to = join(root, 'public', 'onnx');

// ── BOTH BACKENDS, and the choice is made in the browser ───────────────────
// `.jsep` is the WebGPU build: far faster where a machine has a usable GPU,
// and 25 MB. The plain build is CPU WebAssembly, 12 MB, and works everywhere.
// onnxruntime picks at run time and fetches ONLY the one it picks — so
// shipping both costs disk on the server and nothing on the wire.
//
// NOTE the threading: these are the "-threaded" builds, but real threads need
// SharedArrayBuffer, which needs cross-origin isolation (COOP + COEP). We
// cannot turn that on — it would break every cross-origin thing the site
// embeds, including customers' own media from Spaces. Same trade already
// documented for ffmpeg-core-mt. So these run SINGLE-THREADED, and that is a
// real part of why transcription is slower than it looks in benchmarks.
const FILES = [
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.jsep.mjs',
  'ort-wasm-simd-threaded.jsep.wasm',
];

if (!existsSync(from)) {
  // Not fatal, for the same reason as ffmpeg: a lint-only CI job or a fresh
  // clone should not be stopped. But silence would surface later as a
  // microphone that fails on first click with no explanation.
  console.warn('[onnx-runtime] onnxruntime-web is not installed — skipping copy.');
  console.warn('[onnx-runtime] Speech-to-text will not run until `npm install` has been run.');
  process.exit(0);
}

mkdirSync(to, { recursive: true });

let total = 0;
for (const file of FILES) {
  const src = join(from, file);
  if (!existsSync(src)) {
    console.error(`[onnx-runtime] MISSING: ${src}`);
    console.error('[onnx-runtime] Failing the build rather than shipping a microphone that');
    console.error('[onnx-runtime] breaks on first click.');
    process.exit(1);
  }
  copyFileSync(src, join(to, file));
  total += statSync(src).size;
}

console.log(`[onnx-runtime] ${FILES.length} files → public/onnx/ `
  + `(${(total / 1048576).toFixed(1)} MB on disk; a browser fetches ONE of the two `
  + 'binaries, ~3.1 MB gzipped for CPU or ~5.8 MB for WebGPU)');
