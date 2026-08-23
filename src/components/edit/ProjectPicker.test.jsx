// ─── ProjectPicker.test.jsx ──────────────────────────────────────────────────
// The screen that stops the editor from guessing which project you meant.
//
// The test that matters most is the one about an error not looking like an
// empty list — telling somebody "you have no projects" when the truth is "we
// could not ask" sends them looking for work that is still there.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';

import ProjectPicker from './ProjectPicker';

const P = (over = {}) => ({
  id: 'p1', name: 'Reels cut', ratio: '9:16',
  updatedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(), ...over,
});

afterEach(cleanup);

describe('an error is not an empty list', () => {
  it('shows the reason instead of "nothing here yet"', () => {
    render(<ProjectPicker projects={[]} error="The database is unreachable." />);
    expect(screen.getByTestId('picker-error').textContent).toMatch(/unreachable/);
    expect(screen.queryByText(/Nothing here yet/i), 'it claimed the account was empty').toBe(null);
  });

  it('says the account is empty ONLY when it really is', () => {
    render(<ProjectPicker projects={[]} />);
    expect(screen.getByText(/Nothing here yet/i)).toBeTruthy();
  });

  it('says it is still looking rather than showing an empty list first', () => {
    render(<ProjectPicker projects={[]} loading />);
    expect(screen.getByText(/Looking for your projects/i)).toBeTruthy();
    expect(screen.queryByText(/Nothing here yet/i)).toBe(null);
  });
});

describe('choosing', () => {
  it('opens the one you clicked, not the newest', () => {
    // The entire point: the editor stops guessing.
    const onOpen = vi.fn();
    render(<ProjectPicker projects={[P(), P({ id: 'p2', name: 'Old one' })]} onOpen={onOpen} />);
    fireEvent.click(screen.getByTestId('open-p2'));
    expect(onOpen).toHaveBeenCalledWith('p2');
  });

  it('offers a new project first, before the list', () => {
    // Starting something is the most common reason to be on this screen.
    const onNew = vi.fn();
    render(<ProjectPicker projects={[P()]} onNew={onNew} />);
    fireEvent.click(screen.getByTestId('new-project'));
    expect(onNew).toHaveBeenCalled();
  });

  it('names each project and when it was touched', () => {
    render(<ProjectPicker projects={[P()]} />);
    expect(screen.getByText('Reels cut')).toBeTruthy();
    expect(screen.getByText(/5 min ago · 9:16/)).toBeTruthy();
  });

  it('says "just now" rather than a timestamp for something recent', () => {
    // The question being asked is "is this the one I was just working on",
    // and a clock time answers a different question.
    render(<ProjectPicker projects={[P({ updatedAt: new Date().toISOString() })]} />);
    expect(screen.getByText(/just now/)).toBeTruthy();
  });

  it('survives a project with no date at all', () => {
    render(<ProjectPicker projects={[P({ updatedAt: null })]} />);
    expect(screen.getByText('Reels cut')).toBeTruthy();
  });
});

describe('deleting', () => {
  it('hands back the whole project so the caller can name it in a confirmation', () => {
    // Passing only an id would force the caller to look it up again just to
    // ask "delete Reels cut?" — and an unnamed confirmation is how people
    // delete the wrong thing.
    const onDelete = vi.fn();
    render(<ProjectPicker projects={[P()]} onDelete={onDelete} />);
    fireEvent.click(screen.getByTestId('delete-p1'));
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1', name: 'Reels cut' }));
  });

  it('shows no delete control when the caller did not offer one', () => {
    render(<ProjectPicker projects={[P()]} />);
    expect(screen.queryByTestId('delete-p1')).toBe(null);
  });
});
