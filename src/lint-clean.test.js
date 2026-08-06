// ─── lint-clean.test.js ──────────────────────────────────────────────────────
// `npm run lint` must report ZERO errors.
//
// WHY THIS IS A TEST. Until 2026-08-07 lint reported 90 errors — 74 unused
// imports and 16 hooks warnings against unreachable code in Studio.jsx. None of
// them was harmful, and that was exactly the problem: because the command
// always failed, nobody ran it, and a genuinely dangerous misconfiguration hid
// in plain sight for as long as it took to notice.
//
// The misconfiguration was that eslint.config.js spreads
// pluginJs.configs.recommended (which contains no-undef) and then defines its
// own `rules` object, replacing it. So no-undef — the one rule that catches a
// variable used in JSX but never declared — was silently off. That is a blank
// screen at runtime, and neither `npm run build` (Vite bundles, it does not
// resolve identifiers) nor the test suite detects it. One reached the Gift
// Cards tab before this was found.
//
// A linter at 90 errors tells you nothing. At zero, the next real error is
// impossible to miss — so this test keeps it at zero.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function lintErrors() {
  let out;
  try {
    out = execFileSync('npx', ['eslint', '.', '-f', 'json'],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    // eslint exits non-zero when it finds problems; the JSON is still on stdout.
    out = e.stdout || '';
  }
  if (!out.trim()) return [];
  return JSON.parse(out).flatMap((file) =>
    file.messages
      .filter((m) => m.severity === 2)          // errors only; warnings are advisory
      .map((m) => `${path.relative(ROOT, file.filePath)}:${m.line}  ${m.ruleId}  ${m.message}`));
}

describe('the codebase lints clean', () => {
  it('reports zero eslint errors', () => {
    const errors = lintErrors();
    expect(
      errors,
      `eslint found ${errors.length} error(s):\n${errors.slice(0, 40).join('\n')}` +
      (errors.length > 40 ? `\n…and ${errors.length - 40} more` : ''),
    ).toEqual([]);
  }, 120_000);

  // Guards the guard: if someone removes no-undef from the config again, this
  // fails even though the codebase itself is clean.
  it('still has no-undef switched on', async () => {
    const config = await import('node:fs').then((fs) =>
      fs.readFileSync(path.join(ROOT, 'eslint.config.js'), 'utf8'));
    // Strip comments so the explanation ABOVE the rule cannot satisfy the test.
    const code = config.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).toMatch(/["']no-undef["']\s*:\s*["']error["']/);
  });
});
