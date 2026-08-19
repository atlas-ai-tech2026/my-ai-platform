// ─── AdminNav.test.jsx ───────────────────────────────────────────────────────
// The tab bar outgrew one line: 14 tabs, 95 characters of labels, shrinking
// until they were hard to read. A sidebar simply gets taller.
//
// The test that matters most is the ORPHAN one. While writing the groups I got
// two ids wrong — `promo` for `promos`, `giftcards` for `gifts`. Without a
// fallback those two tabs would have disappeared from the navigation entirely,
// reachable only by someone who already knew they existed. Losing a feature by
// omission is the exact bug this panel keeps producing.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminNav, {
  groupTabs, GROUPS, CommandPalette, iconFor, readCollapsed,
  NAV_WIDTH, NAV_WIDTH_COLLAPSED,
} from './AdminNav';

// The collapsed preference is remembered in localStorage, so without this one
// test collapsing the sidebar would leave every test after it collapsed.
beforeEach(() => { try { window.localStorage.clear(); } catch { /* ignore */ } });

const TABS = [
  { id: 'sop', label: 'SOP', desc: 'Daily operations: backups, restore, runway.' },
  { id: 'tasks', label: 'Tasks', desc: 'Every task and project.' },
  { id: 'alerts', label: 'Alerts' }, { id: 'live', label: 'Live' },
  { id: 'users', label: 'Users' }, { id: 'promos', label: 'Promo Codes' },
  { id: 'gifts', label: 'Gift Cards' }, { id: 'bulk', label: 'Bulk' },
  { id: 'costing', label: 'Costing' }, { id: 'offers', label: 'Offers' },
  { id: 'logs', label: 'Logs' }, { id: 'usage', label: 'API Usage' },
  { id: 'security', label: 'Security' }, { id: 'notifications', label: 'Notifications' },
];

describe('grouping', () => {
  it('places every tab somewhere — none may vanish', () => {
    const placed = groupTabs(TABS).flatMap((g) => g.items.map((t) => t.id));
    expect(placed.sort()).toEqual(TABS.map((t) => t.id).sort());
  });

  // The bug I actually made while writing this file.
  it('keeps a tab that no group lists, rather than dropping it', () => {
    const withNew = [...TABS, { id: 'knowledge', label: 'Knowledge Base' }];
    const placed = groupTabs(withNew).flatMap((g) => g.items.map((t) => t.id));
    expect(placed, 'an ungrouped tab disappeared from the navigation').toContain('knowledge');
  });

  it('does not invent a group with nothing in it', () => {
    for (const g of groupTabs([{ id: 'sop', label: 'SOP' }])) {
      expect(g.items.length).toBeGreaterThan(0);
    }
  });

  it('groups by WHEN you use it, and puts the daily things first', () => {
    expect(GROUPS[0].id).toBe('daily');
    expect(GROUPS[0].tabs).toEqual(expect.arrayContaining(['sop', 'alerts', 'tasks']));
  });
});

describe('the sidebar', () => {
  it('shows every tab at full length — nothing is truncated away', () => {
    render(<AdminNav tabs={TABS} current="sop" onSelect={vi.fn()} />);
    for (const t of TABS) expect(screen.getByText(t.label)).toBeInTheDocument();
  });

  it('marks the current section for a screen reader, not only visually', () => {
    render(<AdminNav tabs={TABS} current="costing" onSelect={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Costing/ })).toHaveAttribute('aria-current', 'page');
  });

  it('selects a tab when clicked', async () => {
    const onSelect = vi.fn();
    render(<AdminNav tabs={TABS} current="sop" onSelect={onSelect} />);
    await userEvent.click(screen.getByText('Gift Cards'));
    expect(onSelect).toHaveBeenCalledWith('gifts');
  });

  it('shows a count badge, and a dot for a true flag', () => {
    render(<AdminNav tabs={TABS} current="sop" onSelect={vi.fn()}
      badges={{ tasks: { value: 18 }, sop: { value: true, tone: 'red' } }} />);
    expect(screen.getByText('18')).toBeInTheDocument();
  });

  // A badge saying 0 is noise; a badge for something unknown would be a lie.
  it('shows nothing for zero, null or false', () => {
    const { container } = render(<AdminNav tabs={TABS} current="sop" onSelect={vi.fn()}
      badges={{ tasks: { value: 0 }, alerts: { value: null }, live: { value: false } }} />);
    expect(container.textContent).not.toMatch(/\b0\b/);
  });
});

describe('icons', () => {
  it('gives every real tab an icon', () => {
    for (const t of TABS) expect(iconFor(t.id), `no icon for "${t.id}"`).toBeTruthy();
  });

  // Collapsed, a tab with no icon is a button of blank space — the feature is
  // gone for anyone who did not already know it was there. Same class of bug as
  // the ungrouped tab that vanished from the navigation.
  it('falls back to a visible mark for a tab nobody assigned one to', () => {
    expect(iconFor('some-tab-invented-next-month')).toBeTruthy();
  });

  it('renders an icon alongside every label', () => {
    const { container } = render(<AdminNav tabs={TABS} current="sop" onSelect={vi.fn()} />);
    // One <svg> per tab, plus one for the collapse toggle.
    expect(container.querySelectorAll('nav svg').length).toBe(TABS.length + 1);
  });
});

