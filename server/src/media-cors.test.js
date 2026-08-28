// ─── media-cors.test.js ──────────────────────────────────────────────────────
// Letting our own pages read a media file with JavaScript.
//
// Without this, Voxel Edit Cut's export cannot read a Voxel clip — the one
// thing the editor exists to do, broken for the one input that makes it ours.
// Galleries keep working, because an <img> tag does not need CORS, which is
// why it went unnoticed.

import { describe, it, expect, vi } from 'vitest';
import { ensureMediaCors, MEDIA_CORS_RULE, MEDIA_CORS_ORIGINS } from './storage.js';

/** A fake S3 that records what it was asked to do. */
function s3({ existing = null, readFails = false, writeFails = false, sticks = true } = {}) {
  const sent = [];
  return {
    sent,
    send: vi.fn(async (cmd) => {
      const name = cmd.constructor.name;
      sent.push(name);
      if (name === 'GetBucketCorsCommand') {
        if (readFails) throw Object.assign(new Error('boom'), { name: 'InternalError' });
        // After a successful write, report what stuck.
        if (sent.filter((n) => n === 'PutBucketCorsCommand').length) {
          return { CORSRules: sticks ? [MEDIA_CORS_RULE] : [] };
        }
        if (existing === null) throw Object.assign(new Error('none'), { name: 'NoSuchCORSConfiguration' });
        return { CORSRules: existing };
      }
      if (name === 'PutBucketCorsCommand' && writeFails) throw new Error('access denied');
      return {};
    }),
  };
}

describe('the rule itself', () => {
  it('names our origins rather than allowing everyone', () => {
    // `*` would let any site read a customer's media with script. These files
    // are already public to anyone holding the url, so it is not a
    // catastrophe — but "already leaky" is a poor reason to open it wider.
    expect(MEDIA_CORS_RULE.AllowedOrigins).not.toContain('*');
    expect(MEDIA_CORS_ORIGINS).toContain('https://voxel-ai.ai');
    expect(MEDIA_CORS_ORIGINS).toContain('https://dev.voxel-ai.ai');
  });

  it('allows READING only — the browser never writes to this bucket', () => {
    // Uploads go through our own API, which is where the size and type checks
    // live. A browser that could PUT straight into the bucket would bypass
    // every one of them.
    expect(MEDIA_CORS_RULE.AllowedMethods.sort()).toEqual(['GET', 'HEAD']);
    for (const bad of ['PUT', 'POST', 'DELETE']) {
      expect(MEDIA_CORS_RULE.AllowedMethods).not.toContain(bad);
    }
  });

  it('exposes Content-Length, which the surveys read', () => {
    expect(MEDIA_CORS_RULE.ExposeHeaders).toContain('Content-Length');
  });
});

describe('applying it', () => {
  it('writes the rule when the bucket has none', async () => {
    const fake = s3({ existing: null });
    const out = await ensureMediaCors({ s3: fake, bucket: 'b' });
    expect(out).toMatchObject({ ok: true, changed: true });
    expect(fake.sent).toContain('PutBucketCorsCommand');
  });

  it('does NOTHING when the rule is already there', async () => {
    const fake = s3({ existing: [MEDIA_CORS_RULE] });
    const out = await ensureMediaCors({ s3: fake, bucket: 'b' });
    expect(out).toMatchObject({ ok: true, changed: false });
    expect(fake.sent).not.toContain('PutBucketCorsCommand');
  });

  it('treats "no configuration yet" as normal, not as a fault', async () => {
    const out = await ensureMediaCors({ s3: s3({ existing: null }), bucket: 'b' });
    expect(out.ok).toBe(true);
  });

  it('READS IT BACK, and fails loudly if the rule did not stick', async () => {
    // A PUT that returns 200 and leaves the bucket unchanged would otherwise be
    // reported as a fix that does not exist — the precise failure this project
    // keeps finding, and why ensureVersioning does the same.
    const out = await ensureMediaCors({ s3: s3({ existing: null, sticks: false }), bucket: 'b' });
    expect(out.ok).toBe(false);
    expect(out.stage).toBe('verify');
  });

  it('reports a write failure rather than claiming success', async () => {
    const out = await ensureMediaCors({ s3: s3({ existing: null, writeFails: true }), bucket: 'b' });
    expect(out).toMatchObject({ ok: false, stage: 'write' });
  });

  it('reports a read failure instead of guessing', async () => {
    const out = await ensureMediaCors({ s3: s3({ readFails: true }), bucket: 'b' });
    expect(out).toMatchObject({ ok: false, stage: 'read' });
  });

  it('refuses when Spaces is not configured', async () => {
    const out = await ensureMediaCors({ s3: null, bucket: 'b' });
    expect(out.ok).toBe(false);
  });
});
