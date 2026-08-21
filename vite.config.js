import react from '@vitejs/plugin-react'
import path from 'path'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // ── ffmpeg.wasm MUST NOT BE PRE-BUNDLED ────────────────────────────────
  // @ffmpeg/ffmpeg spawns a Worker with
  //     new Worker(new URL('./worker.js', import.meta.url), {type:'module'})
  // Vite's dependency optimiser rewrites that to
  //     /node_modules/.vite/deps/worker.js?worker_file&type=module
  // which is a 404. The worker never starts.
  //
  // ── AND IT FAILS COMPLETELY SILENTLY ───────────────────────────────────
  // ffmpeg.load() then NEVER RESOLVES AND NEVER REJECTS. No console error, no
  // network error, no exception — the editor just sits there. Found on
  // 2026-08-21 by loading it in a real browser and checking the network log
  // for a request that was never made; reading the code would never have shown
  // it, and no unit test can, because it only happens under Vite's optimiser.
  //
  // Excluding these from optimizeDeps leaves the worker URL alone so it
  // resolves against the real package. loadFFmpeg() also carries a timeout now
  // — see edit-exec-browser.js — because a hang with no error is the one
  // failure mode this codebase treats as a bug in itself.
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
  build: {
    rollupOptions: {
      output: {
        // Split the shared entry chunk so no single JS file exceeds ~250KB
        // (routes are already lazy via pages.config.js). React and
        // framer-motion are the two heavyweights; each caches independently
        // and they download in parallel.
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'motion': ['framer-motion'],
          // recharts only loads with the (lazy) AdminPanel; splitting it
          // keeps every emitted chunk under the 250KB audit threshold.
          'charts': ['recharts'],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    include: ['src/**/*.{test,spec}.{js,jsx}', 'server/src/**/*.test.js'],
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('error', (err, _req, res) => {
            if (!res || res.writableEnded) return;
            if (!res.headersSent) {
              res.writeHead(503, { 'Content-Type': 'application/json' });
            }
            res.end(JSON.stringify({
              error: 'Backend not running on :3001. Run `npm run dev` from the repo root.',
              code: err?.code || 'BACKEND_DOWN',
            }));
          });
        },
      },
    },
  },
})
