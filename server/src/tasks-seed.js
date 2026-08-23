// ─── tasks-seed.js ───────────────────────────────────────────────────────────
// Every task and project, seeded so the board starts complete rather than empty.
//
// The owner asked for "all the projects and tasks requested before one or two
// months" — the history, not just what is outstanding. Completed items stay on
// the board (filtered out by default) because "what did we already do?" is a
// real question, and because a board that only shows the backlog makes steady
// progress look like standing still.
//
// Idempotent by `ref`: re-seeding updates in place and never duplicates. Where
// the owner has since changed a status, re-seeding WOULD overwrite it — so the
// seed only ever runs for refs that do not exist yet (see seedTasks below).

export const SEED = [
  // ── DONE, 17–18 August ───────────────────────────────────────────────────
  { ref: '34', owner: 'claude', status: 'done', priority: 1,
    title: 'Prove a backup can actually be restored',
    why: 'Backups ran daily to two encrypted places and nobody had EVER restored one. An untested backup is a hope, discovered on the worst possible day.',
    detail: 'Fetches the offsite archive, decrypts with the passphrase, checks it against the record it wrote about itself, loads rows into a throwaway schema. Monthly, reporting pass AND fail into Alerts. Result on production: restorable.' },
  { ref: '52', owner: 'claude', status: 'done', priority: 2,
    title: 'SOP tab — the daily operations picture',
    why: 'Asked how to check the backup system, the honest answer was "there is no screen". Every check existed; none had a face.',
    detail: 'Today · Structure · Security posture · schedule editor. Green is EARNED: anything not determined says "not checked", never healthy. Every line carries its action and an information dot.' },
  { ref: '33', owner: 'claude', status: 'done', priority: 3,
    title: 'The /edit waitlist threw away every email',
    why: 'The page promised to notify people, validated the address, showed a success message and made NO request. Everyone who ever asked was lost.',
    detail: 'waitlist table, public endpoint, admin view. The success message now appears only if the server stored it.' },
  { ref: '38', owner: 'owner', status: 'done', priority: 4,
    title: 'Set the alerts email address',
    why: 'Alerts were raised perfectly and delivered to an inbox nobody opens.',
    detail: 'Now info@voxel-ai.ai.' },
  { ref: '39', owner: 'owner', status: 'done', priority: 5,
    title: 'Run the bulk account expiry',
    why: '397 accounts sat open-ended from finished workshops, holding ~39,281 credits.',
    detail: 'Result: 398 expired, 194 kept by promo code, 1 admin untouched, until 2026-08-24.' },
  { ref: '51', owner: 'claude', status: 'done', priority: 6,
    title: 'Stop dev spending production’s backup allowance',
    why: 'Dev and production shared one Backblaze account and its caps. If exhausted, production cannot download its own backup — during a restore.',
    detail: 'Offsite config removed from dev; 17 orphaned dev archives deleted; production untouched and still writing both copies.' },
  { ref: 'seedance', owner: 'claude', status: 'done', priority: 7,
    title: 'Add Seedance 2.5 at a measured price',
    why: 'kie publishes no price, so the cost was MEASURED by generating one clip per resolution and reading the balance. fal’s published rate was 33–50% too high.',
    detail: 'Priced at the 40% standard: 4 / 8.5 / 15.5 credits per second. A 5-second 1080p clip fell from 150 to 77.5 credits.' },
  { ref: 'node24', owner: 'claude', status: 'done', priority: 8,
    title: 'Node 20 → 24 (the runtime was end of life)',
    why: 'Node 20 stopped receiving security patches on 2026-04-30. Production ran it unpatched for 110 days and nothing said so.',
    detail: 'Node 24 has support until 2028. A test now fails 120 days BEFORE any future end-of-life date.' },
  { ref: 'spf', owner: 'claude', status: 'done', priority: 9,
    title: 'Fix the SPF record',
    why: 'Every password reset and alert had been FAILING SPF since 11 August — sent via Amazon SES from an address whose SPF authorised only GoDaddy.',
    detail: 'Now authorises Amazon SES and Microsoft 365. Delivered mail was passing on DKIM alone.' },
  { ref: 'session', owner: 'claude', status: 'done', priority: 10,
    title: 'An empty screen said the customer data was gone',
    why: 'A failed request rendered as "this person has never generated anything" — identical to a real empty customer.',
    detail: 'Failures now say what happened. Admin sessions moved from a fixed 30 minutes to 2 hours of INACTIVITY, renewed silently while working.' },

  // ── OWNER, outstanding ───────────────────────────────────────────────────
  { ref: '54', owner: 'owner', status: 'pending', priority: 10,
    title: 'Move DNS to your own Cloudflare account',
    why: 'voxel-ai.ai sits behind DigitalOcean’s Cloudflare, not yours — so there is no WAF or bot management you control.',
    detail: 'Registrar is GoDaddy, not DigitalOcean. 19 records across THREE email systems. Needs a quiet window — a MORNING, not late night: the risk is email, and propagation takes 24–48h. Zone export already sent.' },
  { ref: '55', owner: 'claude', status: 'done', priority: 21,
    title: 'Back up customer media — versioning AND replication to Backblaze',
    why: 'The daily backup covers the database — every generation’s metadata and URL — but NOT the files. 66.1 GiB across 11,320 files exists in exactly one place. Lose the bucket and every customer’s history points at nothing.',
    detail: 'DECIDED 2026-08-19: do BOTH. Costed from the providers’ own pricing pages that day, not from memory. '
      + 'MEASURED: voxel-ai-store is 66.1 GiB / 11,320 items; dev is 71 MiB / 15 items. DigitalOcean’s $5/mo already includes 250 GiB, so storage there costs nothing extra today. '
      + 'VERSIONING — $0, well inside the allowance. Stops an accidental delete or overwrite. Does NOT survive losing the bucket or the account. Must be enabled via the API; the console says so explicitly. '
      + 'BACKBLAZE — $6.95/TB/mo with the first 10 GB free, so 61 billable GB ≈ $0.42/month. Seeding it moves ~71 GB out of DigitalOcean, inside the included 1 TiB transfer, so $0 to start. This is the only option that survives losing the DigitalOcean account entirely. '
      + 'SMALLER THAN IT LOOKED: Backblaze is ALREADY configured and working for the database backups (OFFSITE_S3_*), so this extends something proven rather than building new. About 4 hours. '
      + 'THE NUMBER TO WATCH: growth rate is unknown — 66 GiB accumulated since roughly 2 August. At 250 GiB the Backblaze cost would be about $1.80/month. Worth reporting into the SOP rather than assuming. '
      + 'DONE 2026-08-20. Versioning is on, and the replication FINISHED: 11,372 files / 71.4 GB offsite, with the sync reporting "0 still to copy" and three sampled read-backs verified every fifteen minutes. '
      + 'What is left is not engineering — see #65: the free tier is passed and the account needs a payment method or the copy stops.' },
  { ref: '65', owner: 'owner', status: 'done', priority: 1,
    title: '⚡ Confirm a payment method on Backblaze — the offsite copy stops without one',
    why: 'The media replication finished on 2026-08-20 and pushed the account to 71.4 GB against a 10 GB free tier — 714%. Uploads were still succeeding that afternoon, so either a card is already on file or Backblaze has not enforced yet. Nobody knows which, and the difference decides whether the offsite copy keeps working.',
    detail: 'THE COST IS NOT THE POINT: about $0.43/month at this size. 714% reads like a catastrophe and it is forty-three cents. '
      + 'THE RISK IS: above the free allowance WITHOUT a payment method, uploads fail — and they fail quietly. The first symptom would be a customer noticing broken history weeks later, which is exactly the failure #55 was built to prevent. '
      + 'TWO MINUTES: sign in to Backblaze, check Billing. If a card is on file, nothing to do and the SOP line will simply report the size. If not, add one. '
      + 'The SOP screen now says ALREADY OVER with the monthly cost, instead of telling you to act "BEFORE this is crossed" seven times past crossing. '
      + 'DONE 2026-08-20 — the owner added a card, so Backblaze bills the excess instead of refusing uploads. The offsite copy is now paid for and will keep running. '
      + 'The SOP line stays RED while usage is above the free tier, which is correct: it is reporting a real, billed overage, not a fault. Expect roughly $0.43/month at this size.' },
  { ref: '66', owner: 'claude', status: 'done', priority: 2,
    title: 'Promo codes can be locked to a list of emails, one seat each',
    why: 'A promo code was a bearer token: know the string, spend a seat. These codes are how an organisation’s PAID seats are handed out, so a hundred-use workshop code forwarded into a group chat is spent by a hundred strangers — and the attendees the customer paid for meet "invalid, expired, or already used" during a live session.',
    detail: 'Requested by the owner 2026-08-20: "nobody can use this promo code except these emails, and each email can use it only for one time." '
      + 'BUILT AND ON DEV 2026-08-20, not yet on production. Paste the list or upload a .csv/.txt when creating the code; the redemption limit fills in from the row count so "a hundred emails, a hundred uses" holds by construction. '
      + 'A stranger gets the SAME refusal as every other failure — "you are not on the list" would confirm to whoever holds a leaked code that the code is real and merely mis-addressed. '
      + 'THE HALF THAT EARNS ITS KEEP is the outstanding list: the predictable problem is not fraud, it is being invited as ahmed@company.com and signing up as ahmed.k@gmail.com, which a redemption list can never show. '
      + 'EVERY EXISTING CODE IS UNAFFECTED — no rows means an open code, which is what all of them are. '
      + 'Verified against a real Postgres 17: the gate, the UNIQUE index refusing a second redemption, the case-insensitive tick-off, the outstanding list. Eleven checks. '
      + 'CONFIRMED BY THE OWNER on dev 2026-08-20 and deployed to PRODUCTION the same day. They noted the behaviour correctly themselves: creating the code grants nothing — the credits land when the person redeems, and the redemption then appears in the control panel. '
      + 'STILL OWED: the Knowledge Base entry in Arabic and English with pictures, per the standing rule.' },
  { ref: '67', owner: 'claude', status: 'pending', priority: 19,
    title: 'Credits carry their own expiry — segregate each grant instead of one pooled balance',
    why: 'users.credits is ONE pooled number and users.expires_at is ONE account-level date. So 10 promo credits expiring 1 September and 100 bulk credits expiring 15 September become 110 credits expiring 15 September — the promo silently gets a two-week extension every time that person appears in a later batch. At workshop scale that is real revenue leaking.',
    detail: 'Approved by the owner 2026-08-20 after they described the exact case and asked the right question themselves: how does the system know which credits to spend first? '
      + 'ANSWER, AGREED: soonest-to-expire first. The 10 drain before the 100. The customer gets full value from what they hold instead of watching credits die while a later batch sits untouched, and there are no complaints about credits vanishing. Tie-break on equal dates: oldest grant first. '
      + 'THE MODEL: a credit_lots row per grant, with its own amount and its own expiry. The balance becomes the sum of lots that have not expired. users.credits stays as a cached mirror because a lot of code reads it — with an SOP check that the mirror and the sum of lots always agree, so drift is caught by the screen and not by a customer. '
      + 'ACCOUNT EXPIRY IS SEPARATE and stays extend-if-later: the person must still be able to sign in long enough to spend the credits. The lots decide which CREDITS are alive; expires_at decides whether they can log in. Those work together — an earlier note implying one replaced the other was wrong. '
      + 'HIGHEST-RISK CHANGE ON THIS BOARD: it rewrites the path that moves money — charging, refunds, the video-charge sweeper, the balance display, credit_limit. Refunds are the subtle part: a refund must return to the lot it came from, or it resurrects dead credits or lands in the wrong bucket. '
      + 'ESTIMATE 12-16 hours, dev first, and not to be rushed before a workshop. ACCEPTANCE TEST IS THE OWNER’S OWN EXAMPLE: 10 credits expiring 1 Sept, 100 expiring 15 Sept, spend some, advance past 1 Sept, confirm the 10 are gone and the 100 remain. '
      + 'SUPERSEDES the bulk top-up piece: each bulk grant simply becomes a lot. bulk-provision.js is written but deliberately not wired, so it is not built twice. '
      + 'PARKED 2026-08-20 by the owner, and the right call: the promo email-lock closed a hole that was open THAT DAY, while this fixes a slow leak. Fix the open door before the dripping tap — and rewriting the money path under time pressure near a workshop is how a slow leak becomes an outage. '
      + 'THE ENGINE IS ALREADY BUILT AND COMMITTED: credit-lots.js, 30 tests, the owner’s worked example as the first one, and all four rules proven to fail loudly when broken. Resuming starts from a working core. '
      + 'WHAT REMAINS: the credit_lots table, the backfill of 601 balances, switching charging + refunds + the video-charge sweeper over, the expiry sweep, an SOP check that the balance and the sum of lots always agree, and the breakdown shown to customers and in the CRM. '
      + 'WHILE THIS IS PARKED, BULK STILL ADDS NOTHING TO AN EXISTING USER — it silently skips them. Use Users → grant to top up someone who already has an account.' },
  { ref: '68', owner: 'claude', status: 'done', priority: 4,
    title: 'Access expiry — who loses access and when, and the 30-day credit standard',
    why: 'The owner asked which accounts created 21-23 June would expire, and there was NO WAY TO ANSWER IT: the Users table shows an access column per row and nothing sorts or filters by it, so answering meant scrolling 601 rows. Nothing warned in advance either, so the first sign of an expiry was a customer unable to sign in.',
    detail: 'DONE 2026-08-20, on production. Users tab → Access expiry: who goes on which day, grouped BY DAY because the question is never "when does one person expire", it is "who goes tomorrow, and is that a workshop". Each day expands to names and copies their addresses. '
      + 'WHAT EXPIRY ACTUALLY DOES, read from both enforcement points: login is refused, NOTHING is deleted, and clearing the date restores access with the same balance. A lock on the door, not a demolition — and that clause sits under the headline because someone reading "12 accounts expire tomorrow" needs it more than any number. '
      + 'THE 30-DAY STANDARD (owner, 2026-08-20): a manual grant now leaves 30 days behind, never shortening what someone already has. Until then a manual grant touched credits and credit_limit and NOTHING else, so hand-granted credits had no expiry at all. Promo codes keep their own access_days; bulk keeps its batch date. '
      + 'EXPIRING CREDITS PAST 30 DAYS is built and is the owner’s to run: preview, a checkbox naming the exact accounts and credits, then the button. Nothing fires on deploy or on a schedule, and if the list changes while it is being read the run refuses. Every removal writes a ledger row. '
      + 'I RECOMMENDED AGAINST taking the credits — a locked-out account cannot spend, and the balance is the record of what a paying customer received. The owner decided otherwise having read that, so it is built in full. '
      + 'The clock starts at the LATER of joining or the last credits granted, so someone topped up recently is not swept up.' },
  { ref: '50', owner: 'owner', status: 'pending', priority: 4,
    title: 'Second copy of the backup passphrase',
    why: 'Saved in the Mac Passwords app. If the laptop and DigitalOcean are lost together, every backup becomes permanently unreadable.',
    detail: 'Needs one copy somewhere that is not this Mac. Never share the value with me.' 
      + 'TOOL BUILT 2026-08-21, local-only at server/scripts/check-passphrase.mjs (server/scripts is gitignored — the repo is public and this is an admin recovery script). It tests a CANDIDATE passphrase against a real archive and answers yes or no. A wrong passphrase cannot decrypt: AES-GCM fails its authentication tag, so there is no nearly-right and no false positive. HOW: download any file under backups/ ending .ndjson.gz.enc from Spaces or Backblaze, then `node server/scripts/check-passphrase.mjs <file>`. It prompts hidden, prints nothing, writes nothing, touches no network or database. It refuses the passphrase as a command-line argument — that would land in shell history and in ps. ITS FIRST VERSION PRINTED THE PASSPHRASE ON SCREEN, caught by running it and grepping the output rather than by reading it. WHERE THE OWNER GOT TO: found Backblaze keys (voxel-backup-writer, -writer-3) in screenshots, which are NOT the passphrase — those are bucket logins and are safely rotatable. Found a candidate in a note on 2026-08-21, still to be tested. IF IT IS NEVER FOUND: backups keep working (the running server holds it), but a rebuild from scratch would make every existing archive permanently unreadable. The fallback is a NEW passphrase stored properly, accepting that older archives go with the old one.' },
  { ref: '37', owner: 'owner', status: 'blocked', priority: 5,
    blocked_by: 'The registered legal entity name, licence number and address',
    title: 'Answer the legal document questions',
    why: 'Three B2B documents are drafted and NOTHING is published. Without the entity, the Terms name no party.',
    detail: 'Plus 8 smaller answers: under-18 workshops, payment terms, liability floor, per-attendee reporting, credits at expiry, dispute windows, backup provider, five Kuwait-specific questions for a lawyer.' },
  { ref: '31', owner: 'owner', status: 'blocked', priority: 7,
    blocked_by: 'Naming the 2–3 editing behaviours that matter',
    title: 'Project A — conversational video editing',
    why: 'Not ten features. The two or three things that make an attendee say "this is better than what I had".',
    detail: 'Recommendation: ORCHESTRATE models, do not build a renderer. /api/edit-video-omni already works, is deployed and charged for, and nothing on the site surfaces it. A renderer is a second product, months, against a funded competitor.' },
  { ref: '40', owner: 'owner', status: 'pending', priority: 6,
    title: 'Return the supplier costs spreadsheet',
    why: 'Of 82 active models, 32 have no cost. Until then P&L margins are computed over partial data.',
    detail: '28 need a number only you can get. Sent 16 August.' },
  { ref: '41', owner: 'owner', status: 'done', priority: 9,
    title: 'Switch on Microsoft sign-in for production',
    why: 'The code was live since 2026-08-11; the button stayed hidden for eleven days because ONE environment variable was absent.',
    detail: 'DONE 2026-08-23, confirmed by the owner signing in with a real Microsoft account on production. '
      + 'THE TRAP THAT NEARLY COST A ROUND TRIP: dev and production SHARE one Azure app registration (e10ee86c-…) but need DIFFERENT redirect URIs — dev.voxel-ai.ai and voxel-ai.ai. Azure showed "1 web" redirect, and the one registered was dev’s. My first draft of the steps said "confirm the URI is listed"; the honest step was ADD IT. Without that the sign-in fails AADSTS50011 after everything else looks correct. '
      + 'The existing Azure secret was left alone deliberately — it is dev’s, and deleting it would have broken dev sign-in. A second secret was created for production. '
      + 'STILL OPEN, SEPARATELY: the app is multitenant ("All Microsoft account users") and Azure warns that end users cannot consent to an unverified publisher. Personal accounts and this tenant are fine; a customer signing in with a WORK account from their own company may hit "needs admin approval". That is publisher verification (an MPN ID) and it is not this task. '
      + 'DEV CLEANUP: MICROSOFT_CLIENT_SECRET is listed TWICE on voxel-app-dev. Both are encrypted now, so the original "saved unencrypted" problem is gone — what remains is a duplicate key with nothing defining which one wins. Delete both, add one back. Needs a secret VALUE in hand, so do it while one is available.' },
  { ref: '42', owner: 'owner', status: 'pending', priority: 2,
    title: 'Four small security items from the July audit',
    why: 'Each is a decision waiting on you rather than a code change.',
    detail: 'Rotate the Anthropic API key · the Cloudflare origin (now #54) · decide on pre-M1 backups that still hold scrubbed plaintext passwords · decide on the xlsx dependency.' },
  { ref: '26', owner: 'owner', status: 'blocked', priority: 11,
    blocked_by: 'You are holding it until the panel is improved',
    title: '2FA enrolment',
    why: 'The panel shows a typed setup key and no QR code — deliberate, because a bundled QR library would be needed under the content security policy.',
    detail: 'Standing rule: I ask before ANY 2FA change reaches production.' },

  // ── MINE, outstanding, priority order ────────────────────────────────────
  { ref: '29', owner: 'claude', status: 'done', priority: 40,
    title: 'Record which model each video used, then show honest timings',
    why: 'The column existed and 3,046 rows were ALL NULL, so "which model is fastest" had no answer — the question your clients actually asked.',
    detail: 'DONE 2026-08-19. The label now comes back from chargeCredits() — the one function that already knows it — so the ledger, the telemetry and the video charge agree by construction instead of by ten call sites remembering. '
      + 'A SECOND silent NULL was found while tracing it: every generation made from the Node canvas stored no label at all and was invisible to both the Reliability and the Speed screens. '
      + 'The failure REASON is recorded too, so an exact verdict can still tell a bad model apart from our own supplier balance being empty. '
      + 'NOTE: this records from the deploy forward — it does not backfill. Models flip from "inferred" to "measured" one at a time as real generations accumulate, and each row says which it is. '
      + 'Measured before: 184s typical, 301s for one in ten; load barely matters (181s quiet vs 190s busy) — it is the model, not the platform.' },
  { ref: '60', owner: 'owner', status: 'pending', priority: 3,
    title: 'Was the backup passphrase from 18 August ever replaced?',
    why: 'It was generated in Terminal, accidentally screenshotted the same day, and I asked for a fresh one before it was saved. The ORIGINAL value is still sitting in the terminal scrollback and appeared in a second screenshot on 19 August. Nobody can check which one is live — DigitalOcean stores it write-only.',
    detail: 'NOT urgent, and not a hole on its own. That passphrase decrypts the database backups, but an attacker also needs the backup FILES, which sit in Backblaze behind separate credentials. It is a second lock, not the only one. ' 
      + 'ANSWERABLE WITHOUT ANYONE REMEMBERING, built 2026-08-21: POST /api/admin/backup/passphrase-check runs the existing restore verification against the OLDEST archive instead of the newest. If the current passphrase opens the oldest archive, it has not changed since that archive was written. If it fails, it has — and everything older is unreadable. LIVE ON PRODUCTION and gated; it still needs a BUTTON on the SOP screen, about 20 minutes, or it is a capability nobody can reach.'
      + 'THE QUESTION: when it was saved into DigitalOcean, was it the value from the screenshot or a freshly generated one? If fresh, the visible string is meaningless and this task closes. '
      + 'IF UNSURE, TREAT AS EXPOSED AND ROTATE — but plan it, because rotation has a real catch: every EXISTING backup stays encrypted with the OLD passphrase. Discarding it makes every archive taken before the change permanently unreadable. So the old value must be archived alongside the new one, with the cutover date recorded, and the restore verification (#34) run afterwards to prove the new one actually works. '
      + 'Related habit worth keeping: press Cmd+K in Terminal before screenshotting. Two secrets have reached a screenshot from old scrollback this month.' },
  { ref: '69', owner: 'claude', status: 'pending', priority: 12,
    title: 'Point-in-time recovery is UNTESTED — and long-term archive does not exist',
    why: 'These were inside #55 and went with it when I closed that task for the media replication. The word PITR appears nowhere on this board as a result. Work disappearing because a wider task was closed around it is the precise thing this board exists to stop, and it happened anyway.',
    detail: 'TWO SEPARATE GAPS, both real. '
      + 'PITR: DigitalOcean managed Postgres keeps write-ahead logs, so the database can be restored to ANY MOMENT, not just the 05:26 snapshot. That answers "somebody deleted the wrong thing at 14:32" in a way no daily backup can — and the daily dump cannot answer it at all, because it would lose everything after the morning. '
      + 'It has NEVER BEEN TESTED. An untested recovery path is not a recovery path; it is a belief. This platform ran a daily backup for MONTHS before anyone tried restoring one, and #34 exists because that attempt was the first proof it worked. Same lesson, different mechanism. '
      + 'TEST SAFELY: restore to a NEW database from a point in time, confirm a known row is present at that moment and absent before it, then destroy the copy. Never restore over production to test a restore. '
      + 'LONG-TERM ARCHIVE: retention is 30 days offsite and 60 days primary. Nothing survives a year. For a B2B business that is the gap that bites in a dispute — an organisation asking what their attendees generated last quarter, after the archives holding it have rolled off. Monthly archives kept for a year cost almost nothing at this size. '
      + 'ESTIMATE: 2 hours for the PITR test, 2 hours for monthly archiving.' },
  { ref: '59', owner: 'claude', status: 'done', priority: 12,
    title: 'NEW TAB — Expenses: what this business actually costs per month',
    why: 'Requested 2026-08-19. Costs are spread across DigitalOcean, GoDaddy, Microsoft 365, Backblaze, Claude, FAL and kie, and nowhere adds them up. Without the total there is no break-even figure, so nobody can say whether a workshop was profitable.',
    detail: 'THE DESIGN POINT: do NOT ask for FAL and kie by hand. Every generation already records fal_cost and kie_credits in credits_history, so those are MEASURED. Manual entry would be work that is instantly stale and less accurate than what we already hold. '
      + 'FIXED (entered once, with renewal dates): DigitalOcean App Platform x2, Managed Postgres, Spaces, GoDaddy domain, Microsoft 365, Resend, Backblaze, Claude. '
      + 'VARIABLE (measured): FAL and kie, from the ledger. '
      + 'THE OWNER FORGOT FOUR, and one is probably the largest: FAL pay-per-generation was not on their list at all. Also Microsoft 365 (separate from the GoDaddy bill), Resend, and the entire DEV environment — a second app and a second database. '
      + 'RENEWAL DATES ARE THE DANGEROUS PART: if voxel-ai.ai lapses the site AND every email address stop, including the one used for password resets. Warn at 60, 30 and 7 days, same discipline as the storage quota (#58) — before, not on expiry. '
      + 'THEN THE NUMBER THAT MATTERS: break-even. Fixed costs divided by margin per subscription = how many customers cover the overheads. Small addition once the fixed costs exist, and it is the figure that makes a workshop quotable. '
      + 'DECIDED 2026-08-19 by the owner: currency is USD throughout · entries are dated by the INVOICE DATE received, so months line up with reality rather than with when someone typed them · Claude IS included at $100/month, in its own category, because the question being answered is what the BUSINESS costs to run, not just the platform · and expenses must be freely addable as monthly, annual OR one-time. '
      + 'Cancelled entries are marked, never deleted — a cost that disappears from history makes last quarter look wrong. '
      + 'Owes a Knowledge Base entry in Arabic and English once built and confirmed, per the standing rule.' },
  { ref: '64', owner: 'claude', status: 'done', priority: 22,
    title: 'NEW TAB — Audience: who reaches the site, and how long they stay',
    why: 'Requested 2026-08-20. The Users tab shows people who signed up. Nothing shows the far larger number who ARRIVE — so there is no way to tell whether a workshop announcement brought traffic, or how many visitors produce one subscription.',
    detail: 'SPLIT IN TWO, because one half we are best placed to build and the other we would build badly. '
      + 'OURS — page views counted SERVER-SIDE from Express. Exact, not sampled; immune to ad-blockers, which hide a real share of visitors from every script-based tool; no cookie banner, no CSP change, no third party holding visitor data; and history for as long as we want. Per-path views, unique-ish visitors by hashed IP per day, and referrer so you can see where people came from. About 5-6 hours. '
      + 'THEIRS — Microsoft Clarity for the click question. Free forever, no traffic limits, and does exactly what was asked: "where they click, scroll and drop off", plus session recordings. Building heatmaps and session replay ourselves would be weeks and worse than a free tool. ~15 minutes to add. '
      + 'REJECTED — Cloudflare Web Analytics. Free and cookie-free, but its own dashboard says stats are "based on a 10% sample of page load events" and it keeps 30 days. A 10% sample extrapolated is not an answer to "how many people reached my site". '
      + 'DECIDE BEFORE #37: Clarity is a third-party script, so it needs a CSP entry AND a line in the privacy policy. Far better to settle that before the legal documents are published than to amend them after. '
      + 'COUNTRY: available from Clarity, and also free from Cloudflare’s CF-IPCountry header once #54 is done — one more thing that task unblocks. '
      + 'THE NAME is "Audience", not "Analysis" or "Visitors". There is already a Users tab and that means ACCOUNTS; Audience means everyone who reaches the site, signed in or not — which is exactly the distinction the owner drew by saying "not subscribe". "Traffic" is the plainer alternative but implies arrivals only, not time spent. '
      + 'TIME ON SITE, added 2026-08-20, and it splits the same way. '
      + 'SIGNED-IN USERS: buildable TODAY from data already held. Every generation is timestamped in generation_events, so first action to last action gives an ACTIVE session length per person per day. For a workshop that is the number that matters — "they were working for 40 minutes" — and it needs no new tracking whatsoever. '
      + 'DONE 2026-08-20, on production, and confirmed working by the owner in the control panel. '
      + 'Customers → Audience. Arrivals counted server-side (crawlers excluded, the control panel excluded, self-referrals not counted as a source); signups, people-per-day and session lengths rebuilt from ledger dates going back to the first customer. '
      + 'EACH BLOCK STATES ITS OWN PROVENANCE — visits start the day tracking began and earlier days are UNKNOWN, not zero; account history is real and needed no new tracking. Without that line an empty stretch reads as "nobody came" when it means "nobody was counting". '
      + 'Microsoft Clarity is LIVE for clicks, scroll and replays (project y5h0454pmv) and NEVER loads on the control panel — a session replay there would send 601 customers’ emails, balances and revenue to a third party as video. Took three CSP fixes, every one of which looked like a working install from the server side. '
      + 'Stored as daily totals, not one row per hit, on a 10 GiB disk that stops accepting writes when full. Visitor hash re-salted daily: no cookie, no consent banner, useless tomorrow. '
      + 'STILL OWED: the Clarity line in the privacy policy BEFORE #37 publishes, and the Knowledge Base entry in Arabic and English. '
      + 'ANONYMOUS VISITORS: the server genuinely CANNOT see this. Someone reading the pricing page for ten minutes without clicking sends the server nothing at all, so time-on-page is measurable only from the browser. Clarity already measures it; a heartbeat script of our own would cost ~2 hours and be blocked by exactly the same ad-blockers, so it would be a second script doing the same job less well. Recommend letting Clarity answer this alongside the click question rather than building a worse duplicate.' },
  { ref: '62', owner: 'claude', status: 'done', priority: 14,
    title: 'A git hook that makes committing to main impossible, not merely discouraged',
    why: 'I committed to main instead of dev FOUR times on 19 August. Every time I noticed afterwards; once it had to be unwound. Our own rule is dev first, verify, then merge — and I broke it four times in one night while writing rules about discipline.',
    detail: 'PRIORITISED 2026-08-20 by the owner, ahead of the Expenses tab, and rightly. A hook removes a failure I have demonstrably repeated; a promise to remember does not. '
      + 'A pre-commit hook refusing any commit whose branch is main, with a documented override for the deliberate case. Set up via .claude/settings.json or .git/hooks — settings.json is preferable because it is version-controlled and survives a fresh clone. '
      + 'THE PRINCIPLE, worth stating because it applies beyond git: when a mistake has happened more than twice, stop trying harder and make it mechanically impossible. Everything else on this board that works — the branch checks, the lint sweep, the source registry — works for that reason. '
      + 'DONE 2026-08-20. .githooks/pre-commit refuses any commit on main or master. PROVEN by attempting a real commit — refused, and git log confirmed none was created. '
      + 'THE CORRECT FLOW IS UNAFFECTED, verified separately: committing on dev works, and `git merge dev --ff-only` into main creates NO commit so the hook never fires. No false positives by design. '
      + 'ALLOW_MAIN_COMMIT=1 is the deliberate exception — a guard with no way out gets disabled entirely the first time someone genuinely needs past it. A detached HEAD (rebase, bisect, cherry-pick) is left alone. '
      + 'THE GAP THAT WOULD HAVE MADE IT USELESS: a hook file does nothing until core.hooksPath points at it, so a fresh clone would have had it sitting there inert while looking protected. npm install now sets it via postinstall, and a test FAILS if it is not switched on. A safeguard nobody has enabled is the same as no safeguard.' },
  { ref: '63', owner: 'claude', status: 'done', priority: 15,
    title: 'A VOXEL skill, so the project’s rules load BEFORE I act rather than after',
    why: 'The owner asked which skills would make me perform better. The honest answer was that none of the generic ones would have prevented a single error from 19 August — those were attention and verification, not knowledge. What WOULD help is this project’s own hard-won rules arriving before I start, not sitting in a file I may or may not consult.',
    detail: 'PRIORITISED 2026-08-20 at the owner’s request. Encodes what is already written in CLAUDE.md and memory: never git add -A (it published the cost file to a PUBLIC repo) · dev before main · verify the EFFECT, not the change · build before you delete · count the thing, do not trust a flag · never describe state not read in this session · never promise work while the owner is away. '
      + 'DELIBERATELY NOT a generic security/backend/UX skill — those are already installed and would not have caught the versioning permission error, the sync copying database backups, or the verification crying false failure. Each of those needed either careful reading or knowledge of THIS codebase. '
      + 'The rules exist; the gap is that they are read after a mistake rather than before an action. '
      + 'DONE 2026-08-20 — .claude/skills/voxel/SKILL.md, registered and loading. Each rule carries the INCIDENT that produced it, because a rule without its cost is one that gets argued away at the moment it matters. '
      + 'GUARDED BY A TEST, so the document cannot quietly lose a rule the first time one is inconvenient: 20 checks over the frontmatter, every incident-bought rule, what is ON HOLD, and the four environment traps. '
      + 'THE TEST WAS WRONG FIRST, and the way it was caught is the point: removing a rule did NOT fail it, because the patterns were matching the frontmatter description — which lists every rule by name. The entire body could have been deleted and it would still have passed. A test that matches its own table of contents is not checking the book. Now reads the body only, and verified by deleting a rule and watching two tests fail.' },
  { ref: '61', owner: 'claude', status: 'done', priority: 17,
    title: 'Every SOP line must declare where its facts come from',
    why: 'The owner, 2026-08-20: "When you said you build it and it is working fine, I must believe you. But now after this has happened, we need to verify everything in SOP, and this is wasting of time." They were right. Once ONE line has lied, my word that the others are fine is worth nothing — it is the same word I gave about the broken one.',
    detail: 'DONE 2026-08-20. The Daily backup line read a module-level object that every restart wipes, so it reported "not checked" while backups ran perfectly. '
      + 'THE AUDIT: every other line was traced. All read the database, the buckets, live API calls, the source files, or the environment. autoBackupStatus was the ONLY in-memory source in the whole tab, and it is now fixed — so the rest did NOT need re-verifying. '
      + 'THE STRUCTURAL FIX, so this is a check and not a promise: sop-sources.js declares the source of every line, and the test suite refuses any line reading process memory, or any NEW line that forgets to declare at all. Verified by breaking it both ways — an undeclared line fails 2 tests, an in-memory source fails 3. '
      + 'THE CHECK HAD ITS OWN BLIND SPOT: the first extractor missed four integrity lines emitted through a local helper rather than a literal key. Caught by the orphan test, fixed, and a canary added so the blind spot is detectable rather than silent. '
      + 'ONE HONEST EXCEPTION: the "open security items" under Posture are a hand-maintained list. That is a RECORD, not a check — it can show a false red if something is fixed and nobody edits it. It cannot show a false green, which is the only reason it is allowed, and it must say so in its own declaration.' },
  { ref: '58', owner: 'claude', status: 'done', priority: 20,
    title: 'SOP — daily storage check that warns BEFORE a limit is crossed',
    why: 'Asked for on 2026-08-19: "tell me I will start or become to exceed the limit to start, make a subscription for them." Not "you are over" — "you are ABOUT to be over." A quota found by exceeding it is an outage; found 40 days out it is a diary entry.',
    detail: 'DONE 2026-08-19. Measures BOTH providers daily and reports a RATE and a DATE, never just a percentage — 83% could be six days away or six months. '
      + 'DigitalOcean Spaces: 250 GiB included in the $5/month plan, then $0.02/GiB. Going over bills automatically, so it is money, not an outage. '
      + 'BACKBLAZE IS THE ONE THAT CAN STOP: 10 GB free, and above that WITHOUT a payment method the uploads simply fail. Its line says so, and says to add the card BEFORE the crossing. '
      + 'REFUSES TO GUESS: no projection until three daily readings spanning at least a day exist — one reading is a number, not a trend, and a confident wrong date is worse than "still learning" because someone can act on it. '
      + 'A bucket it cannot read, or a count it had to truncate, reports UNKNOWN and never OK. '
      + 'The measurement paginates: storage.js listKeys() caps at 1000 objects, which would have reported 8% of an 11,320-object bucket as its total.' },
  { ref: '57', owner: 'owner', status: 'done', priority: 1,
    title: 'Tidy up — production has two storage keys where one is needed',
    why: 'Not a risk, just untidy. Both are scoped to voxel-ai-store with readwrite, so neither can reach anything else. But nobody can tell which one production actually uses, and an unknown is worth removing before it is inherited by someone else.',
    detail: 'DONE 2026-08-19 in the same session: three access keys with FULL ACCESS TO EVERY BUCKET — 16 days old, one of them exposed in a screenshot — were replaced with scoped keys and deleted. Production verified re-hosting images AND video (992-1589ms) throughout. '
      + 'CHECK THIS ON OR AFTER 21 AUGUST 2026. The owner is confident voxel-prod-storage-2 is the unused one — they never pasted its secret — and asked to wait 24-48 hours before acting. That wait is worth it for a real reason: a DAILY job that touches Spaces (the nightly backup upload) will have run by then, so anything intermittent depending on that key surfaces. Five minutes would not have shown it. '
      + 'THE TEST, 2 minutes: delete voxel-prod-storage-2 (id DO801FBDRAPP47T4Y6N9), then generate ONE image on voxel-ai.ai. The log should say "[storage] re-hosted image in NNNms". If instead it says "re-host failed", that key WAS live — create a new one, update SPACES_KEY and SPACES_SECRET, done in ten minutes. Nothing is lost either way: existing files are untouched and served by public URL. '
      + 'CLOSED 2026-08-23. The owner had ALREADY deleted voxel-prod-storage-2 and said so. Verified with `doctl spaces keys list`: exactly two keys remain — voxel-dev-storage (voxel-ai-store-dev) and voxel-prod-storage (voxel-ai-store). The acceptance test ran itself: the SOP’s System smoke checks read 5/5 passing INCLUDING Storage, against the surviving key, minutes after the deletion. I told the owner to perform this check anyway, having read this task’s detail text — written 2026-08-19, describing the state THEN — and repeated it as current without running the one-second command that would have shown otherwise. Worse than a stale note: it sent them to delete a key that no longer existed. This does NOT break the build-before-delete rule. The replacement (voxel-prod-storage) is already live and proven; -2 is a leftover from a failed attempt, and removing it is the cleanup step of that rule, not an exception to it. '
      + 'I CANNOT REMIND YOU — I do not run between conversations. This board is the reminder, which is exactly why the date is written here and not left in a chat. '
      + 'STILL UNVERIFIED: the dev key (voxel-dev-storage). Dev control panel -> SOP -> Check now -> the Storage line makes a real authenticated call and will say "reachable" or fail. Dev only, no customer impact either way.' },
  { ref: '56', owner: 'claude', status: 'done', priority: 39,
    title: 'Hardening pass — stop the same class of mistake recurring',
    why: 'The owner asked on 2026-08-19 why there is always some mistake. Two different things were happening: OLD bugs surfacing because we finally started looking (good), and a repeated habit of mine — describing state I had not actually read (five times, one cause).',
    detail: 'DONE 2026-08-19. TWO new automated checks: (1) columns that must be written, measured over a rolling 7-day window — the existing check only found columns empty in EVERY row, so the Node canvas bug hid behind a column that was 60% full; '
      + '(2) a JSX-parsing sweep so no table anywhere can hide a column — it found the Account page forcing the whole screen sideways on a phone, and the Pricing table squashing instead of scrolling. '
      + 'TWO rules written into CLAUDE.md, because no check catches them: never describe state not read in this session, and verify the EFFECT not the change. '
      + 'Deliberately NOT a one-time audit — a snapshot does not stop recurrence, and the weekly structure check had ALREADY found model_label and been ignored. The follow-through was the gap, not the checking.' },
  { ref: '47', owner: 'claude', status: 'in_progress', priority: 17,
    title: 'STANDING RULE — an information dot on every field, a description on every tab',
    why: 'The bulk-expiry control was styled so faintly it was reported as missing from production. A feature nobody can find is not shipped.',
    detail: 'Applied as each thing is built, never as a later pass. The InfoDot component now exists so every new tab gets it free.' },
  { ref: '17', owner: 'claude', status: 'pending', priority: 15,
    title: 'Provider webhooks — one job, three problems',
    why: 'Ends the stuck-charge cause permanently, gives customers "your video is ready", and is the prerequisite for mobile push.',
    detail: 'Fixes RELIABILITY, not speed. The 1,393 timeouts are a waiting problem; this makes the waiting reliable, not shorter.' },
  { ref: '30', owner: 'claude', status: 'blocked', priority: 26,
    blocked_by: 'Ships in the same push as the legal documents (#37)',
    title: 'Fix the site’s contradictions with the legal documents',
    why: 'Publishing "there are no subscriptions" while a logged-in attendee sees a $19/month plan makes the contradiction the evidence.',
    detail: 'Account page shows a $19/month plan with dead buttons; Community advertises a $500 contest with no rules; stripe-js is installed with zero imports.' },
  { ref: '35', owner: 'claude', status: 'done', priority: 16,
    title: 'Weekly checks — run the security review, new vulnerabilities, database growth',
    why: 'Ten advisories were accepted deliberately and nothing would report an eleventh. On 18 August there were 11, ALL with fixes available. And the security-review tool has existed all along, barely used — a capability nobody runs is the same as one nobody has.',
    detail: 'Alert on what CHANGED, never on "advisories exist" — otherwise it trains dismissal and the real one gets dismissed too. '
      + 'RAISED TO PRIORITY 2026-08-20 at the owner’s request, ahead of the Expenses tab: the weekly security review goes into the SOP schedule beside the structure check, so it runs on a cadence instead of when someone remembers. '
      + 'Also covers the 18 items from the July audit and the four still open (#42) — a review that only ever looks at new code never re-checks what was accepted as fine a year ago. '
      + 'DONE 2026-08-20, on production. The audit runs WEEKLY with the structure checks instead of on every page load, and the screen shows the stored result with the date it was really taken. '
      + 'Database size, growth rate and the five biggest tables are measured daily from the server — the only place that can, since the database accepts trusted sources only. '
      + 'Verified in the production log, not inferred: "dependency audit: warn · first check — 11 advisories found, none reviewed yet · 4 in production dependencies".' },
  { ref: '36', owner: 'claude', status: 'pending', priority: 13,
    title: 'Pre-workshop pre-flight card',
    why: 'This is exactly what failed on 8 August: 415 generations failed mid-workshop from an empty supplier account, every one auto-refunded so nothing flagged it.',
    detail: 'Four live values on one screen: alerts green? · supplier balance with DAYS OF RUNWAY · has any model gone bad? · does this cohort’s access cover today? The one checklist that stays human.' },
  { ref: '49', owner: 'claude', status: 'in_progress', priority: 18,
    title: 'This tab — every task and project, visible',
    why: 'You had to ask me what was pending, every time, and the answer came from a file only I could read.',
    detail: 'Now the single source of truth. I keep it current as part of doing the work.' },
  { ref: '44', owner: 'claude', status: 'pending', priority: 16,
    title: 'The small batch',
    why: 'None are big; several remove a recurring annoyance.',
    detail: 'A DEV banner so dev is never mistaken for production · a FAL dashboard · the duplicate-charge counter on Alerts · point my local environment away from production · tighten DMARC · rename the workshop-shaped labels now the customer is a company.' },
  { ref: '19', owner: 'claude', status: 'pending', priority: 22,
    title: 'Tech debt from the audit',
    why: 'Both were flagged in July and both keep growing.',
    detail: 'Split index.js (~6,400 lines against a 1,500 threshold) · a retention policy for the entities table (33 MB and rising).' },
  { ref: '45', owner: 'claude', status: 'pending', priority: 23,
    title: 'Make the generation wait productive',
    why: 'Images are already fine — this is a VIDEO problem, 184s typical.',
    detail: 'Prompt coaching FIRST (days, no per-generation cost, and it compounds). Then an instant preview: a still in ~8 seconds turns a blind 3-minute wait into feedback. Room feed last, blocked on a privacy decision. None of it makes generation faster.' },
  { ref: '46', owner: 'claude', status: 'pending', priority: 24,
    title: 'B2B pipeline — proposal → PO → subscription → invoice',
    why: 'Today the whole B2B motion is manual and lives on your computer; the system only joins in when credits are hand-added.',
    detail: 'ONE pipeline with #24. Forces the company entity into existence, which is also what unblocks per-company usage reports. Needs NO payment gateway — organisations are invoiced.' },
  { ref: '53', owner: 'claude', status: 'pending', priority: 25,
    title: 'React 18 → 19',
    why: 'A PROJECT, not maintenance. React 18 is NOT end of life — a newer major existing is novelty, not risk.',
    detail: 'Must never become a recurring alert. Confirm framer-motion, shadcn/ui and React Flow compatibility BEFORE starting.' },
  { ref: '48', owner: 'claude', status: 'pending', priority: 21,
    title: 'Knowledge Base tab — how to use everything, Arabic and English',
    why: 'Anyone opening the control panel should find the answer in one place.',
    detail: 'LAST by your instruction, because it documents a panel still changing. But the RULE starts now: every addition gets a guide, in both languages, with pictures, after both sides confirm. Already owed: SOP tab, waitlist, schedule editor, the information dots.' },
  { ref: '32', owner: 'claude', status: 'blocked', priority: 29,
    blocked_by: 'The payment gateway — a developer who finds VOXEL cannot become a customer',
    title: 'Project B — MCP server for Claude, Cursor, ChatGPT, Gemini',
    why: 'Technically the cheapest thing on the roadmap — days — because VOXEL is already an API.',
    detail: 'But credits arrive only by redeeming a code or an admin grant. It would generate interest that cannot convert: a marketing asset, not a revenue one.' },
  { ref: '43', owner: 'claude', status: 'blocked', priority: 27,
    blocked_by: 'Its push half depends on provider webhooks (#17)',
    title: 'Mobile — a progressive web app, not native apps',
    why: 'One codebase, no app store review, no second release process for a solo developer.' },
  { ref: '24', owner: 'claude', status: 'blocked', priority: 28,
    blocked_by: 'Held by you until the Tier work is done; design together with #46',
    title: 'Generate invoices from the system, not by hand',
    why: 'The back half of the same pipeline as #46. Built separately, the company entity gets built twice.' },
  // ── SEPARATE PENDING ITEMS I had folded into others — the owner was right
  //    to push: a task merged into another is a task that stops being tracked.
  { ref: '18', owner: 'claude', status: 'pending', priority: 14,
    title: 'Video charge fix-forward — the stuck-charge sweeper',
    why: 'Customers charged for a video that never arrived. 124 accumulated unnoticed before anything watched for them.',
    detail: 'Related to #17 but not the same work: webhooks stop NEW ones happening; this is the reconciler and the backfill for those already stuck.' },
  { ref: '20', owner: 'claude', status: 'pending', priority: 20,
    title: 'Re-land the CRM polish with real browser proof',
    why: 'It was reverted once because it had not been verified in an actual browser.',
    detail: 'Light mode, information dots, Excel export. This time proven in a real browser before it lands.' },
  { ref: '28', owner: 'owner', status: 'blocked', priority: 8,
    blocked_by: 'Tier 3.1 needs a payment gateway; 3.3 needs your decisions',
    title: 'Tier 3 — what is left',
    why: '3.2 (duplicate-charge protection) is DONE and on production.',
    detail: '3.1 real refunds cannot exist without a gateway — there is nothing to reverse. 3.3 is the legal documents and the site corrections, waiting on your answers.' },

  // ── COMPLETED EARLIER — the history the owner asked for ──────────────────
  { ref: '1', owner: 'claude', status: 'done', priority: 200,
    title: 'Create the dev branch and dev app spec',
    why: 'There was nowhere to try anything before customers saw it.' },
  { ref: '2', owner: 'claude', status: 'done', priority: 201,
    title: 'Create the dev app and dev database on DigitalOcean',
    why: 'A dev environment that shares production’s database is not a dev environment.' },
  { ref: '3', owner: 'claude', status: 'done', priority: 202,
    title: 'Load a production copy into the dev database' },
  { ref: '4', owner: 'claude', status: 'done', priority: 203,
    title: 'Encrypted offsite backups to a second provider',
    why: 'Every backup lived in the SAME DigitalOcean account as the database it protected. That is a copy, not a backup.' },
  { ref: '5', owner: 'claude', status: 'done', priority: 204,
    title: 'Merge, test on dev, then deploy — the release path' },
  { ref: '6', owner: 'claude', status: 'done', priority: 205,
    title: 'Security N1–N3 (HIGH) — 2FA interface, account lockout, admin token storage',
    why: 'Working 2FA existed on the server but no client could send a code, so enabling it locked the admin out.' },
  { ref: '7', owner: 'claude', status: 'done', priority: 206,
    title: 'Security N4–N10 (MEDIUM) — proxy trust, model gate, uploads, open endpoints' },
  { ref: '8', owner: 'claude', status: 'done', priority: 207,
    title: 'Security N11–N18 (LOW) — enumeration, ban gap, dependencies, CSP, config' },
  { ref: '9', owner: 'claude', status: 'done', priority: 208,
    title: 'Costing engine, seed and acceptance test' },
  { ref: '10', owner: 'claude', status: 'done', priority: 209,
    title: 'Costing — database tables and API' },
  { ref: '11', owner: 'claude', status: 'done', priority: 210,
    title: 'Costing tab in the control panel (four screens)' },
  { ref: '12', owner: 'claude', status: 'done', priority: 211,
    title: 'Offers engine and margin formulas',
    why: 'The 40%-of-sale rule had to live in one place, not in several people’s heads.' },
  { ref: '13', owner: 'claude', status: 'done', priority: 212,
    title: 'Offers — schema and API' },
  { ref: '14', owner: 'claude', status: 'done', priority: 213,
    title: 'Offers tab — list and five-step create' },
  { ref: '15', owner: 'claude', status: 'done', priority: 214,
    title: 'Notifications engine — variables, frequency cap, templates' },
  { ref: '16', owner: 'claude', status: 'done', priority: 215,
    title: 'Notifications — schema, admin API and tab' },
  { ref: '21', owner: 'claude', status: 'done', priority: 216,
    title: 'Alerts tab — the system tells you',
    why: 'A supplier balance check ran hourly into a log nobody reads while 415 generations failed mid-workshop on 8 August.' },
  { ref: '22', owner: 'claude', status: 'done', priority: 217,
    title: 'Reliability — which models are safe to demo live',
    why: 'Kling 3.0 looked like it failed 17.4% of the time until the failures caused by our own empty account were separated out. The real figure was 6.7%.' },
  { ref: '23', owner: 'claude', status: 'done', priority: 218,
    title: 'Workshops & P&L — what we invoiced against what it cost',
    why: 'Supplier cost was always knowable; what a workshop was INVOICED lived only on your laptop.' },
  { ref: '25', owner: 'claude', status: 'done', priority: 219,
    title: 'Refresh the dev database so it can reproduce the business' },
  { ref: '27', owner: 'claude', status: 'done', priority: 220,
    title: 'Record model, outcome and duration for every generation',
    why: 'Collecting since 16 August. This is what makes the timing question answerable — see #29 for the half that is still missing.' },

  { ref: '72', owner: 'claude', status: 'pending', priority: 14,
    title: 'Mobile and tablet — review the WHOLE site at every device size',
    why: 'Raised by the owner on 2026-08-23, and widened by them immediately: this is not one broken picker, it is whether voxel-ai.ai works on the devices people actually hold. Their words — "for the whole mobile version when I use from mobile or tablet, we need to review to be sure everything is right, and design it as the device responds. Eleven inch, nine inch, whatever the size of the device."\n\nWorkshop attendees are handed a link and open it on whatever is in their pocket. If the site is only right on a laptop, the first impression most people get is the wrong one.',
    detail: 'THE ONE CONFIRMED DEFECT, reported from the owner’s own phone: generating an image and stepping through camera → lens → focal length. Something is wrong in that flow on a phone. NOT DIAGNOSED — reproduce it before assuming a cause. Camera metadata is a distinguishing feature of the platform, so getting it wrong on the device most people carry undercuts the thing that makes the output look considered. '
      + 'SCOPE IS EVERY PAGE, NOT A LIST OF FIXES: Explore, Image, Video, Audio, Studio, Node, Edit, Account, Pricing, Community, and the control panel. At phone (375–430), small tablet (768), large tablet (1024–1194) and laptop. The task is to WALK each one and write down what is actually wrong, then fix — not to guess at breakpoints from the code. '
      + 'WHAT USUALLY BREAKS, as somewhere to start looking and NOT as findings: dropdowns opening off-screen, dependent lists that do not reset when their parent changes, touch targets under 44px, tables that scroll the page sideways instead of themselves, fixed widths, and modals taller than the viewport with no internal scroll. '
      + 'THERE IS ALREADY A GUARD FOR ONE CLASS OF THIS: src/layout-safety.test.jsx asserts no table anywhere hides a column. Whatever this review finds should end the same way — a test, not a memory. '
      + 'RELATED: #43 (PWA with web push) is the wider mobile PROJECT. This is the responsive review and must not wait for it — a PWA of a site that does not fit the screen is a faster way to reach the same bad layout.' },
  // ── FOUND 2026-08-22, BOTH FROM THE OWNER'S SCREENSHOTS ──────────────────
  // Neither was found by a check, a test or an alert. Both were found because
  // the owner photographed a screen and asked me to look at it.
  { ref: '70', owner: 'claude', status: 'pending', priority: 6,
    title: 'Three SOP lines are blind for ONE reason — Backblaze cannot be listed',
    why: 'The only three non-green checks on the whole SOP screen — daily backup, Backblaze storage, customer media backed up — all fail with the SAME error: a 10-second connection timeout. "Customer media backed up" has NEVER once succeeded. That silence is why both of us concluded the media was not backed up at all; the owner\'s Backblaze screenshot then showed 72.2 GB sitting there. A check that cannot run is worse than no check, because the screen still implies coverage.',
    detail: 'WRITES TO THAT BUCKET WORK — the daily archive landed at 14:04 today and the media sync has copied 72.2 GB. It is LISTING that fails. '
      + 'backup-offsite.js:224 sets connectionTimeout 10s / requestTimeout 120s, and the error is the CONNECTION one, so it never reaches a slow response — sockets are not being established at all. '
      + 'HYPOTHESIS, NOT YET PROVEN: the three checks each run their own full listing of ~11,744 objects concurrently, possibly alongside the media sync doing the same. That is dozens of simultaneous connections against a default socket pool; they queue, and a queued connection blows the 10s budget. Writes succeed because they go one at a time. '
      + 'VERIFY BEFORE FIXING: run the three checks serially. If serial passes and parallel fails, the fix is SHARING one listing between them — not a longer timeout, which would only hide a contention bug behind a slower screen. '
      + 'LIKELY ALSO FIXES POST /api/admin/backup/passphrase-check, which lists the bucket to find the oldest archive, and which task #60 depends on.' },
  { ref: '71', owner: 'claude', status: 'pending', priority: 20,
    title: 'The daily backup runs on every boot — 16 copies of one day',
    why: 'The bucket holds one 7.6 MB archive per day, then 2026-08-21 at 122.4 MB across SIXTEEN versions and 2026-08-22 across two. Each copy is healthy; the job simply ran sixteen times. It was invisible until bucket versioning was switched on 19 August — before that each upload silently overwrote the last, so this has probably been happening since the feature shipped and left no trace.',
    detail: 'CAUSE — index.js:7068: `setTimeout(runAutomatedBackup, 5 * 60 * 1000)` fires five minutes after EVERY BOOT, with no "has today already been written?" guard. Production runs TWO instances, so ONE deploy produces TWO backups; sixteen versions is eight deploys. '
      + 'NOT AN EMERGENCY — no data is at risk and every archive is valid. But each run is a full table scan of production on a 1 vCPU box that is also serving customers, both instances dump simultaneously against the same database, and it burns storage and Backblaze transactions on every deploy forever. '
      + 'IT ALSO MAKES THE ADMIN SCREEN LIE: autoBackupStatus is per-instance, so with two instances the CRM\'s "last backup" line depends on which one answers, and can read stale immediately after a successful backup. '
      + 'FIX: check whether today\'s offsite key already exists and return early. That fixes the multi-instance case for free — both instances ask the same question of the same bucket and the second skips. KEEP the boot run: on a fresh environment it is the only thing that produces a first backup. Add a test that a second call the same day writes nothing, because without versioning the bug is invisible.' },
];

