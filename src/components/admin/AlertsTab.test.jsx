// ─── AlertsTab.test.jsx ──────────────────────────────────────────────────────
// The properties that decide whether an alerts screen gets trusted or ignored.
//
// The bar this has to clear: a kie-balance check already ran hourly and was
// correct every time. It was useless because its only output was console.error.
// So these tests are less about rendering and more about the three ways this
// screen could repeat that failure — hiding the severity, letting a live
// problem be marked done, or throwing away the history that shows a pattern.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AlertsTab from './AlertsTab';

const alerts = vi.fn();
const alertsCheck = vi.fn();
const alertAck = vi.fn();
vi.mock('@/lib/adminApi', () => ({
  adminApi: {
    alerts: (...a) => alerts(...a),
    alertsCheck: (...a) => alertsCheck(...a),
    alertAck: (...a) => alertAck(...a),
    alertSettings: vi.fn(),
  },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const SETTINGS = {
  kie_balance_min: 8000, stuck_charge_hours: 2, failure_rate_pct: 15,
  failure_min_attempts: 25, catalogue_stale_hours: 30,
  email_enabled: true, email_to: 'info@voxel-ai.ai',
};

// Modelled on 8 August: the account was empty and every customer was refused.
const DRY = {
  id: 1, key: 'account_dry', kind: 'account_dry', severity: 'critical',
  title: 'Your supplier account is empty or locked — customers are being refused',
  detail: '415 generation(s) failed with the provider refusing on OUR account (fal: 415). '
    + 'Everyone was refunded, so no money is missing — but nothing is being delivered either.',
  status: 'open', seen_count: 9,
  first_seen: new Date(Date.now() - 3 * 3600e3).toISOString(),
  last_seen: new Date().toISOString(),
};

const serverHas = (over = {}) =>
  alerts.mockResolvedValue({ open: [], resolved: [], settings: SETTINGS, last_check_at: null, ...over });

beforeEach(() => { alerts.mockReset(); alertsCheck.mockReset(); alertAck.mockReset(); });

describe('the screen states the problem in the customer’s terms', () => {
  it('shows the alert and what it means, not just a code', async () => {
    serverHas({ open: [DRY] });
    render(<AlertsTab onError={vi.fn()} />);
    expect(await screen.findByText(/supplier account is empty or locked/i)).toBeInTheDocument();
    expect(screen.getByText(/nothing is being delivered either/i)).toBeInTheDocument();
  });

  // Refunded is not the same as fine — that conflation is why 415 failures
  // during a live workshop never registered as a problem.
  it('leads with a critical count so the page cannot be skimmed past', async () => {
    serverHas({ open: [DRY] });
    render(<AlertsTab onError={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/1 critical/)).toBeInTheDocument());
    expect(screen.getByText(/affecting customers right now/i)).toBeInTheDocument();
  });

  it('labels severity in words, not colour alone', async () => {
    serverHas({ open: [DRY] });
    render(<AlertsTab onError={vi.fn()} />);
    expect(await screen.findByText('Critical')).toBeInTheDocument();
  });

  it('says how long it has been going on', async () => {
    serverHas({ open: [DRY] });
    render(<AlertsTab onError={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/still happening after 9 checks/i)).toBeInTheDocument());
  });
});

describe('acknowledging must not look like fixing', () => {
  // The trap: a screen that lets you clear a row makes the problem disappear
  // from view while it is still happening to customers.
  it('keeps the alert on screen after acknowledging', async () => {
    serverHas({ open: [DRY] });
    alertAck.mockResolvedValue({ ok: true });
    alerts.mockResolvedValueOnce({ open: [DRY], resolved: [], settings: SETTINGS })
          .mockResolvedValue({ open: [{ ...DRY, status: 'acknowledged' }], resolved: [], settings: SETTINGS });

    render(<AlertsTab onError={vi.fn()} />);
    await userEvent.click(await screen.findByText('Acknowledge'));

    await waitFor(() => expect(screen.getByText('acknowledged')).toBeInTheDocument());
    expect(screen.getByText(/supplier account is empty or locked/i)).toBeInTheDocument();
  });

  it('offers no way to delete or resolve a live alert from the screen', async () => {
    serverHas({ open: [DRY] });
    render(<AlertsTab onError={vi.fn()} />);
    await screen.findByText('Acknowledge');
    expect(screen.queryByText(/^(Resolve|Delete|Dismiss|Clear)$/i)).toBeNull();
  });
});

describe('an empty screen must read as healthy, not broken', () => {
  it('says nothing needs attention rather than showing a blank page', async () => {
    serverHas();
    render(<AlertsTab onError={vi.fn()} />);
    expect(await screen.findByText(/Nothing needs your attention/i)).toBeInTheDocument();
  });

  it('shows when it last checked, so silence is evidence rather than doubt', async () => {
    serverHas({ last_check_at: new Date(Date.now() - 4 * 60e3).toISOString() });
    render(<AlertsTab onError={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/Checked 4 min ago/)).toBeInTheDocument());
  });
});

describe('resolved history is kept, because recurrence is the signal', () => {
  it('lists what cleared itself in the last week', async () => {
    serverHas({
      resolved: [{ id: 9, title: 'kie.ai balance below 8,000 credits', seen_count: 4,
        resolved_at: new Date(Date.now() - 26 * 3600e3).toISOString() }],
    });
    render(<AlertsTab onError={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/Resolved in the last 7 days \(1\)/)).toBeInTheDocument());
    expect(screen.getByText(/kie\.ai balance below/)).toBeInTheDocument();
  });
});

describe('the thresholds are the owner’s, not hard-coded', () => {
  it('exposes the balance floor and the small-sample guard', async () => {
    serverHas();
    render(<AlertsTab onError={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/Warn when kie credits fall below/)).toBeInTheDocument());
    expect(screen.getByText(/but only after this many attempts/i)).toBeInTheDocument();
    // The reason that guard exists, written where it is set.
    expect(screen.getByText(/3 failures out of 4 is 75% and means nothing/)).toBeInTheDocument();
  });
});

describe('a failing panel does not pretend to be an all-clear', () => {
  it('reports the error instead of rendering a green tick', async () => {
    const onError = vi.fn();
    alerts.mockRejectedValue(new Error('boom'));
    render(<AlertsTab onError={onError} />);
    await waitFor(() => expect(onError).toHaveBeenCalled());
  });
});
