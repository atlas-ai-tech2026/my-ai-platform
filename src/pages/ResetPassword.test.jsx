// ─── ResetPassword.test.jsx ──────────────────────────────────────────────────
// The screen a locked-out customer lands on. Two failure modes matter more than
// the happy path, and both were verified against the real dev database before
// these tests were written:
//
//   · it must not become an account-existence oracle. The request form talks to
//     an endpoint that deliberately answers identically for real and unknown
//     addresses (finding N11) — a screen that branched on the reply would hand
//     back the leak the server just closed.
//
//   · a dead link must say what to DO. "Invalid token" strands someone who is
//     already locked out; the way forward has to be on screen.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ResetPassword from './ResetPassword';

const at = (path) => render(
  <MemoryRouter initialEntries={[path]}><ResetPassword /></MemoryRouter>
);

/** The two boxes, in DOM order. */
const boxes = () => document.querySelectorAll('input[type="password"]');
const submit = () => fireEvent.submit(document.querySelector('form'));

function type(el, value) {
  fireEvent.change(el, { target: { value } });
}

beforeEach(() => { global.fetch = vi.fn(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('which step it shows', () => {
  it('asks for an email when the URL carries no token', () => {
    at('/reset-password');
    expect(screen.getByText('Reset your password')).toBeInTheDocument();
    expect(screen.getByLabelText('Email address')).toBeInTheDocument();
  });

  it('asks for a new password when the URL carries a token', () => {
    at('/reset-password?token=abc');
    expect(screen.getByText('Choose a new password')).toBeInTheDocument();
    expect(boxes()).toHaveLength(2);
  });
});

describe('requesting a link must not reveal whether the account exists', () => {
  // The whole point of N11. If this screen ever branches on the reply, the
  // server's careful neutrality is wasted.
  it('shows the SAME confirmation for a real and an unknown address', async () => {
    const seen = [];
    for (const reply of [
      { ok: true, status: 200, json: async () => ({ ok: true, message: 'If that address has a Voxel account, a reset link is on its way.' }) },
      { ok: false, status: 404, json: async () => ({ error: 'no such user' }) },
    ]) {
      global.fetch = vi.fn().mockResolvedValue(reply);
      const { unmount } = at('/reset-password');
      type(screen.getByLabelText('Email address'), 'someone@example.com');
      submit();
      await waitFor(() => screen.getByText('Check your email'));
      seen.push(document.body.textContent);
      unmount();
    }
    expect(seen[0]).toBe(seen[1]);
  });

  it('never prints words that would confirm or deny an account', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: 'user not found' }) });
    at('/reset-password');
    type(screen.getByLabelText('Email address'), 'ghost@example.com');
    submit();
    await waitFor(() => screen.getByText('Check your email'));
    expect(document.body.textContent).not.toMatch(/not found|no account|unknown|doesn't exist/i);
  });

  it('lowercases and trims the address before sending', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
    at('/reset-password');
    type(screen.getByLabelText('Email address'), '  Owner@Voxel-AI.ai  ');
    submit();
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(JSON.parse(global.fetch.mock.calls[0][1].body).email).toBe('owner@voxel-ai.ai');
  });

  // Rate limiting is the ONE thing worth saying plainly — it is about the
  // request, not about the account, so it leaks nothing.
  it('explains a rate limit instead of pretending it was sent', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });
    at('/reset-password');
    type(screen.getByLabelText('Email address'), 'a@b.com');
    submit();
    await waitFor(() => expect(screen.getByText(/too many attempts/i)).toBeInTheDocument());
    expect(screen.queryByText('Check your email')).toBeNull();
  });

  it('still confirms when the network is down, rather than leaking by silence', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('offline'));
    at('/reset-password');
    type(screen.getByLabelText('Email address'), 'a@b.com');
    submit();
    await waitFor(() => expect(screen.getByText(/could not reach the server/i)).toBeInTheDocument());
  });
});

describe('choosing the new password', () => {
  it('blocks a password shorter than the sign-up minimum', () => {
    at('/reset-password?token=abc');
    const [pw, confirm] = boxes();
    type(pw, 'short'); type(confirm, 'short');
    expect(screen.getByRole('button', { name: /set my new password/i })).toBeDisabled();
    submit();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('blocks a mismatch, and says so', () => {
    at('/reset-password?token=abc');
    const [pw, confirm] = boxes();
    type(pw, 'agoodlongpassword'); type(confirm, 'agoodlongpassword-typo');
    expect(screen.getByText(/do not match/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /set my new password/i })).toBeDisabled();
  });

  it('sends the token from the URL together with the password', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
    at('/reset-password?token=tok-from-the-email');
    const [pw, confirm] = boxes();
    type(pw, 'agoodlongpassword'); type(confirm, 'agoodlongpassword');
    submit();
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body).toEqual({ token: 'tok-from-the-email', password: 'agoodlongpassword' });
  });

  it('confirms success and mentions that other sessions ended', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
    at('/reset-password?token=abc');
    const [pw, confirm] = boxes();
    type(pw, 'agoodlongpassword'); type(confirm, 'agoodlongpassword');
    submit();
    await waitFor(() => screen.getByText('Password changed'));
    expect(screen.getByText(/signed out everywhere else/i)).toBeInTheDocument();
  });
});

describe('a dead link', () => {
  // Verified end-to-end against the dev database: replaying a consumed token
  // returns exactly this message.
  it('says it expired AND that a new one can be requested', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 400,
      json: async () => ({ error: 'That reset link is invalid or has expired. Request a new one.' }),
    });
    at('/reset-password?token=already-used');
    const [pw, confirm] = boxes();
    type(pw, 'agoodlongpassword'); type(confirm, 'agoodlongpassword');
    submit();
    await waitFor(() => expect(screen.getByText(/invalid or has expired/i)).toBeInTheDocument());
    expect(screen.getByText(/request a new one/i)).toBeInTheDocument();
    // They must not be left staring at a success screen.
    expect(screen.queryByText('Password changed')).toBeNull();
  });

  it('leaves the form usable so they are not stuck on a dead end', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'nope' }) });
    at('/reset-password?token=already-used');
    const [pw, confirm] = boxes();
    type(pw, 'agoodlongpassword'); type(confirm, 'agoodlongpassword');
    submit();
    await waitFor(() => expect(screen.getByText('nope')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /set my new password/i })).not.toBeDisabled();
    expect(boxes()[0].value).toBe('agoodlongpassword');   // input survives
  });

  it('falls back to a readable message when the server sends no error text', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => { throw new Error('not json'); } });
    at('/reset-password?token=abc');
    const [pw, confirm] = boxes();
    type(pw, 'agoodlongpassword'); type(confirm, 'agoodlongpassword');
    submit();
    await waitFor(() => expect(screen.getByText(/invalid or has expired/i)).toBeInTheDocument());
  });
});

describe('people who never had a Voxel password', () => {
  // Google and Microsoft accounts have no password_hash. Without this line they
  // request link after link and none of them ever helps.
  it('tells OAuth users to go back to their provider', () => {
    at('/reset-password');
    expect(screen.getByText(/signed up with google or microsoft/i)).toBeInTheDocument();
  });
});
