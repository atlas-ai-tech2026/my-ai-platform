// ─── LiveTab.test.jsx ────────────────────────────────────────────────────────
// A live screen fails in ways an ordinary report cannot.
//
// The worst is a quiet moment rendering as a wall of zeros: that reads as an
// outage and sends you looking for a fault mid-session, which is exactly when
// you have no attention to spare. The second worst is going stale without
// saying so — a frozen number is more dangerous than a missing one, because
// you act on it.
//
// The reason this screen exists at all: on 8 August roughly 415 generations
// failed in front of a live cohort because the supplier account was empty.
// Everyone was auto-refunded, so nothing flagged it — from the room it simply
// looked like the platform didn't work.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LiveTab from './LiveTab';

const live = vi.fn();
vi.mock('@/lib/adminApi', () => ({ adminApi: { live: (...a) => live(...a) } }));

const RUNNING = {
  live: true,
  session_started: '2026-08-16T10:04:00Z',
  active_now: 143,
  generating_now: { n: 28, video: 21, image: 7 },
  failed_recent: 6,
  fail_window_min: 10,
  active_window_min: 20,
  generations_recent: 812,
  credits_per_min: 118,
  per_minute: [{ minute: '10:04', n: 12 }, { minute: '10:05', n: 31 }],
  top_models: [{ model: 'Kling 3.0', attempts: 44 }],
  workshop: { code: 'VOXEL-7UMD-Z66C', title: 'Riyadh · August', cohort_size: 169, active: 143 },
  allowed_windows: [20, 60, 180],
  sessions: [{ day: '2026-08-05', generations: 2391, people: 160 }],
  attention: [
    { severity: 'warn', title: '6 failure(s) in the last 10 minutes',
      detail: 'Most activity is on Kling 3.0. If failures cluster there, switch the demo.' },
  ],
};

const QUIET = {
  live: false, active_window_min: 20, fail_window_min: 10,
  active_now: 0, generating_now: { n: 0, video: 0, image: 0 }, failed_recent: 0,
  generations_recent: 0, credits_per_min: 0, per_minute: [], top_models: [],
  workshop: null, attention: [],
  allowed_windows: [20, 60, 180],
  sessions: [{ day: '2026-08-05', generations: 2391, people: 160 }],
};

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); live.mockReset(); });
afterEach(() => vi.useRealTimers());

describe('a quiet platform must not look like a broken one', () => {
  // The failure mode that matters most. Zeros everywhere reads as an outage.
  it('says nothing is running instead of showing a wall of zeros', async () => {
    live.mockResolvedValue(QUIET);
    render(<LiveTab onError={vi.fn()} />);
    expect(await screen.findByText('Nothing running')).toBeInTheDocument();
    expect(screen.getByText(/No generations in the last 20 minutes/)).toBeInTheDocument();
  });

  it('says plainly that quiet is not a fault', async () => {
    live.mockResolvedValue(QUIET);
    render(<LiveTab onError={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/That is not a fault/)).toBeInTheDocument());
  });

  it('hides the numbers entirely when nothing is running', async () => {
    live.mockResolvedValue(QUIET);
    render(<LiveTab onError={vi.fn()} />);
    await screen.findByText('Nothing running');
    expect(screen.queryByText('Generating recently')).toBeNull();
    expect(screen.queryByText('Credits / min')).toBeNull();
  });
});

describe('during a session', () => {
  it('names the workshop in the room', async () => {
    live.mockResolvedValue(RUNNING);
    render(<LiveTab onError={vi.fn()} />);
    expect(await screen.findByText('Riyadh · August')).toBeInTheDocument();
  });

  // Four numbers, readable from a lectern.
  it('shows the four numbers that matter, and what they cost', async () => {
    live.mockResolvedValue(RUNNING);
    render(<LiveTab onError={vi.fn()} />);
    await screen.findByText('143');
    expect(screen.getByText('28')).toBeInTheDocument();
    expect(screen.getByText('21 video · 7 image')).toBeInTheDocument();
    expect(screen.getByText('118')).toBeInTheDocument();
    expect(screen.getByText(/≈ \$7\.47\/min/)).toBeInTheDocument();
  });

  it('puts activity against the size of the cohort, and names the window', async () => {
    live.mockResolvedValue(RUNNING);
    render(<LiveTab onError={vi.fn()} />);
    // The window is stated beside the number because the number's MEANING
    // changes with it — 143 over 20 minutes is not 143 over three hours.
    await waitFor(() =>
      expect(screen.getByText(/of 169 in this cohort · last 20 min/)).toBeInTheDocument());
  });

  // The label was "Active now", which promised attendance and delivered
  // something narrower: people who generated. In a room of 170 where 40 follow
  // along without generating, it read low against a label that said otherwise.
  it('says what it actually counts — generating, not merely present', async () => {
    live.mockResolvedValue(RUNNING);
    render(<LiveTab onError={vi.fn()} />);
    expect(await screen.findByText('Generating recently')).toBeInTheDocument();
    expect(screen.queryByText('Active now')).toBeNull();
  });

  // A list of things needing a DECISION, not a list of facts.
  it('tells you what to do about the failures, not just that they happened', async () => {
    live.mockResolvedValue(RUNNING);
    render(<LiveTab onError={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/switch the demo/i)).toBeInTheDocument());
  });

  it('says so explicitly when nothing needs a decision', async () => {
    live.mockResolvedValue({ ...RUNNING, attention: [], failed_recent: 0 });
    render(<LiveTab onError={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/Nothing needs a decision/)).toBeInTheDocument());
  });
});

