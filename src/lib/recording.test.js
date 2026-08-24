// ─── recording.test.js ───────────────────────────────────────────────────────
// Recording is the feature most likely to fail on SOMEBODY ELSE'S machine and
// nowhere else: a browser that cannot make WebM, a microphone another app is
// holding, a permission prompt that was dismissed months ago. None of that
// reproduces on this Mac, so the parts that decide what happens in those cases
// are pure functions and they are tested here.
//
// The device-shaped half — actually opening a microphone — is not testable
// without a microphone, and pretending otherwise with a mocked MediaRecorder
// would test my mock. That half gets verified in a real browser.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  RECORD_MODES, modeById, trackKindFor, pickMimeType, MIME_CANDIDATES,
  extensionFor, captureErrorMessage, normaliseDevices, recordingStartAt,
  recordingName, readSettings, writeSettings, DEFAULT_SETTINGS, stopStream,
  COUNTDOWN_SECONDS,
} from './recording.js';

describe('the three modes', () => {
  it('offers exactly Voiceover, Camera and Screen, in that order', () => {
    expect(RECORD_MODES.map((m) => m.label)).toEqual(['Voiceover', 'Camera', 'Screen']);
  });

  it('puts a voiceover on an AUDIO track and the other two on VIDEO', () => {
    // The one that matters: a voiceover landing on a video track would be
    // invisible in the viewer and impossible to line up against a shot.
    expect(trackKindFor('voiceover')).toBe('audio');
    expect(trackKindFor('camera')).toBe('video');
    expect(trackKindFor('screen')).toBe('video');
  });

  it('falls back to video for an unknown mode rather than throwing', () => {
    expect(trackKindFor('nonsense')).toBe('video');
    expect(modeById('nonsense')).toBeNull();
  });

  it('records a voiceover with NO camera — the light must not come on', () => {
    // Opening the camera to capture audio would be a privacy problem, and the
    // indicator light makes it a visible one.
    expect(modeById('voiceover').constraints('default').video).toBe(false);
  });

  it('asks for a specific device only when one was chosen', () => {
    // `deviceId: { exact: 'default' }` is not the system default — it is a
    // demand for a device literally named "default", which throws
    // OverconstrainedError on most machines.
    expect(modeById('voiceover').constraints('default').audio).toBe(true);
    expect(modeById('voiceover').constraints('mic-7').audio).toEqual({ deviceId: { exact: 'mic-7' } });
  });

  it('uses getDisplayMedia only for Screen', () => {
    expect(modeById('screen').display).toBe(true);
    expect(modeById('camera').display).toBe(false);
    expect(modeById('voiceover').display).toBe(false);
  });
});

describe('choosing a container the browser can actually write', () => {
  it('prefers vp9 WebM when everything is supported', () => {
    expect(pickMimeType('video', () => true)).toBe('video/webm;codecs=vp9,opus');
  });

  it('falls back to mp4 for Safari, which cannot record WebM at all', () => {
    // Not hypothetical: the owner is on a Mac and workshop attendees bring
    // whatever they own. Recording nothing on Safari is a silent,
    // device-specific failure that nobody reports — they just stop using it.
    const safari = (t) => t.includes('mp4');
    expect(pickMimeType('video', safari)).toBe('video/mp4');
    expect(pickMimeType('audio', safari)).toBe('audio/mp4');
  });

  it('returns NULL when the browser can record none of them', () => {
    // A real answer. Starting a recorder anyway produces an empty file and a
    // clip with no media in it.
    expect(pickMimeType('video', () => false)).toBeNull();
  });

  it("returns '' when there is no way to ask — let the browser decide", () => {
    // '' is meaningful to MediaRecorder: "you choose". Refusing here would
    // block recording on a browser that might well manage it.
    expect(pickMimeType('video', null)).toBe('');
  });

  it('every candidate names a real container', () => {
    for (const list of Object.values(MIME_CANDIDATES)) {
      for (const t of list) expect(t).toMatch(/^(audio|video)\/(webm|mp4|ogg)/);
    }
  });

  it('the extension matches the container, for the upload filename', () => {
    expect(extensionFor('video/webm;codecs=vp9,opus')).toBe('webm');
    expect(extensionFor('audio/mp4')).toBe('mp4');
    expect(extensionFor('audio/ogg;codecs=opus')).toBe('ogg');
    expect(extensionFor('')).toBe('webm');
    expect(extensionFor(null)).toBe('webm');
  });
});

