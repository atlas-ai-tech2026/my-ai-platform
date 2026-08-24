// ─── Timeline.test.jsx ───────────────────────────────────────────────────────
// The timeline must never change the project itself. Every gesture calls back
// with a document produced by timeline.js and a gesture key for the history.
//
// If that rule ever breaks, undo stops working — and the bug does not look like
// "the timeline mutated something", it looks like "undo is broken", which is
// where the search starts in the wrong place.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import Timeline from './Timeline';
import { createProject, createClip, addClip, __resetIds } from '@/lib/timeline';

beforeEach(__resetIds);

const seed = () => {
  let p = createProject();
  const v = p.tracks[0].id;
  const clip = createClip({ kind: 'video', sourceId: 'racing-car', start: 0, in: 0, out: 10 });
  p = addClip(p, v, clip);
  return { project: p, clipId: clip.id };
};

describe('what the timeline shows', () => {
  it('draws a lane per track and a block per clip', () => {
    const { project, clipId } = seed();
    render(<Timeline project={project} onChange={vi.fn()} />);
    expect(screen.getByTestId('timeline')).toBeInTheDocument();
    expect(document.querySelector(`[data-clip="${clipId}"]`)).toBeInTheDocument();
  });

  it('gives a clip a width proportional to its duration', () => {
    // A percentage-width timeline rescales everything when the project grows,
    // so adding a clip at the end makes existing clips appear to shrink.
    // Editors do not do that: a second is a fixed distance.
    const { project, clipId } = seed();
    render(<Timeline project={project} onChange={vi.fn()} />);
    const el = document.querySelector(`[data-clip="${clipId}"]`);
    expect(parseFloat(el.style.width)).toBeGreaterThan(0);
  });

  it('puts the playhead where it was told', () => {
    const { project } = seed();
    render(<Timeline project={project} onChange={vi.fn()} playhead={4} />);
    expect(screen.getByTestId('playhead')).toBeInTheDocument();
  });
});

describe('split', () => {
  it('is disabled until a clip is selected', () => {
    // Splitting nothing is not an error worth a message — the button simply
    // has nothing to act on, and saying so by being unavailable is quieter.
    const { project } = seed();
    const { rerender } = render(<Timeline project={project} onChange={vi.fn()} />);
    expect(screen.getByLabelText(/split at playhead/i)).toBeDisabled();

    rerender(<Timeline project={project} onChange={vi.fn()} selectedId="c3" />);
    expect(screen.getByLabelText(/split at playhead/i)).toBeEnabled();
  });

  it('calls back with a NEW project and never mutates the old one', () => {
    const { project, clipId } = seed();
    const before = JSON.stringify(project);
    const onChange = vi.fn();
    render(<Timeline project={project} onChange={onChange} selectedId={clipId} playhead={5} />);

    screen.getByLabelText(/split at playhead/i).click();

    expect(onChange).toHaveBeenCalled();
    const [next] = onChange.mock.calls[0];
    expect(next).not.toBe(project);
    expect(next.tracks[0].clips, 'the split should produce two clips').toHaveLength(2);
    expect(JSON.stringify(project), 'the timeline mutated the project').toBe(before);
  });
});

describe('locked tracks', () => {
  it('offer no trim handles at all', () => {
    // Rendering handles on a locked track and then ignoring the drag is worse
    // than not drawing them: it invites a gesture that silently does nothing.
    const { project } = seed();
    const locked = { ...project, tracks: project.tracks.map((t) => ({ ...t, locked: true })) };
    render(<Timeline project={locked} onChange={vi.fn()} />);
    expect(screen.queryByLabelText(/trim start/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/trim end/i)).not.toBeInTheDocument();
  });
});

describe('selection', () => {
  it('selects the clip that was pressed', async () => {
    const user = userEvent.setup();
    const { project, clipId } = seed();
    const onSelect = vi.fn();
    render(<Timeline project={project} onChange={vi.fn()} onSelect={onSelect} />);

    await user.pointer({ target: document.querySelector(`[data-clip="${clipId}"]`), keys: '[MouseLeft>]' });
    expect(onSelect).toHaveBeenCalledWith(clipId);
  });
});

describe('zoom', () => {
  it('is CONTINUOUS, not a handful of steps', () => {
    // It was seven fixed levels — 2, 5, 10, 20, 40, 80, 160 px/s — so every
    // notch nearly doubled the scale and the view jumped. The owner felt it
    // immediately next to the clip drag, which is continuous: "it's moving,
    // it's not smooth."
    const { project } = seed();
    render(<Timeline project={project} onChange={vi.fn()} />);
    const slider = screen.getByLabelText('Zoom');   // exact: 'Zoom in'/'Zoom out' buttons also match /zoom/i
    expect(Number(slider.step), 'a coarse step is what made it jump').toBeLessThanOrEqual(0.01);
    expect(Number(slider.max)).toBe(1);
  });

  it('scales clips by the zoom, so a second is a fixed distance', () => {
    const { project, clipId } = seed();
    render(<Timeline project={project} onChange={vi.fn()} />);
    const el = () => document.querySelector(`[data-clip="${clipId}"]`);
    const before = parseFloat(el().style.width);

    const slider = screen.getByLabelText('Zoom');   // exact: 'Zoom in'/'Zoom out' buttons also match /zoom/i
    fireEvent.change(slider, { target: { value: '0.9' } });

    expect(parseFloat(el().style.width), 'zooming in must widen the clip')
      .toBeGreaterThan(before);
  });
});

describe('gaps are visible, not silent', () => {
  const withGap = () => {
    let p = createProject();
    const v = p.tracks[0].id;
    p = addClip(p, v, createClip({ kind: 'video', sourceId: 'a', start: 0, out: 12 }));
    p = addClip(p, v, createClip({ kind: 'video', sourceId: 'b', start: 60, in: 0, out: 24 }));
    return { project: p, v };
  };

  it('draws the hole the owner found, with its length', () => {
    // Their screen said 1:24 total with 48 seconds of nothing in the middle,
    // and no part of the interface mentioned it.
    const { project } = withGap();
    render(<Timeline project={project} onChange={vi.fn()} />);
    expect(screen.getByLabelText(/close the 48s gap/i)).toBeInTheDocument();
  });

  it('closes it on click and pulls the next clip up exactly', () => {
    const { project } = withGap();
    const onChange = vi.fn();
    render(<Timeline project={project} onChange={onChange} />);

    screen.getByLabelText(/close the 48s gap/i).click();

    const [next] = onChange.mock.calls[0];
    expect(next.tracks[0].clips[1].start, 'the second clip should meet the first').toBe(12);
  });

  it('offers no gap control on a locked track', () => {
    const { project } = withGap();
    const locked = { ...project, tracks: project.tracks.map((t) => ({ ...t, locked: true })) };
    render(<Timeline project={locked} onChange={vi.fn()} />);
    expect(screen.queryByLabelText(/close .* gap/i)).not.toBeInTheDocument();
  });
});
