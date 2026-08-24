// ─── RecordMenu.jsx ──────────────────────────────────────────────────────────
// The microphone button in the timeline toolbar, and everything behind it.
//
// Shape follows ChatCut's own menu, because an editor who has used theirs
// should not have to learn ours:
//
//     RECORD
//       ● Voiceover
//         Camera
//         Screen
//       ───────────────
//       Microphone  >  System default ✓
//       Camera      >  System default ✓
//       ───────────────
//       3-second countdown ✓
//
// Every decision that can be made without a device lives in lib/recording.js
// and is tested there. What is left here is the part that genuinely needs a
// microphone: opening it, recording, and stopping.
//
// This component does NOT touch the project. It hands back a blob and lets
// EditCut decide where it goes — the same split as the agent, where the
// browser owns the timeline and nothing else gets to mutate it behind its back.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, ChevronDown, Square, Video, Monitor, Check, Loader2 } from 'lucide-react';
import Tip from './Tip';
import {
  RECORD_MODES, modeById, pickMimeType, captureErrorMessage,
  normaliseDevices, readSettings, writeSettings, stopStream, baseMimeType,
  COUNTDOWN_SECONDS,
} from '@/lib/recording';

const ICONS = { voiceover: Mic, camera: Video, screen: Monitor };

export default function RecordMenu({ onRecorded, onError, disabled = false }) {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState(() => readSettings());
  const [mics, setMics] = useState([{ deviceId: 'default', label: 'System default' }]);
  const [cams, setCams] = useState([{ deviceId: 'default', label: 'System default' }]);

  const [countdown, setCountdown] = useState(0);   // 3, 2, 1 then 0
  const [recording, setRecording] = useState(null); // { mode, startedAt }
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);          // uploading, after stop

  const streamRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const cancelledRef = useRef(false);
  const rootRef = useRef(null);

  // ── device list ───────────────────────────────────────────────────────
  // Labels stay empty until permission has been granted once, so this is
  // re-read after a successful capture rather than only at mount.
  const refreshDevices = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices?.enumerateDevices?.();
      if (!all) return;
      setMics(normaliseDevices(all, 'microphone'));
      setCams(normaliseDevices(all, 'camera'));
    } catch { /* enumerate can throw in a locked-down browser; the defaults stand */ }
  }, []);

  useEffect(() => { if (open) refreshDevices(); }, [open, refreshDevices]);

  // Close on outside click and on Escape — but NEVER while recording, because
  // dismissing the menu must not silently abandon a take in progress.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!rootRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape' && !recording && !countdown) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, recording, countdown]);

  // Elapsed clock while recording.
  useEffect(() => {
    if (!recording) return undefined;
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [recording]);

  // If the component goes away mid-take, let go of the device. Without this
  // the camera light stays on, which people rightly read as still recording.
  useEffect(() => () => {
    cancelledRef.current = true;
    try { recorderRef.current?.stop(); } catch { /* already stopped */ }
    stopStream(streamRef.current);
  }, []);

  const update = (patch) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    writeSettings(next);
  };

  const fail = (message) => {
    stopStream(streamRef.current);
    streamRef.current = null;
    recorderRef.current = null;
    setRecording(null);
    setCountdown(0);
    setBusy(false);
    onError?.(message);
  };

  // ── start ─────────────────────────────────────────────────────────────
  const start = async (modeId) => {
    const mode = modeById(modeId);
    if (!mode || recording || countdown) return;
    setOpen(false);

    let stream;
    try {
      stream = mode.display
        ? await navigator.mediaDevices.getDisplayMedia(mode.constraints())
        : await navigator.mediaDevices.getUserMedia(mode.constraints(
          modeId === 'camera' ? settings.cameraId : settings.micId,
          settings.micId,
        ));
    } catch (e) {
      return fail(captureErrorMessage(e, modeId));
    }

    const mimeType = pickMimeType(mode.media);
    if (mimeType === null) {
      stopStream(stream);
      return fail('This browser cannot record video or audio. Chrome, Edge and Safari all can.');
    }

    // Stopping the share from the browser's own "Stop sharing" bar ends the
    // take rather than leaving a recorder running against a dead track.
    stream.getTracks().forEach((t) => { t.onended = () => stopRecording(); });

    streamRef.current = stream;
    refreshDevices();

    if (settings.countdown) {
      for (let n = COUNTDOWN_SECONDS; n > 0; n -= 1) {
        setCountdown(n);
        await new Promise((r) => { setTimeout(r, 1000); });
        if (cancelledRef.current) return undefined;
      }
      setCountdown(0);
    }

    try {
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data?.size) chunksRef.current.push(e.data); };
      recorder.onerror = (e) => fail(`Recording stopped unexpectedly: ${e.error?.message || 'unknown error'}`);
      recorder.onstop = async () => {
        stopStream(streamRef.current);
        streamRef.current = null;
        // The BASE type, not the recorder's. `video/webm;codecs=vp9,opus`
        // carries a comma the multipart parser cannot read, and the upload
        // arrives as text/plain and is refused. See baseMimeType.
        const upload = baseMimeType(mimeType) || (mode.media === 'audio' ? 'audio/webm' : 'video/webm');
        const blob = new Blob(chunksRef.current, { type: upload });
        chunksRef.current = [];
        setRecording(null);
        if (!blob.size) return fail('Nothing was recorded — the take was empty.');
        setBusy(true);
        try {
          await onRecorded?.({ blob, mimeType: upload, mode: modeId });
        } catch (e) {
          return fail(e?.message || 'The recording could not be saved.');
        } finally {
          setBusy(false);
        }
        return undefined;
      };
      recorder.start(1000);        // a chunk a second, so a crash loses ≤1s
      recorderRef.current = recorder;
      setElapsed(0);
      setRecording({ mode: modeId });
    } catch (e) {
      stopStream(stream);
      return fail(`Could not start recording: ${e?.message || 'unknown error'}`);
    }
    return undefined;
  };

  const stopRecording = () => {
    try { recorderRef.current?.state !== 'inactive' && recorderRef.current?.stop(); }
    catch { /* already stopped */ }
  };

  // ── recording / countdown bar ─────────────────────────────────────────
  if (countdown > 0) {
    return (
      <span
        className="px-2 py-1 rounded text-xs font-mono text-primary"
        role="status"
        aria-live="assertive"
        data-testid="record-countdown"
      >
        Recording in {countdown}…
      </span>
    );
  }

  if (recording) {
    const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const ss = String(elapsed % 60).padStart(2, '0');
    return (
      <Tip label="Stop recording">
        <button
          type="button"
          onClick={stopRecording}
          data-testid="record-stop"
          aria-label="Stop recording"
          className="flex items-center gap-1.5 px-2 py-1 rounded bg-primary/15 text-primary hover:bg-primary/25"
        >
          <Square className="w-3 h-3" fill="currentColor" />
          <span className="font-mono text-xs tabular-nums">{mm}:{ss}</span>
        </button>
      </Tip>
    );
  }

  // ── the button + menu ─────────────────────────────────────────────────
  return (
    <span ref={rootRef} className="relative">
      <Tip label="Record voiceover, camera or screen">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          disabled={disabled || busy}
          aria-label="Record"
          aria-expanded={open}
          aria-haspopup="menu"
          data-testid="record-open"
          className="flex items-center gap-0.5 p-1.5 rounded hover:bg-background-elevated text-foreground-muted hover:text-white disabled:opacity-40"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mic className="w-4 h-4" />}
          <ChevronDown className="w-3 h-3" />
        </button>
      </Tip>

      {open && (
        // Opens DOWNWARD: this toolbar sits above the tracks, so there is room
        // below and none above — the viewer is there. The agent settings panel
        // had to learn this the other way round.
        <div
          role="menu"
          data-testid="record-menu"
          className="absolute left-0 top-full mt-1 z-50 w-60 rounded-lg border border-border bg-background-elevated shadow-xl py-1 text-sm"
        >
          <div className="px-3 py-1 text-[10px] tracking-widest text-foreground-muted">RECORD</div>

          {RECORD_MODES.map((m) => {
            const Icon = ICONS[m.id] || Mic;
            return (
              <Tip key={m.id} label={m.hint} fill>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => start(m.id)}
                  data-testid={`record-${m.id}`}
                  className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-background text-left text-foreground"
                >
                  <Icon className="w-3.5 h-3.5 text-foreground-muted" />
                  {m.label}
                </button>
              </Tip>
            );
          })}

          <div className="my-1 border-t border-border" />

          <DevicePicker
            label="Microphone" devices={mics} value={settings.micId}
            onChange={(micId) => update({ micId })} testid="record-mic"
          />
          <DevicePicker
            label="Camera" devices={cams} value={settings.cameraId}
            onChange={(cameraId) => update({ cameraId })} testid="record-cam"
          />

          <div className="my-1 border-t border-border" />

          <Tip label="Give yourself three seconds to get ready before it starts" fill>
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={settings.countdown}
              onClick={() => update({ countdown: !settings.countdown })}
              data-testid="record-countdown-toggle"
              className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-background text-left text-foreground"
            >
              <span>{COUNTDOWN_SECONDS}-second countdown</span>
              {settings.countdown && <Check className="w-3.5 h-3.5 text-primary" />}
            </button>
          </Tip>
        </div>
      )}
    </span>
  );
}

/** A labelled `select`, not a nested fly-out. ChatCut uses a submenu; a select
 *  is the same choice with none of the hover-path problems, and it is the only
 *  version that works with a keyboard and on a touch screen. */
function DevicePicker({ label, devices, value, onChange, testid }) {
  const chosen = devices.some((d) => d.deviceId === value) ? value : 'default';
  return (
    <label className="flex items-center gap-2 px-3 py-1.5 text-foreground-muted">
      <span className="flex-1">{label}</span>
      <select
        value={chosen}
        onChange={(e) => onChange(e.target.value)}
        data-testid={testid}
        aria-label={`${label} device`}
        className="max-w-[7.5rem] bg-background border border-border rounded px-1 py-0.5 text-xs text-foreground"
      >
        {devices.map((d) => (
          <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
        ))}
      </select>
    </label>
  );
}
