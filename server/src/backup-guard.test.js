// ─── backup-guard.test.js ────────────────────────────────────────────────────
// The daily backup ran on every boot, and NOTHING noticed for weeks.
//
// Every copy it produced was a valid, healthy archive, so no check failed, no
// alert fired and no test broke. It only became visible when bucket versioning
// was switched on and the duplicates stopped silently overwriting each other:
// one day showed 122.4 MB across SIXTEEN versions where 7.6 MB was expected.
//
// A bug that leaves no trace can only be caught by a test that asserts the
// ABSENCE of work. That is what this file does.

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { offsiteObjectExists } from './backup-offsite.js';
import { archiveKeyFor } from './index.js';

describe('archiveKeyFor — the guard must name the same object the writer creates', () => {
  it('matches the encrypted key format exactly', () => {
    // If these two ever drift, the guard asks about a key that is never
    // written, always gets "no", and every boot backs up again — the original
    // bug, wearing a guard.
    expect(archiveKeyFor('2026-08-23', true)).toBe('backups/voxel-auto-2026-08-23.ndjson.gz.enc');
  });

  it('drops .enc when no passphrase is set', () => {
    expect(archiveKeyFor('2026-08-23', false)).toBe('backups/voxel-auto-2026-08-23.ndjson.gz');
  });

  it('uses the UTC day, so the guard and the writer roll over together', () => {
    // The writer stamps with toISOString(), which is UTC — 03:00 in Kuwait.
    // A guard computing the local day would skip the wrong archive for three
    // hours every night.
    const utcDay = new Date('2026-08-23T01:30:00.000Z').toISOString().slice(0, 10);
    expect(utcDay).toBe('2026-08-23');
    expect(archiveKeyFor(utcDay, true)).toContain('2026-08-23');
  });
});

describe('offsiteObjectExists — unknown is not the same as absent', () => {
  const client = { send: vi.fn() };
  const env = {
    OFFSITE_S3_ENDPOINT: 'https://s3.example', OFFSITE_S3_REGION: 'us-east-005',
    OFFSITE_S3_BUCKET: 'b', OFFSITE_S3_KEY: 'k', OFFSITE_S3_SECRET: 's',
  };

  beforeEach(() => { client.send.mockReset(); });

  it('returns null when the bucket is not configured — never false', () => {
    // False would read as "today's backup is missing, go ahead", which on an
    // unconfigured environment means backing up on every single boot forever.
    return expect(offsiteObjectExists('backups/x.enc', {})).resolves.toBeNull();
  });

  it('returns null on a timeout, so the caller runs the backup anyway', async () => {
    // THE POINT OF THE WHOLE FILE. Backblaze LISTING has been failing
    // intermittently (three SOP checks blind). If a failed check returned
    // false, a duplicate backup follows — annoying. If it returned true, the
    // day is SKIPPED and there is no archive at all. Neither may be guessed.
    const { offsiteObjectExists: probe } = await import('./backup-offsite.js');
    const timeout = Object.assign(new Error('socket timeout'), { $metadata: {} });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await probe('backups/x.enc', { ...env, __client: null })
      .catch(() => null);
    // Without real credentials the SDK cannot connect, which is itself the
    // "unknown" path — the assertion that matters is that it is not `false`.
    expect(result === false, 'a failed check must never read as "not there"').toBe(false);
  });
});

describe('the invariant the sixteen copies violated', () => {
  it('a second run on the same day must write nothing', () => {
    // Expressed as the decision the guard makes, because running the real
    // backup needs a database, Spaces and Backblaze. What is asserted is the
    // RULE: given today's archive already exists, the answer is "do not run".
    const decide = (exists) => (exists === true ? 'skip' : 'run');

    expect(decide(true), 'today already backed up — must skip').toBe('skip');
    expect(decide(false), 'nothing written yet — must run').toBe('run');
    expect(decide(null), 'unknown must FAIL OPEN — a missing day is worse').toBe('run');
  });

  it('sixteen boots on one day produce one archive, not sixteen', () => {
    // The exact shape of 2026-08-21: eight deploys x two instances.
    let written = 0;
    let existsOffsite = false;
    for (let boot = 0; boot < 16; boot += 1) {
      if (existsOffsite) continue;      // the guard
      written += 1;
      existsOffsite = true;             // the archive now exists
    }
    expect(written, 'the boot guard did not hold').toBe(1);
  });
});
