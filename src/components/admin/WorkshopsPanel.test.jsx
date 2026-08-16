// ─── WorkshopsPanel.test.jsx ─────────────────────────────────────────────────
// This screen's job is to answer "did we make money?" — and its harder job is
// to refuse to answer when it cannot do so honestly.
//
// 32 of 82 active models have no supplier cost on file. If a partly-costed
// cohort renders a confident margin, that margin becomes the basis for pricing
// the next workshop. So the tests below care more about the cells that stay
// EMPTY, and about whether an empty cell explains itself, than about the ones
// that fill in.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WorkshopsPanel from './WorkshopsPanel';

const workshops = vi.fn();
const organisations = vi.fn();
const workshopCreate = vi.fn();
vi.mock('@/lib/adminApi', () => ({
  adminApi: {
    workshops: (...a) => workshops(...a),
    organisations: (...a) => organisations(...a),
    workshopCreate: (...a) => workshopCreate(...a),
    workshopUpdate: vi.fn(),
    workshopDelete: vi.fn(),
    organisationCreate: vi.fn(),
  },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// Modelled on the real August cohorts.
const GOOD = {
  id: 1, title: 'Riyadh · August', organisation: 'Acme', promo_code: 'VOXEL-7UMD-Z66C',
  workshop_date: '2026-08-03', seats: 169, attendees: 169, currency: 'USD',
  invoiced_usd: 845, supplier_cost_usd: 612, gross_profit_usd: 233, margin_pct: 27.6,
  costed_pct: 100, unstated_because: null, invoice_status: 'paid',
};
const PARTIAL = {
  id: 2, title: 'Jeddah · August', organisation: 'Acme', promo_code: 'VOXEL-2GZT-B79W',
  workshop_date: '2026-08-05', seats: 165, attendees: 160, currency: 'USD',
  invoiced_usd: 825, supplier_cost_usd: 190, gross_profit_usd: null, margin_pct: null,
  costed_pct: 41, invoice_status: 'issued',
  unstated_because: 'only 41% of their spend has a supplier cost on file',
};

const serverHas = (over = {}) => {
  workshops.mockResolvedValue({
    workshops: [], summary: null, unlinked_codes: [], ...over,
  });
  organisations.mockResolvedValue({ organisations: [{ id: 1, name: 'Acme' }] });
};

beforeEach(() => { workshops.mockReset(); organisations.mockReset(); workshopCreate.mockReset(); });

describe('a margin it can stand behind', () => {
  it('shows invoiced, cost and margin when everything is costed', async () => {
    serverHas({ workshops: [GOOD], summary: { workshops: 1, invoiced_usd: 845,
      supplier_cost_usd: 612, gross_profit_usd: 233, margin_pct: 27.6, stated_of: '1 of 1', complete: true } });
    render(<WorkshopsPanel onError={vi.fn()} />);
    expect(await screen.findByText('Riyadh · August')).toBeInTheDocument();
    expect(screen.getByText('27.6%')).toBeInTheDocument();
    expect(screen.getAllByText('$845.00').length).toBeGreaterThan(0);
  });
});

describe('refusing to state a margin it cannot stand behind', () => {
  // The whole point of the screen. A number here would set the next price.
  it('does not print a percentage when only part of the spend is costed', async () => {
    serverHas({ workshops: [PARTIAL] });
    render(<WorkshopsPanel onError={vi.fn()} />);
    await screen.findByText('Jeddah · August');
    expect(screen.queryByText(/^76\.9%$/)).toBeNull();
    expect(screen.getByText(/can’t say yet/)).toBeInTheDocument();
  });

  // An empty cell reads as zero unless something says otherwise.
  it('explains in words why the margin is missing', async () => {
    serverHas({ workshops: [PARTIAL] });
    render(<WorkshopsPanel onError={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText(/only 41% of their spend has a supplier cost on file/))
        .toBeInTheDocument());
  });

  it('says where to go to fix it', async () => {
    serverHas({ workshops: [PARTIAL] });
    render(<WorkshopsPanel onError={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText(/looks better than the truth/i)).toBeInTheDocument());
  });

  it('flags partial coverage next to the cost itself', async () => {
    serverHas({ workshops: [PARTIAL] });
    render(<WorkshopsPanel onError={vi.fn()} />);
    expect(await screen.findByText('41% costed')).toBeInTheDocument();
  });
});

describe('the headline admits what it rests on', () => {
  it('says how many rows are fully costed, not just the total', async () => {
    serverHas({
      workshops: [GOOD, PARTIAL],
      summary: { workshops: 2, invoiced_usd: 1670, supplier_cost_usd: 802,
        gross_profit_usd: 868, margin_pct: 52, stated_of: '1 of 2', complete: false },
    });
    render(<WorkshopsPanel onError={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('1 of 2')).toBeInTheDocument());
    expect(screen.getByText(/the rest are estimates/i)).toBeInTheDocument();
  });
});

describe('getting started when nothing is recorded', () => {
  it('does not show an empty table with no explanation', async () => {
    serverHas();
    render(<WorkshopsPanel onError={vi.fn()} />);
    expect(await screen.findByText(/No workshops recorded yet/i)).toBeInTheDocument();
  });

  // The cohorts already exist and have already cost money; surfacing them is
  // faster than asking the owner to remember which codes were workshops.
  it('lists promo codes that have attendees but no workshop', async () => {
    serverHas({ unlinked_codes: [{ code: 'VOXEL-KY7X-YDQF', attendees: 117, first_redeemed: '2026-08-04' }] });
    render(<WorkshopsPanel onError={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('VOXEL-KY7X-YDQF')).toBeInTheDocument());
    expect(screen.getByText(/117 attendee\(s\)/)).toBeInTheDocument();
  });

  it('prefills the form from a code so the invoice is the only thing to type', async () => {
    serverHas({ unlinked_codes: [{ code: 'VOXEL-KY7X-YDQF', attendees: 117, first_redeemed: '2026-08-04' }] });
    render(<WorkshopsPanel onError={vi.fn()} />);
    await userEvent.click(await screen.findByText('Record this one'));
    await waitFor(() => expect(screen.getByDisplayValue('VOXEL-KY7X-YDQF')).toBeInTheDocument());
    expect(screen.getByDisplayValue('117')).toBeInTheDocument();
  });
});

describe('attendance against seats booked', () => {
  // Seats invoiced vs people who actually turned up is a real commercial fact,
  // and the difference is invisible anywhere else in the panel.
  it('flags when fewer people signed in than seats were sold', async () => {
    serverHas({ workshops: [PARTIAL] });
    render(<WorkshopsPanel onError={vi.fn()} />);
    expect(await screen.findByText(/5 never signed in/)).toBeInTheDocument();
  });
});

describe('the promo code is explained, not just asked for', () => {
  it('says why the code matters when recording a workshop', async () => {
    serverHas();
    render(<WorkshopsPanel onError={vi.fn()} />);
    await userEvent.click(await screen.findByText('+ Record a workshop'));
    await waitFor(() =>
      expect(screen.getByText(/links the invoice to who attended/i)).toBeInTheDocument());
  });
});

describe('a failing panel does not render a confident zero', () => {
  it('reports the error rather than an empty P&L', async () => {
    const onError = vi.fn();
    workshops.mockRejectedValue(new Error('boom'));
    organisations.mockResolvedValue({ organisations: [] });
    render(<WorkshopsPanel onError={onError} />);
    await waitFor(() => expect(onError).toHaveBeenCalled());
  });
});
