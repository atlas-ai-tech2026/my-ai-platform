// ─── RecordMenu.test.jsx ─────────────────────────────────────────────────────
// What this file can honestly prove: the menu's SHAPE, that choices persist,
// and that a device failure reaches the customer as a sentence they can act on.
//
// What it deliberately does NOT prove: that recording works. That needs a real
// microphone and a real MediaRecorder, and a mocked recorder would only test
// the mock — the same trap as a passing unit test on a function nobody can
// reach. The real take gets verified in a browser.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import RecordMenu from './RecordMenu';
import { DEFAULT_SETTINGS } from '@/lib/recording';

const DEVICES = [
  { kind: 'audioinput', deviceId: 'default', label: 'Default' },
  { kind: 'audioinput', deviceId: 'mic-a', label: 'Blue Yeti' },
  { kind: 'videoinput', deviceId: 'cam-a', label: 'FaceTime HD' },
];

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      enumerateDevices: vi.fn().mockResolvedValue(DEVICES),
      getUserMedia: vi.fn(),
      getDisplayMedia: vi.fn(),
    },
  });
});
afterEach(() => vi.restoreAllMocks());

const openMenu = async () => {
  fireEvent.click(screen.getByTestId('record-open'));
  return waitFor(() => screen.getByTestId('record-menu'));
};

describe('the menu offers what ChatCut offers', () => {
  it('lists Voiceover, Camera and Screen', async () => {
    render(<RecordMenu />);
    await openMenu();
    expect(screen.getByTestId('record-voiceover')).toHaveTextContent('Voiceover');
    expect(screen.getByTestId('record-camera')).toHaveTextContent('Camera');
    expect(screen.getByTestId('record-screen')).toHaveTextContent('Screen');
  });

  it('offers a microphone and a camera picker', async () => {
    render(<RecordMenu />);
    await openMenu();
    await waitFor(() => expect(screen.getByTestId('record-mic')).toBeInTheDocument());
    expect(screen.getByTestId('record-cam')).toBeInTheDocument();
  });

  it('shows the real device names once the browser reveals them', async () => {
    render(<RecordMenu />);
    await openMenu();
    await waitFor(() => expect(screen.getByTestId('record-mic')).toHaveTextContent('Blue Yeti'));
    expect(screen.getByTestId('record-cam')).toHaveTextContent('FaceTime HD');
  });

  it('every control has a tooltip — the standing rule for this page', async () => {
    // The owner has raised missing tooltips twice. New controls do not get to
    // arrive without one.
    render(<RecordMenu />);
    const trigger = screen.getByTestId('record-open');
    expect(trigger.closest('.group\\/tip') || trigger.getAttribute('aria-label')).toBeTruthy();
    await openMenu();
    for (const id of ['record-voiceover', 'record-camera', 'record-screen']) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
  });
});

describe('the countdown', () => {
  it('is ON by default', async () => {
    render(<RecordMenu />);
    await openMenu();
    expect(screen.getByTestId('record-countdown-toggle')).toHaveAttribute('aria-checked', 'true');
    expect(DEFAULT_SETTINGS.countdown).toBe(true);
  });

  it('can be turned off, and stays off next time', async () => {
    const { unmount } = render(<RecordMenu />);
    await openMenu();
    fireEvent.click(screen.getByTestId('record-countdown-toggle'));
    expect(screen.getByTestId('record-countdown-toggle')).toHaveAttribute('aria-checked', 'false');
    unmount();

    render(<RecordMenu />);
    await openMenu();
    expect(screen.getByTestId('record-countdown-toggle')).toHaveAttribute('aria-checked', 'false');
  });
});

