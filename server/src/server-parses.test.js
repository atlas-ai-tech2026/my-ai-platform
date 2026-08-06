// ─── server-parses.test.js ───────────────────────────────────────────────────
// Every server module must be syntactically valid JavaScript.
//
// WHY THIS EXISTS. On 2026-08-06 a merge-conflict resolution cut `db.js` in
// half INSIDE a template literal, leaving a query without its closing "`);".
// The whole suite passed and `npm run build` succeeded, so it looked clean and
// was pushed to production — where the app died on boot with
//
//     SyntaxError: missing ) after argument list
//
// and the platform rolled back after failing five health checks.
//
// It got through because nothing tested it: `npm run build` compiles only the
// Vite frontend, and no test imports db.js (it opens a Postgres pool at module
// load, so tests deliberately avoid it). That left every server-only module —
// db.js, index.js, the route modules — with NO syntax check anywhere in CI.
//
// `node --check` parses a file without executing it, so this covers modules
// that cannot safely be imported. It is the cheapest possible guard against
// the most embarrassing possible failure.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.dirname(fileURLToPath(import.meta.url));

const files = fs.readdirSync(SRC)
  .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'))
  .sort();

describe('every server module is syntactically valid', () => {
  it('finds the modules to check', () => {
    // A glob that silently matches nothing would make this whole file a no-op.
    expect(files.length).toBeGreaterThan(10);
    expect(files).toContain('db.js');
    expect(files).toContain('index.js');
  });

  it.each(files)('%s parses', (file) => {
    // Throws with the parser's own message and line number on failure.
    expect(() => execFileSync(process.execPath, ['--check', path.join(SRC, file)],
      { stdio: 'pipe' })).not.toThrow();
  });
});
