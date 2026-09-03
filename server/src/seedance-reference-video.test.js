// ─── seedance-reference-video.test.js ────────────────────────────────────────
// Owner, 2026-09-03: a customer attached a video and an audio clip to Seedance
// 2.5 and got kie's refusal — "Seedance identified your task as video editing
// … `ratio` must be `adaptive` … `duration` must be -1". Voxel always sent a
// fixed length ("Auto" was silently 5 s) and a fixed ratio.
//
// This reads the real route and the real page so the fix cannot quietly
// come apart: with a reference video the request follows the video, the
// length is read from the file, and it is read BEFORE anything is charged.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');

const src = read('server/src/index.js');
const pageSrc = read('src/pages/Video.jsx');
const panelSrc = read('src/components/video/SeedanceLeftPanel.jsx');

function routeBody(route) {
  const start = src.indexOf(`app.post('${route}'`);
  expect(start, `route ${route} not found`).toBeGreaterThan(-1);
  const next = src.indexOf('\napp.post(', start + 1);
  const alt = src.indexOf('\napp.get(', start + 1);
  return src.slice(start, Math.min(...[next, alt, src.length].filter((i) => i > 0)));
}

const route = routeBody('/api/generate-video-ref');

describe('a Seedance job with a reference video follows the video', () => {
  it('sends kie duration -1 and ratio adaptive when a reference video is attached', () => {
    expect(route).toMatch(/duration: followsVideo \? -1 : durInt/);
    expect(route).toMatch(/aspect_ratio: followsVideo \? 'adaptive'/);
  });

  it('reads the length from the file, then prices, then charges, then submits — in that order', () => {
    const probe = route.indexOf('probeVideoDurationSeconds(u');
    const verdict = route.indexOf('referenceVideoBilling(');
    const price = route.indexOf('priceOrRespond');
    const charge = route.indexOf('chargeCredits');
    const submit = route.indexOf("kieCreateTask('jobs'");
    expect(probe).toBeGreaterThan(-1);
    expect(probe).toBeLessThan(verdict);
    expect(verdict).toBeLessThan(price);
    expect(price).toBeLessThan(charge);
    expect(charge).toBeLessThan(submit);
    expect(route).toMatch(/duration: billingDuration/);
  });

  it('refuses a reference video outside the range BEFORE charging, with the reason', () => {
    const refusal = route.indexOf('verdict.outOfRange');
    expect(refusal).toBeGreaterThan(-1);
    expect(refusal).toBeLessThan(route.indexOf('chargeCredits'));
    expect(route).toMatch(/accepts reference videos of 4 to \$\{maxSeconds\} seconds/);
    expect(route).toMatch(/const maxSeconds = isV25 \? 30 : 15/);
  });

  it('re-hosts reference videos and audio for kie before anything is charged (kie cannot read data: URIs)', () => {
    expect(route).toMatch(/refVideoUrls = await resolveReferenceUrls\(refVideoUrls, opts\)/);
    expect(route).toMatch(/refAudioUrls = await resolveReferenceUrls\(refAudioUrls, opts\)/);
    expect(route.indexOf('resolveReferenceUrls')).toBeLessThan(route.indexOf('chargeCredits'));
    expect(route).toMatch(/reference_video_urls: refVideoUrls\.slice/);
    expect(route).toMatch(/reference_audio_urls: refAudioUrls\.slice/);
  });

  // Owner's dev test, 2026-09-03: the price said 19 s, the card said 0:05.
  // The badge shows the stored duration, and the page stored the picker's
  // "auto". The server now says how many seconds it billed; the page uses it.
  it('tells the page the seconds it billed, and the page labels the card with them', () => {
    expect(route).toMatch(/\.\.\.\(followsVideo \? \{ seconds: billingDuration \} : \{\}\)/);
    expect(pageSrc).toMatch(/const shownDuration = data\.seconds \? String\(data\.seconds\) : seedanceDuration/);
    expect(pageSrc).toMatch(/duration: shownDuration, ratio: seedanceAspect/);
  });

  it('logs the full kie payload — the ground truth when a customer complains', () => {
    expect(route).toMatch(/\[SEEDANCE\] \[KIE\] payload:/);
  });
});

describe('the page and the panel agree with the server', () => {
  it('the page reads each reference video\'s length when it is picked and sends the longest as a cross-check', () => {
    expect(pageSrc).toMatch(/readMediaSeconds\(file\)/);
    expect(pageSrc).toMatch(/body\.reference_video_seconds = refVideoSeconds/);
  });

  it('the panel prices per second of the longest reference video and steps the pickers aside', () => {
    expect(panelSrc).toMatch(/const followsVideo = refVideos\.length > 0/);
    expect(panelSrc).toMatch(/Math\.max\(4, Math\.min\(maxSeconds, Math\.round\(refVideoSeconds\)\)\)/);
    expect(panelSrc).toMatch(/Length and ratio follow your reference video/);
    expect(panelSrc).toMatch(/showDurDrop && !followsVideo/);
    expect(panelSrc).toMatch(/showAspectDrop && !followsVideo/);
  });

  it('the panel and the server use the same ceiling per model', () => {
    expect(panelSrc).toMatch(/model\?\.id === 'seedance-2-5' \? 30 : 15/);
  });
});
