# Restoring a Voxel AI backup

**Read this before you need it.** A backup you have never test-restored is
a guess, not a backup.

Added by finding M3 of the 28 Jul 2026 security audit, which found that
every backup lived in the same DigitalOcean account as the database it
protected, and was stored unencrypted.

---

## What a backup is

The automated job (`runAutomatedBackup` in `server/src/index.js`) runs
shortly after boot and every 24h. It dumps every table to gzipped NDJSON,
**encrypts it**, and writes it to **two** places:

| Copy | Where | Purpose |
|---|---|---|
| 1 | DigitalOcean Spaces, `backups/` | fast, same account |
| 2 | A second S3-compatible provider | survives losing the DO account |

File name: `voxel-auto-YYYY-MM-DD.ndjson.gz.enc`
(a file without `.enc` predates encryption, or the passphrase was unset).

Inside, after decrypting and gunzipping, is one JSON object per line:

```json
{"meta":{"exported_at":"…","tables":[…],"version":1,"kind":"auto"}}
{"table":"users","row":{"id":1,"email":"…"}}
{"table":"credits_history","row":{…}}
{"done":true,"counts":{"users":842,…}}
```

---

## Environment variables

Set these in the DigitalOcean App Platform dashboard (Settings → App-Level
Environment Variables). **Mark every one as encrypted.**

| Variable | Example | Notes |
|---|---|---|
| `BACKUP_ENCRYPTION_PASSPHRASE` | a long random string | **Without this, nothing can be decrypted.** Store it somewhere that is NOT the backup buckets — a password manager, and a second copy offline. |
| `OFFSITE_S3_ENDPOINT` | `https://s3.us-west-004.backblazeb2.com` | Backblaze B2, Cloudflare R2, AWS S3 — any S3-compatible service **in a different account/provider from DigitalOcean**. |
| `OFFSITE_S3_REGION` | `us-west-004` | |
| `OFFSITE_S3_BUCKET` | `voxel-offsite-backups` | Create it **private**. |
| `OFFSITE_S3_KEY` | access key id | Give it write-only/limited permissions if the provider supports it. |
| `OFFSITE_S3_SECRET` | secret access key | |
| `OFFSITE_S3_PREFIX` | `backups/` | Optional, defaults to `backups/`. |

Generate a passphrase:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

### Checking it is working

`GET /api/admin/stats` returns an `auto_backup` object:

```json
{ "last_at":"…", "last_key":"backups/voxel-auto-2026-08-01.ndjson.gz.enc",
  "encrypted": true, "offsite_key":"backups/voxel-auto-2026-08-01.ndjson.gz.enc",
  "offsite_error": null, "last_error": null }
```

`encrypted: true` and `offsite_error: null` means both copies exist. If
`offsite_error` is set, **you have only one copy** — the job logs
`[auto-backup] ❌ INCOMPLETE` and records the reason.

---

## Restoring

### 1. Download the archive

From the offsite bucket (or DO Spaces). Any S3 client works:

```bash
aws s3 cp s3://voxel-offsite-backups/backups/voxel-auto-2026-08-01.ndjson.gz.enc . \
  --endpoint-url https://s3.us-west-004.backblazeb2.com
```

### 2. Decrypt and decompress

The format is AES-256-GCM with a scrypt-derived key, written by
`server/src/backup-offsite.js`. Decrypt with the same module — no external
tool needed:

```bash
cd server
BACKUP_ENCRYPTION_PASSPHRASE='…' node -e '
  const fs = require("node:fs");
  const zlib = require("node:zlib");
  import("./src/backup-offsite.js").then(({ decryptBackup }) => {
    const enc = fs.readFileSync(process.argv[1]);
    const gz  = decryptBackup(enc, process.env.BACKUP_ENCRYPTION_PASSPHRASE);
    fs.writeFileSync("restore.ndjson", zlib.gunzipSync(gz));
    console.log("✅ wrote restore.ndjson");
  });
' ../voxel-auto-2026-08-01.ndjson.gz.enc
```

If the passphrase is wrong, or the file was altered in storage, this throws
rather than producing corrupt output — that is the GCM authentication tag
doing its job.

### 3. Inspect before you load anything

```bash
head -1 restore.ndjson | python3 -m json.tool     # the meta line
tail -1 restore.ndjson | python3 -m json.tool     # row counts
grep -c '"table":"users"' restore.ndjson
```

Sanity-check the counts against what you expect. A backup taken during an
incident may itself be missing data.

### 4. Load into a database

**Restore into a NEW empty database first — never straight over production.**
Verify it there, then decide how to move data across.

```bash
# Example: create a scratch DB and load the users table
psql "$SCRATCH_DATABASE_URL" -c 'CREATE TABLE IF NOT EXISTS users_restored (data jsonb);'
grep '"table":"users"' restore.ndjson \
  | python3 -c 'import sys,json;[print(json.dumps(json.loads(l)["row"])) for l in sys.stdin]' \
  | psql "$SCRATCH_DATABASE_URL" -c "COPY users_restored (data) FROM STDIN;"
```

From there, `INSERT … SELECT` the columns you need. The schema is created by
`migrate()` in `server/src/db.js`, so boot the app against the scratch
database once to get the tables, then load rows into them.

### 5. Point the app at the restored database

Change `DATABASE_URL` and redeploy. `migrate()` is idempotent, so it is safe
to run against a restored database.

---

## Test-restore drill (do this once a quarter, ~20 minutes)

1. Download yesterday's offsite archive.
2. Decrypt it (step 2). If this fails, **stop** — your passphrase is wrong
   or lost, and every backup is currently unreadable.
3. Check the row counts in the last line look sane.
4. Load `users` into a scratch database.
5. Write down the date you did this.

Steps 1–3 alone catch almost every real backup failure.

---

## Manual tasks for the operator

- [ ] Create the second-provider account and a **private** bucket.
- [ ] Generate `BACKUP_ENCRYPTION_PASSPHRASE`; store it in **two** places
      that are not the backup buckets.
- [ ] Set all six env vars in the DO dashboard (encrypted).
- [ ] Confirm `auto_backup.offsite_error` is `null` on `/api/admin/stats`.
- [ ] Enable **DigitalOcean auto-pay and a billing alert** — the account
      was terminated for non-payment before, which is precisely the
      scenario the second copy exists for.
- [ ] Once a restore has been verified from the new flow, **delete the old
      unencrypted backup from the laptop.**
- [ ] Decide what to do about pre-M1 backups, which still contain plaintext
      passwords in `admin_audit_log` (see README-SECURITY.md §4).
