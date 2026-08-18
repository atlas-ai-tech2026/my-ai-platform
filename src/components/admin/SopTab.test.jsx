// ─── SopTab.test.jsx ─────────────────────────────────────────────────────────
// This screen exists because "how do I check the backup system?" had no answer
// except a raw API URL. So the tests are about whether it actually answers —
// and about the one way a status screen betrays you: showing green for
// something it never checked.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SopTab from './SopTab';

const sop = vi.fn();
const sopCheckNow = vi.fn();
const sopScheduleSave = vi.fn();
vi.mock('@/lib/adminApi', () => ({
  adminApi: {
    sop: (...a) => sop(...a),
    sopCheckNow: (...a) => sopCheckNow(...a),
    sopScheduleSave: (...a) => sopScheduleSave(...a),
  },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));

const line = (over = {}) => ({
  key: 'backup', zone: 'today', label: 'Daily backup', state: 'ok',
  value: '2h ago', detail: 'Written and encrypted.', action: '',
  info: 'A full copy of every table, written daily to two places.',
  checked_at: new Date(Date.now() - 3600_000).toISOString(), ...over,
});

const payload = (lines, extra = {}) => ({
  generated_at: new Date().toISOString(),
  zones: { today: lines },
  summary: { state: lines.some((l) => l.state !== 'ok') ? 'critical' : 'ok', total: lines.length },
  restore_cooldown_min: 0, ...extra,
});

beforeEach(() => { sop.mockReset(); sopCheckNow.mockReset(); sopScheduleSave.mockReset(); });

describe('it answers the question the tab exists for', () => {
  it('shows each check with its value', async () => {
    sop.mockResolvedValue(payload([line()]));
    render(<SopTab onError={vi.fn()} />);
    expect(await screen.findByText('Daily backup')).toBeInTheDocument();
    expect(screen.getByText('2h ago')).toBeInTheDocument();
  });

  it('says plainly when everything is fine — "fine" is what you need before a workshop', async () => {
    sop.mockResolvedValue(payload([line()]));
    render(<SopTab onError={vi.fn()} />);
    expect(await screen.findByText(/Everything is fine/i)).toBeInTheDocument();
  });

  // The point of the screen: not a number to worry about, but what to do.
  it('shows the ACTION for anything that is not OK', async () => {
    sop.mockResolvedValue(payload([line({
      state: 'critical', detail: 'Only one copy exists.',
      action: 'Check the Backblaze credentials and caps.',
    })]));
    render(<SopTab onError={vi.fn()} />);
    expect(await screen.findByText(/Check the Backblaze credentials/)).toBeInTheDocument();
    expect(screen.getByText(/Act now/i)).toBeInTheDocument();
  });
});

describe('green is earned, never assumed', () => {
  // The failure this whole screen is designed against.
  it('shows "not checked" for unknown — it must NOT read as healthy', async () => {
    sop.mockResolvedValue(payload([line({
      state: 'unknown', checked_at: null, value: null,
      detail: 'No backup has been recorded.', action: 'Press Check now.',
    })]));
    render(<SopTab onError={vi.fn()} />);
    expect(await screen.findByText(/Not checked/i)).toBeInTheDocument();
    expect(screen.queryByText(/Everything is fine/i)).not.toBeInTheDocument();
  });

  it('says when a line was last checked, so silence differs from health', async () => {
    sop.mockResolvedValue(payload([line({ checked_at: null })]));
    render(<SopTab onError={vi.fn()} />);
    expect(await screen.findByText(/never checked/i)).toBeInTheDocument();
  });

  // A failed LOAD must not render as a healthy screen — the exact bug that
  // made an expired session look like lost customer data.
  it('renders an error state, not an empty healthy screen, when the load fails', async () => {
    sop.mockRejectedValue(Object.assign(new Error('x'), { status: 500 }));
    render(<SopTab onError={vi.fn()} />);
    expect(await screen.findByText(/could not be read/i)).toBeInTheDocument();
    expect(screen.getByText(/it is unknown/i)).toBeInTheDocument();
    expect(screen.queryByText(/Everything is fine/i)).not.toBeInTheDocument();
  });

  it('names an expired session as an expired session', async () => {
    sop.mockRejectedValue(Object.assign(new Error('x'), { status: 401 }));
    render(<SopTab onError={vi.fn()} />);
    expect(await screen.findByText(/session has expired/i)).toBeInTheDocument();
    expect(screen.getByText(/Nothing is wrong with the system/i)).toBeInTheDocument();
  });
});

describe('Check now', () => {
  it('re-runs the checks and shows the new result', async () => {
    sop.mockResolvedValue(payload([line()]));
    sopCheckNow.mockResolvedValue(payload([line({ value: 'just now' })]));
    render(<SopTab onError={vi.fn()} />);
    await screen.findByText('Daily backup');
    // Exact name: the ⓘ beside it is labelled "What Check now means", which a
    // loose regex also matches — and a test that grabs the wrong control is a
    // test that proves nothing.
    await userEvent.click(screen.getByRole('button', { name: 'Check now' }));
    await waitFor(() => expect(sopCheckNow).toHaveBeenCalled());
    expect(await screen.findByText('just now')).toBeInTheDocument();
  });

  // The restore check downloads a real archive. A button that silently does
  // nothing is worse than one that explains itself.
  it('shows how long until the backup check may run again', async () => {
    sop.mockResolvedValue(payload([line()], { restore_cooldown_min: 42 }));
    render(<SopTab onError={vi.fn()} />);
    expect(await screen.findByText(/backup re-check in 42 min/i)).toBeInTheDocument();
  });
});

describe('the standing ⓘ rule', () => {
  it('gives every line an ⓘ that explains it', async () => {
    sop.mockResolvedValue(payload([line(), line({ key: 'restore', label: 'Restore verified' })]));
    render(<SopTab onError={vi.fn()} />);
    await screen.findByText('Daily backup');
    expect(screen.getByRole('button', { name: /What Daily backup means/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /What Restore verified means/i })).toBeInTheDocument();
  });

  it('reveals the explanation on hover', async () => {
    sop.mockResolvedValue(payload([line()]));
    render(<SopTab onError={vi.fn()} />);
    await screen.findByText('Daily backup');
    await userEvent.hover(screen.getByRole('button', { name: /What Daily backup means/i }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/full copy of every table/i);
  });
});

// The schedule the owner controls. Times cross the wire in KUWAIT hours — an
// unlabelled clock is how the expiry table once rendered every date a day early.
describe('the schedule editor', () => {
  const sched = [{
    job: 'restore', label: 'Backup restore verification', enabled: true,
    every: 'month', hour_kuwait: 4, hour_utc: 1, last_run_at: null,
    info: 'Downloads a real backup and checks it against its own record.',
  }];

  it('shows each check, its cadence and its hour', async () => {
    sop.mockResolvedValue(payload([line()], { schedule: sched }));
    render(<SopTab onError={vi.fn()} />);
    expect(await screen.findByText('Backup restore verification')).toBeInTheDocument();
    expect(screen.getByDisplayValue('month')).toBeInTheDocument();
    expect(screen.getByDisplayValue('04:00')).toBeInTheDocument();
  });

  it('says the times are Kuwait, so nobody has to guess the zone', async () => {
    sop.mockResolvedValue(payload([line()], { schedule: sched }));
    render(<SopTab onError={vi.fn()} />);
    expect(await screen.findByText(/Kuwait \(UTC\+3\)/i)).toBeInTheDocument();
  });

  it('says plainly when a check has never run', async () => {
    sop.mockResolvedValue(payload([line()], { schedule: sched }));
    render(<SopTab onError={vi.fn()} />);
    expect(await screen.findByText(/has never run/i)).toBeInTheDocument();
  });

  it('sends the hour in KUWAIT time when changed', async () => {
    sop.mockResolvedValue(payload([line()], { schedule: sched }));
    sopScheduleSave.mockResolvedValue({ ok: true, schedule: sched });
    render(<SopTab onError={vi.fn()} />);
    await screen.findByText('Backup restore verification');
    await userEvent.selectOptions(
      screen.getByLabelText(/What hour Backup restore verification runs/i), '6');
    await waitFor(() => expect(sopScheduleSave).toHaveBeenCalled());
    expect(sopScheduleSave.mock.calls[0][0]).toMatchObject({ job: 'restore', hour_kuwait: 6 });
  });

  it('gives every schedule row an ⓘ, per the standing rule', async () => {
    sop.mockResolvedValue(payload([line()], { schedule: sched }));
    render(<SopTab onError={vi.fn()} />);
    expect(await screen.findByRole('button',
      { name: /What Backup restore verification means/i })).toBeInTheDocument();
  });
});
