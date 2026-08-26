// ─── drag-drop.test.jsx ──────────────────────────────────────────────────────
// Dragging a clip from the library onto the timeline.
//
// The arithmetic of WHERE it lands is covered in timeline-drop.test.js. What
// this file covers is the part that arithmetic cannot see: whether the gesture
// is actually wired up.
//
// ── THE TWO FAILURES THIS IS AIMED AT ──────────────────────────────────────
// 1. A drop target that is not one. `dragover` must call preventDefault or the
//    browser refuses the drop and the card flies back with no message. It is
//    invisible in review — the handler is right there on the element — and it
//    is total: nothing can ever be dropped.
// 2. A gesture that works in one panel and not the other. Voxel generations
//    and uploads are different shapes, and a payload only one of them can
//    build teaches the customer that dragging is unreliable.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Timeline from './Timeline';
import { createProject, createClip, addClip, addSource } from '@/lib/timeline';

const HERE = path.dirname(fileURLToPath(import.meta.url));
afterEach(cleanup);

function project() {
  let p = createProject({ name: 'T' });
  p = addSource(p, { id: 's1', url: 'https://x/a.mp4', kind: 'video' });
  const video = p.tracks.find((t) => t.kind === 'video');
  p = addClip(p, video.id, createClip({
    kind: 'video', sourceId: 's1', name: 'first', start: 0, in: 0, out: 10,
  }));
  return { p, videoId: video.id, audioId: p.tracks.find((t) => t.kind === 'audio').id };
}

/** A DragEvent that jsdom will carry a dataTransfer on.
 *
 *  Used only where the assertion is on the EVENT (was preventDefault called),
 *  never on rendered output — a raw dispatchEvent is not wrapped in act(), so
 *  the state it sets has not been committed when the assertion runs. That cost
 *  five failures: the mock-based tests passed and every one that looked at the
 *  DOM read it before React had re-rendered. */
function dragEvent(type, { clientX = 100 } = {}) {
  const e = new Event(type, { bubbles: true, cancelable: true });
  e.clientX = clientX;
  e.clientY = 10;
  e.dataTransfer = { dropEffect: '', effectAllowed: '', setData: vi.fn(), getData: vi.fn() };
  return e;
}

/** Hover the lane, flushed. fireEvent wraps in act(), so what the test reads
 *  next is what the customer would see. */
function hover(el, { clientX = 100 } = {}) {
  fireEvent.dragOver(el, {
    clientX,
    clientY: 10,
    dataTransfer: { dropEffect: '', effectAllowed: '', setData: vi.fn(), getData: vi.fn() },
  });
}

const HELD = { kind: 'video', seconds: 4, label: 'a clip', source: { id: 's2', url: 'https://x/b.mp4' } };

function lane(container, trackId) {
  // The lane is the element carrying the drop handlers for that track. It is
  // found through the ghost's testid rather than by class, so a restyle does
  // not silently turn this test into a no-op.
  return container.querySelector(`[data-lane="${trackId}"]`);
}

