// ─── RatioPicker.jsx ─────────────────────────────────────────────────────────
// What shape is the finished video.
//
// ── WHY IT IS HERE AND NOT IN AN EXPORT DIALOG ─────────────────────────────
// "Make it for Reels" is not an export setting. It changes how you frame every
// shot from that moment on. Buried in the export dialog, you discover your
// subject's head is cropped off at the exact moment you are trying to leave.
//
// Next to the viewer, the cropping is visible while there is still time to do
// something about it — which is the entire reason the viewer draws the target
// shape rather than always drawing 16:9.
//
// ── AND WHY CROP vs PAD IS OFFERED RATHER THAN CHOSEN ──────────────────────
// Crop fills the frame and loses the edges. Pad keeps everything and adds
// black bars. Crop is right MORE OFTEN — a landscape shot padded into 9:16 is
// mostly black, and somebody who picked "Reels" wants something that looks
// like a reel. But the trade belongs to the customer, so both are one click
// apart with the consequence named.

import React from 'react';
import { Crop, Maximize } from 'lucide-react';

import { RATIOS } from '@/lib/edit-ops';
import { dimensionsFor } from '@/lib/edit-ffmpeg-args';

const MODES = [
  { id: 'crop', label: 'Fill', icon: Crop, hint: 'Fills the frame — the edges are cut off' },
  { id: 'pad', label: 'Fit', icon: Maximize, hint: 'Keeps everything — adds black bars' },
];

export default function RatioPicker({ ratio = '16:9', mode = 'crop', quality = 1080, onChange }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="flex items-center gap-1" role="group" aria-label="Video shape">
        {Object.entries(RATIOS).map(([id, spec]) => {
          const dim = dimensionsFor(id, quality);
          const active = id === ratio;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onChange?.({ ratio: id, mode })}
              aria-pressed={active}
              data-testid={`ratio-${id}`}
              // The label is what it is FOR, not just the numbers. "9:16" means
              // nothing to somebody who just wants it on Instagram.
              title={`${spec.label}${dim ? ` — ${dim.width}×${dim.height}` : ''}`}
              className={`px-2 py-1 rounded text-[11px] font-mono border transition-colors
                ${active
                  ? 'border-primary text-white bg-primary/15'
                  : 'border-border text-foreground-muted hover:text-foreground-secondary'}`}
            >
              {id}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-1" role="group" aria-label="How to fit">
        {MODES.map(({ id, label, icon: Icon, hint }) => (
          <button
            key={id}
            type="button"
            onClick={() => onChange?.({ ratio, mode: id })}
            aria-pressed={id === mode}
            data-testid={`mode-${id}`}
            title={hint}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] border transition-colors
              ${id === mode
                ? 'border-primary text-white bg-primary/15'
                : 'border-border text-foreground-muted hover:text-foreground-secondary'}`}
          >
            <Icon className="w-3 h-3" /> {label}
          </button>
        ))}
      </div>

      <span className="text-[10px] text-foreground-muted">
        {RATIOS[ratio]?.label}
        {(() => {
          const d = dimensionsFor(ratio, quality);
          return d ? ` · ${d.width}×${d.height}` : '';
        })()}
      </span>
    </div>
  );
}
