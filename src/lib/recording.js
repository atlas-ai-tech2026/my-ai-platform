// ─── recording.js ────────────────────────────────────────────────────────────
// Voiceover, camera and screen capture for Voxel Edit Cut.
//
// ── WHY A SEPARATE MODULE ──────────────────────────────────────────────────
// Everything here that can be decided WITHOUT a microphone is decided here, so
// it can be tested without one: which container to record in, which track a
// recording belongs on, what a failure means in words a person can act on, and
// how the countdown behaves. The React component is left with the parts that
// genuinely need a device.
//
// ── WHAT WAS CHECKED BEFORE ANY OF THIS WAS WRITTEN ────────────────────────
// Recording touches getUserMedia, MediaRecorder and blob: URLs — the same
// shape as the ffmpeg export that passed thirty tests, worked on localhost,
// and then failed for every user on dev because Vite sends no CSP and
// production does. So the live headers were read first, from dev itself:
//
//   media-src 'self' data: blob: https:   ← recorded clips can play
//   worker-src 'self' blob:
//   (no Permissions-Policy header at all)  ← capture is not blocked
//
// That is the trap closed rather than walked into a second time.
//
// ── AND WHY A RECORDING IS UPLOADED IMMEDIATELY ────────────────────────────
// A blob: URL dies with the page. The editor autosaves and reloads, so a
// recording left as a blob would be a clip that silently loses its media the
// first time someone refreshes — the exact failure that made history vanish
// when FAL urls expired. POST /api/upload already stores to Spaces, returns a
// durable https url, and its validator explicitly accepts WebM as both video
// AND audio, which is what MediaRecorder produces. So the recording is
// uploaded before it becomes a clip.

/** The three things you can record, in ChatCut's order. */
export const RECORD_MODES = [
  {
    id: 'voiceover',
    label: 'Voiceover',
    hint: 'Record your microphone over the timeline',
    media: 'audio',          // what comes back
    trackKind: 'audio',      // where the clip lands
    display: false,          // getUserMedia, not getDisplayMedia
    constraints: (deviceId) => ({
      audio: deviceId && deviceId !== 'default' ? { deviceId: { exact: deviceId } } : true,
      video: false,
    }),
  },
  {
    id: 'camera',
    label: 'Camera',
    hint: 'Record yourself with the camera and microphone',
    media: 'video',
    trackKind: 'video',
    display: false,
    constraints: (deviceId, micId) => ({
      audio: micId && micId !== 'default' ? { deviceId: { exact: micId } } : true,
      video: deviceId && deviceId !== 'default'
        ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
        : { width: { ideal: 1920 }, height: { ideal: 1080 } },
    }),
  },
  {
    id: 'screen',
    label: 'Screen',
    hint: 'Record a window, a tab or the whole screen',
    media: 'video',
    trackKind: 'video',
    display: true,           // getDisplayMedia — the browser picks the surface
    constraints: () => ({ video: true, audio: true }),
  },
];

export const modeById = (id) => RECORD_MODES.find((m) => m.id === id) || null;

/** Which timeline track kind a finished recording belongs on. */
export function trackKindFor(modeId) {
  return modeById(modeId)?.trackKind || 'video';
}

/**
 * Candidate containers, best first.
 *
 * Safari is the reason this is a list and not a constant. It cannot record
 * WebM at all — it does mp4 — and the owner is on a Mac while workshop
 * attendees arrive with whatever they own. Recording nothing on Safari would
 * be a silent, device-specific failure of exactly the kind nobody reports;
 * they just conclude the feature is broken.
 */
export const MIME_CANDIDATES = {
  audio: [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',                 // Safari
    'audio/ogg;codecs=opus',
  ],
  video: [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4',                 // Safari
  ],
};

/**
 * First container this browser will actually record.
 *
 * @param {'audio'|'video'} media
 * @param {Function} isSupported  injectable for tests; defaults to MediaRecorder
 * @returns {string|null} null when the browser can record none of them — a real
 *                        answer, and the caller must say so rather than start a
 *                        recorder that produces an empty file.
 */
export function pickMimeType(media, isSupported) {
  const supported = isSupported
    || (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.bind(MediaRecorder));
  const list = MIME_CANDIDATES[media] || [];
  // No way to ask: let the browser use its own default rather than refuse.
  // '' is meaningful to MediaRecorder — it means "you choose".
  if (typeof supported !== 'function') return '';
  for (const type of list) if (supported(type)) return type;
  return null;
}

/** The file extension that goes with a container, for the upload filename. */
export function extensionFor(mimeType) {
  if (!mimeType) return 'webm';
  if (mimeType.includes('mp4')) return 'mp4';
  if (mimeType.includes('ogg')) return 'ogg';
  return 'webm';
}

