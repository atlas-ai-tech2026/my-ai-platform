# Session Notes

Running log of decisions made with Claude. Newest first. Keep entries short.

---

## 2026-04-20 — Docker scaffolding + GitHub backup
- User switching from Team plan → individual Max plan. Claude chat history won't carry over.
- Pushed entire repo (133 files, `8e52b0d`) to `atlas-ai-tech2026/my-ai-platform` on `main`.
- Added `CLAUDE.md` (handover doc), `docs/PLAN.md` (canonical migration plan), and this file so the next Claude session can catch up by reading the repo.
- **Deploy target confirmed**: Docker + DigitalOcean App Platform (not raw Droplet).
- **Step 1 DONE**: Dockerfile.api, Dockerfile.web, nginx.conf, docker-compose.yml, .dockerignore.
- **Step 2 NEXT**: Postgres migration — see `docs/PLAN.md`.

## 2026-04-20 — Permanent "backend down" fix
- Root cause of recurring "Generation failed" toasts: backend on :3001 crashes silently, user doesn't notice.
- Fixes landed in `server/src/index.js` + `vite.config.js` + `package.json`:
  - `concurrently` so `npm run dev` starts both processes with tagged logs.
  - Vite proxy `configure` hook returns `503 { error: "Backend not running on :3001…" }` when backend is down.
  - `node:fs/promises` write-through JSON store at `server/data/entities.json` (250ms debounce).
  - `process.on('uncaughtException'|'unhandledRejection')` loggers.
  - `GET /api/health`.
  - Boot log: `[voxel-api] listening on :3001 — FAL_KEY=true, entities=N`.

## 2026-04-19 — UI polish session
- History grid: uniform `aspectRatio: 1/1` cells in CSS grid, not masonry. No hover translate.
- `ImageDetailModal.jsx`: removed bottom thumbnail strip. Right panel 340→290px, paddings/fonts −25%.
- Persisted camera metadata (`camera`, `lens`, `lens_type`, `focal_length`, `fstop`) in `History_.create`.
- Video Model modal: recommended cards 210×110, Seedance 2.0 card plays `/media/seedance-2-hero.mp4` inline.
- Explore `FeatureCardsRow`: Seedance 2.0 card uses same video.
- `siteData.jsx communityFeed[0]`: added Nano Banana Pro dragon-castle image.
- `VideoLeftPanel.jsx`: Camera Motion is a red-oval chip inside textarea, not a prompt mutation. Merge happens backend-only in `Video.jsx handleGenerate`.
- Shrunk the 4-box Video control row (Audio/Res/Duration/Ratio) with `whiteSpace:'nowrap', overflow:'hidden'` so Ratio no longer clips.

---

## How to use this file
When wrapping a Claude session, paste a short bullet list at the top with date + headline + key decisions + affected files. The next session reads the top entry to catch up.
