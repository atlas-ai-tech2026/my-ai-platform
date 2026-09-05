// ─── BatchesTab.test.jsx ─────────────────────────────────────────────────────
// The invoice view. These tests guard the two things Amr looked at the screen
// and told me were wrong, so that neither can come back quietly.
//
// 1. EVERY DATE READ "Invalid Date". node-postgres returns a timestamp as a
//    Date OBJECT and the server did String(v).slice(0, 10) -> "Thu Aug 20".
//    Fixed in credit-batches.js; asserted here at the place he actually looks,
//    because a correct function and an unreadable screen is the failure this
//    project keeps repeating.
//
// 2. THE NAME COLUMN REPEATED THE PROMO CODE COLUMN. "There is one column
//    called promo code and you write it there. It is not necessary to write it
//    two times." The name is the code's description now.
//
// And one thing he did not have to ask for: the spellings that used to run
// across the top of the page in one long line moved onto the row that absorbed
// them. Moving information is only safe if it is still reachable, so that is
// tested rather than trusted.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BatchesTab from './BatchesTab';

const api = vi.hoisted(() => ({ creditBatches: vi.fn(), excludeBatch: vi.fn() }));
vi.mock('@/lib/adminApi', () => ({ adminApi: api }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

const BATCHES = [
  {
    key: 'Promo code|voxel-vpw9-dy93', type: 'Promo code',
    name: 'SPA News Academy 5th 4th', code: 'VOXEL-VPW9-DY93',
    date: '2026-09-03', date_to: '2026-09-03', days: 1,
    first: '2026-09-03T09:00:00.000Z', last: '2026-09-03T09:00:00.000Z',
    accounts: 60, credits: 9480, usd: 600.4, entries: 60, spellings: 1, spelt: [],
  },
  {
    key: 'Manual grant|spa 4', type: 'Manual grant', name: 'Spa 4', code: null,
    date: '2026-08-20', date_to: '2026-08-27', days: 2,
    first: '2026-08-20T09:00:00.000Z', last: '2026-08-27T09:00:00.000Z',
    accounts: 381, credits: 151671, usd: 9605.83, entries: 402,
    spellings: 3, spelt: ['spa 4', 'Spa 4', 'Spa 4.'],
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  api.excludeBatch.mockResolvedValue({ ok: true });
  api.creditBatches.mockResolvedValue({
    batches: BATCHES,
    totals: { batches: 2, accounts: 441, credits: 161151, usd: 10206.23 },
    credit_value: 0.063333,
    promo_codes: {
      total: 27,
      unredeemed: [
        { code: 'VOXEL-NEVR-0003', description: 'Made but never handed out', active: true },
        { code: 'VOXEL-NEVR-0004', description: null, active: false },
      ],
    },
  });
});

const rowFor = async (name) => {
  const cell = await screen.findByText(name);
  return cell.closest('tr');
};

describe('BatchesTab', () => {
  it('never prints "Invalid Date"', async () => {
    render(<BatchesTab />);
    await screen.findByText('SPA News Academy 5th 4th');
    expect(document.body.textContent).not.toMatch(/Invalid Date/);
  });

  it('renders a real date for every row', async () => {
    render(<BatchesTab />);
    const row = await rowFor('SPA News Academy 5th 4th');
    // 3 September 2026, however the runner's locale chooses to spell it.
    expect(row.textContent).toMatch(/2026/);
    expect(row.textContent).toMatch(/Sep|09|9/);
  });

  it('shows ONE date — the first day — for a workshop that ran over several', async () => {
    // Amr, 2026-09-05: "Put SPA one the first day only… because it's only for
    // one session." SPA 4's credits were typed on 20 AND 27 August, but that
    // is a fact about the typing, not about the workshop.
    render(<BatchesTab />);
    const row = await rowFor('Spa 4');
    const dateCell = within(row).getAllByRole('cell')[3];
    expect(dateCell.textContent).toMatch(/Aug/);
    expect(dateCell.textContent).not.toMatch(/ to /);
    expect(dateCell.textContent).not.toMatch(/2 days/);
  });

  it('keeps the span on hover, so the days are not thrown away', async () => {
    // Same rule as the spellings: moving information is only safe if it is
    // still reachable.
    render(<BatchesTab />);
    const row = await rowFor('Spa 4');
    const marked = within(row).getAllByRole('cell')[3].querySelector('[title]');
    expect(marked.getAttribute('title')).toMatch(/2 days/);
    expect(marked.getAttribute('title')).toMatch(/one session/);
  });

  it('does not mark a single-day batch as having a span', async () => {
    render(<BatchesTab />);
    const row = await rowFor('SPA News Academy 5th 4th');
    expect(within(row).getAllByRole('cell')[3].querySelector('[title]')).toBeNull();
  });

  it('puts the DESCRIPTION in Name and the CODE in Promo code, never twice', async () => {
    render(<BatchesTab />);
    const row = await rowFor('SPA News Academy 5th 4th');
    const cells = within(row).getAllByRole('cell').map((c) => c.textContent.trim());
    expect(cells[0]).toBe('SPA News Academy 5th 4th');
    expect(cells[2]).toBe('VOXEL-VPW9-DY93');
    // The code appears once on the row, in its own column.
    expect(row.textContent.match(/VOXEL-VPW9-DY93/g)).toHaveLength(1);
  });

  it('keeps the spellings reachable after moving them off the banner', async () => {
    // They used to be listed across the top in one run-on line. If the move
    // lost them, the untidiness would be invisible instead of merely quiet.
    render(<BatchesTab />);
    const row = await rowFor('Spa 4');
    const note = within(row).getByText(/typed 3 ways/);
    for (const spelling of ['spa 4', 'Spa 4', 'Spa 4.']) {
      expect(note.getAttribute('title')).toContain(spelling);
    }
  });

  it('still says at the top that some batches were counted together', async () => {
    render(<BatchesTab />);
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/named more than one way/));
  });

  it('shows the totals, not just the page', async () => {
    // ☠ Amr caught this one: "the amount it's more than this, there is
    // something wrong." The tiles counted the rows on screen, not the filter.
    render(<BatchesTab />);
    await screen.findByText('SPA News Academy 5th 4th');
    expect(document.body.textContent).toMatch(/161,151/);
    expect(document.body.textContent).toMatch(/10,206/);
  });
});

