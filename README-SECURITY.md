# Voxel AI — security operations notes

Companion to the 28 Jul 2026 security audit remediation. These are the
things the **code cannot do for you** — infrastructure and process tasks
that must be done in a dashboard or on a server.

---

## 1. The origin firewall must allow Cloudflare only  ⚠️ MANUAL, NOT DONE YET

**Why:** `server/src/client-ip.js` (M2) now trusts `CF-Connecting-IP` only
when the request genuinely arrived through Cloudflare. That stops an
attacker forging their client IP to escape rate limits.

It does **not** stop them reaching the origin at all. Anyone who learns the
DigitalOcean origin address can still connect directly and bypass
Cloudflare's WAF, bot management and DDoS protection entirely — they just
can't lie about who they are any more.

**What to do:** in the DigitalOcean dashboard, restrict inbound traffic to
the app so only Cloudflare's published ranges can reach it.

- Ranges: <https://www.cloudflare.com/ips-v4> and <https://www.cloudflare.com/ips-v6>
- The same list is bundled in `server/src/client-ip.js` (snapshot 2026-08-01)

**Keeping the list current:** Cloudflare changes these ranges rarely (a few
times a decade), but when they do, update BOTH the firewall and the bundled
list:

```bash
curl -s https://www.cloudflare.com/ips-v4
curl -s https://www.cloudflare.com/ips-v6
```

Paste the results into `CLOUDFLARE_IPV4` / `CLOUDFLARE_IPV6` in
`server/src/client-ip.js`. The test `client-ip.test.js` asserts the list
sizes, so a partial paste fails the suite.

**If you add another proxy in front** (a second CDN, a staging tunnel), add
its ranges via the `TRUSTED_PROXY_CIDRS` env var (comma-separated CIDRs)
rather than editing the Cloudflare list.

### How to tell if this is wrong

If rate limiting suddenly throttles unrelated users together, the origin is
probably seeing one shared address — check that traffic really flows through
Cloudflare and that `trust proxy` is still `1` in `server/src/index.js`.
`req.ip` must resolve to a Cloudflare edge address in production.

---

## 2. Rotate the Anthropic API key  ⚠️ MANUAL

The `OCR_LLM_AUTH_TOKEN` secret was reachable by a third-party GitHub Action
that was pinned to a mutable branch (`@main`) until fix H6. Assume it could
have been exposed and rotate it:

Repo → Settings → Secrets and variables → Actions → `OCR_LLM_AUTH_TOKEN`.

---

## 3. Admin two-factor authentication  ⚠️ MANUAL, AFTER DEPLOY

2FA (H5) is implemented but **enforces only once you complete setup**, so
deploying it cannot lock you out. To turn it on:

1. `POST /api/admin/2fa/setup` → returns a secret and an `otpauth://` URI.
2. Scan it with Google Authenticator / Authy / 1Password.
3. `POST /api/admin/2fa/confirm` with the current 6-digit code.
4. **Store the 10 recovery codes in two separate safe places.** They are
   shown exactly once; only their hashes are kept.

**Break-glass** (phone lost *and* recovery codes lost):

```bash
DATABASE_URL='postgresql://...' node scripts/reset-admin-2fa.mjs
```

That script lives in `server/scripts/`, which is **git-ignored on purpose**
(admin recovery tooling must not sit in a public repo). It exists only on
the operator's machine — keep a copy somewhere safe alongside
`fix-admin.mjs`.

---

## 4. Old database backups still contain plaintext passwords  ⚠️ DECISION NEEDED

Fix M1 stopped the admin audit log from recording passwords and scrubbed
existing rows in the live database. **Backups taken before that migration
still contain them**, because a backup is a frozen copy.

Decide one of:

- delete backups older than the M1 deploy, or
- keep them but store them encrypted and access-restricted (see §5), or
- accept the risk knowingly and write down why.

---

## 5. Backups  ⚠️ SEE M3

Covered by fix M3 and documented in `RESTORE.md`. Summary of the manual
parts: create the second-provider bucket, set the env vars listed in
`RESTORE.md`, enable DigitalOcean auto-pay and a billing alert, and delete
the old unencrypted backup from the laptop once the new flow is verified.

---

## Quick reference: what is enforced in code vs. by you

| Control | Enforced by |
|---|---|
| Server computes generation prices | code (C1) |
| Customer spreadsheets can't be committed | code (C2, `.gitignore`) |
| Download proxy restricted to our CDNs | code (H1) |
| Upload/enhance require login | code (H2) |
| Provider calls time out and refund | code (H3) |
| Refunds survive a restart | code (H4) |
| Admin brute-force limit | code (H5) |
| Admin 2FA | code (H5) — **but you must enrol** |
| Non-root containers, pinned CI action | code (H6) — **but rotate the key** |
| Admin session cookie + CSRF | code (H7) |
| Audit log holds no credentials | code (M1) — **old backups still do** |
| Client IP can't be forged | code (M2) — **needs the firewall to matter fully** |
| Offsite encrypted backups | code (M3) — **you must create the account + env vars** |
