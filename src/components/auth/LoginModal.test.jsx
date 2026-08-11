// ─── LoginModal.test.jsx ─────────────────────────────────────────────────────
// The sign-in screen must only offer methods the SERVER can actually perform.
//
// Before this, Google and Microsoft were hard-coded `live: true`. Production on
// 2026-08-11 had none of GOOGLE_*, MICROSOFT_* or RESEND_API_KEY set, so
// deploying would have shown every customer two buttons that bounce to an error
// page — and a "Forgot password?" that confirms and sends nothing.
//
// The default matters most: if the config call fails, is slow, or the server is
// old and has no such route, the screen must offer LESS, not more. A missing
// button is a much smaller failure than a broken one.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import LoginModal from './LoginModal';

vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({ googleError: '', clearGoogleError: vi.fn() }),
}));

/** Answer /api/auth/methods with `methods`; everything else 404s. */
function serverSays(methods) {
  global.fetch = vi.fn((url) => {
    if (String(url).includes('/api/auth/methods')) {
      return Promise.resolve({ ok: true, json: async () => methods });
    }
    return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
  });
}

const ALL_OFF = { google: false, microsoft: false, password_reset: false };
const ALL_ON = { google: true, microsoft: true, password_reset: true };

beforeEach(() => { serverSays(ALL_OFF); });
afterEach(() => { vi.restoreAllMocks(); });

async function openModal() {
  render(<LoginModal onClose={vi.fn()} />);
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
}

describe('an unconfigured server offers no broken buttons', () => {
  it('hides Google and Microsoft', async () => {
    await openModal();
    await waitFor(() => expect(screen.getByText('Continue with Email')).toBeInTheDocument());
    expect(screen.queryByText('Continue with Google')).toBeNull();
    expect(screen.queryByText('Continue with Microsoft')).toBeNull();
  });

  // A dangling "or" above a single button reads as a rendering bug.
  it('drops the "or" divider when there is nothing to divide', async () => {
    await openModal();
    await waitFor(() => expect(screen.getByText('Continue with Email')).toBeInTheDocument());
    expect(screen.queryByText('or')).toBeNull();
  });

  it('hides "Forgot your password?" when no mail can be sent', async () => {
    await openModal();
    fireEvent.click(screen.getByText('Continue with Email'));
    expect(screen.queryByText(/forgot your password/i)).toBeNull();
  });
});

describe('the default is closed, whatever goes wrong', () => {
  it('offers nothing when the config call fails outright', async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error('offline')));
    await openModal();
    await waitFor(() => expect(screen.getByText('Continue with Email')).toBeInTheDocument());
    expect(screen.queryByText('Continue with Google')).toBeNull();
    expect(screen.queryByText('Continue with Microsoft')).toBeNull();
  });

  // An older server that predates the route returns 404 — must not be read
  // as "everything is available".
  it('offers nothing when the route does not exist', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 404, json: async () => ({}) }));
    await openModal();
    await waitFor(() => expect(screen.getByText('Continue with Email')).toBeInTheDocument());
    expect(screen.queryByText('Continue with Google')).toBeNull();
  });

  it('offers nothing before the answer arrives', () => {
    global.fetch = vi.fn(() => new Promise(() => {}));   // never resolves
    render(<LoginModal onClose={vi.fn()} />);
    expect(screen.queryByText('Continue with Google')).toBeNull();
    expect(screen.queryByText('Continue with Microsoft')).toBeNull();
  });
});

describe('a configured server offers exactly what it reports', () => {
  it('shows both providers and the divider', async () => {
    serverSays(ALL_ON);
    await openModal();
    await waitFor(() => expect(screen.getByText('Continue with Google')).toBeInTheDocument());
    expect(screen.getByText('Continue with Microsoft')).toBeInTheDocument();
    expect(screen.getByText('or')).toBeInTheDocument();
  });

  it('shows only the provider that is actually configured', async () => {
    serverSays({ google: true, microsoft: false, password_reset: false });
    await openModal();
    await waitFor(() => expect(screen.getByText('Continue with Google')).toBeInTheDocument());
    expect(screen.queryByText('Continue with Microsoft')).toBeNull();
  });

  it('shows "Forgot your password?" on sign-in, pointing at the reset page', async () => {
    serverSays(ALL_ON);
    await openModal();
    await waitFor(() => expect(screen.getByText('Continue with Email')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Continue with Email'));
    const link = screen.getByText(/forgot your password/i);
    expect(link).toBeInTheDocument();
    expect(link.getAttribute('href')).toBe('/reset-password');
  });

  // There is nothing to reset on an account that does not exist yet.
  it('hides the reset link on the signup form', async () => {
    serverSays(ALL_ON);
    render(<LoginModal onClose={vi.fn()} initialMode="signup" />);
    await waitFor(() => expect(screen.getByText('Continue with Email')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Continue with Email'));
    expect(screen.queryByText(/forgot your password/i)).toBeNull();
  });
});
