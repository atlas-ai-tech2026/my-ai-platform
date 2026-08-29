// ─── HistoryFilterBar.test.jsx ───────────────────────────────────────────────
// The filter bar, and the two ways a filter can quietly ruin a history page.
//
//   1. It narrows something by DEFAULT, and a customer opens their own library
//      to find most of it missing. Amr suggested a 7-day default; the reason
//      not to is his own business — a promo code is bought and used across a
//      month, sometimes two. "My pictures are gone" is a far worse outcome
//      than a slow grid.
//   2. It gives no COUNT, so with a grid that loads as you scroll there is no
//      way to tell "too narrow" from "not there".

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HistoryFilterBar, {
  toQuery, isFiltering, activeChips, DATE_PRESETS, EMPTY,
} from './HistoryFilterBar';

describe('1 — NOTHING is narrowed until the customer narrows it', () => {
  it('the default filter asks for no date, no model, no text', () => {
    expect(toQuery(EMPTY)).toEqual({
      type: undefined, text: undefined, from: undefined, models: undefined,
    });
  });

  it('"Any time" is the first preset, so it is what a new customer sees', () => {
    expect(DATE_PRESETS[0]).toMatchObject({ id: 'any', days: null });
  });

  it('the presets match how the product is SOLD — a month, not a week', () => {
    // A promo code runs for a month, sometimes two. Seven days would hide most
    // of a workshop customer's own work from them.
    const days = DATE_PRESETS.map((p) => p.days).filter(Boolean);
    expect(days).toContain(30);
    expect(Math.min(...days)).toBeGreaterThanOrEqual(30);
  });

  it('an untouched bar is not "filtering" — the normal feed still runs', () => {
    // Otherwise the same pictures would arrive through two different code
    // paths and could disagree.
    expect(isFiltering(EMPTY)).toBe(false);
    expect(isFiltering({ ...EMPTY, text: '   ' })).toBe(false);
    expect(isFiltering({ ...EMPTY, text: 'dragon' })).toBe(true);
    expect(isFiltering({ ...EMPTY, preset: '30' })).toBe(true);
    expect(isFiltering({ ...EMPTY, model: 'Midjourney' })).toBe(true);
  });
});

describe('2 — the count is always answerable', () => {
  it('shows the total the server reported, not the number on screen', () => {
    render(<HistoryFilterBar value={EMPTY} onChange={() => {}} total={128} />);
    expect(screen.getByText('128 pictures')).toBeInTheDocument();
  });

  it('reads as English for one', () => {
    render(<HistoryFilterBar value={EMPTY} onChange={() => {}} total={1} />);
    expect(screen.getByText('1 picture')).toBeInTheDocument();
  });

  it('says it is searching rather than showing a stale number', () => {
    render(<HistoryFilterBar value={EMPTY} onChange={() => {}} total={128} loading />);
    expect(screen.getByText('Searching…')).toBeInTheDocument();
    expect(screen.queryByText('128 pictures')).not.toBeInTheDocument();
  });

  it('zero is stated plainly, not hidden', () => {
    render(<HistoryFilterBar value={EMPTY} onChange={() => {}} total={0} />);
    expect(screen.getByText('0 pictures')).toBeInTheDocument();
  });
});

describe('typing does not fire a query per keystroke', () => {
  // fireEvent rather than userEvent: userEvent's own internal delays fight
  // fake timers and hang, and if the timers are never restored EVERY later
  // test in the file hangs too — which is exactly what happened here.
  afterEach(() => { vi.useRealTimers(); });

  it('waits for a pause, then reports once', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(<HistoryFilterBar value={EMPTY} onChange={onChange} />);
    const box = screen.getByLabelText('Search your prompts');

    for (const t of ['d', 'dr', 'dra', 'drag', 'drago', 'dragon']) {
      fireEvent.change(box, { target: { value: t } });
    }
    expect(onChange, 'a query per keystroke').not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(400); });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ text: 'dragon' }));
  });

  it('a second burst of typing replaces the first, it does not queue both', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(<HistoryFilterBar value={EMPTY} onChange={onChange} />);
    const box = screen.getByLabelText('Search your prompts');

    fireEvent.change(box, { target: { value: 'dra' } });
    act(() => { vi.advanceTimersByTime(200); });
    fireEvent.change(box, { target: { value: 'dragon' } });
    act(() => { vi.advanceTimersByTime(400); });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ text: 'dragon' }));
  });
});

describe('the model list is theirs', () => {
  it('offers only the models passed in', () => {
    render(<HistoryFilterBar value={EMPTY} onChange={() => {}} models={['Midjourney', 'Seedream 4.5']} />);
    expect(screen.getByRole('option', { name: 'Midjourney' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Flux 2' })).not.toBeInTheDocument();
  });

  it('is disabled when they have used none — an empty dropdown reads as broken', () => {
    render(<HistoryFilterBar value={EMPTY} onChange={() => {}} models={[]} />);
    expect(screen.getByLabelText('Model')).toBeDisabled();
  });

  it('sends the model as a list, matching what the server expects', () => {
    expect(toQuery({ ...EMPTY, model: 'Midjourney' }).models).toEqual(['Midjourney']);
  });
});

describe('what is applied is visible, and removable in one press', () => {
  it('each active filter becomes a chip', () => {
    const chips = activeChips({ text: 'dragon', preset: '30', model: 'Midjourney' });
    expect(chips.map((c) => c.key)).toEqual(['text', 'preset', 'model']);
    expect(chips[1].label).toBe('Last 30 days');
  });

  it('an untouched bar has no chips and no Clear', () => {
    render(<HistoryFilterBar value={EMPTY} onChange={() => {}} total={128} />);
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
  });

  it('Clear resets everything at once', async () => {
    const onChange = vi.fn();
    render(<HistoryFilterBar value={{ text: 'dragon', preset: '30', model: 'X' }} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onChange).toHaveBeenCalledWith(EMPTY);
  });
});

describe('the date it actually asks for', () => {
  it('30 days back, as a real timestamp', () => {
    const q = toQuery({ ...EMPTY, preset: '30' });
    const days = (Date.now() - new Date(q.from)) / 86400000;
    expect(Math.round(days)).toBe(30);
  });

  it('and no end bound — "last 30 days" means up to now', () => {
    expect(toQuery({ ...EMPTY, preset: '30' }).to).toBeUndefined();
  });
});