describe('failures say what to DO about them', () => {
  const err = (name) => Object.assign(new Error('x'), { name });

  it('a blocked microphone points at the padlock, not at support', () => {
    expect(captureErrorMessage(err('NotAllowedError'), 'voiceover'))
      .toMatch(/padlock in the address bar/);
  });

  it('a cancelled screen share is not phrased as an error', () => {
    // Clicking Cancel on the picker is a decision, not a fault, and telling
    // someone their screen share "failed" makes them try to fix nothing.
    const msg = captureErrorMessage(err('NotAllowedError'), 'screen');
    expect(msg).toMatch(/cancelled/i);
    expect(msg).not.toMatch(/blocked/i);
  });

  it('a busy device says to close the other app', () => {
    expect(captureErrorMessage(err('NotReadableError'), 'camera')).toMatch(/already in use/i);
  });

  it('no device says to plug one in or pick another', () => {
    expect(captureErrorMessage(err('NotFoundError'), 'voiceover')).toMatch(/No microphone was found/);
  });

  it('an insecure page is flagged as OUR problem, not the customer\'s', () => {
    // SecurityError means the page is not on https. Nothing the customer does
    // will fix that, so the message must not imply otherwise.
    expect(captureErrorMessage(err('SecurityError'))).toMatch(/report this/i);
  });

  it('names the right device in each mode', () => {
    expect(captureErrorMessage(err('NotFoundError'), 'camera')).toMatch(/camera/);
    expect(captureErrorMessage(err('NotFoundError'), 'voiceover')).toMatch(/microphone/);
  });

  it('an unrecognised failure still carries the real message', () => {
    // Never "Recording failed." with nothing attached — that is the generic
    // toast the owner has asked not to see.
    expect(captureErrorMessage(Object.assign(new Error('kaboom'), { name: 'WeirdError' })))
      .toMatch(/kaboom/);
  });

  it('survives being handed nothing at all', () => {
    expect(captureErrorMessage(null)).toBeTruthy();
    expect(captureErrorMessage(undefined)).toBeTruthy();
  });
});

describe('device lists', () => {
  const devices = [
    { kind: 'audioinput', deviceId: 'default', label: 'Default - Built-in' },
    { kind: 'audioinput', deviceId: 'mic-a', label: 'Blue Yeti' },
    { kind: 'audioinput', deviceId: 'mic-b', label: '' },
    { kind: 'videoinput', deviceId: 'cam-a', label: 'FaceTime HD' },
  ];

  it('always offers System default first', () => {
    const list = normaliseDevices(devices, 'microphone');
    expect(list[0]).toEqual({ deviceId: 'default', label: 'System default' });
  });

  it('does not list the browser\'s own "default" entry twice', () => {
    const list = normaliseDevices(devices, 'microphone');
    expect(list.filter((d) => d.deviceId === 'default')).toHaveLength(1);
  });

  it('names an unlabelled device instead of showing a blank row', () => {
    // Labels are empty until permission has been granted once. That is a
    // privacy rule, not a bug — but a blank row is unpickable.
    const list = normaliseDevices(devices, 'microphone');
    expect(list.find((d) => d.deviceId === 'mic-b').label).toBe('Microphone 2');
  });

  it('keeps cameras and microphones apart', () => {
    expect(normaliseDevices(devices, 'camera').map((d) => d.deviceId)).toEqual(['default', 'cam-a']);
  });

  it('survives no devices and no argument', () => {
    expect(normaliseDevices([], 'camera')).toHaveLength(1);
    expect(normaliseDevices(undefined, 'camera')).toHaveLength(1);
  });
});

