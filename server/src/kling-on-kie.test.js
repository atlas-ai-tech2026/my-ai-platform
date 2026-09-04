// ─── kling-on-kie.test.js ────────────────────────────────────────────────────
// Owner, 2026-09-03: "If the user chooses Kling 3.0, generate from kie's
// Kling 3.0. If Kling Omni, from kie's Kling Omni. If Motion Control, from
// kie's Motion Control. Do not generate anything from the API of FAL."
//
// That day five Kling models still ran on FAL — Kling 3.0 Omni, 2.5, 2.1,
// both Motion Controls, both Edit models — and one of them ("Kling O1") under
// a name kie has never had. Nothing failed: FAL answered, the charge landed,
// the history row said "Kling". A rule no test enforces is a rule the next
// model addition breaks quietly, so this reads the real routing tables and
// the real route bodies.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');

const src = read('server/src/index.js');
const modalSrc = read('src/components/video/VideoModelModal.jsx');
const tabsSrc = read('src/components/video/VideoTopTabs.jsx');

/** Source text of `const NAME = { … };` */
function block(name) {
  const i = src.indexOf(`const ${name} = {`);
  const j = src.indexOf('\n};', i);
  expect(i, `${name} not found`).toBeGreaterThan(-1);
  return src.slice(i, j);
}

/** One entry per `"Label": { … },` line of a table. */
function entries(text) {
  return [...text.matchAll(/^\s*"([^"]+)":\s*\{(.*)\},?\s*$/gm)].map((m) => ({ label: m[1], body: m[2] }));
}

/** Source text of one route handler: from its app.post( line to the next route. */
function routeBody(route) {
  const start = src.indexOf(`app.post('${route}'`);
  expect(start, `route ${route} not found`).toBeGreaterThan(-1);
  const next = src.indexOf('\napp.post(', start + 1);
  const alt = src.indexOf('\napp.get(', start + 1);
  return src.slice(start, Math.min(...[next, alt, src.length].filter((i) => i > 0)));
}

const directMap = block('VIDEO_DIRECT_MAP');
const kling = entries(directMap).filter((e) => /^Kling/.test(e.label));

