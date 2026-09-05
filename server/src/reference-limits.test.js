// ─── reference-limits.test.js ────────────────────────────────────────────────
// A second copy of a limit is a second thing to forget. So these tests do not
// restate the numbers — they read them back out of buildKieImageInput's own
// source and fail if the two ever disagree.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { referenceLimit, referenceWarning } from './reference-limits.js';

const SRC = readFileSync(path.resolve(process.cwd(), 'server/src/index.js'), 'utf8');

describe('referenceLimit matches what the request builder actually sends', () => {
  it('nano-banana-2 takes 14 and Pro takes 8 — the numbers in the builder', () => {
    // The builder line: image_input: imageUrls.slice(0, kieModel === 'nano-banana-2' ? 14 : 8)
    const m = SRC.match(/image_input:\s*imageUrls\.slice\(0,\s*cfg\.kieModel === 'nano-banana-2' \? (\d+) : (\d+)\)/);
    expect(m, 'the nano-banana slice moved — update reference-limits.js').toBeTruthy();
    expect(referenceLimit({ provider: 'kie', family: 'jobs', kieModel: 'nano-banana-2' })).toBe(Number(m[1]));
    expect(referenceLimit({ provider: 'kie', family: 'jobs', kieModel: 'nano-banana-pro' })).toBe(Number(m[2]));
  });

  it('seedream 5 pro takes the number in its image_urls slice', () => {
    const m = SRC.match(/image_urls:\s*imageUrls\.slice\(0,\s*(\d+)\)/);
    expect(m).toBeTruthy();
    expect(referenceLimit({ provider: 'kie', family: 'jobs', kieModel: 'seedream/5-pro-image-to-image', kieStyle: 'seedream5pro' }))
      .toBe(Number(m[1]));
  });

  it('the gpt-image family takes the number in its input_urls slice', () => {
    const m = SRC.match(/input_urls:\s*imageUrls\.slice\(0,\s*(\d+)\)/);
    expect(m).toBeTruthy();
    expect(referenceLimit({ provider: 'kie', family: 'jobs', kieModel: 'gpt-image-2-image-to-image' }))
      .toBe(Number(m[1]));
  });

  it('gpt4o takes the number in its filesUrl slice', () => {
    const m = SRC.match(/filesUrl:\s*imageUrls\.slice\(0,\s*(\d+)\)/);
    expect(m).toBeTruthy();
    expect(referenceLimit({ provider: 'kie', family: 'gpt4o' })).toBe(Number(m[1]));
  });

  describe('the models that use ONE image and silently drop the rest', () => {
    // ☠ These are the likeliest cause of Amr's report. Four references go in,
    // one is used, three vanish with no message.
    it('flux uses imageUrls[0], so the limit is 1', () => {
      expect(SRC).toMatch(/inputImage:\s*imageUrls\[0\]/);
      expect(referenceLimit({ provider: 'kie', family: 'flux', kieModel: 'flux-kontext-pro' })).toBe(1);
    });
    it('midjourney uses imageUrls[0], so the limit is 1', () => {
      expect(SRC).toMatch(/fileUrl:\s*imageUrls\[0\]/);
      expect(referenceLimit({ provider: 'kie', family: 'mj' })).toBe(1);
    });
    it('a FAL model with imgParam takes 1', () => {
      expect(referenceLimit({ t2i: 'fal-ai/flux/dev', i2i: 'fal-ai/flux-pro/kontext', imgParam: 'image_url' })).toBe(1);
    });
  });

  describe('the models that accept NONE and ignore every reference', () => {
    // Worse than dropping extras: the request carries no image field at all,
    // so a customer can upload four pictures, spend the credits, and receive
    // something built from none of them.
    for (const cfg of [
      { name: 'Imagen 4', cfg: { provider: 'kie', family: 'jobs', kieModel: 'google/imagen4', t2iOnly: true, kieStyle: 'imagen4' } },
      { name: 'Flux 2', cfg: { provider: 'kie', family: 'jobs', kieModel: 'flux-2/pro-text-to-image', t2iOnly: true } },
      { name: 'Seedream 4.5', cfg: { provider: 'kie', family: 'jobs', kieModel: 'seedream/4.5-text-to-image', t2iOnly: true } },
    ]) {
      it(`${cfg.name} reports 0`, () => expect(referenceLimit(cfg.cfg)).toBe(0));
    }
  });

  it('every model named in MODEL_CONFIG gets an answer, never undefined', () => {
    // A model added later must not fall through to undefined and be treated
    // as "unlimited" by a caller doing `count > limit`.
    const block = SRC.slice(SRC.indexOf('const MODEL_CONFIG'));
    const names = [...block.slice(0, block.indexOf('\n};')).matchAll(/^\s+"([^"]+)":\s*\{/gm)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(15);
    for (const n of names) {
      const v = referenceLimit({ provider: 'kie', family: 'jobs', kieModel: 'unknown-' + n });
      expect(Number.isInteger(v), `${n} produced ${v}`).toBe(true);
    }
    expect(referenceLimit(undefined)).toBe(0);
    expect(referenceLimit({})).toBe(0);
  });
});

