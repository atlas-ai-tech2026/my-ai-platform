// ─── every-model-can-actually-run.test.jsx ───────────────────────────────────
// ☠ A MODEL IN THE PICKER THAT THE SERVER CANNOT REACH.
//
// Found on 2026-09-03, in the middle of a live workshop, by reading production
// logs. A customer picked "Kling 3.0 Omni" and got:
//
//     [VIDEO] Model selected by user: Kling 3.0 Omni
//     [VIDEO] Mapped to fal model: fal-ai/kling-video/v3/pro/image-to-video
//     [VIDEO] Error: Forbidden
//
// ELEVEN of the twenty-five video models were in that state. Each had no entry
// in the server's kie provider map, so it fell through to a legacy FAL map
// still sitting in the code — and FAL, which holds a key but is not connected,
// refuses everything. Every one of the eleven failed 100% of the time.
//
// Nobody noticed because only one customer happened to pick one. The other
// twenty-four choices worked, so the catalogue LOOKED healthy. That is this
// project's signature shape: something that works exactly as written and helps
// nobody, discovered only by looking at what actually happened.
//
// ── WHY A TEST AND NOT A CAREFUL REVIEW ────────────────────────────────────
// Because the mistake is silent by construction. Adding a model to the picker
// is a one-line change in a JSX file; wiring it in the server is a different
// file entirely. Nothing connected the two, so they drifted, and the drift was
// invisible until a customer paid for it.
//
// The rule this enforces: EVERY model offered to a customer must have a route
// the server can actually take. If you cannot serve it, do not show it.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const picker = readFileSync(join(ROOT, 'src/components/video/VideoModelModal.jsx'), 'utf8');
const server = readFileSync(join(ROOT, 'server/src/index.js'), 'utf8');

/** Entries in the picker: id, display name, and whether it is flagged unservable. */
function offeredModels() {
  const out = [];
  // only the VIDEO_MODELS array, not the featured-cards list further down
  const arr = picker.slice(picker.indexOf('const VIDEO_MODELS = ['),
                           picker.indexOf('\nconst font ='));
  for (const line of arr.split('\n')) {
    const m = /^\s*\{\s*id:\s*'([^']+)'\s*,\s*name:\s*'([^']+)'/.exec(line);
    if (!m) continue;                       // comments and commented-out entries
    out.push({ id: m[1], name: m[2], unavailable: /unavailable:\s*'[^']+'/.test(line) });
  }
  return out;
}

/** Display names the server has a kie provider entry for. */
function kieServedNames() {
  const names = new Set();
  const re = /^\s*"([^"]+)":\s*\{[^}]*provider:\s*"kie"/gm;
  let m;
  while ((m = re.exec(server))) names.add(m[1]);
  return names;
}

describe('☠ EVERY MODEL SHOWN TO A CUSTOMER MUST BE ONE THE SERVER CAN RUN', () => {
  const offered = offeredModels();
  const kie = kieServedNames();

  it('reads both sides — a test that finds nothing to check is not a check', () => {
    expect(offered.length).toBeGreaterThan(15);
    expect(kie.size).toBeGreaterThan(15);
  });

  it('every SERVABLE model in the picker has a kie route', () => {
    const shown = offered.filter((m) => !m.unavailable);
    const orphans = shown.filter((m) => !kie.has(m.name));
    expect(orphans.map((m) => m.name),
      'These are offered to customers but the server has no kie route for them, so they '
      + 'fall through to FAL and fail with Forbidden. Either wire them to kie, or mark them '
      + "unavailable:'no kie route' so the picker hides them.").toEqual([]);
  });

  it('☠ and the unavailable ones are genuinely hidden, not merely labelled', () => {
    // The bug would come straight back if the flag were set and nothing read
    // it. Search must filter on the same list as the grid, or a customer finds
    // a broken model by typing its name.
    // Written to accept `m =>` and `(m) =>` alike — the first version demanded
    // parentheses the source did not have, and failed on formatting rather
    // than on behaviour. A test that breaks on style teaches people to edit
    // the test.
    expect(picker).toMatch(/const servable = VIDEO_MODELS\.filter\(\(?m\)? *=> *!m\.unavailable\)/);
    expect(picker).toMatch(/const featured = servable\.filter/);
    expect(picker).toMatch(/const filtered = servable\.filter/);
    expect(picker).not.toMatch(/const filtered = VIDEO_MODELS\.filter/);
  });

  it('records which models are currently unservable, so the number cannot drift quietly', () => {
    const hidden = offered.filter((m) => m.unavailable).map((m) => m.name).sort();
    expect(hidden).toEqual([
      'Hailuo 2.3', 'Kling 2.1', 'Kling 2.5', 'Kling 3.0 Omni', 'Kling O1',
      'LTX 2', 'PixVerse 5', 'Seedance 1', 'Vidu Q2', 'Vidu Q3', 'Wan 2.2',
    ]);
  });

  it('the legacy FAL map is still present — kept as the record, not deleted', () => {
    // Build before you delete. The entries carry what we used to offer and what
    // it was priced against; removing them would lose that with nothing gained.
    expect(server).toMatch(/const VIDEO_MODELS = \{/);
  });
});