/**
 * Put the seed on the board: insert what is missing, refresh what the owner
 * has not touched, and never overwrite what they have.
 *
 * ── THE RULE, AND WHY IT CHANGED ───────────────────────────────────────────
 * This used to skip EVERY task that already existed — `if (have.has(ref))
 * continue` — so that it could never undo the owner's work. That protection is
 * right, and being absolute made it wrong in a second way: I could not keep
 * the board current either. Marking #29 done and putting #55 on hold changed
 * this file and reached production not at all, while I reported the board as
 * updated. A single source of truth that only one of us can write to is not a
 * single source of truth.
 *
 * So the rule is narrower rather than absolute:
 *   · task missing            → insert it
 *   · exists, owner untouched → refresh from the seed (this is how I keep it current)
 *   · exists, owner touched   → leave it completely alone, forever
 *
 * `owner_touched` is set the moment they mark something done, reopen it, or
 * move its priority. One click and the row is theirs.
 */
export async function seedTasks(pool, { upsertTask }) {
  const { rows } = await pool.query(
    `SELECT ref, owner_touched FROM tasks WHERE ref IS NOT NULL`);
  const state = new Map(rows.map((r) => [r.ref, r.owner_touched]));
  let added = 0;
  let refreshed = 0;
  let kept = 0;
  const rejected = [];
  for (const t of SEED) {
    const existing = state.get(t.ref);
    if (existing === true) { kept++; continue; }     // theirs — hands off
    const isNew = existing === undefined;
    const r = await upsertTask(pool, t);
    if (!r.ok) { rejected.push(`#${t.ref}: ${r.error}`); continue; }
    if (isNew) added++; else refreshed++;
  }
  if (added) console.log(`[tasks] seeded ${added} task(s)`);
  if (refreshed) console.log(`[tasks] refreshed ${refreshed} untouched task(s)`);
  if (kept) console.log(`[tasks] left ${kept} task(s) alone — edited on the board`);
  // A REJECTED task used to vanish silently — `if (r.ok) added++` and nothing
  // else. The two that failed were the two the owner had specifically told me
  // were missing, and the log said "seeded 57" as though nothing had gone
  // wrong. A count of successes is not a report.
  if (rejected.length) {
    console.error(`[tasks] ${rejected.length} task(s) REJECTED and not on the board: ${rejected.join(' · ')}`);
  }
  return { added, refreshed, kept, rejected };
}
