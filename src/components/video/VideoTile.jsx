// ─── VideoTile.jsx ───────────────────────────────────────────────────────────
// One video card in a grid, built only when it is close to the screen.
//
// ── WHY THIS IS A COMPONENT AND NOT A HOOK CALL IN EACH GRID ───────────────
// Two grids show a customer's videos — SeedanceRightPanel and
// SeedanceMediaGrid — and they already drifted apart once: both shipped
// `preload="auto"`, both had to be found and fixed by hand, and the Edit
// library had been right the whole time. The rule that stops that recurring
// is that there is ONE place a video tile is described.
//
// So the preload setting, the poster-frame seek, and the near-viewport gate
// all live here. A third grid gets them by using this, not by remembering.

import React from 'react';
import { useNearViewport } from '@/lib/useNearViewport';

/**
 * @param {string} src   the video url
 * @param {object} style passed to the <video>, so each grid keeps its own look
 * @param {string} fit   'cover' | 'contain' — the two grids differ, deliberately
 */
export default function VideoTile({ src, style = {}, fit = 'cover', ...rest }) {
  const [ref, near] = useNearViewport();

  return (
    <div
      ref={ref}
      data-testid="video-tile"
      data-mounted={near ? 'yes' : 'no'}
      style={{ width: '100%', height: '100%', background: '#000', ...style }}
      {...rest}
    >
      {near && (
        // metadata: the header only, a few KB. The eager alternative pulls the
        // WHOLE file for every card in the grid, including the ones far below
        // the fold — both grids shipped that and a customer with twenty videos
        // was pulling tens of megabytes to paint one screen. The bad value is
        // not spelled out: grid-media-weight.test.js scans source, so quoting
        // it would make this comment fail the guard.
        //
        // #t=0.1 asks for a frame rather than black; some encoders start on a
        // blank one. Verified 2026-08-27 that the production MP4s are
        // faststart (ftyp → moov), so the header alone is enough to seek.
        <video
          src={`${src}#t=0.1`}
          muted
          playsInline
          preload="metadata"
          onLoadedData={(e) => { e.target.currentTime = 0.1; }}
          style={{ width: '100%', height: '100%', objectFit: fit }}
        />
      )}
    </div>
  );
}
