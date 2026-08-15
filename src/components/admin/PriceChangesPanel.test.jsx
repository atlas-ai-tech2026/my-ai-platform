// ─── PriceChangesPanel.test.jsx ──────────────────────────────────────────────
// WHICH SCREEN THIS APPEARS ON IS THE POINT. The owner pressed "Check now"
// under New Models over and over, looking for price movement on the models
// customers actually use, and reasonably concluded the feature did not work.
// It did — it was in the wrong place. New Models is about things you do NOT
// sell; a supplier price rise threatens the margin on what you DO.
//
// The other two properties here are about not looking broken when it is
// working: an empty queue on day one is expected (movement needs a second
// reading), and kie publishes a price for only 9 of 98 models — which must
// read as "not published", never as free.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import PriceChangesPanel from './PriceChangesPanel';

const priceChanges = vi.fn();
const costingSync = vi.fn();
vi.mock('@/lib/adminApi', () => ({
  adminApi: {
    priceChanges: (...a) => priceChanges(...a),
    costingSync: (...a) => costingSync(...a),
    resolvePriceChange: vi.fn(),
  },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const PENDING = {
  id: 1, provider: 'fal', family: 'kling3', model_name: 'Kling 3.0',
  old_price_usd: 0.42, new_price_usd: 0.51, pct_change: 21.43,
  old_credits: 12.5, new_credits: 15, status: 'pending',
  detected_at: '2026-08-16T00:00:00Z',
};

const serverHas = (changes) =>
  priceChanges.mockResolvedValue({ synced_at: null, changes });

beforeEach(() => { priceChanges.mockReset(); costingSync.mockReset(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('price review belongs on the Models tab', () => {
  it('shows the queue and an Approve button there', async () => {
    serverHas([PENDING]);
    render(<PriceChangesPanel scope="models" onError={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Supplier price changes')).toBeInTheDocument());
    expect(screen.getByText(/you already sell/i)).toBeInTheDocument();
    expect(await screen.findByText('Approve')).toBeInTheDocument();
    expect(screen.getByText(/12\.5 → 15/)).toBeInTheDocument();
  });

  // Showing the same queue twice would leave two Approve buttons for one
  // decision, and invite approving it in the place it does not belong.
  it('does not repeat the queue on the discovery screen', async () => {
    serverHas([PENDING]);
    render(<PriceChangesPanel scope="discovery" onError={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Provider catalogue')).toBeInTheDocument());
    expect(screen.queryByText('Approve')).toBeNull();
    expect(screen.getByText(/reviewed on the/i)).toBeInTheDocument();
  });

  it('keeps the sweep button on both, since one job serves both questions', async () => {
    serverHas([]);
    const { unmount } = render(<PriceChangesPanel scope="models" onError={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('⟳ Check now')).toBeInTheDocument());
    unmount();
    serverHas([]);
    render(<PriceChangesPanel scope="discovery" onError={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('⟳ Check now')).toBeInTheDocument());
  });
});

describe('an empty panel must not look broken', () => {
  // Day one: the first sweep records a baseline and can show nothing. That is
  // exactly when someone is trying to confirm the feature works.
  it('explains that movement needs a second reading', async () => {
    serverHas([]);
    render(<PriceChangesPanel scope="models" onError={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/two readings to exist/i)).toBeInTheDocument());
  });

  it('states how little kie publishes, so a gap is not read as free', async () => {
    serverHas([]);
    render(<PriceChangesPanel scope="models" onError={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/9 of 98/)).toBeInTheDocument());
    expect(screen.getByText(/never as free/i)).toBeInTheDocument();
  });

  it('says nothing is waiting rather than showing an empty box', async () => {
    serverHas([]);
    render(<PriceChangesPanel scope="models" onError={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText(/No supplier price changes waiting/i)).toBeInTheDocument());
  });
});

describe('a rise is never applied on its own', () => {
  it('offers Approve and Skip rather than acting', async () => {
    serverHas([PENDING]);
    render(<PriceChangesPanel scope="models" onError={vi.fn()} />);
    expect(await screen.findByText('Approve')).toBeInTheDocument();
    expect(screen.getByText('Skip')).toBeInTheDocument();
  });

  // Over 50% is almost always a misread unit rather than a real price move.
  it('flags an implausible jump and warns before it is approved', async () => {
    serverHas([{ ...PENDING, id: 2, status: 'needs_check', pct_change: 900,
      new_price_usd: 4.2 }]);
    render(<PriceChangesPanel scope="models" onError={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('verify')).toBeInTheDocument());
    expect(screen.getByText(/too large to trust automatically/i)).toBeInTheDocument();
  });
});
