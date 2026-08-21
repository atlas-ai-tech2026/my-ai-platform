// ─── EditWorkspace.test.jsx ──────────────────────────────────────────────────
// The editor makes a PROMISE on screen: no credit badge means this will never
// spend your credits. That promise was agreed with the owner as the reason the
// customer never has to read a pricing page — one glance at a button tells them
// what it costs.
//
// A promise nobody checks is decoration, so it is checked here. The other tests
// cover the two states that look identical on screen and mean opposite things:
// "you have no videos" and "we could not ask".

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import EditWorkspace from './EditWorkspace';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/edit-exec-browser', () => ({ runPlan: vi.fn() }));

const done = (over = {}) => ({
  id: 'v1', type: 'video', status: 'completed',
  result_url: 'https://example.test/a.mp4', prompt: 'A yellow race car',
  duration: 15, ...over,
});

describe('the free promise', () => {
  it('puts NO credit figure on any tool', () => {
    // Precisely: no PRICE. The words "credit badge" and "no credits used"
    // appear on purpose and are the honest half of the promise — what must
    // never appear is a NUMBER of credits next to a tool, because that would
    // be either a pricing change nobody agreed or a lie on screen.
    render(<EditWorkspace clips={[done()]} />);
    const tools = screen.getByText(/TOOLS · ALL FREE/).closest('aside');
    expect(tools.textContent).not.toMatch(/\d+\s*(credit|cr\b)/i);
    expect(document.body.textContent).not.toMatch(/\d+\s*credits?\b/i);
  });

  it('says plainly that nothing is uploaded', () => {
    render(<EditWorkspace clips={[done()]} />);
    expect(screen.getByText(/nothing is uploaded/i)).toBeInTheDocument();
  });

  it('names what is coming as NOT built, and warns it will cost', () => {
    // The failure this prevents is task #30's: a page advertising features it
    // does not have. Listing them as "coming next" is honest; listing them as
    // features is not.
    render(<EditWorkspace clips={[done()]} />);
    const note = screen.getByText(/Coming next/i);
    expect(note).toHaveTextContent(/credit badge/i);
  });
});

describe('what appears in the library', () => {
  it('offers a finished video', () => {
    render(<EditWorkspace clips={[done()]} />);
    expect(screen.getByRole('button', { name: 'A yellow race car' })).toBeInTheDocument();
  });

  it('hides pending and failed generations', () => {
    // They are visible on the Video page but have no file behind them.
    // Offering them ends in "could not load" on a thumbnail the customer can
    // plainly see, which reads as the editor being broken.
    render(<EditWorkspace clips={[
      done({ id: 'p', prompt: 'still cooking', status: 'pending', result_url: null }),
      done({ id: 'f', prompt: 'this one failed', status: 'failed' }),
    ]} />);
    expect(screen.queryByRole('button', { name: 'still cooking' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'this one failed' })).not.toBeInTheDocument();
  });

  it('distinguishes "no videos" from "could not ask"', () => {
    const { rerender } = render(<EditWorkspace clips={[]} />);
    expect(screen.getByText(/No finished videos yet/i)).toBeInTheDocument();

    rerender(<EditWorkspace clips={[]} error="Loading GenerationHistory failed" />);
    expect(screen.getByText(/Loading GenerationHistory failed/)).toBeInTheDocument();
    expect(screen.queryByText(/No finished videos yet/i)).not.toBeInTheDocument();
    // And it must offer the way out, not just the bad news.
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });
});

describe('applying changes', () => {
  it('will not run until the customer has actually asked for something', async () => {
    const user = userEvent.setup();
    render(<EditWorkspace clips={[done()]} />);
    await user.click(screen.getByRole('button', { name: 'A yellow race car' }));

    expect(screen.getByRole('button', { name: /^Apply/ })).toBeDisabled();
    expect(screen.getByText(/Choose a change on the right/i)).toBeInTheDocument();
  });

  it('enables Apply once a platform shape is chosen, and says it is free', async () => {
    const user = userEvent.setup();
    render(<EditWorkspace clips={[done()]} />);
    await user.click(screen.getByRole('button', { name: 'A yellow race car' }));
    await user.click(screen.getByRole('button', { name: /9:16/ }));

    expect(screen.getByRole('button', { name: /Apply 1 change/ })).toBeEnabled();
    expect(screen.getByText(/Free — no credits used/i)).toBeInTheDocument();
  });

  it('offers all four platform shapes', async () => {
    render(<EditWorkspace clips={[done()]} />);
    for (const shape of ['9:16', '1:1', '4:5', '16:9']) {
      expect(screen.getByRole('button', { name: new RegExp(shape) })).toBeInTheDocument();
    }
  });
});
