// ─── dev-only.test.js ────────────────────────────────────────────────────────
// A gate is only worth having if it fails towards HIDDEN.

import { describe, it, expect } from 'vitest';
import { isDevHost, DEV_HOSTS } from './dev-only.js';

describe('☠ IT FAILS TOWARDS HIDDEN', () => {
  it('hides on production', () => {
    expect(isDevHost('voxel-ai.ai')).toBe(false);
    expect(isDevHost('www.voxel-ai.ai')).toBe(false);
  });

  it('hides for every kind of nothing', () => {
    for (const bad of [undefined, null, '', '   ', 0, false, {}, []]) {
      expect(isDevHost(bad)).toBe(false);
    }
  });

  it('is not fooled by a lookalike domain', () => {
    // A substring test would accept all of these. That is the whole reason
    // this is a Set of exact strings.
    expect(isDevHost('dev.voxel-ai.ai.evil.com')).toBe(false);
    expect(isDevHost('notdev.voxel-ai.ai')).toBe(false);
    expect(isDevHost('evil.com/dev.voxel-ai.ai')).toBe(false);
    expect(isDevHost('dev.voxel-ai.ai.co')).toBe(false);
  });

  it('shows on ours, whatever the casing', () => {
    expect(isDevHost('dev.voxel-ai.ai')).toBe(true);
    expect(isDevHost('DEV.Voxel-AI.ai')).toBe(true);
    expect(isDevHost('  localhost  ')).toBe(true);
    expect(isDevHost('127.0.0.1')).toBe(true);
  });

  it('production is not in the list, and cannot drift into it unnoticed', () => {
    expect(DEV_HOSTS.has('voxel-ai.ai')).toBe(false);
    expect([...DEV_HOSTS].every((h) => h === 'dev.voxel-ai.ai' || /^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/.test(h))).toBe(true);
  });
});
