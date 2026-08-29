// ─── RecentlyDeleted.test.jsx ────────────────────────────────────────────────
// The screen the delete confirmation points at.
//
// The confirmation says, in writing: "You can bring them back for 30 days from
// Recently deleted." Delete could not ship until this existed, because until
// then the Undo bar was the only way back and it disappeared on the next page
// load — someone could delete, refresh, and have no route to recovery while
// the sentence they had just read promised them one.
//
// So the tests are about the ways a recovery screen can quietly fail the
// person using it: showing the least urgent thing first, saying "nothing here"
// when it actually could not look, or calling a picture gone while it is still
// recoverable.

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RecentlyDeleted, { timeLeftLabel, isUrgent } from './RecentlyDeleted';

const item = (over = {}) => ({
  id: 'a', prompt: 'Elephant Rock, AlUla', model: 'Nano Banana Pro',
  thumb_url: 'https://spaces/t.jpg', days_left: 20, ...over,
});

describe('a failure must never read as "nothing to recover"', () => {
  it('an error says so, and says nothing was lost', () => {
    // "Nothing here" and "I could not look" are indistinguishable to the
    // person reading, and only one of them is good news.
    render(<RecentlyDeleted error="boom" onReload={() => {}} />);
    expect(screen.getByText(/Could not load your deleted pictures/)).toBeInTheDocument();
    expect(screen.getByText(/have not been lost/)).toBeInTheDocument();
  });

  it('and offers a way to try again', async () => {
    const onReload = vi.fn();
    render(<RecentlyDeleted error="boom" onReload={onReload} />);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onReload).toHaveBeenCalled();
  });

  it('loading is not the empty state either', () => {
    render(<RecentlyDeleted loading />);
    expect(screen.getByText(/Loading what you have deleted/)).toBeInTheDocument();
    expect(screen.queryByText(/Nothing deleted/)).not.toBeInTheDocument();
  });

  it('genuinely empty explains what the screen is for', () => {
    render(<RecentlyDeleted items={[]} recoveryDays={30} />);
    expect(screen.getByText(/Nothing deleted in the last 30 days/)).toBeInTheDocument();
    expect(screen.getByText(/brought back for 30 days/)).toBeInTheDocument();
  });
});

describe('time remaining is never wrong in the frightening direction', () => {
  it('a picture on its last day is not called "0 days left"', () => {
    // That reads as already gone while it is still recoverable.
    expect(timeLeftLabel(0)).toBe('last day');
    expect(timeLeftLabel(-3)).toBe('last day');
  });

  it('reads as English', () => {
    expect(timeLeftLabel(1)).toBe('1 day left');
    expect(timeLeftLabel(20)).toBe('20 days left');
  });

  it('an unknown value says unknown rather than inventing a number', () => {
    expect(timeLeftLabel(null)).toBe('unknown');
    expect(timeLeftLabel('soon')).toBe('unknown');
  });

  it('the last week is marked urgent', () => {
    expect(isUrgent(7)).toBe(true);
    expect(isUrgent(8)).toBe(false);
  });

  it('and the badge is on the card', () => {
    render(<RecentlyDeleted items={[item({ days_left: 2 })]} />);
    expect(screen.getByText('2 days left')).toBeInTheDocument();
  });
});

describe('restoring', () => {
  it('says how many are chosen', async () => {
    render(<RecentlyDeleted items={[item(), item({ id: 'b' })]} selected={['a', 'b']} />);
    expect(screen.getByRole('button', { name: 'Restore 2' })).toBeInTheDocument();
  });

  it('cannot be pressed with nothing chosen', () => {
    render(<RecentlyDeleted items={[item()]} selected={[]} />);
    expect(screen.getByRole('button', { name: 'Restore' })).toBeDisabled();
  });

  it('a card toggles', async () => {
    const onToggle = vi.fn();
    render(<RecentlyDeleted items={[item()]} onToggle={onToggle} />);
    await userEvent.click(screen.getByRole('button', { name: /Elephant Rock/ }));
    expect(onToggle).toHaveBeenCalledWith('a');
  });

  it('everything is disabled mid-restore', () => {
    render(<RecentlyDeleted items={[item()]} selected={['a']} busy />);
    for (const b of screen.getAllByRole('button')) expect(b).toBeDisabled();
  });

  it('the header states the count and the ordering', () => {
    render(<RecentlyDeleted items={[item(), item({ id: 'b' })]} />);
    expect(screen.getByText(/2 recoverable · soonest to be lost first/)).toBeInTheDocument();
  });
});

describe('it does not undo the speed work', () => {
  // Queried by tag, not by role: the picture is DECORATIVE (alt="") because the
  // card's own accessible name is the prompt. Giving it alt text would make a
  // screen reader announce every card twice.
  it('shows the SMALL version, not the full-size file', () => {
    // A recovery screen that downloads originals to show what you might
    // restore would be the slow grid all over again, in a new place.
    const { container } = render(
      <RecentlyDeleted items={[item({ thumb_url: 't.jpg', result_url: 'big.png' })]} />);
    expect(container.querySelector('img').getAttribute('src')).toBe('t.jpg');
  });

  it('falls back to the original when there is no small version', () => {
    const { container } = render(
      <RecentlyDeleted items={[item({ thumb_url: null, result_url: 'big.png' })]} />);
    expect(container.querySelector('img').getAttribute('src')).toBe('big.png');
  });

  it('and loads it lazily, like every other grid on the site', () => {
    const { container } = render(<RecentlyDeleted items={[item()]} />);
    expect(container.querySelector('img').getAttribute('loading')).toBe('lazy');
  });

  it('a row with no picture at all still renders and can be restored', () => {
    // An expired file must not make a recoverable row invisible.
    render(<RecentlyDeleted items={[item({ thumb_url: null, result_url: null })]} />);
    expect(screen.getByRole('button', { name: /Elephant Rock/ })).toBeInTheDocument();
  });
});
