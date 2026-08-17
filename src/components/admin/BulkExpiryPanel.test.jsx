// ─── BulkExpiryPanel.test.jsx ────────────────────────────────────────────────
// A button that closes access for every customer at once deserves more care
// than most. These cover the three ways it could go wrong in a way the owner
// would only discover afterwards:
//
//   · firing without a confirmation
//   · defaulting to "today", cutting people off mid-session
//   · sending a payload that sweeps up accounts created after the click
//
// The admin exclusion is NOT tested here — it lives in the server's SQL, where
// no UI mistake can bypass it (see account-expiry.test.js). That placement is
// deliberate: a client-side guard would be one fetch away from being skipped.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BulkExpiryPanel from './BulkExpiryPanel';

const setBulkExpiry = vi.fn();
vi.mock('@/lib/adminApi', () => ({ adminApi: { setBulkExpiry: (...a) => setBulkExpiry(...a) } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

/** Open the collapsed panel. */
function open() {
  render(<BulkExpiryPanel onDone={vi.fn()} onError={vi.fn()} />);
  fireEvent.click(screen.getByText(/bulk account access/i));
}

beforeEach(() => {
  setBulkExpiry.mockReset().mockResolvedValue({ changed: 584, admins_skipped: 3 });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => { vi.restoreAllMocks(); });

// On 2026-08-17 the owner opened this panel's tab, looked directly at the
// collapsed control, and reported the promo-code field as MISSING FROM
// PRODUCTION. It was not missing. The control was bare dim-grey text with no
// border and no margin, flush above the Refund Audit button, so it read as
// that button's caption. The feature was unreachable for anyone who did not
// already know it was clickable.
//
// A feature nobody can find is not shipped. These two assertions are cheap and
// would have caught it.
describe('the collapsed control looks like a control', () => {
  it('is a real button, not text', () => {
    render(<BulkExpiryPanel />);
    const el = screen.getByRole('button', { name: /bulk account access/i });
    expect(el.tagName).toBe('BUTTON');
  });

  it('has a visible edge and does not sit flush against the next control', () => {
    const { container } = render(<BulkExpiryPanel />);
    const el = screen.getByRole('button', { name: /bulk account access/i });
    // A border is what separates "clickable" from "caption" at a glance.
    expect(el.style.border, 'the control needs a visible border').toMatch(/1px solid/);
    expect(el.style.border).not.toMatch(/none/);
    // And it must own vertical space, or it collides with Refund Audit below.
    expect(container.firstChild.style.marginBottom).toBeTruthy();
  });
});

describe('it cannot fire by accident', () => {
  it('starts collapsed — the destructive button is not on screen', () => {
    render(<BulkExpiryPanel />);
    expect(screen.queryByText(/close access on this date/i)).toBeNull();
  });

  it('asks for confirmation before closing access', async () => {
    open();
    fireEvent.click(screen.getByText(/close access on this date/i));
    expect(window.confirm).toHaveBeenCalled();
  });

  it('does nothing at all if the confirmation is declined', async () => {
    window.confirm.mockReturnValue(false);
    open();
    fireEvent.click(screen.getByText(/close access on this date/i));
    expect(setBulkExpiry).not.toHaveBeenCalled();
  });

  // Someone reading the dialog must be told the truth: this is reversible and
  // destroys nothing. If that promise ever stops being true, this test is the
  // place it should break.
  it('promises in the dialog that nothing is deleted and admins are spared', () => {
    open();
    fireEvent.click(screen.getByText(/close access on this date/i));
    const msg = window.confirm.mock.calls[0][0];
    expect(msg).toMatch(/nothing is deleted/i);
    expect(msg).toMatch(/reverse this at any time/i);
    expect(msg).toMatch(/admin accounts are never affected/i);
  });
});

describe('the date it defaults to', () => {
  // "Today" would cut off anyone mid-workshop — a support incident in front of
  // a paying client. A grace period costs nothing.
  it('is in the future, not today', () => {
    open();
    const input = document.querySelector('input[type="date"]');
    expect(new Date(input.value).getTime()).toBeGreaterThan(Date.now());
  });

  it('is about a week out', () => {
    open();
    const input = document.querySelector('input[type="date"]');
    const days = (new Date(input.value) - new Date()) / 86400000;
    expect(days).toBeGreaterThan(5);
    expect(days).toBeLessThan(9);
  });
});

describe('what it sends', () => {
  it("scopes to accounts that already exist, so tomorrow's signups are spared", async () => {
    open();
    fireEvent.click(screen.getByText(/close access on this date/i));
    await waitFor(() => expect(setBulkExpiry).toHaveBeenCalled());
    expect(setBulkExpiry.mock.calls[0][0]).toMatchObject({ mode: 'set', scope: 'existing' });
    expect(setBulkExpiry.mock.calls[0][0].expires_at).toBeTruthy();
  });

  it('offers the undo, and sends no date with it', async () => {
    open();
    fireEvent.click(screen.getByText(/reopen access for everyone/i));
    await waitFor(() => expect(setBulkExpiry).toHaveBeenCalled());
    expect(setBulkExpiry.mock.calls[0][0]).toEqual({ mode: 'clear' });
  });

  it('reports failure instead of implying it worked', async () => {
    const onError = vi.fn();
    setBulkExpiry.mockRejectedValue(new Error('nope'));
    render(<BulkExpiryPanel onDone={vi.fn()} onError={onError} />);
    fireEvent.click(screen.getByText(/bulk account access/i));
    fireEvent.click(screen.getByText(/close access on this date/i));
    await waitFor(() => expect(onError).toHaveBeenCalled());
  });
});
