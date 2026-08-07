// ─── api-contract.test.js ────────────────────────────────────────────────────
// Every `adminApi.<method>` any admin component calls must EXIST on the real
// adminApi module.
//
// WHY. On 2026-08-07 a cherry-pick conflict was resolved by taking dev's
// AdminGuard wholesale. Dev's guard calls adminApi.me() — an N3 method that is
// part of the held-back security batch and does NOT exist on production's
// adminApi. Result: `TypeError: adminApi.me is not a function` the moment the
// panel route rendered, React unmounted the tree, and every visitor to the
// control panel — signed in or not — got a pure black screen.
//
// Nothing caught it:
//   • the component tests MOCK adminApi, and the mock had me()
//   • eslint ignores src/lib and cannot see cross-module properties anyway
//   • bundle greps check that strings exist, not that calls resolve
//
// This test closes the hole by construction: it greps the real component
// sources for adminApi.<method> and asserts each one against the real,
// UNMOCKED module. A guard from one branch paired with a lib from another now
// fails here, at commit time, instead of on production.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adminApi } from '@/lib/adminApi';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DIR, '../../..');
const FILES = [
  ...fs.readdirSync(DIR).filter((f) => f.endsWith('.jsx') && !f.includes('.test.')).map((f) => path.join(DIR, f)),
  path.join(ROOT, 'src/pages/AdminPanel.jsx'),
];

function methodsUsed(file) {
  const src = fs.readFileSync(file, 'utf8');
  return [...new Set([...src.matchAll(/adminApi\.([a-zA-Z0-9_]+)\s*\(/g)].map((m) => m[1]))];
}

describe('every adminApi method the CRM calls exists on the real module', () => {
  it('finds the files and real methods to check', () => {
    expect(FILES.length).toBeGreaterThan(10);
    expect(Object.keys(adminApi).length).toBeGreaterThan(10);
  });

  it.each(FILES.map((f) => [path.basename(f), f]))('%s', (_name, file) => {
    const used = methodsUsed(file);
    const missing = used.filter((m) => typeof adminApi[m] !== 'function');
    expect(
      missing,
      `${path.basename(file)} calls adminApi.${missing.join('/, adminApi.')}() ` +
      `which does NOT exist in src/lib/adminApi.js on THIS branch — this is the ` +
      `exact shape of the 2026-08-07 production black screen`,
    ).toEqual([]);
  });
});
