// ─── Edit.test.jsx ───────────────────────────────────────────────────────────
// One bug, one shape, and it is not a crash.
//
// Verified 2026-08-17: this page asked for an email, checked it contained an
// "@", showed "You'll be notified when VOXEL Edit launches!" — and made NO
// request. There was no endpoint and no table. Every person who ever asked to
// hear about VOXEL Edit was lost, and the page went on asking.
//
// So the test that matters is not "does it save" but "does it ever CLAIM to
// have saved when it did not".

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Edit from './Edit';

const success = vi.fn();
const error = vi.fn();
vi.mock('sonner', () => ({ toast: { success: (...a) => success(...a), error: (...a) => error(...a) } }));

// /edit became a GATE on 2026-08-21 — signed out shows the waitlist, signed in
// shows the real editor. The waitlist is the half these tests exist for, so the
// visitor is pinned as signed OUT. Asserting through <Edit /> rather than
// through the waitlist component directly is deliberate: it proves the bug
// cannot come back through the route a real visitor actually takes.
vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: false, isLoadingAuth: false, openAuthModal: vi.fn() }),
}));

beforeEach(() => { success.mockReset(); error.mockReset(); });
afterEach(() => { vi.unstubAllGlobals(); });

const typeAndSubmit = async (addr = 'someone@example.com') => {
  const user = userEvent.setup();
  await user.type(screen.getByPlaceholderText(/enter your email/i), addr);
  await user.click(screen.getByRole('button', { name: /notify me/i }));
};

describe('the /edit waitlist actually collects the address', () => {
  it('POSTs to the waitlist endpoint — the request that never existed', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<Edit />);
    await typeAndSubmit();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/waitlist');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ email: 'someone@example.com', source: 'edit' });
  });

  it('confirms only after the server stored it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }));
    render(<Edit />);
    await typeAndSubmit();
    await waitFor(() => expect(success).toHaveBeenCalled());
  });

  // THE REGRESSION THAT MATTERS. This is the old behaviour, exactly.
  it('does NOT say "you will be notified" when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 503, json: async () => ({ error: 'Not available right now' }),
    }));
    render(<Edit />);
    await typeAndSubmit();

    await waitFor(() => expect(error).toHaveBeenCalled());
    expect(success, 'claimed success while the address was lost').not.toHaveBeenCalled();
  });

  it('does NOT claim success when the server cannot be reached at all', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    render(<Edit />);
    await typeAndSubmit();

    await waitFor(() => expect(error).toHaveBeenCalled());
    expect(success).not.toHaveBeenCalled();
  });

  it('rejects an obviously invalid address without calling the server', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<Edit />);
    await typeAndSubmit('not-an-email');

    expect(error).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(success).not.toHaveBeenCalled();
  });
});
