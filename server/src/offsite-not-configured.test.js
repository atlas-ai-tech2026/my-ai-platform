// ─── offsite-not-configured.test.js ──────────────────────────────────────────
// AN UNCONFIGURED BUCKET MUST SAY SO, NOT THROW A TypeError AT A STATUS SCREEN.
//
// ── WHAT WAS ON THE SCREEN ─────────────────────────────────────────────────
// The SOP tab's Daily backup line, on dev, 2026-09-01:
//
//   Backblaze (offsite): could not be read: Cannot read properties of
//   undefined (reading 'trim')
//   Do: An unverified backup is not a backup — find out why this bucket
//       could not be listed.
//
// Two lines below, the Backblaze storage line reported the SAME condition
// correctly — "offsite storage is not configured in this environment" —
// because measureOffsiteUsage checked offsiteConfigured() first and
// listOffsite did not.
//
// Dev has no offsite bucket BY DESIGN (#51). So that line was permanently red
// on dev, with an action telling somebody to investigate a Backblaze fault
// that does not exist. A screen that cries wolf where it is safe is a screen
// people learn to skim where it is not.
//
// The cause was eleven bare `env.OFFSITE_S3_BUCKET.trim()` reads. Eight sat
// behind a guard; three did not, and one of those three DELETES.

import { describe, it, expect } from 'vitest';
import {
  listOffsite, pruneOffsite, uploadOffsite, measureOffsiteUsage,
  offsiteConfigured, OFFSITE_NOT_CONFIGURED,
} from './backup-offsite.js';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const NONE = {};   // an environment with no offsite configured — i.e. dev

const says = async (fn) => {
  try { await fn(); return null; }
  catch (e) { return e.message; }
};

describe('☠ NO PATH MAY LEAK A TypeError TO A STATUS LINE', () => {
  it('listing says it plainly — this is the line that was on screen', async () => {
    expect(await says(() => listOffsite('backups/', NONE))).toBe(OFFSITE_NOT_CONFIGURED);
  });

  it('uploading says it plainly', async () => {
    expect(await says(() => uploadOffsite('backups/x', Buffer.from('x'), NONE)))
      .toBe(OFFSITE_NOT_CONFIGURED);
  });

  it('☠ and PRUNING says it plainly — that one deletes', async () => {
    expect(await says(() => pruneOffsite({ prefix: 'backups/', keep: 5, dryRun: true }, NONE)))
      .toBe(OFFSITE_NOT_CONFIGURED);
  });

  it('not one of them mentions "trim" or "undefined"', async () => {
    const msgs = [
      await says(() => listOffsite('backups/', NONE)),
      await says(() => uploadOffsite('backups/x', Buffer.from('x'), NONE)),
      await says(() => pruneOffsite({ prefix: 'backups/', keep: 5, dryRun: true }, NONE)),
    ];
    for (const m of msgs) {
      expect(m, 'a JavaScript error is reaching the screen').not.toMatch(/trim|undefined|TypeError/i);
    }
  });

  it('the measurement path still gives the SAME sentence, not a second wording', async () => {
    // Two explanations for one condition is how a screen stops being trusted.
    const r = await measureOffsiteUsage(NONE);
    expect(r.error).toBe(OFFSITE_NOT_CONFIGURED);
  });
});

describe('☠ THE LANDMINE CANNOT BE RE-LAID', () => {
  it('nothing names the bucket without going through the guard', () => {
    // The fix is not "I added three checks" — it is that there is no longer a
    // way to read the bucket name unguarded. Asserted against the source,
    // because the next bare .trim() would be added by someone who never read
    // this file.
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, 'backup-offsite.js'), 'utf8');
    const bare = src.match(/env\.OFFSITE_S3_BUCKET\s*\.\s*trim\(\)/g) || [];
    // The single permitted occurrence is inside offsiteBucket() itself.
    expect(bare.length, `${bare.length} bare bucket reads — route them through offsiteBucket()`)
      .toBe(1);
  });

  it('and the client refuses before the SDK is ever handed an undefined', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, 'backup-offsite.js'), 'utf8');
    const at = src.indexOf('function buildOffsiteClient');
    expect(at).toBeGreaterThan(-1);
    const head = src.slice(at, at + 400);
    expect(head).toMatch(/if \(!offsiteConfigured\(env\)\) throw new Error\(OFFSITE_NOT_CONFIGURED\)/);
  });
});

describe('☠ AND THE GUARD ITSELF MUST NOT BE THE BUG', () => {
  it('a CONFIGURED environment gets the bucket name, not a stack overflow', async () => {
    // Routing every read through offsiteBucket() was done with a replace-all,
    // which also rewrote the helper's OWN body into `return offsiteBucket(env)`.
    // Every not-configured test still passed, because those throw before
    // reaching the return — so the recursion was invisible EXCEPT where offsite
    // is actually set up, which is production only.
    //
    // Hence a configured environment, pointed at a port nothing listens on: it
    // must fail at the NETWORK, which proves the name was produced and handed
    // to the SDK.
    const env = {
      OFFSITE_S3_ENDPOINT: 'https://127.0.0.1:1', OFFSITE_S3_REGION: 'us-east-005',
      OFFSITE_S3_BUCKET: '  voxel-offsite-backups  ', OFFSITE_S3_KEY: 'k', OFFSITE_S3_SECRET: 's',
    };
    const msg = await says(() => listOffsite('backups/', env));
    expect(msg, 'the guard recursed into itself').not.toMatch(/Maximum call stack/i);
    expect(msg, 'it did not get as far as the network').toMatch(/ECONNREFUSED|connect|socket|timeout/i);
  });
});

describe('a CONFIGURED environment is unaffected', () => {
  it('offsiteConfigured still recognises a complete set', () => {
    expect(offsiteConfigured({
      OFFSITE_S3_ENDPOINT: 'https://s3.example', OFFSITE_S3_REGION: 'us-east-005',
      OFFSITE_S3_BUCKET: 'voxel-offsite-backups', OFFSITE_S3_KEY: 'k', OFFSITE_S3_SECRET: 's',
    })).toBe(true);
  });

  it('and a half-configured one is still refused, not half-attempted', () => {
    // Missing the secret is the case that would otherwise build a client and
    // fail later, at the bucket, with something unreadable.
    expect(offsiteConfigured({
      OFFSITE_S3_ENDPOINT: 'https://s3.example', OFFSITE_S3_REGION: 'us-east-005',
      OFFSITE_S3_BUCKET: 'b', OFFSITE_S3_KEY: 'k',
    })).toBe(false);
  });
});
