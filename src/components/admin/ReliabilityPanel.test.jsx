// ─── ReliabilityPanel.test.jsx ───────────────────────────────────────────────
// This table decides what gets demonstrated to 170 people, so the dangerous
// output is not a wrong number — it is a CONFIDENT one.
//
// Two properties carry the whole screen: it must never render an endorsement
// it cannot support (a rate from twelve attempts), and it must say out loud
// that the failure counts are inferred rather than recorded, because nothing
// in the database stores "model X failed".

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReliabilityPanel from './ReliabilityPanel';

const reliability = vi.fn();
vi.mock('@/lib/adminApi', () => ({ adminApi: { reliability: (...a) => reliability(...a) } }));

const MODELS = [
  { model: 'Kling 3.0 Omni', kind: 'video', attempts: 86, failures: 27, rate_pct: 31.4,
    wasted_usd: null, verdict: { key: 'avoid', label: 'avoid live', tone: 'crit', note: 'fails too often' } },
  { model: 'Kling 3.0', kind: 'video', attempts: 5111, failures: 187, rate_pct: 3.7,
    wasted_usd: 46.75, verdict: { key: 'teach', label: 'teach it', tone: 'ok', note: 'reliable' } },
  { model: 'GPT Image 2', kind: 'image', attempts: 12, failures: 0, rate_pct: null,
    wasted_usd: 0, verdict: { key: 'too_few', label: 'too few', tone: 'dim', note: 'only 12 attempts' } },
];

const serverHas = (over = {}) => reliability.mockResolvedValue({
  window_days: 30, min_attempts: 30, models: MODELS,
  summary: { models: 3, judged: 2, avoid_live: 1, worst: 'Kling 3.0 Omni',
    attempts: 5209, failures: 214, overall_rate_pct: 4.1, wasted_usd: 46.75 },
  confidence: { pct: 90.6, label: 'high', matched: 1192, total_refunds: 1316, unnamed_attempts: 13736 },
  ...over,
});

beforeEach(() => { reliability.mockReset(); });

describe('the verdict a workshop needs, in the first column you read', () => {
  it('puts the model to avoid at the top', async () => {
    serverHas();
    render(<ReliabilityPanel onError={vi.fn()} />);
    expect(await screen.findByText('avoid live')).toBeInTheDocument();
    // Appears twice on purpose — in the table row and named in the summary
    // card, so the model to stop using is readable without scrolling.
    expect(screen.getAllByText('Kling 3.0 Omni').length).toBeGreaterThan(0);
  });

  it('names the worst model in the summary, not just a count', async () => {
    serverHas();
    render(<ReliabilityPanel onError={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByText('Kling 3.0 Omni').length).toBeGreaterThan(1));
  });
});

describe('refusing to endorse what it cannot support', () => {
  // The trap: twelve clean attempts rendering "0%" reads as a recommendation.
  it('shows "not enough data" instead of 0% on a tiny sample', async () => {
    serverHas();
    render(<ReliabilityPanel onError={vi.fn()} />);
    await screen.findByText('GPT Image 2');
    expect(screen.getByText('not enough data')).toBeInTheDocument();
    expect(screen.queryByText('0%')).toBeNull();
  });

  it('explains what "too few" means, so it is not read as unreliable', async () => {
    serverHas();
    render(<ReliabilityPanel onError={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText(/not that the model is/i)).toBeInTheDocument());
  });

  // Same rule as the P&L: a free-looking failure is a flattering lie.
  it('says "no cost on file" rather than $0.00 for an uncosted model', async () => {
    serverHas();
    render(<ReliabilityPanel onError={vi.fn()} />);
    expect(await screen.findByText('no cost on file')).toBeInTheDocument();
  });
});

