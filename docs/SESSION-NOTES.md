# Session Notes

Running log of decisions made with Claude. Newest first. Keep entries short.

---

## 2026-08-01 — Security audit remediation, Phase 2 (H1–H7)

Branch `security-fixes-phase2-audit-2026`, one commit per finding. Phase 1
(C1 server-side pricing, C2 PII gitignore) is on `security-fixes-audit-2026`.
No pricing, cost or credit VALUE was changed in any of these commits.

- **H1** `/api/download` — was an unauthenticated open proxy (SSRF). Now JWT +
  host allow-list + DNS private-address rejection re-checked on each redirect,
  size cap and timeout. New `server/src/download-guard.js`. Frontend downloads
  go through `src/lib/downloadFile.js` (an `<a href>` can't send an auth header).
- **H2** `/api/upload` + `/api/enhance-prompt` — were unauthenticated. Now JWT,
  per-user rate limits, and magic-byte MIME validation (`upload-guard.js`).
- **H3** provider deadline — `fal.subscribe` had no timeout. `provider-deadline.js`
  aborts at 90s (PROVIDER_TIMEOUT_MS) and the route's EXISTING catch refunds.
- **H4** async video refunds — moved from an in-memory Map to the
  `pending_video_charges` table, with boot reconciliation against the provider.
  Exactly-once is now a conditional status UPDATE, not a process-memory flag.
- **H5** admin auth — removed the brute-force EXEMPTION for the admin email
  (now a looser ceiling, not none) and added TOTP 2FA implemented on
  `node:crypto` (RFC 6238, verified against the official RFC test vectors —
  no new dependency, per the CLAUDE.md rule). 2FA enforces only after the
  admin CONFIRMS setup, so deploying it cannot lock anyone out. Break-glass:
  `server/scripts/reset-admin-2fa.mjs` (that folder is gitignored by design —
  the file lives on the operator's machine only).
- **H6** CI + containers — pinned `alibaba/open-code-review` from `@main` to a
  commit SHA and switched `pull_request_target` → `pull_request`; `USER node`
  in Dockerfile.api and unprivileged nginx in Dockerfile.web (both built and
  run to verify). **Rotate the Anthropic API key after this merges.**
- **H7** admin session + honest client errors — see the tradeoff note below.

### H7 tradeoff note: why only the ADMIN session moved to a cookie

The admin JWT now travels in an `httpOnly; Secure; SameSite=Strict` cookie the
page's JavaScript cannot read, so an XSS bug can no longer exfiltrate it.
Because a cookie is sent automatically, state-changing admin routes require a
double-submit CSRF token (`voxel_csrf` cookie echoed in `X-CSRF-Token`);
`admin-session.js` holds that logic and `requireCsrf` sits inside `adminGate`.

**Regular user sessions deliberately stay in localStorage for now.** Moving
them too would mean: every `fetch` in the app switching to
`credentials: 'include'`, CSRF tokens threaded through every write route
(generate, entities, node canvas, redeem), the CORS config and any future
mobile/API client reworked, and a migration path for users mid-session. That
is a broad change across most of the frontend, with a real chance of breaking
generation for everyone — a poor trade during a security remediation whose
whole point is not to break the money path.

The risk accepted meanwhile: an XSS bug could still steal a normal user's
token. The blast radius is one user's own account and credits, versus the
admin token which reads every customer record. Mitigations already in place:
Helmet CSP with `script-src 'self'` (no inline scripts), React's auto-escaping,
and short-lived admin tokens (30m).

**A later migration would be:** issue the user session as a cookie alongside
the bearer token (as done for admin here), move the app's fetch helpers behind
one wrapper that adds `credentials` + CSRF, flip the frontend to cookie-only
once every client is updated, then stop returning the token in the login body.
Roughly a day of work plus a careful deploy — worth doing after the audit
findings are closed and stable.

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
