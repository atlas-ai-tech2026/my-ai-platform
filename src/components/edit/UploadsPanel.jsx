// ─── UploadsPanel.jsx ────────────────────────────────────────────────────────
// Bring your own footage, music and logos.
//
// The Uploads tab has been greyed out since the editor shipped. It is cheap to
// finish now because RECORDING proved the whole chain — /api/upload stores to
// Spaces and hands back a durable https url, and that url becomes a source and
// a clip. An upload is the same path with a file the customer chose.
//
// ── EVERY FILE KEEPS ITS OWN STATE ─────────────────────────────────────────
// Not one spinner for the batch. Drop six files and one fails, and a single
// shared state can only say "something went wrong" — so the customer either
// re-uploads all six or, worse, does not notice the gap until the export is
// missing something. Each row succeeds or fails on its own and says why.
//
// The uploads live in this panel's state, not in the project. They are already
// durable urls in Spaces, and a clip on the timeline references the source. A
// list of what you happened to upload this session is a convenience, not
// something to persist and have to reconcile later.

import { useCallback, useRef, useState } from 'react';
import { UploadCloud, Music, Image as ImageIcon, Film, AlertCircle, Loader2, Plus } from 'lucide-react';
import Tip from './Tip';
import {
  sortDropped, labelForFile, humanSize, MAX_BYTES, ACCEPTED_MIME, IMAGE_SECONDS, kindOfFile,
} from '@/lib/uploads';
import { measureDuration } from '@/lib/media-library';

const ICON = { video: Film, audio: Music, image: ImageIcon };

let seq = 0;
const nextId = () => { seq += 1; return `up${seq}`; };

