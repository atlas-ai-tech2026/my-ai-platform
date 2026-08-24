// ─── edit-permissions.test.js ────────────────────────────────────────────────
// The gate that decides whether the assistant may spend a customer's money
// while they are looking somewhere else.
//
// Almost every test here is about REFUSING. That asymmetry is deliberate: a
// gate that wrongly allows costs somebody money and shows up on a bill weeks
// later; a gate that wrongly refuses costs one click and says why. Only one of
// those failures is recoverable, so everything unclear resolves to "no".

import { describe, it, expect } from 'vitest';
import {
  CATEGORIES, CATEGORY_IDS, categoryOf, defaults, readPermissions, writePermissions,
  allows, canSpend, PERMISSION_KEY,
} from './edit-permissions';

/** A localStorage that is real enough to test against. */
const fakeStore = (initial = {}) => {
  const map = { ...initial };
  return {
    getItem: (k) => (k in map ? map[k] : null),
    setItem: (k, v) => { map[k] = String(v); },
    _map: map,
  };
};

describe('the defaults are the whole point', () => {
  it('free editing is ON and everything that bills is OFF', () => {
    // ChatCut's defaults, and they are right: refusing free local edits would
    // make the assistant useless while protecting nobody.
    const d = defaults();
    expect(d.localEdits).toBe(true);
    expect(d.videoGeneration).toBe(false);
    expect(d.imageGeneration).toBe(false);
    expect(d.audioGeneration).toBe(false);
  });

  it('NOTHING that spends money is on out of the box', () => {
    expect(canSpend(defaults())).toBe(false);
  });

  it('every category is either free or metered — none unclassified', () => {
    for (const id of CATEGORY_IDS) {
      expect(['free', 'metered']).toContain(CATEGORIES[id].billing);
    }
  });
});

describe('classifying an operation', () => {
  it('puts free timeline work in localEdits', () => {
    expect(categoryOf('trim')).toBe('localEdits');
    expect(categoryOf('resize')).toBe('localEdits');
  });

  it('puts paid work in the category that matches what it spends on', () => {
    expect(categoryOf('generateMusic')).toBe('audioGeneration');
    expect(categoryOf('generateVoice')).toBe('audioGeneration');
    expect(categoryOf('upscale')).toBe('imageGeneration');
    expect(categoryOf('removeBackground')).toBe('imageGeneration');
    expect(categoryOf('omniEdit')).toBe('videoGeneration');
    expect(categoryOf('generativeResize')).toBe('videoGeneration');
  });

  it('returns null for something nobody has classified', () => {
    expect(categoryOf('teleport')).toBe(null);
  });
});

describe('refusing is the default answer', () => {
  it('allows a free edit out of the box', () => {
    expect(allows(defaults(), 'trim').ok).toBe(true);
  });

  it('REFUSES paid work out of the box, and says why and what to do', () => {
    const r = allows(defaults(), 'generateMusic');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/Music and voice is switched off/);
    expect(r.reason, 'a refusal must offer a way forward').toMatch(/settings|yourself/);
  });

  it('allows paid work once that category is switched on', () => {
    expect(allows({ ...defaults(), audioGeneration: true }, 'generateMusic').ok).toBe(true);
  });

  it('switching one category on does NOT open the others', () => {
    const p = { ...defaults(), audioGeneration: true };
    expect(allows(p, 'upscale').ok).toBe(false);
    expect(allows(p, 'omniEdit').ok).toBe(false);
  });

  it('REFUSES an operation it cannot classify', () => {
    // Treating unknown as permitted is how a gate stops being a gate.
    const r = allows(defaults(), 'teleport');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/don't know what .*teleport.* costs/);
  });

  it('refuses when handed no permissions at all', () => {
    expect(allows(undefined, 'generateMusic').ok).toBe(false);
    expect(allows(null, 'upscale').ok).toBe(false);
  });
});

describe('what was saved cannot surprise us', () => {
  it('reads back what was written', () => {
    const s = fakeStore();
    writePermissions(s, { ...defaults(), videoGeneration: true });
    expect(readPermissions(s).videoGeneration).toBe(true);
  });

  it('falls back to the DEFAULTS when there is nothing saved', () => {
    expect(readPermissions(fakeStore())).toEqual(defaults());
  });

  it('a DAMAGED settings blob does not become permission to spend', () => {
    // The failure worth designing against: silent, and only visible on a bill.
    for (const junk of ['{ not json', 'null', '"yes"', '[]', '42']) {
      const s = fakeStore({ [PERMISSION_KEY]: junk });
      expect(canSpend(readPermissions(s)), `junk: ${junk}`).toBe(false);
    }
  });

  it('only a literal true counts as yes', () => {
    // "yes", 1 and {} are not a decision somebody made — they are a file that
    // went wrong.
    const s = fakeStore({ [PERMISSION_KEY]: JSON.stringify({ videoGeneration: 1, imageGeneration: 'yes', audioGeneration: {} }) });
    const p = readPermissions(s);
    expect(p.videoGeneration).toBe(false);
    expect(p.imageGeneration).toBe(false);
    expect(p.audioGeneration).toBe(false);
  });

  it('an unknown key in the saved blob is ignored, not adopted', () => {
    const s = fakeStore({ [PERMISSION_KEY]: JSON.stringify({ ...defaults(), everything: true }) });
    expect(readPermissions(s).everything).toBeUndefined();
  });

  it('writing normalises to booleans so the file cannot drift', () => {
    const s = fakeStore();
    writePermissions(s, { localEdits: 'yes', videoGeneration: 1 });
    expect(JSON.parse(s._map[PERMISSION_KEY])).toEqual({
      localEdits: false, videoGeneration: false, imageGeneration: false, audioGeneration: false,
    });
  });

  it('survives storage being switched off entirely', () => {
    // Private browsing throws on setItem. A settings panel must not take the
    // editor down with it.
    const angry = { getItem: () => { throw new Error('nope'); }, setItem: () => { throw new Error('nope'); } };
    expect(readPermissions(angry)).toEqual(defaults());
    expect(() => writePermissions(angry, defaults())).not.toThrow();
    expect(readPermissions(undefined)).toEqual(defaults());
  });
});

describe('knowing when money is at stake', () => {
  it('says so as soon as ONE paid category is on', () => {
    expect(canSpend({ ...defaults(), imageGeneration: true })).toBe(true);
  });

  it('free editing alone is not spending', () => {
    expect(canSpend({ localEdits: true })).toBe(false);
  });
});