/**
 * Turn a getUserMedia / getDisplayMedia failure into something a person can
 * act on.
 *
 * Every branch here names a DIFFERENT action. "Recording failed" is the
 * message that sends someone to support; "your browser blocked the
 * microphone" sends them to the padlock in the address bar, which is where
 * the fix actually is.
 */
export function captureErrorMessage(error, modeId = 'voiceover') {
  const name = error?.name || '';
  const thing = modeId === 'screen' ? 'screen' : modeId === 'camera' ? 'camera' : 'microphone';

  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return modeId === 'screen'
        ? 'Screen sharing was cancelled. Nothing was recorded.'
        : `Access to your ${thing} was blocked. Allow it from the padlock in the address bar, then try again.`;
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return `No ${thing} was found. Plug one in, or pick a different device from the Record menu.`;
    case 'NotReadableError':
    case 'TrackStartError':
      return `Your ${thing} is already in use by another app. Close it and try again.`;
    case 'OverconstrainedError':
      return `That ${thing} is no longer available. Choose another one from the Record menu.`;
    case 'AbortError':
      return 'Recording stopped before it started. Nothing was saved.';
    case 'SecurityError':
      // Worth naming precisely — it means the page is not on https, which is
      // a deployment problem and not something the customer can fix.
      return 'Recording needs a secure connection (https). Please report this.';
    default:
      return `Could not start recording${error?.message ? `: ${error.message}` : '.'}`;
  }
}

/** Devices the user can choose between, with a stable "system default" first.
 *  Labels are empty until permission has been granted once — that is a browser
 *  privacy rule, not a bug, so an unnamed device gets a positional name rather
 *  than a blank row. */
export function normaliseDevices(devices, kind) {
  const wanted = kind === 'camera' ? 'videoinput' : 'audioinput';
  const list = (devices || []).filter((d) => d.kind === wanted);
  return [
    { deviceId: 'default', label: 'System default' },
    ...list
      .filter((d) => d.deviceId && d.deviceId !== 'default')
      .map((d, i) => ({
        deviceId: d.deviceId,
        label: d.label || `${kind === 'camera' ? 'Camera' : 'Microphone'} ${i + 1}`,
      })),
  ];
}

export const COUNTDOWN_SECONDS = 3;

/** Where a recording should start on the timeline.
 *
 *  At the PLAYHEAD, not at zero and not at the end. Someone recording a
 *  voiceover is watching a particular moment and talking over it; dropping the
 *  take somewhere else means every recording needs dragging before it is any
 *  use. Clamped at 0 because the playhead can sit fractionally negative while
 *  a drag is in flight. */
export function recordingStartAt(playhead) {
  const t = Number(playhead);
  return Number.isFinite(t) && t > 0 ? t : 0;
}

/** A name that says what it is and when it was taken, so three takes are
 *  distinguishable in the track without opening them. */
export function recordingName(modeId, index = 1) {
  const base = modeById(modeId)?.label || 'Recording';
  return index > 1 ? `${base} ${index}` : base;
}

/**
 * Settings live in localStorage, not in the project: which microphone you use
 * is a fact about your desk, not about the edit, and it should not travel to
 * another machine when the project does.
 */
const SETTINGS_KEY = 'voxel-edit-cut:recording';

export const DEFAULT_SETTINGS = {
  micId: 'default',
  cameraId: 'default',
  countdown: true,          // ChatCut ships this on, and it is right — nobody
                            // is ready the instant they click
};

export function readSettings(storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  if (!storage) return { ...DEFAULT_SETTINGS };
  try {
    const raw = storage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const saved = JSON.parse(raw);
    return {
      micId: typeof saved?.micId === 'string' ? saved.micId : DEFAULT_SETTINGS.micId,
      cameraId: typeof saved?.cameraId === 'string' ? saved.cameraId : DEFAULT_SETTINGS.cameraId,
      // Only an explicit false turns the countdown off. Anything else — a
      // corrupted value, an older shape, a missing key — keeps the safer
      // behaviour rather than silently starting to record instantly.
      countdown: saved?.countdown === false ? false : true,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function writeSettings(settings, storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  if (!storage) return;
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify({ ...DEFAULT_SETTINGS, ...settings }));
  } catch { /* private mode, a full quota — not worth failing a recording over */ }
}

/** Stop every track on a stream. Missing this leaves the camera light on
 *  after the recording ends, which people reasonably read as still recording. */
export function stopStream(stream) {
  try {
    for (const track of stream?.getTracks?.() || []) track.stop();
  } catch { /* already gone */ }
}
