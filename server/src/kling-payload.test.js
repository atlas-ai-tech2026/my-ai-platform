// ─── kling-payload.test.js ───────────────────────────────────────────────────
// Kling 3.0 and Kling 3.0 Turbo are DIFFERENT kie models with DIFFERENT input
// schemas. Sending one model's fields to the other is silently accepted by
// kie and produces a wrong-looking video rather than an error, so the shape
// is asserted here against the published spec.
//
//   Kling 3.0        → kling-3.0/video          · mode (std|pro|4K) · sound · multi_shots
//   Kling 3.0 Turbo  → kling/v3-turbo-*-video   · resolution (720p|1080p) · NO sound
//                      (i2v takes no aspect_ratio — it adopts the image's)
//
// Docs: docs.kie.ai/market/kling/kling-3-0
//       docs.kie.ai/market/kling/v3-turbo-text-to-video
//       docs.kie.ai/market/kling/v3-turbo-image-to-video

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const src = fs.readFileSync(path.join(ROOT, 'server/src/index.js'), 'utf8');

// Pull the real builder + the real dispatch entries out of index.js.
const fnStart = src.indexOf('function buildKieVideoSubmission');
const build = eval('(' + src.slice(fnStart, src.indexOf('\n}\n', fnStart) + 2) + ')');

function mappingFor(label) {
  const s = src.indexOf('const VIDEO_DIRECT_MAP = {');
  const line = src.slice(s, src.indexOf('\n};', s)).split('\n')
    .find((l) => l.includes(`"${label}":`));
  return eval('({' + line.trim().replace(/,$/, '').replace(`"${label}":`, 'x:') + '})').x;
}

const KLING3 = mappingFor('Kling 3.0');
const TURBO = mappingFor('Kling 3.0 Turbo');
const base = { prompt: 'a cat', duration: 5, aspectRatio: '16:9', resolution: '720p' };

describe('Kling 3.0 (kling-3.0/video)', () => {
  it('text-to-video uses mode + sound + multi_shots, and no image_urls', () => {
    const { body, modelIdTag } = build(KLING3, {
      ...base, resolution: '1080p', frames: [], audio: true, multiShots: false,
    });
    expect(body.model).toBe('kling-3.0/video');
    expect(body.input.mode).toBe('pro');
    expect(body.input.sound).toBe(true);
    expect(body.input.multi_shots).toBe(false);
    expect(body.input.duration).toBe('5');
    expect(body.input).not.toHaveProperty('image_urls');
    expect(body.input).not.toHaveProperty('resolution');  // it uses `mode`
    expect(modelIdTag).toBe('kie:jobs:kling-3.0/video');
  });

  it('image-to-video puts the frame in image_urls on the SAME model id', () => {
    const { body } = build(KLING3, { ...base, frames: ['https://cdn/x.png'], audio: false, multiShots: false });
    expect(body.model).toBe('kling-3.0/video');           // one model for both
    expect(body.input.image_urls).toEqual(['https://cdn/x.png']);
    expect(body.input.multi_shots).toBe(false);           // single continuous shot
  });

  it('multi_shots ON sends only the FIRST frame (kie supports one in that mode)', () => {
    const { body } = build(KLING3, { ...base, frames: ['https://cdn/a.png', 'https://cdn/b.png'], multiShots: true });
    expect(body.input.multi_shots).toBe(true);
    expect(body.input.image_urls).toEqual(['https://cdn/a.png']);
  });

  // The resolution the user picks must reach kie, because each tier has a
  // DIFFERENT price. This previously sent 'pro' for everything except 4K, so
  // a 720p request silently received — and was billed to us as — 1080p.
  // Now that 720p is charged at its own cheaper rate, that mismatch would
  // mean charging the 720p price while paying the 1080p cost.
  it('each resolution maps to its OWN kie mode', () => {
    const modeFor = (r) => build(KLING3, { ...base, frames: [], resolution: r }).body.input.mode;
    expect(modeFor('720p')).toBe('std');    // NOT 'pro'
    expect(modeFor('1080p')).toBe('pro');
    expect(modeFor('4K')).toBe('4K');
    expect(modeFor('720P')).toBe('std');    // case-insensitive
  });

  it('an unrecognised resolution falls back to pro, never to a cheaper tier', () => {
    // Falling back DOWN would mean charging 1080p and delivering 720p.
    expect(build(KLING3, { ...base, frames: [], resolution: 'weird' }).body.input.mode).toBe('pro');
  });
});