describe('collapsing to icons', () => {
  const collapse = async () => {
    await userEvent.click(screen.getByRole('button', { name: /collapse the sidebar/i }));
  };

  it('starts expanded, and gets much narrower when folded', async () => {
    const { container } = render(<AdminNav tabs={TABS} current="sop" onSelect={vi.fn()} />);
    const nav = container.querySelector('nav');
    expect(nav).toHaveStyle({ width: `${NAV_WIDTH}px` });
    await collapse();
    expect(nav).toHaveStyle({ width: `${NAV_WIDTH_COLLAPSED}px` });
    expect(NAV_WIDTH - NAV_WIDTH_COLLAPSED).toBeGreaterThan(120); // worth doing at all
  });

  // The whole point is width for the page — but a name you cannot read is not
  // an acceptable price, so it moves to the accessibility tree and a tooltip.
  //
  // Asserts NOT VISIBLE rather than NOT PRESENT on purpose. The labels stay
  // mounted so they can fade rather than blink out, and "the owner cannot see
  // it" is the thing actually worth testing — the earlier version of this test
  // was pinned to how it happened to be built.
  it('hides the label text but keeps every tab named and reachable', async () => {
    render(<AdminNav tabs={TABS} current="sop" onSelect={vi.fn()} />);
    await collapse();
    expect(screen.getByText('Gift Cards')).not.toBeVisible();
    for (const t of TABS) {
      expect(screen.getByRole('button', { name: new RegExp(t.label, 'i') }),
        `"${t.label}" lost its name when collapsed`).toBeInTheDocument();
    }
  });

  it('still selects the right tab when only the icon is showing', async () => {
    const onSelect = vi.fn();
    render(<AdminNav tabs={TABS} current="sop" onSelect={onSelect} />);
    await collapse();
    await userEvent.click(screen.getByRole('button', { name: /^gift cards$/i }));
    expect(onSelect).toHaveBeenCalledWith('gifts');
  });

  // A count with nowhere to go must not become silence: 18 waiting tasks
  // stays visible as a dot, and the number stays in the accessible name.
  it('keeps a waiting count from disappearing', async () => {
    render(<AdminNav tabs={TABS} current="sop" onSelect={vi.fn()}
      badges={{ tasks: { value: 18, tone: 'blue' } }} />);
    await collapse();
    expect(screen.getByText('18')).not.toBeVisible();
    expect(screen.getByRole('button', { name: /tasks, 18/i })).toBeInTheDocument();
  });

  it('shows the name on hover so you are never guessing at an icon', async () => {
    render(<AdminNav tabs={TABS} current="sop" onSelect={vi.fn()} />);
    await collapse();
    await userEvent.hover(screen.getByRole('button', { name: /^api usage$/i }));
    // Two nodes carry the text now — the faded label and the tooltip. What
    // matters is that one of them can actually be read.
    const shown = screen.getAllByText('API Usage').filter((el) => {
      try { expect(el).toBeVisible(); return true; } catch { return false; }
    });
    expect(shown.length, 'hovering a collapsed icon showed no readable name').toBeGreaterThan(0);
  });

  it('remembers the choice, rather than making you fold it every morning', async () => {
    const { unmount } = render(<AdminNav tabs={TABS} current="sop" onSelect={vi.fn()} />);
    await collapse();
    expect(readCollapsed()).toBe(true);
    unmount();
    render(<AdminNav tabs={TABS} current="sop" onSelect={vi.fn()} />);
    expect(screen.getByText('Gift Cards')).not.toBeVisible();
  });
});

describe('the fold is animated, not a snap', () => {
  it('transitions the width rather than jumping it', () => {
    const { container } = render(<AdminNav tabs={TABS} current="sop" onSelect={vi.fn()} />);
    expect(container.querySelector('nav')).toHaveStyle({
      transition: `width ${190}ms cubic-bezier(.4, 0, .2, 1)`,
    });
  });

  // Somebody who has asked their system to stop animating things means it —
  // and a sidebar is exactly the kind of sliding panel that causes trouble.
  it('does not animate for someone who asked for reduced motion', () => {
    const original = window.matchMedia;
    window.matchMedia = (q) => ({
      matches: q.includes('reduced-motion'),
      addEventListener: () => {}, removeEventListener: () => {},
    });
    try {
      const { container } = render(<AdminNav tabs={TABS} current="sop" onSelect={vi.fn()} />);
      expect(container.querySelector('nav')).toHaveStyle({ transition: 'none' });
    } finally { window.matchMedia = original; }
  });
});

describe('the ⌘K jump', () => {
  const open = async () => {
    await userEvent.keyboard('{Meta>}k{/Meta}');
  };

  it('is hidden until asked for', () => {
    render(<CommandPalette tabs={TABS} onSelect={vi.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens on Cmd+K', async () => {
    render(<CommandPalette tabs={TABS} onSelect={vi.fn()} />);
    await open();
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  // A jump box that only matches titles is one you stop using the first time
  // it fails you: "backup" is not in any tab NAME.
  it('matches the description as well as the label', async () => {
    render(<CommandPalette tabs={TABS} onSelect={vi.fn()} />);
    await open();
    await userEvent.type(screen.getByLabelText(/search sections/i), 'backup');
    expect(screen.getByText('SOP')).toBeInTheDocument();
    expect(screen.queryByText('Gift Cards')).not.toBeInTheDocument();
  });

  it('jumps on Enter', async () => {
    const onSelect = vi.fn();
    render(<CommandPalette tabs={TABS} onSelect={onSelect} />);
    await open();
    await userEvent.type(screen.getByLabelText(/search sections/i), 'costing{Enter}');
    expect(onSelect).toHaveBeenCalledWith('costing');
  });

  it('says so when nothing matches, rather than showing an empty box', async () => {
    render(<CommandPalette tabs={TABS} onSelect={vi.fn()} />);
    await open();
    await userEvent.type(screen.getByLabelText(/search sections/i), 'zzzz');
    expect(screen.getByText(/Nothing matches/i)).toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    render(<CommandPalette tabs={TABS} onSelect={vi.fn()} />);
    await open();
    await screen.findByRole('dialog');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
