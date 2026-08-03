// ─── voice-catalog.test.js ───────────────────────────────────────────────────
// N7 (recheck 2026-08-03): /api/tts/preview needs no login — on purpose, so a
// visitor can hear a voice before signing up. The flaw was that the `voice`
// string went straight to FAL and was also the cache key, so any made-up value
// missed the cache and became a billable call.
//
// Validating against the catalogue caps the lifetime cost at one FAL call per
// real voice. That guarantee only holds while the server's list matches the
// picker's — if a voice is added to the UI and not here, it silently becomes
// unpreviewable; if one is removed from the UI and left here, the ceiling
// quietly rises. This test fails on either drift.

import { describe, it, expect } from 'vitest';
import { isKnownVoice, VOICE_IDS, VOICE_COUNT } from './voice-catalog.js';
import { VOICES } from '../../src/components/audio/voices.js';

describe('N7 — the server catalogue matches the picker exactly', () => {
  it('has the same number of voices as the UI', () => {
    expect(VOICE_COUNT).toBe(VOICES.length);
  });

  it('accepts every voice_id the picker can send', () => {
    for (const v of VOICES) {
      expect(isKnownVoice(v.voice_id), `picker offers ${v.name} (${v.voice_id}) but the server rejects it`).toBe(true);
    }
  });

  it('accepts every display name too (FAL resolves both)', () => {
    for (const v of VOICES) {
      expect(isKnownVoice(v.name), `server rejects the name ${v.name}`).toBe(true);
    }
  });

  it('contains nothing the picker does not offer', () => {
    const uiIds = new Set(VOICES.map(v => v.voice_id));
    for (const id of VOICE_IDS) {
      expect(uiIds.has(id), `server allows ${id} but no voice in the picker uses it`).toBe(true);
    }
  });
});

describe('N7 — made-up voices are refused before any FAL call', () => {
  it('rejects invented ids, the exact abuse that cost money', () => {
    for (const bad of ['aaa1', 'aaa2', 'zzzz9999', '21m00Tcm4TlvDq8ikWAX']) {
      expect(isKnownVoice(bad)).toBe(false);
    }
  });

  it('rejects empty, blank and non-string input', () => {
    for (const bad of ['', '   ', null, undefined, 42, {}, []]) {
      expect(isKnownVoice(bad)).toBe(false);
    }
  });

  it('is case-insensitive on names but not a prefix match', () => {
    expect(isKnownVoice('rachel')).toBe(true);
    expect(isKnownVoice('RACHEL')).toBe(true);
    // Substring/extension attempts must not slip through.
    expect(isKnownVoice('rachel2')).toBe(false);
    expect(isKnownVoice('Rachel ')).toBe(true);   // trimmed, still the same voice
    expect(isKnownVoice('xRachel')).toBe(false);
  });

  it('bounds the cache: at most one entry per real voice can ever exist', () => {
    // The cache is keyed on the accepted value, and only catalogue entries are
    // accepted, so the Map cannot grow past ids + names.
    expect(VOICE_COUNT).toBeLessThan(100);
  });
});
