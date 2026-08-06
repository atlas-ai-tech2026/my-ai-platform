// ─── OffersTab.test.jsx ──────────────────────────────────────────────────────
// Two claims on this screen must never quietly become false:
//
//   1. Email campaigns are ON HOLD — the option must stay disabled, and an
//      offer must never be saved with delivery_email set.
//   2. "% off" and "$ off" cannot be redeemed, because there is no checkout.
//      An approved offer that looks live but reaches nobody is worse than no
//      feature at all.
//
// Plus the floor gate: approving below the margin floor must take a deliberate
// second action, and that action must reach the server.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import OffersTab from './OffersTab';

const api = vi.hoisted(() => ({
  offersList: vi.fn(), offerCreate: vi.fn(), offerUpdate: vi.fn(),
  offerApprove: vi.fn(), offerPause: vi.fn(), offerResume: vi.fn(),
  offerStats: vi.fn(), offerMarginImpact: vi.fn(), offerSegmentPreview: vi.fn(),
  offerSettings: vi.fn(), searchUsers: vi.fn(),
}));
vi.mock('@/lib/adminApi', () => ({ adminApi: api }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const PLANS = [
  { id: 1, name: 'Micro', price_usd: 5 },
  { id: 4, name: 'Plus', price_usd: 59 },
];
const SETTINGS = { margin_target: 0.40, margin_floor: 0.25 };
const OFFER = {
  id: 7, name: 'National Day 15%', type: 'pct', value: 15, plan_ids: [4],
  audience_mode: 'all', delivery_code: true, delivery_auto: false, delivery_email: false,
  code: 'VOXEL15', starts_at: '2026-08-10', ends_at: '2026-08-20',
  renewal_rule: 'first', status: 'draft', effective_status: 'draft',
  uses: 0, picked_count: 0, requires_checkout: true,
};
const LIST = { offers: [OFFER], plans: PLANS, settings: SETTINGS };

const IMPACT_OK = {
  impact: [{ plan_id: 4, plan_name: 'Plus', price_usd: 59, new_price: 50.15,
    margin_before: 0.40, margin_after: 0.2941, estimated_cost: null, below_floor: false }],
  margin_target: 0.40, margin_floor: 0.25, cost_share: 0.60,
  violates_floor: false, requires_checkout: true,
};
const IMPACT_BAD = {
  ...IMPACT_OK,
  impact: [{ ...IMPACT_OK.impact[0], margin_after: 0.1429, below_floor: true }],
  violates_floor: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  api.offersList.mockResolvedValue(LIST);
  api.offerMarginImpact.mockResolvedValue(IMPACT_OK);
  api.offerSegmentPreview.mockResolvedValue({ count: 21, sample: [] });
  api.offerCreate.mockResolvedValue({ offer: { ...OFFER, id: 8 }, offers: [OFFER] });
  api.offerApprove.mockResolvedValue({ offers: [{ ...OFFER, status: 'active', effective_status: 'active' }] });
  api.offerPause.mockResolvedValue({ offers: [{ ...OFFER, effective_status: 'paused' }] });
  api.searchUsers.mockResolvedValue({ users: [{ id: 3, email: 'a@b.c', credits: 100, package: 'Plus' }] });
});

const openCreate = async () => {
  const user = userEvent.setup();
  render(<OffersTab onError={() => {}} />);
  await waitFor(() => expect(api.offersList).toHaveBeenCalled());
  await user.click(screen.getByRole('button', { name: /Create offer/i }));
  return user;
};

describe('email campaigns are ON HOLD', () => {
  it('shows the option, disabled, with the badge', async () => {
    await openCreate();
    const label = screen.getByText(/Email campaign to the audience/i).closest('label');
    expect(within(label).getByRole('checkbox')).toBeDisabled();
    expect(within(label).getByText('ON HOLD')).toBeInTheDocument();
  });

  it('explains when it will activate', async () => {
    await openCreate();
    expect(screen.getByText(/on hold until the email server is configured/i)).toBeInTheDocument();
  });

  // The screen must not be able to create an email-delivered offer, however
  // the form is manipulated — there is no sender behind it.
  it('never sends delivery_email = true', async () => {
    const user = await openCreate();
    await user.type(screen.getByPlaceholderText(/National Day/i), 'Test');
    await user.type(screen.getByPlaceholderText('VOXEL15'), 'TEST10');
    await user.click(screen.getByRole('button', { name: /Save as draft/i }));
    await waitFor(() => expect(api.offerCreate).toHaveBeenCalled());
    expect(api.offerCreate.mock.calls[0][0].delivery_email).toBe(false);
  });
});

describe('types that cannot be redeemed yet are labelled', () => {
  it('marks % off and $ off as needing a checkout', async () => {
    await openCreate();
    const pctCard = screen.getByText('% discount').closest('button');
    const fixedCard = screen.getByText('Fixed amount off').closest('button');
    expect(within(pctCard).getByText('NEEDS CHECKOUT')).toBeInTheDocument();
    expect(within(fixedCard).getByText('NEEDS CHECKOUT')).toBeInTheDocument();
  });

  it('does NOT mark bonus credits or free days, which work today', async () => {
    await openCreate();
    const bonus = screen.getByText('Bonus credits').closest('button');
    const days = screen.getByText('Free days / upgrade').closest('button');
    expect(within(bonus).queryByText('NEEDS CHECKOUT')).toBeNull();
    expect(within(days).queryByText('NEEDS CHECKOUT')).toBeNull();
  });

  it('explains why, in plain words, when such a type is selected', async () => {
    await openCreate();   // 'pct' is the default selection
    expect(screen.getByText(/cannot be redeemed yet/i)).toBeInTheDocument();
    expect(screen.getByText(/no checkout, so there is no price/i)).toBeInTheDocument();
  });

  it('drops the warning once a redeemable type is chosen', async () => {
    const user = await openCreate();
    await user.click(screen.getByText('Bonus credits').closest('button'));
    await waitFor(() => expect(screen.queryByText(/cannot be redeemed yet/i)).toBeNull());
  });

  it('flags such offers in the list too', async () => {
    render(<OffersTab onError={() => {}} />);
    expect(await screen.findByText('NEEDS CHECKOUT')).toBeInTheDocument();
  });
});

describe('the margin floor gate', () => {
  it('blocks approval until the owner confirms deliberately', async () => {
    api.offerMarginImpact.mockResolvedValue(IMPACT_BAD);
    const user = await openCreate();
    await waitFor(() => expect(screen.getByText(/below your 25.0% margin floor/i)).toBeInTheDocument());

    const submit = screen.getByRole('button', { name: /Submit & approve/i });
    expect(submit).toBeDisabled();

    await user.click(screen.getByRole('checkbox', { name: /Approve below the floor anyway/i }));
    expect(submit).toBeEnabled();
  });

  it('tells the owner the confirmation is audited against their name', async () => {
    api.offerMarginImpact.mockResolvedValue(IMPACT_BAD);
    await openCreate();
    expect(await screen.findByText(/recorded in the audit trail against your name/i)).toBeInTheDocument();
  });

  it('passes the below-floor confirmation to the server', async () => {
    api.offerMarginImpact.mockResolvedValue(IMPACT_BAD);
    const user = await openCreate();
    await waitFor(() => screen.getByText(/below your 25.0% margin floor/i));
    await user.type(screen.getByPlaceholderText(/National Day/i), 'Deep discount');
    await user.type(screen.getByPlaceholderText('VOXEL15'), 'DEEP30');
    await user.click(screen.getByRole('checkbox', { name: /Approve below the floor anyway/i }));
    await user.click(screen.getByRole('button', { name: /Submit & approve/i }));
    await waitFor(() => expect(api.offerApprove).toHaveBeenCalledWith(8, true));
  });

  it('says so plainly when every plan clears the floor', async () => {
    await openCreate();
    expect(await screen.findByText(/stay above the 25.0% margin floor/i)).toBeInTheDocument();
  });
});

describe('margin numbers come from the server', () => {
  it('renders the server’s figures rather than recomputing them', async () => {
    await openCreate();
    await waitFor(() => expect(api.offerMarginImpact).toHaveBeenCalled());
    expect(await screen.findByText(/40\.0% → 29\.4%/)).toBeInTheDocument();
  });

  it('asks the server again when the type or value changes', async () => {
    const user = await openCreate();
    await waitFor(() => expect(api.offerMarginImpact).toHaveBeenCalled());
    const before = api.offerMarginImpact.mock.calls.length;
    await user.click(screen.getByText('Bonus credits').closest('button'));
    await waitFor(() => expect(api.offerMarginImpact.mock.calls.length).toBeGreaterThan(before));
  });
});

describe('validation before approval', () => {
  it('refuses to approve a nameless offer and says why', async () => {
    const user = await openCreate();
    await user.click(screen.getByRole('button', { name: /Submit & approve/i }));
    expect(await screen.findByText(/give the offer a name/i)).toBeInTheDocument();
    expect(api.offerCreate).not.toHaveBeenCalled();
  });

  it('marks the code box when promo-code delivery is on but no code is typed', async () => {
    const user = await openCreate();
    await user.type(screen.getByPlaceholderText(/National Day/i), 'Test');
    await user.click(screen.getByRole('button', { name: /Submit & approve/i }));
    // Per-box now: the empty box turns red and says so, instead of the reason
    // appearing only in an aggregate line far from the box it refers to.
    expect(await screen.findByText(/You must fill this/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('VOXEL15')).toHaveAttribute('aria-invalid', 'true');
    expect(api.offerCreate).not.toHaveBeenCalled();
  });

  // A draft is a scratchpad; forcing it through full validation makes it
  // useless for saving work in progress.
  it('saves a draft without full validation', async () => {
    const user = await openCreate();
    await user.click(screen.getByRole('button', { name: /Save as draft/i }));
    await waitFor(() => expect(api.offerCreate).toHaveBeenCalled());
  });
});

describe('the list', () => {
  it('shows status, code and period', async () => {
    render(<OffersTab onError={() => {}} />);
    expect(await screen.findByText('National Day 15%')).toBeInTheDocument();
    expect(screen.getByText('Code VOXEL15')).toBeInTheDocument();
    expect(screen.getByText('draft')).toBeInTheDocument();
  });

  it('offers Approve on a draft, not Pause', async () => {
    render(<OffersTab onError={() => {}} />);
    await screen.findByText('National Day 15%');
    expect(screen.getByRole('button', { name: /^Approve$/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Pause$/ })).toBeNull();
  });

  it('offers Pause on a running offer', async () => {
    api.offersList.mockResolvedValue({
      ...LIST, offers: [{ ...OFFER, status: 'active', effective_status: 'active' }] });
    render(<OffersTab onError={() => {}} />);
    await screen.findByText('National Day 15%');
    expect(screen.getByRole('button', { name: /^Pause$/ })).toBeInTheDocument();
  });

  it('states that approving does not itself move money', async () => {
    render(<OffersTab onError={() => {}} />);
    expect(await screen.findByText(/does not itself take money or grant credits/i)).toBeInTheDocument();
  });
});
