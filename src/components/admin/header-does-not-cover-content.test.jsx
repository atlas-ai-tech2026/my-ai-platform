// ─── header-does-not-cover-content.test.jsx ──────────────────────────────────
// ☠ THE Dark / Sign out CLUSTER SAT ON TOP OF THE STATUS LABELS.
//
// Reported by Amr on 2026-09-02, from the production panel: "there is something
// called dark and sign out. It's not moving when I scroll down. This two
// button, it's become up to the words, the fine."
//
// It was position:fixed at top-right. The page scrolled underneath it, so it
// landed on the FINE / ACT NOW / THIS WEEK label at the right edge of whichever
// SOP row happened to be at that height. On a status screen those labels ARE
// the information — the whole page exists to say which lines need attention —
// so the control was covering the answer.
//
// And its background was var(--crm-w06): six percent white. The row's text
// showed straight through the button, so neither could be read.
//
// Two properties, and the second is the one that would come back:
//   1. it scrolls away with the page
//   2. whatever it does overlap, it HIDES rather than blends with

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'AdminGuard.jsx'), 'utf8');

/** The style block of the cluster that holds ThemeToggle + Sign out. */
function clusterStyle() {
  const at = src.indexOf('<ThemeToggle />');
  expect(at, 'the theme toggle moved — this guard needs rewriting').toBeGreaterThan(-1);
  const openedAt = src.lastIndexOf('<div style={{', at);
  return src.slice(openedAt, at);
}

describe('☠ IT SCROLLS AWAY INSTEAD OF SITTING ON THE CONTENT', () => {
  it('is not position:fixed', () => {
    // Fixed is what pinned it over every row's status label.
    expect(clusterStyle(), 'the cluster is pinned again — it will cover the FINE labels')
      .not.toMatch(/position:\s*'fixed'/);
  });

  it('is positioned so it sits at the top of the document', () => {
    expect(clusterStyle()).toMatch(/position:\s*'absolute'/);
  });
});

describe('☠ AND WHAT IT DOES COVER, IT HIDES', () => {
  it('the cluster has an opaque backdrop, not a translucent wash', () => {
    // --crm-w06 and friends are white at N% — content reads through them.
    const style = clusterStyle();
    expect(style).toMatch(/background:\s*'var\(--crm-(page|surface)\)'/);
    expect(style, 'a --crm-wNN background is translucent by definition')
      .not.toMatch(/background:\s*'var\(--crm-w\d+\)'/);
  });

  it('the Sign out button itself is opaque too', () => {
    const at = src.indexOf('>Sign out<');
    const button = src.slice(src.lastIndexOf('<button', at), at);
    expect(button).toMatch(/background:\s*'var\(--crm-surface\)'/);
    expect(button, 'translucent again — this is exactly what made it unreadable')
      .not.toMatch(/background:\s*'var\(--crm-w\d+\)'/);
  });
});
