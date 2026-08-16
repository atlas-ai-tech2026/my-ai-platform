import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
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

// ─── tab descriptions (2026-08-16) ───────────────────────────────────────────
// Twelve tabs had accumulated with nothing saying what any of them was for.
// Obvious to whoever built them; opaque to anyone else, and to the owner after
// a month away. Each tab now carries a one-line description shown the moment
// it opens.
describe('every tab explains itself', () => {
  const source = readFileSync(
    path.join(process.cwd(), 'src/pages/AdminPanel.jsx'), 'utf8');

  // \s+ because several entries are column-aligned with extra spaces — a
  // single-space regex silently found 9 of 12 and would have "passed" while
  // three tabs went unchecked.
  const tabIds = [...source.matchAll(/\{\s*id:\s*'([a-z]+)',\s+label:\s*'[^']+',/g)].map((m) => m[1]);
  const descs = [...source.matchAll(/desc: '((?:[^'\\]|\\.)+)'/g)].map((m) => m[1]);

  it('found the tabs', () => {
    expect(tabIds.length).toBeGreaterThanOrEqual(12);
  });

  it('gives every single one a description — no tab left unexplained', () => {
    expect(descs.length).toBe(tabIds.length);
  });

  it('renders the description of whichever tab is open', () => {
    expect(source).toMatch(/TABS\.find\(t => t\.id === tab\)\?\.desc/);
  });

  // A label restated as a sentence teaches nothing. Each should say what the
  // screen is FOR.
  it('writes something longer than a restated label', () => {
    for (const d of descs) expect(d.length).toBeGreaterThan(60);
  });

  // The genuinely confusing pairs. Costing and Offers both talk about margin;
  // Logs and API Usage both look like "money". Saying what the DIFFERENCE is
  // is the part that actually helps.
  it('distinguishes the screens that sound alike', () => {
    const usage = descs.find((d) => /kie\.ai/.test(d));
    expect(usage).toMatch(/as opposed to Logs/);
    const costing = descs.find((d) => /CALCULATOR/.test(d));
    expect(costing).toMatch(/nothing here changes what customers are charged/);
  });
});
