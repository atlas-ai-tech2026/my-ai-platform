// ─── PromoTopUpPanel.test.jsx ────────────────────────────────────────────────
// Raising a code's value for everyone who already used it.
//
// ☠ IT SPENDS REAL MONEY. 59 people × 92 credits is about $344. The bill is
// stated before anything moves, and applying sends back the headcount the
// preview showed — someone who redeemed in between already received the NEW
// value, so topping them up as well would pay them twice.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PromoTopUpPanel from './PromoTopUpPanel';

const api = vi.hoisted(() => ({ promoTopUpPreview: vi.fn(), promoTopUpApply: vi.fn() }));
vi.mock('@/lib/adminApi', () => ({ adminApi: api }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

const PROMO = { id: 7, code: 'VOXEL-VPW9-DY93', credits: 158 };
const PLAN = {
  ok: true, from: 158, to: 250, each: 92, people: 59,
  total_credits: 5428, total_usd: 343.77,
  sentence: 'Raise VOXEL-VPW9-DY93 from 158 to 250 credits. 59 people who have already redeemed '
    + 'it will each receive 92 more — 5,428 credits, about $343.77. Anyone redeeming from now on gets 250.',
};

beforeEach(() => {
  vi.clearAllMocks();
  api.promoTopUpPreview.mockResolvedValue(PLAN);
  api.promoTopUpApply.mockResolvedValue({
    code: 'VOXEL-VPW9-DY93', from: 158, to: 250, each: 92, people: 59,
    sentence: 'VOXEL-VPW9-DY93 is now worth 250 credits. 59 people received 92 more each.',
  });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

const openAndCheck = async (user, value = '250') => {
  render(<PromoTopUpPanel promo={PROMO} onError={vi.fn()} onDone={vi.fn()} />);
  await user.click(screen.getByRole('button', { name: /Raise the value/ }));
  await user.type(screen.getByLabelText('New value for VOXEL-VPW9-DY93'), value);
  await user.click(screen.getByRole('button', { name: /Check first/ }));
};

describe('☠ THE BILL BEFORE THE MONEY', () => {
  it('shows people, the difference each, the total and the DOLLARS', async () => {
    const user = userEvent.setup();
    await openAndCheck(user);
    expect(await screen.findByText(/59 people who have already redeemed it/)).toBeInTheDocument();
    expect(screen.getByText('+92')).toBeInTheDocument();
    expect(screen.getByText('$343.77')).toBeInTheDocument();
    expect(api.promoTopUpApply).not.toHaveBeenCalled();       // nothing spent yet
  });

  it('sends back the headcount it displayed', async () => {
    const user = userEvent.setup();
    await openAndCheck(user);
    await user.click(await screen.findByRole('button', { name: /Raise to 250 and give 59 people/ }));
    await waitFor(() => expect(api.promoTopUpApply).toHaveBeenCalledWith(7, 250, 59));
  });

  it('☠ editing the value clears the bill, so a stale number cannot be approved', async () => {
    const user = userEvent.setup();
    await openAndCheck(user);
    await screen.findByText(/59 people who have already redeemed/);
    await user.type(screen.getByLabelText('New value for VOXEL-VPW9-DY93'), '0');
    expect(screen.queryByText(/59 people who have already redeemed/)).toBeNull();
  });

  it('refuses to check with no value given', async () => {
    const user = userEvent.setup();
    render(<PromoTopUpPanel promo={PROMO} onError={vi.fn()} onDone={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /Raise the value/ }));
    await user.click(screen.getByRole('button', { name: /Check first/ }));
    expect(api.promoTopUpPreview).not.toHaveBeenCalled();
  });
});

describe('☠ WHAT IT WILL NOT DO', () => {
  it('a refusal is explained, and offers no button', async () => {
    api.promoTopUpPreview.mockResolvedValue({
      ok: false, reason: 'lower',
      sentence: 'VOXEL-VPW9-DY93 is worth 158 credits and cannot be lowered to 100. '
        + 'Credits people have already spent cannot be taken back… Deactivate it and issue a new one instead.',
    });
    const user = userEvent.setup();
    await openAndCheck(user, '100');
    expect(await screen.findByText(/cannot be lowered to 100/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Raise to/ })).toBeNull();
  });
});

describe('what the panel says before you open it', () => {
  it('names the code and its current value, so the button is not a mystery', () => {
    render(<PromoTopUpPanel promo={PROMO} onError={vi.fn()} onDone={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Raise the value/ }))
      .toHaveAttribute('title', expect.stringContaining('158 credits'));
  });

  it('and explains that nobody has to do anything', async () => {
    const user = userEvent.setup();
    render(<PromoTopUpPanel promo={PROMO} onError={vi.fn()} onDone={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /Raise the value/ }));
    expect(screen.getByText(/No new code, and they do nothing/)).toBeInTheDocument();
  });
});
