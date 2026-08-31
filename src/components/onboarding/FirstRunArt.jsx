// ─── FirstRunArt.jsx ─────────────────────────────────────────────────────────
// The picture beside each question.
//
// ── WHY THERE IS A PICTURE AT ALL ──────────────────────────────────────────
// Voxel makes pictures from words, so the first thing a new customer sees does
// exactly that while they answer. Nobody has to be told what the product is:
// they watch it for thirty seconds and then make one themselves on screen 4.
//
// Canvas rather than image files: these are placeholders standing in for real
// Voxel generations, and shipping four large images to make that point would
// cost every new customer a download before they have made anything.
//
// Still under prefers-reduced-motion. An ambient drift is a nice touch and a
// terrible thing to force on somebody who has asked for less movement.

import React, { useEffect, useRef } from 'react';

const PALETTES = {
  dune:    [[248, 178, 92], [214, 108, 66], [122, 58, 58], [40, 22, 28]],
  tide:    [[86, 164, 178], [46, 104, 132], [28, 58, 88], [14, 20, 34]],
  atrium:  [[168, 140, 224], [104, 96, 190], [58, 54, 116], [20, 18, 38]],
  sunrise: [[255, 132, 96], [224, 60, 60], [128, 40, 72], [26, 14, 26]],
};

export default function FirstRunArt({ name = 'dune', caption, tagline = 'Made in Voxel' }) {
  const ref = useRef(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv || typeof cv.getContext !== 'function') return undefined;
    const ctx = cv.getContext('2d');
    if (!ctx) return undefined;

    const pal = PALETTES[name] || PALETTES.dune;
    const reduce = typeof window !== 'undefined' && window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let seed = 0;
    for (let i = 0; i < name.length; i += 1) seed += name.charCodeAt(i) * (i + 7);
    let r = seed * 977 + 13;
    const rnd = () => { r = (r * 1103515245 + 12345) % 2147483648; return r / 2147483648; };
    const blobs = Array.from({ length: 7 }, (_, i) => ({
      x: rnd(), y: rnd(), rad: 0.28 + rnd() * 0.42, c: pal[i % pal.length],
      dx: (rnd() - 0.5) * 0.00013, dy: (rnd() - 0.5) * 0.00010,
    }));

    const size = () => {
      const d = Math.min(window.devicePixelRatio || 1, 2);
      const box = cv.getBoundingClientRect();
      cv.width = Math.max(1, Math.round(box.width * d));
      cv.height = Math.max(1, Math.round(box.height * d));
    };

    const frame = (t) => {
      const w = cv.width; const h = cv.height;
      const deep = pal[pal.length - 1];
      ctx.fillStyle = `rgb(${deep[0]},${deep[1]},${deep[2]})`;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';
      blobs.forEach((b, i) => {
        const x = (b.x + (reduce ? 0 : Math.sin(t * b.dx + i) * 0.08)) * w;
        const y = (b.y + (reduce ? 0 : Math.cos(t * b.dy + i) * 0.06)) * h;
        const rad = b.rad * Math.max(w, h) * 0.62;
        const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
        g.addColorStop(0, `rgba(${b.c[0]},${b.c[1]},${b.c[2]},0.42)`);
        g.addColorStop(1, `rgba(${b.c[0]},${b.c[1]},${b.c[2]},0)`);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
      });
      ctx.globalCompositeOperation = 'source-over';
      // Fine grain, so it reads as a picture rather than a CSS gradient.
      const step = Math.max(2, Math.round(Math.min(w, h) / 260));
      ctx.fillStyle = 'rgba(255,255,255,0.022)';
      for (let gx = 0; gx < w; gx += step * 3) {
        for (let gy = ((gx / (step * 3)) % 2) * step; gy < h; gy += step * 3) {
          ctx.fillRect(gx, gy, step, step);
        }
      }
    };

    size(); frame(0);
    let raf = null;
    if (!reduce) {
      const start = performance.now();
      const loop = (now) => { frame(now - start); raf = requestAnimationFrame(loop); };
      raf = requestAnimationFrame(loop);
    }
    let to = null;
    const onResize = () => { clearTimeout(to); to = setTimeout(() => { size(); frame(0); }, 140); };
    window.addEventListener('resize', onResize);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      clearTimeout(to);
      window.removeEventListener('resize', onResize);
    };
  }, [name]);

  return (
    <div style={{
      position: 'relative', overflow: 'hidden', background: '#0b0b0e',
      borderLeft: '1px solid rgba(255,255,255,0.08)', minHeight: 0,
    }}>
      <canvas ref={ref} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }} />
      <div style={{
        position: 'absolute', inset: 0,
        background: 'linear-gradient(180deg,rgba(8,8,10,.15) 0%,rgba(8,8,10,.55) 62%,rgba(8,8,10,.92) 100%)',
      }} />
      {caption && (
        <div style={{ position: 'absolute', left: 24, right: 24, bottom: 22 }}>
          <div style={{
            fontFamily: '"JetBrains Mono", monospace', fontSize: 9.5, letterSpacing: '0.2em',
            textTransform: 'uppercase', color: 'rgba(255,255,255,0.42)', marginBottom: 7,
          }}>{tagline}</div>
          <div style={{ fontSize: 13.5, lineHeight: 1.5, color: 'rgba(255,255,255,0.9)' }}>{caption}</div>
        </div>
      )}
    </div>
  );
}
