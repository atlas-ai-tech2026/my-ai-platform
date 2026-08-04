// ─── download-proxy.test.js ──────────────────────────────────────────────────
// N4 (recheck 2026-08-03): /api/download trusted "is this URL in the caller's
// own history?" to decide whether the host allow-list applied. Since
// POST /api/entities/:name persists arbitrary client JSON, a user could write
// {"result_url":"https://attacker.tld/x"} into their own history and then have
// the server fetch any host on the internet — an authenticated open proxy.
//
// The allow-list is enforced unconditionally now. These tests pin BOTH halves:
// the exploit is dead, AND every host that really appears in production
// history still works (this route has broken twice by tightening it on
// assumption instead of on the data).

import { describe, it, expect } from 'vitest';
import { buildAllowedHostSuffixes, isAllowedDownloadHost, assertSafeDownloadUrl } from './download-guard.js';

const ENV = {
  SPACES_ENDPOINT: 'https://nyc3.digitaloceanspaces.com',
  SPACES_BUCKET: 'voxel-ai-store',
};
const suffixes = buildAllowedHostSuffixes(ENV);

describe('N4 — the planted-history bypass is closed', () => {
  it('rejects an attacker-controlled host even when the caller "owns" the URL', async () => {
    // Exactly the exploit: the row exists in the attacker's own history, so
    // the old code passed skipHostAllowList and connected anywhere.
    await expect(
      assertSafeDownloadUrl('https://attacker.tld/payload.bin', { suffixes })
    ).rejects.toThrow(/not an allowed download source/i);
  });

  it('is not fooled by a host that merely ends with an allowed string', () => {
    // Label-boundary check: 'evilfal.media' must not satisfy 'fal.media'.
    expect(isAllowedDownloadHost('evilfal.media', suffixes)).toBe(false);
    expect(isAllowedDownloadHost('aiquickdraw.com.attacker.tld', suffixes)).toBe(false);
    expect(isAllowedDownloadHost('notsupabase.co', suffixes)).toBe(false);
  });

  it('still refuses the cloud metadata address', async () => {
    await expect(
      assertSafeDownloadUrl('https://169.254.169.254/latest/meta-data/', { suffixes })
    ).rejects.toThrow();
  });
});

describe('N4 — every host that really exists in history still downloads', () => {
  // Derived from the production database on 2026-08-03, NOT from the code
  // that writes new rows. aiquickdraw.com alone holds 47% of all media; the
  // 2026-08-01 outage happened because it was missing from this list.
  const realHosts = [
    'v3b.fal.media',                                  // 6,605 rows
    'tempfile.aiquickdraw.com',                       // 5,949 rows
    'qtrypzzcjebvfcihiynt.supabase.co',               // pre-Spaces era
    'media.base44.com',                               // pre-Spaces era
    'voxel-ai-store.nyc3.digitaloceanspaces.com',     // re-hosted, live 2026-08-02
    'voxel-ai-store.nyc3.cdn.digitaloceanspaces.com', // CDN edge variant
  ];

  for (const host of realHosts) {
    it(`allows ${host}`, () => {
      expect(isAllowedDownloadHost(host, suffixes)).toBe(true);
    });
  }

  it('honours the DOWNLOAD_ALLOWED_HOSTS escape hatch for a new provider', () => {
    // So a future provider can be allowed without a code deploy — the reason
    // the previous outage needed a hotfix rather than a config change.
    const extended = buildAllowedHostSuffixes({ ...ENV, DOWNLOAD_ALLOWED_HOSTS: 'newcdn.example' });
    expect(isAllowedDownloadHost('files.newcdn.example', extended)).toBe(true);
    expect(isAllowedDownloadHost('files.newcdn.example', suffixes)).toBe(false);
  });
});
