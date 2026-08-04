// ─── AdminGuard.test.jsx ─────────────────────────────────────────────────────
// Regression test for a bug I shipped to dev with N3.
//
// N3 replaced "decode the localStorage token" with "ask the server who we are".
// That made identity asynchronous, so the component needed a third state:
// `undefined` = still asking. I guarded it with an early `return null` — but
// placed it ABOVE useCallback and the idle-timer useEffect.
//
// Result: the first render ran five hooks and the second ran seven. React
// forbids that (error #310, "rendered more hooks than during the previous
// render") and it crashed the entire admin panel to a BLACK SCREEN. Every unit
// test still passed, because nothing rendered AdminGuard itself.
//
// These tests render it through the real async transition, which is the only
// way this class of bug shows up.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AdminGuard from './AdminGuard';

const api = vi.hoisted(() => ({
  me: vi.fn(),
  login: vi.fn(),
  logout: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/lib/adminApi', async () => {
  const actual = await vi.importActual('@/lib/adminApi');
  return { ...actual, adminApi: api };
});

function renderGuard() {
  return render(
    <MemoryRouter>
      <AdminGuard><div>ADMIN PANEL CONTENT</div></AdminGuard>
    </MemoryRouter>
  );
}

let errorSpy;
beforeEach(() => {
  vi.clearAllMocks();
  // A hook-order violation surfaces as a console error before the throw.
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => errorSpy.mockRestore());

/** Fail loudly if React complained about hooks during the transition. */
function expectNoHookOrderError() {
  const messages = errorSpy.mock.calls.map((c) => String(c[0] ?? '')).join('\n');
  expect(
    /rendered more hooks|rendered fewer hooks|order of Hooks|Minified React error #(300|310)/i.test(messages),
    `React reported a hook-order violation — the panel would render a black screen:\n${messages}`
  ).toBe(false);
}

describe('AdminGuard survives the async identity check (N3 regression)', () => {
  it('renders the panel for an admin without a hook-order crash', async () => {
    api.me.mockResolvedValue({ user: { id: 1, email: 'a@b.c', role: 'admin' } });
    renderGuard();

    // First paint happens while identity is still unknown — this is the render
    // that used to run a different number of hooks than the next one.
    expect(screen.queryByText('ADMIN PANEL CONTENT')).not.toBeInTheDocument();

    await waitFor(() => expect(screen.getByText('ADMIN PANEL CONTENT')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
    expectNoHookOrderError();
  });

  it('falls back to the sign-in form when the server says we are not signed in', async () => {
    api.me.mockRejectedValue(new Error('401'));
    renderGuard();

    await waitFor(() => expect(screen.getByPlaceholderText('Email')).toBeInTheDocument());
    expect(screen.getByPlaceholderText('Password')).toBeInTheDocument();
    expect(screen.queryByText('ADMIN PANEL CONTENT')).not.toBeInTheDocument();
    expectNoHookOrderError();
  });

  it('shows nothing — not the login form — while the answer is still pending', async () => {
    // Never resolves: the "still asking" state must not flash a sign-in form at
    // an admin who is in fact already signed in.
    api.me.mockReturnValue(new Promise(() => {}));
    renderGuard();

    expect(screen.queryByPlaceholderText('Email')).not.toBeInTheDocument();
    expect(screen.queryByText('ADMIN PANEL CONTENT')).not.toBeInTheDocument();
    expectNoHookOrderError();
  });

  it('does not render the panel for a signed-in non-admin', async () => {
    api.me.mockResolvedValue({ user: { id: 2, email: 'u@b.c', role: 'user' } });
    renderGuard();

    await waitFor(() => expect(api.me).toHaveBeenCalled());
    expect(screen.queryByText('ADMIN PANEL CONTENT')).not.toBeInTheDocument();
    expectNoHookOrderError();
  });

  it('asks the server for identity instead of reading a stored token', async () => {
    api.me.mockResolvedValue({ user: { id: 1, email: 'a@b.c', role: 'admin' } });
    renderGuard();
    await waitFor(() => expect(api.me).toHaveBeenCalledTimes(1));
    // The whole point of N3: nothing readable by page JavaScript.
    expect(localStorage.getItem('voxel_token')).toBeNull();
  });
});
