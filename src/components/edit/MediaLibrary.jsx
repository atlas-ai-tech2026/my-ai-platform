// ─── MediaLibrary.jsx ────────────────────────────────────────────────────────
// The customer's own generations, ready to be cut.
//
// This is the moment Voxel Edit Cut stops being a demo. Until something real
// can get onto the timeline, everything above it is scaffolding.
//
// ── THREE THINGS THIS REFUSES TO DO ────────────────────────────────────────
// 1. HIDE WHAT IT CANNOT USE. A pending, failed or expired generation stays in
//    the list, greyed, with the reason on it. The customer remembers making
//    that video; a list that silently omits it reads as lost work, not as a
//    known state.
// 2. GUESS A DURATION. A clip with a wrong out point does not throw — it ends
//    the export in black or cuts the shot off, and it is found after the file
//    has been sent. When the record carries no duration it is MEASURED from
//    the media before anything is added, and if it cannot be measured the card
//    says so instead of adding something wrong.
// 3. LOAD EVERY VIDEO AT ONCE. A poster frame per card, not an autoplaying
//    <video> per card — 200 decoding elements is how a laptop stops
//    responding, and the customer reads that as the site crashing.

import React, { useEffect, useState } from 'react';
import { Loader2, AlertCircle, Plus, Film, ImageIcon } from 'lucide-react';

import {
  usability, kindOf, durationOf, toSource, labelFor, orderForLibrary, measureDuration,
} from '@/lib/media-library';

/** One page is plenty for a panel; the editor is not a history browser. */
const PAGE = 60;

export default function MediaLibrary({ entity, onAdd, busyId = null }) {
  const [records, setRecords] = useState(null);   // null = still loading
  const [error, setError] = useState(null);
  const [measuring, setMeasuring] = useState(null);
  const [problem, setProblem] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await entity.filter({ type: 'video' }, '-created_date', PAGE, 0);
        if (!cancelled) setRecords(orderForLibrary(rows || []));
      } catch (err) {
        // The platform's rule: an error names its cause. "Nothing here" would
        // be indistinguishable from an account with no generations.
        //
        // But NOT the server's own words for every case. A signed-out visitor
        // would otherwise read "Missing bearer token", which is accurate,
        // useless, and looks like a fault in the site rather than a session
        // that has ended. ApiError carries the status, so the two are
        // distinguishable and get different sentences.
        if (cancelled) return;
        const status = err?.status ?? null;
        setError(status === 401 || status === 403
          ? 'Sign in to see your generations here.'
          : (err?.message || 'Your generations could not be loaded.'));
      }
    })();
    return () => { cancelled = true; };
  }, [entity]);

  async function add(record) {
    setProblem(null);
    let seconds = durationOf(record);

    if (seconds === null) {
      // Older rows predate the duration column, and kie does not always return
      // one. Measure rather than default.
      setMeasuring(record.id);
      seconds = await measureDuration(record.result_url);
      setMeasuring(null);
      if (seconds === null) {
        setProblem(`“${labelFor(record, 40)}” could not be read, so its length is unknown. It has not been added.`);
        return;
      }
    }
    onAdd?.({ source: toSource(record), seconds });
  }

  if (error) {
    return (
      <div className="flex items-start gap-2 p-4 text-sm text-primary">
        <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
      </div>
    );
  }
  if (records === null) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-foreground-muted">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading your generations…
      </div>
    );
  }
  if (records.length === 0) {
    return (
      <p className="p-4 text-sm text-foreground-muted">
        Nothing generated yet. Make a video on the Video page and it will appear here.
      </p>
    );
  }

  return (
    <div>
      {problem && (
        <p className="mb-2 text-xs text-primary" data-testid="library-problem">⚠ {problem}</p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
        {records.map((r) => {
          const use = usability(r);
          const secs = durationOf(r);
          const Icon = kindOf(r) === 'image' ? ImageIcon : Film;

          return (
            <button
              key={r.id}
              type="button"
              disabled={!use.ok || busyId === r.id || measuring === r.id}
              onClick={() => add(r)}
              title={r.prompt || ''}
              data-testid={`library-item-${r.id}`}
              className={`group relative text-left rounded-lg border border-border overflow-hidden
                ${use.ok ? 'hover:border-primary' : 'opacity-45 cursor-not-allowed'}`}
            >
              <div className="aspect-video bg-black flex items-center justify-center">
                {/* A poster frame, not a live element. #t=0.1 asks for a frame
                    rather than black — some encoders start on a blank one. */}
                {use.ok && kindOf(r) === 'video' && (
                  <video
                    src={`${r.result_url}#t=0.1`}
                    preload="metadata"
                    muted
                    playsInline
                    className="w-full h-full object-cover"
                  />
                )}
                {use.ok && kindOf(r) === 'image' && (
                  <img src={r.result_url} alt="" className="w-full h-full object-cover" />
                )}
                {!use.ok && <Icon className="w-5 h-5 text-foreground-muted" />}
              </div>

              <div className="p-2">
                <p className="text-[11px] leading-tight text-foreground-secondary line-clamp-2">
                  {labelFor(r, 70)}
                </p>
                <p className="mt-1 flex items-center gap-1.5 text-[10px] text-foreground-muted font-mono">
                  {r.model || 'unknown model'}
                  {secs !== null && <span>· {secs}s</span>}
                  {!use.ok && <span className="text-primary">· {use.label}</span>}
                </p>
              </div>

              {(busyId === r.id || measuring === r.id) && (
                <span className="absolute inset-0 flex items-center justify-center bg-black/60 text-xs text-white">
                  <Loader2 className="w-4 h-4 animate-spin mr-1.5" />
                  {measuring === r.id ? 'Reading length…' : 'Adding…'}
                </span>
              )}
              {use.ok && busyId !== r.id && measuring !== r.id && (
                <span className="absolute top-1.5 right-1.5 rounded-full bg-primary p-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Plus className="w-3 h-3 text-white" />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
