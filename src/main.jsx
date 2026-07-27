import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'

// Belt-and-suspenders: if any stale service worker from an earlier build is
// still registered, unregister it so it stops serving cached assets.
// (The kill-switch /sw.js handles tabs the SW currently controls.)
// Lives here instead of inline in index.html so the page needs no inline
// scripts and CSP can stay at script-src 'self'.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations()
    .then((regs) => regs.forEach((r) => r.unregister()))
    .catch(() => {});
}

// A deploy swaps the hashed chunk filenames. A tab that loaded HTML just
// before the deploy (HTML caches ≤60s) will then 404 when lazy-loading a
// route chunk. Vite signals exactly this via 'vite:preloadError' — reload
// once to pick up the fresh HTML + chunk map. The sessionStorage guard
// stops a reload loop if something is genuinely broken.
window.addEventListener('vite:preloadError', (event) => {
  const last = Number(sessionStorage.getItem('voxel_chunk_reload') || 0);
  if (Date.now() - last < 60_000) return; // already tried recently — surface the error
  sessionStorage.setItem('voxel_chunk_reload', String(Date.now()));
  event.preventDefault();
  window.location.reload();
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)
