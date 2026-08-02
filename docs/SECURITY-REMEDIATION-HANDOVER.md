# Security Remediation — Handover

> **For a new Claude session.** Read this file first, then `README-SECURITY.md`.
> It records exactly where the 28 Jul 2026 security audit remediation stands,
> what is deployed, what is not, and precisely how to continue.
>
> Written 2 Aug 2026. Verified against git and against production at the time
> of writing — every claim here was checked, not assumed.

---

## 1. TL;DR — the state in five lines

- **All 15 audit findings (C1–M6) are fixed and committed.** One commit each.
- **Phases 1 and 2 (C1, C2, H1–H7) are MERGED into `main` and LIVE in production.**
- **Phase 3 (M1–M6) is committed and pushed, but NOT merged and NOT deployed.**
- Phase 3's branch is now **7 commits behind `main`** and **has one merge conflict**
  (trivial — the exact resolution is in §5).
- Test suite: **359 passing**. Production healthy at `https://voxel-ai.ai`.

**The single next action** is §5: merge `main` into the Phase 3 branch, resolve the
one conflict, then let the owner review and deploy.

---

## 2. Where everything lives

| | |
|---|---|
| Repo | `atlas-ai-tech2026/my-ai-platform` — **PUBLIC**. Never commit customer data. |
| Production | `https://voxel-ai.ai`, DigitalOcean App Platform, **auto-deploys on push to `main`** |
| Deploy time | ~3–4 minutes, and it **rolls gradually across replicas** |
| Prod branch | `main` |
| Phase 3 branch | `security-fixes-phase3-audit-2026` (pushed, unmerged) |
| Manual/ops tasks | `README-SECURITY.md` |
| Backup + restore | `RESTORE.md` |
| Known debt | `TECH-DEBT.md` |

### Original audit prompts (the source of the work)

`~/Downloads/voxel-phase1-prompt.md`, `voxel-phase2-prompt.md`,
`voxel-phase3-prompt.md`, plus `Voxel_Remediation_User_Guide_EN.docx`.

---

## 3. Findings status — verified against git

### Phase 1 + 2 — **ON `main`, DEPLOYED, verified in production**

| ID | Commit | What it fixed |
|---|---|---|
| C1 | `a3c1710` | Server computes every generation price. Client `credit_cost` is a display hint only — 409 on mismatch, 400 for unpriced models. New `server/src/pricing.js` + `GET /api/pricing`. |
| C2 | `d3c0acf` | `*.xlsx/*.xls/*.csv` + `reports/` git-ignored; export scripts write to `reports/`. **History scan found no customer file was ever committed.** |
| H1 | `ab525d6` | `/api/download` was an unauthenticated SSRF proxy. Now JWT + host allow-list + DNS private-address rejection on every redirect + size cap + timeout. |
| H2 | `776b544` | `/api/upload` and `/api/enhance-prompt` were unauthenticated. Now JWT + per-user rate limits + magic-byte MIME validation. |
| H3 | `fc4cee7` | No timeout on provider calls. 90s deadline; on expiry aborts and refunds via the existing path. |
| H4 | `f2498ea` | Async video refunds lived in an in-memory Map. Now the `pending_video_charges` table, with boot reconciliation. |
| H5 | `21103d3` | Admin was EXEMPT from brute-force throttling. Exemption removed; TOTP 2FA added. |
| H6 | `ff50cea` | CI action pinned `@main` → commit SHA; `pull_request_target` → `pull_request`; non-root containers. |
| H7 | `ffe2e39` | Admin session → httpOnly cookie + CSRF. API client no longer fakes success on server errors. |

### Phase 3 — **committed, NOT deployed**