describe('admitting the numbers are inferred', () => {
  // Nothing records "model X failed". If the screen hides that, every figure
  // reads as measured fact.
  it('states plainly that failure counts are worked out, not recorded', async () => {
    serverHas();
    render(<ReliabilityPanel onError={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText(/worked out, not recorded/i)).toBeInTheDocument());
  });

  it('gives the exact share of refunds it could attribute', async () => {
    serverHas();
    render(<ReliabilityPanel onError={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText(/1192 of 1316 refunds \(90\.6%\)/)).toBeInTheDocument());
  });

  it('says how many refunds it had to leave out', async () => {
    serverHas();
    render(<ReliabilityPanel onError={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText(/remaining 124 could not be tied to a model/i)).toBeInTheDocument());
  });

  it('discloses generations that recorded no model name at all', async () => {
    serverHas();
    render(<ReliabilityPanel onError={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('13,736')).toBeInTheDocument());
  });
});

describe('the window', () => {
  it('refetches when the period changes', async () => {
    serverHas();
    render(<ReliabilityPanel onError={vi.fn()} />);
    await screen.findByText('Kling 3.0');
    await userEvent.click(screen.getByText('7 days'));
    await waitFor(() => expect(reliability).toHaveBeenLastCalledWith(7));
  });
});

describe('an empty or failing panel', () => {
  it('says nothing was generated rather than showing a blank table', async () => {
    serverHas({ models: [], summary: null });
    render(<ReliabilityPanel onError={vi.fn()} />);
    expect(await screen.findByText(/No generations recorded in this window/i)).toBeInTheDocument();
  });

  it('reports an error instead of an all-clear', async () => {
    const onError = vi.fn();
    reliability.mockRejectedValue(new Error('boom'));
    render(<ReliabilityPanel onError={onError} />);
    await waitFor(() => expect(onError).toHaveBeenCalled());
  });
});

