// N1 (recheck 2026-08-03): 2FA was correct on the server and unreachable from
// any screen. These tests pin the two things that made it unusable: the panel
// can now enrol, and the login form can now answer a totp_required challenge.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SecurityTab from './SecurityTab';

// vi.mock is hoisted above module scope, so the spies must be created inside
// vi.hoisted to exist by the time the factory runs.
const api = vi.hoisted(() => ({
  twoFactorStatus: vi.fn(),
  twoFactorSetup: vi.fn(),
  twoFactorConfirm: vi.fn(),
  twoFactorDisable: vi.fn(),
}));

vi.mock('@/lib/adminApi', () => ({ adminApi: api }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
  api.twoFactorStatus.mockResolvedValue({ enabled: false, recovery_codes_remaining: 0 });
  api.twoFactorSetup.mockResolvedValue({
    secret: 'JBSWY3DPEHPK3PXP',
    otpauth_uri: 'otpauth://totp/Voxel%20AI:admin@voxel-ai.ai?secret=JBSWY3DPEHPK3PXP&issuer=Voxel%20AI',
  });
  api.twoFactorConfirm.mockResolvedValue({
    enabled: true,
    recovery_codes: ['AAAA-1111', 'BBBB-2222', 'CCCC-3333'],
  });
});

describe('SecurityTab (N1)', () => {
  it('shows two-factor as off and offers to turn it on', async () => {
    render(<SecurityTab />);
    await waitFor(() => expect(screen.getByText('Off')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /turn on two-factor/i })).toBeInTheDocument();
  });

  it('shows the setup key in typeable groups and the authenticator link', async () => {
    const user = userEvent.setup();
    render(<SecurityTab />);
    await waitFor(() => screen.getByRole('button', { name: /turn on two-factor/i }));
    await user.click(screen.getByRole('button', { name: /turn on two-factor/i }));

    // Grouped in fours so it can be typed into an authenticator without losing place.
    await waitFor(() => expect(screen.getByText('JBSW Y3DP EHPK 3PXP')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: /open in authenticator/i }))
      .toHaveAttribute('href', expect.stringContaining('otpauth://totp/'));
  });

  it('confirms with a live code and shows the recovery codes exactly once', async () => {
    const user = userEvent.setup();
    // After confirmation the status reload must report enabled.
    api.twoFactorStatus
      .mockResolvedValueOnce({ enabled: false, recovery_codes_remaining: 0 })
      .mockResolvedValue({ enabled: true, recovery_codes_remaining: 3 });

    render(<SecurityTab />);
    await waitFor(() => screen.getByRole('button', { name: /turn on two-factor/i }));
    await user.click(screen.getByRole('button', { name: /turn on two-factor/i }));
    await waitFor(() => screen.getByPlaceholderText('6-digit code'));

    await user.type(screen.getByPlaceholderText('6-digit code'), '123456');
    await user.click(screen.getByRole('button', { name: /^confirm$/i }));

    await waitFor(() => expect(api.twoFactorConfirm).toHaveBeenCalledWith('123456'));
    expect(await screen.findByText('AAAA-1111')).toBeInTheDocument();
    expect(screen.getByText('CCCC-3333')).toBeInTheDocument();
    // Dismissing is the only way to clear them — they are never re-fetchable.
    await user.click(screen.getByRole('button', { name: /i have saved them/i }));
    await waitFor(() => expect(screen.queryByText('AAAA-1111')).not.toBeInTheDocument());
  });

  it('refuses to submit a code that is not six digits', async () => {
    const user = userEvent.setup();
    render(<SecurityTab />);
    await waitFor(() => screen.getByRole('button', { name: /turn on two-factor/i }));
    await user.click(screen.getByRole('button', { name: /turn on two-factor/i }));
    await waitFor(() => screen.getByPlaceholderText('6-digit code'));

    await user.type(screen.getByPlaceholderText('6-digit code'), '12');
    await user.click(screen.getByRole('button', { name: /^confirm$/i }));
    expect(api.twoFactorConfirm).not.toHaveBeenCalled();
  });

  it('requires a live code to turn two-factor off', async () => {
    const user = userEvent.setup();
    api.twoFactorStatus.mockResolvedValue({ enabled: true, recovery_codes_remaining: 7 });
    render(<SecurityTab />);

    await waitFor(() => expect(screen.getByText('On')).toBeInTheDocument());
    expect(screen.getByText(/7 recovery codes left/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /turn off two-factor/i }));
    await user.click(screen.getByRole('button', { name: /^turn off$/i }));
    // No code typed → never reaches the server.
    expect(api.twoFactorDisable).not.toHaveBeenCalled();

    await user.type(screen.getByPlaceholderText('6-digit code'), '654321');
    await user.click(screen.getByRole('button', { name: /^turn off$/i }));
    await waitFor(() => expect(api.twoFactorDisable).toHaveBeenCalledWith('654321'));
  });
});
