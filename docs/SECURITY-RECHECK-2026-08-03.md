# Security recheck — 3 Aug 2026 (post Phase-3 deploy)

Full re-audit of the codebase after all 15 findings of the 28 Jul 2026 audit
(C1–M6) went live. Four independent reviews — auth/authorization, injection &
data-flow, config/secrets/infra, frontend — with every reported claim
re-verified by reading the code before it was written down here.

**Nothing in this document has been fixed.** It is an assessment.

---

## 1. Comparison with the previous assessment

**All 15 original findings are fixed, committed, on `main`, and live in
production.** Verified commit-by-commit (`git log --grep="fix(C1)"` … `fix(M6)`).

But three of those remediations are **inert in practice** — the server-side
code is correct, and nothing on the client or in the infrastructure ever
completed the other half:

| Original | Code state | Why it does not protect you today |
|---|---|---|
| **H5** — admin 2FA | ✅ correct, RFC-pinned TOTP | **No 2FA UI exists anywhere in `src/`** (verified: zero references). The login form cannot send a TOTP code, and the server's `401 {totp_required:true}` is rendered as "Invalid email or password". Enabling 2FA would lock you out of your own panel, so it stays off → admin is password-only. |
| **H7** — admin token off localStorage | ✅ httpOnly cookie + CSRF implemented | The client still writes the token to `localStorage` (`AdminGuard.jsx:89`, `LoginModal.jsx:98`) and sends it as `Authorization: Bearer`. The server prefers bearer over cookie, and **bearer auth skips CSRF entirely** (`admin-session.js:68`). Both halves of H7 are bypassed by the only client that exists. |
| **M2** — Cloudflare-only IP trust | ✅ CF ranges enforced | The trust anchor is `req.ip`, which is derived from a client-supplied header. Anyone who can reach the DO origin directly can forge it. Only the **origin firewall** closes this — still an unfinished manual task. |

One remediation also **opened a new hole while closing the old one**:

- **H1** (`/api/download` SSRF): the host allow-list was replaced/relaxed by an
  ownership check. But a user can write their own history row with any URL
  (`POST /api/entities/:name` persists arbitrary JSON), so the allow-list is
  self-service bypassable. See finding #4.

**Genuinely solid, re-confirmed:** no SQL injection anywhere (100 %
parameterized; sort/limit whitelisted), no IDOR (every user-data route scopes
`user_id`, 404 not 403), TOTP crypto correct, audit-log redaction correct, no
secrets in the working tree, CI hardened (SHA-pinned, `pull_request`, minimal
permissions), admin cookie flags correct (HttpOnly/Secure/SameSite=Strict),
CORS exact-match with no wildcard, no XSS sink in the entire frontend (zero
`dangerouslySetInnerHTML`/`innerHTML`/`eval`), no command execution surface.

---

## 2. New findings

### HIGH

**N1 — Admin 2FA cannot be used, so the CRM is protected by a password alone.**
No 2FA UI (`src/`: zero hits). Combined with N2, the admin password is the only
control on full customer-data access.
*Fix:* build the TOTP field into the admin login + a setup screen, or accept
password-only and compensate elsewhere.

**N2 — Brute-force throttle is keyed on (IP + email), so rotating IPs defeats
it.** `index.js:3329-3338`. No account-wide counter, no lockout. ~30 admin
guesses per IP per 15 min × unlimited proxies.
*Fix:* add an account-scoped failure counter (all IPs) with a lockout.

**N3 — Admin token in `localStorage`, and bearer auth turns CSRF off.**
Any future XSS or one hostile npm dependency = full admin session, including
`GET /api/admin/backup` (entire database). No XSS sink exists today, which is
the only reason this is not critical.
*Fix:* stop writing the token to `localStorage`; make `/api/admin/*` accept
cookie auth only.

### MEDIUM

**N4 — `/api/download` is an authenticated open proxy.** `POST /api/entities/x
{"result_url":"https://anything"}` then `GET /api/download?url=…` fetches any
public https host through your server (512 MB, 60 s, no rate limit). The DNS
private-address check runs, but validation and the real fetch resolve the name
**separately** — an attacker-controlled zone can rebind between them and reach
internal addresses (metadata service).
*Fix:* restrict ownership matching to rows the server itself wrote, or pin the
validated IP for the actual connection.

