// ─── MaintenancePanel.test.jsx ───────────────────────────────────────────────
// Does a button exist, and does pressing it call the endpoint?
//
// That question sounds too simple to test. It is the exact question nobody
// asked about five endpoints that shipped unreachable, so it is the one this
// file answers — with a render and a click, not by reading the source.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MaintenancePanel, { MAX_BATCH } from './MaintenancePanel';
import { adminApi } from '@/lib/adminApi';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

beforeEach(() => vi.restoreAllMocks());

/** The Run button for a job, by its accessible name — not by walking the DOM
 *  from a heading, which finds the ⓘ button first. */
const runner = (title) => screen.getByRole('button', { name: new RegExp(`^Run(?: again)?: ${title}`) });

describe('the buttons exist at all', () => {
  it('renders one Run button per job', () => {
    render(<MaintenancePanel />);
    expect(screen.getAllByRole('button', { name: /^Run(?: again)?: / })).toHaveLength(5);
  });

  it('every job says what it writes BEFORE it is pressed', () => {
    // Two of these write to 601 customers' history and sit one tab from the
    // button that expires accounts. The warning cannot arrive afterwards.
    render(<MaintenancePanel />);
    const writes = screen.getAllByText(/WRITES to customer history|Writes nothing|bucket SETTINGS|Writes to models/);
    expect(writes.length).toBe(5);
  });
});

describe('pressing one actually calls the endpoint', () => {
  it('the speech model needs no account and just runs', async () => {
    const spy = vi.spyOn(adminApi, 'whisperModel')
      .mockResolvedValue({ complete: true, stored: 7, skipped: 0, downloadedMB: 41.2 });
    render(<MaintenancePanel />);

    await userEvent.click(runner('Install the speech model'));

    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(await screen.findByText(/speech model is in our bucket/i)).toBeInTheDocument();
  });

  it('a half-installed model reports NOT installed, from a 500', async () => {
    // The endpoint answers 500 on a partial install on purpose, so the client
    // sees a thrown error carrying the report. Rendering the throw as a
    // generic failure would lose the only useful sentence in it.
    vi.spyOn(adminApi, 'whisperModel').mockRejectedValue(
      Object.assign(new Error('HTTP 500'), {
        status: 500,
        body: { complete: false, stored: 6, skipped: 0, problems: [{ file: 'onnx/decoder.onnx', why: 'upstream responded 503' }] },
      }));
    render(<MaintenancePanel />);

    await userEvent.click(runner('Install the speech model'));

    expect(await screen.findByText(/NOT installed/)).toBeInTheDocument();
    expect(screen.getByText(/503/)).toBeInTheDocument();
  });
});

describe('the two that touch customer history are scoped', () => {
  it('refuses to run the rescue with no account and no "every account"', async () => {
    const { toast } = await import('sonner');
    const spy = vi.spyOn(adminApi, 'mediaRescue').mockResolvedValue({});
    render(<MaintenancePanel />);

    await userEvent.click(runner('Rescue expiring files'));

    expect(spy).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });

  it('sends the account and the batch size it was given', async () => {
    const spy = vi.spyOn(adminApi, 'mediaRescue')
      .mockResolvedValue({ considered: 5, rescued: 5, alreadyGone: 0, failed: 0, movedMB: 12 });
    render(<MaintenancePanel />);

    await userEvent.type(screen.getByPlaceholderText(/someone@example/), 'ai.workshops965@gmail.com');
    await userEvent.click(runner('Rescue expiring files'));

    await waitFor(() => expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'ai.workshops965@gmail.com', limit: 20 })));
  });

  it('running across EVERY account takes a deliberate second action', async () => {
    const spy = vi.spyOn(adminApi, 'mediaRescue')
      .mockResolvedValue({ considered: 20, rescued: 20, alreadyGone: 0, failed: 0 });
    render(<MaintenancePanel />);

    await userEvent.click(screen.getByLabelText(/Every account/i));
    await userEvent.click(runner('Rescue expiring files'));

    await waitFor(() => expect(spy).toHaveBeenCalledWith(expect.objectContaining({ all: true })));
  });

  it('the thumbnail backfill never gets an "all accounts" body', async () => {
    // There is no every-account variant on the server; sending one would 400.
    const spy = vi.spyOn(adminApi, 'thumbsBackfill')
      .mockResolvedValue({ attempted: 3, done: 3, failed: 0 });
    render(<MaintenancePanel />);

    await userEvent.type(screen.getByPlaceholderText(/someone@example/), 'a@b.com');
    await userEvent.click(runner('Make small versions'));

    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0][0]).not.toHaveProperty('all');
  });
});