describe('Kling 3.0 Turbo (kling/v3-turbo-*)', () => {
  it('text-to-video uses the t2v model id, resolution + aspect_ratio, and NO sound', () => {
    const { body, modelIdTag } = build(TURBO, { ...base, frames: [], aspectRatio: '9:16', audio: true });
    expect(body.model).toBe('kling/v3-turbo-text-to-video');
    expect(body.input.resolution).toBe('720p');
    expect(body.input.aspect_ratio).toBe('9:16');
    expect(body.input.duration).toBe('5');
    // Turbo has no audio parameter — sending one would be rejected/ignored.
    expect(body.input).not.toHaveProperty('sound');
    expect(body.input).not.toHaveProperty('mode');
    expect(body.input).not.toHaveProperty('multi_shots');
    expect(modelIdTag).toBe('kie:jobs:kling/v3-turbo-text-to-video');
  });

  it('image-to-video switches model id and omits aspect_ratio', () => {
    const { body, modelIdTag } = build(TURBO, { ...base, frames: ['https://cdn/x.png'], resolution: '1080p', duration: 8 });
    expect(body.model).toBe('kling/v3-turbo-image-to-video');
    expect(body.input.image_urls).toEqual(['https://cdn/x.png']);
    expect(body.input.resolution).toBe('1080p');
    expect(body.input.duration).toBe('8');
    // i2v adopts the source image's aspect ratio.
    expect(body.input).not.toHaveProperty('aspect_ratio');
    expect(modelIdTag).toBe('kie:jobs:kling/v3-turbo-image-to-video');
  });

  it('resolution is clamped to the two values Turbo accepts', () => {
    for (const r of ['720p', '480p', '4K', 'nonsense', undefined]) {
      const got = build(TURBO, { ...base, frames: [], resolution: r }).body.input.resolution;
      expect(['720p', '1080p'], `resolution=${r}`).toContain(got);
    }
    expect(build(TURBO, { ...base, frames: [], resolution: '1080p' }).body.input.resolution).toBe('1080p');
  });

  it('duration is clamped to Turbo’s documented 3–15s range', () => {
    expect(build(TURBO, { ...base, frames: [], duration: 1 }).body.input.duration).toBe('3');
    expect(build(TURBO, { ...base, frames: [], duration: 99 }).body.input.duration).toBe('15');
    expect(build(TURBO, { ...base, frames: [], duration: 12 }).body.input.duration).toBe('12');
  });

  it('aspect_ratio falls back to 16:9 when the UI sends one Turbo rejects', () => {
    expect(build(TURBO, { ...base, frames: [], aspectRatio: '21:9' }).body.input.aspect_ratio).toBe('16:9');
  });
});

// ─── 2026-09-03: the three Kling models that left FAL for kie ────────────────
// Kling 3.0 Omni = kie's Kling O3 (kling-3.0-omni/…), Kling 2.5 = kie's 2.5
// Turbo Pro (kling/v2-5-turbo-…-pro), Kling 2.1 = kie's 2.1 Standard
// (kling/v2-1-standard, image-to-video only).
const OMNI = mappingFor('Kling 3.0 Omni');
const K25 = mappingFor('Kling 2.5');
const K21 = mappingFor('Kling 2.1');