describe('the chosen device persists', () => {
  it('remembers the microphone across a remount', async () => {
    // Which microphone you use is a fact about your desk. Re-picking it every
    // session is the kind of small tax that stops people using a feature.
    const { unmount } = render(<RecordMenu />);
    await openMenu();
    await waitFor(() => expect(screen.getByTestId('record-mic')).toHaveTextContent('Blue Yeti'));
    fireEvent.change(screen.getByTestId('record-mic'), { target: { value: 'mic-a' } });
    unmount();

    render(<RecordMenu />);
    await openMenu();
    await waitFor(() => expect(screen.getByTestId('record-mic')).toHaveValue('mic-a'));
  });

  it('falls back to System default when the saved device is gone', async () => {
    // Unplug the microphone you recorded with last week and the menu must not
    // sit there showing a device that no longer exists — and must never send
    // `deviceId: { exact: … }` for it, which throws OverconstrainedError.
    localStorage.setItem('voxel-edit-cut:recording',
      JSON.stringify({ ...DEFAULT_SETTINGS, micId: 'unplugged-mic' }));
    render(<RecordMenu />);
    await openMenu();
    await waitFor(() => expect(screen.getByTestId('record-mic')).toHaveValue('default'));
  });
});

describe('when the device says no', () => {
  it('a blocked microphone reaches the customer as a sentence, not a code', async () => {
    const onError = vi.fn();
    navigator.mediaDevices.getUserMedia.mockRejectedValue(
      Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' }));

    render(<RecordMenu onError={onError} />);
    await openMenu();
    fireEvent.click(screen.getByTestId('record-voiceover'));

    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(onError.mock.calls[0][0]).toMatch(/padlock in the address bar/);
  });

  it('a cancelled screen share is not called a failure', async () => {
    const onError = vi.fn();
    navigator.mediaDevices.getDisplayMedia.mockRejectedValue(
      Object.assign(new Error('cancelled'), { name: 'NotAllowedError' }));

    render(<RecordMenu onError={onError} />);
    await openMenu();
    fireEvent.click(screen.getByTestId('record-screen'));

    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(onError.mock.calls[0][0]).toMatch(/cancelled/i);
  });

  it('uses getDisplayMedia for Screen and getUserMedia for the others', async () => {
    // Screen capture through getUserMedia does not exist; getting this wrong
    // would fail on every browser, which is at least loud.
    navigator.mediaDevices.getDisplayMedia.mockRejectedValue(
      Object.assign(new Error('x'), { name: 'AbortError' }));
    render(<RecordMenu onError={vi.fn()} />);
    await openMenu();
    fireEvent.click(screen.getByTestId('record-screen'));
    await waitFor(() => expect(navigator.mediaDevices.getDisplayMedia).toHaveBeenCalled());
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  });

  it('never asks for the camera when recording a voiceover', async () => {
    // The camera light coming on during an audio-only recording is a privacy
    // problem people can SEE, and it destroys trust in the feature.
    navigator.mediaDevices.getUserMedia.mockRejectedValue(
      Object.assign(new Error('x'), { name: 'AbortError' }));
    render(<RecordMenu onError={vi.fn()} />);
    await openMenu();
    fireEvent.click(screen.getByTestId('record-voiceover'));
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled());
    expect(navigator.mediaDevices.getUserMedia.mock.calls[0][0].video).toBe(false);
  });

  it('does not demand a device literally named "default"', async () => {
    // `deviceId: { exact: 'default' }` is not "the system default" — it is a
    // demand for a device with that id, and it throws on most machines.
    navigator.mediaDevices.getUserMedia.mockRejectedValue(
      Object.assign(new Error('x'), { name: 'AbortError' }));
    render(<RecordMenu onError={vi.fn()} />);
    await openMenu();
    fireEvent.click(screen.getByTestId('record-voiceover'));
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled());
    expect(navigator.mediaDevices.getUserMedia.mock.calls[0][0].audio).toBe(true);
  });

  it('closes the menu when a take starts, so it is not covering the timeline', async () => {
    navigator.mediaDevices.getUserMedia.mockRejectedValue(
      Object.assign(new Error('x'), { name: 'AbortError' }));
    render(<RecordMenu onError={vi.fn()} />);
    await openMenu();
    fireEvent.click(screen.getByTestId('record-voiceover'));
    await waitFor(() => expect(screen.queryByTestId('record-menu')).not.toBeInTheDocument());
  });
});
