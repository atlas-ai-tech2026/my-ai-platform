// ─── FormField.test.jsx ──────────────────────────────────────────────────────
// The shared CRM field: required asterisk, ⓘ description, and the empty-box
// warning. Every admin form depends on these three behaving the same way, so
// they are pinned here once rather than re-tested per screen.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Field, { adminInput, MissingSummary, REQUIRED_MESSAGE } from './FormField';

describe('the required marker', () => {
  it('shows a * when the field is required', () => {
    render(<Field label="Credits" required><input /></Field>);
    expect(screen.getByText('*')).toBeInTheDocument();
    expect(screen.getByTitle('Required')).toBeInTheDocument();
  });

  it('shows no * on an optional field', () => {
    render(<Field label="Note"><input /></Field>);
    expect(screen.queryByText('*')).toBeNull();
  });
});

describe('the ⓘ description button', () => {
  it('is hidden until pressed, so the form stays uncluttered', () => {
    render(<Field label="Credits" info="How many credits each redemption grants."><input /></Field>);
    expect(screen.queryByText(/How many credits/)).toBeNull();
  });

  it('reveals the description on click and hides it again', async () => {
    const user = userEvent.setup();
    render(<Field label="Credits" info="How many credits each redemption grants."><input /></Field>);
    const btn = screen.getByRole('button', { name: /What to put in Credits/i });

    await user.click(btn);
    expect(screen.getByText(/How many credits each redemption grants/)).toBeInTheDocument();
    expect(btn).toHaveAttribute('aria-expanded', 'true');

    await user.click(btn);
    expect(screen.queryByText(/How many credits/)).toBeNull();
  });

  it('is not rendered at all when there is nothing to explain', () => {
    render(<Field label="Credits"><input /></Field>);
    expect(screen.queryByRole('button', { name: /What to put in/i })).toBeNull();
  });

  // The button sits inside a <form> on several screens; a missing type="button"
  // would make it submit the form instead of opening the description.
  it('never submits the form it lives in', () => {
    render(<Field label="Credits" info="text"><input /></Field>);
    expect(screen.getByRole('button', { name: /What to put in/i })).toHaveAttribute('type', 'button');
  });
});

describe('the empty-box warning', () => {
  it('says exactly what the owner asked for', () => {
    render(<Field label="Credits" required invalid><input /></Field>);
    expect(screen.getByText(REQUIRED_MESSAGE)).toBeInTheDocument();
    expect(REQUIRED_MESSAGE).toBe('You must fill this');
  });

  it('can carry a more specific message', () => {
    render(<Field label="Expires" invalid message="Pick a future date"><input /></Field>);
    expect(screen.getByText('Pick a future date')).toBeInTheDocument();
    expect(screen.queryByText(REQUIRED_MESSAGE)).toBeNull();
  });

  it('announces itself to screen readers', () => {
    render(<Field label="Credits" required invalid><input /></Field>);
    expect(screen.getByRole('alert')).toHaveTextContent(REQUIRED_MESSAGE);
  });

  it('shows nothing while the field is still valid', () => {
    render(<Field label="Credits" required><input /></Field>);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('hides the always-on hint while an error is showing, so they cannot conflict', () => {
    const { rerender } = render(<Field label="Credits" hint="Decimals allowed"><input /></Field>);
    expect(screen.getByText('Decimals allowed')).toBeInTheDocument();
    rerender(<Field label="Credits" required invalid hint="Decimals allowed"><input /></Field>);
    expect(screen.queryByText('Decimals allowed')).toBeNull();
  });
});

describe('adminInput', () => {
  it('is visibly different when invalid', () => {
    const ok = adminInput(false);
    const bad = adminInput(true);
    expect(ok.border).not.toBe(bad.border);
    expect(bad.border).toContain('#f87171');
    expect(bad.background).toContain('248,113,113');
  });

  it('keeps the dark colour scheme so date pickers stay readable', () => {
    expect(adminInput().colorScheme).toBe('dark');
  });

  it('accepts extra style without losing the invalid state', () => {
    const s = adminInput(true, { width: 120 });
    expect(s.width).toBe(120);
    expect(s.border).toContain('#f87171');
  });
});

describe('MissingSummary', () => {
  it('counts the empty boxes', () => {
    render(<MissingSummary count={3} />);
    expect(screen.getByRole('alert').textContent).toMatch(/Fill the 3 boxes marked in red/i);
  });

  it('uses the singular for one box', () => {
    render(<MissingSummary count={1} />);
    expect(screen.getByRole('alert').textContent).toMatch(/Fill the 1 box marked in red/i);
  });

  it('appends problems that have no box to point at', () => {
    render(<MissingSummary count={1} extra={['segment matches 0 clients']} />);
    expect(screen.getByRole('alert').textContent).toMatch(/segment matches 0 clients/);
  });

  it('renders nothing when there is nothing wrong', () => {
    const { container } = render(<MissingSummary count={0} />);
    expect(container).toBeEmptyDOMElement();
  });
});
