// ─── PreflightPanel.test.jsx ─────────────────────────────────────────────────
// THE SCREEN READ TEN MINUTES BEFORE STANDING UP IN FRONT OF PEOPLE.
//
// The server decides everything here — preflight.js has 35 tests on the
// judgement itself. What this file checks is the part no server test can:
// that the judgement REACHES THE SCREEN, in the words a person acts on.
//
// That distinction is the standing lesson of this codebase. `upsertTask` was
// tested and correct while the seed skipped existing rows and nothing reached
// the board. `copyAndRecord()` was tested, correct, and called by nobody. A
// verdict computed perfectly and rendered nowhere is the same bug wearing a
// different hat.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PreflightPanel from './PreflightPanel';
import { adminApi } from '@/lib/adminApi';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
beforeEach(() => vi.restoreAllMocks());

const line = (key, label, state, extra = {}) => ({
  key, label, state, value: null, detail: '', action: null, info: `about ${label}`, ...extra,
});

const reply = (over = {}) => ({
  state: 'ok', go: true, headline: 'Ready to start.', because: [],
  checks: [
    line('alerts', 'Anything already wrong?', 'ok', { value: 'none' }),
    line('balance', 'Supplier balance', 'ok', { value: '41,203 · ~6 days' }),
    line('models', 'Has any model gone bad?', 'ok', { value: '9 judged' }),
    line('cohort', "Does this cohort's access work?", 'ok', { value: '5/20 used' }),
  ],
  checked_at: '2026-09-01T09:00:00.000Z', window_days: 30, codes: [], chosen: 'VOXEL20',
  ...over,
});

const press = () => userEvent.click(screen.getByRole('button', { name: /^Check$/ }));

describe('☠ THE VERDICT REACHES THE SCREEN', () => {
  it('shows "Ready to start." when everything passes', async () => {
    vi.spyOn(adminApi, 'preflight').mockResolvedValue(reply());
    render(<PreflightPanel />);
    await press();
    expect(await screen.findByText('Ready to start.')).toBeInTheDocument();
  });

  it('☠ shows "Do not start yet" — and WHY — when something blocks', async () => {
    // The whole product. A red dot nobody can act on is a red dot people learn
    // to ignore, so the reason has to be on the screen beside the verdict.
    vi.spyOn(adminApi, 'preflight').mockResolvedValue(reply({
      state: 'critical', go: false,
      headline: 'Do not start yet — supplier balance',
      because: ['Empty — generations are failing right now.'],
      checks: [
        line('alerts', 'Anything already wrong?', 'ok', { value: 'none' }),
        line('balance', 'Supplier balance', 'critical', {
          value: '0', detail: 'Empty — generations are failing right now.',
          action: 'Top up immediately.' }),
        line('models', 'Has any model gone bad?', 'ok'),
        line('cohort', "Does this cohort's access work?", 'ok'),
      ],
    }));
    render(<PreflightPanel />);
    await press();
    expect(await screen.findByText(/Do not start yet/)).toBeInTheDocument();
    expect(screen.getAllByText(/Empty — generations are failing right now/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Top up immediately/)).toBeInTheDocument();
  });

  it('☠ a check that could not run shows NOT CHECKED, never green', async () => {
    // 8 August in one assertion: the thing nobody could see was the thing that
    // broke. "Could not tell" and "fine" must never look the same.
    vi.spyOn(adminApi, 'preflight').mockResolvedValue(reply({
      state: 'unknown', go: false,
      headline: 'Cannot say it is ready — 1 check(s) could not run',
      because: ['The balance was not read.'],
      checks: [
        line('alerts', 'Anything already wrong?', 'ok'),
        line('balance', 'Supplier balance', 'unknown', {
          detail: 'The balance was not read.',
          action: 'Open the kie dashboard directly. Unreadable is not zero, and it is not fine.' }),
        line('models', 'Has any model gone bad?', 'ok'),
        line('cohort', "Does this cohort's access work?", 'ok'),
      ],
    }));
    render(<PreflightPanel />);
    await press();
    expect(await screen.findByText(/Cannot say it is ready/)).toBeInTheDocument();
    expect(screen.getByText(/Not checked/i)).toBeInTheDocument();
    expect(screen.getByText(/Unreadable is not zero/)).toBeInTheDocument();
  });

  it('renders all four checks, every time', async () => {
    vi.spyOn(adminApi, 'preflight').mockResolvedValue(reply());
    render(<PreflightPanel />);
    await press();
    await screen.findByText('Ready to start.');
    for (const label of ['Anything already wrong?', 'Supplier balance',
      'Has any model gone bad?', "Does this cohort's access work?"]) {
      expect(screen.getByText(label), `${label} is missing`).toBeInTheDocument();
    }
  });

  it('every line carries its own ⓘ — the standing rule', async () => {
    // Set by the owner on 2026-08-18: every field and line in the control
    // panel explains itself where it is read. Four checks plus the panel's own
    // heading is five.
    vi.spyOn(adminApi, 'preflight').mockResolvedValue(reply());
    render(<PreflightPanel />);
    await press();
    await screen.findByText('Ready to start.');
    const dots = screen.getAllByRole('button', { name: /^What .* means$/ });
    expect(dots.length, 'a line is missing its ⓘ').toBe(5);
    for (const label of ['Anything already wrong?', 'Supplier balance',
      'Has any model gone bad?', "Does this cohort's access work?", 'Before a workshop']) {
      expect(screen.getByRole('button', { name: `What ${label} means` })).toBeInTheDocument();
    }
  });

  it('and the ⓘ shows the explanation the SERVER wrote, not a second copy', async () => {
    // The reasoning lives beside the thresholds in preflight.js. A copy in the
    // component would drift from the rule it describes.
    vi.spyOn(adminApi, 'preflight').mockResolvedValue(reply());
    render(<PreflightPanel />);
    await press();
    await screen.findByText('Ready to start.');
    await userEvent.hover(screen.getByRole('button', { name: 'What Supplier balance means' }));
    expect(await screen.findByText('about Supplier balance')).toBeInTheDocument();
  });
});

