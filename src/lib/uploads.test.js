// ─── uploads.test.js ─────────────────────────────────────────────────────────
// Two things matter here and they are both about not wasting someone's time.
//
// 1. THE CLIENT AND SERVER LISTS MUST AGREE. Accepting something the server
//    refuses makes a customer wait through a 90 MB upload to be told no.
//    Refusing something the server would have taken rejects a working file for
//    no reason. The list is duplicated on purpose (see uploads.js) — this is
//    the check that makes the duplication safe rather than hopeful.
//
// 2. NOTHING IS DROPPED SILENTLY. Someone dragging in a folder must be told
//    exactly which files did not make it, or they find out when the export is
//    missing something.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ACCEPTED_MIME, MAX_BYTES, IMAGE_SECONDS, kindOfFile, humanSize,
  validateFile, sortDropped, labelForFile,
} from './uploads.js';

const file = (name, type, size = 1024) => ({ name, type, size });

describe('the client list matches the server list exactly', () => {
  // The duplication is deliberate; this is what keeps it honest.
  const guard = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'server', 'src', 'upload-guard.js'),
    'utf8',
  );
  const serverList = [...guard.matchAll(/'((?:image|video|audio)\/[a-z0-9.+-]+)'/g)].map((m) => m[1]);

  it('finds the server list — an empty match would make this test vacuous', () => {
    expect(serverList.length).toBeGreaterThan(10);
  });

  it('accepts nothing the server would refuse', () => {
    const extra = ACCEPTED_MIME.filter((m) => !serverList.includes(m));
    expect(extra, `client accepts these but the server does not: ${extra.join(', ')}`).toEqual([]);
  });

  it('refuses nothing the server would have taken', () => {
    const missing = serverList.filter((m) => !ACCEPTED_MIME.includes(m));
    expect(missing, `server takes these but the client refuses them: ${missing.join(', ')}`).toEqual([]);
  });

  it('uses the same size limit as multer', () => {
    const index = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'server', 'src', 'index.js'), 'utf8',
    );
    expect(index).toMatch(/fileSize:\s*100\s*\*\s*1024\s*\*\s*1024/);
    expect(MAX_BYTES).toBe(100 * 1024 * 1024);
  });
});

describe('refusing a file', () => {
  it('says the SIZE and the limit, not just "too large"', () => {
    const v = validateFile(file('holiday.mp4', 'video/mp4', 250 * 1024 * 1024));
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/250 MB/);
    expect(v.reason).toMatch(/100 MB/);
    expect(v.reason).toMatch(/holiday\.mp4/);
  });

  it('names the file and its type when the type is wrong', () => {
    const v = validateFile(file('notes.pdf', 'application/pdf'));
    expect(v.reason).toMatch(/notes\.pdf/);
    expect(v.reason).toMatch(/application\/pdf/);
  });

  it('rejects an empty file rather than uploading nothing', () => {
    expect(validateFile(file('x.mp4', 'video/mp4', 0)).ok).toBe(false);
  });

  it('LETS THE SERVER DECIDE when the browser gives no type', () => {
    // Some systems report an empty type for less common formats. Refusing here
    // would be a guess, and the server sniffs the real magic bytes — it is the
    // authority, so a valid file must not be blocked on our side first.
    const v = validateFile(file('song.aiff', '', 5000));
    expect(v.ok).toBe(true);
    expect(v.unknownType).toBe(true);
  });

  it('survives being handed nothing', () => {
    expect(validateFile(null).ok).toBe(false);
    expect(validateFile(undefined).ok).toBe(false);
  });
});

describe('what a file becomes', () => {
  it('maps to the right track kind', () => {
    expect(kindOfFile(file('a.mp4', 'video/mp4'))).toBe('video');
    expect(kindOfFile(file('a.mp3', 'audio/mpeg'))).toBe('audio');
    expect(kindOfFile(file('a.png', 'image/png'))).toBe('image');
    expect(kindOfFile(file('a.bin', 'application/octet-stream'))).toBeNull();
  });

  it('gives an image a real length — it has none of its own', () => {
    // A zero-length clip is invisible on the timeline and impossible to grab.
    expect(IMAGE_SECONDS).toBeGreaterThan(0);
  });
});

describe('a folder dropped in one go', () => {
  it('takes the good ones and reports the bad ones — never silently drops', () => {
    // The failure this prevents: thirty-seven files arrive, three do not, and
    // nobody notices until the export is missing something.
    const { accepted, rejected } = sortDropped([
      file('a.mp4', 'video/mp4'),
      file('b.pdf', 'application/pdf'),
      file('c.mp3', 'audio/mpeg'),
      file('d.mov', 'video/quicktime', 200 * 1024 * 1024),
    ]);
    expect(accepted.map((a) => a.file.name)).toEqual(['a.mp4', 'c.mp3']);
    expect(rejected.map((r) => r.file.name)).toEqual(['b.pdf', 'd.mov']);
    expect(rejected.every((r) => r.reason)).toBe(true);
  });

  it('survives an empty drop', () => {
    expect(sortDropped([]).accepted).toEqual([]);
    expect(sortDropped(null).accepted).toEqual([]);
  });
});

describe('small mercies', () => {
  it('reads sizes the way a person would', () => {
    expect(humanSize(1024)).toBe('1 KB');
    expect(humanSize(5 * 1024 * 1024)).toBe('5 MB');
    expect(humanSize(0)).toBe('0 B');
  });

  it('drops the extension from the label but keeps the name', () => {
    expect(labelForFile(file('Company Logo.png', 'image/png'))).toBe('Company Logo');
  });

  it('truncates a very long name instead of breaking the row', () => {
    const long = `${'x'.repeat(80)}.mp4`;
    expect(labelForFile(file(long, 'video/mp4')).length).toBeLessThanOrEqual(40);
  });
});
