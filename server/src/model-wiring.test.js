// ─── model-wiring.test.js ────────────────────────────────────────────────────
// Adding a model touches SIX files. This asserts they agree.
//
// The failure this exists for is the one this codebase keeps repeating: a thing
// added in one place and forgotten in another, with no error to say so.
// Eight of ten trackVideoCharge call sites omitted modelId for weeks. The
// duplicate-charge guard was declared after the routes using it. The tab
// descriptions test matched nine of twelve tabs and passed.
//
// A model wired into pricing.js but missing from the UI list is invisible.
// Wired into the UI but missing from pricing.js CANNOT BE CHARGED FOR — the
// C1 gate refuses an unknown id, so the generation is free. Neither failure
// announces itself.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VIDEO_CREDITS, getVideoCredits } from './pricing.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');

const pricingSrc  = read('server/src/pricing.js');
const indexSrc    = read('server/src/index.js');
const coverageSrc = read('server/src/costing-coverage.js');
const frontendSrc = read('src/lib/creditPricing.js');
const modalSrc    = read('src/components/video/VideoModelModal.jsx');

/** Model ids the UI actually offers, from the modal's list. */
const uiIds = new Set([...modalSrc.matchAll(/\{\s*id:\s*'([a-z0-9-]+)'\s*,\s*name:/g)].map((m) => m[1]));

describe('Seedance 2.5 is wired everywhere it needs to be', () => {
  const ID = 'seedance-2-5';

  // Prices are the MEASURED kie cost at 40% margin. The first version used
  // fal's published prices as a proxy and landed at 6/12.5/30 — a 63-70%
  // realised margin, because kie charges 33-50% less than fal for the same
  // ByteDance model. Measuring, not inferring, is what caught it.
  it('has a sale price — without this the C1 gate refuses it and it cannot be charged', () => {
    expect(VIDEO_CREDITS[ID]).toBeTruthy();
    expect(VIDEO_CREDITS[ID].byRes['480p'].off).toBe(4);
    expect(VIDEO_CREDITS[ID].byRes['720p'].off).toBe(8.5);
    expect(VIDEO_CREDITS[ID].byRes['1080p'].off).toBe(15.5);
  });

  // Each price must clear the 40% floor against the measured cost.
  it('clears 40% margin on every resolution, against the MEASURED cost', () => {
    const CV = 0.063333;
    const measured = { '480p': 0.14, '720p': 0.315, '1080p': 0.57 };
    for (const [res, cost] of Object.entries(measured)) {
      const sale = VIDEO_CREDITS[ID].byRes[res].off * CV;
      const margin = (sale - cost) / sale;
      expect(margin, `${res} margin ${(margin * 100).toFixed(1)}%`).toBeGreaterThanOrEqual(0.40);
    }
  });

  // kie's marketing says "native 4K"; the API's resolution field offers three.
  it('offers only the resolutions kie actually accepts', () => {
    expect(Object.keys(VIDEO_CREDITS[ID].byRes).sort()).toEqual(['1080p', '480p', '720p']);
    expect(VIDEO_CREDITS[ID].byRes['4K']).toBeUndefined();
  });

  it('resolves from its display name', () => {
    expect(pricingSrc).toMatch(/'Seedance 2\.5': 'seedance-2-5'/);
  });

  // The model id is quoted from kie's own page: "Complete guide to using
  // bytedance/seedance-2-5". Guessing it would ship a model that always errors.
  it('routes to kie with the exact model id kie documents', () => {
    expect(indexSrc).toMatch(/"Seedance 2\.5":\s*\{\s*provider:\s*"kie",\s*family:\s*"jobs",\s*kieModel:\s*"bytedance\/seedance-2-5"\s*\}/);
  });

  // Without this the Costing tab reports it as uncosted and its margin reads
  // as unknown rather than 40%.
  it('is mapped for costing coverage', () => {
    expect(coverageSrc).toMatch(/'seedance-2-5':\s*'Seedance 2\.5'/);
  });

  it('appears in the UI model list', () => {
    expect(uiIds.has(ID)).toBe(true);
  });

  // The prices are fal's, used as a proxy because kie publishes none. That has
  // to stay visible in the source, or a later reader treats an estimate as
  // measured fact.
  it('records in the source that the cost was measured, and how', () => {
    expect(pricingSrc).toMatch(/COSTS ARE MEASURED, NOT ESTIMATED/);
    expect(pricingSrc).toMatch(/reading the kie\n  \/\/ balance either side/);
  });
});

// ─── 2026-08-25, owner: "It must be working like Seedance 2.0" ──────────────
// 2.5 shipped on 2026-08-17 with its card promising "up to 50 multimodal
// references" — and the UI switch that turns on the reference screen listed
// only the three 2.0 models, so 2.5 fell back to start/end-frame-only. The
// reference route would also have BILLED a 2.5 request as 2.0 had one
// arrived. (The owner also checked kie directly: there is NO separate
// "Seedance 2.5 Edit" model — editing is a capability of 2.5 itself.)
describe('Seedance 2.5 carries the full experience its card promises', () => {
  const videoPageSrc = read('src/pages/Video.jsx');
  const panelSrc = read('src/components/video/SeedanceLeftPanel.jsx');

  it('joins the Seedance reference UI — the one-line switch that was missing', () => {
    expect(videoPageSrc).toMatch(/isSeedance2 = [^;]*'seedance-2-5'/s);
  });

  it('the reference route knows it BY NAME, so it cannot be billed as 2.0', () => {
    expect(indexSrc).toMatch(/isV25 = model === 'Seedance 2\.5'/);
    expect(indexSrc).toMatch(/isV25 \? 'Seedance 2\.5'/);
  });

  it('runs to THIRTY seconds — kie\'s headline for 2.5 — while 2.0 stays at fifteen', () => {
    expect(indexSrc).toMatch(/Math\.min\(isV25 \? 30 : 15/);
    expect(panelSrc).toMatch(/DURATIONS_25 = secondsUpTo\(30\)/);
    expect(panelSrc).toMatch(/DURATIONS_20 = secondsUpTo\(15\)/);
    expect(modalSrc).toMatch(/id:'seedance-2-5'[^}]*dur:'4-30s'/);
  });

  it("carries kie's reference caps — 30 images, 10 videos, 10 audio", () => {
    expect(indexSrc).toMatch(/refImageUrls\.slice\(0, isV25 \? 30 : 9\)/);
    expect(indexSrc).toMatch(/video_urls\.slice\(0, isV25 \? 10 : 3\)/);
    expect(indexSrc).toMatch(/audio_urls\.slice\(0, isV25 \? 10 : 3\)/);
  });

  it('offers 720p AND 1080p on the route, and never 4k (the API field refuses it)', () => {
    expect(indexSrc).toMatch(/isV25 \? \['480p', '720p', '1080p'\]/);
  });

  // The owner's instruction, verbatim: before adding the seconds, go to OUR
  // calculator. These are the calculator's own answers across the new range —
  // per-second rate × seconds, the same function the C1 charge gate uses. No
  // per-second RATE changed anywhere; only the reachable seconds grew.
  it('the calculator prices every new second correctly, to the top of the range', () => {
    expect(getVideoCredits('Seedance 2.5', { resolution: '1080p', duration: 30, audio: true })).toBe(465);
    expect(getVideoCredits('Seedance 2.5', { resolution: '720p', duration: 30, audio: false })).toBe(255);
    expect(getVideoCredits('Seedance 2.5', { resolution: '720p', duration: 13, audio: true })).toBe(110.5);
    expect(getVideoCredits('Seedance 2.5', { resolution: '480p', duration: 4, audio: false })).toBe(16);
  });
});

// ─── 2026-08-25, owner: Gemini Omni takes references AND start/end frames ───
// The backend accepted image_urls for Omni since it was wired (max 7, kie's
// budget) — but only the two frame slots ever fed it, so the card's promise
// "with reference images" had no screen behind it. Same disease as Seedance
// 2.5, caught the same day.
describe('Gemini Omni carries references alongside its frames', () => {
  const videoPageSrc = read('src/pages/Video.jsx');
  const panelSrc = read('src/components/video/VideoLeftPanel.jsx');

  it('the generic route accepts reference_urls and re-hosts them like frames', () => {
    expect(indexSrc).toMatch(/reference_urls, duration/);
    expect(indexSrc).toMatch(/rawRefs = Array\.isArray\(reference_urls\)/);
  });

  it("the Omni mapping pools frames + references, capped at kie's 7-image budget", () => {
    expect(indexSrc).toMatch(/pool = \[\.\.\.frames, \.\.\.refs\]\.slice\(0, 7\)/);
  });

  // Frames first, so "@Image1" in a prompt keeps meaning the start frame.
  it('frames come before references in the pool', () => {
    expect(indexSrc).toMatch(/\[\.\.\.frames, \.\.\.refs\]/);
  });

  it('the page grants Omni the 7-image capacity and sends reference_urls', () => {
    expect(videoPageSrc).toMatch(/genericRefCapacity = model\.id === 'gemini-omni' \? 7 : 0/);
    expect(videoPageSrc).toMatch(/reference_urls: referenceUrls/);
  });

  it('the panel shows the shared budget honestly — refs + frames count together', () => {
    expect(panelSrc).toMatch(/refCapacity = 0/);
    expect(panelSrc).toMatch(/referenceImages\.length \+ \(startFrame \? 1 : 0\) \+ \(endFrame \? 1 : 0\)/);
  });
});

// ─── 2026-08-25, owner: Kling image-to-video must be ONE shot from the image ─
// The request was already right for Kling 3.0 on kie (multi_shots:false,
// checked against kie's schema) and customers still got cut-up clips. What a
// correct flag cannot stop, the prompt can — so the provider-facing prompt
// carries a continuity instruction on every Kling image-to-video request.
// (Until 2026-09-03 the FAL path also sent shot_type for Kling 3.0 Omni; no
// Kling model runs on FAL any more, so that code is gone — kling-on-kie.test.js.)
describe('Kling image-to-video stays on the customer\'s image', () => {
  const panelSrc = read('src/components/video/VideoLeftPanel.jsx');

  it('the provider prompt goes through the continuity guard on BOTH provider paths', () => {
    expect(indexSrc).toMatch(/providerPrompt = withContinuity\(prompt, \{ hasImage: !!image_url, multiShots: !!multi_shots, model \}\)/);
    expect(indexSrc).toMatch(/prompt: providerPrompt, frames, duration/);     // kie
    expect(indexSrc).toMatch(/const input = \{\s*\n\s*prompt: providerPrompt,/); // FAL (non-Kling models)
  });

  it('Kling 3.0 on kie still sends multi_shots explicitly — the documented single-shot form', () => {
    expect(indexSrc).toMatch(/multi_shots: ms,/);
    expect(indexSrc).toMatch(/image_urls: ms \? \[frames\[0\]\] : frames/);
  });

  it('Kling 3.0 Omni (kie Kling O3) sends multi_shots explicitly too, first frame only when it is on', () => {
    expect(indexSrc).toMatch(/"Kling 3\.0 Omni":\s*\{ provider: "kie"/);
    expect(indexSrc).toMatch(/image_urls: ms \? \[frames\[0\]\] : frames\.slice\(0, 2\)/);
  });

  it('the Multi Shot toggle defaults OFF and is the only way to ask for cuts', () => {
    expect(panelSrc).toMatch(/useState\(false\);\s*\n\s*const \[showDurationDrop/);
    expect(panelSrc).toMatch(/multiShots: multiShotsOn/);
  });
});

describe('every chargeable video model is reachable and priced', () => {
  // Panel model NAMES also live in VIDEO_CREDITS (the Motion Control / Edit
  // tabs key by name), so only lowercase-hyphen ids are UI-list candidates.
  const ids = Object.keys(VIDEO_CREDITS).filter((k) => /^[a-z0-9-]+$/.test(k));

  it('found the models to check', () => {
    expect(ids.length).toBeGreaterThan(8);
    expect(uiIds.size).toBeGreaterThan(8);
  });

  // The dangerous direction: a model the UI offers but pricing.js does not
  // know. The C1 gate refuses an unknown id, so the generation would be FREE.
  it('offers nothing in the UI that cannot be priced', () => {
    const unpriced = [...uiIds].filter((id) => !VIDEO_CREDITS[id]);
    expect(unpriced, `UI offers ${unpriced.join(', ')} with no sale price — those generations cannot be charged`)
      .toEqual([]);
  });

  it('keeps the server and frontend price tables in step for every id', () => {
    const missing = ids.filter((id) => !frontendSrc.includes(`'${id}'`));
    expect(missing, `missing from src/lib/creditPricing.js: ${missing.join(', ')}`).toEqual([]);
  });
});
