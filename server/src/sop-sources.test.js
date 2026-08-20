// ─── sop-sources.test.js ─────────────────────────────────────────────────────
// The owner, 2026-08-20, after the Daily backup line reported "not checked"
// while backups were running perfectly:
//
//   "When you said you build it and it's working fine, I must believe you. But
//    now after this has happened, we need to verify everything in SOP, and this
//    is wasting of time and wasting of tokens."
//
// That is the whole problem with my assurances. Once ONE line has lied, my word
// that the others are fine is worth nothing — it is the same word I gave about
// the broken one. So this replaces the word with a test.
//
// Every line on that screen must DECLARE where its facts come from, and a
// source that a restart can erase is refused. A new line that forgets to
// declare fails the build rather than quietly joining the screen.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LINE_SOURCES, KIND, FORBIDDEN, sourceFor, auditKeys } from './sop-sources.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(path.join(here, f), 'utf8');
const SOURCES = ['sop-engine.js', 'sop-routes.js'].map(read).join('\n');

/**
 * Every key the SOP actually emits.
 *
 * Two forms: a plain literal (`key: 'backup'`) and a template built at runtime
 * (`key: \`usage-${provider}\``). The template ones are reduced to their
 * literal prefix, which is what the registry declares — otherwise the check
 * would silently ignore exactly the dynamic families most likely to be added
 * without thought.
 */
function emittedKeys(src = SOURCES) {
  const keys = new Set();
  // key: 'backup'
  for (const m of src.matchAll(/key:\s*'([a-z0-9-]+)'/g)) keys.add(m[1]);
  // key: `usage-${provider}`  → the literal prefix, which is what is declared
  for (const m of src.matchAll(/key:\s*`([a-z0-9-]*)\$\{/g)) keys.add(m[1]);
  // mk('dead-paths', …) — the integrity lines go through a local helper, so
  // they carry no literal `key:` at all. The FIRST version of this extractor
  // missed all four, and the orphan check below is what caught it: the
  // registry declared lines the extractor could not see. A blind spot in a
  // safety check is worse than no check, so it is covered here AND made
  // detectable by the canary test.
  for (const m of src.matchAll(/\bmk\(\s*'([a-z0-9-]+)'/g)) keys.add(m[1]);
  return [...keys];
}

const KEYS = emittedKeys();

describe('every SOP line declares where its facts come from', () => {
  // A sweep that finds nothing passes forever and protects nothing. If the SOP
  // is refactored so these keys move, this fails loudly instead of quietly
  // becoming a no-op.
  it('actually finds the lines it claims to be checking', () => {
    expect(KEYS.length, 'no SOP line keys were found — this check is checking nothing')
      .toBeGreaterThanOrEqual(15);
  });

  // CANARY for the extractor's own blind spot. These four are emitted through a
  // local `mk()` helper and carry no literal `key:` — the first version of the
  // extractor missed every one of them, and would have let an undeclared
  // integrity line onto the screen unnoticed. If the helper is renamed or the
  // pattern changes, this fails and points at the extractor rather than
  // silently shrinking what is checked.
  it.each(['dead-paths', 'null-columns', 'uncalled-routes', 'unused-tables'])(
    'still sees %s, which is emitted indirectly', (key) => {
      expect(KEYS,
        'the extractor stopped seeing helper-emitted lines — fix emittedKeys(), do not '
        + 'delete this test. A safety check with a blind spot is worse than none.'
      ).toContain(key);
    });

  it.each(KEYS)('%s has a declared source', (key) => {
    const s = sourceFor(key);
    expect(s,
      `"${key}" appears on the SOP screen but declares no source. Add it to LINE_SOURCES in `
      + 'sop-sources.js and say where it reads from — a line nobody can trace is a line nobody '
      + 'can trust, which is the whole reason this file exists.'
    ).toBeTruthy();
  });

  // THE POINT OF THE FILE. A source held in process memory is wiped by every
  // deploy, and this app deploys several times a day — so it cannot tell "this
  // is broken" from "this process started a minute ago".
  it.each(KEYS)('%s does not read from process memory', (key) => {
    const s = sourceFor(key);
    expect(FORBIDDEN,
      `"${key}" reads from ${s?.kind}. A restart erases that, so the line cannot tell a broken `
      + 'check from a fresh process — which is exactly how Daily backup reported "not checked" '
      + 'for months of deploys while backups were running perfectly.'
    ).not.toContain(s?.kind);
  });

  it('finds no undeclared or forbidden source anywhere', () => {
    const { undeclared, forbidden } = auditKeys(KEYS);
    expect({ undeclared, forbidden }).toEqual({ undeclared: [], forbidden: [] });
  });
});

describe('the registry itself is honest', () => {
  it('every declaration says WHY, not just what', () => {
    for (const [key, v] of Object.entries(LINE_SOURCES)) {
      expect(v.why, `${key} declares a kind but no explanation`).toBeTruthy();
      expect(v.why.length, `${key}'s explanation is too short to be useful`).toBeGreaterThan(20);
    }
  });

  it('every declared kind is a real one', () => {
    const kinds = new Set(Object.values(KIND));
    for (const [key, v] of Object.entries(LINE_SOURCES)) {
      expect(kinds, `${key} declares an unknown kind "${v.kind}"`).toContain(v.kind);
    }
  });

  // The registry must not quietly contain a forbidden entry that no live key
  // happens to hit today — it would become legal the moment someone used it.
  it('contains no forbidden source at all, used or not', () => {
    const bad = Object.entries(LINE_SOURCES)
      .filter(([, v]) => FORBIDDEN.includes(v.kind))
      .map(([k]) => k);
    expect(bad).toEqual([]);
  });

  // Registry entries for lines that no longer exist are how a document drifts
  // away from the thing it documents.
  it('declares nothing that the screen does not emit', () => {
    const orphans = Object.entries(LINE_SOURCES)
      .filter(([k, v]) => (v.prefix
        ? !KEYS.some((key) => key === k || key.startsWith(k))
        : !KEYS.includes(k)))
      .map(([k]) => k);
    expect(orphans, 'these are declared but no longer on the screen').toEqual([]);
  });
});

describe('the one kind that is allowed but is not a check', () => {
  // A hand-maintained list can show a false RED if something is fixed and
  // nobody edits it. It cannot show a false green, which is the only reason it
  // is permitted — but it should be named rather than blend in.
  it('static lists say plainly that they can go stale', () => {
    for (const [key, v] of Object.entries(LINE_SOURCES)) {
      if (v.kind !== KIND.STATIC_LIST) continue;
      expect(v.why.toLowerCase(), `${key} is a hand-maintained list but does not admit it`)
        .toMatch(/stale|record|hand/);
    }
  });
});
