import React, { useRef, useEffect } from 'react';

export default function LiquidBackground() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Trail points for liquid drip effect
    const TRAIL_LEN = 28;
    const trail = Array.from({ length: TRAIL_LEN }, () => ({ x: 0.5, y: 0.45 }));

    // Blobs: first 3 follow mouse, rest ambient
    // All blobs fixed at top-center of the box (no mouse following)
    const blobs = [
      { x: 0.82, y: 0.45, tx: 0.82, ty: 0.45, r: 0.38, color: 'rgba(210,0,0,0.85)',   speed: 1 },
      { x: 0.82, y: 0.43, tx: 0.82, ty: 0.43, r: 0.22, color: 'rgba(255,30,30,0.75)', speed: 1 },
      { x: 0.82, y: 0.41, tx: 0.82, ty: 0.41, r: 0.12, color: 'rgba(255,70,70,0.88)', speed: 1 },
      // ambient corners — subtle, static
      { x: 0.25, y: 0.55, tx: 0.25, ty: 0.55, r: 0.18, color: 'rgba(120,0,0,0.35)', speed: 1, ambient: true },
      { x: 0.75, y: 0.55, tx: 0.75, ty: 0.55, r: 0.18, color: 'rgba(120,0,0,0.35)', speed: 1, ambient: true },
    ];

    let frame = 0;

    const resize = () => {
      canvas.width  = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      // seed trail to center
      const cx = canvas.width * 0.5;
      const cy = canvas.height * 0.45;
      trail.forEach(p => { p.x = cx; p.y = cy; });
    };
    resize();
    window.addEventListener('resize', resize);

    const onMove = () => {};
    window.addEventListener('mousemove', onMove);

    const drawBlob = (blob) => {
      const w = canvas.width;
      const h = canvas.height;
      const cx = blob.x * w;
      const cy = blob.y * h;
      const r  = blob.r * Math.max(w, h);

      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      grad.addColorStop(0,   blob.color);
      grad.addColorStop(0.45, blob.color.replace(/[\d.]+\)$/, '0.18)'));
      grad.addColorStop(1,   'rgba(0,0,0,0)');

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(cx, cy, r, r * 0.7, Math.sin(frame * 0.008) * 0.35, 0, Math.PI * 2);
      ctx.fill();
    };

    const drawTrail = () => {
      const w = canvas.width;
      const h = canvas.height;

      for (let i = 0; i < trail.length; i++) {
        const t = 1 - i / trail.length;
        const p = trail[i];
        const r = (0.04 + t * 0.09) * Math.min(w, h);
        const alpha = t * 0.55;

        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        grad.addColorStop(0, `rgba(255,50,50,${alpha * 1.1})`);
        grad.addColorStop(0.5, `rgba(200,0,0,${alpha * 0.45})`);
        grad.addColorStop(1, 'rgba(0,0,0,0)');

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    let raf;
    const render = () => {
      frame++;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // blobs stay fixed at top-center — gentle breathing only
      if (!prefersReducedMotion) {
        blobs[0].ty = 0.45 + Math.sin(frame * 0.008) * 0.015;
        blobs[1].ty = 0.43 + Math.cos(frame * 0.010) * 0.012;
        blobs[2].ty = 0.41 + Math.sin(frame * 0.013) * 0.008;
      }

      blobs.forEach(b => {
        b.x += (b.tx - b.x) * b.speed;
        b.y += (b.ty - b.y) * b.speed;
      });

      // Ambient pass — blurred, large
      ctx.save();
      ctx.filter = 'blur(90px)';
      blobs.forEach(drawBlob);
      ctx.restore();

      // Sharp inner glow
      ctx.save();
      ctx.filter = 'blur(28px)';
      ctx.globalAlpha = 0.75;
      drawBlob(blobs[2]);
      ctx.restore();

      // Fixed hot-spot at top-center
      ctx.save();
      ctx.filter = 'blur(10px)';
      ctx.globalAlpha = 0.9;
      const hx = canvas.width * 0.82;
      const hy = canvas.height * 0.41;
      const hr = 0.06 * Math.min(canvas.width, canvas.height);
      const hg = ctx.createRadialGradient(hx, hy, 0, hx, hy, hr);
      hg.addColorStop(0, 'rgba(255,80,80,0.95)');
      hg.addColorStop(0.5, 'rgba(220,20,20,0.5)');
      hg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = hg;
      ctx.beginPath();
      ctx.arc(hx, hy, hr, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Vignette
      const vw = canvas.width;
      const vh = canvas.height;
      const vg = ctx.createRadialGradient(vw / 2, vh / 2, vh * 0.2, vw / 2, vh / 2, vh * 0.95);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(17,17,17,0.88)');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, vw, vh);

      raf = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMove);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        zIndex: 0,
        background: '#0A0A0A',
      }}
    />
  );
}