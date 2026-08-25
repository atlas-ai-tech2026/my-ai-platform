// ─── edit-cut-flag.test.js ───────────────────────────────────────────────────
// This flag is the ONLY thing standing between an unfinished editor and every
// signed-in customer on voxel-ai.ai. Ninety-one commits ship together because
// of it, so the failure that matters is not "the flag does not work" — it is
// "the flag defaults the wrong way in a case nobody thought about".
//
// So most of this file is about the DEFAULT: every shape of missing, empty,
// broken or unexpected environment must land on the waitlist.

import { describe, it, expect } from 'vitest';
import { editCutEnabled } from './edit-cut-flag.js';

const prod = (env = {}) => editCutEnabled({ env, hostname: 'voxel-ai.ai' });

describe('production is hidden by DEFAULT — no variable required', () => {
  it('hides Edit Cut on voxel-ai.ai with an empty environment', () => {
    // The property that lets this ship without touching .do/app.yaml at all.
    expect(prod({})).toBe(false);
  });

  it.each([
    ['undefined', undefined],
    ['empty string', ''],
    ['whitespace', '   '],
    ['null', null],
    ['a misspelling', 'onn'],
    ['a leftover from another app', 'yes-please'],
    ['a number', 0],
    ['an object', {}],
  ])('stays hidden when the flag is %s', (_label, value) => {
    // Any of these arriving in production must fail towards the waitlist.
    expect(prod({ VITE_EDIT_CUT: value })).toBe(false);
  });

  it('hides it on www too', () => {
    expect(editCutEnabled({ env: {}, hostname: 'www.voxel-ai.ai' })).toBe(false);
  });
});

describe('the switch Amr flips when it is ready', () => {
  it.each(['on', 'true', '1', 'ON', ' On '])('shows it in production for %s', (v) => {
    // One variable in the DigitalOcean panel. No code change, no pull request.
    expect(prod({ VITE_EDIT_CUT: v })).toBe(true);
  });
});

describe('dev and localhost show it without any variable', () => {
  it.each(['dev.voxel-ai.ai', 'localhost', '127.0.0.1'])('shows it on %s', (h) => {
    expect(editCutEnabled({ env: {}, hostname: h })).toBe(true);
  });

  it('an explicit OFF wins on dev, so dev can be made to look like production', () => {
    // For checking what a customer sees, without editing code.
    expect(editCutEnabled({ env: { VITE_EDIT_CUT: 'off' }, hostname: 'dev.voxel-ai.ai' })).toBe(false);
  });
});

describe('the hostname cannot be spoofed into revealing it', () => {
  it.each([
    'dev.voxel-ai.ai.evil.com',
    'notdev.voxel-ai.ai',
    'localhost.attacker.net',
    'my-dev.voxel-ai.ai',
  ])('does not match %s', (h) => {
    // A substring test would pass all of these. Exact matches only — a flag
    // that a hostname can talk its way past is not a flag.
    expect(editCutEnabled({ env: {}, hostname: h })).toBe(false);
  });
});

describe('it never throws', () => {
  it('survives being called with nothing at all', () => {
    // It runs during render. An exception here is a blank page, which is worse
    // than either answer it could have given.
    expect(() => editCutEnabled()).not.toThrow();
    expect(editCutEnabled()).toBe(false);
    expect(editCutEnabled({})).toBe(false);
    expect(editCutEnabled({ env: null, hostname: null })).toBe(false);
  });
});