**N5 — Per-user model access control is enforced on only 3 of 9 generation
endpoints.** `modelAllowedForUser` is called at `/api/generate`,
`/api/generate-video`, `/api/generate-video-ref` only. Not on
`/api/edit-video-omni`, `/api/motion-control`, `/api/tts`,
`/api/generate-music`, `/api/node/run-node`, `/api/node/run-node-async`.
A bulk-provisioned "image models only" account can spend on all of them.

**N6 — Data-URI reference images skip the upload validator entirely.**
`resolveReferenceUrls` (`index.js:1022-1032`) takes the base64 bytes **and the
MIME string** straight from the request body and writes them to Spaces with
`ACL: 'public-read'`. `validateUpload()` only guards the multipart route.
Any user can host arbitrary content (e.g. `data:text/html;base64,…`) on your
bucket, at your domain, for free.

**N7 — Unauthenticated endpoints that cost money or hold resources.**
- `POST /api/tts/preview` (`index.js:2036`) — no auth; on cache miss it calls
  FAL TTS (billable) with an **unvalidated `voice` string**, so the cache can
  always be missed. Guard is an in-memory Map (30/hr/IP) that is never evicted
  and resets on every deploy.
- `POST /api/check-character-eligibility` (`index.js:2273`) — no auth, no
  limiter, `await sleep(2000)` per call.

**N8 — `adminLimiter` keys on the Cloudflare edge IP and runs before auth.**
It is the only limiter with no `keyGenerator` (`index.js:284`). An
unauthenticated attacker can spend the 60/min bucket and 429 you out of your
own CRM.

**N9 — No session invalidation on password change.** JWTs carry no `jti`/
version and last 7 days; resetting a compromised user's password does not
revoke the attacker's existing token. (Bans *are* enforced live — that part
is correct.)

**N10 — "Character eligibility" is a stub that always approves.**
`index.js:2273-2288` returns `approved: image_url.startsWith('http')`, and the
client fails open. The UI presents it as a moderation control (shield icon,
"Character approved"). This is a compliance-record problem, not a code bug.

### LOW

- **N11** — Registration returns `409 "account already exists"`, enumerating
  accounts; the login route deliberately avoids exactly this.
- **N12** — Banned users can still write entity rows (`/api/entities/*` has
  `verifyJwt` but not `requireNotBanned`) — which is also what feeds N4.
- **N13** — Vulnerable/unused dependencies: `xlsx@0.18.5` (CVE-2023-30533,
  unfixable on npm — admin-only, lazy-loaded), `multer@2.1.1` (DoS, patchable),
  `axios` (prototype-pollution chain, patchable), plus **9 unused production
  deps** including `react-quill` (pins vulnerable quill; not imported).
- **N14** — `ALLOWED_ORIGINS` is **not set in production** (verified against
  the live DO spec), so CORS runs on the code default that also allows
  `http://localhost:5173/8080/3001`.
- **N15** — CSP `connect-src` allows all of `https:` → no exfiltration
  containment if script execution ever happens.
- **N16** — `Voxel_Credit_Calculator.html` is untracked **and not gitignored**
  in a public repo; it contains per-vendor cost and margin formulas. One
  `git add .` publishes your unit economics.
- **N17** — The UI never calls `POST /api/auth/logout`; signing out leaves a
  valid admin cookie for up to 30 minutes on a shared machine.
- **N18** — `.gitignore` says `.claude/` is never committed, but 52 files
  under it are already tracked (nothing sensitive found; the stated invariant
  just isn't true).

---

## 3. Suggested order of work

1. **N2 + N1** — account-wide login lockout, then make 2FA usable. Highest
   real-world risk: full CRM behind one guessable password with a defeatable
   throttle.
2. **N3** — remove the token from `localStorage`; cookie-only admin auth.
   Restores two previous remediations at once.
3. **N4, N6, N7** — close the proxy/upload/free-spend holes.
4. **N5** — apply the model allow-list to the six missing endpoints.
5. **N13, N14, N16** — dependency patches, set `ALLOWED_ORIGINS`, gitignore
   the calculator.
6. Owner manual tasks still open from the original audit: rotate the Anthropic
   API key, lock the DO origin firewall to Cloudflare ranges (this is what
   makes M2 real), decide on pre-M1 backups holding plaintext passwords.
