// ─── prompt-draft.test.js ────────────────────────────────────────────────────
// The failure modes here are the ones nobody handles because they are awkward
// to reproduce: storage that throws on ACCESS, a quota that fills mid-write, a
// payload from a newer deploy. Storage is injected so each one is proven.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  saveDraft, loadDraft, clearDrafts, DRAFT_PREFIX, DRAFT_SCHEMA, DRAFT_PAGES,
} from './prompt-draft.js';

/** A storage that behaves, unless told otherwise. */
const fake = (initial = {}) => {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _dump: () => Object.fromEntries(m),
  };
};

const FIELDS = {
  prompt: 'a cinematic portrait',
  imageUrls: ['https://voxel-ai-store.nyc3.cdn.digitaloceanspaces.com/generations/reference/a.png'],
  model: 'Nano Banana Pro',
  ratio: '16:9',
};

describe('a draft survives leaving the page', () => {
  it('comes back exactly as it went in', () => {
    const s = fake();
    expect(saveDraft('image', FIELDS, { storage: s }).ok).toBe(true);
    expect(loadDraft('image', { storage: s })).toEqual(FIELDS);
  });

  it('keeps the reference URLs, which is the point', () => {
    // They are durable Spaces links by the time they are attached, so nothing
    // has to be re-uploaded.
    const s = fake();
    saveDraft('image', FIELDS, { storage: s });
    expect(loadDraft('image', { storage: s }).imageUrls).toHaveLength(1);
  });

  it('keeps image and video apart', () => {
    const s = fake();
    saveDraft('image', { prompt: 'an image' }, { storage: s });
    saveDraft('video', { prompt: 'a video' }, { storage: s });
    expect(loadDraft('image', { storage: s }).prompt).toBe('an image');
    expect(loadDraft('video', { storage: s }).prompt).toBe('a video');
  });

  it('returns null when there is nothing stored', () => {
    expect(loadDraft('image', { storage: fake() })).toBe(null);
  });

  it('refuses a page it does not know', () => {
    const s = fake();
    expect(saveDraft('audio', FIELDS, { storage: s }).ok).toBe(false);
    expect(Object.keys(s._dump())).toHaveLength(0);
  });
});

describe('storage that misbehaves', () => {
  it('reports a failed save instead of claiming success', () => {
    const s = { ...fake(), setItem: () => { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; } };
    const r = saveDraft('image', FIELDS, { storage: s });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('storage full');
  });

  it('survives storage being unavailable entirely', () => {
    // Cookies blocked: the property access itself throws, before any read.
    expect(saveDraft('image', FIELDS, { storage: null }).ok).toBe(false);
    expect(loadDraft('image', { storage: null })).toBe(null);
    expect(clearDrafts({ storage: null }).ok).toBe(false);
  });

  it('survives a getItem that throws', () => {
    const s = { ...fake(), getItem: () => { throw new Error('blocked'); } };
    expect(loadDraft('image', { storage: s })).toBe(null);
  });
});

describe('a damaged or unfamiliar draft', () => {
  it('moves a corrupt draft aside rather than deleting it', () => {
    // BUILD BEFORE YOU DELETE applies to bytes in storage too — that string may
    // be the only copy of what somebody typed.
    const s = fake({ [`${DRAFT_PREFIX}image`]: '{ not json' });
    expect(loadDraft('image', { storage: s })).toBe(null);
    expect(s.getItem(`${DRAFT_PREFIX}image:damaged`)).toBe('{ not json');
    expect(s.getItem(`${DRAFT_PREFIX}image`)).toBe(null);
  });

  it('refuses a NEWER schema and leaves it untouched', () => {
    // Two tabs during a deploy. Reading it would mean saving a truncated
    // version back over the good one.
    const doc = JSON.stringify({ v: DRAFT_SCHEMA + 1, fields: { prompt: 'from the future' } });
    const s = fake({ [`${DRAFT_PREFIX}image`]: doc });
    expect(loadDraft('image', { storage: s })).toBe(null);
    expect(s.getItem(`${DRAFT_PREFIX}image`)).toBe(doc);   // still there, unharmed
  });

  it('ignores an older schema rather than guessing at it', () => {
    const s = fake({ [`${DRAFT_PREFIX}image`]: JSON.stringify({ v: 0, fields: { prompt: 'old' } }) });
    expect(loadDraft('image', { storage: s })).toBe(null);
  });
});

describe('☠ logout must destroy every draft', () => {
  // A workshop laptop is shared. The next person to sign in must not find the
  // last person's prompt and their uploaded photographs in the box.
  it('clears both pages, and the damaged copies too', () => {
    const s = fake();
    saveDraft('image', FIELDS, { storage: s });
    saveDraft('video', { prompt: 'v' }, { storage: s });
    s.setItem(`${DRAFT_PREFIX}image:damaged`, 'junk');
    expect(clearDrafts({ storage: s }).cleared).toBe(3);
    for (const p of DRAFT_PAGES) expect(loadDraft(p, { storage: s })).toBe(null);
    expect(s.getItem(`${DRAFT_PREFIX}image:damaged`)).toBe(null);
  });

  it('AuthContext.logout actually calls it — not just intends to', () => {
    // The module could be perfect and never wired in. That is this project's
    // most-repeated bug, so the wiring is asserted rather than assumed.
    const src = readFileSync(path.resolve(process.cwd(), 'src/lib/AuthContext.jsx'), 'utf8');
    expect(src, 'AuthContext must import clearDrafts').toMatch(/clearDrafts/);
    const logout = src.slice(src.indexOf('const logout'));
    const body = logout.slice(0, logout.indexOf('}, ['));
    expect(body, 'clearDrafts() must be called inside logout()').toMatch(/clearDrafts\(\)/);
  });
});
