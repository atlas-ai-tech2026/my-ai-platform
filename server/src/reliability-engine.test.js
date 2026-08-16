// ─── reliability-engine.test.js ──────────────────────────────────────────────
// The failure mode here is not a wrong number. It is a CONFIDENT number.
//
// This screen decides which models get demonstrated in front of 170 people, so
// "100% reliable" computed from twelve attempts is worse than saying nothing —
// it reads as an endorsement. And because no failure row records which model
// failed, every figure on the screen rests on an inference (refund matched to
// the spend it reverses, 91% recoverable). The tests below are mostly about
// refusing to overstate that.

import { describe, it, expect } from 'vitest';
import {
  verdict, confidenceOf, buildReport, summarise, MIN_ATTEMPTS, BANDS,
} from './reliability-engine.js';

describe('the verdict a workshop actually needs', () => {
  it('endorses a model that rarely fails', () => {
    const v = verdict(3272, 41);            // Nano Banana Pro, real numbers
    expect(v.key).toBe('teach');
    expect(v.note).toMatch(/live demo/);
  });

  it('warns on a rate you would notice in a big room', () => {
    expect(verdict(142, 19).key).toBe('watch');       // Seedance 2.0, ~13%
  });

  it('rules out a model that fails often', () => {
    const v = verdict(86, 27);                        // Kling 3.0 Omni, ~31%
    expect(v.key).toBe('avoid');
    expect(v.note).toMatch(/in front of people/);
  });

  // The one that matters most. Twelve clean attempts is not proof of anything,
  // and rendering "0%" beside it is an endorsement the data cannot support.
  it('says "too few" rather than 100% reliable on a tiny sample', () => {
    const v = verdict(12, 0);
    expect(v.key).toBe('too_few');
    expect(v.label).toBe('too few');
    expect(v.note).toMatch(/not enough to judge/);
  });

  it('refuses a tiny sample even when it looks terrible', () => {
    // 3 of 4 is 75% and still means nothing.
    expect(verdict(4, 3).key).toBe('too_few');
  });

  it('sets the sample bar somewhere defensible', () => {
    expect(MIN_ATTEMPTS).toBeGreaterThanOrEqual(30);
    expect(BANDS.GOOD).toBeLessThan(BANDS.WATCH);
  });

  it('handles nothing at all without throwing', () => {
    for (const a of [0, null, undefined]) expect(verdict(a, 0).key).toBe('too_few');
  });
});

describe('saying how much of the failure count we could attribute', () => {
  // Coverage is uneven per model, so one confidence figure for the page would
  // hide the models where the inference is weakest.
  it('is high when nearly every refund was matched', () => {
    expect(confidenceOf(95, 100).label).toBe('high');
  });

  it('is low when much of it could not be matched', () => {
    const c = confidenceOf(40, 100);
    expect(c.pct).toBe(40);
    expect(c.label).toBe('low');
  });

  it('reports exact when there were no failures to attribute', () => {
    expect(confidenceOf(0, 0).label).toBe('exact');
  });
});

describe('the table', () => {
  const rows = [
    { model: 'Kling 3.0',       attempts: 5111, failures: 187 },
    { model: 'Kling 3.0 Omni',  attempts: 86,   failures: 27 },
    { model: 'Nano Banana Pro', attempts: 3272, failures: 41 },
    { model: 'GPT Image 2',     attempts: 12,   failures: 0 },
  ];
  const costs = new Map([['kling30', 0.25], ['nanobananapro', 0.032]]);

  it('puts the worst first, so the risk is the first thing read', () => {
    const r = buildReport(rows, costs);
    expect(r[0].model).toBe('Kling 3.0 Omni');
  });

  // A model with no usable rate must not sort as though it were perfect.
  it('sinks unjudgeable models to the bottom rather than the top', () => {
    const r = buildReport(rows, costs);
    expect(r[r.length - 1].model).toBe('GPT Image 2');
    expect(r[r.length - 1].rate_pct).toBeNull();
  });

  it('prices what the failures cost where a supplier cost exists', () => {
    const r = buildReport(rows, costs);
    const kling = r.find((x) => x.model === 'Kling 3.0');
    expect(kling.wasted_usd).toBeCloseTo(46.75, 2);   // 187 × $0.25
  });

  // Same rule as the P&L: a free-looking failure is a flattering lie.
  it('leaves wasted spend null — never 0 — when the model has no cost on file', () => {
    const r = buildReport(rows, costs);
    expect(r.find((x) => x.model === 'Kling 3.0 Omni').wasted_usd).toBeNull();
  });

  it('drops nameless rows instead of rendering a blank model', () => {
    expect(buildReport([{ model: '', attempts: 100, failures: 1 }])).toHaveLength(0);
    expect(buildReport([{ model: null, attempts: 100, failures: 1 }])).toHaveLength(0);
  });
});

describe('the summary line', () => {
  const report = buildReport([
    { model: 'Kling 3.0',      attempts: 5111, failures: 187 },
    { model: 'Kling 3.0 Omni', attempts: 86,   failures: 27 },
    { model: 'GPT Image 2',    attempts: 12,   failures: 0 },
  ], new Map([['kling30', 0.25]]));

  it('counts only the models it could actually judge', () => {
    const s = summarise(report);
    expect(s.models).toBe(3);
    expect(s.judged).toBe(2);
  });

  it('names the model to stop demonstrating', () => {
    expect(summarise(report).worst).toBe('Kling 3.0 Omni');
    expect(summarise(report).avoid_live).toBe(1);
  });

  it('gives an overall rate from real totals, not an average of averages', () => {
    // 214 failures of 5,209 attempts — NOT the mean of 3.7%, 31.4% and 0%.
    expect(summarise(report).overall_rate_pct).toBeCloseTo(4.1, 1);
  });

  it('survives an empty report', () => {
    const s = summarise([]);
    expect(s.overall_rate_pct).toBeNull();
    expect(s.worst).toBeNull();
  });
});