| ID | Commit | What it fixes |
|---|---|---|
| M1 | `46b677c` | Admin audit log stored **cleartext passwords**. Per-route field allow-list + redaction sweep + migration scrubbing historical rows. |
| M2 | `944498c` | `CF-Connecting-IP` trusted from any caller. Now only from Cloudflare ranges, with a fail-safe for private peers. |
| M3 | `c45eea3` | Backups only in the same DO account, unencrypted. AES-256-GCM + second S3 provider. |
| M4 | `e59a225` | Two contradictory deploy blueprints. Docker/nginx moved to `local-dev/`. |
| M5 | `de8c99a` | `/api/checkStatus` + `/api/video-status` unauthenticated; bulk provisioning non-transactional. |
| M6 | `5f47f38` | `pg`/`exceljs`/`dotenv` undeclared; `TECH-DEBT.md` added. |

Plus, on the Phase 3 branch only, hardening found during pre-flight review:
**M1's migration would have failed in production** (`payload_summary` is JSONB and
`~*` is a text operator — it aborted the whole migration transaction silently),
and the M5/download ownership checks were **sequential scans** until composite
indexes were added. Both verified against a real Postgres 16 container.

---

## 4. Ground rules (from the owner's audit prompts — still binding)

1. **Never modify the patterns the audit verified correct**: the atomic credit
   charge (`UPDATE users SET credits = credits - cost WHERE credits >= cost AND
   banned = FALSE` inside a transaction with the ledger insert), `WHERE user_id =
   req.user.id` ownership filtering with 404s, the bcrypt cost-12 login flow with
   constant-time dummy hash, parameterized SQL, `FOR UPDATE` redemption locks,
   refunded-flag-before-payout, and charge-before-provider-call ordering.
2. **One commit per finding**, message `fix(M1): …`.
3. **Never push or deploy without the owner asking.** They review and decide.
4. **Never change a price, cost or credit number** without explicit approval.
5. Migrations must be **idempotent and transactional**.
6. Anything else you notice: **list it, don't fix it**.

---

## 5. ▶ THE NEXT ACTION — deploying Phase 3

Phase 3 is 7 commits behind `main` and has **one conflict**. Do this:

```bash
git checkout security-fixes-phase3-audit-2026
git merge main
```

**The only conflict is in `server/src/index.js`, in the TTS charge call.** `main`
has the voice per-1,000-character pricing; Phase 3 has the `clientIp(req)` change.
**Both are wanted.** Resolve to:

```js
      userId: req.user.id, kind: 'audio', ip: clientIp(req), cost: voiceCost,
      note: `audio: TTS (${Math.ceil(text.length / 1000)}k chars)`, provider: 'fal',
```

Then:

```bash
npm test          # expect all green
npm run build
git add -A && git commit
git push origin security-fixes-phase3-audit-2026
```

**Before the owner deploys Phase 3**, they must set the six backup env vars from
`RESTORE.md`, or M3's backup job logs a "only ONE copy exists" error every day.

⚠️ **Phase 3's migration has never run against the real database.** It was verified
against a Postgres 16 container (40/40 statements, idempotent across two runs), but
production holds real data on a dev-tier instance with **no managed backups**. Tell
the owner to take a manual backup first.

---

## 6. Hard-won lessons — read before changing anything

These cost real deploy cycles. Do not relearn them.

1. **Verify user journeys, not just status codes.** Phases 1–2 passed every test
   and still broke uploads and downloads for real users. Tests and `curl` are not
   a substitute for using the product.
2. **Derive allow-lists from real data, not from the code that writes new data.**
   H1's host allow-list was built from the storage module and missed
   `supabase.co` / `media.base44.com`, where older generations actually live.
   Downloads broke twice. The durable fix was per-user **ownership**
   (`userOwnsMediaUrl`) rather than a host list.
3. **`fetch()` on a `data:` URI is blocked by the CSP** (`connect-src 'self' blob:
   https:`) and surfaces as an opaque "Failed to fetch". Decode base64 with
   `atob` instead. **Never "fix" this by loosening the CSP.**
4. **`/api/upload` can return a `data:` URI** when neither Spaces nor FAL storage
   accepts the file. Providers cannot read those and reject with a misleading
   *"Only jpeg/jpg/png image formats are supported"*. Every route that forwards a
   user image to a provider **must** call `resolveReferenceUrls()` first — the
   image route always did; the video routes did not, which is why image
   generation worked and video did not.
