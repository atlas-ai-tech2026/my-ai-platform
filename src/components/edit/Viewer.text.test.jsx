// ─── Viewer.text.test.jsx ────────────────────────────────────────────────────
// Does a text clip actually appear over the picture?
//
// This is a RENDER test rather than a browser check because the interesting
// cases are the ones that are awkward to reach by hand: a clip that ends
// before the playhead, a hidden track, an empty clip, a clip whose content was
// never set. Scrubbing to each of those in a real browser is slow and easy to
// get wrong — I misread the on-screen shortcut legend twice trying.
//
// The geometry itself is covered in text-clip.test.js. What is proved here is
// only that the component asks for it and puts the answer on screen.

import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import Viewer from './Viewer';
import { createProject, createClip, addClip, addTrack, addSource } from '@/lib/timeline';

// jsdom gives every element a 0×0 box, and the viewer refuses to place text in
// a frame with no height — correctly, since a fraction of zero is zero. So the
// frame is given a real size, the way a browser would.
beforeAll(() => {
  Element.prototype.getBoundingClientRect = function fake() {
    return { width: 1920, height: 1080, top: 0, left: 0, right: 1920, bottom: 1080, x: 0, y: 0, toJSON() {} };
  };
});

function projectWithText(patch = {}, clipPatch = {}) {
  let p = createProject({ name: 'T' });
  p = addTrack(p, 'video');
  p = addTrack(p, 'text');
  const vid = p.tracks.find((t) => t.kind === 'video');
  const txt = p.tracks.find((t) => t.kind === 'text');
  p = addSource(p, { id: 's1', url: '/media/x.mp4', kind: 'video' });
  p = addClip(p, vid.id, createClip({ kind: 'video', sourceId: 's1', name: 'shot', start: 0, in: 0, out: 10 }));
  const clip = createClip({ kind: 'text', name: 'Title card', start: 1, in: 0, out: 4, ...clipPatch });
  p = addClip(p, txt.id, { ...clip, ...patch });
  return p;
}

describe('text on the picture', () => {
  it('shows the words while the playhead is inside the clip', () => {
    render(<Viewer project={projectWithText({ text: { text: 'WELCOME' } })} playhead={2} />);
    expect(screen.getByText('WELCOME')).toBeInTheDocument();
  });

  it('does NOT show them before the clip starts or after it ends', () => {
    const p = projectWithText({ text: { text: 'WELCOME' } });
    const { rerender } = render(<Viewer project={p} playhead={0.5} />);
    expect(screen.queryByText('WELCOME')).not.toBeInTheDocument();
    rerender(<Viewer project={p} playhead={9} />);
    expect(screen.queryByText('WELCOME')).not.toBeInTheDocument();
  });

  it('falls back to the clip NAME when content was never set', () => {
    // Every text clip that exists today is in this state — the field did not
    // exist until now. They must not all render as empty boxes.
    render(<Viewer project={projectWithText()} playhead={2} />);
    expect(screen.getByText('Title card')).toBeInTheDocument();
  });

  it('draws NOTHING for an empty clip — no black plate over the picture', () => {
    const { container } = render(
      <Viewer project={projectWithText({ name: '', text: { text: '' } })} playhead={2} />,
    );
    expect(container.querySelector('[data-testid^="viewer-text-"]')).toBeNull();
  });

  it('respects a hidden track', () => {
    // The eye on the track header has to mean something in the preview, or it
    // is a control that lies.
    let p = projectWithText({ text: { text: 'WELCOME' } });
    p = { ...p, tracks: p.tracks.map((t) => (t.kind === 'text' ? { ...t, hidden: true } : t)) };
    render(<Viewer project={p} playhead={2} />);
    expect(screen.queryByText('WELCOME')).not.toBeInTheDocument();
  });

  it('scales the type to the frame, so the preview matches the export', () => {
    render(<Viewer project={projectWithText({ text: { text: 'BIG', size: 0.1 } })} playhead={2} />);
    // 0.1 of a 1080-high frame.
    expect(screen.getByText('BIG')).toHaveStyle({ fontSize: '108px' });
  });

  it('never swallows clicks meant for the picture', () => {
    // The overlay covers the frame. Without pointer-events:none it would eat
    // the play button and the scrub, and the viewer would feel broken.
    render(<Viewer project={projectWithText({ text: { text: 'WELCOME' } })} playhead={2} />);
    // The class, not the computed style: jsdom loads no CSS, so toHaveStyle
    // cannot see a Tailwind utility. Asserting the computed value here would
    // pass only by accident and fail for the wrong reason.
    expect(screen.getByText('WELCOME').className).toMatch(/pointer-events-none/);
  });

  it('shows two text clips at once — they stack, unlike the picture', () => {
    let p = projectWithText({ text: { text: 'ONE' } });
    const txt = p.tracks.find((t) => t.kind === 'text');
    p = addClip(p, txt.id, createClip({ kind: 'text', name: 'TWO', start: 1, in: 0, out: 4 }));
    render(<Viewer project={p} playhead={2} />);
    expect(screen.getByText('ONE')).toBeInTheDocument();
    expect(screen.getByText('TWO')).toBeInTheDocument();
  });
});
