// ─── totals-cover-the-filter.test.jsx ────────────────────────────────────────
// ☠ A MONEY TOTAL THAT COVERS ONLY THE PAGE.
//
// Amr, 2026-09-04: "If you check the file which I gave you for SPA 4, the
// amount is more than this. There is something wrong."
//
// He was right. Manual Credits added up the rows it had been SENT — 100 of
// them — so a filter matching 914 entries reported the credits of 100. His own
// SPA 4 report says 396 entries and 151,671 credits, and the screen showed a
// fraction of it.
//
// I labelled the tiles "on this page", which is honest and still useless: the
// question a money screen is asked is "how much altogether", and a caption
// does not answer it. The database now returns the sum for everything the
// filter matches, on every page.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ManualCreditsTab from './ManualCreditsTab';

const api = vi.hoisted(() => ({ manualCredits: vi.fn(), creditBackfillPreview: vi.fn() }));
vi.mock('@/lib/adminApi', () => ({ adminApi: api }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

// One page of 2 rows, out of 914 matching — the shape that produced the bug.
const PAGE = {
  logs: [
    { id: 1, created_at: '2026-08-20T14:18:00Z', action: 'grant', amount: 395,
      reason: 'spa 4', email: 'a@b.com', admin_email: 'info@voxel-ai.ai' },
    { id: 2, created_at: '2026-08-20T14:19:00Z', action: 'grant', amount: 395,
      reason: 'Spa 4', email: 'c@d.com', admin_email: 'info@voxel-ai.ai' },
  ],
  total: 914,
  credits_total: 151671,      // what the FILTER matches, not the page
  // ☠ The rate is no longer written into ManualCreditsTab.jsx. It read
  // $9,605.78 from a hardcoded 0.063333 while Batches read $9,605.83 from
  // the database — two screens, one workshop, two invoices.
  credit_value: 0.06333333,
  accounts_total: 381,
};

beforeEach(() => {
  vi.clearAllMocks();
  api.manualCredits.mockResolvedValue(PAGE);
  api.creditBackfillPreview.mockResolvedValue({ total_rows: 0, groups: [], would_write: 0, unclassified: 0, sentence: '' });
});

describe('☠ THE TOTALS DESCRIBE THE FILTER, NOT THE PAGE', () => {
  it('shows the credits for everything matched, not the two rows on screen', async () => {
    render(<ManualCreditsTab onError={vi.fn()} />);
    // 790 is what the two visible rows add up to. It must NOT be the answer.
    await waitFor(() => expect(screen.getByText('151,671')).toBeInTheDocument());
    expect(screen.queryByText('790')).toBeNull();
  });

  it('and the accounts, which a page of two could never know', async () => {
    render(<ManualCreditsTab onError={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('381')).toBeInTheDocument());
  });

  it('prices the whole filter in dollars', async () => {
    render(<ManualCreditsTab onError={vi.fn()} />);
    // 151,671 × $0.06333333 = $9,605.83, the value the database holds
    await waitFor(() => expect(screen.getByText(/\$9,605\./)).toBeInTheDocument());
  });

  it('still says how many rows are actually on screen', async () => {
    render(<ManualCreditsTab onError={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('showing 2 on this page')).toBeInTheDocument());
    expect(screen.getByText('914')).toBeInTheDocument();
  });

  it('☠ shows a dash, never a wrong number, if the server sends no total', async () => {
    // Falling back to summing the page would put a plausible, smaller figure
    // on screen — which is the bug, wearing a fallback.
    api.manualCredits.mockResolvedValue({ ...PAGE, credits_total: undefined, accounts_total: undefined });
    render(<ManualCreditsTab onError={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2));
    expect(screen.queryByText('790')).toBeNull();
  });

  it('the screen no longer adds up rows at all', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/components/admin/ManualCreditsTab.jsx'), 'utf8');
    expect(src, 'the page-summing code is back — it will disagree with the header')
      .not.toMatch(/reduce\(\(t, r\) => t \+ Number\(r\.amount/);
  });
});

describe('and the query behind it', () => {
  const server = readFileSync(resolve(process.cwd(), 'server/src/index.js'), 'utf8');

  it('asks the database for the sum, under the same WHERE as the rows', () => {
    expect(server).toMatch(/COALESCE\(SUM\(ch\.amount\), 0\)::float AS credits_total/);
    expect(server).toMatch(/COUNT\(DISTINCT ch\.user_id\)::int AS accounts_total/);
  });

  it('and sends them', () => {
    expect(server).toMatch(/credits_total: Number\(count\.rows\[0\]\.credits_total\)/);
  });
});
