// ─── FormField.test.jsx ──────────────────────────────────────────────────────
// The shared CRM field: required asterisk, ⓘ description, and the empty-box
// warning. Every admin form depends on these three behaving the same way, so
// they are pinned here once rather than re-tested per screen.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Field, { adminInput, MissingSummary, REQUIRED_MESSAGE, FieldRow } from './FormField';

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

describe('the ⓘ description', () => {
  const open = () => screen.queryByRole('tooltip');
  const icon = () => screen.getByRole('button', { name: /What to put in/i });

  it('is hidden until asked for, so the form stays uncluttered', () => {
    render(<Field label="Credits" info="How many credits each redemption grants."><input /></Field>);
    expect(open()).toBeNull();
  });

  it('appears on hover and goes away when the pointer leaves', async () => {
    const user = userEvent.setup();
    render(<Field label="Credits" info="How many credits each redemption grants."><input /></Field>);

    await user.hover(icon());
    expect(open()).toHaveTextContent(/How many credits each redemption grants/);

    await user.unhover(icon());
    expect(open()).toBeNull();
  });

  // THE POINT OF THIS COMPONENT'S SECOND VERSION. The first one rendered the
  // description in normal flow, so opening it shoved every neighbouring box
  // down and sideways. The owner reported that immediately. Absolute
  // positioning is what makes it impossible.
  it('is lifted out of the layout, so opening it cannot move any box', async () => {
    const user = userEvent.setup();
    render(<Field label="Credits" info="text"><input /></Field>);
    await user.hover(icon());
    const style = open().getAttribute('style');
    expect(style).toMatch(/position:\s*absolute/);
    expect(style).toMatch(/z-index/);
    // It must not swallow clicks meant for the box underneath it either.
    expect(style).toMatch(/pointer-events:\s*none/);
  });

  // Clicking used to PIN the panel open. The owner hit the consequence
  // immediately: a pinned panel does not close when you look away, so three or
  // four could sit open at once. There is no click handler at all now.
  it('a click cannot leave it stuck open', async () => {
    const user = userEvent.setup();
    render(<Field label="Credits" info="text"><input /></Field>);

    await user.click(icon());
    await user.unhover(icon());
    expect(open()).toBeNull();
  });

  it('only ever shows ONE description, however many fields there are', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Field label="First" info="first description"><input /></Field>
        <Field label="Second" info="second description"><input /></Field>
        <Field label="Third" info="third description"><input /></Field>
      </>
    );
    const icons = screen.getAllByRole('button', { name: /What to put in/i });
    await user.hover(icons[0]);
    expect(screen.getAllByRole('tooltip')).toHaveLength(1);

    await user.unhover(icons[0]);
    await user.hover(icons[1]);
    expect(screen.getAllByRole('tooltip')).toHaveLength(1);
    expect(screen.getByRole('tooltip')).toHaveTextContent('second description');
  });

  // Keyboard users have no hover, and focus can only be in one place — so the
  // "several open at once" problem cannot come back through this door.
  it('opens on keyboard focus and closes on blur', async () => {
    const user = userEvent.setup();
    render(<Field label="Credits" info="text"><input /></Field>);
    await user.tab();
    expect(open()).not.toBeNull();
    await user.tab();
    expect(open()).toBeNull();
  });

  it('is not rendered at all when there is nothing to explain', () => {
    render(<Field label="Credits"><input /></Field>);
    expect(screen.queryByRole('button', { name: /What to put in/i })).toBeNull();
  });

  // The button sits inside a <form> on several screens; a missing type="button"
  // would make it submit the form instead of showing the description.
  it('never submits the form it lives in', () => {
    render(<Field label="Credits" info="text"><input /></Field>);
    expect(icon()).toHaveAttribute('type', 'button');
  });
});

describe('the boxes line up', () => {
  // A label that wraps or is simply longer must not start its input lower than
  // its neighbour's — that is what made the rows look ragged.
  it('gives every label row the same fixed height', () => {
    const { container: short } = render(<Field label="Code"><input /></Field>);
    const { container: long } = render(
      <Field label="Credits remaining below a percentage"><input /></Field>);
    const h = (c) => c.querySelector('label').getAttribute('style').match(/height:\s*([^;]+)/)[1];
    expect(h(short)).toBe(h(long));
  });

  it('keeps a long label on one line rather than pushing the input down', () => {
    const { container } = render(<Field label="A very long label indeed"><input /></Field>);
    expect(container.querySelector('label').getAttribute('style')).toMatch(/white-space:\s*nowrap/);
  });

  it('FieldRow aligns to the top, so an error cannot shift its neighbours', () => {
    const { container } = render(<FieldRow><span>a</span></FieldRow>);
    expect(container.firstChild.getAttribute('style')).toMatch(/align-items:\s*flex-start/);
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
    // Theme variables, not literals — so the invalid state is readable in
    // light mode too rather than a dark-mode red on a white page.
    expect(bad.border).toContain('var(--crm-red)');
    expect(bad.background).toContain('var(--crm-red-bg)');
  });

  it('keeps the dark colour scheme so date pickers stay readable', () => {
    expect(adminInput().colorScheme).toBe('dark');
  });

  it('accepts extra style without losing the invalid state', () => {
    const s = adminInput(true, { width: 120 });
    expect(s.width).toBe(120);
    expect(s.border).toContain('var(--crm-red)');
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

describe('labels are never truncated', () => {
  // A clipped label ("Marketing notifications per client per d…") tells the
  // admin less than no label at all. The field is allowed to be wide instead.
  it('does not clip or ellipsis a long label', () => {
    const { container } = render(
      <Field label="Marketing notifications per client per day"><input /></Field>);
    const span = container.querySelector('label span');
    const style = span.getAttribute('style') || '';
    expect(style).not.toMatch(/overflow:\s*hidden/);
    expect(style).not.toMatch(/text-overflow/);
    expect(span).toHaveTextContent('Marketing notifications per client per day');
  });
});
