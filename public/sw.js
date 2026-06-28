// Kill-switch service worker.
//
// Voxel does NOT use a service worker. But an earlier build (or the original
// app) registered one, and a stale SW keeps serving cached old assets in
// users' browsers — so deployed fixes never appear even after a refresh
// (incognito works because it has no SW). This script replaces any old SW at
// this URL, wipes its caches, unregisters itself, and reloads open tabs so
// the page loads fresh from the network. After that, no SW remains.
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch (e) { /* ignore */ }
    try { await self.registration.unregister(); } catch (e) { /* ignore */ }
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach((c) => c.navigate(c.url));
  })());
});
