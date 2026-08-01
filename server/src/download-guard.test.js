// ─── download-guard.test.js ──────────────────────────────────────────────────
// H1 (security audit 2026-07-28): proves /api/download is no longer an open
// SSRF proxy — cloud metadata and arbitrary external hosts are rejected,
// allow-listed provider CDNs still work, and redirects can't smuggle us to
// an internal address.

import { describe, it, expect } from 'vitest';
import {
  assertSafeDownloadUrl,
  isAllowedDownloadHost,
  isPrivateAddress,
  buildAllowedHostSuffixes,
  sanitizeFilename,
  DownloadRejectedError,
} from './download-guard.js';

// Deterministic fake DNS: hostname → address, no network in tests.
const FAKE_DNS = {
  'v3.fal.media': '151.101.1.140',
  'fal.media': '151.101.1.140',
  'tempfile.redpandaai.co': '104.18.2.7',
  // Historical output hosts — real user history points at these.
  'qtrypzzcjebvfcihiynt.supabase.co': '104.18.38.10',
  'media.base44.com': '104.18.39.11',
  'voxel-media.fra1.digitaloceanspaces.com': '162.243.189.2',
  'voxel-media.fra1.cdn.digitaloceanspaces.com': '162.243.189.3',
  // An allow-listed name that (maliciously or by misconfiguration) points inside
  'evil.fal.media': '169.254.169.254',
  'internal.fal.media': '10.0.0.5',
  'attacker.com': '203.0.113.9',
};
const lookup = async (host) => {
  const addr = FAKE_DNS[host];
  if (!addr) throw new Error('ENOTFOUND');
  return [{ address: addr, family: addr.includes(':') ? 6 : 4 }];
};

const ENV = {
  SPACES_ENDPOINT: 'https://fra1.digitaloceanspaces.com',
  SPACES_BUCKET: 'voxel-media',
  SPACES_CDN_BASE: 'https://voxel-media.fra1.cdn.digitaloceanspaces.com',
};
const suffixes = buildAllowedHostSuffixes(ENV);
const check = (url) => assertSafeDownloadUrl(url, { lookup, suffixes });

describe('H1 — SSRF targets are rejected', () => {
  it('cloud metadata IP is rejected', async () => {
    await expect(check('https://169.254.169.254/latest/meta-data/')).rejects
      .toBeInstanceOf(DownloadRejectedError);
  });

  it('metadata via an ALLOW-LISTED name that resolves to link-local is rejected', async () => {
    // The DNS-rebinding style attack: hostname passes the allow-list, but
    // resolves to 169.254.169.254.
    await expect(check('https://evil.fal.media/x.png')).rejects
      .toThrow(/private address/i);
  });

  it('allow-listed name resolving to a private 10.x address is rejected', async () => {
    await expect(check('https://internal.fal.media/x.png')).rejects
      .toThrow(/private address/i);
  });

  it('a random external host is rejected', async () => {
    await expect(check('https://attacker.com/payload')).rejects
      .toThrow(/not an allowed download source/i);
  });

  it('localhost and internal service urls are rejected', async () => {
    await expect(check('http://localhost:3001/api/admin/stats')).rejects.toThrow();
    await expect(check('https://127.0.0.1/')).rejects.toThrow();
    await expect(check('https://192.168.1.1/router')).rejects.toThrow();
  });

  it('non-https schemes are rejected (file://, http://, gopher://)', async () => {
    await expect(check('file:///etc/passwd')).rejects.toThrow(/https/i);
    await expect(check('http://v3.fal.media/x.png')).rejects.toThrow(/https/i);
    await expect(check('gopher://v3.fal.media/x')).rejects.toThrow(/https/i);
  });

  it('urls with embedded credentials are rejected', async () => {
    await expect(check('https://user:pass@v3.fal.media/x.png')).rejects
      .toThrow(/credentials/i);
  });

  it('look-alike hostnames do not pass the suffix check', async () => {
    expect(isAllowedDownloadHost('evilfal.media', suffixes)).toBe(false);
    expect(isAllowedDownloadHost('fal.media.attacker.com', suffixes)).toBe(false);
    expect(isAllowedDownloadHost('notredpandaai.co', suffixes)).toBe(false);
  });

  it('garbage input is rejected, not crashed on', async () => {
    await expect(check('not a url')).rejects.toBeInstanceOf(DownloadRejectedError);
    await expect(check('')).rejects.toBeInstanceOf(DownloadRejectedError);
  });
});

describe('H1 — legitimate downloads still work', () => {
  it('FAL output CDN is allowed', async () => {
    const u = await check('https://v3.fal.media/files/abc/output.mp4');
    expect(u.hostname).toBe('v3.fal.media');
  });

  it('kie file host is allowed', async () => {
    const u = await check('https://tempfile.redpandaai.co/x/out.png');
    expect(u.hostname).toBe('tempfile.redpandaai.co');
  });

  it('our DO Spaces bucket and CDN hosts are allowed', async () => {
    await expect(check('https://voxel-media.fra1.digitaloceanspaces.com/a.png')).resolves.toBeTruthy();
    await expect(check('https://voxel-media.fra1.cdn.digitaloceanspaces.com/a.png')).resolves.toBeTruthy();
  });

  // Regression: production 2026-08-01. Allow-listing only fal.media and
  // redpandaai.co broke downloading ANY image generated before outputs were
  // re-hosted to Spaces — those history rows still point at supabase /
  // base44, and users saw "This host is not an allowed download source".
  it('HISTORICAL output hosts still download (supabase, base44)', async () => {
    await expect(check('https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/x.png'))
      .resolves.toBeTruthy();
    await expect(check('https://media.base44.com/x.png')).resolves.toBeTruthy();
  });

  it('DOWNLOAD_ALLOWED_HOSTS adds a host without a code deploy', async () => {
    const withExtra = buildAllowedHostSuffixes({ ...ENV, DOWNLOAD_ALLOWED_HOSTS: 'cdn.newprovider.io' });
    expect(isAllowedDownloadHost('cdn.newprovider.io', withExtra)).toBe(true);
    // …and it does not weaken the rest of the list.
    expect(isAllowedDownloadHost('attacker.com', withExtra)).toBe(false);
  });
});

describe('private address classification', () => {
  it('flags every internal range', () => {
    ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.0.1',
     '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1',
     '::1', '::', 'fe80::1', 'fd00::1', '::ffff:10.0.0.1'].forEach((ip) => {
      expect(isPrivateAddress(ip), ip).toBe(true);
    });
  });

  it('allows real public addresses', () => {
    ['151.101.1.140', '8.8.8.8', '162.243.189.2', '2606:4700::1111'].forEach((ip) => {
      expect(isPrivateAddress(ip), ip).toBe(false);
    });
  });

  it('treats non-IP input as unsafe', () => {
    expect(isPrivateAddress('')).toBe(true);
    expect(isPrivateAddress('not-an-ip')).toBe(true);
  });
});

describe('filename sanitisation (header injection)', () => {
  it('keeps only the basename — no path traversal', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFilename('/var/log/../../a.png')).toBe('a.png');
  });

  it('strips quotes and CRLF (header injection)', () => {
    const out = sanitizeFilename('a"; rm -rf x\r\nX-Evil: y');
    expect(out).not.toMatch(/[\r\n"]/);
  });

  it('falls back when the name is empty after cleaning', () => {
    expect(sanitizeFilename('///', 'fallback.png')).toBe('fallback.png');
    expect(sanitizeFilename(undefined, 'fallback.png')).toBe('fallback.png');
  });
});
