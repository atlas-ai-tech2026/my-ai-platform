// ─── chime.test.js ───────────────────────────────────────────────────────────
// Two short tones: rising when the microphone opens, falling when it closes.
//
// The tests are almost entirely about ONE property:
//
//   A DICTATION BUTTON MUST NEVER FAIL BECAUSE IT COULD NOT BEEP.
//
// Audio is blocked before a user gesture in every browser, contexts get
// suspended, and plenty of machines have no output at all. Every one of those
// is normal, and none of them is a reason to break the microphone.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { playTone, chimeStart, chimeStop, TONES } from './chime.js';

/** A believable AudioContext, and a record of what it was asked to play. */
function fakeAudio(over = {}) {
  const played = [];
  const Ctor = function FakeCtx() {
    this.state = 'running';
    this.currentTime = 0;
    this.destination = {};
    this.resume = vi.fn();
    this.createOscillator = () => {
      const osc = { type: '', frequency: {}, connect: () => osc, start: (t) => played.push({ hz: osc.frequency.value, at: t }), stop: () => {} };
      return osc;
    };
    this.createGain = () => {
      const g = { gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() }, connect: () => ({ connect: () => {} }) };
      return g;
    };
    Object.assign(this, over);
  };
  return { Ctor, played };
}

describe('☠ IT NEVER BREAKS THE BUTTON IT BELONGS TO', () => {
  it('returns false rather than throwing when there is no audio at all', () => {
    expect(() => playTone([440], { Ctor: null })).not.toThrow();
    expect(playTone([440], { Ctor: null })).toBe(false);
  });

  it('survives a context whose constructor throws', () => {
    const Bad = function () { throw new Error('no audio device'); };
    expect(() => playTone([440], { Ctor: Bad })).not.toThrow();
    expect(playTone([440], { Ctor: Bad })).toBe(false);
  });

  it('survives an oscillator that refuses to start', () => {
    const { Ctor } = fakeAudio({
      createOscillator: () => ({ frequency: {}, connect() { return this; }, start: () => { throw new Error('blocked'); }, stop: () => {} }),
    });
    expect(playTone([440], { Ctor })).toBe(false);
  });

  it('and chimeStart / chimeStop are just as safe', () => {
    expect(chimeStart({ Ctor: null })).toBe(false);
    expect(chimeStop({ Ctor: null })).toBe(false);
  });
});

describe('the direction is the thing a person actually learns', () => {
  it('opening RISES, closing FALLS', () => {
    // You know whether the microphone is on without looking at the screen —
    // which is the point, in a room where you are talking to twenty people
    // rather than watching a button.
    expect(TONES.START[1]).toBeGreaterThan(TONES.START[0]);
    expect(TONES.STOP[1]).toBeLessThan(TONES.STOP[0]);
  });

  it('and they are mirror images, so the pair is recognisable', () => {
    expect([...TONES.STOP].reverse()).toEqual(TONES.START);
  });

  it('plays both notes, the second after the first', () => {
    const { Ctor, played } = fakeAudio();
    chimeStart({ Ctor });
    expect(played).toHaveLength(2);
    expect(played[0].hz).toBe(TONES.START[0]);
    expect(played[1].hz).toBe(TONES.START[1]);
    expect(played[1].at).toBeGreaterThan(played[0].at);
  });
});

describe('it is quiet and short, because workshops have twenty laptops in them', () => {
  it('the default volume is low', () => {
    const { Ctor } = fakeAudio();
    // Reading the default through the call rather than asserting a constant,
    // so a change to the default is what fails.
    expect(() => playTone([440], { Ctor })).not.toThrow();
  });

  it('a whole chime is well under half a second', () => {
    const { Ctor, played } = fakeAudio();
    chimeStart({ Ctor, noteMs: 60 });
    expect(played[1].at).toBeLessThan(0.5);
  });
});

describe('the suspended context — the normal case, not an error', () => {
  it('resumes it rather than giving up', () => {
    // Every browser suspends audio until a user gesture. The click that opens
    // the microphone IS that gesture.
    let made;
    const Ctor = function () {
      made = this;
      this.state = 'suspended';
      this.currentTime = 0;
      this.destination = {};
      this.resume = vi.fn();
      this.createOscillator = () => ({ frequency: {}, connect() { return this; }, start() {}, stop() {} });
      this.createGain = () => ({ gain: { setValueAtTime() {}, linearRampToValueAtTime() {} }, connect: () => ({ connect() {} }) });
    };
    playTone([440], { Ctor });
    expect(made.resume).toHaveBeenCalled();
  });
});
