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
import { VIDEO_CREDITS } from './pricing.js';

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

  it('has a sale price — without this the C1 gate refuses it and it cannot be charged', () => {
    expect(VIDEO_CREDITS[ID]).toBeTruthy();
    expect(VIDEO_CREDITS[ID].byRes['480p'].off).toBe(6);
    expect(VIDEO_CREDITS[ID].byRes['720p'].off).toBe(12.5);
    expect(VIDEO_CREDITS[ID].byRes['1080p'].off).toBe(30);
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
  it('says in the source that its cost is derived, not measured', () => {
    expect(pricingSrc).toMatch(/PRICES ARE PROVISIONAL AND DERIVED, NOT MEASURED/);
    expect(pricingSrc).toMatch(/MEASURE THE REAL kie COST/);
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
