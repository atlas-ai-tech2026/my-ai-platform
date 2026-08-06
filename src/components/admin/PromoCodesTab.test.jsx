// ─── PromoCodesTab.test.jsx ──────────────────────────────────────────────────
// CRM promo-code enhancements, 2026-08-06.
//
// The owner's stated concern was that existing promo codes must keep working
// untouched, so the first block pins exactly that: a code created before this
// change (no description) still renders, still shows its real counts, and is
// never mutated by simply being displayed.
//
// The rest cover the four requested features: description, editing description
// and expiry, search, and the list of accounts that redeemed a code.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PromoCodesTab from './PromoCodesTab';

const api = vi.hoisted(() => ({
  listPromos: vi.fn(),
  createPromo: vi.fn(),
  togglePromo: vi.fn(),
  updatePromo: vi.fn(),
  promoRedemptions: vi.fn(),
}));

vi.mock('@/lib/adminApi', () => ({ adminApi: api }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const future = new Date(Date.now() + 30 * 864e5).toISOString();
const past = new Date(Date.now() - 5 * 864e5).toISOString();

/** A code created BEFORE this change: no description column value. */
const LEGACY = {
  id: 1, code: 'VOXEL-OLD-0001', credits: '25.00', description: null,
  max_redemptions: 100, redeemed_count: 7, expires_at: future,
  active: true, created_by: 'info@voxel-ai.ai', created_at: '2026-06-01T10:00:00Z',
};
const WITH_DESC = {
  id: 2, code: 'GULF-MEDIA', credits: '50.00', description: 'Ahmed — Gulf Media campaign',
  max_redemptions: null, redeemed_count: 0, expires_at: null,
  active: true, created_by: 'info@voxel-ai.ai', created_at: '2026-08-01T10:00:00Z',
};
const EXPIRED = {
  id: 3, code: 'SHORT-DATE', credits: '10.00', description: 'workshop attendees',
  max_redemptions: null, redeemed_count: 3, expires_at: past,
  active: true, created_by: 'info@voxel-ai.ai', created_at: '2026-07-20T10:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  api.listPromos.mockResolvedValue({ promos: [LEGACY, WITH_DESC, EXPIRED] });
  api.updatePromo.mockResolvedValue({ promo: {} });
  api.promoRedemptions.mockResolvedValue({
    redemptions: [
      { user_id: 11, email: 'sara@example.com', banned: false, created_at: '2026-07-02T09:00:00Z' },
      { user_id: 12, email: 'omar@example.com', banned: true, created_at: '2026-07-03T09:00:00Z' },
    ],
  });
});

describe('existing promo codes are unaffected', () => {
  it('renders a pre-existing code that has no description', async () => {
    render(<PromoCodesTab />);
    await waitFor(() => expect(screen.getByText('VOXEL-OLD-0001')).toBeInTheDocument());
    // Missing description shows a placeholder, not a crash or a blank row.
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('shows its real credits and redemption count unchanged', async () => {
    render(<PromoCodesTab />);
    await waitFor(() => expect(screen.getByText('VOXEL-OLD-0001')).toBeInTheDocument());
    expect(screen.getByText('+25')).toBeInTheDocument();
    expect(screen.getByText(/7 \/ 100/)).toBeInTheDocument();
  });

  it('never writes to a code just by listing it', async () => {
    render(<PromoCodesTab />);
    await waitFor(() => expect(api.listPromos).toHaveBeenCalled());
    // Viewing must be read-only: no update, no toggle, no creation.
    expect(api.updatePromo).not.toHaveBeenCalled();
    expect(api.togglePromo).not.toHaveBeenCalled();
    expect(api.createPromo).not.toHaveBeenCalled();
  });
});

describe('1 — description', () => {
  it('shows the description before the code', async () => {
    render(<PromoCodesTab />);
    await waitFor(() => expect(screen.getByText('Ahmed — Gulf Media campaign')).toBeInTheDocument());
  });

  it('sends the description when creating', async () => {
    const user = userEvent.setup();
    api.createPromo.mockResolvedValue({ promo: { code: 'NEW-1', credits: 5 } });
    render(<PromoCodesTab />);
    await waitFor(() => screen.getByPlaceholderText('Description — who is this for?'));

    await user.type(screen.getByPlaceholderText('Description — who is this for?'), 'Fatima, expo booth');
    await user.type(screen.getByPlaceholderText('Credits per redemption *'), '20');
    await user.click(screen.getByRole('button', { name: /create promo/i }));

    await waitFor(() => expect(api.createPromo).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'Fatima, expo booth', credits: 20 })
    ));
  });
});

