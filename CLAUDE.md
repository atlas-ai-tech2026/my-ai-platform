# VOXEL.AI — Claude Handover Doc

> Read this first on any new Claude session. It tells you what this repo is,
> what's done, what's next, and the conventions to respect.

## What this is
Solo-dev AI image + video generation platform.
- **Frontend**: Vite + React 18 + Tailwind + shadcn/ui + framer-motion. Lives in `src/`.
- **Backend**: Express 5 on Node 20, talks to `@fal-ai/client` for FAL models. Lives in `server/src/index.js` (single file, intentional).
- **Storage**: JSON write-through store at `server/data/entities.json` (generation history + metadata). Not in git.
- **Dev**: `npm run dev` from repo root → starts Vite (:5173) + Express (:3001) concurrently with tagged logs.
- **Prod target**: Docker containers on DigitalOcean App Platform (Postgres migration still pending — see below).

## Run it locally
```bash
# Classic dev (hot reload, two processes tagged [web]/[api]):
npm install
npm run dev

# Docker reproduction of prod stack:
export FAL_KEY=sk-...
docker compose up --build
# → web: http://localhost:8080, api: http://localhost:3001
```

## Architecture decisions — don't reverse these without asking
1. **`concurrently` runs both processes** from one `npm run dev`. If `:3001` is down, the Vite proxy returns a `503` with a readable JSON error (`vite.config.js`). Generate clicks now surface `"Backend not running on :3001…"` instead of a generic toast.
2. **Entity store is a debounced JSON file** (`node:fs/promises`, 250ms flush). Path: `server/data/entities.json`. This is transitional — step 2 of the Docker/DO migration swaps this for managed Postgres.
3. **Crash loggers**: `process.on('uncaughtException' | 'unhandledRejection')` in `server/src/index.js`. Silent exits are the enemy.
4. **Camera metadata (`camera`, `lens`, `lens_type`, `focal_length`, `fstop`)** is persisted per-generation in the history entity and rendered in `ImageDetailModal.jsx`.
5. **Camera Motion in Video** is a red-oval chip inside the textarea, not a prompt mutation. Merge happens backend-only at submit (`src/pages/Video.jsx handleGenerate` → `finalPrompt`).
6. **History grid** uses uniform `aspectRatio: 1/1` cells in a CSS grid (`repeat(auto-fill, minmax(220px, 1fr))`). No masonry, no hover-translate. Cards do not move on hover.
7. **Nginx reverse-proxies** `/api/*` in the Docker image — the Vite dev proxy is only for local dev.

## Repo layout
```
src/                     # React app
  pages/                 # Route components (Image.jsx, Video.jsx, Explore.jsx, …)
  components/
    image/               # ImageDetailModal, etc.
    video/               # VideoLeftPanel, VideoModelModal, …
    explore/             # FeatureCardsRow, …
    data/siteData.jsx    # Static content: communityFeed, discover items
  api/base44Client.js    # Axios client pointed at /api
server/
  src/index.js           # All backend routes (generate, generate-video, entities, health, llm)
  package.json
public/media/            # Static assets (seedance-2-hero.mp4, discover-dragon-castle.png, …)
Dockerfile.api           # Node backend image
Dockerfile.web           # Vite → nginx image
nginx.conf               # SPA + /api reverse proxy
docker-compose.yml       # Local prod reproduction
vite.config.js           # Dev proxy with error handler
docs/
  PLAN.md                # Canonical deployment plan
  SESSION-NOTES.md       # Running log of session decisions
```

## What's DONE (as of 2026-04-20)
- [x] Uniform history cards, no hover jitter
- [x] Camera/lens/focal/f-stop persisted and shown in detail modal
- [x] Video camera-motion chip + backend-only prompt merge
- [x] Seedance video in Explore + in Video Model modal
- [x] Dragon-castle image in Discover feed
- [x] Shrunk Seedance video control row (Audio/Res/Duration/Ratio)
- [x] Permanent "backend down" fix (concurrently + proxy 503 + JSON store + crash loggers + `/api/health`)
- [x] **Step 1 of Docker/DO migration**: Dockerfiles, nginx.conf, docker-compose.yml, .dockerignore committed

## What's NEXT
See `docs/PLAN.md` for the full Docker + DigitalOcean plan. Short version:
- [ ] **Step 2 — Postgres migration**: replace JSON store with DO Managed Postgres. Add `pg`, one `entities` table with `(name text, id uuid, data jsonb, created_date, updated_date)`. Ports: POST/PUT/DELETE `/api/entities/:name[/:id]` handlers in `server/src/index.js`.
- [ ] **Step 3 — DO App Platform spec**: add `.do/app.yaml` defining `web` + `api` services + managed Postgres, wire GitHub repo for auto-deploy on push to `main`.
- [ ] **Step 4 — Domain + HTTPS** via App Platform.
- [ ] (Optional) GitHub Actions build check on PR.

## Conventions
- **Never mutate `prompt` textarea state** to inject structured controls (camera motion, ratio, etc.). Merge at the API boundary.
- **Never introduce a new runtime dep** without checking if the stdlib or existing deps solve it.
- **Silent failures are bugs.** Every error path logs with a tag (`[voxel-api]`, `[entity-store]`, `[FATAL]`).
- **`server/src/index.js` stays a single file** until it crosses ~1500 lines or we add auth. The user prefers reading one file.
- **`.env` files never get committed.** Only `.env.example` templates.
- **Camera fields** on history items are always `camera`, `lens`, `lens_type`, `focal_length`, `fstop` (snake_case on the wire, camelCase in React state).
```

## Invariants the user cares about (stated explicitly across sessions)
1. Generate must never fail with a generic toast. Errors must name the root cause.
2. History must survive server restarts — including old camera metadata.
3. History cards must be uniform size and must not move on hover.
4. Dev must be one command.
