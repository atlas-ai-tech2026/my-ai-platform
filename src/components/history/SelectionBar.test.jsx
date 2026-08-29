// ─── SelectionBar.test.jsx ───────────────────────────────────────────────────
// The only control in this product that can remove a customer's work.
//
// Three properties, and every test is one of them:
//
//   1. Nothing is deleted without a confirmation that names BOTH the count and
//      the filter. "Delete 128 pictures?" does not say which 128.
//   2. The undo survives long enough to be used — including after selecting
//      has been switched off, which is when people look for it.
//   3. It never reports success it did not have.

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SelectionBar from './SelectionBar';

const sel = (...ids) => ({ on: true, ids });
const base = { filter: {}, total: 128, loaded: 60 };

describe('1 — nothing is deleted without a confirmation', () => {
  it('pressing Delete asks first, it does not delete', async () => {
    const onDelete = vi.fn();
    render(<SelectionBar {...base} selection={sel('a', 'b')} onDelete={onDelete} />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete 2' }));
    expect(onDelete, 'it deleted on the first press').not.toHaveBeenCalled();
    expect(screen.getByText(/Delete 2 pictures\?/)).toBeInTheDocument();
  });

  it('and the confirmation names the FILTER, so a forgotten one is visible', async () => {
    render(<SelectionBar {...base} filter={{ text: 'dragon', model: 'Midjourney' }} selection={sel('a')} />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete 1' }));
    expect(screen.getByText(/matching “dragon”/)).toBeInTheDocument();
    expect(screen.getByText(/made with Midjourney/)).toBeInTheDocument();
  });

  it('it promises the recovery window, in the same sentence', async () => {
    render(<SelectionBar {...base} selection={sel('a')} recoveryDays={30} />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete 1' }));
    expect(screen.getByText(/30 days from Recently deleted/)).toBeInTheDocument();
  });

  it('Cancel deletes nothing and closes the question', async () => {
    const onDelete = vi.fn();
    render(<SelectionBar {...base} selection={sel('a')} onDelete={onDelete} />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete 1' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.queryByText(/Delete 1 picture\?/)).not.toBeInTheDocument();
  });

  it('confirming is what finally deletes', async () => {
    const onDelete = vi.fn();
    render(<SelectionBar {...base} selection={sel('a', 'b', 'c')} onDelete={onDelete} />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete 3' }));
    await userEvent.click(screen.getByRole('button', { name: 'Yes, delete 3' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('cannot be pressed with nothing selected', () => {
    render(<SelectionBar {...base} selection={sel()} />);
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
  });
});

describe('"Select all" offers the number that MATCHED', () => {
  it('128, not the 60 on screen', () => {
    // Offering "Select all 60" when 128 match answers a question the customer
    // did not ask, and they would press delete expecting everything.
    render(<SelectionBar {...base} selection={sel()} />);
    expect(screen.getByRole('button', { name: 'Select all 128' })).toBeInTheDocument();
  });

  it('falls back to what is loaded when nothing has been counted', () => {
    render(<SelectionBar {...base} total={null} selection={sel()} />);
    expect(screen.getByRole('button', { name: 'Select all 60' })).toBeInTheDocument();
  });
});

describe('2 — the undo outlives the selection', () => {
  const undo = { message: '40 pictures deleted', canUndo: true };

  it('is still there after selecting is switched off', async () => {
    // Which is exactly when people look for it — they finish, the bar goes,
    // and only then realise.
    render(<SelectionBar {...base} selection={{ on: false, ids: [] }} undo={undo} onUndo={() => {}} />);
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
    expect(screen.getByText('40 pictures deleted')).toBeInTheDocument();
  });

  it('and while still selecting', () => {
    render(<SelectionBar {...base} selection={sel()} undo={undo} onUndo={() => {}} />);
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
  });

  it('pressing it calls back exactly once', async () => {
    const onUndo = vi.fn();
    render(<SelectionBar {...base} selection={{ on: false, ids: [] }} undo={undo} onUndo={onUndo} />);
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it('an un-undoable result still says what happened', () => {
    render(<SelectionBar {...base} selection={{ on: false, ids: [] }}
      undo={{ message: 'Nothing was deleted.', canUndo: false }} />);
    expect(screen.getByText('Nothing was deleted.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
  });
});

describe('3 — it does not lie while working', () => {
  it('says it is working rather than showing a finished count', () => {
    render(<SelectionBar {...base} selection={sel('a', 'b')} busy />);
    expect(screen.getByRole('button', { name: 'Working…' })).toBeInTheDocument();
  });

  it('everything is disabled mid-flight, so nothing is double-pressed', () => {
    render(<SelectionBar {...base} selection={sel('a')} busy />);
    for (const b of screen.getAllByRole('button')) expect(b).toBeDisabled();
  });

  it('renders nothing at all when not selecting and nothing has happened', () => {
    const { container } = render(<SelectionBar {...base} selection={{ on: false, ids: [] }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
