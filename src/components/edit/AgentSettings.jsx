// ─── AgentSettings.jsx ───────────────────────────────────────────────────────
// The switch that decides whether the assistant may spend money without asking.
//
// This is ChatCut's "Generation Auto-Allow", and it is the most consequential
// control in their whole settings panel — easy to mistake for a preference,
// and it is not one. Everything here is off by default except free editing.
//
// ── WHY EACH ROW SAYS WHAT IT COSTS ────────────────────────────────────────
// "Video generation" reads harmless. "Remaking a shot… spends credits" does
// not. A toggle that hides its consequence behind a category name is a toggle
// people flip without deciding anything, and the bill arrives later.
//
// ── AND WHY THE WARNING ONLY APPEARS WHEN IT IS TRUE ───────────────────────
// A permanent "careful, this can cost money" banner is furniture within a day.
// It shows only once something that bills is actually switched on, which is
// exactly when it means something.

import React, { useEffect, useRef, useState } from 'react';
import { Settings2, AlertTriangle, X } from 'lucide-react';

import { CATEGORIES, CATEGORY_IDS, canSpend } from '@/lib/edit-permissions';
import { METERED } from '@/lib/edit-ops';
import Tip from './Tip';

export default function AgentSettings({ permissions, onChange }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);

  // Click anywhere else to close. Without it the panel covers the transcript
  // and the only way out is finding the same small button again.
  useEffect(() => {
    if (!open) return;
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const spending = canSpend(permissions);

  return (
    <span className="relative" ref={box}>
      <Tip label="What the assistant may do on its own">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label="Assistant settings"
          aria-expanded={open}
          data-testid="agent-settings-open"
          className={`p-1 rounded hover:bg-background-elevated
            ${spending ? 'text-primary' : 'text-foreground-muted hover:text-white'}`}
        >
          <Settings2 className="w-3.5 h-3.5" />
        </button>
      </Tip>

      {open && (
        <div
          data-testid="agent-settings"
          // UPWARD, not down. This button lives with the composer at the
          // BOTTOM of the column, so a panel that drops below it lands off
          // the screen — which is what happened, with every test passing and
          // the DOM perfectly correct. Opening up is always right here
          // because the trigger is always at the bottom.
          className="absolute right-0 bottom-full mb-1 z-50 w-72 rounded-lg border border-border
            bg-background-elevated p-3 shadow-xl space-y-2
            max-h-[70vh] overflow-y-auto"
        >
          <div className="flex items-center gap-2">
            <p className="text-[11px] font-medium uppercase tracking-wider text-foreground-muted">
              The assistant may
            </p>
            <Tip label="Close"><button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close settings"
              data-testid="agent-settings-close"
              className="ml-auto text-foreground-muted hover:text-white"
            ><X className="w-3 h-3" /></button></Tip>
          </div>

          {CATEGORY_IDS.map((id) => {
            const cat = CATEGORIES[id];
            const on = permissions?.[id] === true;
            return (
              <label
                key={id}
                className="flex items-start gap-2 rounded-md p-1.5 hover:bg-background cursor-pointer"
                data-testid={`perm-${id}`}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) => onChange?.({ ...permissions, [id]: e.target.checked })}
                  aria-label={cat.label}
                  data-testid={`perm-input-${id}`}
                  className="mt-0.5 accent-primary"
                />
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-[11px] text-white">
                    {cat.label}
                    {cat.billing === METERED && (
                      <span className="rounded bg-primary/15 px-1 text-[9px] font-mono text-primary">
                        costs credits
                      </span>
                    )}
                  </span>
                  {/* The consequence, in words, next to the switch that causes
                      it — not in a help page nobody opens. */}
                  <span className="block text-[10px] leading-tight text-foreground-muted">{cat.hint}</span>
                </span>
              </label>
            );
          })}

          {spending && (
            <p
              className="flex items-start gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-2 py-1.5
                text-[10px] leading-tight text-foreground-secondary"
              data-testid="spend-warning"
            >
              <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0 text-primary" />
              The assistant can now spend your credits without asking first.
            </p>
          )}
        </div>
      )}
    </span>
  );
}