5. **Deploy detection: do not trust `/api/health` `started_at`.** Replicas roll
   independently and you will read an old one. Detect a deploy by a **behaviour
   change** (e.g. an endpoint that now returns 401) or by the frontend bundle hash.
6. **jsdom cannot decode images and lacks `URL.createObjectURL`.** Browser image
   code must be verified in a real browser (the Browser pane works).
7. **Rate limiting must key on `req.ip`, not `socket.remoteAddress`.** Production
   is Client → Cloudflare → DO ingress → Node, so the socket peer is the DO load
   balancer. Anchoring there collapses every user into one bucket.

---

## 7. Owner's outstanding manual tasks

Full detail in `README-SECURITY.md`. None of these are code.

- [ ] **Rotate the Anthropic API key** (`OCR_LLM_AUTH_TOKEN`) — it was reachable
      by the unpinned CI action before H6.
- [ ] **Enrol admin 2FA** — deployed but inactive until setup is completed, so the
      deploy could not lock anyone out. `POST /api/admin/2fa/setup` → scan →
      `/confirm`. Store the 10 recovery codes in two places.
- [ ] **Lock the DO origin firewall to Cloudflare ranges only** — M2 stops IP
      forgery; only the firewall stops Cloudflare being bypassed entirely.
- [ ] **Decide on pre-M1 database backups** — they still contain the plaintext
      passwords the migration cannot reach.
- [ ] **Decide on `xlsx`** — used at `src/components/admin/BulkTab.jsx:62`,
      advisories unfixable upstream. ~1–2 h to port to `exceljs`.
- [ ] **Set the six backup env vars** before Phase 3 deploys (`RESTORE.md`).

---

## 8. Work done after the audit (same session, already live)

Not part of the audit, but on `main` and relevant context:

- **Voice was billed a flat 1 credit** regardless of length — a 5,000-character
  take cost $0.50 and earned $0.063 (**−689% margin**). Now billed per 1,000
  characters, pro-rated, 47.4% margin.
- **Gemini Omni** was priced per second; kie bills **per whole video** on a
  base-plus-rate curve, so 4s clips sat at 27.5% margin. Now per (resolution,
  duration) via a new `per-gen` price type.
- **Kling 3.0** sent `mode: 'pro'` for every non-4K request, so 720p silently
  delivered — and paid for — 1080p. Now maps std/pro/4K honestly, and 720p is
  priced against kie ($0.070/s → 2 cr/s).
- **5 models added**: Imagen 4 ×3, Seedream 5 Pro, Gemini Omni. All schemas
  verified against kie's docs.
- **`server/src/model-coverage.test.js`** reads the real UI catalogs and fails if
  any model loses dispatch or a price, or if client and server prices drift.

Pricing rule, unchanged: **basis = MAX(kie, fal) → sale = basis / (1 − 40%) →
credits = CEILING(sale / $0.063333, 0.5)**. Exception, by the owner's decision:
Kling 3.0 is priced against **kie alone**, the supplier it actually runs on.

Current workbook: `reports/Voxel_Plans_and_Credits_V2.0.xlsx` (git-ignored) —
97 rows, worst margin 40.0%.

---

## 9. Quick verification commands

```bash
# Which phases are merged into main?
for b in security-fixes-audit-2026 security-fixes-phase2-audit-2026 security-fixes-phase3-audit-2026; do
  git merge-base --is-ancestor origin/$b origin/main && echo "$b MERGED" || echo "$b NOT merged"
done

# Is every finding committed?
for f in C1 C2 H1 H2 H3 H4 H5 H6 H7 M1 M2 M3 M4 M5 M6; do
  printf "%s %s\n" "$f" "$(git log --all --oneline --grep="fix($f)" -1)"
done

npm test            # expect 359 passing
curl -s https://voxel-ai.ai/api/health
```
