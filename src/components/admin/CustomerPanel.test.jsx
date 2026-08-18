// ─── CustomerPanel.test.jsx ──────────────────────────────────────────────────
// This screen exists to answer one email: "my video didn't work".
//
// The data was always in the ledger. What was missing is the PAIRING — a
// charge on its own does not say whether the customer received anything, and
// working out by eye which refund cancels which charge is what made answering
// slow. So the tests are about whether the screen produces the sentence you
// would actually reply with, and whether it is honest that older outcomes are
// deduced rather than known.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CustomerPanel from './CustomerPanel';

const customerOverview = vi.fn();
vi.mock('@/lib/adminApi', () => ({ adminApi: { customerOverview: (...a) => customerOverview(...a) } }));

const USER = { id: 42, email: 'aalsulami1123@gmail.com' };

const OVERVIEW = {
  customer: { id: 42, email: USER.email, credits: '70.50', banned: false,
    expires_at: '2026-09-02T00:00:00Z' },
  workshops: [{ code: 'VOXEL-7UMD-Z66C', redeemed_at: '2026-08-03T21:00:00Z',
    workshop: 'Riyadh · August', workshop_date: '2026-08-03', organisation: 'Acme' }],
  totals: { generations: 5, refunds: 2, spent: '54.00', refunded: '25.00',
    last_generation: '2026-08-15T11:42:00Z', recent_failure_pct: 40 },
  generations: [
    { at: '2026-08-15T11:42:00Z', model: 'Kling 3.0', kind: 'video', charged: 12.5,
      outcome: 'delivered', source: 'recorded', duration_ms: 107000, refunded: false },
    { at: '2026-08-15T11:31:00Z', model: 'Kling 3.0 Omni', kind: 'video', charged: 12.5,
      outcome: 'failed', source: 'recorded', duration_ms: 4200,
      failure_reason: 'kie_threw: timed out after 90s', refunded: true },
    { at: '2026-08-14T11:09:00Z', model: 'Nano Banana Pro', kind: 'image', charged: 4,
      outcome: 'delivered', source: 'inferred', duration_ms: null, refunded: false },
  ],
};

beforeEach(() => { customerOverview.mockReset(); customerOverview.mockResolvedValue(OVERVIEW); });

describe('the answer to their email, without reading a ledger', () => {
  it('shows each generation paired with what happened to it', async () => {
    render(<CustomerPanel user={USER} onClose={vi.fn()} onError={vi.fn()} />);
    await screen.findByText('Kling 3.0 Omni');
    expect(screen.getByText('failed → refunded')).toBeInTheDocument();
    expect(screen.getAllByText('delivered').length).toBe(2);
  });

  it('gives the provider’s reason, so the reply can be specific', async () => {
    render(<CustomerPanel user={USER} onClose={vi.fn()} onError={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/timed out after 90s/)).toBeInTheDocument());
  });

  // Who they are and whether they can still use the platform, in one line.
  it('identifies the workshop they came from and when access ends', async () => {
    render(<CustomerPanel user={USER} onClose={vi.fn()} onError={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/Riyadh · August/)).toBeInTheDocument());
    expect(screen.getByText('VOXEL-7UMD-Z66C')).toBeInTheDocument();
    expect(screen.getByText(/access until 2026-09-02/)).toBeInTheDocument();
  });

  it('shows how long a recorded generation actually took', async () => {
    render(<CustomerPanel user={USER} onClose={vi.fn()} onError={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('107.0s')).toBeInTheDocument());
  });
});

describe('marking a deduction as a deduction', () => {
  // Before 16 Aug 2026 nothing recorded outcomes, so "delivered" only means
  // "no refund followed". A support answer built on a guess should look like
  // one.
  it('labels pre-recording rows as inferred', async () => {
    render(<CustomerPanel user={USER} onClose={vi.fn()} onError={vi.fn()} />);
    await screen.findByText('Nano Banana Pro');
    // Twice on purpose: once as the row's label, once in the footnote that
    // explains what it means. Both are wanted.
    expect(screen.getAllByText('inferred').length).toBe(2);
  });

  it('explains what inferred actually means', async () => {
    render(<CustomerPanel user={USER} onClose={vi.fn()} onError={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText(/no refund followed/i)).toBeInTheDocument());
  });

  it('says nothing about inference when every row is recorded', async () => {
    customerOverview.mockResolvedValue({
      ...OVERVIEW,
      generations: OVERVIEW.generations.filter((g) => g.source === 'recorded'),
    });
    render(<CustomerPanel user={USER} onClose={vi.fn()} onError={vi.fn()} />);
    await screen.findByText('Kling 3.0 Omni');
    expect(screen.queryByText('inferred')).toBeNull();
  });
});