describe('it keeps itself current', () => {
  // A screen you must remember to reload is not a live screen.
  it('refreshes on its own', async () => {
    live.mockResolvedValue(RUNNING);
    render(<LiveTab onError={vi.fn()} />);
    await screen.findByText('Riyadh · August');
    expect(live).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(live).toHaveBeenCalledTimes(2);
  });

  // A frozen number is worse than a missing one, because you act on it.
  it('shows when it last updated', async () => {
    live.mockResolvedValue(RUNNING);
    render(<LiveTab onError={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/updated .* · refreshes every 10s/)).toBeInTheDocument());
  });

  it('stops polling when the tab goes away', async () => {
    live.mockResolvedValue(RUNNING);
    const { unmount } = render(<LiveTab onError={vi.fn()} />);
    await screen.findByText('Riyadh · August');
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(live).toHaveBeenCalledTimes(1);
  });

  it('reports a failure rather than freezing on stale numbers', async () => {
    const onError = vi.fn();
    live.mockRejectedValue(new Error('boom'));
    render(<LiveTab onError={onError} />);
    await waitFor(() => expect(onError).toHaveBeenCalled());
  });
});

describe('replay — seeing the screen when nothing is running', () => {
  const REPLAYED = { ...RUNNING, replay: true, replay_at: '2026-08-05T14:00:00Z' };

  it('offers a way to see a past session when the platform is quiet', async () => {
    live.mockResolvedValue(QUIET);
    render(<LiveTab onError={vi.fn()} />);
    expect(await screen.findByText('Busiest session')).toBeInTheDocument();
  });

  // The dangerous confusion: a screen showing 5 August that looks live.
  it('says loudly that a replay is NOT live', async () => {
    live.mockResolvedValue(REPLAYED);
    render(<LiveTab onError={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/Replay — this is not live/)).toBeInTheDocument());
    // Said in two places on purpose: the banner and the header timestamp.
    // Whichever one you glance at, it should be unmistakable.
    expect(screen.getAllByText(/not live/).length).toBeGreaterThanOrEqual(2);
  });

  // Auto-refreshing a screen labelled "5 August" would silently drag it to
  // now, and you would not notice it had moved.
  it('stops polling while replaying', async () => {
    live.mockResolvedValue(QUIET);
    render(<LiveTab onError={vi.fn()} />);
    await screen.findByText('Busiest session');
    live.mockResolvedValue(REPLAYED);
    await userEvent.click(screen.getByText('Busiest session'));
    await screen.findByText(/Replay — this is not live/);
    const callsAfterSwitch = live.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(live).toHaveBeenCalledTimes(callsAfterSwitch);
  });

  it('offers the way back', async () => {
    live.mockResolvedValue(REPLAYED);
    render(<LiveTab onError={vi.fn()} />);
    expect(await screen.findByText('← Back to live')).toBeInTheDocument();
  });

  it('says plainly when there is nothing to replay', async () => {
    live.mockResolvedValue({ ...QUIET, replay: true, no_history: true, replay_at: null });
    render(<LiveTab onError={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/Nothing to replay/)).toBeInTheDocument());
  });

  it('does not show the quiet-platform notice while replaying', async () => {
    live.mockResolvedValue(REPLAYED);
    render(<LiveTab onError={vi.fn()} />);
    await screen.findByText(/Replay — this is not live/);
    expect(screen.queryByText(/That is not a fault/)).toBeNull();
  });
});
