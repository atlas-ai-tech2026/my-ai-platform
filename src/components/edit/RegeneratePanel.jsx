// ─── RegeneratePanel.jsx ─────────────────────────────────────────────────────
// Remake one shot without touching the edit around it.
//
// ── WHY THIS IS THE FEATURE NOBODY ELSE CAN COPY ───────────────────────────
// Not because it is clever. Because of what is already on the clip. Every
// other editor's user arrived with a FILE — pixels and a duration. There is
// nothing to regenerate FROM. Voxel's clip knows the words that made it, the
// model that ran it, and the camera it was shot with, so "the same shot, but
// at night" is one field away instead of a new project.
//
// ── THIS SPENDS THE CUSTOMER'S MONEY ───────────────────────────────────────
// Every other operation in Edit Cut is free: cutting, joining, resizing,
// watermarking and music all run locally with no model behind them. This one
// calls a model, so it is the first thing in the editor that costs credits.
//
// That makes three rules non-negotiable here:
//   1. The PRICE IS ON THE BUTTON, before the click, not in a confirmation
//      after it. A cost discovered afterwards is a cost that feels taken.
//   2. If the price cannot be worked out, it says so and still shows the
//      button — refusing to let someone regenerate because our price table is
//      incomplete would be worse than admitting we do not know.
//   3. The ORIGINAL IS KEPT. The remade shot becomes a new source and the
//      clip is repointed; undo brings the first one straight back. Nobody
//      should have to weigh "is it worth the risk" before trying an idea.
//
// The API call itself is injected rather than made here: spending credits
// belongs in one place at the page level, where the polling and the history
// record already live, not spread into a panel.

import Tip from './Tip';
import React, { useEffect, useState } from 'react';
import { Loader2, Sparkles, AlertCircle, RotateCcw } from 'lucide-react';

import { canRegenerate } from '@/lib/media-library';
import { getVideoCredits } from '@/lib/creditPricing';

export default function RegeneratePanel({ clip, source, onRegenerate, busy = false }) {
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);

  // Follow the selection. Without this, selecting a different clip leaves the
  // previous shot's prompt in the box — and regenerating would silently apply
  // the wrong words to the wrong clip.
  useEffect(() => {
    setPrompt(source?.prompt || '');
    setError(null);
    setNote(null);
  }, [clip?.id, source?.prompt]);

  if (!clip) {
    return (
      <p className="text-xs text-foreground-muted">
        Select a clip to remake it.
      </p>
    );
  }
  if (!canRegenerate(source)) {
    // Named precisely, rather than a disabled button with no explanation —
    // and the two causes are DIFFERENT. Saying "no prompt recorded" about a
    // clip that plainly shows its prompt in the viewer would be the kind of
    // small lie that makes someone stop trusting the rest of the screen.
    const why = !source?.prompt
      ? 'has no prompt recorded'
      : 'does not record which model made it';
    return (
      <p className="text-xs text-foreground-muted">
        “{clip.name || 'This clip'}” {why}, so it cannot be remade.
        Clips added from your generations carry both.
      </p>
    );
  }

  const seconds = Math.max(1, Math.round(clip.out - clip.in));
  const credits = getVideoCredits(source.model_id, { duration: seconds }, null);
  const changed = prompt.trim() !== (source.prompt || '').trim();

  async function go() {
    setError(null);
    setNote(null);
    try {
      const result = await onRegenerate({ prompt: prompt.trim(), seconds });
      if (result?.note) setNote(result.note);
    } catch (err) {
      setError(err?.message || 'The shot could not be remade.');
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs text-foreground-secondary truncate">
          {clip.name || 'Selected clip'} · {seconds}s
        </span>
        <span className="text-[10px] font-mono text-foreground-muted">{source.model}</span>
      </div>

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={3}
        aria-label="Prompt for this shot"
        className="w-full rounded border border-border bg-transparent p-2 text-xs text-foreground-secondary"
      />

      {/* The camera settings come along unchanged. Shown because they are the
          reason the remake will match — and because a customer who wants a
          different lens needs to know this is not where they change it. */}
      {(source.camera || source.lens || source.focal_length) && (
        <p className="text-[10px] text-foreground-muted font-mono">
          keeping {[source.camera, source.lens, source.focal_length, source.fstop]
            .filter(Boolean).join(' · ')}
        </p>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <Tip label="Generates a new shot from this prompt — this spends credits"><button
          type="button"
          onClick={go}
          disabled={busy || !prompt.trim()}
          aria-label="Remake this shot"
          data-testid="regenerate-button"
          className="inline-flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 text-xs text-white hover:bg-primary-hover disabled:opacity-40"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          {busy ? 'Remaking…' : 'Remake this shot'}
          {/* Rule 1: the price is ON the button. */}
          {credits !== null && <span className="opacity-80">· {credits} credits</span>}
        </button></Tip>

        {credits === null && (
          <span className="text-[10px] text-foreground-muted">
            Price for this model is not listed — it will be charged at the usual rate.
          </span>
        )}
        {!changed && !busy && (
          <span className="text-[10px] text-foreground-muted">
            Same prompt — this will make a different take of the same shot.
          </span>
        )}
      </div>

      {note && (
        <p className="flex items-start gap-1.5 text-[11px] text-foreground-secondary" data-testid="regenerate-note">
          <RotateCcw className="w-3 h-3 mt-0.5 shrink-0" /> {note} Press undo to put the original back.
        </p>
      )}
      {error && (
        <p className="flex items-start gap-1.5 text-[11px] text-primary" data-testid="regenerate-error">
          <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" /> {error}
        </p>
      )}
    </div>
  );
}