export default function UploadsPanel({ onAdd, disabled = false, onDragSource, onDragEnd }) {
  const [items, setItems] = useState([]);      // { id, name, kind, state, url, seconds, error }
  const [dragging, setDragging] = useState(false);
  const [rejected, setRejected] = useState([]);
  const fileInput = useRef(null);

  const patch = (id, next) => setItems((list) => list.map((i) => (i.id === id ? { ...i, ...next } : i)));

  const upload = useCallback(async (file, kind, id) => {
    const token = localStorage.getItem('voxel_token');
    const form = new FormData();
    form.append('file', file, file.name);
    try {
      const resp = await fetch('/api/upload', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data?.url) {
        // The server's own words when it has them: "File too large. Max 100 MB"
        // is actionable, "upload failed" is not.
        throw new Error(data?.error || `The upload was refused (${resp.status}).`);
      }

      // An image has no length of its own; everything else is measured from
      // the file rather than guessed. probeUnsized because a file somebody
      // recorded elsewhere may declare no duration either.
      let seconds = IMAGE_SECONDS;
      if (kind !== 'image') {
        try { seconds = await measureDuration(data.url, { probeUnsized: true }); } catch { seconds = 0; }
        if (!Number.isFinite(seconds) || seconds <= 0) {
          throw new Error('That file uploaded, but its length could not be read, so it was not added.');
        }
      }
      patch(id, { state: 'ready', url: data.url, seconds });
    } catch (err) {
      patch(id, { state: 'failed', error: err?.message || 'The upload failed.' });
    }
  }, []);

  const accept = useCallback((fileList) => {
    const { accepted, rejected: bad } = sortDropped(fileList);
    // Shown, never swallowed. A folder with three bad files among forty must
    // say which three.
    setRejected(bad.map((r) => r.reason));

    for (const { file, kind } of accepted) {
      const id = nextId();
      const k = kind || kindOfFile(file) || 'video';
      setItems((list) => [
        ...list,
        { id, name: labelForFile(file), size: file.size, kind: k, state: 'uploading' },
      ]);
      upload(file, k, id);
    }
  }, [upload]);

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    if (!disabled) accept(e.dataTransfer?.files);
  };

  /** ONE description of an upload, used by both the click and the drag, so a
   *  clip cannot arrive with a different id or name depending on how it got
   *  there. */
  const sourceFor = (item) => ({
    kind: item.kind,
    seconds: item.seconds,
    label: item.name,
    source: { id: `up:${item.id}`, url: item.url, kind: item.kind, uploaded: true, name: item.name },
  });

  const add = (item) => {
    if (item.state !== 'ready') return;
    const { source, seconds, kind } = sourceFor(item);
    onAdd?.({ source, seconds, kind });
  };

  return (
    <div className="flex flex-col gap-3 h-full min-h-0">
      {/* ── the drop zone ────────────────────────────────────────────────── */}
      <Tip label={`Video, audio or images — up to ${humanSize(MAX_BYTES)} each`} fill>
        <button
          type="button"
          disabled={disabled}
          onClick={() => fileInput.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          data-testid="uploads-drop"
          className={`w-full rounded-xl border border-dashed p-6 text-center transition-colors
            ${dragging ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50'}
            disabled:opacity-40`}
        >
          <UploadCloud className="w-6 h-6 mx-auto mb-2 text-foreground-muted" />
          <div className="text-sm text-foreground">Drop files here, or click to choose</div>
          <div className="text-xs text-foreground-muted mt-1">
            Video, audio and images · up to {humanSize(MAX_BYTES)} each
          </div>
        </button>
      </Tip>

      <input
        ref={fileInput}
        type="file"
        multiple
        accept={ACCEPTED_MIME.join(',')}
        className="hidden"
        data-testid="uploads-input"
        onChange={(e) => { accept(e.target.files); e.target.value = ''; }}
      />

      {/* What we would not take, and why. */}
      {rejected.length > 0 && (
        <div data-testid="uploads-rejected" className="text-xs text-primary space-y-1">
          {rejected.map((r) => (
            <div key={r} className="flex gap-1.5 items-start">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" /><span>{r}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── what has been uploaded this session ──────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5">
        {items.length === 0 && rejected.length === 0 && (
          <p className="text-sm text-foreground-muted">
            Nothing uploaded yet. Bring in your logo, a music bed, or footage you
            filmed elsewhere — it sits alongside everything you generated here.
          </p>
        )}

        {items.map((item) => {
          const Icon = ICON[item.kind] || Film;
          const ready = item.state === 'ready';
          // The ROW says what went wrong; the TOOLTIP says what to do about it.
          // Repeating the same sentence in both is noise, and it leaves the
          // customer with a diagnosis and no next step.
          const label = ready
            ? `Add “${item.name}” to the timeline`
            : item.state === 'failed'
              ? 'This one did not upload — drop the file in again to retry'
              : 'Uploading…';
          return (
            <Tip key={item.id} label={label} fill>
              <button
                type="button"
                onClick={() => add(item)}
                disabled={!ready}
                data-testid={`upload-${item.id}`}
                // Same gesture as a Voxel generation. An upload that can only
                // be clicked while a generation can be dragged teaches the
                // customer that dragging is unreliable.
                draggable={ready}
                onDragStart={(e) => {
                  if (!ready) { e.preventDefault(); return; }
                  e.dataTransfer.setData('text/plain', item.name);
                  e.dataTransfer.effectAllowed = 'copy';
                  onDragSource?.(sourceFor(item));
                }}
                onDragEnd={() => onDragEnd?.()}
                className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left
                  ${ready ? 'hover:bg-background-elevated cursor-pointer' : 'cursor-default'}
                  ${item.state === 'failed' ? 'opacity-90' : ''}`}
              >
                {item.state === 'uploading'
                  ? <Loader2 className="w-4 h-4 shrink-0 animate-spin text-foreground-muted" />
                  : item.state === 'failed'
                    ? <AlertCircle className="w-4 h-4 shrink-0 text-primary" />
                    : <Icon className="w-4 h-4 shrink-0 text-foreground-muted" />}

                <span className="flex-1 min-w-0">
                  <span className="block truncate text-sm text-foreground">{item.name}</span>
                  <span className="block truncate text-[11px] text-foreground-muted">
                    {item.state === 'failed'
                      ? item.error
                      : `${item.kind} · ${humanSize(item.size)}${ready ? ` · ${item.seconds.toFixed(1)}s` : ''}`}
                  </span>
                </span>

                {ready && <Plus className="w-3.5 h-3.5 shrink-0 text-foreground-muted" />}
              </button>
            </Tip>
          );
        })}
      </div>
    </div>
  );
}
