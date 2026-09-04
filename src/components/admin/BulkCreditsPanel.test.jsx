// ─── BulkCreditsPanel.test.jsx ───────────────────────────────────────────────
// Credits for accounts that already exist.
//
// ☠ IT SPENDS REAL MONEY. 61 accounts × 158 credits is about $610. A confirm
// box asking "are you sure?" is not consent to that — a number is. So nothing
// is charged until the bill has been shown, and applying sends back the same
// account count it displayed.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BulkCreditsPanel from './BulkCreditsPanel';

const api = vi.hoisted(() => ({ bulkCreditsPreview: vi.fn(), bulkCreditsApply: vi.fn() }));
vi.mock('@/lib/adminApi', () => ({ adminApi: api }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

const PLAN = {
  accounts: 61, credits_each: 158, total_credits: 9638, total_usd: 610.30, days: 30,
  no_account: ['newone@a.com', 'another@a.com'],
  sentence: '61 accounts would receive 158 credits each — 9,638 credits, about $610.30. '
    + '2 addresses have no account and would receive nothing.',
};

beforeEach(() => {
  vi.clearAllMocks();
  api.bulkCreditsPreview.mockResolvedValue(PLAN);
  api.bulkCreditsApply.mockResolvedValue({
    credited: 61, credits_each: 158, total_credits: 9638, days: 30,
    no_account: PLAN.no_account,
    sentence: '61 accounts received 158 credits each. 2 addresses had no account and received NOTHING.',
  });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

const fill = async (user, { credits = '158', reason = 'SPA News Academy 5th', days = '' } = {}) => {
  await user.type(screen.getByLabelText('Accounts to credit'), 'a@b.com');
  await user.type(screen.getByLabelText('Credits each'), credits);
  if (days) await user.type(screen.getByLabelText('Access days'), days);
  if (reason) await user.type(screen.getByLabelText('Reason'), reason);
};

describe('☠ THE BILL IS SHOWN BEFORE ANY MONEY MOVES', () => {
  it('checking first shows accounts, credits and DOLLARS', async () => {
    const user = userEvent.setup();
    render(<BulkCreditsPanel onError={vi.fn()} />);
    await fill(user);
    await user.click(screen.getByRole('button', { name: /Check first/ }));

    expect(await screen.findByText(/61 accounts would receive 158 credits each/)).toBeInTheDocument();
    expect(screen.getByText('$610.3')).toBeInTheDocument();
    expect(api.bulkCreditsApply).not.toHaveBeenCalled();      // nothing charged yet
  });

  it('☠ names the people who will receive NOTHING', async () => {
    // Bulk's habit is to skip these quietly. That is what cost ten people
    // their promo codes on 2026-09-02.
    const user = userEvent.setup();
    render(<BulkCreditsPanel onError={vi.fn()} />);
    await fill(user);
    await user.click(screen.getByRole('button', { name: /Check first/ }));
    expect(await screen.findByText(/2 will receive nothing/)).toBeInTheDocument();
    expect(screen.getByText(/newone@a\.com/)).toBeInTheDocument();
  });

  it('sends back the account count it displayed, so a moved list is refused', async () => {
    const user = userEvent.setup();
    render(<BulkCreditsPanel onError={vi.fn()} />);
    await fill(user);
    await user.click(screen.getByRole('button', { name: /Check first/ }));
    await user.click(await screen.findByRole('button', { name: /Add 158 credits to 61 accounts/ }));
    await waitFor(() => expect(api.bulkCreditsApply).toHaveBeenCalledWith(
      expect.objectContaining({ expect_accounts: 61, credits: 158, reason: 'SPA News Academy 5th' })));
  });

  it('☠ will not charge without a reason', async () => {
    const user = userEvent.setup();
    render(<BulkCreditsPanel onError={vi.fn()} />);
    await fill(user, { reason: '' });
    await user.click(screen.getByRole('button', { name: /Check first/ }));
    await user.click(await screen.findByRole('button', { name: /Add 158 credits/ }));
    expect(api.bulkCreditsApply).not.toHaveBeenCalled();
  });

  it('☠ editing anything clears the bill, so a stale number cannot be approved', async () => {
    // The figure on screen must always describe the list currently in the box.
    const user = userEvent.setup();
    render(<BulkCreditsPanel onError={vi.fn()} />);
    await fill(user);
    await user.click(screen.getByRole('button', { name: /Check first/ }));
    await screen.findByText(/61 accounts would receive/);
    await user.type(screen.getByLabelText('Credits each'), '9');
    expect(screen.queryByText(/61 accounts would receive/)).toBeNull();
  });

  it('refuses to check with no credits given', async () => {
    const user = userEvent.setup();
    render(<BulkCreditsPanel onError={vi.fn()} />);
    await user.type(screen.getByLabelText('Accounts to credit'), 'a@b.com');
    await user.click(screen.getByRole('button', { name: /Check first/ }));
    expect(api.bulkCreditsPreview).not.toHaveBeenCalled();
  });
});

describe('how long the credits live — the same idea as a promo code', () => {
  it('the field says blank means thirty days', () => {
    render(<BulkCreditsPanel onError={vi.fn()} />);
    expect(screen.getByPlaceholderText('Blank = 30 days')).toBeInTheDocument();
    expect(screen.getByText(/Blank access days means the standard 30, exactly as a promo code/))
      .toBeInTheDocument();
  });

  it('and a number is passed through', async () => {
    const user = userEvent.setup();
    render(<BulkCreditsPanel onError={vi.fn()} />);
    await fill(user, { days: '120' });
    await user.click(screen.getByRole('button', { name: /Check first/ }));
    await waitFor(() => expect(api.bulkCreditsPreview).toHaveBeenCalledWith(
      expect.objectContaining({ access_days: '120' })));
  });
});

describe('after it runs', () => {
  it('says what happened, including who got nothing', async () => {
    const user = userEvent.setup();
    render(<BulkCreditsPanel onError={vi.fn()} />);
    await fill(user);
    await user.click(screen.getByRole('button', { name: /Check first/ }));
    await user.click(await screen.findByRole('button', { name: /Add 158 credits to 61/ }));
    expect(await screen.findByText(/received NOTHING/)).toBeInTheDocument();
    expect(screen.getByText(/recorded as bulk/)).toBeInTheDocument();
  });
});
