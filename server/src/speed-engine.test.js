// ─── speed-engine.test.js ────────────────────────────────────────────────────
// This table decides what gets demonstrated live, so the dangerous output is
// a reassuring one.
//
// Two ways that happens. First, an AVERAGE: it hides precisely the run that
// derails a session — the one in ten that takes three times as long, while you
// are standing there. Second, a figure from three runs: a median of three is
// not a median, and printing one invites a decision it cannot support.
//
// There is also no history here at all. Duration recording began 2026-08-16,
// so an empty screen must read as "too early to say", never as "no problems".

import { describe, it, expect } from 'vitest';
import {
  percentile, verdict, buildReport, summarise, fmt, MIN_TIMED, BANDS,
} from './speed-engine.js';

const s = (n) => n * 1000;

describe('percentiles over runs that actually happened', () => {
  it('finds the middle', () => {
    expect(percentile([s(10), s(20), s(30)], 0.5)).toBe(s(20));
  });

  // Nearest-rank, not interpolated: an interpolated p90 over eight samples
  // invents a duration between two real runs, and this screen is read as a
  // statement about runs that happened.
  it('returns a real observation for the slow tail, not an invented one', () => {
    const runs = [s(1), s(2), s(3), s(4), s(5), s(6), s(7), s(8), s(9), s(60)];
    expect(percentile(runs, 0.9)).toBe(s(9));
    expect(runs).toContain(percentile(runs, 0.9));
  });

  it('copes with one run, and with none', () => {
    expect(percentile([s(5)], 0.9)).toBe(s(5));
    expect(percentile([], 0.5)).toBeNull();
  });

  it('ignores junk rather than sorting it into the answer', () => {
    // Two survivors after filtering, and nearest-rank takes the lower for the
    // median — which is the point of nearest-rank: it returns a run that
    // happened rather than the midpoint between two.
    expect(percentile([s(10), null, undefined, NaN, -5, s(20)], 0.5)).toBe(s(10));
    expect(percentile([s(10), null, undefined, NaN, -5, s(20)], 0.9)).toBe(s(20));
  });
});

describe('can this be demonstrated in front of people', () => {
  it('endorses something genuinely quick', () => {
    const v = verdict(s(8), s(14), 500);
    expect(v.key).toBe('ideal');
    expect(v.note).toMatch(/repeatedly on stage/);
  });

  // The case an average would hide. Fast typically, disastrous occasionally —
  // and once per session is enough to lose a room.
  it('refuses a model whose slow tail is punishing, however good its median', () => {
    const v = verdict(s(15), s(400), 200);
    expect(v.key).toBe('no');
    expect(v.note).toMatch(/one run in ten takes/);
  });

  it('tells you to set a slow one running and talk over it', () => {
    const v = verdict(s(107), s(200), 200);       // Kling 3.0, ~1m47s
    expect(v.key).toBe('background');
    expect(v.note).toMatch(/talk over it/);
  });

  it('rules out something that belongs as homework', () => {
    expect(verdict(s(252), s(300), 100).key).toBe('no');   // Seedance 1080p
  });

  // A median of three runs is not a median.
  it('reports "not measured yet" rather than a figure from a handful of runs', () => {
    const v = verdict(s(8), s(9), 3);
    expect(v.key).toBe('unmeasured');
    expect(v.note).toMatch(/needs 8 before a figure means anything/);
  });

  it('does not throw when there is nothing at all', () => {
    expect(verdict(null, null, 0).key).toBe('unmeasured');
  });

  it('keeps the bands in a sane order', () => {
    expect(BANDS.IDEAL).toBeLessThan(BANDS.FINE);
    expect(BANDS.FINE).toBeLessThan(BANDS.BACKGROUND);
    expect(MIN_TIMED).toBeGreaterThanOrEqual(8);
  });
});

describe('durations read the way a person says them', () => {
  it('uses seconds, then minutes', () => {
    expect(fmt(8)).toBe('8s');
    expect(fmt(107)).toBe('1m 47s');
    expect(fmt(120)).toBe('2m');
  });
  it('says nothing rather than 0s when there is no figure', () => {
    expect(fmt(null)).toBe('—');
  });
});

describe('the table', () => {
  const rows = [
    { model: 'Nano Banana Pro', kind: 'image', timed: 400, median_ms: s(8),   slow_ms: s(14) },
    { model: 'Kling 3.0',       kind: 'video', timed: 300, median_ms: s(107), slow_ms: s(200) },
    { model: 'Seedance 2.0',    kind: 'video', timed: 40,  median_ms: s(252), slow_ms: s(545) },
    { model: 'GPT Image 2',     kind: 'image', timed: 3,   median_ms: s(9),   slow_ms: s(11) },
  ];

  // The models that threaten a session are what you opened the screen for.
  it('puts the slowest first', () => {
    expect(buildReport(rows)[0].model).toBe('Seedance 2.0');
  });

  it('sinks unmeasured models to the bottom rather than the top', () => {
    const out = buildReport(rows);
    expect(out[out.length - 1].model).toBe('GPT Image 2');
    expect(out[out.length - 1].median_ms).toBeNull();
  });

  // Printing "9s" beside three runs reads as an endorsement.
  it('withholds the figure entirely on a small sample', () => {
    const gpt = buildReport(rows).find((r) => r.model === 'GPT Image 2');
    expect(gpt.median_label).toBeNull();
    expect(gpt.verdict.key).toBe('unmeasured');
  });

  it('gives both numbers, because both decide the verdict', () => {
    const kling = buildReport(rows).find((r) => r.model === 'Kling 3.0');
    expect(kling.median_label).toBe('1m 47s');
    expect(kling.slow_label).toBe('3m 20s');
  });

  it('drops nameless rows', () => {
    expect(buildReport([{ model: '', timed: 99, median_ms: 1 }])).toHaveLength(0);
  });
});

describe('the summary', () => {
  const report = buildReport([
    { model: 'Nano Banana Pro', timed: 400, median_ms: s(8),   slow_ms: s(14) },
    { model: 'Seedance 2.0',    timed: 40,  median_ms: s(252), slow_ms: s(545) },
    { model: 'GPT Image 2',     timed: 3,   median_ms: s(9),   slow_ms: s(11) },
  ]);

  it('counts only what it could actually measure', () => {
    const out = summarise(report);
    expect(out.models).toBe(3);
    expect(out.measured).toBe(2);
  });

  it('names the model most likely to derail a session', () => {
    expect(summarise(report).slowest).toBe('Seedance 2.0');
    expect(summarise(report).slowest_label).toBe('4m 12s');
    expect(summarise(report).not_live).toBe(1);
  });

  // An empty screen here means recording only just started — NOT that
  // everything is fast.
  it('carries the date collection began, so empty reads as "too early"', () => {
    expect(summarise([], { since: '2026-08-16' }).collecting_since).toBe('2026-08-16');
    expect(summarise([]).measured).toBe(0);
  });
});
