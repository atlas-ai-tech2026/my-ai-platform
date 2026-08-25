// ─── EditWorkspace.jsx ───────────────────────────────────────────────────────
// The editor a signed-in customer sees at /edit.
//
// ── THE ONE RULE THIS SCREEN ENFORCES VISUALLY ─────────────────────────────
// Every tool here is FREE and carries NO credit badge, because none of them
// calls a model — they are ffmpeg running on the customer's own computer. The
// standing rule agreed with the owner is that a badge means "this spends
// credits" and its absence means "this never will". Phase 1 is entirely
// badge-free, and that is a promise the screen is making, not a coincidence of
// nothing being wired up yet.
//
// ── AND THE ONE IT REFUSES TO BREAK ────────────────────────────────────────
// It never claims a feature it does not have. The page this replaces
// advertised "30+ transitions", "lipsync", "4K export" and "colour grading AI"
// behind a Coming Soon overlay. Shipping a real editor under that copy would
// have made the first honest version look like a downgrade.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Scissors, Crop, Type, Gauge, Download, Loader2, Film, AlertCircle, Check,
} from 'lucide-react';
import { toast } from 'sonner';

import { RATIOS } from '@/lib/edit-ops';
import { buildPlan, describePlan, isEditable, outputName, toClip } from '@/lib/edit-session';
import { runPlan } from '@/lib/edit-exec-browser';

const fmt = (s) => (Number.isFinite(s) ? `${s.toFixed(1)}s` : '—');

/**
 * ── SAMPLES, SO AN EMPTY LIBRARY IS NOT AN EMPTY EDITOR ────────────────────
 * Found on 2026-08-21 the moment the owner tried it: signing in with no
 * finished videos gives a working editor with nothing to edit, which is
 * indistinguishable from a broken page. Every genuinely new customer would hit
 * the same wall on their first visit — the one visit where "this does nothing"
 * is the conclusion they keep.
 *
 * These are clips the site already ships and already serves, so they cost no
 * bandwidth that was not already being spent and add no new asset to maintain.
 * They are labelled SAMPLE and listed after the customer's own work, so nobody
 * mistakes one for something they made.
 */
const SAMPLE_CLIPS = [
  { id: 'sample-seedance', url: '/media/seedance-2-hero.mp4', type: 'video', sample: true,
    prompt: 'Sample · racing car', duration: null },
  { id: 'sample-explore', url: '/media/explore-hero.mp4', type: 'video', sample: true,
    prompt: 'Sample · castle', duration: null },
  { id: 'sample-kling', url: '/media/kling-3-card.mp4', type: 'video', sample: true,
    prompt: 'Sample · Kling clip', duration: null },
];

