// ─── branch-guard.test.js ────────────────────────────────────────────────────
// The pre-commit hook that refuses commits to main must actually be INSTALLED,
// not merely present in the repository.
//
// ── WHY ────────────────────────────────────────────────────────────────────
// On 2026-08-19 Claude committed to main instead of dev FOUR times in one
// night, while writing rules about discipline. Every time it was noticed
// afterwards; once it had to be unwound. The rule was known, written down and
// agreed — and broken four times anyway.
//
// When a mistake has happened more than twice, stop trying harder and make it
// mechanically impossible.
//
// ── THE GAP THIS CLOSES ────────────────────────────────────────────────────
// A hook file in .githooks/ does NOTHING until `core.hooksPath` points at it.
// So a fresh clone would have the hook sitting there, inert, and the first
// person to trust it would be trusting a file that never runs. `npm install`
// sets it via postinstall, and this test fails loudly if it is somehow not set
// — because a safeguard nobody has switched on is the same as no safeguard,
// which is the exact shape of half the bugs found this week.

import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, statSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HOOK = path.join(ROOT, '.githooks/pre-commit');

const git = (args) => {
  try {
    return execSync(`git ${args}`, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return ''; }
};

describe('the branch guard exists', () => {
  it('the hook file is there', () => {
    expect(existsSync(HOOK), '.githooks/pre-commit is missing').toBe(true);
  });

  // A hook that is not executable is silently skipped by git. No error, no
  // warning — it simply never runs, which is the worst of both worlds: it
  // looks protected and is not.
  it('is executable, or git skips it without a word', () => {
    const mode = statSync(HOOK).mode;
    expect(mode & 0o111, '.githooks/pre-commit is not executable — git will ignore it silently')
      .toBeGreaterThan(0);
  });

  it('actually checks the branch, rather than just existing', () => {
    const src = readFileSync(HOOK, 'utf8');
    expect(src).toMatch(/symbolic-ref/);
    expect(src).toMatch(/main\|master/);
    expect(src, 'the hook never exits non-zero, so it can never block anything').toMatch(/exit 1/);
  });

  // A rebase, bisect or cherry-pick runs with a detached HEAD. Blocking there
  // would break a legitimate operation someone is halfway through.
  it('leaves a detached HEAD alone', () => {
    expect(readFileSync(HOOK, 'utf8')).toMatch(/-z "\$branch" \] && exit 0/);
  });

  // There must be a way out. A guard with no override gets disabled entirely
  // the first time someone genuinely needs to get past it.
  it('offers a deliberate override', () => {
    expect(readFileSync(HOOK, 'utf8')).toMatch(/ALLOW_MAIN_COMMIT/);
  });
});

describe('the branch guard is switched ON', () => {
  // THE ONE THAT MATTERS. The file does nothing until core.hooksPath points at
  // it. `npm install` sets this via postinstall; if that has not happened, this
  // says so rather than letting the repo look protected while it is not.
  it('core.hooksPath points at .githooks', () => {
    expect(git('config core.hooksPath'),
      'The hook is NOT active. Run:  git config core.hooksPath .githooks\n'
      + '(npm install does this automatically via postinstall.)'
    ).toBe('.githooks');
  });

  it('npm install re-installs it, so a fresh clone is protected', () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.scripts.postinstall, 'nothing installs the hook on a fresh clone')
      .toMatch(/core\.hooksPath/);
  });
});
