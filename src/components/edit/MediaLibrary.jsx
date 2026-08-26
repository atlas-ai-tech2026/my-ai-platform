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
import { Loader2, AlertCircle, Plus, Film, ImageIcon, Search, X, LayoutGrid, List } from 'lucide-react';

import {
  usability, kindOf, durationOf, toSource, labelFor, orderForLibrary, measureDuration,
  filterLibrary, modelsPresent, LIBRARY_SORTS,
} from '@/lib/media-library';
import Tip from './Tip';

/** One page is plenty for a panel; the editor is not a history browser. */
const PAGE = 60;

/** Remembered, because somebody who prefers one view prefers it tomorrow too.
 *  Same key convention as the timeline's row height. */
const VIEW_KEY = 'voxel.edit.libraryView';

/**
 * ONE item, in either shape.
 *
 * ── WHY THIS IS A COMPONENT AND NOT TWO BRANCHES ───────────────────────────
 * A grid branch and a list branch would each carry the disabled rule, the busy
 * overlay, the drag payload and the failure reason — four things that must
 * agree and will not. The one that gets forgotten is always the second one,
 * and the symptom is "it works in grid but not in list", which reads as the
 * editor being unreliable rather than as one missing line.
 *
 * `view` changes LAYOUT ONLY. Everything about what the item does is here once.
 */
function LibraryItem({ record: r, view, busy, onAdd, onDragSource, onDragEnd }) {
  const use = usability(r);
  const secs = durationOf(r);
  const Icon = kindOf(r) === 'image' ? ImageIcon : Film;
  const list = view === 'list';

  const thumb = (
    <div className={`bg-black flex items-center justify-center shrink-0
      ${list ? 'w-20 h-12 rounded overflow-hidden' : 'aspect-video'}`}
    >
      {/* A poster frame, not a live element. #t=0.1 asks for a frame rather
          than black — some encoders start on a blank one. */}
      {use.ok && kindOf(r) === 'video' && (
        <video src={`${r.result_url}#t=0.1`} preload="metadata" muted playsInline
          className="w-full h-full object-cover" />
      )}
      {use.ok && kindOf(r) === 'image' && (
        <img src={r.result_url} alt="" className="w-full h-full object-cover" />
      )}
      {!use.ok && <Icon className="w-5 h-5 text-foreground-muted" />}
    </div>
  );

  return (
    <button
      type="button"
      disabled={!use.ok || !!busy}
      onClick={() => onAdd(r)}
      title={r.prompt || ''}
      data-testid={`library-item-${r.id}`}
      // ── DRAG IT TO CHOOSE THE MOMENT ───────────────────────────────────
      // Clicking appends to the end, which is safe but gives you no say in
      // WHERE. Dragging is how you place it, and the two coexist: neither
      // replaces the other.
      //
      // Only usable generations drag. A failed one is deliberately still on
      // screen with its reason, and letting it be dragged would promise
      // something that cannot be delivered.
      draggable={use.ok}
      onDragStart={(e) => {
        if (!use.ok) { e.preventDefault(); return; }
        // Firefox refuses to start a drag unless SOMETHING is set.
        e.dataTransfer.setData('text/plain', labelFor(r, 60));
        e.dataTransfer.effectAllowed = 'copy';
        onDragSource?.(r);
      }}
      onDragEnd={() => onDragEnd?.()}
      className={`group relative text-left border border-border overflow-hidden
        ${list ? 'flex items-center gap-2.5 p-1.5 rounded-md' : 'rounded-lg'}
        ${use.ok ? 'hover:border-primary' : 'opacity-45 cursor-not-allowed'}`}
    >
      {thumb}

      <div className={list ? 'flex-1 min-w-0' : 'p-2'}>
        {/* ── THE POINT OF THE LIST ────────────────────────────────────
            More of the prompt. In a four-column grid a prompt is cut to 70
            characters and two lines, which is where "the one with the red
            car at sunset" becomes unfindable among forty. A row is wide, so
            it can afford the words. */}
        <p className={`leading-tight text-foreground-secondary
          ${list ? 'text-xs line-clamp-1' : 'text-[11px] line-clamp-2'}`}
        >
          {labelFor(r, list ? 160 : 70)}
        </p>
        {/* Model and length on one line; the REASON it cannot be used on its
            own. They were all three in one flex row, and in a card this narrow
            that squeezed "This generation failed" into unreadable columns —
            "This genera / failed" — which defeats the whole point of keeping a
            failure visible. Found by looking at a screenshot, not by a test. */}
        <p className={`flex flex-wrap items-center gap-x-1.5 text-[10px] text-foreground-muted font-mono
          ${list ? 'mt-0.5' : 'mt-1'}`}
        >
          <span className="truncate">{r.model || 'unknown model'}</span>
          {secs !== null && <span>· {secs}s</span>}
        </p>
        {!use.ok && (
          <p className={`text-[10px] leading-tight text-primary ${list ? '' : 'mt-0.5'}`}
            data-testid={`library-why-${r.id}`}
          >
            {use.label}
          </p>
        )}
      </div>

      {busy && (
        <span className="absolute inset-0 flex items-center justify-center bg-black/60 text-xs text-white">
          <Loader2 className="w-4 h-4 animate-spin mr-1.5" />
          {busy}
        </span>
      )}
      {use.ok && !busy && (
        <span className={`rounded-full bg-primary p-1 transition-opacity
          ${list ? 'shrink-0 mr-1 opacity-0 group-hover:opacity-100'
                 : 'absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100'}`}
        >
          <Plus className="w-3 h-3 text-white" />
        </span>
      )}
    </button>
  );
}