describe('every Kling entry in VIDEO_DIRECT_MAP is a kie model', () => {
  it('finds the Kling entries at all (guards against a rename voiding this test)', () => {
    expect(kling.length).toBeGreaterThanOrEqual(8);
  });

  it.each(kling)('"$label" has provider kie and no FAL endpoint', ({ body }) => {
    expect(body).toMatch(/provider:\s*"kie"/);
    expect(body).not.toMatch(/fal-ai\//);
  });

  it('each label names its exact kie twin — the model the customer chose, not a neighbour', () => {
    const byLabel = Object.fromEntries(kling.map((k) => [k.label, k.body]));
    expect(byLabel['Kling 3.0']).toContain('kling-3.0/video');
    expect(byLabel['Kling 3.0 Omni']).toContain('kling-3.0-omni/');
    expect(byLabel['Kling 3.0 Turbo']).toContain('kling/v3-turbo-');
    expect(byLabel['Kling 2.6']).toContain('kling-2.6/');
    expect(byLabel['Kling 2.5']).toContain('kling/v2-5-turbo-');
    expect(byLabel['Kling 2.1']).toContain('kling/v2-1-standard');
    expect(byLabel['Kling 3.0 Motion Control']).toContain('kling-3.0/motion-control');
    expect(byLabel['Kling Motion Control']).toContain('kling-2.6/motion-control');
  });

  // Read the ENTRY LABELS, not the raw text: the file explains in a comment
  // why each of these was retired, and a retirement note must not fail the
  // test that checks the retirement.
  it('the names with no kie twin are gone, not re-pointed', () => {
    const labels = new Set(entries(directMap).map((e) => e.label));
    for (const gone of ['Kling O1', 'Kling O1 Video Edit', 'Kling 2.1 Pro', 'Nano Banana Pro Video']) {
      expect(labels.has(gone), `${gone} should be retired, not routed`).toBe(false);
    }
  });

  it('Kling 2.1 (kie: image-to-video only) is marked so, and the route refuses text-only BEFORE charging', () => {
    expect(directMap).toMatch(/"Kling 2\.1":\s*\{[^\n]*i2vOnly: true/);
    const route = routeBody('/api/generate-video');
    expect(route).toMatch(/mapping\.i2vOnly && !image_url/);
    expect(route.indexOf('mapping.i2vOnly')).toBeLessThan(route.indexOf('chargeCredits'));
  });
});

describe('the Motion Control route talks to kie, and only kie', () => {
  const route = routeBody('/api/motion-control');

  it('dispatches to kie job ids, never FAL endpoints', () => {
    const table = block('MOTION_CONTROL_MODELS');
    expect(table).not.toMatch(/fal-ai/);
    expect(table).toMatch(/'kling-3\.0\/motion-control'/);
    expect(table).toMatch(/'kling-2\.6\/motion-control'/);
  });

  it('requires the kie key, not the FAL key, and never submits to FAL', () => {
    expect(route).toMatch(/requireKieKey/);
    expect(route).not.toMatch(/requireFalKey/);
    expect(route).not.toMatch(/fal\.queue\.submit/);
    expect(route).toMatch(/kieCreateTask\('jobs'/);
  });

  it('sends the fields kie documents: input_urls, video_urls, mode', () => {
    expect(route).toMatch(/input_urls: \[charUrl\]/);
    expect(route).toMatch(/video_urls: \[refUrl\]/);
    expect(route).toMatch(/mode: quality === '1080p' \? 'pro' : 'std'/);
  });

  // kie bills per second of the reference clip. The seconds must be read from
  // the file, and read BEFORE pricing, and the charge must land BEFORE the
  // task is created — a job we cannot bill for must never be queued.
  it('bills on seconds read from the file, prices, charges, then submits — in that order', () => {
    const probe = route.indexOf('probeVideoDurationSeconds(refUrl');
    const price = route.indexOf('priceOrRespond');
    const charge = route.indexOf('chargeCredits');
    const submit = route.indexOf("kieCreateTask('jobs'");
    expect(probe).toBeGreaterThan(-1);
    expect(probe).toBeLessThan(price);
    expect(price).toBeLessThan(charge);
    expect(charge).toBeLessThan(submit);
    expect(route).toMatch(/duration: seconds/);
  });

  it('records the charge as a kie spend with a routable kie job id', () => {
    expect(route).toMatch(/provider: 'kie'/);
    expect(route).toMatch(/modelId: modelIdTag/);
    expect(route).toMatch(/modelIdTag = 'kie:jobs:' \+ kieModel/);
  });

  it('re-hosts both inputs for kie (it cannot read data: URIs) before anything is charged', () => {
    expect(route).toMatch(/resolveReferenceUrls\(\[image_url\], \{ forKie: true/);
    expect(route).toMatch(/resolveReferenceUrls\(\[video_url\], \{ forKie: true/);
    expect(route.indexOf('resolveReferenceUrls')).toBeLessThan(route.indexOf('chargeCredits'));
  });
});

describe('the Edit Video route never reaches FAL', () => {
  const route = routeBody('/api/edit-video-omni');

  it('has no FAL call and no FAL key requirement', () => {
    expect(route).not.toMatch(/fal\.queue\.submit|requireFalKey/);
  });

  it('refuses with the reason and takes no credits while the kie twin is pending (#102)', () => {
    expect(route).not.toMatch(/chargeCredits/);
    expect(route).toMatch(/status\(503\)/);
    expect(route).toMatch(/No credits were taken/);
  });

  it('is off the Video page nav until it can generate again', () => {
    expect(tabsSrc).not.toMatch(/id: 'edit'/);
  });
});

describe('no Kling-on-FAL leftovers in the generic video route', () => {
  it("no longer sends FAL's Kling shot_type — there is no Kling on FAL to send it to", () => {
    expect(src).not.toMatch(/shot_type/);
  });
});

describe('the picker offers only Kling models that exist on kie', () => {
  const uiKling = [...modalSrc.matchAll(/name:'(Kling[^']*)'/g)].map((m) => m[1]);

  it('lists no Kling O1', () => {
    expect(uiKling).not.toContain('Kling O1');
  });

  it('every Kling card names a VIDEO_DIRECT_MAP entry that is routed to kie', () => {
    const routed = new Set(kling.map((k) => k.label));
    for (const name of uiKling) expect(routed.has(name), `${name} is in the picker but not routed to kie`).toBe(true);
  });
});

// Five NON-Kling models whose image-to-video path is FAL's Kling v3 under
// their own name. Known, on the board as #103 for the owner's decision, and
// pinned here so the list cannot grow without someone noticing.
describe('non-Kling models that borrow FAL Kling for image-to-video are a closed list', () => {
  it('is exactly the five on card #103', () => {
    const borrowed = entries(directMap)
      .filter((e) => !/^Kling/.test(e.label) && /fal-ai\/kling-video/.test(e.body))
      .map((e) => e.label)
      .sort();
    expect(borrowed).toEqual(['LTX 2', 'PixVerse 5', 'Seedance 1', 'Vidu Q2', 'Vidu Q3']);
  });
});