describe('the cohort is asked for, not assumed', () => {
  it('passes the typed code to the server', async () => {
    const spy = vi.spyOn(adminApi, 'preflight').mockResolvedValue(reply());
    render(<PreflightPanel />);
    await userEvent.type(screen.getByLabelText(/Workshop promo code/i), 'VOXEL20');
    await press();
    await waitFor(() => expect(spy).toHaveBeenCalledWith('VOXEL20'));
  });

  it('Enter runs it too — this is read in a hurry', async () => {
    const spy = vi.spyOn(adminApi, 'preflight').mockResolvedValue(reply());
    render(<PreflightPanel />);
    await userEvent.type(screen.getByLabelText(/Workshop promo code/i), 'VOXEL20{Enter}');
    await waitFor(() => expect(spy).toHaveBeenCalledWith('VOXEL20'));
  });

  it('offers the active codes when the typed one does not exist', async () => {
    // A typo before a workshop should cost one click, not a trip to another tab.
    vi.spyOn(adminApi, 'preflight').mockResolvedValue(reply({
      chosen: null, codes: [{ code: 'VOXEL21', used: 0, cap: 20 }],
    }));
    render(<PreflightPanel />);
    await userEvent.type(screen.getByLabelText(/Workshop promo code/i), 'VOXEL2O');
    await press();
    expect(await screen.findByRole('button', { name: 'VOXEL21' })).toBeInTheDocument();
  });

  it('changes nothing — it is a read, and says so', async () => {
    vi.spyOn(adminApi, 'preflight').mockResolvedValue(reply());
    render(<PreflightPanel />);
    await press();
    expect(await screen.findByText(/nothing was changed/i)).toBeInTheDocument();
  });

  it('a failed request surfaces through onError rather than a blank card', async () => {
    const onError = vi.fn();
    vi.spyOn(adminApi, 'preflight').mockRejectedValue(new Error('boom'));
    render(<PreflightPanel onError={onError} />);
    await press();
    await waitFor(() => expect(onError).toHaveBeenCalled());
  });
});

describe('☠ IT IS ACTUALLY ON THE SOP TAB', () => {
  it('SopTab mounts PreflightPanel, above the zones', async () => {
    // Read from the source, because "the component is correct" and "anybody
    // can see it" are different claims — and this project has shipped the
    // first without the second more than once.
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const src = fs.readFileSync(path.join(here, 'SopTab.jsx'), 'utf8');

    const mounted = src.indexOf('<PreflightPanel');
    const zones = src.indexOf('Object.entries(ZONE_META)');
    expect(mounted, 'PreflightPanel is not mounted in SopTab').toBeGreaterThan(-1);
    expect(zones, 'the zones block is gone — this guard needs rewriting').toBeGreaterThan(-1);
    // Above the zones: a check you have to scroll to is a check that happens
    // after the room has sat down.
    expect(mounted).toBeLessThan(zones);
  });
});