describe('Kling 3.0 Omni (kie Kling O3)', () => {
  it('text-to-video uses the Omni t2v id with Kling 3.0\'s field names, one shot by default', () => {
    const { body, modelIdTag, fallback } = build(OMNI, { ...base, resolution: '1080p', frames: [], audio: true });
    expect(body.model).toBe('kling-3.0-omni/text-to-video');
    expect(body.input.mode).toBe('pro');
    expect(body.input.sound).toBe(true);
    expect(body.input.multi_shots).toBe(false);
    expect(body.input.duration).toBe('5');
    expect(body.input.aspect_ratio).toBe('16:9');
    expect(body.input).not.toHaveProperty('image_urls');
    expect(modelIdTag).toBe('kie:jobs:kling-3.0-omni/text-to-video');
    expect(fallback).toBeUndefined();
  });

  it('image-to-video uses the Omni i2v id, frames in image_urls, no aspect_ratio', () => {
    const { body, modelIdTag } = build(OMNI, { ...base, frames: ['https://cdn/a.png', 'https://cdn/b.png'] });
    expect(body.model).toBe('kling-3.0-omni/image-to-video');
    expect(body.input.image_urls).toEqual(['https://cdn/a.png', 'https://cdn/b.png']);
    expect(body.input.multi_shots).toBe(false);
    expect(body.input).not.toHaveProperty('aspect_ratio');
    expect(modelIdTag).toBe('kie:jobs:kling-3.0-omni/image-to-video');
  });

  // The i2v id follows kie's naming; the t2v id was read from kie's docs. If
  // kie rejects the first, the route retries once on the second with the SAME
  // input — and the fallback carries exactly that.
  it('offers the text-to-video id as the one fallback for image-to-video, same input', () => {
    const { body, fallback } = build(OMNI, { ...base, frames: ['https://cdn/a.png'] });
    expect(fallback.body.model).toBe('kling-3.0-omni/text-to-video');
    expect(fallback.body.input).toEqual(body.input);
    expect(fallback.modelIdTag).toBe('kie:jobs:kling-3.0-omni/text-to-video');
  });

  it('Multi Shot ON sends only the first frame, like Kling 3.0', () => {
    const { body } = build(OMNI, { ...base, frames: ['https://cdn/a.png', 'https://cdn/b.png'], multiShots: true });
    expect(body.input.multi_shots).toBe(true);
    expect(body.input.image_urls).toEqual(['https://cdn/a.png']);
  });

  it('never asks kie for 4K — there is no 4K price on file for this model', () => {
    expect(build(OMNI, { ...base, frames: [], resolution: '4K' }).body.input.mode).toBe('pro');
    expect(build(OMNI, { ...base, frames: [], resolution: '720p' }).body.input.mode).toBe('std');
  });
});

describe('Kling 2.5 (kie Kling 2.5 Turbo Pro)', () => {
  it('text-to-video: t2v pro id, duration 5|10, aspect_ratio', () => {
    const { body, modelIdTag } = build(K25, { ...base, frames: [], aspectRatio: '9:16', duration: 10 });
    expect(body.model).toBe('kling/v2-5-turbo-text-to-video-pro');
    expect(body.input.duration).toBe('10');
    expect(body.input.aspect_ratio).toBe('9:16');
    expect(body.input).not.toHaveProperty('image_urls');
    expect(modelIdTag).toBe('kie:jobs:kling/v2-5-turbo-text-to-video-pro');
  });

  it('image-to-video: i2v pro id, ONE start frame, no aspect_ratio', () => {
    const { body, modelIdTag } = build(K25, { ...base, frames: ['https://cdn/a.png', 'https://cdn/b.png'] });
    expect(body.model).toBe('kling/v2-5-turbo-image-to-video-pro');
    expect(body.input.image_urls).toEqual(['https://cdn/a.png']);
    expect(body.input).not.toHaveProperty('aspect_ratio');
    expect(modelIdTag).toBe('kie:jobs:kling/v2-5-turbo-image-to-video-pro');
  });

  it('snaps duration to the two values kie prices (5 | 10)', () => {
    expect(build(K25, { ...base, frames: [], duration: 7 }).body.input.duration).toBe('5');
    expect(build(K25, { ...base, frames: [], duration: 8 }).body.input.duration).toBe('10');
  });
});

describe('Kling 2.1 (kie Kling 2.1 Standard — image-to-video only)', () => {
  it('image-to-video: the standard id, one frame, duration 5|10', () => {
    const { body, modelIdTag } = build(K21, { ...base, frames: ['https://cdn/a.png'], duration: 10 });
    expect(body.model).toBe('kling/v2-1-standard');
    expect(body.input.image_urls).toEqual(['https://cdn/a.png']);
    expect(body.input.duration).toBe('10');
    expect(modelIdTag).toBe('kie:jobs:kling/v2-1-standard');
  });

  it('refuses to build a text-only request — there is no 2.1 text-to-video on kie', () => {
    expect(K21.i2vOnly).toBe(true);
    expect(() => build(K21, { ...base, frames: [] })).toThrow(/start frame/);
  });
});

describe('the two models never share a payload shape', () => {
  it('Turbo never emits Kling 3.0-only fields, and vice versa', () => {
    const k3 = build(KLING3, { ...base, frames: ['https://cdn/x.png'], audio: true }).body;
    const tb = build(TURBO, { ...base, frames: ['https://cdn/x.png'], audio: true }).body;
    for (const f of ['mode', 'sound', 'multi_shots']) expect(tb.input, f).not.toHaveProperty(f);
    expect(k3.input).not.toHaveProperty('resolution');
    // Different kie models entirely — never the same endpoint.
    expect(k3.model).toBe('kling-3.0/video');
    expect(tb.model).toBe('kling/v3-turbo-image-to-video');
    expect(k3.model).not.toBe(tb.model);
  });
});