// ─── Tier 2.3 · speed ────────────────────────────────────────────────────────
// Same screen as reliability because "can I demonstrate this model" is one
// question with two halves: does it work, and is it fast enough to stand in
// front of. A model that succeeds every time and takes four minutes still
// kills a session.
//
// There is NO history here — duration recording began 2026-08-16 — so the
// empty state carries most of the weight: it must read as "too early to say",
// never as "nothing is slow".
describe('how long each model takes', () => {
  const SPEED = {
    models: [
      { model: 'Seedance 2.0', kind: 'video', timed: 40, median_ms: 252000, slow_ms: 545000,
        median_label: '4m 12s', slow_label: '9m 5s',
        verdict: { key: 'no', label: 'not live', tone: 'crit', note: 'set as homework' } },
      { model: 'Nano Banana Pro', kind: 'image', timed: 400, median_ms: 8000, slow_ms: 14000,
        median_label: '8s', slow_label: '14s',
        verdict: { key: 'ideal', label: 'ideal', tone: 'ok', note: 'fast enough on stage' } },
      { model: 'GPT Image 2', kind: 'image', timed: 3, median_ms: null, slow_ms: null,
        median_label: null, slow_label: null,
        verdict: { key: 'unmeasured', label: 'not measured yet', tone: 'dim', note: '3 timed run(s)' } },
    ],
    summary: { models: 3, measured: 2, not_live: 1, slowest: 'Seedance 2.0',
      slowest_label: '4m 12s', timed_runs: 443, collecting_since: '2026-08-16T17:00:00Z' },
  };

  it('shows the slow tail, which is the number that decides it', async () => {
    serverHas({ speed: SPEED });
    render(<ReliabilityPanel onError={vi.fn()} />);
    expect(await screen.findByText('9m 5s')).toBeInTheDocument();
    expect(screen.getByText('4m 12s')).toBeInTheDocument();
  });

  // An average hides exactly the run that derails a demo.
  it('says why the tail matters more than the typical time', async () => {
    serverHas({ speed: SPEED });
    render(<ReliabilityPanel onError={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText(/an average hides exactly the run that derails a demo/i))
        .toBeInTheDocument());
  });

  it('names the model most likely to derail a session', async () => {
    serverHas({ speed: SPEED });
    render(<ReliabilityPanel onError={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText(/slowest: Seedance 2\.0 \(4m 12s\)/)).toBeInTheDocument());
  });

  // Printing "9s" beside three runs reads as an endorsement.
  it('withholds a figure computed from too few runs', async () => {
    serverHas({ speed: SPEED });
    render(<ReliabilityPanel onError={vi.fn()} />);
    // Named in both tables — reliability and speed — so match all, not one.
    expect((await screen.findAllByText('GPT Image 2')).length).toBe(2);
    expect(screen.getByText('not enough runs')).toBeInTheDocument();
    expect(screen.getByText('not measured yet')).toBeInTheDocument();
  });

  // The state it will actually be in for a while: empty must not read as good.
  it('reads as "too early", not "nothing is slow", when nothing is timed', async () => {
    serverHas({ speed: { models: [], summary: { collecting_since: '2026-08-16T17:00:00Z' } } });
    render(<ReliabilityPanel onError={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Nothing timed yet.')).toBeInTheDocument());
    expect(screen.getByText(/no history before it/i)).toBeInTheDocument();
  });

  it('does not break when the server sends no speed block at all', async () => {
    serverHas({ speed: undefined });
    render(<ReliabilityPanel onError={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/worked out, not recorded/i)).toBeInTheDocument());
    expect(screen.queryByText('Nothing timed yet.')).toBeNull();
  });
});

// ─── measured vs worked out ──────────────────────────────────────────────────
// Video jobs now record which model ran and why they failed, so some rows are
// measurements rather than deductions.
//
// The dangerous part of that improvement is the CAVEAT. This banner used to
// open "These failure counts are worked out, not recorded" — true when nothing
// was recorded, and quietly false from the first measured model onward. A
// warning that outlives its cause teaches you to discount numbers that have
// since become facts, which is a slower version of the same problem.
describe('saying which numbers were measured and which were worked out', () => {
  it('keeps the old caveat while nothing has been recorded yet', async () => {
    serverHas({ basis: { recorded: 0, inferred: 3, recorded_pct: 0, recording_since: null } });
    render(<ReliabilityPanel onError={vi.fn()} />);
    expect(await screen.findByText(/worked out, not recorded/i)).toBeInTheDocument();
  });

  // "0 measured" the day after the change means "not yet". The same words a
  // month later would mean something is broken. Only the date separates them.
  it('says WHEN recording began, so zero reads as "not yet"', async () => {
    serverHas({ basis: { recorded: 0, inferred: 3, recorded_pct: 0,
      recording_since: '2026-08-19T00:00:00Z' } });
    render(<ReliabilityPanel onError={vi.fn()} />);
    expect(await screen.findByText(/Direct recording began/i)).toBeInTheDocument();
  });

  it('drops the blanket caveat once models are measured', async () => {
    serverHas({
      models: MODELS.map((m, i) => (i === 0 ? { ...m, basis: 'recorded' } : { ...m, basis: 'inferred' })),
      basis: { recorded: 1, inferred: 2, recorded_pct: 33.3, recording_since: '2026-08-19T00:00:00Z' },
    });
    render(<ReliabilityPanel onError={vi.fn()} />);
    expect(await screen.findByText(/1 of 3 models are now measured directly/i)).toBeInTheDocument();
    expect(screen.queryByText(/worked out, not recorded/i),
      'the screen still claimed nothing was recorded').not.toBeInTheDocument();
  });

  // The property that matters most: a reader must never have to guess which
  // of two numbers in the same column is a measurement.
  it('marks every row, so no figure is ambiguous', async () => {
    serverHas({
      models: MODELS.map((m, i) => ({ ...m, basis: i === 0 ? 'recorded' : 'inferred' })),
      basis: { recorded: 1, inferred: 2, recorded_pct: 33.3, recording_since: '2026-08-19T00:00:00Z' },
    });
    render(<ReliabilityPanel onError={vi.fn()} />);
    await screen.findAllByText('Kling 3.0 Omni');   // also appears in the "Avoid live" card
    expect(screen.getAllByText('measured')).toHaveLength(1);
    // 2 rows + the banner's inline reference.
    expect(screen.getAllByText('inferred').length).toBeGreaterThanOrEqual(2);
  });

  // A row from a server that predates this field must not render as a blank
  // badge or crash — it is inferred until proven otherwise.
  it('treats a row with no basis as inferred rather than nothing', async () => {
    serverHas();          // MODELS carry no `basis` at all
    render(<ReliabilityPanel onError={vi.fn()} />);
    await screen.findAllByText('Kling 3.0 Omni');
    expect(screen.getAllByText('inferred').length).toBe(MODELS.length);
  });
});