describe('referenceWarning says what will happen, before the credits go', () => {
  const flux = { provider: 'kie', family: 'flux', kieModel: 'flux-kontext-pro' };
  const nano = { provider: 'kie', family: 'jobs', kieModel: 'nano-banana-pro' };
  const imagen = { provider: 'kie', family: 'jobs', kieModel: 'google/imagen4', t2iOnly: true, kieStyle: 'imagen4' };

  it('says nothing when the references fit', () => {
    expect(referenceWarning(nano, 4, 'Nano Banana Pro')).toBe(null);
    expect(referenceWarning(flux, 1, 'Flux Kontext')).toBe(null);
    expect(referenceWarning(nano, 0, 'Nano Banana Pro')).toBe(null);
  });

  it('names the model, the limit and what gets ignored', () => {
    const w = referenceWarning(flux, 4, 'Flux Kontext');
    expect(w).toContain('Flux Kontext');
    expect(w).toContain('at most 1');
    expect(w).toContain('extra 3');
  });

  it('is explicit that a text-to-image model uses none of them', () => {
    const w = referenceWarning(imagen, 4, 'Imagen 4');
    expect(w).toContain('does not use reference images');
    expect(w).toContain('ignored');
  });

  it('reads correctly for a single extra image', () => {
    expect(referenceWarning(flux, 2, 'Midjourney')).toContain('extra one');
  });
});

// ─── THE REFUSAL MUST COME BEFORE THE CHARGE ────────────────────────────────
// ☠ I GOT THIS WRONG ONCE. My first attempt put the reference check after
// chargeCredits — the customer's credits would have gone, and then the request
// would have been refused, leaving a charge with nothing to show and no refund
// path. Caught by reading the line numbers, not by a test, so here is the test.
describe('the generate route refuses references before it charges', () => {
  const src = readFileSync(path.resolve(process.cwd(), 'server/src/index.js'), 'utf8');
  const route = src.slice(src.indexOf("app.post('/api/generate'"));
  const body = route.slice(0, route.indexOf("app.post('/api/", 10));

  it('the check exists in the generate route', () => {
    expect(body).toMatch(/referenceWarning\(cfg, refCount, model\)/);
  });

  it('and it runs BEFORE chargeCredits', () => {
    const refuse = body.indexOf('refused before charging');
    const charge = body.indexOf('await chargeCredits(');
    expect(refuse, 'the refusal is missing').toBeGreaterThan(-1);
    expect(charge, 'chargeCredits is missing').toBeGreaterThan(-1);
    expect(refuse, 'the refusal must come before the charge, or credits go and the request fails')
      .toBeLessThan(charge);
  });

  it('refuses with 400 rather than trimming silently', () => {
    expect(body).toMatch(/res\.status\(400\)\.json\(\{ error: refWarning \}\)/);
  });
});
