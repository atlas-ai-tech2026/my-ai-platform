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
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Tip, { placeTip } from './Tip';

const HERE = path.dirname(fileURLToPath(import.meta.url));
afterEach(cleanup);

/** Render, then point at it — the tooltip only exists while it is open. */
function hover(ui) {
  const { container } = render(ui);
  const host = container.querySelector('.group\\/tip');
  fireEvent.mouseEnter(host);
  return host;
}

describe('the tooltip itself', () => {
  it('shows the label on hover', () => {
    hover(<Tip label="Split at playhead (C)"><button>x</button></Tip>);
    expect(screen.getByTestId('tip').textContent).toBe('Split at playhead (C)');
  });

  it('is not in the document until you point at it', () => {
    render(<Tip label="Mute track"><button>x</button></Tip>);
    expect(screen.queryByTestId('tip')).toBe(null);
  });

  it('goes away again when the pointer leaves', () => {
    const host = hover(<Tip label="Mute track"><button>x</button></Tip>);
    expect(screen.getByTestId('tip')).toBeTruthy();
    fireEvent.mouseLeave(host);
    expect(screen.queryByTestId('tip')).toBe(null);
  });

  it('NEVER blocks the click on the thing it describes', () => {
    // A tooltip that appears under the cursor and eats the pointer makes the
    // button unusable — the one failure that is worse than having no tooltip.
    hover(<Tip label="Mute track"><button>x</button></Tip>);
    expect(screen.getByTestId('tip').className).toMatch(/pointer-events-none/);
  });

  it('appears on keyboard focus, not only on hover', () => {
    // Otherwise the label exists only for people using a mouse.
    const { container } = render(<Tip label="Snapping"><button>x</button></Tip>);
    fireEvent.focus(container.querySelector('button'));
    expect(screen.getByTestId('tip').textContent).toBe('Snapping');
  });

  it('cannot run off the side of the window — it is width-capped', () => {
    // The measured failure: a 607px `whitespace-nowrap` bubble inside a 340px
    // panel. A cap plus wrapping is what makes that shape impossible.
    hover(<Tip label="Vertical 9:16 and cut to 30 seconds — the shape Instagram wants"><button>x</button></Tip>);
    const cls = screen.getByTestId('tip').className;
    expect(cls, 'a tooltip with no max width can be wider than the panel').toMatch(/max-w-\[/);
    expect(cls, 'nowrap is what made it 607px wide').not.toMatch(/whitespace-nowrap/);
  });

  it('renders the control untouched when there is no label', () => {
    render(<Tip label=""><button>only me</button></Tip>);
    expect(screen.queryByTestId('tip')).toBe(null);
    expect(screen.getByText('only me')).toBeTruthy();
  });

  it('is hidden from screen readers — the control already says it', () => {
    // Announcing both the aria-label and the tooltip says the same words twice.
    hover(<Tip label="Hide track"><button aria-label="Hide track">x</button></Tip>);
    expect(screen.getByTestId('tip').getAttribute('aria-hidden')).toBe('true');
  });
});

describe('it escapes the panel it lives in', () => {
  // THE BUG, 2026-08-26: 42 of 68 tooltips were cropped by an ancestor with
  // overflow:hidden. Both facts below are what stop that happening again —
  // an absolutely-positioned child cannot leave a clipping ancestor, and a
  // portalled fixed one is not inside it at all.
  it('paints from <body>, not from inside the control', () => {
    const { container } = render(<Tip label="Hide the assistant"><button>x</button></Tip>);
    fireEvent.mouseEnter(container.querySelector('.group\\/tip'));
    const tip = screen.getByTestId('tip');
    expect(container.contains(tip), 'still inside the panel — it will be clipped').toBe(false);
    expect(document.body.contains(tip)).toBe(true);
  });

  it('is positioned against the window, not against its parent', () => {
    hover(<Tip label="Export"><button>x</button></Tip>);
    expect(screen.getByTestId('tip').style.position).toBe('fixed');
  });

  it('sits above the site nav, which is z-50', () => {
    hover(<Tip label="Export"><button>x</button></Tip>);
    const z = Number(screen.getByTestId('tip').style.zIndex);
    expect(z, 'the site nav is z-50; a tooltip at or below it is invisible').toBeGreaterThan(50);
  });
});

describe('placeTip — the arithmetic that was wrong', () => {
  const view = { vw: 1440, vh: 900 };
  const size = { width: 200, height: 25 };

  it('centres on the control when there is room', () => {
    const p = placeTip({ cx: 700, top: 400, bottom: 424 }, size, view);
    expect(p.left).toBe(600);
  });

  it('never goes off the LEFT edge — the x=-201 case', () => {
    // Measured in the browser: "Vertical 9:16 and cut to 30 seconds…" was a
    // 581px bubble on a control near the left edge of a 340px panel.
    const p = placeTip({ cx: 90, top: 250, bottom: 274 }, { width: 581, height: 25 }, view);
    expect(p.left).toBeGreaterThanOrEqual(8);
  });

  it('never goes off the RIGHT edge', () => {
    const p = placeTip({ cx: 1430, top: 400, bottom: 424 }, size, view);
    expect(p.left + size.width).toBeLessThanOrEqual(view.vw - 8);
  });

  it('pins left, not negative, when the bubble is wider than the window', () => {
    const p = placeTip({ cx: 700, top: 400, bottom: 424 }, { width: 2000, height: 25 }, view);
    expect(p.left).toBe(8);
  });

  it('flips DOWN when asked for top with no room above', () => {
    // Exactly the editor header row: a control at y=84 under a 64px nav.
    const p = placeTip({ cx: 700, top: 20, bottom: 44 }, size, view, 'top');
    expect(p.placement).toBe('bottom');
    expect(p.top).toBe(50);
  });

  it('flips UP when asked for bottom with no room below', () => {
    const p = placeTip({ cx: 700, top: 860, bottom: 890 }, size, view, 'bottom');
    expect(p.placement).toBe('top');
    expect(p.top).toBe(829);
  });

  it('honours the side it was asked for when both fit', () => {
    expect(placeTip({ cx: 700, top: 400, bottom: 424 }, size, view, 'top').placement).toBe('top');
    expect(placeTip({ cx: 700, top: 400, bottom: 424 }, size, view, 'bottom').placement).toBe('bottom');
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

describe('no tooltip may be positioned by its parent again', () => {
  // The two mechanisms that hid these — a clipping ancestor and a stacking
  // context — are both invisible to a source scan, which is why the owner
  // reported it twice while every label was present and correct.
  //
  // The behaviour is covered above. This holds the one thing behaviour tests
  // in jsdom cannot: that nobody reintroduces the absolute-positioning that
  // made it impossible to escape the panel, since jsdom reports every rect as
  // zero and would happily pass either way.
  it('Tip.jsx positions with fixed coordinates, never absolute', () => {
    // Comments stripped FIRST. An earlier version of this test matched the
    // z-50 inside the comment explaining the bug and reported the file as
    // still broken — the same trap layout-safety.test.jsx documents about
    // quoting old code in a comment.
    const src = fs.readFileSync(path.join(HERE, 'Tip.jsx'), 'utf8')
      .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

    expect(src, 'the bubble must be portalled or it cannot leave the panel')
      .toMatch(/createPortal/);
    expect(src, "position:'absolute' on the bubble is the bug that cropped 42 of 68")
      .not.toMatch(/\babsolute\b/);
  });
});