// ─── WHY 27 CODES DO NOT MAKE 27 LINES ──────────────────────────────────────
// Amr counted 27 promo codes on the Promo Codes screen, counted the rows here,
// found fewer, and guessed "maybe you only add the activated one". He had no
// way to find out — the omission was correct and completely silent. Empty rows
// are not the fix; naming the gap is.
describe('BatchesTab · codes that were never redeemed', () => {
  it('says how many exist and how many were never used', async () => {
    render(<BatchesTab />);
    await screen.findByText('SPA News Academy 5th 4th');
    expect(document.body.textContent).toMatch(/27 promo codes exist/);
    expect(document.body.textContent).toMatch(/2 of them have never been redeemed/);
    expect(document.body.textContent).toMatch(/nothing was handed out/);
  });

  it('does not list them as empty rows', async () => {
    // A row reading "0 accounts · $0.00" is noise on an invoice screen, and is
    // something that could be invoiced by mistake.
    render(<BatchesTab />);
    await screen.findByText('SPA News Academy 5th 4th');
    expect(screen.getAllByRole('row')).toHaveLength(1 + BATCHES.length);
    expect(screen.queryByText('VOXEL-NEVR-0003')).toBeNull();
  });

  it('shows which ones on request', async () => {
    render(<BatchesTab />);
    await screen.findByText('SPA News Academy 5th 4th');
    await userEvent.click(screen.getByRole('button', { name: /show which/i }));
    expect(await screen.findByText('VOXEL-NEVR-0003')).toBeTruthy();
    expect(document.body.textContent).toMatch(/Made but never handed out/);
    // Whether it is switched off is shown, because he asked about active codes.
    expect(document.body.textContent).toMatch(/deactivated/);
  });

  it('stays quiet when every code has been used', async () => {
    api.creditBatches.mockResolvedValue({
      batches: BATCHES, totals: { batches: 2, accounts: 441, credits: 161151, usd: 10206.23 },
      credit_value: 0.063333, promo_codes: { total: 27, unredeemed: [] },
    });
    render(<BatchesTab />);
    await screen.findByText('SPA News Academy 5th 4th');
    expect(document.body.textContent).not.toMatch(/never been redeemed/);
  });

  it('stays quiet when promo codes are filtered out entirely', async () => {
    render(<BatchesTab />);
    await screen.findByText('SPA News Academy 5th 4th');
    // The button reads "✓ Promo codes" while the type is on.
    await userEvent.click(screen.getByRole('button', { name: /Promo codes/i }));
    await waitFor(() =>
      expect(document.body.textContent).not.toMatch(/never been redeemed/));
  });
});

// ─── ROWS HE DOES NOT BILL FOR ──────────────────────────────────────────────
// "dahi test" must not be inside a figure he invoices from. It must also not
// be deleted — the person holds the credits.
describe('BatchesTab · not-billable batches', () => {
  const withTest = {
    batches: [
      ...BATCHES,
      { key: 'Manual grant|dahi test', type: 'Manual grant', name: 'dahi test', code: null,
        date: '2026-09-02', date_to: '2026-09-02', days: 1,
        first: '2026-09-02T09:00:00.000Z', last: '2026-09-02T09:00:00.000Z',
        accounts: 1, credits: 100, usd: 6.33, entries: 1, spellings: 1, spelt: [],
        excluded: true },
    ],
    totals: { batches: 2, accounts: 441, credits: 161151, usd: 10206.23,
      excluded: 1, excluded_credits: 100 },
    credit_value: 0.063333,
    promo_codes: { total: 27, unredeemed: [] },
  };

  it('still shows the row, struck through', async () => {
    api.creditBatches.mockResolvedValue(withTest);
    render(<BatchesTab />);
    const cell = await screen.findByText('dahi test');
    expect(cell.style.textDecoration).toBe('line-through');
  });

  it('says how much the totals leave out', async () => {
    api.creditBatches.mockResolvedValue(withTest);
    render(<BatchesTab />);
    await screen.findByText('dahi test');
    expect(document.body.textContent).toMatch(/1 batch is marked not-billable/);
    expect(document.body.textContent).toMatch(/100 credits/);
    expect(document.body.textContent).toMatch(/credits themselves were not touched/);
  });

  it('offers to bill for it again, not to delete it', async () => {
    api.creditBatches.mockResolvedValue(withTest);
    render(<BatchesTab />);
    await screen.findByText('dahi test');
    expect(screen.getByRole('button', { name: /bill for it/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /delete|remove/i })).toBeNull();
  });

  it('excludes a batch without touching the ledger', async () => {
    render(<BatchesTab />);
    await screen.findByText('SPA News Academy 5th 4th');
    const row = (await screen.findByText('Spa 4')).closest('tr');
    await userEvent.click(within(row).getByRole('button', { name: /don't bill/i }));
    expect(api.excludeBatch).toHaveBeenCalledWith('Manual grant|spa 4', true, 'Spa 4');
  });

  it('says nothing about exclusions when there are none', async () => {
    render(<BatchesTab />);
    await screen.findByText('SPA News Academy 5th 4th');
    expect(document.body.textContent).not.toMatch(/not-billable/);
  });
});
