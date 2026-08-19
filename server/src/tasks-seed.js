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
  { ref: '54', owner: 'owner', status: 'pending', priority: 20,
    title: 'Move DNS to your own Cloudflare account',
    why: 'voxel-ai.ai sits behind DigitalOcean’s Cloudflare, not yours — so there is no WAF or bot management you control.',
    detail: 'Registrar is GoDaddy, not DigitalOcean. 19 records across THREE email systems. Needs a quiet window — a MORNING, not late night: the risk is email, and propagation takes 24–48h. Zone export already sent.' },
  { ref: '55', owner: 'claude', status: 'in_progress', priority: 21,
    title: 'Back up customer media — versioning AND replication to Backblaze',
    why: 'The daily backup covers the database — every generation’s metadata and URL — but NOT the files. 66.1 GiB across 11,320 files exists in exactly one place. Lose the bucket and every customer’s history points at nothing.',
    detail: 'DECIDED 2026-08-19: do BOTH. Costed from the providers’ own pricing pages that day, not from memory. '
      + 'MEASURED: voxel-ai-store is 66.1 GiB / 11,320 items; dev is 71 MiB / 15 items. DigitalOcean’s $5/mo already includes 250 GiB, so storage there costs nothing extra today. '
      + 'VERSIONING — $0, well inside the allowance. Stops an accidental delete or overwrite. Does NOT survive losing the bucket or the account. Must be enabled via the API; the console says so explicitly. '
      + 'BACKBLAZE — $6.95/TB/mo with the first 10 GB free, so 61 billable GB ≈ $0.42/month. Seeding it moves ~71 GB out of DigitalOcean, inside the included 1 TiB transfer, so $0 to start. This is the only option that survives losing the DigitalOcean account entirely. '
      + 'SMALLER THAN IT LOOKED: Backblaze is ALREADY configured and working for the database backups (OFFSITE_S3_*), so this extends something proven rather than building new. About 4 hours. '
      + 'THE NUMBER TO WATCH: growth rate is unknown — 66 GiB accumulated since roughly 2 August. At 250 GiB the Backblaze cost would be about $1.80/month. Worth reporting into the SOP rather than assuming.' },
  { ref: '50', owner: 'owner', status: 'pending', priority: 22,
    title: 'Second copy of the backup passphrase',
    why: 'Saved in the Mac Passwords app. If the laptop and DigitalOcean are lost together, every backup becomes permanently unreadable.',
    detail: 'Needs one copy somewhere that is not this Mac. Never share the value with me.' },
  { ref: '37', owner: 'owner', status: 'blocked', priority: 23,
    blocked_by: 'The registered legal entity name, licence number and address',
    title: 'Answer the legal document questions',
    why: 'Three B2B documents are drafted and NOTHING is published. Without the entity, the Terms name no party.',
    detail: 'Plus 8 smaller answers: under-18 workshops, payment terms, liability floor, per-attendee reporting, credits at expiry, dispute windows, backup provider, five Kuwait-specific questions for a lawyer.' },
  { ref: '31', owner: 'owner', status: 'blocked', priority: 24,
    blocked_by: 'Naming the 2–3 editing behaviours that matter',
    title: 'Project A — conversational video editing',
    why: 'Not ten features. The two or three things that make an attendee say "this is better than what I had".',
    detail: 'Recommendation: ORCHESTRATE models, do not build a renderer. /api/edit-video-omni already works, is deployed and charged for, and nothing on the site surfaces it. A renderer is a second product, months, against a funded competitor.' },
  { ref: '40', owner: 'owner', status: 'pending', priority: 25,
    title: 'Return the supplier costs spreadsheet',
    why: 'Of 82 active models, 32 have no cost. Until then P&L margins are computed over partial data.',
    detail: '28 need a number only you can get. Sent 16 August.' },
  { ref: '41', owner: 'owner', status: 'pending', priority: 26,
    title: 'Switch on Microsoft sign-in for production',
    why: 'The code is live; the button stays hidden because the secret is absent.',
    detail: 'Add the redirect URI in Azure, create a NEW client secret. Dev has the secret listed TWICE from being saved unencrypted once — delete both, add one encrypted.' },
  { ref: '42', owner: 'owner', status: 'pending', priority: 27,
    title: 'Four small security items from the July audit',
    why: 'Each is a decision waiting on you rather than a code change.',
    detail: 'Rotate the Anthropic API key · the Cloudflare origin (now #54) · decide on pre-M1 backups that still hold scrubbed plaintext passwords · decide on the xlsx dependency.' },
  { ref: '26', owner: 'owner', status: 'blocked', priority: 28,
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
  { ref: '57', owner: 'owner', status: 'pending', priority: 38,
    title: 'Tidy up — production has two storage keys where one is needed',
    why: 'Not a risk, just untidy. Both are scoped to voxel-ai-store with readwrite, so neither can reach anything else. But nobody can tell which one production actually uses, and an unknown is worth removing before it is inherited by someone else.',
    detail: 'DONE 2026-08-19 in the same session: three access keys with FULL ACCESS TO EVERY BUCKET — 16 days old, one of them exposed in a screenshot — were replaced with scoped keys and deleted. Production verified re-hosting images AND video (992-1589ms) throughout. '
      + 'WHAT IS LEFT, 10 minutes and only when unhurried: both secrets were shown once and are unrecoverable, so the live one cannot be identified. Create a third key on voxel-ai-store, point production at it, generate one image to confirm "[storage] re-hosted", THEN delete voxel-prod-storage and voxel-prod-storage-2. '
      + 'STILL UNVERIFIED: the dev key (voxel-dev-storage). Dev control panel -> SOP -> Check now -> the Storage line makes a real authenticated call and will say "reachable" or fail. Dev only, no customer impact either way.' },
  { ref: '56', owner: 'claude', status: 'done', priority: 39,
    title: 'Hardening pass — stop the same class of mistake recurring',
    why: 'The owner asked on 2026-08-19 why there is always some mistake. Two different things were happening: OLD bugs surfacing because we finally started looking (good), and a repeated habit of mine — describing state I had not actually read (five times, one cause).',
    detail: 'DONE 2026-08-19. TWO new automated checks: (1) columns that must be written, measured over a rolling 7-day window — the existing check only found columns empty in EVERY row, so the Node canvas bug hid behind a column that was 60% full; '
      + '(2) a JSX-parsing sweep so no table anywhere can hide a column — it found the Account page forcing the whole screen sideways on a phone, and the Pricing table squashing instead of scrolling. '
      + 'TWO rules written into CLAUDE.md, because no check catches them: never describe state not read in this session, and verify the EFFECT not the change. '
      + 'Deliberately NOT a one-time audit — a snapshot does not stop recurrence, and the weekly structure check had ALREADY found model_label and been ignored. The follow-through was the gap, not the checking.' },
  { ref: '47', owner: 'claude', status: 'in_progress', priority: 41,
    title: 'STANDING RULE — an information dot on every field, a description on every tab',
    why: 'The bulk-expiry control was styled so faintly it was reported as missing from production. A feature nobody can find is not shipped.',
    detail: 'Applied as each thing is built, never as a later pass. The InfoDot component now exists so every new tab gets it free.' },
  { ref: '17', owner: 'claude', status: 'pending', priority: 42,
    title: 'Provider webhooks — one job, three problems',
    why: 'Ends the stuck-charge cause permanently, gives customers "your video is ready", and is the prerequisite for mobile push.',
    detail: 'Fixes RELIABILITY, not speed. The 1,393 timeouts are a waiting problem; this makes the waiting reliable, not shorter.' },
  { ref: '30', owner: 'claude', status: 'blocked', priority: 44,
    blocked_by: 'Ships in the same push as the legal documents (#37)',
    title: 'Fix the site’s contradictions with the legal documents',
    why: 'Publishing "there are no subscriptions" while a logged-in attendee sees a $19/month plan makes the contradiction the evidence.',
    detail: 'Account page shows a $19/month plan with dead buttons; Community advertises a $500 contest with no rules; stripe-js is installed with zero imports.' },
  { ref: '35', owner: 'claude', status: 'pending', priority: 45,
    title: 'Weekly checks — new vulnerabilities and database growth',
    why: 'Ten advisories were accepted deliberately and nothing would report an eleventh. On 18 August there were 11, ALL with fixes available.',
    detail: 'Alert on what CHANGED, never on "advisories exist" — otherwise it trains dismissal and the real one gets dismissed too.' },
  { ref: '36', owner: 'claude', status: 'pending', priority: 46,
    title: 'Pre-workshop pre-flight card',
    why: 'This is exactly what failed on 8 August: 415 generations failed mid-workshop from an empty supplier account, every one auto-refunded so nothing flagged it.',
    detail: 'Four live values on one screen: alerts green? · supplier balance with DAYS OF RUNWAY · has any model gone bad? · does this cohort’s access cover today? The one checklist that stays human.' },
  { ref: '49', owner: 'claude', status: 'in_progress', priority: 47,
    title: 'This tab — every task and project, visible',
    why: 'You had to ask me what was pending, every time, and the answer came from a file only I could read.',
    detail: 'Now the single source of truth. I keep it current as part of doing the work.' },
  { ref: '44', owner: 'claude', status: 'pending', priority: 48,
    title: 'The small batch',
    why: 'None are big; several remove a recurring annoyance.',
    detail: 'A DEV banner so dev is never mistaken for production · a FAL dashboard · the duplicate-charge counter on Alerts · point my local environment away from production · tighten DMARC · rename the workshop-shaped labels now the customer is a company.' },
  { ref: '19', owner: 'claude', status: 'pending', priority: 50,
    title: 'Tech debt from the audit',
    why: 'Both were flagged in July and both keep growing.',
    detail: 'Split index.js (~6,400 lines against a 1,500 threshold) · a retention policy for the entities table (33 MB and rising).' },
  { ref: '45', owner: 'claude', status: 'pending', priority: 51,
    title: 'Make the generation wait productive',
    why: 'Images are already fine — this is a VIDEO problem, 184s typical.',
    detail: 'Prompt coaching FIRST (days, no per-generation cost, and it compounds). Then an instant preview: a still in ~8 seconds turns a blind 3-minute wait into feedback. Room feed last, blocked on a privacy decision. None of it makes generation faster.' },
  { ref: '46', owner: 'claude', status: 'pending', priority: 52,
    title: 'B2B pipeline — proposal → PO → subscription → invoice',
    why: 'Today the whole B2B motion is manual and lives on your computer; the system only joins in when credits are hand-added.',
    detail: 'ONE pipeline with #24. Forces the company entity into existence, which is also what unblocks per-company usage reports. Needs NO payment gateway — organisations are invoiced.' },
  { ref: '53', owner: 'claude', status: 'pending', priority: 60,
    title: 'React 18 → 19',
    why: 'A PROJECT, not maintenance. React 18 is NOT end of life — a newer major existing is novelty, not risk.',
    detail: 'Must never become a recurring alert. Confirm framer-motion, shadcn/ui and React Flow compatibility BEFORE starting.' },
  { ref: '48', owner: 'claude', status: 'pending', priority: 61,
    title: 'Knowledge Base tab — how to use everything, Arabic and English',
    why: 'Anyone opening the control panel should find the answer in one place.',
    detail: 'LAST by your instruction, because it documents a panel still changing. But the RULE starts now: every addition gets a guide, in both languages, with pictures, after both sides confirm. Already owed: SOP tab, waitlist, schedule editor, the information dots.' },
  { ref: '32', owner: 'claude', status: 'blocked', priority: 70,
    blocked_by: 'The payment gateway — a developer who finds VOXEL cannot become a customer',
    title: 'Project B — MCP server for Claude, Cursor, ChatGPT, Gemini',
    why: 'Technically the cheapest thing on the roadmap — days — because VOXEL is already an API.',
    detail: 'But credits arrive only by redeeming a code or an admin grant. It would generate interest that cannot convert: a marketing asset, not a revenue one.' },
  { ref: '43', owner: 'claude', status: 'blocked', priority: 71,
    blocked_by: 'Its push half depends on provider webhooks (#17)',
    title: 'Mobile — a progressive web app, not native apps',
    why: 'One codebase, no app store review, no second release process for a solo developer.' },
  { ref: '24', owner: 'claude', status: 'blocked', priority: 72,
    blocked_by: 'Held by you until the Tier work is done; design together with #46',
    title: 'Generate invoices from the system, not by hand',
    why: 'The back half of the same pipeline as #46. Built separately, the company entity gets built twice.' },
  // ── SEPARATE PENDING ITEMS I had folded into others — the owner was right
  //    to push: a task merged into another is a task that stops being tracked.
  { ref: '18', owner: 'claude', status: 'pending', priority: 43,
    title: 'Video charge fix-forward — the stuck-charge sweeper',
    why: 'Customers charged for a video that never arrived. 124 accumulated unnoticed before anything watched for them.',
    detail: 'Related to #17 but not the same work: webhooks stop NEW ones happening; this is the reconciler and the backfill for those already stuck.' },
  { ref: '20', owner: 'claude', status: 'pending', priority: 49,
    title: 'Re-land the CRM polish with real browser proof',
    why: 'It was reverted once because it had not been verified in an actual browser.',
    detail: 'Light mode, information dots, Excel export. This time proven in a real browser before it lands.' },
  { ref: '28', owner: 'owner', status: 'blocked', priority: 29,
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
