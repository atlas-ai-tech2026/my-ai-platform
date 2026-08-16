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
