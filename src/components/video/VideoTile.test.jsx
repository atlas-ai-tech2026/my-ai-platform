// ─── VideoTile.test.jsx ──────────────────────────────────────────────────────
// The one description of a video card in a grid.
//
// The behaviour worth testing here is the FALLBACK, not the happy path. jsdom
// has no IntersectionObserver, which makes it the exact environment the safe
// default was written for: when the browser cannot tell us what is on screen,
// the answer must be "show everything".
//
// Failing the other way would hide a customer's entire history behind a
// feature check. The library would look EMPTY rather than slow, and lost work
// is a far worse bug than a warm laptop — the same reasoning as MediaLibrary
// keeping failed generations visible with their reason.

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import VideoTile from './VideoTile';

afterEach(cleanup);

const URL_ = 'https://voxel-ai-store.nyc3.cdn.digitaloceanspaces.com/generations/video/a.mp4';

describe('when the browser cannot observe the viewport', () => {
  it('renders the video rather than hiding it', () => {
    // jsdom defines no IntersectionObserver, so this IS the fallback path.
    expect(typeof IntersectionObserver, 'jsdom gained IO — this test now proves nothing')
      .toBe('undefined');
    const { container } = render(<VideoTile src={URL_} />);
    expect(container.querySelector('video'), 'the card is blank').toBeTruthy();
  });
});

describe('the tile itself', () => {
  it('never preloads the whole file', () => {
    const { container } = render(<VideoTile src={URL_} />);
    expect(container.querySelector('video').getAttribute('preload')).toBe('metadata');
  });

  it('asks for a frame rather than black', () => {
    const { container } = render(<VideoTile src={URL_} />);
    expect(container.querySelector('video').getAttribute('src')).toBe(`${URL_}#t=0.1`);
  });

  it('is muted and inline, so a grid cannot start making noise', () => {
    const { container } = render(<VideoTile src={URL_} />);
    const v = container.querySelector('video');
    expect(v.muted || v.hasAttribute('muted')).toBe(true);
    expect(v.hasAttribute('playsinline')).toBe(true);
  });

  it('lets each grid keep its own fit — the two differ on purpose', () => {
    const { container } = render(<VideoTile src={URL_} fit="contain" />);
    expect(container.querySelector('video').style.objectFit).toBe('contain');
  });

  it('says whether it has mounted, so the gate is observable', () => {
    render(<VideoTile src={URL_} />);
    expect(screen.getByTestId('video-tile').dataset.mounted).toBe('yes');
  });
});
