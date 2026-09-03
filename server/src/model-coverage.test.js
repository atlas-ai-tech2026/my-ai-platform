// ─── model-coverage.test.js ──────────────────────────────────────────────────
// Every model offered in the UI must be (a) dispatchable by the server and
// (b) priceable — because C1 REJECTS any model with no price on file. A model
// added to a picker without a matching server entry or price would fail for
// users with "This model has no price on file yet", and no other test would
// notice.
//
// This reads the real UI catalogs and the real server maps, so adding a model
// to one place and forgetting the other fails here.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolveChargeCost, getImageCredits, getVideoCredits,
} from './pricing.js';
import {
  IMAGE_CREDITS as UI_IMAGE, VIDEO_CREDITS as UI_VIDEO,
  getImageCredits as uiImageCredits, getVideoCredits as uiVideoCredits,
} from '../../src/lib/creditPricing.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// --- what the UI actually offers -------------------------------------------
const uiImageModels = [...read('src/components/image/ImagePromptBar.jsx')
  .matchAll(/\{\s*id:\s*'([^']+)',\s*name:\s*'([^']+)'/g)].map((m) => ({ id: m[1], name: m[2] }));
const uiVideoModels = [...read('src/components/video/VideoModelModal.jsx')
  .matchAll(/\{\s*id:'([^']+)',\s*name:'([^']+)'/g)].map((m) => ({ id: m[1], name: m[2] }));

// --- the server's dispatch maps --------------------------------------------
const serverSrc = read('server/src/index.js');
function mapKeys(name) {
  const i = serverSrc.indexOf(`const ${name} = {`);
  const j = serverSrc.indexOf('\n};', i);
  return new Set([...serverSrc.slice(i, j).matchAll(/"([^"]+)":\s*\{/g)].map((m) => m[1]));
}
const MODEL_CONFIG = mapKeys('MODEL_CONFIG');
const VIDEO_DIRECT_MAP = mapKeys('VIDEO_DIRECT_MAP');

// Kling O1 Video Edit retired 2026-09-03 (no kie twin) — not listed on purpose.
const PANEL_MODELS = [
  'Kling 3.0 Motion Control', 'Kling Motion Control',
  'Kling 3.0 Omni Edit',
];

describe('the UI catalogs were parsed (guards against a silent no-op test)', () => {
  it('found image and video models', () => {
    expect(uiImageModels.length).toBeGreaterThan(10);
    expect(uiVideoModels.length).toBeGreaterThan(10);
    expect(MODEL_CONFIG.size).toBeGreaterThan(10);
    expect(VIDEO_DIRECT_MAP.size).toBeGreaterThan(10);
  });
});

describe('every UI model is dispatchable by the server', () => {
  it.each(uiImageModels)('image "$name" is in MODEL_CONFIG', ({ name }) => {
    expect(MODEL_CONFIG.has(name)).toBe(true);
  });

  it.each(uiVideoModels)('video "$name" is in VIDEO_DIRECT_MAP', ({ name }) => {
    expect(VIDEO_DIRECT_MAP.has(name)).toBe(true);
  });
});

describe('every UI model prices — C1 must never reject one', () => {
  it.each(uiImageModels)('image "$name" prices at every quality', ({ name }) => {
    for (const quality of ['Draft', '1K', '2K', '4K']) {
      const cost = resolveChargeCost({ kind: 'image', model: name, quality });
      expect(cost, `${name} @ ${quality}`).toBeGreaterThan(0);
    }
  });

  it.each(uiVideoModels)('video "$name" prices at common settings', ({ name }) => {
    for (const resolution of ['720p', '1080p']) {
      for (const audio of [false, true]) {
        const cost = resolveChargeCost({
          kind: 'video', model: name, resolution, duration: 5, audio,
        });
        expect(cost, `${name} @ ${resolution}${audio ? ' audio' : ''}`).toBeGreaterThan(0);
      }
    }
  });

  it.each(PANEL_MODELS)('panel model "%s" prices', (name) => {
    for (const resolution of ['720p', '1080p']) {
      expect(resolveChargeCost({ kind: 'video', model: name, resolution })).toBeGreaterThan(0);
    }
  });
});

describe('frontend and server agree on price — a mismatch is a 409 for the user', () => {
  it('images match at every quality tier', () => {
    const bad = [];
    for (const [id, row] of Object.entries(UI_IMAGE)) {
      for (const quality of Object.keys(row)) {
        const ui = uiImageCredits(id, quality);
        const server = getImageCredits(id, quality);
        if (ui !== server) bad.push(`${id} ${quality}: ui=${ui} server=${server}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('videos match across resolution, duration and audio', () => {
    const bad = [];
    for (const id of Object.keys(UI_VIDEO)) {
      for (const resolution of ['480p', '720p', '1080p', '4K']) {
        for (const duration of [4, 5, 8, 10, 15]) {
          for (const audio of [false, true]) {
            const opts = { resolution, duration, audio };
            const ui = uiVideoCredits(id, opts);
            const server = getVideoCredits(id, opts);
            if (ui !== server) {
              bad.push(`${id} ${resolution} ${duration}s${audio ? ' audio' : ''}: ui=${ui} server=${server}`);
            }
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
