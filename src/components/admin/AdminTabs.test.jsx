import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import LogsTab from './LogsTab';
import UsageTab from './UsageTab';

vi.mock('@/lib/adminApi', () => ({
  adminApi: {
    logs: vi.fn().mockResolvedValue({
      logs: [
        { id: 1, created_at: '2026-07-26T10:00:00Z', action: 'spend', amount: '-12.50', kie_credits: '90.00', fal_cost: null, reason: 'video: Kling 3.0', user_id: 7, email: 'user@example.com' },
        { id: 2, created_at: '2026-07-26T09:00:00Z', action: 'spend', amount: '-4.00', kie_credits: null, fal_cost: '0.15', reason: 'image: Soul 2.0', user_id: 8, email: 'fal@example.com' },
        { id: 3, created_at: '2026-07-26T08:00:00Z', action: 'refund', amount: '12.50', kie_credits: null, fal_cost: null, reason: 'video failed', user_id: 7, email: 'user@example.com' },
      ],
      total: 3, limit: 50, offset: 0,
    }),
    usage: vi.fn().mockResolvedValue({
      daily: [{ day: '2026-07-26', voxel_spent: 16.5, voxel_refunded: 12.5, kie_credits: 90, fal_cost: 0.15, generations: 2 }],
      models: [{ model: 'video: Kling 3.0', generations: 1, voxel_spent: 12.5, kie_credits: 90, fal_cost: 0 }],
      totals: { voxel_spent: 16.5, voxel_refunded: 12.5, kie_credits: 90, fal_cost: 0.15, generations: 2, active_users: 2 },
    }),
    kieBalance: vi.fn().mockResolvedValue({ credits: 9756, usd: 48.78 }),
  },
}));

beforeEach(() => vi.clearAllMocks());

describe('LogsTab', () => {
  it('renders rows with voxel + KIE credit columns, and — for FAL rows', async () => {
    render(<LogsTab />);
    await waitFor(() => expect(screen.getByText('video: Kling 3.0')).toBeInTheDocument());
    // kie-backed row shows its KIE credits, FAL row its USD cost, gaps show dashes
    expect(screen.getByText('−90')).toBeInTheDocument();
    expect(screen.getByText('−$0.15')).toBeInTheDocument();
    expect(screen.getByText('image: Soul 2.0')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    // status chips ("refunded" also exists as a filter <option>, hence All)
    expect(screen.getAllByText('success').length).toBeGreaterThan(0);
    expect(screen.getAllByText('refunded').length).toBeGreaterThan(1);
  });
});

describe('UsageTab', () => {
  it('renders totals, the live kie balance, and the per-model table', async () => {
    render(<UsageTab />);
    await waitFor(() => expect(screen.getByText('9,756 cr')).toBeInTheDocument());
    expect(screen.getByText(/≈ \$48.78/)).toBeInTheDocument();
    expect(screen.getByText('video: Kling 3.0')).toBeInTheDocument();
    // stat card + table column header both say "Generations"
    expect(screen.getAllByText('Generations').length).toBe(2);
  });
});
