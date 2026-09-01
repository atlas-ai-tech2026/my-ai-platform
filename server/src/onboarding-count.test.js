// ─── onboarding-count.test.js ────────────────────────────────────────────────
// THE SCREEN COUNT LIVES IN TWO FILES.
//
// The questions are front-end (src/lib/onboarding-questions.js); the funnel is
// server-side (server/src/onboarding.js). The server has no business importing
// the front-end file, so the number is written twice — and two copies of a
// number is a promise to let them drift.
//
// A mismatch is not cosmetic. If the server thinks there are four screens and
// there are three, the funnel draws a fourth bar that is always zero, and the
// only reading of that chart is "every single customer quits at the end".

import { describe, it, expect } from 'vitest';
import { SCREEN_COUNT as SERVER_COUNT, summarise } from './onboarding.js';
import { SCREENS, SCREEN_COUNT as CLIENT_COUNT } from '../../src/lib/onboarding-questions.js';

describe('☠ THE TWO COUNTS AGREE', () => {
  it('the server knows how many screens the customer is shown', () => {
    expect(SERVER_COUNT).toBe(CLIENT_COUNT);
    expect(SERVER_COUNT).toBe(SCREENS.length);
  });

  it('and the funnel has exactly that many bars', () => {
    const s = summarise([{ onboarding: { reached: 1, answers: {} }, onboarded_at: null }]);
    expect(s.funnel).toHaveLength(SCREENS.length);
  });

  it('☠ a phantom final bar would read as "everybody quits at the end"', () => {
    // Proving the failure mode rather than asserting a number: with a count
    // one too high, the last bar is 0 while people did finish.
    const rows = [{ onboarding: { reached: 3, answers: {} }, onboarded_at: '2026-09-01' }];
    const honest = summarise(rows, SCREENS.length);
    const wrong = summarise(rows, SCREENS.length + 1);
    expect(honest[Symbol.iterator] === undefined);
    expect(honest.funnel.at(-1).reached).toBe(1);
    expect(wrong.funnel.at(-1).reached).toBe(0);   // the lie this test prevents
  });
});
