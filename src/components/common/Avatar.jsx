import React, { useMemo } from 'react';

// Deterministic gradient avatar from a name — higgsfield-style colored
// circle with the initial. Shared by the Navbar account menu and the
// Account page (lives here so the Navbar doesn't pull the lazy Account
// chunk — and recharts with it — into the main bundle).
export default function Avatar({ name, size = 40 }) {
  const hue = useMemo(() => {
    let h = 0;
    for (const c of String(name || 'v')) h = (h * 31 + c.charCodeAt(0)) % 360;
    return h;
  }, [name]);
  return (
    <div aria-hidden
      style={{
        width: size, height: size, borderRadius: '50%',
        background: `radial-gradient(circle at 35% 35%, hsl(${hue} 85% 65%), hsl(${(hue + 60) % 360} 70% 40%))`,
      }}
      className="shrink-0 flex items-center justify-center font-bold text-black/70"
    >
      <span style={{ fontSize: size * 0.4 }}>{String(name || '?').charAt(0).toUpperCase()}</span>
    </div>
  );
}