describe('where the take lands', () => {
  it('starts at the PLAYHEAD, not at zero', () => {
    // Someone recording a voiceover is watching a moment and talking over it.
    // Dropping every take at 0 means dragging every one before it is any use.
    expect(recordingStartAt(12.5)).toBe(12.5);
  });

  it('clamps a negative or nonsense playhead to zero', () => {
    expect(recordingStartAt(-3)).toBe(0);
    expect(recordingStartAt(NaN)).toBe(0);
    expect(recordingStartAt(undefined)).toBe(0);
    expect(recordingStartAt('abc')).toBe(0);
  });

  it('numbers repeat takes so three are tellable apart in the track', () => {
    expect(recordingName('voiceover')).toBe('Voiceover');
    expect(recordingName('voiceover', 2)).toBe('Voiceover 2');
    expect(recordingName('screen', 3)).toBe('Screen 3');
  });
});

describe('settings belong to the desk, not the project', () => {
  let store;
  beforeEach(() => {
    const map = new Map();
    store = {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => map.set(k, v),
    };
  });

  it('defaults the countdown ON', () => {
    // Nobody is ready the instant they click, and a take that starts with
    // "oh — am I—" gets deleted and redone.
    expect(DEFAULT_SETTINGS.countdown).toBe(true);
    expect(COUNTDOWN_SECONDS).toBe(3);
  });

  it('round-trips a choice', () => {
    writeSettings({ micId: 'mic-a', cameraId: 'cam-a', countdown: false }, store);
    expect(readSettings(store)).toMatchObject({ micId: 'mic-a', cameraId: 'cam-a', countdown: false });
  });

  it('only an explicit false turns the countdown off', () => {
    // A corrupted or older value must not silently start recording instantly —
    // the surprising direction is the one that ruins a take.
    store.setItem('voxel-edit-cut:recording', JSON.stringify({ countdown: 'no' }));
    expect(readSettings(store).countdown).toBe(true);
    store.setItem('voxel-edit-cut:recording', JSON.stringify({ countdown: 0 }));
    expect(readSettings(store).countdown).toBe(true);
  });

  it('survives corrupted storage', () => {
    store.setItem('voxel-edit-cut:recording', '{not json');
    expect(readSettings(store)).toEqual(DEFAULT_SETTINGS);
  });

  it('survives having no storage at all', () => {
    expect(readSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(() => writeSettings({ micId: 'x' }, null)).not.toThrow();
  });

  it('a full quota does not take the recording down with it', () => {
    const throwing = { getItem: () => null, setItem: () => { throw new Error('QuotaExceeded'); } };
    expect(() => writeSettings({ micId: 'x' }, throwing)).not.toThrow();
  });
});

describe('letting go of the device', () => {
  it('stops every track — otherwise the camera light stays on', () => {
    // People read a lit camera light as "still recording", and they are right
    // to. Leaving it on is the kind of thing that loses trust permanently.
    const stops = [vi.fn(), vi.fn()];
    stopStream({ getTracks: () => [{ stop: stops[0] }, { stop: stops[1] }] });
    expect(stops[0]).toHaveBeenCalled();
    expect(stops[1]).toHaveBeenCalled();
  });

  it('never throws, whatever it is handed', () => {
    // This runs in cleanup paths, including the one after a failure. Throwing
    // here would replace a real error message with a useless one.
    expect(() => stopStream(null)).not.toThrow();
    expect(() => stopStream({})).not.toThrow();
    expect(() => stopStream({ getTracks: () => { throw new Error('gone'); } })).not.toThrow();
  });
});
