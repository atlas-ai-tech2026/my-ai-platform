import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Account from './Account';

const mockUser = {
  id: 7, email: 'creator@example.com', display_name: 'Mohaned',
  credits: '719.50', credit_limit: '1200.00', package: 'Pro',
};

vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({
    user: mockUser, isAuthenticated: true, isLoadingAuth: false,
    openAuthModal: vi.fn(), refresh: vi.fn(), logout: vi.fn(),
  }),
}));

beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      daily: [{ day: '2026-07-26', credits_spent: 25, generations: 3 }],
      recent: [
        { id: 1, created_at: '2026-07-26T10:00:00Z', action: 'spend', amount: '-12.50', reason: 'video: Kling 3.0' },
        { id: 2, created_at: '2026-07-25T10:00:00Z', action: 'promo', amount: '50', reason: 'promo: VOXEL-AB12-CD34' },
        { id: 3, created_at: '2026-07-24T10:00:00Z', action: 'gift', amount: '100', reason: 'gift card: VGC-XXXX-YYYY-ZZZZ' },
      ],
      lifetime: {
        generations: 411, videos: 139, images: 260, credits_spent: 3200,
        top_model: { model: 'image: Nano Banana Pro', generations: 376 },
      },
    }),
  });
});

const renderPage = () => render(<MemoryRouter><Account /></MemoryRouter>);

describe('Account page (signed in)', () => {
  it('shows the higgsfield-style profile: name, email, credits card, pool %', async () => {
    renderPage();
    expect(screen.getByText('Mohaned')).toBeInTheDocument();
    expect(screen.getByText('creator@example.com')).toBeInTheDocument();
    // 719.5 of 1200 pool ≈ 60%
    await waitFor(() => expect(screen.getByText('719.5 credits left')).toBeInTheDocument());
    expect(screen.getByText('60% of maximum credit pool')).toBeInTheDocument();
    expect(screen.getByText('Top-up')).toBeInTheDocument();
    // all five sidebar sections
    for (const label of ['Personal profile', 'Gifts', 'Subscription', 'Usage', 'Promocode']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('Usage section lists the user\'s own spends only', async () => {
    renderPage();
    fireEvent.click(screen.getByText('Usage'));
    await waitFor(() => expect(screen.getByText('video: Kling 3.0')).toBeInTheDocument());
    expect(screen.getByText('-12.5')).toBeInTheDocument();
  });

  it('Promocode section shows redeemed promos and the redeem box', async () => {
    renderPage();
    fireEvent.click(screen.getByText('Promocode'));
    await waitFor(() => expect(screen.getByText('VOXEL-AB12-CD34')).toBeInTheDocument());
    expect(screen.getByPlaceholderText('Enter promo code…')).toBeInTheDocument();
    expect(screen.getByText('+50')).toBeInTheDocument();
  });

  it('Subscription section shows plan, checklist, credits meter, and Rewind', async () => {
    renderPage();
    fireEvent.click(screen.getByText('Subscription'));
    expect(screen.getByText('Pro Plan')).toBeInTheDocument();
    expect(screen.getByText(/\$95\/month · 1,500 credits per month/)).toBeInTheDocument();
    expect(screen.getByText('Upgrade plan')).toBeInTheDocument();
    expect(screen.getByText('Access to all models')).toBeInTheDocument();
    expect(screen.getByText('+ Buy credits')).toBeInTheDocument();
    expect(screen.getByText('Coming soon')).toBeInTheDocument();
    // Rewind cards from lifetime stats
    await waitFor(() => expect(screen.getByText('411 generations')).toBeInTheDocument());
    expect(screen.getByText('139 videos')).toBeInTheDocument();
    // top model appears in the Model access list AND the Rewind card
    expect(screen.getAllByText('Nano Banana Pro').length).toBe(2);
  });
});
