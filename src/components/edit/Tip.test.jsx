// ─── Tip.test.jsx ────────────────────────────────────────────────────────────
// An icon toolbar without labels is a memory test. The owner asked for this in
// exactly those terms — "I need to add the name of the icon when I put the
// mouse on it. This is very important."
//
// Queried by test id rather than by role: the tip carries aria-hidden, because
// the control it labels already has an aria-label and announcing both would
// read the same words twice. That correctly removes it from the accessibility
// tree — and therefore from getByRole.
//
// The second describe block is the one that keeps it true: it reads the editor
// components and fails if an icon-only button ships with no label at all. A
// tooltip added by hand is a tooltip somebody forgets on the next button.

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Tip from './Tip';

const HERE = path.dirname(fileURLToPath(import.meta.url));
afterEach(cleanup);

describe('the tooltip itself', () => {
  it('shows the label', () => {
    render(<Tip label="Split at playhead (C)"><button>x</button></Tip>);
    expect(screen.getByTestId('tip').textContent).toBe('Split at playhead (C)');
  });

  it('NEVER blocks the click on the thing it describes', () => {
    // A tooltip that appears under the cursor and eats the pointer makes the
    // button unusable — the one failure that is worse than having no tooltip.
    render(<Tip label="Mute track"><button>x</button></Tip>);
    expect(screen.getByTestId('tip').className).toMatch(/pointer-events-none/);
  });

  it('appears on keyboard focus, not only on hover', () => {
    // Otherwise the label exists only for people using a mouse.
    render(<Tip label="Snapping"><button>x</button></Tip>);
    expect(screen.getByTestId('tip').className).toMatch(/group-focus-within/);
  });

  it('does not wrap', () => {
    // Two words broken across three lines in a 40px box is worse than nothing.
    render(<Tip label="Blade Edit Mode (B)"><button>x</button></Tip>);
    expect(screen.getByTestId('tip').className).toMatch(/whitespace-nowrap/);
  });

  it('can be placed below, for anything in the top bar', () => {
    // Above the top bar is off the top of the window.
    render(<Tip label="Undo" side="bottom"><button>x</button></Tip>);
    expect(screen.getByTestId('tip').className).toMatch(/top-full/);
  });

  it('renders the control untouched when there is no label', () => {
    render(<Tip label=""><button>only me</button></Tip>);
    expect(screen.queryByTestId('tip')).toBe(null);
    expect(screen.getByText('only me')).toBeTruthy();
  });

  it('is hidden from screen readers — the control already says it', () => {
    // Announcing both the aria-label and the tooltip says the same words twice.
    render(<Tip label="Hide track"><button aria-label="Hide track">x</button></Tip>);
    expect(screen.getByTestId('tip').getAttribute('aria-hidden')).toBe('true');
  });
});

describe('every control says what it does ON HOVER', () => {
  // ── THIS GUARD USED TO BE TOO LENIENT, AND THE OWNER FOUND THE HOLE ─────
  // It accepted `aria-label=` as proof a control was labelled. It is not:
  // aria-label is read by a screen reader and shows NOTHING on hover. Sixteen
  // controls passed this test while giving a mouse user no description at all
  // — the Send button, the search clear, rename, delete, and more.
  //
  // The owner's words: "All the icons inside this page must, when I put the
  // mouse on it, give me the description. Not all of them there is a
  // description."
  //
  // A VISIBLE tooltip means <Tip label=…> or a title attribute. Nothing else
  // counts, and aria-label is now additional rather than sufficient.
  // EVERY component in this folder, discovered — not a list somebody has to
  // remember to add to.
  //
  // It WAS a hardcoded list of nine, and four components shipped after it was
  // written: RecordMenu, UploadsPanel, VersionsMenu, PresetCards. None of them
  // were checked, which is precisely how the owner ended up saying "there are
  // still some items without a description" for the second time.
  //
  // A guard with a manual list guards the past.
  const FILES = fs.readdirSync(HERE)
    .filter((f) => f.endsWith('.jsx') && !f.includes('.test.'))
    .sort();

  for (const file of FILES) {
    it(`${file} labels every button`, () => {
      const src = fs.readFileSync(path.join(HERE, file), 'utf8');
      const bare = [];

      // NOT parsed as JSX — scanned in a window. The first version tried to
      // capture the attributes with /<button\b([\s\S]*?)>/ and was silently
      // permissive: an arrow function in an attribute contains ">", so the
      // capture ended early and almost anything looked labelled. Proved by
      // adding a bare icon button and watching this pass.
      //
      // A window is less precise and cannot be fooled that way. The question
      // it answers is only "did anyone label this button", which is enough.
      for (const m of src.matchAll(/<button\b/g)) {
        const line = src.slice(0, m.index).split('\n').length;
        const window_ = src.slice(m.index, m.index + 400);
        const before = src.slice(Math.max(0, m.index - 350), m.index);

        // aria-label deliberately NOT accepted — it shows nothing on hover.
        const hasTitle = /title=/.test(window_);
        const wrapped = /<Tip\b[\s\S]{0,300}?label=/.test(before);

        if (!hasTitle && !wrapped) bare.push(`${file}:${line}`);
      }

      expect(bare, `no tooltip on hover at ${bare.join(', ')}`).toEqual([]);
    });
  }
});