describe('2 — editing description and expiry', () => {
  it('saves a changed description without touching credits or the code', async () => {
    const user = userEvent.setup();
    render(<PromoCodesTab />);
    await waitFor(() => screen.getByText('GULF-MEDIA'));

    const row = screen.getByText('GULF-MEDIA').closest('tr');
    await user.click(within(row).getByRole('button', { name: /^edit$/i }));

    const field = screen.getByPlaceholderText('Who is this for?');
    await user.clear(field);
    await user.type(field, 'Ahmed — renewed for Q4');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(api.updatePromo).toHaveBeenCalledWith(2, expect.objectContaining({
      description: 'Ahmed — renewed for Q4',
    })));
    // The payload must NOT carry credits or code — those are locked server-side,
    // and sending them would signal an intent the UI does not have.
    const payload = api.updatePromo.mock.calls[0][1];
    expect(payload).not.toHaveProperty('credits');
    expect(payload).not.toHaveProperty('code');
  });

  it('extends an expired code, which revives it', async () => {
    const user = userEvent.setup();
    render(<PromoCodesTab />);
    await waitFor(() => screen.getByText('SHORT-DATE'));

    const row = screen.getByText('SHORT-DATE').closest('tr');
    expect(within(row).getByText('expired')).toBeInTheDocument();

    await user.click(within(row).getByRole('button', { name: /^edit$/i }));
    const dateField = row.querySelector('input[type="date"]');
    await user.clear(dateField);
    await user.type(dateField, '2027-01-31');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(api.updatePromo).toHaveBeenCalledWith(3, expect.objectContaining({
      expires_at: '2027-01-31',
    })));
  });

  it('sends null when the expiry is cleared, meaning never expires', async () => {
    const user = userEvent.setup();
    render(<PromoCodesTab />);
    await waitFor(() => screen.getByText('VOXEL-OLD-0001'));

    const row = screen.getByText('VOXEL-OLD-0001').closest('tr');
    await user.click(within(row).getByRole('button', { name: /^edit$/i }));
    await user.clear(row.querySelector('input[type="date"]'));
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    // null, not undefined: the server must tell "clear it" from "leave it".
    await waitFor(() => expect(api.updatePromo).toHaveBeenCalledWith(1, expect.objectContaining({
      expires_at: null,
    })));
  });
});

describe('3 — search', () => {
  it('filters by description', async () => {
    const user = userEvent.setup();
    render(<PromoCodesTab />);
    await waitFor(() => screen.getByText('GULF-MEDIA'));

    await user.type(screen.getByPlaceholderText(/search description/i), 'gulf');
    expect(screen.getByText('GULF-MEDIA')).toBeInTheDocument();
    expect(screen.queryByText('VOXEL-OLD-0001')).not.toBeInTheDocument();
  });

  it('also finds a code by the code itself', async () => {
    const user = userEvent.setup();
    render(<PromoCodesTab />);
    await waitFor(() => screen.getByText('VOXEL-OLD-0001'));

    await user.type(screen.getByPlaceholderText(/search description/i), 'old-0001');
    expect(screen.getByText('VOXEL-OLD-0001')).toBeInTheDocument();
    expect(screen.queryByText('GULF-MEDIA')).not.toBeInTheDocument();
  });

  it('says so when nothing matches, rather than showing an empty table', async () => {
    const user = userEvent.setup();
    render(<PromoCodesTab />);
    await waitFor(() => screen.getByText('GULF-MEDIA'));

    await user.type(screen.getByPlaceholderText(/search description/i), 'zzzznothing');
    expect(screen.getByText(/no promo codes match/i)).toBeInTheDocument();
  });
});

describe('4 — the accounts that redeemed a code', () => {
  it('lists the accounts when the count is clicked', async () => {
    const user = userEvent.setup();
    render(<PromoCodesTab />);
    await waitFor(() => screen.getByText('VOXEL-OLD-0001'));

    const row = screen.getByText('VOXEL-OLD-0001').closest('tr');
    await user.click(within(row).getByRole('button', { name: /7 \/ 100/ }));

    await waitFor(() => expect(api.promoRedemptions).toHaveBeenCalledWith(1));
    expect(await screen.findByText('sara@example.com')).toBeInTheDocument();
    expect(screen.getByText(/omar@example.com \(banned\)/)).toBeInTheDocument();
  });

  it('fetches once and collapses again on a second click', async () => {
    const user = userEvent.setup();
    render(<PromoCodesTab />);
    await waitFor(() => screen.getByText('VOXEL-OLD-0001'));

    const row = screen.getByText('VOXEL-OLD-0001').closest('tr');
    const btn = within(row).getByRole('button', { name: /7 \/ 100/ });
    await user.click(btn);
    await waitFor(() => screen.getByText('sara@example.com'));
    await user.click(btn);
    await waitFor(() => expect(screen.queryByText('sara@example.com')).not.toBeInTheDocument());

    await user.click(btn);
    await waitFor(() => screen.getByText('sara@example.com'));
    expect(api.promoRedemptions).toHaveBeenCalledTimes(1);   // cached
  });
});

describe('status reflects expiry and caps, not just the on/off flag', () => {
  it('shows expired for a lapsed code that is still flagged active', async () => {
    render(<PromoCodesTab />);
    await waitFor(() => screen.getByText('SHORT-DATE'));
    const row = screen.getByText('SHORT-DATE').closest('tr');
    expect(within(row).getByText('expired')).toBeInTheDocument();
  });

  it('shows active for a live code', async () => {
    render(<PromoCodesTab />);
    await waitFor(() => screen.getByText('GULF-MEDIA'));
    const row = screen.getByText('GULF-MEDIA').closest('tr');
    expect(within(row).getByText('active')).toBeInTheDocument();
  });
});
