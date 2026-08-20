// ─── voxel-skill.test.js ─────────────────────────────────────────────────────
// The project's rules must survive in a form that loads BEFORE work starts.
//
// ── WHY A TEST FOR A DOCUMENT ──────────────────────────────────────────────
// These rules already existed — in CLAUDE.md, in memory files, in commit
// messages. They were still broken, repeatedly, because they were read AFTER a
// mistake rather than before an action. Moving them into a skill fixes the
// timing; this test fixes the drift.
//
// A rules document with nothing checking it is a document that quietly loses a
// rule the first time one is inconvenient. Each assertion below names an
// incident that actually happened, so removing a rule means deliberately
// deleting the record of what it cost.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SKILL = path.join(ROOT, '.claude/skills/voxel/SKILL.md');

describe('the VOXEL skill exists and can be loaded', () => {
  it('is where Claude Code looks for it', () => {
    expect(existsSync(SKILL), '.claude/skills/voxel/SKILL.md is missing').toBe(true);
  });

  it('has the frontmatter a skill needs to register at all', () => {
    const src = readFileSync(SKILL, 'utf8');
    expect(src.startsWith('---'), 'no frontmatter — the skill will not load').toBe(true);
    expect(src).toMatch(/^name:\s*voxel$/m);
    expect(src).toMatch(/^description:\s*"/m);
  });

  // The description is what decides whether the skill loads. One that does not
  // name the things it applies to will simply never trigger — and a rulebook
  // that never opens is the same as no rulebook.
  it('describes when it applies, so it actually triggers', () => {
    const desc = readFileSync(SKILL, 'utf8').match(/description:\s*"([^"]+)"/)?.[1] || '';
    expect(desc.length, 'the description is too thin to match anything').toBeGreaterThan(200);
    for (const cue of ['control panel', 'server/src', 'production', 'backup']) {
      expect(desc.toLowerCase(), `the description never mentions "${cue}"`).toContain(cue);
    }
  });
});

/**
 * The BODY only — everything after the frontmatter.
 *
 * The first version of these tests read the whole file, and the `description`
 * line lists every rule by name. So the entire body could have been deleted and
 * the tests would still have passed on the description alone. Found by trying
 * to break it: the rule was removed and nothing failed.
 *
 * A test that matches its own table of contents is not checking the book.
 */
function body() {
  const src = readFileSync(SKILL, 'utf8');
  const end = src.indexOf('\n---', 3);
  return end === -1 ? src : src.slice(end + 4);
}

describe('every rule that was bought with an incident is still in it', () => {
  const src = body;

  it.each([
    ['git add -A',            /git add -A/,                'published the cost file to a PUBLIC repo'],
    ['dev before main',       /dev.*before.*main|Commit on `dev`/i, 'four commits to main in one night'],
    ['verify the effect',     /verify the EFFECT/i,        'upsertTask was correct and reached no screen'],
    ['read it this session',  /have not read in this session/i, 'five wrong statements from one habit'],
    ['build before delete',   /[Bb]uild before you delete/, 'delete-first on 66 GiB with no backup'],
    ['count, do not trust',   /count the thing/i,          'a flag anyone can tick says nothing'],
    ['secrets never in chat', /straight into DigitalOcean|never.*repeat a secret/i, 'two secrets reached the chat'],
    ['unknown is not ok',     /unknown.*is not.*ok/i,      'a screen that says OK when it means not-checked'],
    ['no promises while away', /never run between messages|do not run between/i, 'they returned to nothing built'],
  ])('still carries the rule about %s', (_label, pattern, why) => {
    expect(src(), `the rule is gone. It was bought with: ${why}`).toMatch(pattern);
  });

  // A rule with no cost attached is one that gets argued away in the moment.
  it('keeps the incidents, not just the instructions', () => {
    const s = src();
    for (const marker of ['What it cost', '601', '3,046', 'PUBLIC']) {
      expect(s, `"${marker}" is gone — the rules are losing their evidence`).toContain(marker);
    }
  });
});

describe('what is ON HOLD is written down', () => {
  it.each(['Email campaigns', '2FA', 'never change an existing price'])(
    'still records that %s is held', (item) => {
      expect(body()).toContain(item.split(' ')[0]);
    });
});

describe('the traps that have already caused outages', () => {
  it.each([
    ['local .env points at production', /points at PRODUCTION/],
    ['dev has no offsite config',       /Dev has NO offsite/i],
    ['the edge is not the owner\'s',    /DIGITALOCEAN'S Cloudflare/i],
    ['server/scripts is gitignored',    /server\/scripts.*gitignored/i],
  ])('still warns about %s', (_label, pattern) => {
    expect(body()).toMatch(pattern);
  });
});
