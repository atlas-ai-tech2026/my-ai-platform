// ─── PresetCards.jsx ─────────────────────────────────────────────────────────
// The on-ramp for somebody who has just been handed a link in a workshop.
//
// ── PLACED ABOVE THE CHAT ON PURPOSE ───────────────────────────────────────
// The assistant is the more powerful tool and the harder one to start with:
// it needs you to know what to ask for, it needs a sign-in, and it needs the
// provider to be up. These four cards need none of that. A beginner should
// meet the thing that always works first.
//
// ── AND WHY A REFUSAL IS A SENTENCE, NOT A GREY BUTTON ─────────────────────
// A disabled card with no explanation is precisely what a beginner cannot get
// past — and they are the entire audience for this. Every card that cannot run
// says why in the same place the customer is already looking.

import { useState } from 'react';
import { Smartphone, Square, Type, Monitor, Check } from 'lucide-react';
import Tip from './Tip';
import { PRESETS, applyPreset } from '@/lib/edit-presets';

const ICON = { reel: Smartphone, square: Square, title: Type, widescreen: Monitor };

export default function PresetCards({ project, onApply, disabled = false }) {
  // Which card refused, and why. Held per-card rather than as one shared
  // message: with four cards a single banner cannot say which one it means.
  const [refused, setRefused] = useState({});
  const [justDid, setJustDid] = useState(null);
  const [said, setSaid] = useState(null);

  const press = (id) => {
    const r = applyPreset(project, id);
    if (!r.ok) {
      setRefused((m) => ({ ...m, [id]: r.reason }));
      return;
    }
    setRefused((m) => ({ ...m, [id]: null }));
    onApply?.(r.project, r.preset);
    // What it actually did, with counts. "Make a Reel" on a five-minute
    // project deletes most of it — correctly — and somebody who does not
    // realise how much went will not know to press ⌘Z.
    setSaid(r.did);
    // A tick for a moment. The timeline changing IS the real feedback, but a
    // ratio change on a short project can look like nothing happened.
    setJustDid(id);
    setTimeout(() => setJustDid((cur) => (cur === id ? null : cur)), 1600);
  };

  return (
    <div data-testid="preset-cards">
      <p className="text-[11px] text-foreground-muted mb-2">
        Or start with one of these — they run instantly, and ⌘Z undoes any of them.
      </p>

      <div className="grid grid-cols-2 gap-1.5">
        {PRESETS.map((p) => {
          const Icon = ICON[p.id] || Square;
          const why = refused[p.id];
          const done = justDid === p.id;
          return (
            <Tip key={p.id} label={`${p.hint} · ${p.steps.join(' · ')}`} fill>
              <button
                type="button"
                disabled={disabled}
                onClick={() => press(p.id)}
                data-testid={`preset-${p.id}`}
                className={`w-full h-full text-left px-2.5 py-2 rounded-lg border transition-colors
                  ${done ? 'border-primary/60 bg-primary/10' : 'border-border hover:border-primary/50 hover:bg-background-elevated'}
                  disabled:opacity-40 disabled:cursor-not-allowed`}
              >
                <span className="flex items-center gap-1.5">
                  {done
                    ? <Check className="w-3.5 h-3.5 text-primary shrink-0" />
                    : <Icon className="w-3.5 h-3.5 text-foreground-muted shrink-0" />}
                  <span className="text-xs text-foreground truncate">{p.label}</span>
                </span>
                {/* The steps, always visible. A preset that does two things
                    should say so before it is pressed, not after. */}
                <span className="block text-[10px] text-foreground-muted mt-0.5 truncate">
                  {p.steps.join(' · ')}
                </span>
              </button>
            </Tip>
          );
        })}
      </div>

      {said && (
        <p data-testid="preset-did" className="mt-1.5 text-[11px] text-foreground-secondary">
          {said} — ⌘Z to undo
        </p>
      )}

      {Object.entries(refused).filter(([, v]) => v).map(([id, reason]) => (
        <p key={id} data-testid={`preset-why-${id}`} className="mt-1.5 text-[11px] text-primary">
          {reason}
        </p>
      ))}
    </div>
  );
}
