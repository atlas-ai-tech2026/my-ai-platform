// ─── MediaLibrary.test.jsx ───────────────────────────────────────────────────
// The panel that turns Edit Cut from a demo into a tool.
//
// Most of these are about what the panel refuses to do quietly: hide a failed
// generation, invent a duration, or report a loading failure as an empty
// account.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';

import MediaLibrary from './MediaLibrary';

vi.mock('@/lib/media-library', async () => {
  const actual = await vi.importActual('../../lib/media-library.js');
  return { ...actual, measureDuration: vi.fn() };
});
import { measureDuration } from '@/lib/media-library';

const rec = (over = {}) => ({
  id: 'g1', type: 'video', status: 'completed',
  result_url: 'https://s/v.mp4', prompt: 'a race car at golden hour',
  model: 'Seedance 2.5', model_id: 'kie:sd', ratio: '16:9', duration: 5,
  created_date: '2026-08-20T00:00:00Z', ...over,
});

const entityOf = (rows) => ({ filter: vi.fn().mockResolvedValue(rows) });
const failingEntity = (msg) => ({ filter: vi.fn().mockRejectedValue(new Error(msg)) });

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('what it shows', () => {
  it('lists the generations', async () => {
    render(<MediaLibrary entity={entityOf([rec()])} />);
    expect(await screen.findByText(/a race car at golden hour/)).toBeTruthy();
  });

  it('keeps a FAILED generation visible, greyed, with the reason', async () => {
    // Dropping it would read as lost work — the customer knows they made it.
    render(<MediaLibrary entity={entityOf([rec({ id: 'bad', status: 'failed' })])} />);
    const card = await screen.findByTestId('library-item-bad');
    expect(card.disabled).toBe(true);
    expect(card.textContent).toMatch(/failed/i);
  });

  it('says an expired file is expired rather than showing nothing', async () => {
    render(<MediaLibrary entity={entityOf([rec({ id: 'gone', result_url: null })])} />);
    const card = await screen.findByTestId('library-item-gone');
    expect(card.textContent).toMatch(/no longer available/i);
    expect(card.disabled).toBe(true);
  });

  it('a load FAILURE is named, not shown as an empty account', async () => {
    render(<MediaLibrary entity={failingEntity('database unreachable')} />);
    expect(await screen.findByText(/database unreachable/)).toBeTruthy();
  });

  it('a signed-OUT visitor is told to sign in, not shown "Missing bearer token"', async () => {
    // Accurate, useless, and it reads as a fault in the site rather than a
    // session that has ended.
    const err = Object.assign(new Error('Missing bearer token.'), { status: 401 });
    render(<MediaLibrary entity={{ filter: vi.fn().mockRejectedValue(err) }} />);
    expect(await screen.findByText(/Sign in to see your generations/i)).toBeTruthy();
    expect(screen.queryByText(/bearer token/i)).toBe(null);
  });

  it('an account with genuinely nothing says so differently', async () => {
    render(<MediaLibrary entity={entityOf([])} />);
    expect(await screen.findByText(/Nothing generated yet/i)).toBeTruthy();
  });

  it('does not mount a live <video> per card — poster frames only', async () => {
    // 200 decoding elements is how a laptop stops responding, which the
    // customer reads as the site crashing.
    const { container } = render(<MediaLibrary entity={entityOf([rec(), rec({ id: 'g2' })])} />);
    await screen.findByTestId('library-item-g1');
    for (const v of container.querySelectorAll('video')) {
      expect(v.hasAttribute('autoplay'), 'a library card autoplays').toBe(false);
      expect(v.getAttribute('preload')).toBe('metadata');
    }
  });
});

describe('adding to the timeline', () => {
  it('hands over the source WITH its prompt and camera metadata', async () => {
    const onAdd = vi.fn();
    render(<MediaLibrary entity={entityOf([rec({ camera: 'ARRI Alexa 35', fstop: 'f/1.8' })])} onAdd={onAdd} />);
    fireEvent.click(await screen.findByTestId('library-item-g1'));

    await waitFor(() => expect(onAdd).toHaveBeenCalled());
    const { source, seconds } = onAdd.mock.calls[0][0];
    expect(seconds).toBe(5);
    expect(source.prompt).toMatch(/race car/);
    expect(source.model_id, 'without this the shot can never be remade').toBe('kie:sd');
    expect(source.camera).toBe('ARRI Alexa 35');
    expect(source.fstop).toBe('f/1.8');
  });

  it('MEASURES a missing duration instead of defaulting', async () => {
    measureDuration.mockResolvedValue(9.25);
    const onAdd = vi.fn();
    render(<MediaLibrary entity={entityOf([rec({ duration: null })])} onAdd={onAdd} />);
    fireEvent.click(await screen.findByTestId('library-item-g1'));

    await waitFor(() => expect(onAdd).toHaveBeenCalled());
    expect(measureDuration).toHaveBeenCalledWith('https://s/v.mp4');
    expect(onAdd.mock.calls[0][0].seconds).toBe(9.25);
  });

  it('REFUSES to add when the length cannot be read', async () => {
    // The alternative is a clip with a made-up out point, which the export
    // turns into black or a truncated shot — found after the file is sent.
    measureDuration.mockResolvedValue(null);
    const onAdd = vi.fn();
    render(<MediaLibrary entity={entityOf([rec({ duration: null })])} onAdd={onAdd} />);
    fireEvent.click(await screen.findByTestId('library-item-g1'));

    expect(await screen.findByTestId('library-problem')).toBeTruthy();
    expect(screen.getByTestId('library-problem').textContent).toMatch(/length is unknown/i);
    expect(onAdd, 'a clip with an invented duration reached the timeline').not.toHaveBeenCalled();
  });

  it('an unusable card cannot be clicked at all', async () => {
    const onAdd = vi.fn();
    render(<MediaLibrary entity={entityOf([rec({ id: 'bad', status: 'failed' })])} onAdd={onAdd} />);
    fireEvent.click(await screen.findByTestId('library-item-bad'));
    expect(onAdd).not.toHaveBeenCalled();
  });
});