/** Below this the toolbar is furniture — you can see everything at a glance,
 *  and a search box over six items is a control that costs more than it saves. */
const TOOLBAR_FROM = 6;

export default function MediaLibrary({ entity, onAdd, busyId = null, onDragSource, onDragEnd }) {
  const [records, setRecords] = useState(null);   // null = still loading
  const [error, setError] = useState(null);
  const [measuring, setMeasuring] = useState(null);
  const [problem, setProblem] = useState(null);

  const [query, setQuery] = useState('');
  const [model, setModel] = useState(null);
  const [sort, setSort] = useState('newest');
  const [readyOnly, setReadyOnly] = useState(false);
  // Read in the initialiser rather than an effect, so there is no visible jump
  // from the default to the stored value on every mount.
  const [view, setView] = useState(() => {
    try { return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid'; }
    catch { return 'grid'; }            // private mode, or storage disabled
  });
  const chooseView = (next) => {
    setView(next);
    try { localStorage.setItem(VIEW_KEY, next); } catch { /* not worth failing over */ }
  };

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

  const models = modelsPresent(records);
  const shown = filterLibrary(records, { query, model, sort, readyOnly });
  const narrowed = shown.length !== records.length;

  return (
    <div>
      {problem && (
        <p className="mb-2 text-xs text-primary" data-testid="library-problem">⚠ {problem}</p>
      )}

      {/* ── FINDING ONE ────────────────────────────────────────────────────
          Hidden under six generations, because a search box over a list you
          can see in one glance is furniture. It appears when it starts to
          earn its space — the same rule as the project picker's filters. */}
      {records.length >= TOOLBAR_FROM && (
        <div className="mb-2 space-y-1.5" data-testid="library-toolbar">
          <div className="flex items-center gap-1.5">
            <label className="relative flex-1 min-w-0">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-foreground-muted" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search your prompts"
                aria-label="Search your generations"
                data-testid="library-search"
                className="w-full rounded-md border border-border bg-transparent pl-7 pr-6 py-1 text-[11px]
                  text-white placeholder:text-foreground-muted outline-none focus:border-primary"
              />
              {query && (
                <Tip label="Clear the search"><button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="Clear search"
                  data-testid="library-clear"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-foreground-muted hover:text-white"
                ><X className="w-3 h-3" /></button></Tip>
              )}
            </label>

            <Tip label="Change the order"><select
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              aria-label="Sort your generations"
              data-testid="library-sort"
              className="rounded-md border border-border bg-transparent px-1.5 py-1 text-[10px]
                text-foreground-secondary outline-none focus:border-primary"
            >
              {Object.entries(LIBRARY_SORTS).map(([id, { label }]) => (
                <option key={id} value={id} className="bg-background">{label}</option>
              ))}
            </select></Tip>
          </div>

          <div className="flex flex-wrap items-center gap-1">
            {/* Only the models actually present — a chip that can only return
                nothing is a wasted click. */}
            {models.length > 1 && models.map((m) => (
              <Tip key={m} label={model === m ? `Stop filtering by ${m}` : `Show only ${m}`}><button
                type="button"
                onClick={() => setModel(model === m ? null : m)}
                aria-pressed={model === m}
                data-testid={`library-model-${m}`}
                className={`px-1.5 py-0.5 rounded text-[10px] font-mono border transition-colors
                  ${model === m ? 'border-primary text-white bg-primary/15'
                                : 'border-border text-foreground-muted hover:text-foreground-secondary'}`}
              >{m}</button></Tip>
            ))}

            {/* OFF by default on purpose: a failed generation stays visible
                with its reason, because the customer remembers making it. */}
            <Tip label={readyOnly ? 'Show the ones that failed too' : 'Hide anything that cannot be used'}><button
              type="button"
              onClick={() => setReadyOnly((v) => !v)}
              aria-pressed={readyOnly}
              data-testid="library-ready"
              className={`ml-auto px-1.5 py-0.5 rounded text-[10px] border transition-colors
                ${readyOnly ? 'border-primary text-white bg-primary/15'
                            : 'border-border text-foreground-muted hover:text-foreground-secondary'}`}
            >Ready only</button></Tip>

            {/* ── GRID OR LIST ────────────────────────────────────────────
                Not a single toggle button. Two, each showing its own state,
                because a one-button toggle showing the OTHER icon is the
                control everybody reads backwards — you cannot tell whether
                the picture is what you have or what you would get. */}
            <span className="flex items-center rounded border border-border overflow-hidden">
              {[
                ['grid', LayoutGrid, 'Show them as pictures'],
                ['list', List, 'Show them as a list, with more of the prompt'],
              ].map(([id, Icon, hint]) => (
                <Tip key={id} label={hint}><button
                  type="button"
                  onClick={() => chooseView(id)}
                  aria-pressed={view === id}
                  data-testid={`library-view-${id}`}
                  className={`px-1.5 py-1 transition-colors
                    ${view === id ? 'bg-primary/20 text-white' : 'text-foreground-muted hover:text-foreground-secondary'}`}
                ><Icon className="w-3 h-3" /></button></Tip>
              ))}
            </span>
          </div>

          {narrowed && (
            <p className="text-[10px] text-foreground-muted font-mono" data-testid="library-count">
              {shown.length} of {records.length}
            </p>
          )}
        </div>
      )}

      {/* NOT FOUND is not EMPTY. Saying the wrong one sends somebody looking
          for a generation that is sitting right there behind a filter. */}
      {shown.length === 0 && (
        <p className="py-3 text-[11px] text-foreground-muted" data-testid="library-no-matches">
          Nothing matches that.{' '}
          <Tip label="Show every generation again"><button
            type="button"
            onClick={() => { setQuery(''); setModel(null); setReadyOnly(false); }}
            className="underline"
          >Clear the filters</button></Tip>{' '}
          to see all {records.length}.
        </p>
      )}

      <div
        data-testid={`library-${view}`}
        className={view === 'grid'
          ? 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2'
          : 'flex flex-col gap-1'}
      >
        {shown.map((r) => (
          <LibraryItem
            key={r.id}
            record={r}
            view={view}
            busy={busyId === r.id ? 'Adding…' : measuring === r.id ? 'Reading length…' : null}
            onAdd={add}
            onDragSource={onDragSource}
            onDragEnd={onDragEnd}
          />
        ))}
      </div>
    </div>
  );
}