export default function EditWorkspace({ clips = [], loading = false, error = null, onReload }) {
  const [selected, setSelected] = useState(null);
  const [settings, setSettings] = useState({ ratio: null, speed: 1, text: '', trim: null });
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('');
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);
  const [failure, setFailure] = useState(null);
  const videoRef = useRef(null);

  const mine = useMemo(
    () => clips.filter(isEditable).map(toClip).filter(Boolean).filter((c) => c.type === 'video'),
    [clips],
  );
  // Samples come AFTER the customer's own work and are never mixed into it, so
  // "my videos" always means my videos. They are still offered when the library
  // has clips — trying a tool on a sample before touching real work is a
  // reasonable thing to want.
  const editable = useMemo(() => [...mine, ...SAMPLE_CLIPS], [mine]);

  // Duration is missing on older history rows, so it is read off the element
  // that is already playing the clip rather than trusted from the database.
  const onMeta = useCallback((e) => {
    const d = e.currentTarget.duration;
    if (!Number.isFinite(d)) return;
    setSelected((c) => (c && c.duration == null ? { ...c, duration: d } : c));
    setSettings((s) => (s.trim ? s : { ...s, trim: { start: 0, end: d } }));
  }, []);

  const choose = (clip) => {
    setSelected(clip);
    setSettings({ ratio: null, speed: 1, text: '', trim: clip.duration ? { start: 0, end: clip.duration } : null });
    setResult(null);
    setFailure(null);
  };

  const plan = useMemo(
    () => (selected ? buildPlan(settings, selected) : []),
    [settings, selected],
  );
  const summary = useMemo(() => describePlan(plan), [plan]);

  useEffect(() => () => { if (result?.url) URL.revokeObjectURL(result.url); }, [result]);

  const run = async () => {
    if (!selected || !summary.ready) return;
    setBusy(true); setFailure(null); setResult(null); setProgress(0);
    // Named up front because the first run downloads ~10 MB. A ten-second
    // wait with no explanation reads as the button not working.
    setStage('Starting the editor…');
    try {
      const { blob } = await runPlan(plan, {
        input: selected.url,
        onProgress: (p) => setProgress(Math.round(p * 100)),
        onStep: ({ index, total, label }) => setStage(`${label} — step ${index + 1} of ${total}`),
      });
      setResult({ url: URL.createObjectURL(blob), blob, bytes: blob.size });
      setStage('');
      toast.success('Done — press Download to save it.');
      // Fire-and-forget: the count decides whether Phase 2 is worth building,
      // and a failed count must never break an edit that already worked.
      fetch('/api/edit-events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('voxel_token') || ''}`,
        },
        body: JSON.stringify({ operations: plan.map((o) => o.op), steps: plan.length }),
      }).catch(() => {});
    } catch (err) {
      // The executor already names which step failed and why. Showing that
      // beats a generic toast — the platform's rule is that an error names
      // its cause.
      setFailure(err?.message || 'The edit could not be completed.');
      setStage('');
    } finally {
      setBusy(false);
    }
  };

  const download = () => {
    if (!result) return;
    const a = document.createElement('a');
    a.href = result.url;
    a.download = outputName(selected, settings);
    a.click();
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="border-b border-border bg-background-secondary">
        <div className="max-w-[1600px] mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div>
            <h1 className="font-heading text-2xl tracking-wider text-white">VOXEL EDIT</h1>
            <p className="text-sm text-foreground-secondary">
              Cut, reshape and label your own clips — free, and never charged to your credits.
            </p>
          </div>
          <span className="hidden sm:inline-flex items-center gap-2 text-xs text-foreground-muted
                           border border-border rounded-full px-3 py-1.5">
            <Film className="w-3.5 h-3.5" />
            Runs on your computer — nothing is uploaded
          </span>
        </div>
      </div>

      <div className="max-w-[1600px] mx-auto px-6 py-6 grid grid-cols-1 lg:grid-cols-[260px_1fr_300px] gap-6">
        {/* ── LIBRARY ─────────────────────────────────────────────────── */}
        <aside className="lg:max-h-[calc(100vh-11rem)] lg:overflow-y-auto">
          <h2 className="text-xs font-semibold tracking-widest text-foreground-muted mb-3">
            YOUR LIBRARY
          </h2>

          {loading && (
            <div className="flex items-center gap-2 text-sm text-foreground-secondary py-6">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading your videos…
            </div>
          )}

          {/* A failed load says what failed and offers the retry, rather than
              looking identical to "you have no videos". */}
          {!loading && error && (
            <div className="glass rounded-xl border border-primary/40 p-4 text-sm">
              <div className="flex items-start gap-2 text-primary mb-2">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
              <Button size="sm" variant="outline" onClick={onReload}>Try again</Button>
            </div>
          )}

          {!loading && !error && mine.length === 0 && (
            <div className="glass rounded-xl border border-border p-4 mb-3 text-sm text-foreground-secondary">
              No finished videos of your own yet — generate one on the Video page and it
              will appear here. <span className="text-white">Try the samples below in the meantime.</span>
            </div>
          )}

          <div className="grid grid-cols-2 lg:grid-cols-1 gap-3">
            {editable.map((clip) => (
              <button
                key={clip.id}
                onClick={() => choose(clip)}
                aria-label={clip.prompt || 'Untitled clip'}
                aria-pressed={selected?.id === clip.id}
                className={`text-left rounded-xl overflow-hidden border transition-colors ${
                  selected?.id === clip.id
                    ? 'border-primary border-glow-red'
                    : 'border-border hover:border-primary/50'
                }`}
              >
                <span className="relative block">
                  <video
                    src={clip.url}
                    muted
                    playsInline
                    preload="metadata"
                    className="w-full aspect-video object-cover bg-background-elevated"
                  />
                  {clip.sample && (
                    <span className="absolute top-1.5 right-1.5 rounded bg-background/85 px-1.5 py-0.5
                                     text-[10px] font-semibold tracking-wide text-foreground-secondary">
                      SAMPLE
                    </span>
                  )}
                </span>
                <span className="block px-2.5 py-2 text-xs text-foreground-secondary line-clamp-2">
                  {clip.prompt || 'Untitled'}
                </span>
              </button>
            ))}
          </div>
        </aside>

        {/* ── PREVIEW ─────────────────────────────────────────────────── */}
        <main>
          {!selected ? (
            <div className="glass rounded-2xl border border-border h-[420px] flex items-center
                            justify-center text-foreground-secondary">
              Pick a video from your library to start editing.
            </div>
          ) : (
            <>
              <div className="glass rounded-2xl border border-border p-4">
                <video
                  ref={videoRef}
                  src={result?.url || selected.url}
                  onLoadedMetadata={onMeta}
                  controls
                  loop
                  playsInline
                  className="w-full max-h-[52vh] rounded-xl bg-black"
                />
                {result && (
                  <div className="mt-3 flex items-center gap-2 text-sm text-primary">
                    <Check className="w-4 h-4" />
                    Edited result — {(result.bytes / 1048576).toFixed(1)} MB
                  </div>
                )}
              </div>

              {failure && (
                <div className="mt-4 glass rounded-xl border border-primary/50 p-4 text-sm">
                  <div className="flex items-start gap-2 text-primary">
                    <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>{failure}</span>
                  </div>
                </div>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button
                  onClick={run}
                  disabled={busy || !summary.ready}
                  className="bg-primary hover:bg-primary-hover text-white"
                >
                  {busy
                    ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{stage || 'Working…'}</>
                    : <>Apply {summary.steps > 0 ? `${summary.steps} change${summary.steps === 1 ? '' : 's'}` : ''}</>}
                </Button>

                {result && (
                  <Button variant="outline" onClick={download}>
                    <Download className="w-4 h-4 mr-2" /> Download
                  </Button>
                )}

                {/* The absence of a credit figure IS the message. */}
                <span className="text-sm text-foreground-muted">
                  {summary.empty ? 'Choose a change on the right.' : 'Free — no credits used.'}
                </span>
              </div>

              {busy && progress > 0 && (
                <div className="mt-3 h-1.5 rounded-full bg-background-elevated overflow-hidden">
                  <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
                </div>
              )}
            </>
          )}
        </main>

        {/* ── TOOLS ───────────────────────────────────────────────────── */}
        <aside className="space-y-5">
          <h2 className="text-xs font-semibold tracking-widest text-foreground-muted">
            TOOLS · ALL FREE
          </h2>

          <Tool icon={Scissors} label="Trim">
            {selected?.duration ? (
              <>
                <div className="flex items-center gap-2 text-xs text-foreground-secondary mb-2">
                  <span>{fmt(settings.trim?.start)}</span>
                  <span className="flex-1 text-center">to</span>
                  <span>{fmt(settings.trim?.end)}</span>
                </div>
                <input
                  type="range" min={0} max={selected.duration} step={0.1}
                  value={settings.trim?.start ?? 0}
                  aria-label="Trim start"
                  onChange={(e) => setSettings((s) => ({
                    ...s, trim: { ...s.trim, start: Number(e.target.value) },
                  }))}
                  className="w-full accent-primary"
                />
                <input
                  type="range" min={0} max={selected.duration} step={0.1}
                  value={settings.trim?.end ?? selected.duration}
                  aria-label="Trim end"
                  onChange={(e) => setSettings((s) => ({
                    ...s, trim: { ...s.trim, end: Number(e.target.value) },
                  }))}
                  className="w-full accent-primary"
                />
              </>
            ) : (
              <p className="text-xs text-foreground-muted">Pick a clip first.</p>
            )}
          </Tool>

          <Tool icon={Crop} label="Resize for a platform">
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(RATIOS).map(([key, shape]) => (
                <button
                  key={key}
                  onClick={() => setSettings((s) => ({ ...s, ratio: s.ratio === key ? null : key }))}
                  className={`rounded-lg border px-2 py-2 text-left transition-colors ${
                    settings.ratio === key
                      ? 'border-primary bg-primary/10 text-white'
                      : 'border-border text-foreground-secondary hover:border-primary/50'
                  }`}
                >
                  <span className="block text-sm font-semibold">{key}</span>
                  <span className="block text-[10px] leading-tight">{shape.label}</span>
                </button>
              ))}
            </div>
          </Tool>

          <Tool icon={Type} label="Text">
            <Input
              value={settings.text}
              placeholder="Caption shown on the video"
              onChange={(e) => setSettings((s) => ({ ...s, text: e.target.value }))}
              className="bg-background border-border text-white placeholder:text-foreground-muted"
            />
          </Tool>

          <Tool icon={Gauge} label={`Speed — ${settings.speed}×`}>
            <input
              type="range" min={0.5} max={2} step={0.25}
              value={settings.speed}
              aria-label="Speed"
              onChange={(e) => setSettings((s) => ({ ...s, speed: Number(e.target.value) }))}
              className="w-full accent-primary"
            />
          </Tool>

          {/* Named, not hidden. A customer who expects music should learn here
              that it is coming and that it will cost credits — rather than
              hunting for a button that does not exist. */}
          <p className="text-xs text-foreground-muted leading-relaxed border-t border-border pt-4">
            Coming next: AI music, voice-over, background removal and in-frame AI edits.
            Those call a model, so they will show a credit badge. Everything on this
            panel is free and always will be.
          </p>
        </aside>
      </div>
    </div>
  );
}

function Tool({ icon: Icon, label, children }) {
  return (
    <div className="glass rounded-xl border border-border p-4">
      <div className="flex items-center gap-2 mb-3 text-sm font-medium text-white">
        <Icon className="w-4 h-4 text-primary" />
        {label}
      </div>
      {children}
    </div>
  );
}
