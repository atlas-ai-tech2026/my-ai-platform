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

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)