describe('a full batch invites another press', () => {
  it('the button changes to "Run again" when there is more queued', async () => {
    vi.spyOn(adminApi, 'mediaRescue')
      .mockResolvedValue({ considered: 20, rescued: 20, alreadyGone: 0, failed: 0 });
    render(<MaintenancePanel />);

    await userEvent.click(screen.getByLabelText(/Every account/i));
    await userEvent.click(runner('Rescue expiring files'));

    expect(await screen.findByRole('button', { name: /^Run again: Rescue/ })).toBeInTheDocument();
  });
});

describe('the batch box cannot be set to a number that fails', () => {
  it('refuses more than MAX_BATCH, clamping as you type', async () => {
    // These run while the page waits and Cloudflare cuts at ~100s. Measured on
    // production: 20 thumbnails in 24s. A box accepting 1000 was a trap I
    // built and Amr would have walked into.
    render(<MaintenancePanel />);
    const box = screen.getByRole('spinbutton');
    await userEvent.clear(box);
    await userEvent.type(box, '500');
    expect(Number(box.value)).toBeLessThanOrEqual(MAX_BATCH);
  });

  it('and the ceiling is one a batch can actually finish inside 100s', () => {
    // 1.2 seconds each, measured. Anything past ~80 gets cut.
    expect(MAX_BATCH * 1.2).toBeLessThan(100);
  });

  it('says the limit on screen rather than silently correcting it', () => {
    render(<MaintenancePanel />);
    expect(screen.getByText(new RegExp(`${MAX_BATCH} max`))).toBeInTheDocument();
  });

  it('never sends a batch of zero', async () => {
    const spy = vi.spyOn(adminApi, 'thumbsBackfill').mockResolvedValue({ attempted: 0, done: 0, failed: 0 });
    render(<MaintenancePanel />);
    const box = screen.getByRole('spinbutton');
    await userEvent.clear(box);
    await userEvent.type(screen.getByPlaceholderText(/someone@example/), 'a@b.com');
    await userEvent.click(screen.getByRole('button', { name: /^Run: Make small versions/ }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0][0].limit).toBeGreaterThan(0);
  });
});

describe('the count that answers "must I press this 601 times?"', () => {
  it('is on the screen, and reachable', async () => {
    const spy = vi.spyOn(adminApi, 'thumbsScale').mockResolvedValue({
      need: 12000, have: 3000, done_pct: 20, accounts_waiting: 480, accounts_total: 601,
      presses_by_hand: 240, estimated_hours: 4, days_at_slow_pace: 0.4,
      sampled: 25, avg_mb: 7.6, estimated_gb_moved: 178,
      verdict: '12,000 pictures still load at full size. About 178 GB would be moved.',
    });
    render(<MaintenancePanel />);
    await userEvent.click(screen.getByRole('button', { name: /^Count$/ }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(await screen.findByText(/240 presses by hand/)).toBeInTheDocument();
    expect(screen.getAllByText(/178 GB/).length).toBeGreaterThan(0);
  });

  it('an unmeasurable data cost is shown as UNKNOWN, never as zero', async () => {
    // Zero would read as "this is free" while deciding whether to run a job
    // across 601 customers' history.
    vi.spyOn(adminApi, 'thumbsScale').mockResolvedValue({
      need: 12000, have: 0, done_pct: 0, accounts_waiting: 480, accounts_total: 601,
      presses_by_hand: 240, estimated_hours: 4, days_at_slow_pace: 0.4,
      sampled: 0, avg_mb: null, estimated_gb_moved: null,
      verdict: '12,000 pictures still load at full size. The data cost could not be measured.',
    });
    render(<MaintenancePanel />);
    await userEvent.click(screen.getByRole('button', { name: /^Count$/ }));
    expect(await screen.findByText(/UNKNOWN/)).toBeInTheDocument();
    expect(screen.getByText(/Do not read that as zero/)).toBeInTheDocument();
  });

  it('counting changes nothing — no job is run by pressing it', async () => {
    const run = vi.spyOn(adminApi, 'thumbsBackfill').mockResolvedValue({});
    vi.spyOn(adminApi, 'thumbsScale').mockResolvedValue({
      need: 0, have: 10, done_pct: 100, accounts_waiting: 0, accounts_total: 601,
      presses_by_hand: 0, estimated_hours: 0, days_at_slow_pace: 0,
      sampled: 0, avg_mb: null, estimated_gb_moved: null, verdict: 'Every picture already has one.',
    });
    render(<MaintenancePanel />);
    await userEvent.click(screen.getByRole('button', { name: /^Count$/ }));
    await screen.findByText(/Every picture already has one/);
    expect(run).not.toHaveBeenCalled();
  });
});
