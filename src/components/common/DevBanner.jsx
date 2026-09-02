// ─── DevBanner.jsx ───────────────────────────────────────────────────────────
// SO DEV IS NEVER MISTAKEN FOR PRODUCTION.
//
// Part of task #44. It earned its place today: in one session we confused the
// two twice — once over the database clusters (dev-db-347887 SOUNDS like dev
// and IS production), and once over which panel a screenshot came from. Both
// were caught. The cost of not catching one is a job run against real
// customers.
//
// ── IT CANNOT APPEAR ON PRODUCTION ─────────────────────────────────────────
// The host list is an ALLOW-list of exact matches, shared with the Edit Cut
// flag via dev-only.js, and it fails towards HIDDEN for every input it does
// not recognise — undefined, null, empty, a lookalike domain.
//
// A deny-list would have been the natural way to write this and is the wrong
// way round: "hide on voxel-ai.ai" shows the banner to every customer the day
// a second production domain exists. This way a new domain gets no banner,
// which is merely unhelpful rather than embarrassing.
//
// ── AND IT PUSHES, IT DOES NOT COVER ───────────────────────────────────────
// It sits in the document flow rather than fixed over the page. Today the
// panel's own Dark / Sign out cluster was position:fixed and spent weeks
// sitting on top of the SOP status labels — the one thing that screen exists
// to show. A warning that hides content is its own small bug.

import React from 'react';
import { devOnlyVisible } from '@/lib/dev-only';

export default function DevBanner({ visible = devOnlyVisible() }) {
  if (!visible) return null;
  return (
    <div
      role="status"
      aria-label="This is the development site, not production"
      style={{
        // In the flow, not over it — see the header comment.
        position: 'relative', zIndex: 1,
        background: 'repeating-linear-gradient(45deg,#7a0a0b,#7a0a0b 10px,#5c0708 10px,#5c0708 20px)',
        color: '#fff', textAlign: 'center',
        padding: '5px 12px', fontSize: 12, fontWeight: 700,
        letterSpacing: '.08em', textTransform: 'uppercase',
        fontFamily: '"DM Sans", system-ui, sans-serif',
        // Hazard stripes read as "not the real thing" at a glance, from across
        // a room, without being read. That is the whole job.
        borderBottom: '1px solid rgba(255,255,255,0.25)',
      }}
    >
      Development site — not production. Nothing here affects customers.
    </div>
  );
}