describe('the timeline accepts a drop', () => {
  it('CALLS preventDefault on dragover — without it no drop is possible at all', () => {
    const { p, videoId } = project();
    const { container } = render(<Timeline project={p} dragging={HELD} onChange={() => {}} />);
    const ev = dragEvent('dragover');
    lane(container, videoId).dispatchEvent(ev);
    expect(ev.defaultPrevented, 'the browser will refuse every drop').toBe(true);
  });

  it('does NOT hijack a drag when nothing of ours is being dragged', () => {
    // A file dragged in from the desktop must still reach the uploads panel.
    const { p, videoId } = project();
    const { container } = render(<Timeline project={p} dragging={null} onChange={() => {}} />);
    const ev = dragEvent('dragover');
    lane(container, videoId).dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it('hands the drop to the page with the track and a time', () => {
    const { p, videoId } = project();
    const onDropSource = vi.fn();
    const { container } = render(
      <Timeline project={p} dragging={HELD} onDropSource={onDropSource} onChange={() => {}} />,
    );
    lane(container, videoId).dispatchEvent(dragEvent('drop', { clientX: 260 }));
    expect(onDropSource).toHaveBeenCalledTimes(1);
    const arg = onDropSource.mock.calls[0][0];
    expect(arg.trackId).toBe(videoId);
    expect(typeof arg.at).toBe('number');
    expect(arg.at).toBeGreaterThanOrEqual(0);
  });
});

describe('it shows where the clip will actually land', () => {
  it('draws a ghost on the track being hovered when the spot is free', () => {
    const { p, videoId } = project();          // clip occupies 0–10
    const { container } = render(<Timeline project={p} dragging={HELD} onChange={() => {}} />);
    hover(lane(container, videoId), { clientX: 5000 });
    expect(screen.getByTestId(`drop-ghost-${videoId}`)).toBeTruthy();
  });

  it('never writes a non-finite position, however odd the pointer', () => {
    // Math.max(0, NaN) is NaN. Every mutation the timeline makes — scrub,
    // split, move, trim, drop — goes through xToTime, and a NaN start reaches
    // the project, autosaves, and serialises to JSON as `null`: a corrupted
    // clip that survives a reload. Found as a React warning about an invalid
    // `left`, which was the visible edge of it.
    const { p, videoId } = project();
    const { container } = render(<Timeline project={p} dragging={{ ...HELD, seconds: null }} onChange={() => {}} />);
    fireEvent.dragOver(lane(container, videoId), {
      dataTransfer: { dropEffect: '', setData: vi.fn() },   // no clientX at all
    });
    for (const el of container.querySelectorAll('[style*="left"]')) {
      expect(el.style.left, `${el.className} got a broken position`).not.toMatch(/NaN/);
    }
  });

  it('warns instead of drawing a clip when the length is not known yet', () => {
    const { p, videoId } = project();
    const { container } = render(
      <Timeline project={p} dragging={{ ...HELD, seconds: null }} onChange={() => {}} />,
    );
    hover(lane(container, videoId));
    expect(screen.getByText(/reading length/i)).toBeTruthy();
    expect(screen.queryByTestId(`drop-ghost-${videoId}`), 'a width it invented').toBe(null);
  });

  it('says WHY, before the release, when the layer is the wrong kind', () => {
    const { p, audioId } = project();
    const { container } = render(<Timeline project={p} dragging={HELD} onChange={() => {}} />);
    hover(lane(container, audioId));
    expect(screen.getByTestId(`drop-refused-${audioId}`).textContent).toMatch(/cannot go on/i);
  });

  it('clears the ghost when the drag leaves the timeline entirely', () => {
    const { p, videoId } = project();
    const { container } = render(<Timeline project={p} dragging={HELD} onChange={() => {}} />);
    const el = lane(container, videoId);
    hover(el, { clientX: 5000 });
    expect(screen.queryByTestId(`drop-ghost-${videoId}`)).toBeTruthy();
    fireEvent.dragLeave(el, { relatedTarget: document.body });
    expect(screen.queryByTestId(`drop-ghost-${videoId}`)).toBe(null);
  });

  it('clears the ghost when the drag is abandoned outside the window', () => {
    // Escape, or a release over the desktop. Neither fires dragleave on the
    // lane, so without a window listener the ghost stays on screen forever.
    const { p, videoId } = project();
    const { container } = render(<Timeline project={p} dragging={HELD} onChange={() => {}} />);
    hover(lane(container, videoId), { clientX: 5000 });
    expect(screen.queryByTestId(`drop-ghost-${videoId}`)).toBeTruthy();
    fireEvent(window, new Event('dragend'));
    expect(screen.queryByTestId(`drop-ghost-${videoId}`)).toBe(null);
  });
});

describe('both panels can start a drag', () => {
  // Read from source: rendering MediaLibrary needs an entity client and
  // UploadsPanel needs an upload endpoint, and neither is the point here. The
  // point is that neither panel was forgotten.
  const read = (f) => fs.readFileSync(path.join(HERE, f), 'utf8');

  for (const file of ['MediaLibrary.jsx', 'UploadsPanel.jsx']) {
    it(`${file} makes its items draggable and announces the drag`, () => {
      const src = read(file);
      expect(src, 'items cannot be picked up').toMatch(/draggable=/);
      expect(src, 'nothing tells the page what is being dragged').toMatch(/onDragStart=/);
      expect(src, 'the drag never ends, so the ghost never clears').toMatch(/onDragEnd=/);
    });

    it(`${file} refuses to drag something that cannot be used`, () => {
      // A failed generation stays visible with its reason. Letting it be
      // dragged promises a clip that cannot be delivered.
      const src = read(file);
      expect(src).toMatch(/draggable=\{(use\.ok|ready)\}/);
    });
  }

  it('EditCut wires the drag to BOTH panels, not just the first one', () => {
    const src = read('EditCut.jsx');
    const wired = [...src.matchAll(/onDragSource=/g)];
    expect(wired.length, 'one panel can drag and the other cannot').toBeGreaterThanOrEqual(2);
  });

  it('the viewer takes a drop too, and says what it will do', () => {
    const src = read('Viewer.jsx');
    expect(src).toMatch(/onDrop=/);
    expect(src, 'a drop that does not preventDefault is refused').toMatch(/preventDefault/);
    expect(src, 'appending silently reads as a bug').toMatch(/Add to the end/);
  });
});
