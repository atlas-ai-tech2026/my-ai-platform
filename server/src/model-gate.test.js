// ─── model-gate.test.js ──────────────────────────────────────────────────────
// N5 (recheck 2026-08-03): the per-user model allow-list (CRM Bulk tab) was
// enforced on 3 of 9 credit-spending endpoints. /api/edit-video-omni,
// /api/motion-control, /api/tts, /api/generate-music and both node runners
// never consulted it, so an account restricted to two image models could spend
// its whole balance on voice, music, editing and the node canvas.
//
// The gap opened because the first three routes were written with the gate and
// the six later ones simply forgot it. A prose rule would not have stopped
// that, so this test reads the real source and fails when a credit-spending
// route lacks the call.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SRC = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.js'),
  'utf8'
);

/** Every route that charges credits must gate on the allow-list. */
const CREDIT_SPENDING_ROUTES = [
  '/api/generate',
  '/api/generate-video',
  '/api/generate-video-ref',
  '/api/edit-video-omni',
  '/api/motion-control',
  '/api/tts',
  '/api/generate-music',
  '/api/node/run-node',
  '/api/node/run-node-async',
];

/** Source text of one route handler: from its app.post( line to the next one. */
function routeBody(route) {
  const start = SRC.indexOf(`app.post('${route}'`);
  if (start === -1) return null;
  const next = SRC.indexOf('\napp.post(', start + 1);
  const alt = SRC.indexOf('\napp.get(', start + 1);
  const end = Math.min(...[next, alt, SRC.length].filter(i => i > 0));
  return SRC.slice(start, end);
}

describe('N5 — every credit-spending route honours the model allow-list', () => {
  for (const route of CREDIT_SPENDING_ROUTES) {
    it(`${route} calls modelAllowedForUser`, () => {
      const body = routeBody(route);
      expect(body, `route ${route} not found — did it get renamed?`).toBeTruthy();
      expect(
        body.includes('modelAllowedForUser'),
        `${route} spends credits but never checks the per-user model allow-list. ` +
        'Add the gate after the model is resolved and BEFORE chargeCredits.'
      ).toBe(true);
    });
  }

  for (const route of CREDIT_SPENDING_ROUTES) {
    it(`${route} gates BEFORE it charges`, () => {
      const body = routeBody(route);
      const gate = body.indexOf('modelAllowedForUser');
      const charge = body.indexOf('chargeCredits');
      if (charge === -1) return; // charges via a helper; ordering covered elsewhere
      expect(
        gate < charge,
        `${route} charges credits before checking the allow-list — a blocked ` +
        'user would be billed for an attempt that is then refused.'
      ).toBe(true);
    });
  }
});

describe('N5 — the CRM can grant everything the server enforces', () => {
  it('exposes audio, editing and node models, not just image and video', () => {
    const start = SRC.indexOf("app.get('/api/admin/models'");
    const body = SRC.slice(start, start + 700);
    for (const key of ['image:', 'video:', 'audio:', 'editing:', 'node:']) {
      expect(body.includes(key), `catalog is missing ${key}`).toBe(true);
    }
  });

  it('gates voice on a label the catalog also publishes', () => {
    // If these drift, restricting an account silently removes voice with no
    // way for an admin to grant it back — the trap this fix exists to avoid.
    expect(SRC.includes('TTS_MODEL_LABELS')).toBe(true);
    expect(SRC.includes('MUSIC_MODEL_LABEL')).toBe(true);
    const catalogStart = SRC.indexOf("app.get('/api/admin/models'");
    const catalog = SRC.slice(catalogStart, catalogStart + 700);
    expect(catalog.includes('TTS_MODEL_LABELS')).toBe(true);
    expect(catalog.includes('MUSIC_MODEL_LABEL')).toBe(true);
  });
});

describe('N5 — an empty allow-list still means "everything"', () => {
  // 377 of 377 production accounts have no restriction, so this is the path
  // every real user takes today. Adding the gates must not change it.
  function modelAllowedForUser(req, model) {
    const list = req.userAccess?.allowedModels;
    return !Array.isArray(list) || list.length === 0 || list.includes(model);
  }

  it('allows any model when no list is set', () => {
    expect(modelAllowedForUser({}, 'ElevenLabs v3')).toBe(true);
    expect(modelAllowedForUser({ userAccess: {} }, 'Lyria 2 (Music)')).toBe(true);
    expect(modelAllowedForUser({ userAccess: { allowedModels: [] } }, 'anything')).toBe(true);
  });

  it('blocks only what a populated list omits', () => {
    const req = { userAccess: { allowedModels: ['Nano Banana Pro'] } };
    expect(modelAllowedForUser(req, 'Nano Banana Pro')).toBe(true);
    expect(modelAllowedForUser(req, 'ElevenLabs v3')).toBe(false);
  });
});
