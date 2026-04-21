# Docker + DigitalOcean Deployment Plan

Canonical migration plan. Update this file as steps complete.

## Target architecture
- **DigitalOcean App Platform** (not a raw Droplet) — push to GitHub, DO rebuilds automatically.
- **Two services** from the same repo: `web` (nginx serving Vite build, reverse-proxying `/api`) and `api` (Node backend).
- **Managed Postgres** for entity storage.
- **Encrypted env vars** in App Platform (`FAL_KEY`, `DATABASE_URL`).

## Why App Platform over Droplet
Solo dev. Zero ops. Build-on-push. SSL handled. ~$12/mo web+api + ~$15/mo Postgres.

## Why not stay with JSON file
Container restarts wipe ephemeral filesystems. Named volumes work single-host only. Real DB is the correct answer for production.

---

## Step 1 — Dockerize (DONE ✅)
Committed in `8e52b0d` on `main`.
- `Dockerfile.api` — `node:20-alpine`, installs `server/` deps, `HEALTHCHECK` hits `/api/health`, volume at `/app/data`.
- `Dockerfile.web` — multi-stage: build Vite → serve via `nginx:1.27-alpine`.
- `nginx.conf` — SPA fallback, gzip, `/api/*` → `http://api:3001`, 300s timeout, 25MB body.
- `docker-compose.yml` — named volume `voxel-data:/app/data` so history survives rebuilds.
- `.dockerignore` — excludes `node_modules`, `.env`, `dist`, `server/data`.

**Verify**: `docker compose up --build` → http://localhost:8080 works end-to-end.

## Step 2 — Postgres migration (NEXT)
**Goal**: replace JSON store with DO Managed Postgres, no API surface changes.

**Tasks**:
1. `npm --prefix server install pg`
2. Add to `server/src/index.js`:
   - `import pg from 'pg'; const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });`
   - Boot-time migration: `CREATE TABLE IF NOT EXISTS entities (name text NOT NULL, id uuid NOT NULL, data jsonb NOT NULL, created_date timestamptz DEFAULT now(), updated_date timestamptz DEFAULT now(), PRIMARY KEY (name, id));`
   - Rewrite the 5 entity handlers (filter/list/create/update/delete) against `pool.query(...)`. Keep response shapes identical so the React client needs zero changes.
3. Delete JSON store code (`loadStore`, `scheduleFlush`, `entityStore` object).
4. Add `DATABASE_URL` to `.env.example` and `docker-compose.yml` (add a local `postgres:16-alpine` service for dev).
5. Regression: generate an image, reload, confirm history + camera metadata survive.

**File**: only `server/src/index.js` + `server/package.json` + `docker-compose.yml` + `.env.example` change.

## Step 3 — DO App Platform spec
**Goal**: `git push` → auto-deploy.

**Tasks**:
1. Create `.do/app.yaml`:
   ```yaml
   name: voxel-ai
   services:
     - name: api
       dockerfile_path: Dockerfile.api
       http_port: 3001
       instance_size_slug: basic-xxs
       routes:
         - path: /api
       envs:
         - key: FAL_KEY
           type: SECRET
         - key: DATABASE_URL
           value: ${db.DATABASE_URL}
       health_check:
         http_path: /api/health
     - name: web
       dockerfile_path: Dockerfile.web
       http_port: 80
       routes:
         - path: /
   databases:
     - name: db
       engine: PG
       version: "16"
       size: db-s-dev-database
   ```
2. In DO dashboard: create app, link GitHub repo + branch `main`, paste `FAL_KEY` as secret.
3. First deploy. Check logs for `[voxel-api] listening on :3001`.

**Note**: `nginx.conf` proxy target `api:3001` works because DO App Platform routes service-to-service traffic by service name.

## Step 4 — Domain + HTTPS
Add domain in DO App Platform → automatic Let's Encrypt cert. Update DNS A/ALIAS records.

## Step 5 (optional) — GitHub Actions pre-deploy check
`.github/workflows/build.yml`: on PR, `docker build -f Dockerfile.api .` and `docker build -f Dockerfile.web .` — fail the PR if either image doesn't build. Cheap insurance before DO tries.

---

## Rollback
Each step is a separate commit. Revert the commit and redeploy. JSON → Postgres migration keeps the JSON file on disk until the next deploy, so rollback is safe within one deploy cycle.