describe('an expired or empty account reads correctly', () => {
  it('flags access that has already ended', async () => {
    customerOverview.mockResolvedValue({
      ...OVERVIEW,
      customer: { ...OVERVIEW.customer, expires_at: '2026-08-01T00:00:00Z' },
    });
    render(<CustomerPanel user={USER} onClose={vi.fn()} onError={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/access ended 2026-08-01/)).toBeInTheDocument());
  });

  // The useful detail for a "why can't I do anything" email.
  it('says plainly when someone has never generated, and what they still hold', async () => {
    customerOverview.mockResolvedValue({
      ...OVERVIEW, generations: [], totals: { generations: 0, refunds: 0, recent_failure_pct: null },
    });
    render(<CustomerPanel user={USER} onClose={vi.fn()} onError={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/never generated anything/i)).toBeInTheDocument());
    expect(screen.getByText(/still hold 70.5 credits/i)).toBeInTheDocument();
  });

  it('says when someone signed up without a workshop code', async () => {
    customerOverview.mockResolvedValue({ ...OVERVIEW, workshops: [] });
    render(<CustomerPanel user={USER} onClose={vi.fn()} onError={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/no workshop code/i)).toBeInTheDocument());
  });
});

describe('the panel itself', () => {
  it('closes', async () => {
    const onClose = vi.fn();
    render(<CustomerPanel user={USER} onClose={onClose} onError={vi.fn()} />);
    await userEvent.click(await screen.findByText('Close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('reports an error rather than an empty-looking customer', async () => {
    const onError = vi.fn();
    customerOverview.mockRejectedValue(new Error('boom'));
    render(<CustomerPanel user={USER} onClose={vi.fn()} onError={onError} />);
    await waitFor(() => expect(onError).toHaveBeenCalled());
  });

  it('renders nothing at all without a user', () => {
    const { container } = render(<CustomerPanel user={null} onClose={vi.fn()} onError={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});

// ── the bug that cost an evening ───────────────────────────────────────────
// On 2026-08-17 the owner opened a customer on PRODUCTION and saw an empty
// screen. They reasonably concluded their customer data was gone. It was not:
// 595 users and 29,052 ledger rows were all present. The request had simply
// failed, and the catch block replaced the failure with `{ generations: [] }`
// — which renders "This person has never generated anything."
//
// A screen must never answer a question it could not ask.
describe('a failed request must never look like an empty customer', () => {
  it('does NOT claim the person has never generated anything', async () => {
    customerOverview.mockRejectedValue(Object.assign(new Error('x'), { status: 500 }));
    render(<CustomerPanel user={{ id: 7, email: 'a@b.c' }} onClose={() => {}} onError={() => {}} />);
    await waitFor(() => expect(screen.queryByText(/Loading/)).not.toBeInTheDocument());
    expect(screen.queryByText(/never generated anything/i)).not.toBeInTheDocument();
  });

  it('says the record could not be read, and that nothing is missing', async () => {
    customerOverview.mockRejectedValue(Object.assign(new Error('x'), { status: 500 }));
    render(<CustomerPanel user={{ id: 7, email: 'a@b.c' }} onClose={() => {}} onError={() => {}} />);
    expect(await screen.findByText(/could not be loaded/i)).toBeInTheDocument();
    expect(screen.getByText(/it is unknown/i)).toBeInTheDocument();
  });

  // The single most likely cause, and the one with a reassuring answer.
  it('names an expired session as an expired session', async () => {
    customerOverview.mockRejectedValue(Object.assign(new Error('x'), { status: 401 }));
    render(<CustomerPanel user={{ id: 7, email: 'a@b.c' }} onClose={() => {}} onError={() => {}} />);
    expect(await screen.findByText(/session has expired/i)).toBeInTheDocument();
    expect(screen.getByText(/Nothing is wrong with the data/i)).toBeInTheDocument();
  });

  it('offers a way out rather than requiring a page reload', async () => {
    customerOverview.mockRejectedValue(Object.assign(new Error('x'), { status: 503 }));
    render(<CustomerPanel user={{ id: 7, email: 'a@b.c' }} onClose={() => {}} onError={() => {}} />);
    expect(await screen.findByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  // The other half: a REAL empty customer must still say so.
  it('still reports a genuinely empty customer as empty', async () => {
    customerOverview.mockResolvedValue({
      customer: { id: 7, credits: 70.5 }, totals: { generations: 0 }, generations: [], workshops: [],
    });
    render(<CustomerPanel user={{ id: 7, email: 'a@b.c' }} onClose={() => {}} onError={() => {}} />);
    expect(await screen.findByText(/never generated anything/i)).toBeInTheDocument();
  });
});
