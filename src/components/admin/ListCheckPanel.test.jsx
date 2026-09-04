// ─── ListCheckPanel.test.jsx ─────────────────────────────────────────────────
// The screen that answers "which of these 84 people do we already have?" —
// asked BEFORE anything is created, instead of discovered afterwards in a
// report. Fifteen accounts in the owner's SPA 4 data received credits twice on
// the same day because nobody could ask it.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ListCheckPanel from './ListCheckPanel';

const api = vi.hoisted(() => ({ checkUserList: vi.fn() }));
vi.mock('@/lib/adminApi', () => ({ adminApi: api }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

const answer = {
  sentence: '4 addresses checked — 2 already have accounts, 1 is new, 1 is not a usable address.',
  existing: ['faai-2011@hotmail.com', 'layan.almaqoshi@gmail.com'],
  fresh: ['newcomer@gmail.com'],
  invalid: ['not-an-email'],
  dupes: 0,
  counts: { submitted: 4, usable: 3, existing: 2, fresh: 1, invalid: 1, duplicates: 0 },
  accounts: [
    { email: 'faai-2011@hotmail.com', id: 11, credits: 474 },
    { email: 'layan.almaqoshi@gmail.com', id: 12, credits: 474 },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  api.checkUserList.mockResolvedValue(answer);
});

describe('checking a list before acting on it', () => {
  it('sends what was pasted and shows the answer as a sentence', async () => {
    const user = userEvent.setup();
    render(<ListCheckPanel onError={vi.fn()} />);
    await user.type(screen.getByLabelText('Addresses to check'), 'faai-2011@hotmail.com');
    await user.click(screen.getByRole('button', { name: /Check list/ }));

    await waitFor(() => expect(api.checkUserList).toHaveBeenCalledWith('faai-2011@hotmail.com'));
    expect(await screen.findByText(/2 already have accounts, 1 is new/)).toBeInTheDocument();
  });

  it('☠ says what the people we already know are HOLDING', async () => {
    // The next question after "who is here?" is always "how much do they
    // have?" — asking it in a second screen is how the same list gets topped
    // up twice.
    const user = userEvent.setup();
    render(<ListCheckPanel onError={vi.fn()} />);
    await user.type(screen.getByLabelText('Addresses to check'), 'a@b.com');
    await user.click(screen.getByRole('button', { name: /Check list/ }));
    expect(await screen.findByText(/Holding 948 credits between them/)).toBeInTheDocument();
  });

  it('names each group by what to DO with it, not by its status', async () => {
    const user = userEvent.setup();
    render(<ListCheckPanel onError={vi.fn()} />);
    await user.type(screen.getByLabelText('Addresses to check'), 'a@b.com');
    await user.click(screen.getByRole('button', { name: /Check list/ }));
    expect(await screen.findByText(/Top these up — do not create them again/)).toBeInTheDocument();
    expect(screen.getByText(/These need creating/)).toBeInTheDocument();
    expect(screen.getByText(/Check these with the customer/)).toBeInTheDocument();
  });

  it('offers each group as its own CSV', async () => {
    const user = userEvent.setup();
    render(<ListCheckPanel onError={vi.fn()} />);
    await user.type(screen.getByLabelText('Addresses to check'), 'a@b.com');
    await user.click(screen.getByRole('button', { name: /Check list/ }));
    const csvs = await screen.findAllByRole('button', { name: /⬇ CSV/ });
    expect(csvs).toHaveLength(3);            // existing · new · unusable
    expect(csvs.map((b) => b.textContent)).toEqual(['⬇ CSV — 2', '⬇ CSV — 1', '⬇ CSV — 1']);
  });

  it('☠ never shows a shortened list without saying it is shortened', async () => {
    // A line once read "11" above a detail listing six, with nothing to say
    // five were hidden. That rule is why this test exists.
    api.checkUserList.mockResolvedValue({
      ...answer,
      fresh: Array.from({ length: 14 }, (_, i) => `new${i}@a.com`),
      counts: { ...answer.counts, fresh: 14 },
    });
    const user = userEvent.setup();
    render(<ListCheckPanel onError={vi.fn()} />);
    await user.type(screen.getByLabelText('Addresses to check'), 'a@b.com');
    await user.click(screen.getByRole('button', { name: /Check list/ }));
    const more = await screen.findByRole('button', { name: /and 6 more/ });
    await user.click(more);
    expect(screen.getByText(/new13@a\.com/)).toBeInTheDocument();
  });

  it('refuses to call the server with an empty box', async () => {
    const user = userEvent.setup();
    render(<ListCheckPanel onError={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /Check list/ }));
    expect(api.checkUserList).not.toHaveBeenCalled();
  });

  it('says out loud that it changes nothing', async () => {
    render(<ListCheckPanel onError={vi.fn()} />);
    expect(screen.getByText(/Nothing is created and no credits move/)).toBeInTheDocument();
  });

  it('editing the list clears the previous answer, so a stale one cannot be read as current', async () => {
    const user = userEvent.setup();
    render(<ListCheckPanel onError={vi.fn()} />);
    const box = screen.getByLabelText('Addresses to check');
    await user.type(box, 'a@b.com');
    await user.click(screen.getByRole('button', { name: /Check list/ }));
    // The phrase appears TWICE on purpose — in the sentence and on the green
    // group — so count them rather than expecting one.
    await waitFor(() => expect(screen.getAllByText(/2 already have accounts/)).toHaveLength(2));
    await user.type(box, 'x');
    expect(screen.queryAllByText(/2 already have accounts/)).toHaveLength(0);
  });
});
