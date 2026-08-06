// ─── no-undef.test.js ────────────────────────────────────────────────────────
// Every admin component must only use variables that exist.
//
// WHY THIS IS A TEST AND NOT JUST A LINT SCRIPT. On 2026-08-07 an edit left
// `missCount` and `missCredits` used in GiftCardsTab's JSX but never declared.
// A variable that does not exist throws a ReferenceError the moment React
// renders the component — the Gift Cards tab would have gone completely blank,
// the same failure mode as the AdminGuard black screen.
//
// Nothing caught it:
//   • `npm run build` succeeded — Vite bundles, it does not resolve identifiers
//   • the whole test suite passed — no test renders GiftCardsTab
//   • `npm run lint` did not flag it — eslint.config.js spreads
//     pluginJs.configs.recommended (which contains no-undef) and then defines
//     its own `rules` object, which REPLACES it. no-undef was silently absent.
//
// no-undef is now enabled explicitly in eslint.config.js, and this test runs it
// over the admin screens so it fails in `npm test` rather than in a lint
// command that already reports 90 pre-existing errors and so never gets run.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DIR, '../../..');

const files = fs.readdirSync(DIR)
  .filter((f) => /\.jsx$/.test(f) && !f.includes('.test.'))
  .sort();

/** Run eslint over the admin folder and return only its no-undef messages. */
function undefinedVariables() {
  let out;
  try {
    out = execFileSync(
      'npx',
      ['eslint', 'src/components/admin', 'src/pages/AdminPanel.jsx', '-f', 'json'],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
  } catch (e) {
    // eslint exits non-zero when it finds problems; the JSON is still on stdout.
    out = e.stdout || '';
  }
  if (!out.trim()) return [];
  const results = JSON.parse(out);
  const hits = [];
  for (const file of results) {
    for (const m of file.messages) {
      if (m.ruleId === 'no-undef') {
        hits.push(`${path.relative(ROOT, file.filePath)}:${m.line} ${m.message}`);
      }
    }
  }
  return hits;
}

describe('admin components use no undefined variables', () => {
  it('finds the components to check', () => {
    // A glob matching nothing would make this file a silent no-op.
    expect(files.length).toBeGreaterThan(8);
    expect(files).toContain('GiftCardsTab.jsx');
    expect(files).toContain('NotificationsTab.jsx');
  });

  it('reports zero no-undef errors across the CRM', () => {
    const hits = undefinedVariables();
    // The message lists the offenders, so a failure says exactly what to fix.
    expect(hits, `undefined variables would blank the screen:\n${hits.join('\n')}`).toEqual([]);
  }, 60_000);
});