describe('grid or list', () => {
  // ── THE RISK IS DRIFT, NOT LAYOUT ─────────────────────────────────────────
  // Two render branches would each carry the disabled rule, the busy overlay,
  // the drag payload and the failure reason. The one that gets forgotten is
  // always the second, and the symptom is "it works in grid but not in list",
  // which reads as the editor being unreliable rather than as one missing line.
  //
  // So these assert that the two views BEHAVE identically, and say almost
  // nothing about how they look.
  const many = () => Array.from({ length: 8 }, (_, i) => rec({ id: `g${i}`, prompt: `clip number ${i}` }));

  // The view is REMEMBERED, which is the feature — and it means one test that
  // switches to list leaves every later test starting there. That cost a
  // failure where grid and list measured identically (176 characters each),
  // because the "grid" render had quietly restored to list.
  beforeEach(() => { try { localStorage.removeItem('voxel.edit.libraryView'); } catch { /* no storage */ } });

  /** The toolbar only appears from six generations, so the toggle needs a few. */
  async function open(rows = many()) {
    const out = render(<MediaLibrary entity={entityOf(rows)} />);
    await screen.findByTestId('library-toolbar');
    return out;
  }

  it('starts as a grid', async () => {
    await open();
    expect(screen.getByTestId('library-grid')).toBeTruthy();
  });

  it('switches to a list and back', async () => {
    await open();
    fireEvent.click(screen.getByTestId('library-view-list'));
    expect(screen.getByTestId('library-list')).toBeTruthy();
    expect(screen.queryByTestId('library-grid')).toBe(null);
    fireEvent.click(screen.getByTestId('library-view-grid'));
    expect(screen.getByTestId('library-grid')).toBeTruthy();
  });

  it('shows BOTH buttons, each with its own state', async () => {
    // A one-button toggle showing the other icon is read backwards by
    // everybody: you cannot tell if the picture is what you have or what you
    // would get.
    await open();
    expect(screen.getByTestId('library-view-grid').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('library-view-list').getAttribute('aria-pressed')).toBe('false');
  });

  it('remembers the choice for next time', async () => {
    const { unmount } = await open();
    fireEvent.click(screen.getByTestId('library-view-list'));
    unmount();
    cleanup();
    await open();
    expect(screen.getByTestId('library-list'), 'it forgot').toBeTruthy();
    localStorage.removeItem('voxel.edit.libraryView');
  });

  it('survives storage being unavailable', async () => {
    // Private mode. A library that throws here is a blank panel.
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    await open();
    fireEvent.click(screen.getByTestId('library-view-list'));
    expect(screen.getByTestId('library-list')).toBeTruthy();
    get.mockRestore(); set.mockRestore();
  });

  for (const view of ['grid', 'list']) {
    it(`${view}: a failed generation stays visible, disabled, with its reason`, async () => {
      const rows = [...many(), rec({ id: 'bad', status: 'failed', prompt: 'the broken one' })];
      await open(rows);
      if (view === 'list') fireEvent.click(screen.getByTestId('library-view-list'));
      const card = screen.getByTestId('library-item-bad');
      expect(card.disabled, 'a failed clip can be added').toBe(true);
      expect(screen.getByTestId('library-why-bad').textContent).toMatch(/failed/i);
    });

    it(`${view}: a usable generation can be picked up, a failed one cannot`, async () => {
      const rows = [...many(), rec({ id: 'bad', status: 'failed' })];
      await open(rows);
      if (view === 'list') fireEvent.click(screen.getByTestId('library-view-list'));
      expect(screen.getByTestId('library-item-g0').draggable, 'cannot be dragged').toBe(true);
      expect(screen.getByTestId('library-item-bad').draggable, 'promises a clip it cannot deliver').toBe(false);
    });

    it(`${view}: clicking one adds it`, async () => {
      const onAdd = vi.fn();
      render(<MediaLibrary entity={entityOf(many())} onAdd={onAdd} />);
      await screen.findByTestId('library-toolbar');
      if (view === 'list') fireEvent.click(screen.getByTestId('library-view-list'));
      fireEvent.click(screen.getByTestId('library-item-g0'));
      await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
      expect(onAdd.mock.calls[0][0].seconds).toBe(5);
    });

    it(`${view}: the busy overlay covers the one being added`, async () => {
      await open();
      if (view === 'list') fireEvent.click(screen.getByTestId('library-view-list'));
      cleanup();
      render(<MediaLibrary entity={entityOf(many())} busyId="g0" />);
      expect((await screen.findByTestId('library-item-g0')).textContent).toMatch(/Adding…/);
    });
  }

  it('the list shows MORE of the prompt than the grid — that is the point', async () => {
    const long = 'a '.repeat(90) + 'END';
    await open([...many(), rec({ id: 'long', prompt: long })]);
    const gridText = screen.getByTestId('library-item-long').textContent.length;
    fireEvent.click(screen.getByTestId('library-view-list'));
    const listText = screen.getByTestId('library-item-long').textContent.length;
    expect(listText, 'the list is no more readable than the grid').toBeGreaterThan(gridText);
  });
});
