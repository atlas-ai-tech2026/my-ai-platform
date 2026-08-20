---
name: voxel
description: "VOXEL.AI project rules — READ BEFORE ACTING on this repository, not after. Load for any work on voxel-ai.ai, the control panel, server/src, the SOP tab, backups, storage, Spaces, Backblaze, credits, promo codes, workshops, deployments to DigitalOcean, or anything touching production. Covers: never git add -A · dev before main · verify the EFFECT not the change · never describe state not read this session · build before you delete · count the thing don't trust a flag · secrets never in chat · what is ON HOLD · the environment traps that have already caused outages."
---

# VOXEL.AI — the rules, and what each one cost

This is a live B2B platform with **601 real customers** and money moving through
it. Every rule below exists because something went wrong. The incident is kept
with the rule on purpose: a rule without its reason is one that gets
rationalised away at the moment it matters.

---

## THE TWO THAT CAUSE THE MOST DAMAGE

### 1. Never describe state you have not read in this session

A screen, a number, a row count, a config value, a deployment status. If it has
not been read, run, or queried **in this conversation**, say so: *"I have not
verified this."*

Notes and memory tell you **where to look**. They are never a substitute for
looking.

**What it cost — five wrong statements, one habit:**

| Claimed | Actually |
|---|---|
| The 7 promo codes are the expire list | They were the **keep** list |
| "Read the preview before confirming" | No preview screen exists |
| Described the bulk-expiry control | Never opened the component |
| "Your Cloudflare account" | There is none — inferred from a response header |
| "#55 is parked on the board" | The seed skipped existing rows; it never landed |

### 2. Verify the EFFECT, not the change

Not *"the function is correct"* — *"the value appears where the owner would
look for it."*

**What it cost:** `upsertTask` was tested and correct. The seed skipped existing
rows. Nothing written ever reached the screen, and it was reported as done.

**A passing unit test on the piece you built says nothing about whether anyone
can see the result.**

---

## DESTRUCTIVE ACTIONS

### Build before you delete

**Order is always: build the new → verify it works → then remove the old.**

Never delete-and-see. The owner had to correct this: the first recommendation
for three over-privileged Spaces keys was *"delete one and watch what breaks"*
— on a bucket holding 66 GiB of customer media with no backup at the time.

**The check to run on your own advice:** if this step fails, what is lost, and
can it be put back? If the answer is *"we find out by breaking it"*, the order
is wrong.

Applies to: credentials, database columns and tables, routes, components,
files, buckets, env vars.

---

## GIT

### Never `git add -A`, `git add .`, or `git commit -a`

**Always name the files.**

**What it cost:** on 2026-08-06 it published a file of supplier costs and profit
margins to a **PUBLIC GitHub repository**. Ignore rules only protect branches
that carry them.

### Commit on `dev`. Never on `main`.

Flow: **commit on dev → deploy to dev → verify with real logs → `git merge dev
--ff-only` → push main.**

**What it cost:** four commits to main in a single night, each noticed
afterwards, one requiring an unwind. `.githooks/pre-commit` now refuses it —
but understand the flow rather than relying on the hook.

**Check the branch BEFORE committing, not after.**

---

## SECRETS

- **Never** ask for, accept, or repeat a secret in chat. They go **straight into
  DigitalOcean** and nowhere else.
- **Never** request a screenshot of a screen showing one. Two secrets have
  reached this conversation from terminal scrollback — a backup passphrase and a
  live Spaces key, both of which had to be regenerated.
- Suggest **⌘K** to clear Terminal scrollback before any screenshot.
- DigitalOcean secrets are **write-only**. Nobody can read them back — so
  "which key is this app using?" is unanswerable, and must not be guessed.

---

## ON HOLD — do not build, do not re-propose

- **Email campaigns** — held by the owner. Do not build, do not ask about email
  configuration.
- **2FA reaching production** — ALWAYS ask first, every time.
- **Model prices** — never change an existing price without explicit approval.

---

## STANDARDS FOR ANYTHING IN THE CONTROL PANEL

- Every field gets an **ⓘ tooltip**; every tab gets a description. *(A
  bulk-expiry control was styled so faintly it was reported as missing from
  production. A feature nobody can find is not shipped.)*
- Every addition owes a **Knowledge Base entry in Arabic AND English with
  pictures**, after the build AND confirmation from both sides.
- A line that could not be determined says **"not checked"** — **never green**.
  `unknown` is not `ok`.
- Every SOP line must declare its data source in `sop-sources.js`. The build
  refuses a line reading process memory.

---

## ENVIRONMENT TRAPS THAT HAVE ALREADY CAUSED PROBLEMS

- **`server/.env` on this Mac points at PRODUCTION.** The production database is
  confusingly named `dev-db-347887`. Read-only queries are fine; never run
  migrations or writes from here.
- **Dev has NO offsite storage config.** Deliberate — it was removed so dev
  stopped spending production's Backblaze allowance. So dev cannot test
  anything offsite end-to-end.
- **voxel-ai.ai sits behind DIGITALOCEAN'S Cloudflare, not the owner's.** There
  is no account to log into and no rule to change. That is why #54 exists.
- **`server/scripts/` is gitignored** — this repo is PUBLIC and that folder
  holds admin recovery tooling.
- The **Spaces** client has request timeouts; the **Backblaze** client did not,
  and a stalled upload once silenced the media sync for three hours.

---

## THE PATTERN BEHIND ALMOST EVERY BUG FOUND HERE

> **Something that worked exactly as written and helped nobody.**

A backup never restored. A form that thanked people and dropped their address.
A runtime unpatched 110 days. A column NULL in 3,046 rows. A task board nobody
could write to. A quota check with no timeout. A verification that cried
failure while everything worked.

**None announced itself.** Each was found by deploying, watching, and checking
the thing rather than the note about the thing.

**So: count the thing. Do not trust a flag.** A file in a bucket with a date on
it is evidence. A variable saying it happened is a claim that dies with the
process that made it.

---

## WORKING WITH THE OWNER

- **Never promise work will happen while they are away.** You do not run between
  messages. They once left on that promise and returned to nothing built.
  Estimate the WORK, never the wall clock.
- They are not a programmer. Explain in plain terms, and say what a thing
  *costs* rather than what it *is*.
- **They are usually right when they push back.** Twice in one session they
  caught real errors — a delete-first ordering, and a status screen that was
  lying. Take the objection seriously before defending the work.
- When a mistake has happened **more than twice, stop trying harder and make it
  mechanically impossible** — a hook, a test, a check. Every safeguard here that
  works, works for that reason.

---

## WHERE THINGS ARE

- `server/src/index.js` — all backend routes (~6,500 lines, one file on purpose)
- `server/src/sop-*.js` — the daily operations checks
- `src/pages/AdminPanel.jsx` + `src/components/admin/` — the control panel
- **The Tasks tab in the control panel is the single source of truth** for what
  is outstanding. `server/src/tasks-seed.js` feeds it; it refreshes tasks the
  owner has not touched and never overwrites ones they have.
- `npm test` — 2,000+ tests. Run before every commit.
