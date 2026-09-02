// ─── DevBanner.test.jsx ──────────────────────────────────────────────────────
// ☠ THE ONLY TEST THAT REALLY MATTERS IS THAT IT NEVER SHOWS A CUSTOMER.
//
// A banner reading "Development site — nothing here affects customers", on
// production, in front of a paying workshop, is worse than having no banner at
// all. Everything else in this file is secondary to that one property.
//
// It earned its place today: in a single session dev and production were
// confused twice — the database clusters (dev-db-347887 SOUNDS like dev and IS
// production) and which panel a screenshot came from. Both were caught. The
// cost of not catching one is a job run against real customers.

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import DevBanner from './DevBanner';
import { isDevHost, DEV_HOSTS } from '@/lib/dev-only';

describe('☠ IT NEVER APPEARS ON PRODUCTION', () => {
  it('renders NOTHING on voxel-ai.ai', () => {
    const { container } = render(<DevBanner visible={isDevHost('voxel-ai.ai')} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('nor on www, nor on the bare apex', () => {
    for (const host of ['www.voxel-ai.ai', 'voxel-ai.ai', 'VOXEL-AI.AI']) {
      const { container } = render(<DevBanner visible={isDevHost(host)} />);
      expect(container, `${host} showed the banner`).toBeEmptyDOMElement();
    }
  });

  it('☠ nor on a LOOKALIKE domain that contains the dev host', () => {
    // A substring test would accept this. The gate is exact-match, and a gate
    // a hostname can spoof is not a gate.
    const { container } = render(<DevBanner visible={isDevHost('dev.voxel-ai.ai.evil.com')} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('☠ and it fails towards HIDDEN for anything unrecognised', () => {
    // undefined, null, empty, a new domain nobody has told it about. A future
    // production hostname gets no banner — merely unhelpful, where the other
    // way round is embarrassing in front of customers.
    for (const host of [undefined, null, '', '   ', 'voxel.ai', 'app.voxel-ai.ai', 'staging.example.com']) {
      const { container } = render(<DevBanner visible={isDevHost(host)} />);
      expect(container, `${String(host)} showed the banner`).toBeEmptyDOMElement();
    }
  });

  it('the rule is an ALLOW-list — it never names production', () => {
    // "hide on voxel-ai.ai" is the natural way to write this and is the wrong
    // way round: it shows the banner to every customer the day a second
    // production domain exists.
    expect(DEV_HOSTS.has('voxel-ai.ai')).toBe(false);
    expect(DEV_HOSTS.has('www.voxel-ai.ai')).toBe(false);
    expect([...DEV_HOSTS].every((h) => isDevHost(h))).toBe(true);
  });
});

describe('it does appear where it should', () => {
  it('on dev.voxel-ai.ai', () => {
    render(<DevBanner visible={isDevHost('dev.voxel-ai.ai')} />);
    expect(screen.getByRole('status')).toHaveTextContent(/Development site/i);
  });

  it('and on a local machine', () => {
    for (const host of ['localhost', '127.0.0.1', '0.0.0.0']) {
      const { unmount } = render(<DevBanner visible={isDevHost(host)} />);
      expect(screen.getByRole('status'), `${host} had no banner`).toBeInTheDocument();
      unmount();
    }
  });

  it('it says what it means without being read closely', () => {
    render(<DevBanner visible />);
    const b = screen.getByRole('status');
    expect(b).toHaveTextContent(/not production/i);
    expect(b).toHaveTextContent(/affects customers/i);
    expect(b).toHaveAttribute('aria-label', expect.stringMatching(/development site/i));
  });
});

describe('☠ IT PUSHES CONTENT, IT DOES NOT COVER IT', () => {
  it('is not position:fixed', async () => {
    // Today the panel's Dark / Sign out cluster was fixed and spent weeks
    // sitting on top of the SOP status labels — the one thing that screen
    // exists to show. A warning that hides content is its own small bug.
    const { readFileSync } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'DevBanner.jsx'), 'utf8');
    expect(src).not.toMatch(/position:\s*'fixed'/);
    expect(src).toMatch(/position:\s*'relative'/);
  });

  it('and it is mounted first, and NOT lazily', async () => {
    // A banner that arrives one chunk later leaves a window in which somebody
    // could act on the wrong site.
    const { readFileSync } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const app = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../App.jsx'), 'utf8');
    expect(app, 'DevBanner is lazy — it would appear late').not.toMatch(/lazy\(\(\) => import\('@\/components\/common\/DevBanner'\)\)/);
    expect(app).toMatch(/import DevBanner from '@\/components\/common\/DevBanner'/);
    // Anchored to the ROOT return block, not to the whole file: a comment
    // higher up contains the literal text "<Router>" and indexOf found that
    // instead, which is how a green assertion measures the wrong thing.
    const root = app.slice(app.lastIndexOf('<AuthProvider>'));
    expect(root.indexOf('<DevBanner />'), 'the banner mounts after the router')
      .toBeLessThan(root.indexOf('<QueryClientProvider'));
    expect(root.indexOf('<DevBanner />')).toBeGreaterThan(-1);
  });
});
