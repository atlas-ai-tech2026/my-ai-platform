// ─── ProviderDashboard.test.jsx ──────────────────────────────────────────────
// A cost dashboard that quietly under-reports is worse than no dashboard: the
// owner would price against it. Two properties matter more than the layout.
//
//   1. It must SAY when the data is incomplete. 13,736 charges (10 Jun – 22 Jul
//      2026, 45% of all credits ever spent) carry no provider attribution.
//      A total that omits them silently reads as complete.
//
//   2. It must not present a DERIVED figure as a billed one. We multiply
//      credits by a constant and never read the invoice — measured against
//      kie.ai's own dashboard the constant is ~14% high.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ProviderDashboard from './ProviderDashboard';

const providerUsage = vi.fn();
vi.mock('@/lib/adminApi', () => ({ adminApi: { providerUsage: (...a) => providerUsage(...a) } }));
// Recharts needs a real box; jsdom reports zero and renders nothing.
vi.mock('recharts', async () => {
  const actual = await vi.importActual('recharts');
  return { ...actual, ResponsiveContainer: ({ children }) => <div style={{ width: 600, height: 300 }}>{children}</div> };
});

const PAYLOAD = {
  provider: 'kie',
  unit: 'credits',
  usd_rate: 0.005,
  usd_is_estimated: true,
  from: '2026-08-02', to: '2026-08-15',
  totals: { units: 361087.3, usd: 1805.44, generations: 6439, users: 194, voxel_credits: 55439.01 },
  daily: [
    { day: '2026-08-05', units: 120000, usd: 600, generations: 2391 },
    { day: '2026-08-06', units: 90000, usd: 450, generations: 1369 },
  ],
  models: [
    { model: 'video: Kling 3.0', units: 300000, usd: 1500, generations: 5111, voxel_credits: 63306,
      daily: [{ day: '2026-08-05', units: 100000, usd: 500 }] },
  ],
  coverage: { unattributed_rows: 0, total_rows: 6439, unattributed_voxel_credits: 0 },
};

beforeEach(() => { providerUsage.mockReset().mockResolvedValue(PAYLOAD); });
afterEach(() => { vi.restoreAllMocks(); });

const show = (extra = {}) => render(<ProviderDashboard provider="kie" onClose={vi.fn()} onError={vi.fn()} {...extra} />);

describe('it reports the supplier total', () => {
  it('asks the API for the right provider', async () => {
    show();
    await waitFor(() => expect(providerUsage).toHaveBeenCalled());
    expect(providerUsage.mock.calls[0][0]).toMatchObject({ provider: 'kie' });
  });

  it('shows spend in dollars by default', async () => {
    show();
    await waitFor(() => expect(screen.getByText(/Total Spend/)).toBeInTheDocument());
    expect(screen.getByText('$1,805.44')).toBeInTheDocument();
  });

  // The toggle must move the HEADLINE, not just the chart — otherwise the two
  // disagree and the screen is worse than useless.
  it('switches the headline to credits, not just the chart', async () => {
    show();
    await waitFor(() => screen.getByText('$1,805.44'));
    fireEvent.click(screen.getByText('Total Credits'));
    await waitFor(() => expect(screen.getByText('361,087')).toBeInTheDocument());
    expect(screen.queryByText('$1,805.44')).toBeNull();
  });

  it('lists the models with their generation counts', async () => {
    show();
    await waitFor(() => expect(screen.getByText('video: Kling 3.0')).toBeInTheDocument());
    expect(screen.getByText(/5,111 generations/)).toBeInTheDocument();
  });
});

describe('rule 1 — it never hides missing data', () => {
  it('warns, in numbers, when charges have no provider recorded', async () => {
    providerUsage.mockResolvedValue({
      ...PAYLOAD,
      coverage: { unattributed_rows: 13736, total_rows: 22665, unattributed_voxel_credits: 66260.15 },
    });
    show();
    await waitFor(() => expect(screen.getByText(/13,736/)).toBeInTheDocument());
    expect(screen.getByText(/no provider\s+recorded/i)).toBeInTheDocument();
    expect(screen.getByText(/missing from the total above/i)).toBeInTheDocument();
  });

  it('stays quiet when coverage is complete', async () => {
    show();
    await waitFor(() => screen.getByText('$1,805.44'));
    expect(screen.queryByText(/missing from the total above/i)).toBeNull();
  });
});

describe('rule 2 — a derived number is never dressed as a bill', () => {
  it('says the dollars are estimated, and at what rate', async () => {
    show();
    await waitFor(() => screen.getByText('$1,805.44'));
    expect(screen.getByText(/not the billed figure/i)).toBeInTheDocument();
    expect(screen.getByText(/0\.005\/credit/)).toBeInTheDocument();
  });

  // In credits mode there is nothing derived, so the caveat would be noise.
  it('drops the caveat when showing raw credits', async () => {
    show();
    await waitFor(() => screen.getByText('$1,805.44'));
    fireEvent.click(screen.getByText('Total Credits'));
    await waitFor(() => expect(screen.queryByText(/not the billed figure/i)).toBeNull());
  });
});

describe('when it cannot load', () => {
  it('says so instead of showing a confident zero', async () => {
    providerUsage.mockRejectedValue(new Error('boom'));
    const onError = vi.fn();
    show({ onError });
    await waitFor(() => expect(screen.getByText(/Could not load KIE usage/i)).toBeInTheDocument());
    expect(onError).toHaveBeenCalled();
    // A zero here would be read as "we spent nothing".
    expect(screen.queryByText('$0')).toBeNull();
  });
});
