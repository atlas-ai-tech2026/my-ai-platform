// ─── csp-connect.test.js ─────────────────────────────────────────────────────
// N15 (recheck 2026-08-03): connect-src was 'https:' — every origin on the
// internet — so the Content-Security-Policy contributed nothing against a
// script exfiltrating admin data. Narrowed to the hosts media genuinely comes
// from, derived from the same allow-list the download guard builds from real
// production data so the two cannot drift apart.
//
// The danger in tightening this is silent breakage: the browser fetches
// provider audio directly (Audio.jsx) and image sources (uploadToFal.js), and
// a blocked fetch surfaces only as an opaque "Failed to fetch". These tests
// pin both directions — the real hosts stay reachable, arbitrary ones do not.

import { describe, it, expect } from 'vitest';
import { buildAllowedHostSuffixes } from './download-guard.js';

const ENV = {
  SPACES_ENDPOINT: 'https://nyc3.digitaloceanspaces.com',
  SPACES_BUCKET: 'voxel-ai-store',
};

/** Mirrors mediaConnectSources() in index.js. */
function connectSources(env = ENV) {
  const out = new Set();
  for (const suffix of buildAllowedHostSuffixes(env)) {
    out.add(`https://${suffix}`);
    out.add(`https://*.${suffix}`);
  }
  return [...out];
}

/** Does a CSP source list permit this URL? */
function allowed(url, sources = connectSources()) {
  const host = new URL(url).hostname;
  return sources.some((src) => {
    if (src === `https://${host}`) return true;
    if (src.startsWith('https://*.')) {
      const base = src.slice('https://*.'.length);
      return host === base || host.endsWith(`.${base}`);
    }
    return false;
  });
}

describe('N15 — the browser can still reach every real media host', () => {
  // Derived from production history on 2026-08-03. Audio.jsx fetches these
  // urls directly, so a miss here is broken playback, not a security warning.
  const realHosts = [
    'https://v3b.fal.media/files/x.mp3',
    'https://tempfile.aiquickdraw.com/out/y.mp4',
    'https://voxel-ai-store.nyc3.digitaloceanspaces.com/generations/audio/z.mp3',
    'https://voxel-ai-store.nyc3.cdn.digitaloceanspaces.com/generations/image/z.png',
    'https://qtrypzzcjebvfcihiynt.supabase.co/storage/old.png',
    'https://media.base44.com/old.png',
    'https://kieai.redpandaai.co/upload',
  ];

  for (const url of realHosts) {
    it(`allows ${new URL(url).hostname}`, () => {
      expect(allowed(url)).toBe(true);
    });
  }
});

describe('N15 — arbitrary origins are no longer permitted', () => {
  it('blocks an attacker collection endpoint', () => {
    expect(allowed('https://attacker.tld/collect')).toBe(false);
    expect(allowed('https://webhook.site/abcdef')).toBe(false);
  });

  it('is not fooled by a lookalike suffix', () => {
    expect(allowed('https://evilfal.media/x')).toBe(false);
    expect(allowed('https://aiquickdraw.com.attacker.tld/x')).toBe(false);
  });

  it('no longer contains the blanket https: source', () => {
    expect(connectSources()).not.toContain('https:');
  });
});

describe('N15 — the policy tracks the download guard, not a second list', () => {
  it('picks up a host added through the escape hatch', () => {
    // So a new provider does not need a code change in two places, which is
    // how allow-lists drift out of sync and start blocking real traffic.
    const extended = connectSources({ ...ENV, DOWNLOAD_ALLOWED_HOSTS: 'newcdn.example' });
    expect(allowed('https://files.newcdn.example/a.png', extended)).toBe(true);
    expect(allowed('https://files.newcdn.example/a.png')).toBe(false);
  });
});
