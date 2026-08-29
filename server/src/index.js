import express from 'express';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import multer from 'multer';
import { fal } from '@fal-ai/client';
import path from 'node:path';
import zlib from 'node:zlib';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool, isReady as dbReady, migrate, ADMIN_EMAIL } from './db.js';
import { persistOrFallback, persistBuffer, isReady as spacesReady, uploadPrivate, listKeys, deleteKey,
         listAllMedia, readObject, primaryObjectExists, cdnifyDeep, mediaCdnBase,
         ensureMediaCors, uploadPublicAt, objectSize, persistWithThumb , keyFromUrl , getLifecycleRules, putLifecycleRules } from './storage.js';
import { installModel, modelReady, MODEL_PREFIX } from './whisper-model.js';
import { SURVEY_SQL, surveyRows } from './thumbnail-survey.js';
import { SET_THUMB_SQL, backfillRows } from './thumbnail-backfill.js';
import { RESCUE_SQL, RESCUE_QUEUE_SQL, MARK_GONE_SQL, REMAINING_SQL, rescueRows } from './media-rescue.js';
import { buildSearch, MODELS_USED_SQL, toGridItem } from './history-search.js';
import { RECORD_SQL, CLAIM_SQL, GIVE_UP_SQL, TOUCH_SQL, DUE_SQL, OWNS_SQL,
         sweepJobs, historyRowFor } from './slow-image.js';
// The resizer the backfill already uses. Imported here so BOTH the button
// and the automatic path run identical code — two resizers would drift, and
// the grid would show two different sizes of "small".
import { makeThumbnail } from './thumbnail-backfill.js';
import { SCALE_SQL, SAMPLE_SQL, summariseScale } from './thumbnail-scale.js';
import { DELETE_SQL as SOFT_DELETE_SQL, RESTORE_OWN_SQL, RECOVERABLE_SQL,
         DUE_FOR_PURGE_SQL, PURGE_ROW_SQL, purgeRows, daysLeft, RECOVERY_DAYS } from './soft-delete.js';
import { describePlan as describeExpiryPlan, applyExpiry, NONCURRENT_DAYS } from './version-expiry.js';
import { RECORD_SQL as LEDGER_RECORD_SQL, SEED_SQL as LEDGER_SEED_SQL,
         MISSING_SQL as LEDGER_MISSING_SQL } from './offsite-ledger.js';
import { RECORD_SQL as SYNC_OK_SQL, READ_SQL as SYNC_READ_SQL, SYNC_FLAG,
         judgeSyncHeartbeat, syncStaleAlert } from './sync-heartbeat.js';
import { headSize } from './thumbnail-survey.js';
import { ourMediaHosts, checkSample, summarise as summariseMediaHealth,
         HOST_BREAKDOWN_SQL, AT_RISK_SAMPLE_SQL } from './media-health.js';
import { configureKie, kieCreateTask, kieGetTask, kiePollUntilDone, kieUploadBuffer, kieGetCredits } from './kie.js';
import { configureLlm, llmText, llmConfig } from './llm.js';
import { estimateKieCredits, backfillKieEstimate, KIE_USD_PER_CREDIT,
         KIE_CALIBRATION, kieBilledUsdPerCredit } from './kie-pricing.js';
import { estimateFalCost, backfillFalEstimate } from './fal-pricing.js';
import { publicReason } from './sanitize.js';
import { deepHealth } from './health-deep.js';
import { AGENT_SYSTEM } from './edit-agent-prompt.js';
import { formatProviderError, providerErrorParts, isProviderRefusal } from './provider-error.js';
import { normalizeBulkEmails, generateBulkPassword } from './bulk-helpers.js';
import { mayRedeem, capForInvites, splitInvites, REFUSAL } from './promo-audience.js';
import { groupByExpiryDay, summarise, actionable, SOON_DAYS } from './expiry-report.js';
// Owner's rule 2026-08-25: credits expire 30 days from the day they were
// added — each addition on its own clock. ACCOUNTS NEVER EXPIRE any more;
// nothing below writes users.expires_at automatically (the bulk tool remains
// as a deliberate manual switch only).
import { addLot, mirrorSpend as mirrorLotSpend, backfillAllUsers, scheduleCreditLotSweep,
         lotsOverview, activateNow, userCreditSummary } from './credit-lots-db.js';
import { CREDIT_LIFE_DAYS } from './credit-backfill.js';
import { audienceMiddleware, audienceReport, ensureAudienceTables } from './audience-store.js';
import { runRate, breakEven, renewals, renewalHeadline, monthlySeries, CYCLES }
  from './expenses.js';
import { ensureExpenseTables, listExpenses, measuredSupplierCost,
         fetchDigitalOceanInvoices, cacheInvoices, cachedInvoices } from './expenses-store.js';
import { injectClarity, clarityCspHash, shouldInject,
         CLARITY_SCRIPT_HOSTS, CLARITY_CONNECT_HOSTS } from './clarity.js';

// The hash of the ONE inline script we inject, computed from the very string
// that gets injected so the two cannot drift. Empty when Clarity is switched
// off, which leaves the CSP exactly as it was.
const CLARITY_CSP = (() => {
  const v = shouldInject('', process.env);
  return v.inject ? [clarityCspHash(v.id), ...CLARITY_SCRIPT_HOSTS] : [];
})();
import { verifyJwt, requireAdmin, requireNotBanned } from './middleware/auth.js';
// Restored after the in-file getStore block was removed — DIST_DIR
// at the bottom of this file still needs __dirname.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import {
  CREDIT_COSTS,
  chargeCredits,
  refundCredits,
  InsufficientCreditsError,
} from './credits.js';
// C1 (audit 2026-07-28): the server computes every generation price from
// these tables — the client's credit_cost is a display hint only.
import {
  IMAGE_CREDITS as PRICE_IMAGE_CREDITS,
  VIDEO_CREDITS as PRICE_VIDEO_CREDITS,
  resolveChargeCost,
  getVoiceCredits,
  UnpricedModelError,
  PriceMismatchError,
} from './pricing.js';
// H1 (audit 2026-07-28): /api/download SSRF guard.
import {
  assertSafeDownloadUrl,
  sanitizeFilename,
  DownloadRejectedError,
  // N10: the character-element route reuses the same host allow-list rather
  // than inventing a second, weaker idea of "a url we can read".
  isAllowedDownloadHost,
  buildAllowedHostSuffixes,
} from './download-guard.js';
// H2 (audit 2026-07-28): /api/upload content-type policy.
import { validateUpload } from './upload-guard.js';
import { isKnownVoice, VOICE_COUNT } from './voice-catalog.js';
import {
  googleConfigured, missingGoogleVars, googleRedirectUri,
  verifyGoogleIdToken, buildGoogleAuthUrl, exchangeCodeForTokens,
  newOauthState, stateMatches,
  setOauthCookie, clearOauthCookie,
  OAUTH_STATE_COOKIE, OAUTH_HANDOFF_COOKIE,
} from './google-auth.js';
import {
  microsoftConfigured, missingMicrosoftVars, microsoftRedirectUri,
  verifyMicrosoftIdToken, buildMicrosoftAuthUrl, exchangeMicrosoftCode,
} from './microsoft-auth.js';
import { registerCostingRoutes } from './costing-routes.js';
import { registerOffersRoutes } from './offers-routes.js';
import { registerNotificationsRoutes } from './notifications-routes.js';
import { registerAlertsRoutes, runAlertChecks } from './alerts-routes.js';
import { registerBackupVerifyRoutes, scheduleRestoreVerification,
         runRestoreVerification } from './backup-verify-routes.js';
import { fetchOldestOffsite } from './backup-verify.js';
import { syncMediaOffsite, RUN_WATCHDOG_MS , destKeyFor } from './media-sync.js';
import { registerPnlRoutes } from './pnl-routes.js';
import { registerReliabilityRoutes } from './reliability-routes.js';
import { registerCustomerRoutes } from './customer-routes.js';
import { registerWaitlistRoutes } from './waitlist.js';
import { registerEditEventRoutes } from './edit-events.js';
import { registerSopRoutes, scheduleSopJobs } from './sop-routes.js';
import { registerTaskRoutes, ensureTasksTable, upsertTask } from './tasks.js';
import { seedTasks } from './tasks-seed.js';
import { registerLiveRoutes } from './live-routes.js';
import { settleAttempt, sweepStale } from './generation-events.js';
import { idempotencyGuard, sweep as sweepIdempotency } from './idempotency.js';
import {
  createReset, consumeReset, resetUrl, resetEmailBody, passwordProblem, NEUTRAL_REPLY,
} from './password-reset.js';
import { sendEmail, mailConfigured, verifyUnsubscribeToken } from './mailer.js';
import { runDailyModelSync } from './costing-sync.js';
// H3 (audit 2026-07-28): hard deadline on synchronous provider calls.
import { withProviderDeadline, ProviderTimeoutError } from './provider-deadline.js';
// M1 (audit 2026-07-28): keep credentials out of the admin audit log.
import { buildAuditSummary } from './audit-redact.js';
// M2 (audit 2026-07-28): trust forwarding headers only from Cloudflare.
import { resolveClientIp } from './client-ip.js';
import { originGuard } from './origin-guard.js';
import { loginThrottleVerdict } from './login-throttle.js';
// M3 (audit 2026-07-28): encrypted second backup destination.
import {
  encryptBackup, offsiteConfigured, uploadOffsite, missingOffsiteVars, pruneOffsite, prunePrimary,
  listOffsiteMedia, writeMediaObject, readMediaObject, offsiteObjectExists,
} from './backup-offsite.js';
// H7 (audit 2026-07-28): admin session in an httpOnly cookie + CSRF.
import {
  setAdminSessionCookies,
  clearAdminSessionCookies,
  newCsrfToken,
  checkCsrf,
  CSRF_COOKIE,
  CSRF_HEADER,
  shouldRenewSession,
  ADMIN_SESSION_SECONDS,
} from './admin-session.js';
// H5 (audit 2026-07-28): admin TOTP 2FA (RFC 6238 via node:crypto).
import {
  generateSecret,
  verifyTotp,
  currentStep,
  buildOtpAuthUri,
  generateRecoveryCodes,
  hashRecoveryCode,
  evaluateSecondFactor,
} from './totp.js';
// H4 (audit 2026-07-28): async video charges persisted so refunds survive
// a restart (was an in-memory Map).
import {
  trackVideoCharge,
  settleVideoCharge,
  refundFailedVideo,
  getVideoCharge,
  userOwnsJob,
  userOwnsMediaUrl,
  reconcilePendingCharges,
} from './video-charges.js';

// Load server/.env relative to THIS source file (not process.cwd()) so the
// API works no matter which directory the harness/launch config runs it
// from. Without this, FAL_KEY silently goes missing and every generate
// or enhance call fails with no obvious cause.
dotenv.config({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env'),
});

// Surface silent crashes instead of exiting quietly
process.on('uncaughtException', (e) => console.error('[FATAL] uncaughtException:', e));
process.on('unhandledRejection', (e) => console.error('[UNHANDLED] rejection:', e));

// One-shot diagnostic at startup. Prints which env vars are present and how
// long their values are, NEVER the values themselves. This is what tells you
// definitively whether DO is injecting the secret you set in the dashboard
// (vs. it being silently missing, mistyped, or shadowed by a spec slot).
const _envSummary = ['FAL_KEY', 'KIE_KEY', 'JWT_SECRET', 'DATABASE_URL', 'PORT', 'NODE_ENV']
  .map((k) => {
    const v = process.env[k];
    if (v === undefined) return `${k}=✗MISSING`;
    if (v === '') return `${k}=✗EMPTY`;
    return `${k}=✓set(${v.length}ch)`;
  })
  .join(' ');
console.log(`[voxel-api] env summary: ${_envSummary}`);

const app = express();

// ─── DUPLICATE-CHARGE PROTECTION (Tier 3.2) ─────────────────────────────────
// Applied to the routes that CHARGE, and only those. A double-clicked Generate
// or a network retry sends the same request twice and both are billed; this
// replays the first answer instead. Fails OPEN — if the guard cannot run, the
// generation proceeds, because a rare double charge is a far better outcome
// than an outage.
const noDoubleCharge = idempotencyGuard({ pool, dbReady });

const PORT = process.env.PORT || 3001;
// 100 MB so /api/upload can accept the 3–30 s motion reference videos
// for the Motion Control tab and the 3–10 s edit clips for the Edit
// Video tab. One endpoint serves both image and video uploads —
// no /api/upload-video fork needed.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

// ─── SECURITY MIDDLEWARE ───────────────────────────────────────────
// Order matters: trust proxy → helmet → CORS → body parser → rate limiters.

// DO App Platform sits behind a load balancer; without trust proxy, req.ip
// is the LB's address and rate limiting becomes a global counter (one
// attacker IPs everyone). Setting it to 1 trusts exactly one hop (the LB).
app.set('trust proxy', 1);

// www → apex, permanently. Cloudflare proxies www to this same origin but
// the API's CORS allowlist (and the canonical tags) speak apex — without
// this redirect a visitor on www.voxel-ai.ai could browse yet every API
// call died with 403 (2026-07 audit finding #2). Runs before everything.
app.use((req, res, next) => {
  if (req.hostname === 'www.voxel-ai.ai') {
    return res.redirect(301, 'https://voxel-ai.ai' + req.originalUrl);
  }
  next();
});

// Gzip text responses (HTML/JS/CSS/JSON) at the origin. Cloudflare compresses
// at the edge, but the origin should stand on its own — SEO crawlers and any
// direct-origin fetch see small transfers either way. New dep is justified:
// hand-rolling streaming zlib with backpressure/Vary/filter handling is
// exactly what this express-team package exists for. It skips content that
// is already encoded (e.g. /api/admin/backup's application/gzip stream) and
// non-text types like images automatically.
app.use(compression());

// N15: every https origin the browser legitimately connects to, derived from
// the download allow-list so the two cannot drift apart. Suffixes become
// wildcard origins ('fal.media' → 'https://*.fal.media' plus the bare host).
function mediaConnectSources() {
  const out = new Set();
  for (const suffix of buildAllowedHostSuffixes()) {
    out.add(`https://${suffix}`);
    out.add(`https://*.${suffix}`);
  }
  return [...out];
}

app.use(helmet({
  // CSP: scripts/styles are same-origin (index.html has no inline <script>;
  // the JSON-LD block is data, not executable, so script-src 'self' is fine).
  // img/media/connect stay https:-wide because generation outputs come from
  // arbitrary FAL/kie/Spaces hosts. style-src needs 'unsafe-inline' for
  // React/framer-motion style attributes + Google Fonts CSS.
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // Microsoft Clarity (#64). Without this the browser refuses the tag
      // outright — nothing is recorded, the dashboard stays empty, and it
      // reads as Clarity being broken rather than as a policy blocking it.
      // An exact host, never a scheme wildcard: `https:` here would undo the
      // whole point of N15 from the July audit.
      // The host alone is NOT enough: Clarity's loader is an INLINE script and
      // `'self'` does not permit inline. The first version allowed the host and
      // stopped there — the tag rendered, looked installed, and never ran, with
      // no console error to say so. Found by loading the page in a browser and
      // asking whether window.clarity existed, not by reading the code.
      //
      // A HASH, never 'unsafe-inline': the latter would switch off what N15
      // bought in the July audit, in exchange for a heatmap.
      //
      // ── 'wasm-unsafe-eval' — ADDED 2026-08-21 FOR THE /edit MODULE ────────
      // The editor runs ffmpeg compiled to WebAssembly in the browser, because
      // DigitalOcean's Node buildpack has no ffmpeg and production's two boxes
      // are 1 vCPU each — a server render would fight Express for the core and
      // slow the live site. WebAssembly.instantiate is blocked by CSP without
      // this directive, and it fails looking like a broken build rather than
      // like a policy decision.
      //
      // This is NOT 'unsafe-eval', and the difference is the whole point:
      // 'wasm-unsafe-eval' permits compiling WebAssembly ONLY. It does not
      // permit eval() of JavaScript strings, new Function(), or setTimeout on a
      // string — the injection paths 'unsafe-eval' would reopen and that the
      // July audit closed. It is the narrowest directive that lets WebAssembly
      // run at all.
      //
      // The wasm binary itself is served from OUR OWN ORIGIN (public/ffmpeg/,
      // copied out of node_modules at build time), so 'self' already covers
      // fetching it and no CDN is added to connectSrc. Loading it from unpkg —
      // which is what every ffmpeg.wasm example does — would have meant
      // anything published there could execute inside a signed-in session.
      scriptSrc: ["'self'", "'wasm-unsafe-eval'", ...CLARITY_CSP],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      // N15 (recheck 2026-08-03): connect-src was 'https:' — anything on the
      // internet — so the policy contributed nothing against exfiltration if
      // script ever executed. Narrowed to the hosts media actually comes from,
      // reusing the SAME list the download guard derives from production data
      // (download-guard.js) rather than inventing a second one that drifts.
      //
      // It has to be a list and not just 'self': Audio.jsx fetches provider
      // audio urls directly in the browser, and uploadToFal.js fetches image
      // sources — narrowing this to 'self' would break playback with an opaque
      // "Failed to fetch", the exact failure mode documented in the handover.
      //
      // img/media stay https:-wide. They cannot exfiltrate a response body,
      // and old history rows point at hosts that predate every list we keep;
      // breaking those would blank out images users can still see today.
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      mediaSrc: ["'self'", 'data:', 'blob:', 'https:'],
      // Clarity beacons what it records back over fetch, so the script host
      // alone is not enough: it would load and then silently fail to send.
      connectSrc: ["'self'", 'blob:', 'data:', ...CLARITY_CONNECT_HOSTS, ...mediaConnectSources()],
      workerSrc: ["'self'", 'blob:'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// Lock CORS to known origins. Empty Origin (curl, server-to-server) is
// allowed because admin curl + DO health probe both have no Origin header.
// N14 (recheck 2026-08-03): ALLOWED_ORIGINS is NOT set in production —
// verified against the live App Platform spec — so production runs on this
// fallback, which also trusted three localhost origins. With credentials:true
// that let software listening on a victim's own machine make credentialed
// calls and read the responses.
//
// Fixed in the DEFAULT rather than by setting the env var, deliberately: an
// env var that has to be right is one that can be cleared, mistyped, or
// forgotten on a new app (it already was on this one, and on the dev twin).
// The localhost entries now appear only when NODE_ENV is not 'production', so
// local development keeps working and production cannot inherit them.
// Setting ALLOWED_ORIGINS explicitly still overrides everything.
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const DEFAULT_ORIGINS = [
  'https://voxel-ai.ai',
  // www is belt-and-suspenders for tabs opened before the www→apex 301
  // shipped (their cached pages still send a www Origin).
  'https://www.voxel-ai.ai',
  // Dev only. :3001 is the single-process prod repro (Express serves dist/
  // directly); a module <script crossorigin> sends an Origin, so it must be
  // allowed or the app's own bundle is refused.
  ...(IS_PRODUCTION ? [] : [
    'http://localhost:5173',
    'http://localhost:8080',
    'http://localhost:3001',
  ]),
];
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : DEFAULT_ORIGINS
).map(s => s.trim()).filter(Boolean);
console.log(`[cors] ${process.env.ALLOWED_ORIGINS ? 'ALLOWED_ORIGINS env' : 'built-in default'} → ${ALLOWED_ORIGINS.join(', ')}`);
// ─── ORIGIN GUARD ────────────────────────────────────────────────────────────
// Placed BEFORE cors, the body parser and every route, so a request that did
// not come through Cloudflare is refused before it costs anything.
//
// Proven exposed on 2026-08-18: the DigitalOcean origin hostname answered the
// public internet directly, so Cloudflare's WAF, bot management and DDoS
// protection could all be walked around by anyone who found it.
//
// INERT until ORIGIN_SHARED_SECRET is set — enforcing before the Cloudflare
// Transform Rule exists would take the site down, and a security control whose
// first act is an outage gets removed rather than fixed.
app.use(originGuard());

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  // H7 (audit 2026-07-28): the admin session now travels in an httpOnly
  // cookie, which the browser only sends cross-origin when credentials are
  // allowed. The origin allow-list above (not a wildcard) is what keeps
  // this safe — `credentials: true` with `origin: *` would be unsafe and
  // is rejected by browsers anyway.
  credentials: true,
}));

app.use(express.json({ limit: '50mb' }));

// ─── COOKIES (H7) ──────────────────────────────────────────────────
// Tiny parser instead of the cookie-parser dependency (CLAUDE.md: don't
// add a dep the stdlib covers). Only reads; writing uses res.cookie-style
// Set-Cookie built in setAdminSessionCookie below.
app.use((req, _res, next) => {
  const header = req.headers.cookie;
  req.cookies = {};
  if (header) {
    for (const part of header.split(';')) {
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      const k = part.slice(0, eq).trim();
      const v = part.slice(eq + 1).trim();
      if (k) req.cookies[k] = decodeURIComponent(v);
    }
  }
  next();
});

// Real client IP. Behind Cloudflare → DO App Platform ingress → Node, `req.ip`
// resolves to a SHARED upstream IP, so keying rate limits on it throttles
// thousands of unrelated users TOGETHER (one bucket for everyone → "Too many
// attempts" for all). We must recover the true visitor IP. Try, in order:
//   1. CF-Connecting-IP / True-Client-IP — Cloudflare's real-visitor headers
//   2. leftmost X-Forwarded-For entry — the original client behind the proxies
//   3. req.ip — last resort (local dev / direct origin hits)
// (Trustworthy only because the origin is Cloudflare-fronted; lock the DO
// origin firewall to CF IP ranges so these headers can't be spoofed direct.)
// M2 (audit 2026-07-28): these headers used to be trusted from ANY caller,
// so anyone reaching the origin directly could send a fresh
// `CF-Connecting-IP` per request and get an unlimited number of rate-limit
// buckets — defeating every throttle. resolveClientIp() now trusts them
// ONLY when the direct peer is inside Cloudflare's published ranges;
// otherwise it uses the socket address. See client-ip.js (and the manual
// origin-firewall task documented there).
const clientIp = (req) => resolveClientIp(req);
// IPv6-safe key for express-rate-limit v8 (normalizes /64 subnets).
const ipKey = (req) => ipKeyGenerator(clientIp(req));

// Is this login request for the admin account?
//
// H5 (audit 2026-07-28): this used to EXEMPT the admin from every
// brute-force throttle — the single most valuable account on the platform
// had unlimited password guesses. The admin is now throttled too, just
// more loosely than a normal user (see ADMIN_FAILED_LOGIN_MAX), because
// recoverability still matters. The break-glass path is no longer "no
// limit" but server/scripts/reset-admin-2fa.mjs, which also clears
// lockouts — an operator with server access can always get back in.
const isAdminAuth = (req) =>
  String(req.body?.email || '').trim().toLowerCase() === ADMIN_EMAIL;

// Brute-force protection, keyed on the REAL client IP (see clientIp above).
//  • loginLimiter: tight, paired with the failed_logins DB check in
//    /api/auth/login for a second restart-surviving throttle.
//  • registerLimiter: more generous — many legitimate users legitimately share
//    one IP (office/campus NAT, mobile carrier CGNAT) and must all be able to
//    sign up. adminLimiter stays generous for the admin UI's burst of reads.
// Sign in with Google. Separate from loginLimiter because these are top-level
// browser NAVIGATIONS, not API calls: a single sign-in spends two of them
// (start + callback), and a person who mistypes their Google password will
// legitimately bounce through several times. Still per-IP, so one visitor
// cannot spend anyone else's budget.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  keyGenerator: ipKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many sign-in attempts. Try again in a few minutes.' },
});
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  // Generous per-IP ceiling: many legitimate users share one IP (office/campus
  // NAT, carrier CGNAT) and all must be able to log in. This counts ALL login
  // requests (success + fail); per-account brute-force is throttled separately
  // by the failed_logins (IP, email) check inside /api/auth/login.
  max: 100,
  keyGenerator: ipKey,
  // H5: the admin exemption is GONE — the admin email is rate-limited like
  // everyone else at this layer. Its looser treatment is the higher
  // per-account failure ceiling below, not an exemption.
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again in a few minutes.' },
});
// N11 (recheck 2026-08-03): sign-up answers 409 "an account with that email
// already exists", which tells an attacker exactly which addresses hold
// accounts — the disclosure /api/auth/login deliberately avoids.
//
// The textbook fix ("we've emailed you either way") is NOT available: this
// platform has no email delivery at all, so sign-up has to tell the person
// then and there whether they got an account. The honest mitigation is to
// make bulk probing impractical rather than to pretend the leak is closed.
//
// 100 per 15 minutes let one address test ~9,600 emails a day. 15 keeps real
// sign-ups comfortable — NAT/campus/carrier traffic rarely produces more than
// a handful — while making list enumeration far too slow to be worth running.
// Residual risk is documented in TECH-DEBT.md.
const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  keyGenerator: ipKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many sign-up attempts. Try again in a few minutes.' },
});
// N8 (recheck 2026-08-03): this was the ONE limiter with no keyGenerator, so
// it fell back to req.ip — the Cloudflare EDGE address behind `trust proxy`.
// Because adminGate runs it BEFORE verifyJwt, any unauthenticated stranger
// sharing that edge could spend the 60/min bucket and lock the real admin out
// of the control panel. Keyed on the resolved client IP now, like every other
// limiter, so a stranger can only ever exhaust their OWN bucket.
//
// It stays ahead of verifyJwt deliberately: an unauthenticated flood should be
// cheap to shed. That means req.user does not exist yet, so this is per-IP and
// not per-admin — adminUserKey degrades to ipKey here by design.
const adminUserKey = (req) => (req.user?.id ? `admin:${req.user.id}` : ipKey(req));
const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: adminUserKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many admin requests.' },
});

// H2 (audit 2026-07-28): per-USER limits for the two routes that were
// unauthenticated. Keyed on the authenticated user id (these run after
// verifyJwt), so users sharing an office/carrier IP get their own bucket.
const userKey = (req) => (req.user?.id ? `u:${req.user.id}` : ipKey(req));
// A waitlist is public by design, so the throttle IS the spam defence — that
// and the unique index. Generous enough that a shared office never notices.
const waitlistLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyGenerator: ipKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts — try again later.' },
});

const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60, // a Seedance reference batch can be ~10 files; 60/min is roomy
  keyGenerator: userKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many uploads — please wait a moment and try again.' },
});
// M5: status polling is legitimately frequent (the client polls every few
// seconds per in-flight job, and a user can have several running), so this
// is generous — it exists to stop enumeration, not normal polling.
const statusLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 240,
  keyGenerator: userKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many status checks — please slow down.' },
});
// Conservative: each call is a billable provider LLM request.
const enhanceLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 12,
  keyGenerator: userKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many prompt enhancements — please wait a moment.' },
});

// CORS errors throw before any route runs; convert to a clean JSON 403.
app.use((err, req, res, next) => {
  if (err && /^CORS:/.test(err.message)) {
    return res.status(403).json({ error: err.message });
  }
  next(err);
});

// ─── FAL AI CONFIG ─────────────────────────────────────────────────
const FAL_KEY = (process.env.FAL_KEY || '').trim();
if (FAL_KEY) {
  fal.config({ credentials: FAL_KEY });
} else {
  console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.error('[FATAL-CONFIG] FAL_KEY is not set.');
  console.error('  Local dev  : ensure server/.env contains FAL_KEY=...');
  console.error('  Docker     : docker-compose.yml must load ./server/.env');
  console.error('  All FAL-backed routes will return 503 until fixed.');
  console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

// Middleware used by routes that hit the FAL API. Returns a readable 503
// instead of letting downstream calls throw a cryptic SDK error.
// ─── USER-FACING ERROR SCRUBBER ────────────────────────────────────
// Upstream error text (and our own config messages) must never reveal which
// provider we run on. Full unscrubbed detail is ALWAYS logged server-side
// before this is applied — this only shapes what the USER sees.
function publicError(msg, fallback = 'Generation failed. Please try again.') {
  if (!msg || typeof msg !== 'string') return fallback;
  const scrubbed = msg
    .replace(/fal[-.]ai\/?/gi, '')          // 'fal-ai/...', 'fal.ai'
    .replace(/kie[.]ai\/?/gi, '')           // 'kie.ai'
    .replace(/\b(KIE|FAL)_KEY\b/gi, 'API key')
    .replace(/\b(kie|fal)\b/gi, 'provider') // bare brand mentions
    .replace(/\s{2,}/g, ' ')
    .trim();
  return scrubbed || fallback;
}

function requireFalKey(req, res, next) {
  if (!FAL_KEY) {
    return res.status(503).json({
      error:
        'Generation is temporarily unavailable — the service is not configured. Please contact support.',
    });
  }
  next();
}

// ─── PROVIDER DEADLINE (H3, audit 2026-07-28) ──────────────────────
// Synchronous fal.subscribe calls had no overall timeout: a hung provider
// held the request (and its DB connection) open forever while the user's
// credits stayed spent. Every synchronous provider call now runs under the
// deadline in provider-deadline.js (mirrors the 90s cap the kie path uses).
// On timeout the call is aborted and the route's EXISTING catch block
// refunds through the EXISTING refund path — no new refund logic.
const falSubscribe = (model, options, label) =>
  withProviderDeadline((signal) => fal.subscribe(model, { ...options, abortSignal: signal }), label);

/**
 * Log what the PROVIDER actually said, not just the HTTP reason phrase — see
 * provider-error.js for why this exists and what it cost to learn.
 * Returns the status so the caller can tell "the provider refused us" from a
 * real bug on our side.
 */
function logProviderError(tag, error) {
  for (const line of formatProviderError(tag, error)) console.error(line);
  return providerErrorParts(error).status;
}

// A provider timeout is a 504, not a 500, and its message is already
// user-safe. Returns true when it handled the response. The caller's
// refund (existing path) has already run by the time this is called.
function respondIfProviderTimeout(res, error) {
  if (!(error instanceof ProviderTimeoutError)) return false;
  res.status(504).json({ error: error.message });
  return true;
}

// ─── KIE.AI CONFIG ─────────────────────────────────────────────────
// Second model aggregator alongside FAL. Same wiring pattern: key from env,
// configured once here, guarded per-route. kie.js never reads process.env
// itself (dotenv runs after imports are hoisted).
const KIE_KEY = (process.env.KIE_KEY || '').trim();
configureKie(KIE_KEY);

// ─── TEXT LLM CONFIG (#76) ─────────────────────────────────────────
// The prompt Enhance buttons and the Edit Cut agent both need a text model.
// Both used to call fal-ai/any-llm directly, copy-pasted, and FAL now answers
// 403 — so both were dead for the same reason and only one got reported.
//
// Now they share llm.js, which defaults to kie (already paid for, already
// keyed, 27 chat models) and keeps FAL reachable via LLM_PROVIDER=fal so a
// revived key still works. LLM_MODEL overrides the model without a deploy.
configureLlm({
  kieKey: KIE_KEY,
  falKey: FAL_KEY,
  falSubscribe,
  provider: (process.env.LLM_PROVIDER || '').trim() || null,
  model: (process.env.LLM_MODEL || '').trim() || null,
});
{
  const { provider, model, ready, why } = llmConfig();
  if (ready) console.log(`[voxel-api] text LLM: ${provider} · ${model}`);
  else console.error(`[voxel-api] text LLM UNAVAILABLE — ${why}. Enhance and the Edit Cut agent will refuse.`);
}

/** Gate for the two text-LLM routes. Was requireFalKey, which asked the wrong
 *  question: it checked FAL specifically, so it would wave a request through
 *  to a provider that had been swapped out from under it. */
function requireLlm(req, res, next) {
  const { ready, why } = llmConfig();
  if (!ready) {
    console.error(`[voxel-api] LLM route refused: ${why}`);
    return res.status(503).json({
      error: 'The AI assistant is not configured. Please contact support.',
    });
  }
  next();
}
if (!KIE_KEY) {
  console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.error('[FATAL-CONFIG] KIE_KEY is not set.');
  console.error('  Local dev  : ensure server/.env contains KIE_KEY=...');
  console.error('  DO deploy  : add it as an Encrypted env var in App Platform');
  console.error('  kie.ai-backed models will return 503 until fixed (FAL models unaffected).');
  console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

function requireKieKey(req, res, next) {
  if (!KIE_KEY) {
    // Real cause (KIE_KEY missing) is in the startup FATAL-CONFIG log —
    // users get a provider-neutral message.
    return res.status(503).json({
      error: 'This model is temporarily unavailable — the service is not configured. Please contact support.',
    });
  }
  next();
}

// For the two mixed routes (/api/generate, /api/generate-video) that serve
// BOTH providers: require only the key the selected model actually needs, so
// a missing FAL key doesn't 503 kie models and vice versa. Unknown models
// fall through — the route 400s them with a named error.
function requireModelProviderKey(req, res, next) {
  const model = req.body?.model;
  const cfg = MODEL_CONFIG[model] || VIDEO_DIRECT_MAP[model] || null;
  if (cfg?.provider === 'kie') return requireKieKey(req, res, next);
  return requireFalKey(req, res, next);
}

// ─── AUTH CONFIG ────────────────────────────────────────────────────
// JWT_SECRET must be set in production. We deliberately refuse to fall back
// to a hardcoded default — silent insecure-default secrets are how every
// "we got owned" story starts. Auth routes 503 if it's missing.
const JWT_SECRET = (process.env.JWT_SECRET || '').trim();
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const BCRYPT_ROUNDS = 12;

if (!JWT_SECRET) {
  console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.error('[FATAL-CONFIG] JWT_SECRET is not set.');
  console.error('  Generate one with:  node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"');
  console.error('  Local dev  : add JWT_SECRET=... to server/.env');
  console.error('  DO deploy  : add it as an Encrypted env var in App Platform');
  console.error('  /api/auth/* will return 503 until set.');
  console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

// Both auth routes need (a) a reachable DB, (b) JWT_SECRET. Combine the
// guards so the error response is uniform.
function requireAuthInfra(req, res, next) {
  if (!dbReady()) {
    return res.status(503).json({
      error: 'Database not configured — set DATABASE_URL and restart the API.',
    });
  }
  if (!JWT_SECRET) {
    return res.status(503).json({
      error: 'Auth not configured — set JWT_SECRET and restart the API.',
    });
  }
  next();
}

// Email regex: deliberately loose. Real validation = "send a confirmation
// email and see what happens." This just rejects obvious garbage.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ─── IMAGE MODEL CONFIG ────────────────────────────────────────────
// t2i  = text-to-image endpoint (no images)
// i2i  = single image edit (1 image, uses imgParam)
// edit = multi-image edit (1-14 images, uses image_urls array)
// nativeSizing = model handles aspect_ratio + resolution natively
const MODEL_CONFIG = {
  // Nano Banana Pro runs on kie.ai (switched from FAL 2026-07-20). One jobs
  // model handles both t2i and edit via image_input (≤8 images).
  "Nano Banana Pro":   { provider: "kie", family: "jobs", kieModel: "nano-banana-pro" },
  // Nano Banana 2 runs on kie.ai (switched 2026-07-21). Same jobs schema as
  // Pro; image_input supports up to 14 references.
  "Nano Banana 2":     { provider: "kie", family: "jobs", kieModel: "nano-banana-2" },
  // Flux Kontext / Flux 2 / Seedream 4.5 run on kie.ai (switched 2026-07-21).
  "Flux Kontext":      { provider: "kie", family: "flux", kieModel: "flux-kontext-pro" },
  "Flux 2":            { provider: "kie", family: "jobs", kieModel: "flux-2/pro-text-to-image", t2iOnly: true },
  "Seedream 4.5":      { provider: "kie", family: "jobs", kieModel: "seedream/4.5-text-to-image", t2iOnly: true },
  // Seedream 5.0 Lite runs on kie.ai (switched 2026-07-21). Text-to-image
  // only — kie has no edit variant for it, so reference images are ignored.
  "Seedream 5.0 Lite": { provider: "kie", family: "jobs", kieModel: "seedream/5-lite-text-to-image", t2iOnly: true },
  "Soul 2.0":          { t2i: "fal-ai/flux/dev",             i2i: "fal-ai/flux-pro/kontext",       edit: "fal-ai/nano-banana-pro/edit",  imgParam: "image_url",           nativeSizing: false },
  "Wan 2.2 Image":     { t2i: "fal-ai/wan-t2i",             i2i: "fal-ai/wan-i2i",                edit: "fal-ai/nano-banana-pro/edit",  imgParam: "image_url",           nativeSizing: false },
  "Skin Enhancer":     { t2i: "fal-ai/aura-sr",             i2i: "fal-ai/aura-sr",                edit: "fal-ai/nano-banana-pro/edit",  imgParam: "image_url",           nativeSizing: false },
  "Face Swap":         { t2i: "fal-ai/face-swap",            i2i: "fal-ai/face-swap",              edit: "fal-ai/nano-banana-pro/edit",  imgParam: "image_url",           nativeSizing: false },
  "Relight":           { t2i: "fal-ai/ic-light",             i2i: "fal-ai/ic-light",               edit: "fal-ai/nano-banana-pro/edit",  imgParam: "image_url",           nativeSizing: false },
  // GPT Image 1.5 runs on kie.ai (switched 2026-07-21): separate t2i/i2i ids.
  "GPT Image 1.5":     { provider: "kie", family: "jobs", kieModel: "gpt-image/1.5-text-to-image", kieModelI2I: "gpt-image/1.5-image-to-image" },
  // GPT Image 2 runs on kie.ai (switched from FAL 2026-07-20). Separate jobs
  // models for t2i and i2i; i2i takes input_urls (≤16 images).
  "GPT Image 2":       { provider: "kie", family: "jobs", kieModel: "gpt-image-2-text-to-image", kieModelI2I: "gpt-image-2-image-to-image" },
  // ── kie.ai-backed models (provider:'kie' routes them through kie.js) ──
  // family selects the kie endpoint pair; kieModel is the model field where
  // the family needs one (flux). Input building: buildKieImageInput().
  // ── added 2026-08-02 from the pricing workbook ──
  // Imagen 4 (Google) — three quality tiers, each a SEPARATE kie model id.
  // Text-to-image only; kie exposes no resolution parameter for these.
  // NOTE: kie's `seed` is an integer on imagen4-fast but a STRING on the
  // other two, so we never send it.
  "Imagen 4 Fast":     { provider: "kie", family: "jobs", kieModel: "google/imagen4-fast",  t2iOnly: true, kieStyle: "imagen4" },
  "Imagen 4":          { provider: "kie", family: "jobs", kieModel: "google/imagen4",       t2iOnly: true, kieStyle: "imagen4" },
  "Imagen 4 Ultra":    { provider: "kie", family: "jobs", kieModel: "google/imagen4-ultra", t2iOnly: true, kieStyle: "imagen4" },
  // Seedream 5 Pro — separate t2i / i2i ids. `quality` is TWO-valued here
  // (basic = 1K, high = 2K), unlike the Lite variant's three values.
  "Seedream 5 Pro":    { provider: "kie", family: "jobs", kieModel: "seedream/5-pro-text-to-image", kieModelI2I: "seedream/5-pro-image-to-image", kieStyle: "seedream5pro" },
  "GPT-4o Image":      { provider: "kie", family: "gpt4o" },
  "Flux Kontext Max":  { provider: "kie", family: "flux", kieModel: "flux-kontext-max" },
  "Midjourney":        { provider: "kie", family: "mj" },
};

// ─── VIDEO MODEL CONFIG ────────────────────────────────────────────
// Legacy map: display name → t2v endpoint (used by old /api/generate)
const VIDEO_MODELS = {
  "Kling 3.0 Omni":        "fal-ai/kling-video/v2.1/pro/text-to-video",
  "Kling 3.0":             "fal-ai/kling-video/v3/text-to-video",
  "Kling 2.6":             "fal-ai/kling-video/v1.6/pro/text-to-video",
  "Kling 2.5":             "fal-ai/kling-video/v1.5/pro/text-to-video",
  "Kling 2.1":             "fal-ai/kling-video/v2.1/standard/text-to-video",
  "Kling 2.1 Pro":         "fal-ai/kling-video/v2.1/pro/text-to-video",
  "Kling O1":              "fal-ai/kling-video/v1.6/pro/text-to-video",
  "Wan 2.6":               "fal-ai/wan-i2v/v2.1",
  "Wan 2.2":               "fal-ai/wan-i2v/v2.1",
  "Wan 2.1":               "fal-ai/wan-i2v/v2.1",
  "Seedance 1.5 Pro":      "fal-ai/bytedance/seedance-1-5-pro-t2v",
  "Seedance 2.0":          "fal-ai/bytedance/seedance-1-5-pro-t2v",
  "Seedance 1":            "fal-ai/bytedance/seedance-1-lite-t2v",
  "LTX 2":                 "fal-ai/ltx-video-13b-distilled",
  "Hailuo 2.3":            "fal-ai/minimax/video-01",
  "Hailuo T2V-01":         "fal-ai/minimax/video-01",
  "Hailuo T2V-01 Director":"fal-ai/minimax/video-01-director",
  "PixVerse 5":            "fal-ai/pixverse/v4.5/text-to-video",
  "Vidu Q3":               "fal-ai/vidu/q1",
  "Vidu Q2":               "fal-ai/vidu/q1",
  "Veo 3":                 "fal-ai/veo3",
  "Veo 3.1":               "fal-ai/veo3",
  "Sora 2":                "fal-ai/sora",
  "Luma Dream Machine":    "fal-ai/luma-dream-machine",
  "Nano Banana Pro Video": "fal-ai/kling-video/v1.6/pro/text-to-video",
};

// Direct model name → { t2v, i2v, imageParam } FAL endpoints
// imageParam: how this model accepts images (start_image_url vs image_url)
const VIDEO_DIRECT_MAP = {
  // Kling V3 uses start_image_url / end_image_url
  "Kling 3.0 Omni":        { t2v: "fal-ai/kling-video/v3/pro/text-to-video",         i2v: "fal-ai/kling-video/v3/pro/image-to-video",         imageParam: "start_image_url", endParam: "end_image_url" },
  // Kling 3.0 + 2.6 run on kie.ai (switched from FAL 2026-07-20). Kling 3.0
  // is ONE jobs model for t2v+i2v (frames via image_urls, quality via mode
  // std/pro/4K); 2.6 has separate t2v/i2v ids, duration "5"|"10" only.
  // Omni/2.5/2.1/O1 stay on FAL — not confirmed available on kie.
  "Kling 3.0":             { provider: "kie", family: "jobs", kieModel: "kling-3.0/video" },
  // Kling 3.0 Turbo — the faster/cheaper V3 tier. SEPARATE t2v and i2v model
  // ids (unlike Kling 3.0, which is one model), and a DIFFERENT input schema:
  // `resolution` ("720p"|"1080p") instead of `mode`, no `sound`, and the i2v
  // variant takes no aspect_ratio (it adopts the source image's).
  // Docs: docs.kie.ai/market/kling/v3-turbo-text-to-video (+ …-image-to-video)
  "Kling 3.0 Turbo":       { provider: "kie", family: "jobs", kieModel: "kling/v3-turbo-text-to-video", kieModelI2V: "kling/v3-turbo-image-to-video", kieStyle: "klingTurbo" },
  // Gemini Omni — ONE model for t2v and reference-to-video (image_urls).
  // NOTE the model id has NO vendor prefix, unlike every other kie id here;
  // that is what kie's docs specify. duration is a STRING enum 4/6/8/10.
  "Gemini Omni":           { provider: "kie", family: "jobs", kieModel: "gemini-omni-video", kieStyle: "geminiOmni" },
  "Kling 2.6":             { provider: "kie", family: "jobs", kieModel: "kling-2.6/text-to-video", kieModelI2V: "kling-2.6/image-to-video" },
  // Kling V2.5 uses image_url / tail_image_url
  "Kling 2.5":             { t2v: "fal-ai/kling-video/v1.5/pro/text-to-video",       i2v: "fal-ai/kling-video/v1.5/pro/image-to-video",       imageParam: "image_url",       endParam: "tail_image_url" },
  // Kling V2.1 uses image_url / tail_image_url
  "Kling 2.1":             { t2v: "fal-ai/kling-video/v2.1/standard/text-to-video",  i2v: "fal-ai/kling-video/v2.1/standard/image-to-video",  imageParam: "image_url",       endParam: "tail_image_url" },
  "Kling 2.1 Pro":         { t2v: "fal-ai/kling-video/v2.1/pro/text-to-video",       i2v: "fal-ai/kling-video/v2.1/pro/image-to-video",       imageParam: "image_url",       endParam: "tail_image_url" },
  "Kling O1":              { t2v: "fal-ai/kling-video/v1.6/pro/text-to-video",       i2v: "fal-ai/kling-video/v1.6/pro/image-to-video",       imageParam: "image_url",       endParam: "tail_image_url" },
  // Edit Video tab pseudo-models (no t2v/i2v — posted to /api/edit-video-omni).
  // Listed here so VideoDetailModal + history filters can label entries.
  "Kling 3.0 Omni Edit":   { v2v_edit: "fal-ai/kling-video/o3/standard/video-to-video/reference" },
  "Kling O1 Video Edit":   { v2v_edit: "fal-ai/kling-video/o1/video-to-video/reference" },
  // Motion Control tab pseudo-models (no t2v/i2v — posted to /api/motion-control).
  "Kling Motion Control":     { motion: "fal-ai/kling-video/v2.6/standard/motion-control" },
  "Kling 3.0 Motion Control": { motion: "fal-ai/kling-video/v3/pro/motion-control" },
  // Wan uses image_url
  // Wan 2.6 runs on kie.ai (switched 2026-07-21): duration "5"|"10"|"15",
  // 720p/1080p, single image_urls entry for i2v.
  "Wan 2.6":               { provider: "kie", family: "jobs", kieModel: "wan/2-6-text-to-video", kieModelI2V: "wan/2-6-image-to-video", kieStyle: "wan" },
  "Wan 2.2":               { t2v: "fal-ai/wan-t2v",                                  i2v: "fal-ai/wan-i2v",                                   imageParam: "image_url",       endParam: null },
  "Wan 2.1":               { t2v: "fal-ai/wan-t2v",                                  i2v: "fal-ai/wan-i2v",                                   imageParam: "image_url",       endParam: null },
  // Seedance
  // Seedance 1.5 Pro runs on kie.ai (switched 2026-07-21): one jobs model,
  // i2v via input_urls (≤2), duration 4-12s int, 480/720/1080p.
  "Seedance 1.5 Pro":      { provider: "kie", family: "jobs", kieModel: "bytedance/seedance-1.5-pro", kieStyle: "seedance15" },
  // Seedance 2.x runs on kie.ai (switched from FAL 2026-07-20). One jobs
  // model per variant handles t2v/i2v/reference via first_frame_url /
  // last_frame_url / reference_*_urls — dispatched in /api/generate-video-ref.
  // Model id taken from kie's own page: "Complete guide to using
  // bytedance/seedance-2-5". Same Jobs API path as 2.x — no new plumbing.
  "Seedance 2.5":          { provider: "kie", family: "jobs", kieModel: "bytedance/seedance-2-5" },
  "Seedance 2.0":          { provider: "kie", family: "jobs", kieModel: "bytedance/seedance-2" },
  "Seedance 2.0 Fast":     { provider: "kie", family: "jobs", kieModel: "bytedance/seedance-2-fast" },
  "Seedance 2.0 Mini":     { provider: "kie", family: "jobs", kieModel: "bytedance/seedance-2-mini" },
  "Seedance 1":            { t2v: "fal-ai/bytedance/seedance-1-lite-t2v",            i2v: "fal-ai/kling-video/v3/pro/image-to-video",         imageParam: "start_image_url", endParam: "end_image_url" },
  // Others
  "LTX 2":                 { t2v: "fal-ai/ltx-video-13b-distilled",                  i2v: "fal-ai/kling-video/v3/pro/image-to-video",         imageParam: "start_image_url", endParam: "end_image_url" },
  "Hailuo 2.3":            { t2v: "fal-ai/minimax/video-01",                         i2v: "fal-ai/minimax/video-01",                          imageParam: "image_url",       endParam: null },
  "Hailuo T2V-01":         { t2v: "fal-ai/minimax/video-01",                         i2v: "fal-ai/minimax/video-01",                          imageParam: "image_url",       endParam: null },
  "Hailuo T2V-01 Director":{ t2v: "fal-ai/minimax/video-01-director",                i2v: "fal-ai/minimax/video-01",                          imageParam: "image_url",       endParam: null },
  "PixVerse 5":            { t2v: "fal-ai/pixverse/v4.5/text-to-video",              i2v: "fal-ai/kling-video/v3/pro/image-to-video",         imageParam: "start_image_url", endParam: "end_image_url" },
  "Vidu Q3":               { t2v: "fal-ai/vidu/q1",                                  i2v: "fal-ai/kling-video/v3/pro/image-to-video",         imageParam: "start_image_url", endParam: "end_image_url" },
  "Vidu Q2":               { t2v: "fal-ai/vidu/q1",                                  i2v: "fal-ai/kling-video/v3/pro/image-to-video",         imageParam: "start_image_url", endParam: "end_image_url" },
  // Veo 3 runs on kie.ai (repointed from FAL 2026-07-20 — kie is cheaper).
  // kie's Veo endpoint natively supports i2v via imageUrls, so no separate
  // i2v mapping is needed. Old in-flight FAL jobs keep completing: their
  // history rows store the unprefixed FAL model_id → FAL polling path.
  "Veo 3":                 { provider: "kie", kieModel: "veo3" },
  "Veo 3 Fast":            { provider: "kie", kieModel: "veo3_fast" },
  // Veo 3.1 runs on kie.ai (switched 2026-07-21) — kie's veo endpoint IS the
  // Veo 3.1 API (model veo3 = Quality tier, veo3_fast = Fast tier).
  "Veo 3.1":               { provider: "kie", kieModel: "veo3" },
  // Sora 2 runs on kie.ai (switched 2026-07-21) — REAL Sora 2 (the old FAL
  // entry silently ran Kling). Minimal input: prompt + optional image.
  "Sora 2":                { provider: "kie", family: "jobs", kieModel: "sora-2-text-to-video", kieModelI2V: "sora-2-image-to-video", kieStyle: "sora" },
  "Luma Dream Machine":    { t2v: "fal-ai/luma-dream-machine",                       i2v: "fal-ai/luma-dream-machine/image-to-video",         imageParam: "image_url",       endParam: null },
  // Grok Imagine runs on kie.ai (switched 2026-07-21): duration 6-30s int,
  // 480p/720p, modes fun/normal/spicy (we always send normal).
  "Grok Imagine":          { provider: "kie", family: "jobs", kieModel: "grok-imagine/text-to-video", kieModelI2V: "grok-imagine/image-to-video", kieStyle: "grok" },
  "Nano Banana Pro Video": { t2v: "fal-ai/kling-video/v1.6/pro/text-to-video",       i2v: "fal-ai/kling-video/v1.6/pro/image-to-video",       imageParam: "image_url",       endParam: "tail_image_url" },
};

const QUALITY_DIM = { "Draft": 512, "1K": 1024, "2K": 1536, "4K": 2048 };
const RESOLUTION_MAP = { "Draft": "0.5K", "1K": "1K", "2K": "2K", "4K": "4K" };

function getDimensions(ratio, quality) {
  const base = QUALITY_DIM[quality] || 1024;
  const parts = (ratio || "16:9").split(":").map(Number);
  const [w, h] = parts.length === 2 ? parts : [16, 9];
  if (w >= h) {
    return { width: base, height: Math.round(base * h / w / 8) * 8 };
  } else {
    return { height: base, width: Math.round(base * w / h / 8) * 8 };
  }
}

// Build the kie.ai request POST body per model family. Each family has its
// own param names/enums (verified against docs.kie.ai) — normalize our
// generic { prompt, ratio, quality, imageUrls } into what that family
// expects. Dedicated families take the input at the body root; the Jobs API
// wraps it as { model, input }.
function buildKieImageInput(cfg, { prompt, ratio, quality, imageUrls }) {
  const hasImages = imageUrls.length > 0;
  if (cfg.family === 'jobs') {
    // Jobs models use 1K/2K/4K resolutions; Draft maps to 1K (no 0.5K tier).
    const resolution = ['2K', '4K'].includes(RESOLUTION_MAP[quality]) ? RESOLUTION_MAP[quality] : '1K';
    // Nano Banana Pro / Nano Banana 2: one model for t2i + edit (image_input).
    if (cfg.kieModel.startsWith('nano-banana')) {
      return {
        model: cfg.kieModel,
        input: {
          prompt,
          aspect_ratio: ratio || 'auto',
          resolution,
          output_format: 'png',
          ...(hasImages ? { image_input: imageUrls.slice(0, cfg.kieModel === 'nano-banana-2' ? 14 : 8) } : {}),
        },
      };
    }
    // Imagen 4 (Fast / Default / Ultra). Text-to-image only. kie exposes NO
    // resolution parameter here, and `seed` is an integer on imagen4-fast but
    // a STRING on the other two — so neither is sent. 'auto' IS valid.
    if (cfg.kieStyle === 'imagen4') {
      return {
        model: cfg.kieModel,
        input: {
          prompt,
          aspect_ratio: ['1:1', '16:9', '9:16', '3:4', '4:3', 'auto'].includes(ratio) ? ratio : 'auto',
        },
      };
    }
    // Seedream 5 Pro. `quality` is TWO-valued here — basic = 1K, high = 2K.
    // The Lite variant below has a THREE-value enum; they are different
    // models and the enums must not be shared. Separate t2i / i2i ids.
    if (cfg.kieStyle === 'seedream5pro') {
      const AR = ['1:1', '4:3', '3:4', '16:9', '9:16', '2:3', '3:2', '21:9'];
      return {
        model: hasImages ? cfg.kieModelI2I : cfg.kieModel,
        input: {
          prompt,
          aspect_ratio: AR.includes(ratio) ? ratio : '1:1',
          quality: resolution === '1K' ? 'basic' : 'high',
          output_format: 'png',
          ...(hasImages ? { image_urls: imageUrls.slice(0, 10) } : {}),
        },
      };
    }
    // Seedream 5.0 Lite: t2i only; quality 'basic' (2K) / 'high' (4K).
    if (cfg.kieModel.startsWith('seedream/')) {
      return {
        model: cfg.kieModel,
        input: {
          prompt,
          aspect_ratio: ratio && ratio !== 'auto' ? ratio : '1:1',
          quality: RESOLUTION_MAP[quality] === '4K' ? 'high' : 'basic',
          output_format: 'png',
        },
      };
    }
    // GPT Image 1.5: separate t2i / i2i ids; minimal documented input
    // (prompt + input_urls) — omit sizing fields kie may not accept.
    if (cfg.kieModel.startsWith('gpt-image/')) {
      return {
        model: hasImages ? (cfg.kieModelI2I || cfg.kieModel) : cfg.kieModel,
        input: {
          prompt,
          ...(hasImages ? { input_urls: imageUrls.slice(0, 16) } : {}),
        },
      };
    }
    // Flux 2 Pro: t2i only — {prompt, aspect_ratio, resolution}.
    if (cfg.kieModel.startsWith('flux-2/')) {
      return {
        model: cfg.kieModel,
        input: {
          prompt,
          aspect_ratio: ratio && ratio !== 'auto' ? ratio : '1:1',
          resolution,
        },
      };
    }
    // GPT Image 2: separate t2i / i2i model ids; i2i takes input_urls.
    return {
      model: hasImages ? (cfg.kieModelI2I || cfg.kieModel) : cfg.kieModel,
      input: {
        prompt,
        aspect_ratio: ratio || 'auto',
        resolution,
        ...(hasImages ? { input_urls: imageUrls.slice(0, 16) } : {}),
      },
    };
  }
  if (cfg.family === 'gpt4o') {
    // 4o only supports 1:1 / 3:2 / 2:3 — snap to the closest orientation.
    const portrait = ['9:16', '3:4', '2:3'].includes(ratio);
    const size = ratio === '1:1' || !ratio ? '1:1' : (portrait ? '2:3' : '3:2');
    return { prompt, size, ...(hasImages ? { filesUrl: imageUrls.slice(0, 5) } : {}) };
  }
  if (cfg.family === 'flux') {
    const allowed = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'];
    return {
      prompt,
      model: cfg.kieModel || 'flux-kontext-pro',
      aspectRatio: allowed.includes(ratio) ? ratio : '1:1',
      outputFormat: 'png',
      ...(hasImages ? { inputImage: imageUrls[0] } : {}),
    };
  }
  if (cfg.family === 'mj') {
    return {
      taskType: hasImages ? 'mj_img2img' : 'mj_txt2img',
      prompt,
      speed: 'fast',
      version: '7',
      ...(ratio ? { aspectRatio: ratio } : {}),
      ...(hasImages ? { fileUrl: imageUrls[0] } : {}),
    };
  }
  throw new Error(`kie.ai: no input builder for family "${cfg.family}"`);
}

// ─── ASYNC VIDEO CHARGE TRACKING ───────────────────────────────────
// Async video jobs charge credits at submit time, but the generation can
// fail MINUTES later at the provider. Every async submit records its charge
// so /api/video-status can auto-refund (exactly once) when a job reaches
// FAILED.
//
// H4 (audit 2026-07-28): this used to be an in-memory Map, so a deploy or
// restart in that window erased every in-flight charge and the user was
// never refunded. It now lives in the `pending_video_charges` table
// (video-charges.js) and unresolved rows are reconciled with the provider
// at boot. The exactly-once guarantee is the row's status transition —
// same refunded-flag-before-payout shape, moved into the database.

// Build the kie.ai submission for a video model: which family endpoint to
// hit, the POST body, and the 'kie:'-prefixed model_id the status routes
// parse ('kie:jobs:' → Jobs API, plain 'kie:' → dedicated Veo endpoints).
// Shared by /api/generate-video and the legacy /api/generate video branch.
function buildKieVideoSubmission(mapping, { prompt, frames, duration, aspectRatio, resolution, audio = false, multiShots = false }) {
  if (mapping.family === 'jobs' && mapping.kieModel === 'kling-3.0/video') {
    // Kling 3.0: one model for t2v + i2v; quality via mode (std 720p /
    // pro 1080p / 4K); duration string "3"-"15".
    // Per kie's spec: multi_shots=false → single continuous shot, image_urls
    // [start] or [start, end] frames. multi_shots=true (user's Multi Shot
    // toggle) → Kling splits into shots; only the FIRST frame is supported.
    const dur = Math.min(15, Math.max(3, parseInt(duration, 10) || 5));
    // std = 720p, pro = 1080p, 4K. This USED to send 'pro' for every
    // non-4K request, so a user who picked 720p silently received (and we
    // paid for) 1080p. Now that 720p is priced at its own cheaper rate,
    // sending 'pro' would mean charging the 720p price while paying the
    // 1080p cost — so the mapping has to be honest.
    const resU = String(resolution).toUpperCase();
    const mode = resU === '4K' ? '4K' : (resU === '720P' ? 'std' : 'pro');
    const ms = !!multiShots;
    return {
      family: 'jobs',
      body: {
        model: mapping.kieModel,
        input: {
          prompt,
          aspect_ratio: ['16:9', '9:16', '1:1'].includes(aspectRatio) ? aspectRatio : '16:9',
          duration: String(dur),
          mode,
          // sound follows the user's Audio toggle — credits are priced per
          // audio tier (2.5 vs 4 cr/s), so charge and generation must match.
          sound: !!audio,
          multi_shots: ms,
          ...(frames.length ? { image_urls: ms ? [frames[0]] : frames } : {}),
        },
      },
      modelIdTag: 'kie:jobs:' + mapping.kieModel,
    };
  }
  if (mapping.family === 'jobs' && mapping.kieStyle === 'sora') {
    // Sora 2: minimal documented input — prompt (+ single image for i2v).
    const kieModel = frames.length ? (mapping.kieModelI2V || mapping.kieModel) : mapping.kieModel;
    return {
      family: 'jobs',
      body: {
        model: kieModel,
        input: {
          prompt,
          ...(frames.length ? { image_urls: [frames[0]] } : {}),
        },
      },
      modelIdTag: 'kie:jobs:' + kieModel,
    };
  }
  if (mapping.family === 'jobs' && mapping.kieStyle === 'wan') {
    // Wan 2.6: duration "5"|"10"|"15" (string), 720p/1080p, single image i2v.
    const kieModel = frames.length ? (mapping.kieModelI2V || mapping.kieModel) : mapping.kieModel;
    const durNum = parseInt(duration, 10) || 5;
    const dur = durNum >= 13 ? '15' : durNum >= 8 ? '10' : '5';
    return {
      family: 'jobs',
      body: {
        model: kieModel,
        input: {
          prompt,
          duration: dur,
          resolution: String(resolution).toLowerCase() === '1080p' ? '1080p' : '720p',
          ...(frames.length ? { image_urls: [frames[0]] } : {}),
        },
      },
      modelIdTag: 'kie:jobs:' + kieModel,
    };
  }
  if (mapping.family === 'jobs' && mapping.kieStyle === 'seedance15') {
    // Seedance 1.5 Pro: one model; i2v via input_urls (≤2); duration 4-12 int.
    const res = ['480p', '720p', '1080p'].includes(String(resolution).toLowerCase())
      ? String(resolution).toLowerCase() : '720p';
    return {
      family: 'jobs',
      body: {
        model: mapping.kieModel,
        input: {
          prompt,
          aspect_ratio: ['1:1', '4:3', '3:4', '16:9', '9:16', '21:9'].includes(aspectRatio) ? aspectRatio : '16:9',
          duration: Math.min(12, Math.max(4, parseInt(duration, 10) || 5)),
          resolution: res,
          generate_audio: true,
          ...(frames.length ? { input_urls: frames.slice(0, 2) } : {}),
        },
      },
      modelIdTag: 'kie:jobs:' + mapping.kieModel,
    };
  }
  if (mapping.family === 'jobs' && mapping.kieStyle === 'geminiOmni') {
    // Gemini Omni. duration is a STRING enum ('4'|'6'|'8'|'10') — snapped to
    // the nearest allowed value, never passed through raw. resolution accepts
    // lowercase '4k'. Reference images ride in image_urls (max 7, and kie
    // enforces a 7-unit budget where each image counts 1).
    const ALLOWED = [4, 6, 8, 10];
    const want = parseInt(duration, 10) || 6;
    const dur = ALLOWED.reduce((a, b) => (Math.abs(b - want) < Math.abs(a - want) ? b : a));
    const r = String(resolution).toLowerCase();
    const res = r.includes('4k') ? '4k' : r.includes('1080') ? '1080p' : '720p';
    return {
      family: 'jobs',
      body: {
        model: mapping.kieModel,
        input: {
          prompt,
          duration: String(dur),
          resolution: res,
          aspect_ratio: aspectRatio === '9:16' ? '9:16' : '16:9',
          ...(frames.length ? { image_urls: frames.slice(0, 7) } : {}),
        },
      },
      modelIdTag: 'kie:jobs:' + mapping.kieModel,
    };
  }
  if (mapping.family === 'jobs' && mapping.kieStyle === 'klingTurbo') {
    // Kling 3.0 Turbo. Schema differs from Kling 3.0 in three ways, all
    // verified against kie's OpenAPI spec:
    //   • `resolution` ("720p"|"1080p") — NOT Kling 3.0's `mode` std/pro/4K
    //   • no `sound` parameter at all (so the Audio toggle cannot apply)
    //   • the i2v variant takes no aspect_ratio (it adopts the image's)
    // Separate model ids for t2v and i2v; the first frame rides in
    // image_urls, exactly as Kling 3.0 does.
    const isI2V = frames.length > 0;
    const kieModel = isI2V ? mapping.kieModelI2V : mapping.kieModel;
    const dur = Math.min(15, Math.max(3, parseInt(duration, 10) || 5));
    const res = String(resolution).toLowerCase() === '1080p' ? '1080p' : '720p';
    return {
      family: 'jobs',
      body: {
        model: kieModel,
        input: {
          prompt,
          duration: String(dur),
          resolution: res,
          // t2v accepts aspect_ratio; i2v derives it from the source image.
          ...(isI2V
            ? { image_urls: [frames[0]] }
            : { aspect_ratio: ['1:1', '9:16', '16:9'].includes(aspectRatio) ? aspectRatio : '16:9' }),
        },
      },
      modelIdTag: 'kie:jobs:' + kieModel,
    };
  }
  if (mapping.family === 'jobs' && mapping.kieStyle === 'grok') {
    // Grok Imagine: duration 6-30s int, 480p/720p, mode normal.
    const kieModel = frames.length ? (mapping.kieModelI2V || mapping.kieModel) : mapping.kieModel;
    return {
      family: 'jobs',
      body: {
        model: kieModel,
        input: {
          prompt,
          aspect_ratio: ['2:3', '3:2', '1:1', '16:9', '9:16'].includes(aspectRatio) ? aspectRatio : '16:9',
          mode: 'normal',
          duration: Math.min(30, Math.max(6, parseInt(duration, 10) || 6)),
          resolution: String(resolution).toLowerCase() === '720p' ? '720p' : '480p',
          ...(frames.length ? { image_urls: [frames[0]] } : {}),
        },
      },
      modelIdTag: 'kie:jobs:' + kieModel,
    };
  }
  if (mapping.family === 'jobs') {
    // Kling 2.6: separate t2v/i2v ids; duration only "5" or "10"; i2v takes
    // a single image_urls entry and no aspect_ratio.
    const kieModel = frames.length ? (mapping.kieModelI2V || mapping.kieModel) : mapping.kieModel;
    const dur = (parseInt(duration, 10) || 5) >= 8 ? '10' : '5';
    return {
      family: 'jobs',
      body: {
        model: kieModel,
        input: {
          prompt,
          // Kling 2.6 is priced per audio tier (1.5 vs 2.9 cr/s) — honor the
          // user's Audio toggle so charge and generation match.
          sound: !!audio,
          duration: dur,
          ...(frames.length
            ? { image_urls: [frames[0]] }
            : { aspect_ratio: ['16:9', '9:16', '1:1'].includes(aspectRatio) ? aspectRatio : '16:9' }),
        },
      },
      modelIdTag: 'kie:jobs:' + kieModel,
    };
  }
  // Veo 3 / Veo 3.1 / Veo 3 Fast (dedicated veo endpoints). Resolution is
  // priced per tier (720p/1080p/4k) so pass the user's choice through.
  const veoRes = ['720P', '1080P', '4K'].includes(String(resolution).toUpperCase())
    ? String(resolution).toLowerCase()
    : '1080p';
  return {
    family: 'veo',
    body: {
      prompt,
      model: mapping.kieModel,
      aspect_ratio: aspectRatio === '9:16' ? '9:16' : '16:9',
      resolution: veoRes,
      ...(frames.length ? { imageUrls: frames } : {}),
    },
    modelIdTag: 'kie:' + mapping.kieModel,
  };
}

// Per-user model allow-list gate (CRM Bulk tab): NULL/absent = every model.
// Checked AFTER model resolution and BEFORE charging, so restricted users
// are never billed for a blocked attempt.
function modelAllowedForUser(req, model) {
  const list = req.userAccess?.allowedModels;
  return !Array.isArray(list) || list.length === 0 || list.includes(model);
}
const MODEL_BLOCKED = (model) =>
  ({ error: `Your account does not include ${model}. Contact support to enable it.` });

// ─── GENERATE ENDPOINT ─────────────────────────────────────────────
// Auth + credit gating:
//   1. verifyJwt — must be logged in
//   2. requireNotBanned — banned users immediately blocked (no JWT revocation needed)
//   3. requireModelProviderKey — server must have the key for the model's provider (FAL or kie.ai)
//   4. chargeCredits — atomic balance deduct + history insert; 402 if insufficient
//   5. If the provider call fails → refundCredits so the user isn't billed for nothing
// ─── REFERENCE URL RESOLUTION ──────────────────────────────────────
// User reference images normally arrive as public https urls, but /api/upload
// falls back to a base64 data: URI when neither Spaces nor FAL storage
// accepts the file (FAL keys without the storage scope 403 there). FAL
// inference accepts data: URIs natively, but kie.ai only fetches public
// http(s) urls — so the old `startsWith('http')` filter silently dropped
// those refs and the generation quietly degraded to text-to-image without
// the user's character.
//
// Resolution: keep http(s) refs as-is; re-host data: refs (Spaces first,
// FAL storage second); a kie-bound ref that can't be re-hosted THROWS a
// named error — the route's catch refunds and the user sees the real reason
// instead of an output that ignored their upload.
async function resolveReferenceUrls(rawUrls, { forKie = false, tag = 'REFS' } = {}) {
  const provided = Array.isArray(rawUrls) ? rawUrls.filter(Boolean).length : 0;
  const refs = Array.isArray(rawUrls)
    ? rawUrls.filter((u) => typeof u === 'string' && (/^https?:/i.test(u) || u.startsWith('data:')))
    : [];
  const out = [];
  for (const [i, ref] of refs.entries()) {
    if (/^https?:/i.test(ref)) { out.push(ref); continue; }

    const m = ref.match(/^data:([^;,]*);base64,(.+)$/s);
    if (!m) {
      console.error(`[${tag}] reference ${i + 1} is a non-base64 data URI — cannot use`);
      throw new Error('A reference image could not be read — please re-upload it and try again');
    }
    const contentType = m[1] || 'image/png';
    const buf = Buffer.from(m[2], 'base64');

    // N6 (recheck 2026-08-03): this path skipped validateUpload entirely.
    // /api/upload runs it on the multipart route, but references arriving as
    // data: URIs went straight to persistBuffer — which writes to Spaces with
    // ACL 'public-read' and the caller's OWN Content-Type. So any signed-in
    // user could host arbitrary content (data:text/html;base64,...) on our
    // bucket, under our domain, for free — and the object survived even when
    // the generation then failed and the credits were refunded.
    //
    // Same validator, same rules as the multipart path: the declared type must
    // be an allowed media type AND the magic bytes must actually match it.
    // Throwing here is correct — the charge already happened above, so the
    // route's catch refunds and the user is told why their file was rejected.
    const verdict = validateUpload({ mimetype: contentType, buffer: buf });
    if (!verdict.ok) {
      console.error(`[${tag}] reference ${i + 1} rejected: ${verdict.reason}`);
      throw new Error(`A reference file was rejected: ${verdict.reason}`);
    }

    if (spacesReady()) {
      try {
        const url = await persistBuffer(buf, contentType, 'reference');
        console.log(`[${tag}] re-hosted data-URI reference ${i + 1} → ${url}`);
        out.push(url);
        continue;
      } catch (e) {
        console.error(`[${tag}] Spaces re-host failed for reference ${i + 1}:`, e.message);
      }
    }
    try {
      const url = await fal.storage.upload(new Blob([buf], { type: contentType }));
      if (typeof url !== 'string') throw new Error('storage returned no url');
      console.log(`[${tag}] re-hosted data-URI reference ${i + 1} via provider storage → ${url}`);
      out.push(url);
      continue;
    } catch (e) {
      console.error(`[${tag}] provider storage re-host failed for reference ${i + 1}:`, e.message);
    }

    if (forKie) {
      // kie.ai cannot fetch data: URIs — but it has its own file storage
      // that accepts base64 and returns a public url (expires ~3 days;
      // fine for a reference fetched within seconds). Last host in line
      // because Spaces urls are durable and provider-neutral.
      try {
        const url = await kieUploadBuffer(buf, contentType, { tag });
        out.push(url);
        continue;
      } catch (e) {
        console.error(`[${tag}] kie storage re-host failed for reference ${i + 1}:`, e.message);
      }
      // No host would take the file — without a public url the reference
      // would be silently ignored. Fail loudly + refund instead.
      throw new Error('Your reference image could not be prepared — please try again in a moment');
    }
    // FAL accepts base64 data URIs directly in place of file urls.
    console.log(`[${tag}] passing data-URI reference ${i + 1} through (base64 accepted)`);
    out.push(ref);
  }
  // Refs were provided but none survived → the output would silently miss
  // the user's character. Fail + refund instead of degrading to text-only.
  if (provided > 0 && out.length === 0) {
    throw new Error('Your reference image could not be processed — please re-upload it and try again');
  }
  return out;
}

// C1: compute the authoritative server-side price for a generation request.
// Returns the cost to charge, or null AFTER writing the error response —
// 400 when the model has no price on file (never guess a price), 409 when
// the client's display hint disagrees with the server table (stale UI must
// never silently pay a different price than it showed).
function priceOrRespond(res, opts) {
  try {
    return resolveChargeCost(opts);
  } catch (e) {
    if (e instanceof UnpricedModelError) {
      console.error(`[pricing] no price on file for model "${opts.model}" (kind=${opts.kind}) — request rejected`);
      res.status(400).json({ error: `This model has no price on file yet — generation rejected. Please contact support.` });
      return null;
    }
    if (e instanceof PriceMismatchError) {
      console.error(`[pricing] price mismatch for "${opts.model}": client sent ${e.clientCost}, server computed ${e.correctCost}`);
      res.status(409).json({
        error: `Price out of date: this generation costs ${e.correctCost} credits. Please refresh the page and try again.`,
        correct_cost: e.correctCost,
      });
      return null;
    }
    throw e;
  }
}

app.post('/api/generate', verifyJwt, requireNotBanned, noDoubleCharge, requireModelProviderKey, async (req, res) => {
  const { model, prompt, type, duration, ratio, imageUrls, negativePrompt, quality, numImages, safetyTolerance } = req.body;

  console.log('=== REQUEST ===', { model, type, imageUrls: (imageUrls || []).length, quality, ratio, numImages, user: req.user?.email });

  if (!model || typeof model !== 'string') return res.status(400).json({ error: 'Invalid model' });
  if (!prompt || typeof prompt !== 'string') return res.status(400).json({ error: 'Prompt required' });
  if (!type || (type !== 'image' && type !== 'video')) return res.status(400).json({ error: 'Type must be image or video' });

  // Resolve the model BEFORE charging: an unknown model must 400 without
  // touching the balance (previously it was charged, 400'd, and never
  // refunded), and dispatch needs to know the provider up front.
  const cfg = type === 'image' ? MODEL_CONFIG[model] : null;
  const legacyVideoId = type === 'video' ? VIDEO_MODELS[model] : null;
  if (type === 'image' && !cfg) return res.status(400).json({ error: 'Unknown image model: ' + model });
  if (type === 'video' && !legacyVideoId && VIDEO_DIRECT_MAP[model]?.provider !== 'kie') {
    return res.status(400).json({ error: 'Unknown video model: ' + model });
  }

  if (!modelAllowedForUser(req, model)) return res.status(403).json(MODEL_BLOCKED(model));

  // C1: the price is computed server-side from pricing.js — the client's
  // credit_cost is validated as a hint only, never charged.
  const serverCost = priceOrRespond(res, {
    kind: type, model, quality,
    resolution: req.body.resolution, duration, audio: req.body.audio,
    clientCost: req.body.credit_cost,
  });
  if (serverCost == null) return;

  // Charge BEFORE the provider call so a user can't burn through quota by
  // spamming requests that race past the balance check.
  let chargedKind = null;
  let chargedCost = null;
  let chargedLabel = null;
  try {
    // Provider-cost estimate rides along on the ledger row: KIE credits
    // when the model burns our kie.ai balance, FAL USD when it bills fal.
    const isKie = cfg?.provider === 'kie' || VIDEO_DIRECT_MAP[model]?.provider === 'kie';
    const estOpts = { kind: type, model, quality, resolution: req.body.resolution, duration, audio: req.body.audio };
    const charge = await chargeCredits({
      userId: req.user.id, kind: type, ip: clientIp(req), cost: serverCost, note: `${type}: ${model}`,
      provider: isKie ? 'kie' : 'fal',
      kieCredits: isKie ? estimateKieCredits(estOpts) : null,
      falCost: isKie ? null : estimateFalCost(estOpts),
    });
    chargedKind = type;
    chargedCost = charge.cost;
    chargedLabel = charge.label;
    res.setHeader('X-Credits-Remaining', String(charge.newBalance));
  } catch (e) {
    if (e instanceof InsufficientCreditsError) {
      return res.status(402).json({
        error: 'Not enough credits, please contact admin',
        current_balance: e.balance,
        required: e.required,
      });
    }
    if (e.code === 'BANNED') {
      return res.status(403).json({ error: 'Account is banned.' });
    }
    console.error('[charge] error:', e);
    return res.status(500).json({ error: 'Credit charge failed.' });
  }

  try {
    // ── IMAGE GENERATION ──
    if (type === 'image') {
      const readyUrls = await resolveReferenceUrls(imageUrls, {
        forKie: cfg.provider === 'kie', tag: 'REFS-IMG',
      });
      const hasImages = readyUrls.length > 0;

      // ── kie.ai-backed image models: createTask → poll → re-host ──
      // Synchronous within the request like fal.subscribe. Poll capped at 90s
      // (< Cloudflare's ~100s proxied-request limit, < the frontend's 180s
      // axios timeout). Throws fall into the catch below → refund + named error.
      if (cfg.provider === 'kie') {
        const mode = hasImages ? (readyUrls.length >= 2 ? 'multi-image-edit' : 'image-to-image') : 'text-to-image';
        const kieInput = buildKieImageInput(cfg, { prompt, ratio, quality, imageUrls: readyUrls });
        const taskId = await kieCreateTask(cfg.family, kieInput, { tag: 'KIE-IMG' });

        let done;
        try {
          done = await kiePollUntilDone(cfg.family, taskId, { timeoutMs: 90_000, tag: 'KIE-IMG' });
        } catch (e) {
          // ── THE HAND-OFF (2026-08-28) ──
          // Only for running out of PATIENCE. A real provider failure still
          // falls through to the catch below and refunds, as it should.
          //
          // On 28 August six customers were told their image failed. All six
          // had actually succeeded — at 94, 97, 125, 130, 144 and 314 seconds
          // — and we had paid for every one. Waiting longer is not the fix:
          // Cloudflare cuts a proxied request at about 100s, so a bigger
          // timeout only moves the failure somewhere we cannot refund from.
          //
          // So the REQUEST ends and the JOB continues. Recorded BEFORE the
          // response goes out: if this insert throws, the customer gets the
          // old refund rather than a promise nothing is keeping.
          if (!e?.gaveUp) throw e;
          await pool.query(RECORD_SQL, [taskId, req.user.id, cfg.family,
            model || null, prompt || null, ratio || null, quality || null]);
          // The `kie:<family>:` prefix is not decoration — it is how the boot
          // reconciler knows WHICH provider to ask about this charge. A bare
          // model name reads as a FAL request id and the charge sits pending
          // forever; that is the exact shape of the 124 stuck charges.
          await trackVideoCharge(taskId, { userId: req.user.id, kind: chargedKind, cost: chargedCost, modelLabel: chargedLabel, modelId: `kie:${cfg.family}:${cfg.kieModel || 'image'}` });
          console.log(`[KIE-IMG] handed off taskId=${taskId} user=${req.user.id} — the job continues`);
          return res.json({
            success: true, type: 'image', pending: true, job_id: taskId, mode,
            message: 'This one is taking longer than usual. It will finish on its own — '
              + 'it appears here and in your history the moment it does, and you keep your credits '
              + 'only if it fails.',
          });
        }

        // kie result urls expire after ~14 days — re-host to our Spaces
        // bucket so history stays durable (same as FAL outputs). The small
        // version is made from the SAME download, so the grid has one from the
        // moment the picture exists — until 2026-08-28 only the admin backfill
        // ever made one, and the grid got slower again every day.
        const { url: durableUrl, thumbUrl } = await persistWithThumb(
          done.resultUrls[0], 'image', { makeThumb: makeThumbnail });
        // Midjourney returns 4 images per task; surface the extras so the
        // client can use them later without another charge.
        const extra = done.resultUrls.slice(1);
        return res.json({
          success: true,
          type: 'image',
          result_url: durableUrl,
          // The browser writes the history row, so the thumbnail has to travel
          // to it. A thumb_url the client never sends is a field nothing reads.
          ...(thumbUrl ? { thumb_url: thumbUrl } : {}),
          ...(extra.length ? { result_urls: [durableUrl, ...extra] } : {}),
          mode,
        });
      }

      let falModelId;
      let mode;
      let input;

      if (hasImages) {
        // ── IMAGE EDIT MODE (1-14 images, up to 5 character consistency) ──
        // Always use model's own edit endpoint (Nano Banana Pro/2 supports up to 14 images)
        falModelId = cfg.edit;
        mode = readyUrls.length >= 2 ? 'multi-image-edit' : 'image-to-image';

        console.log(`=== IMAGE EDIT (${readyUrls.length} image${readyUrls.length > 1 ? 's' : ''}) ===`);
        console.log('Model:', model, '→', falModelId);
        console.log('Image URLs:', readyUrls);
        console.log('Prompt:', prompt);

        // Force num_images=1 for multi-image composition to prevent model drift
        const effectiveNumImages = readyUrls.length >= 2 ? 1 : (numImages || 1);

        input = {
          prompt,
          image_urls: readyUrls,
          num_images: effectiveNumImages,
          safety_tolerance: safetyTolerance || '4',
          limit_generations: true,
          ...(cfg.nativeSizing
            ? { aspect_ratio: ratio || 'auto', resolution: RESOLUTION_MAP[quality] || '1K' }
            : {}
          ),
        };

      } else {
        // ── TEXT-TO-IMAGE MODE (no images) ──
        falModelId = cfg.t2i;
        mode = 'text-to-image';

        console.log('=== TEXT-TO-IMAGE ===');
        console.log('Model:', model, '→', falModelId);

        const { width, height } = getDimensions(ratio, quality);
        input = {
          prompt,
          num_images: numImages || 1,
          safety_tolerance: safetyTolerance || '4',
          ...(negativePrompt ? { negative_prompt: negativePrompt } : {}),
          ...(cfg.nativeSizing
            ? { aspect_ratio: ratio || '16:9', resolution: RESOLUTION_MAP[quality] || '1K' }
            : { image_size: { width, height } }
          ),
        };
      }

      console.log('[FAL PAYLOAD FINAL]', JSON.stringify({ model: falModelId, input }, null, 2));

      const result = await falSubscribe(falModelId, {
        input,
        logs: true,
        onQueueUpdate: (update) => {
          console.log('[FAL STATUS]', update.status, update.logs?.length ? `(${update.logs.length} logs)` : '');
        },
      }, 'FAL-IMAGE');

      console.log('[FAL RESPONSE]', JSON.stringify(result?.data || result, null, 2).substring(0, 1000));

      const imageUrl =
        result?.data?.images?.[0]?.url ||
        result?.data?.image?.url ||
        result?.images?.[0]?.url ||
        result?.image?.url ||
        null;

      if (!imageUrl) {
        console.error('[FAL] Empty result payload:', JSON.stringify(result));
        // Try to pull a human-readable reason from FAL's response if present
        const falError =
          result?.data?.error ||
          result?.error ||
          result?.data?.detail ||
          result?.detail ||
          null;
        const reason = typeof falError === 'string'
          ? falError
          : (falError ? JSON.stringify(falError) : 'No image returned. Please try again.');
        // The user paid for an image and got none — refund before returning.
        // (This early-return path used to skip the catch-block refund.)
        if (chargedKind) {
          refundCredits({
            userId: req.user.id, kind: chargedKind, ip: clientIp(req), cost: chargedCost,
            reason: `fal_empty_result: ${reason}`.slice(0, 500),
          }).catch(() => {});
        }
        // No details in the response — the raw provider payload is already
        // in the server logs and must not reach the client.
        return res.status(500).json({ error: publicError(reason) });
      }

      // Copy FAL's ephemeral output into our own Spaces bucket so the image
      // survives in history after FAL purges its link. Falls back to the FAL
      // url if Spaces isn't configured or the copy fails.
      const durableUrl = await persistOrFallback(imageUrl, 'image');
      // Image generation is synchronous, so reaching here IS delivery. Video
      // is not — a 200 there only means the job was accepted, which is why
      // video is settled from settleVideoCharge() instead.
      // By user rather than by event id: the charge is made in an outer scope
      // and threading its id down here is precisely the kind of parameter that
      // gets forgotten at the next call site. settleAttempt closes this user's
      // most recent open attempt, which inside a single synchronous request is
      // unambiguous.
      settleAttempt({ userId: req.user.id, outcome: 'delivered' }).catch(() => {});
      return res.json({ success: true, type: 'image', result_url: durableUrl, mode });
    }

    // ── VIDEO GENERATION ──
    if (type === 'video') {
      const readyUrls = await resolveReferenceUrls(imageUrls, {
        forKie: VIDEO_DIRECT_MAP[model]?.provider === 'kie', tag: 'REFS-VID',
      });
      const hasFrames = readyUrls.length > 0;

      // kie.ai-backed video (Veo 3 / Kling): async task; the kie:-prefixed
      // model_id tells /api/video-status to poll kie instead of FAL.
      const directMapping = VIDEO_DIRECT_MAP[model];
      if (directMapping?.provider === 'kie') {
        const { family, body, modelIdTag } = buildKieVideoSubmission(directMapping, {
          prompt, frames: readyUrls.slice(0, 2), duration, aspectRatio: ratio,
        });
        const taskId = await kieCreateTask(family, body, { tag: 'KIE-VIDEO' });
        await trackVideoCharge(taskId, { userId: req.user.id, kind: chargedKind, cost: chargedCost, modelLabel: chargedLabel, modelId: modelIdTag });
        return res.json({ success: true, type: 'video', job_id: taskId, model_id: modelIdTag });
      }

      let modelId = legacyVideoId;

      // Switch to image-to-video endpoint if frames provided
      if (hasFrames) {
        modelId = modelId.replace('/text-to-video', '/image-to-video');
      }

      console.log('=== VIDEO GENERATION ===');
      console.log('Model:', model, '→', modelId);
      console.log('Mode:', hasFrames ? 'image-to-video' : 'text-to-video');
      console.log('Frames:', readyUrls.length);

      const input = {
        prompt,
        duration: String(duration || 5),
        aspect_ratio: ratio || '16:9',
        ...(negativePrompt ? { negative_prompt: negativePrompt } : {}),
        ...(hasFrames ? { image_url: readyUrls[0] } : {}),
        ...(readyUrls.length > 1 ? { tail_image_url: readyUrls[1] } : {}),
      };

      const submitted = await fal.queue.submit(modelId, { input });
      await trackVideoCharge(submitted.request_id, { userId: req.user.id, kind: chargedKind, cost: chargedCost, modelLabel: chargedLabel, modelId: modelId });
      return res.json({ success: true, type: 'video', job_id: submitted.request_id, model_id: modelId });
    }

    return res.status(400).json({ error: 'Unsupported type' });

  } catch (error) {
    console.error('=== GENERATION ERROR ===');
    console.error('Model:', model);
    console.error('Message:', error.message);
    console.error('Status:', error.status);
    console.error('StatusCode:', error.statusCode);
    try { console.error('Body:', JSON.stringify(error.body)); } catch {}
    try { console.error('Response data:', JSON.stringify(error.response?.data)); } catch {}

    // Build a readable user-facing reason. Prefer FAL's own detail message.
    const bodyDetail =
      (typeof error.body === 'string' ? error.body : null) ||
      error.body?.detail ||
      error.body?.error ||
      error.body?.message ||
      error.response?.data?.detail ||
      error.response?.data?.error ||
      error.response?.data?.message ||
      null;
    const humanReason = typeof bodyDetail === 'string'
      ? bodyDetail
      : (bodyDetail ? JSON.stringify(bodyDetail) : error.message);

    // Refund the credits we deducted up front — the user shouldn't pay for
    // a generation that never happened. Best-effort; we don't fail the
    // response on a refund failure (we'd just be overwriting the real error).
    const providerTag =
      (MODEL_CONFIG[model]?.provider === 'kie' || VIDEO_DIRECT_MAP[model]?.provider === 'kie')
        ? 'kie_threw' : 'fal_threw';
    if (chargedKind) {
      refundCredits({
        userId: req.user.id,
        kind: chargedKind,
        ip: clientIp(req),
        cost: chargedCost,
        reason: `${providerTag}: ${humanReason}`.slice(0, 500),
      }).catch(() => {});
    }

    // No details in the response — raw provider payloads (which name the
    // upstream) are already logged server-side and must not reach the client.
    if (respondIfProviderTimeout(res, error)) return;
    return res.status(500).json({ error: 'Generation failed: ' + publicError(humanReason) });
  }
});

// ─── CHECK STATUS ENDPOINT ─────────────────────────────────────────
// M5 (audit 2026-07-28): was unauthenticated — anyone could poll any job
// id and read other users' generation results. Now auth + rate limit +
// ownership (404 on mismatch, same shape as the other ownership checks).
app.post('/api/checkStatus', verifyJwt, requireNotBanned, statusLimiter, async (req, res) => {
  const { job_id, model_id } = req.body;

  if (!job_id || typeof job_id !== 'string') return res.status(400).json({ error: 'Invalid job_id' });
  if (!model_id || typeof model_id !== 'string') return res.status(400).json({ error: 'Invalid model_id' });

  if (!(await userOwnsJob(req.user.id, job_id))) {
    return res.status(404).json({ error: 'Job not found.' });
  }

  // kie.ai jobs — same prefix convention as /api/video-status.
  if (model_id.startsWith('kie:')) {
    try {
      const family = model_id.startsWith('kie:jobs:') ? 'jobs' : 'veo';
      const t = await kieGetTask(family, job_id, { tag: 'KIE-STATUS' });
      if (t.state === 'success') {
        await settleVideoCharge(job_id); // completed — charge stands
        const durableUrl = await persistOrFallback(t.resultUrls[0], 'video');
        return res.json({ status: 'COMPLETED', video_url: durableUrl, image_url: null });
      }
      if (t.state === 'fail') {
        await refundFailedVideo(job_id, `kie: ${t.failMsg || 'generation failed'}`);
        return res.json({ status: 'FAILED', error: publicError(t.failMsg, 'Generation failed') });
      }
      return res.json({ status: 'IN_PROGRESS', queue_position: null });
    } catch (error) {
      console.error('[checkStatus] [KIE] error:', error.message);
      return res.status(500).json({ status: 'ERROR', error: 'Could not check status.' });
    }
  }

  try {
    const status = await fal.queue.status(model_id, {
      requestId: job_id,
      logs: false,
    });

    if (status.status === 'COMPLETED') {
      const result = await fal.queue.result(model_id, { requestId: job_id });

      const videoUrl =
        result.data?.video?.url ||
        result.data?.video_url ||
        result.data?.output?.video_url ||
        null;

      const imageUrl =
        result.data?.images?.[0]?.url ||
        result.data?.image?.url ||
        null;

      await settleVideoCharge(job_id); // completed — charge stands
      // Re-host outputs to our own Spaces bucket so history stays durable.
      const durableVideo = await persistOrFallback(videoUrl, 'video');
      const durableImage = await persistOrFallback(imageUrl, 'image');
      return res.json({ status: 'COMPLETED', video_url: durableVideo, image_url: durableImage });
    }

    if (status.status === 'FAILED') {
      await refundFailedVideo(job_id, 'fal: generation failed');
      return res.json({ status: 'FAILED', error: 'Generation failed. Please try again.' });
    }

    return res.json({ status: status.status, queue_position: status.queue_position || null });

  } catch (error) {
    console.error('Status check error:', error.message);
    return res.status(500).json({ status: 'ERROR', error: 'Could not check status.' });
  }
});

// ─── GENERATE VIDEO (new endpoint with polling) ───────────────────
app.post('/api/generate-video', verifyJwt, requireNotBanned, noDoubleCharge, requireModelProviderKey, async (req, res) => {
  const { model, prompt, image_url, tail_image_url, duration, aspect_ratio, resolution, audio, multi_shots } = req.body;

  if (!model) return res.status(400).json({ error: 'model name required' });
  if (!prompt) return res.status(400).json({ error: 'prompt required' });

  // Look up the model BEFORE charging — an unsupported model must 400
  // without touching the balance (previously it was charged and never
  // refunded), and dispatch needs the provider up front.
  const mapping = VIDEO_DIRECT_MAP[model];
  if (!mapping) {
    console.error(`[VIDEO] Model not supported: "${model}"`);
    return res.status(400).json({ error: `Model not supported: ${model}` });
  }

  if (!modelAllowedForUser(req, model)) return res.status(403).json(MODEL_BLOCKED(model));

  // C1: server-computed price; client credit_cost is a hint only.
  const serverCost = priceOrRespond(res, {
    kind: 'video', model, resolution, duration, audio,
    clientCost: req.body.credit_cost,
  });
  if (serverCost == null) return;

  // Charge BEFORE submission so we don't enqueue a job we can't bill for.
  let chargedKind = null;
  let chargedCost = null;
  let chargedLabel = null;
  try {
    const charge = await chargeCredits({
      userId: req.user.id, kind: 'video', ip: clientIp(req), cost: serverCost, note: `video: ${model}`,
      provider: mapping.provider === 'kie' ? 'kie' : 'fal',
      kieCredits: mapping.provider === 'kie' ? estimateKieCredits({ kind: 'video', model, resolution, duration, audio }) : null,
      falCost: mapping.provider === 'kie' ? null : estimateFalCost({ kind: 'video', model, resolution, duration, audio }),
    });
    chargedKind = 'video';
    chargedCost = charge.cost;
    chargedLabel = charge.label;
    res.setHeader('X-Credits-Remaining', String(charge.newBalance));
  } catch (e) {
    if (e instanceof InsufficientCreditsError) {
      return res.status(402).json({
        error: 'Not enough credits, please contact admin',
        current_balance: e.balance, required: e.required,
      });
    }
    if (e.code === 'BANNED') return res.status(403).json({ error: 'Account is banned.' });
    console.error('[charge:video] error:', e);
    return res.status(500).json({ error: 'Credit charge failed.' });
  }

  // ── kie.ai-backed video (Veo 3 / Veo 3 Fast / Kling 3.0 / Kling 2.6) ──
  // Async task like FAL's queue; the kie:-prefixed model_id routes
  // /api/video-status polling to kie ('kie:jobs:' → Jobs API, plain 'kie:' →
  // Veo family). Old history rows carry unprefixed FAL ids and keep polling FAL.
  if (mapping.provider === 'kie') {
    try {
      // /api/upload falls back to a `data:` URI when neither Spaces nor FAL
      // storage will take the file, and the providers cannot read those —
      // they reject with "Only jpeg/jpg/png image formats are supported".
      // The IMAGE route has always re-hosted refs through this helper; the
      // video routes never did, which is why attaching a start frame to a
      // video failed while the same image worked for image generation.
      // (Production bug, 2026-08-02.)
      const rawFrames = image_url ? (tail_image_url ? [image_url, tail_image_url] : [image_url]) : [];
      const frames = await resolveReferenceUrls(rawFrames, { forKie: true, tag: 'REFS-VIDEO' });
      const { family, body, modelIdTag } = buildKieVideoSubmission(mapping, {
        prompt, frames, duration, aspectRatio: aspect_ratio, resolution, audio,
        multiShots: multi_shots,
      });
      // Full payload log — the ground truth of what kie was asked to do
      // (verifiable against kie.ai/logs when debugging output complaints).
      console.log('[KIE-VIDEO] payload:', JSON.stringify(body));
      const taskId = await kieCreateTask(family, body, { tag: 'KIE-VIDEO' });
      console.log(`[KIE-VIDEO] ✅ Submitted ${model} taskId: ${taskId}`);
      await trackVideoCharge(taskId, { userId: req.user.id, kind: chargedKind, cost: chargedCost, modelLabel: chargedLabel, modelId: modelIdTag });
      return res.json({ success: true, job_id: taskId, model_id: modelIdTag, model });
    } catch (error) {
      console.error('[KIE-VIDEO] Error:', error.message);
      if (chargedKind) {
        refundCredits({
          userId: req.user.id, kind: chargedKind, ip: clientIp(req), cost: chargedCost,
          reason: `kie_video_threw: ${error.message}`.slice(0, 500),
        }).catch(() => {});
      }
      return res.status(500).json({ error: 'Video generation failed: ' + publicError(error.message) });
    }
  }

  // Pick t2v or i2v based on whether images are attached
  const hasImage = !!image_url;
  const falModel = hasImage ? mapping.i2v : mapping.t2v;

  console.log(`[VIDEO] Model selected by user: ${model}`);
  console.log(`[VIDEO] Has start image: ${hasImage}, Has end image: ${!!tail_image_url}`);
  console.log(`[VIDEO] Mapped to fal model: ${falModel}`);
  console.log(`[VIDEO] Image param: ${mapping.imageParam}, End param: ${mapping.endParam}`);

  // Build input with correct param names per model
  const input = {
    prompt,
    ...(duration ? { duration: String(duration) } : {}),
    ...(aspect_ratio ? { aspect_ratio } : {}),
  };

  // Same re-hosting as the kie branch above: a `data:` URI from the upload
  // fallback must become a real URL before the provider sees it.
  let falStart = image_url;
  let falTail = tail_image_url;
  try {
    if (image_url || tail_image_url) {
      const resolved = await resolveReferenceUrls(
        [image_url, tail_image_url].filter(Boolean), { tag: 'REFS-VIDEO-FAL' }
      );
      if (image_url) { falStart = resolved[0]; falTail = tail_image_url ? resolved[1] : undefined; }
      else { falTail = resolved[0]; }
    }
  } catch (error) {
    console.error('[VIDEO] reference re-host failed:', error.message);
    if (chargedKind) {
      refundCredits({
        userId: req.user.id, kind: chargedKind, ip: clientIp(req), cost: chargedCost,
        reason: `video_ref_resolve_failed: ${error.message}`.slice(0, 500),
      }).catch(() => {});
    }
    return res.status(400).json({ error: publicError(error.message) });
  }

  // Add start image with the correct param name for this model
  if (falStart) {
    input[mapping.imageParam] = falStart;
  }

  // Add end image with the correct param name for this model
  if (falTail && mapping.endParam) {
    input[mapping.endParam] = falTail;
  }

  console.log('[VIDEO] Payload:', JSON.stringify(input, null, 2));

  try {
    // Submit to queue and return immediately — frontend polls via /api/video-status
    const submitted = await fal.queue.submit(falModel, { input });
    const requestId = submitted.request_id;
    console.log(`[VIDEO] ✅ Submitted, request_id: ${requestId}`);
    await trackVideoCharge(requestId, { userId: req.user.id, kind: chargedKind, cost: chargedCost, modelLabel: chargedLabel, modelId: falModel });

    return res.json({
      success: true,
      job_id: requestId,
      model_id: falModel,
      model,
    });

  } catch (error) {
    console.error('[VIDEO] Error:', error.message);
    if (chargedKind) {
      refundCredits({
        userId: req.user.id, kind: chargedKind, ip: clientIp(req), cost: chargedCost,
        reason: `fal_video_threw: ${error.message}`.slice(0, 500),
      }).catch(() => {});
    }
    return res.status(500).json({ error: 'Video generation failed: ' + publicError(error.message) });
  }
});

// ─── EDIT VIDEO (Kling Omni Edit + Kling O1 Video Edit) ──────────
// Two video-to-video models behind the Edit Video tab. Both take a
// source video + optional reference images + a prompt and return an
// edited clip. Body: { model, video_url, image_urls[], prompt, duration,
// aspect_ratio, keep_audio }. The frontend already polls via
// pollVideo(), so we just submit to the FAL queue and hand back the
// request_id.
const EDIT_VIDEO_MODELS = {
  'Kling 3.0 Omni Edit': 'fal-ai/kling-video/o3/standard/video-to-video/reference',
  'Kling O1 Video Edit': 'fal-ai/kling-video/o1/video-to-video/reference',
};

app.post('/api/edit-video-omni', verifyJwt, requireNotBanned, noDoubleCharge, requireFalKey, async (req, res) => {
  const { model, video_url, image_urls, prompt, duration, aspect_ratio, keep_audio } = req.body || {};

  if (!model || !EDIT_VIDEO_MODELS[model]) {
    return res.status(400).json({ error: `Edit model not supported: ${model || '(missing)'}` });
  }
  if (!video_url) return res.status(400).json({ error: 'video_url required' });
  if (!prompt) return res.status(400).json({ error: 'prompt required' });

  // C1: server-computed price (flat per clip; resolution rides in `quality`).
  // N5: same position as /api/generate — after the model is resolved and
  // before any charge, so a blocked attempt is never billed.
  if (!modelAllowedForUser(req, model)) return res.status(403).json(MODEL_BLOCKED(model));

  const serverCost = priceOrRespond(res, {
    kind: 'video', model, resolution: req.body.quality,
    clientCost: req.body.credit_cost,
  });
  if (serverCost == null) return;

  let chargedKind = null;
  let chargedCost = null;
  let chargedLabel = null;
  try {
    const charge = await chargeCredits({ userId: req.user.id, kind: 'video', ip: clientIp(req), cost: serverCost, note: `video: ${req.body?.model || 'Edit Video'}`, provider: 'fal' });
    chargedKind = 'video';
    chargedCost = charge.cost;
    chargedLabel = charge.label;
    res.setHeader('X-Credits-Remaining', String(charge.newBalance));
  } catch (e) {
    if (e instanceof InsufficientCreditsError) {
      return res.status(402).json({
        error: 'Not enough credits, please contact admin',
        current_balance: e.balance, required: e.required,
      });
    }
    if (e.code === 'BANNED') return res.status(403).json({ error: 'Account is banned.' });
    console.error('[charge:video-edit-omni] error:', e);
    return res.status(500).json({ error: 'Credit charge failed.' });
  }

  const falModel = EDIT_VIDEO_MODELS[model];
  const refs = Array.isArray(image_urls) ? image_urls.slice(0, 4) : [];

  // Per FAL schema (Kling O1 + O3 video-to-video/reference):
  //   - video_url   = the REFERENCE video that drives motion/camera
  //   - image_urls  = flat list of style/reference images (referenced as
  //                   @Image1, @Image2 in the prompt). Up to 4.
  //   - elements    = named characters/objects with custom shape — not
  //                   what we want for plain style references.
  const input = {
    prompt,
    video_url,
    ...(refs.length ? { image_urls: refs } : {}),
    keep_audio: keep_audio !== false,
    ...(duration ? { duration: String(duration) } : {}),
    ...(aspect_ratio ? { aspect_ratio } : {}),
  };

  console.log(`[VIDEO-EDIT-OMNI] Model: ${model} → ${falModel}`);
  console.log('[VIDEO-EDIT-OMNI] Source video:', video_url);
  console.log(`[VIDEO-EDIT-OMNI] Reference images: ${refs.length}`);
  console.log('[VIDEO-EDIT-OMNI] Payload:', JSON.stringify(input, null, 2));

  try {
    const submitted = await fal.queue.submit(falModel, { input });
    const requestId = submitted.request_id;
    console.log(`[VIDEO-EDIT-OMNI] ✅ Submitted, request_id: ${requestId}`);
    await trackVideoCharge(requestId, { userId: req.user.id, kind: chargedKind, cost: chargedCost, modelLabel: chargedLabel, modelId: falModel });

    return res.json({ success: true, job_id: requestId, model_id: falModel, model });
  } catch (error) {
    console.error('[VIDEO-EDIT-OMNI] Error:', error.message);
    if (chargedKind) {
      refundCredits({
        userId: req.user.id, kind: chargedKind, ip: clientIp(req), cost: chargedCost,
        reason: `fal_video_edit_omni_threw: ${error.message}`.slice(0, 500),
      }).catch(() => {});
    }
    return res.status(500).json({ error: 'Video edit failed: ' + publicError(error.message) });
  }
});

// ─── MOTION CONTROL (motion transfer) ──────────────────────────────
// Motion Control tab. Take a character image + a motion reference
// video and return an animated clip of that character performing the
// reference motion. Body: { model, image_url (character), video_url
// (motion ref), prompt?, quality, scene_control }.
//
// scene_control isn't on FAL's public schema today; we DO NOT send it
// to FAL but the frontend persists it to history so we can flip it on
// later when Kling exposes the flag without breaking old rows.
const MOTION_CONTROL_MODELS = {
  'Kling Motion Control':     'fal-ai/kling-video/v2.6/standard/motion-control',
  'Kling 3.0 Motion Control': 'fal-ai/kling-video/v3/pro/motion-control',
};

app.post('/api/motion-control', verifyJwt, requireNotBanned, requireFalKey, async (req, res) => {
  const { model, image_url, video_url, prompt, character_orientation, keep_original_sound } = req.body || {};

  if (!model || !MOTION_CONTROL_MODELS[model]) {
    return res.status(400).json({ error: `Motion model not supported: ${model || '(missing)'}` });
  }
  if (!image_url) return res.status(400).json({ error: 'image_url (character) required' });
  if (!video_url) return res.status(400).json({ error: 'video_url (motion reference) required' });

  // C1: server-computed price (flat per clip; resolution rides in `quality`).
  // N5: same position as /api/generate — after the model is resolved and
  // before any charge, so a blocked attempt is never billed.
  if (!modelAllowedForUser(req, model)) return res.status(403).json(MODEL_BLOCKED(model));

  const serverCost = priceOrRespond(res, {
    kind: 'video', model, resolution: req.body.quality,
    clientCost: req.body.credit_cost,
  });
  if (serverCost == null) return;

  let chargedKind = null;
  let chargedCost = null;
  let chargedLabel = null;
  try {
    const charge = await chargeCredits({ userId: req.user.id, kind: 'video', ip: clientIp(req), cost: serverCost, note: `video: ${req.body?.model || 'Motion Control'}`, provider: 'fal' });
    chargedKind = 'video';
    chargedCost = charge.cost;
    chargedLabel = charge.label;
    res.setHeader('X-Credits-Remaining', String(charge.newBalance));
  } catch (e) {
    if (e instanceof InsufficientCreditsError) {
      return res.status(402).json({
        error: 'Not enough credits, please contact admin',
        current_balance: e.balance, required: e.required,
      });
    }
    if (e.code === 'BANNED') return res.status(403).json({ error: 'Account is banned.' });
    console.error('[charge:motion-control] error:', e);
    return res.status(500).json({ error: 'Credit charge failed.' });
  }

  const falModel = MOTION_CONTROL_MODELS[model];
  // Default character_orientation to 'video' so we accept the full 3–30 s
  // range the UI exposes. 'image' would cap the reference at 10 s and
  // FAL would reject anything longer. Schema docs:
  //   - 'video': matches ref video orientation, max 30 s, better for complex motions
  //   - 'image': matches ref image orientation, max 10 s, better for camera movements
  const orient = character_orientation === 'image' ? 'image' : 'video';
  const input = {
    image_url,
    video_url,
    ...(prompt ? { prompt } : {}),
    character_orientation: orient,
    keep_original_sound: keep_original_sound !== false,
  };

  console.log(`[MOTION-CONTROL] Model: ${model} → ${falModel}`);
  console.log(`[MOTION-CONTROL] Character: ${image_url}`);
  console.log(`[MOTION-CONTROL] Motion ref: ${video_url}`);
  console.log(`[MOTION-CONTROL] Orientation: ${orient}, keep_original_sound: ${input.keep_original_sound}`);
  console.log('[MOTION-CONTROL] Payload:', JSON.stringify(input, null, 2));

  try {
    const submitted = await fal.queue.submit(falModel, { input });
    const requestId = submitted.request_id;
    console.log(`[MOTION-CONTROL] ✅ Submitted, request_id: ${requestId}`);
    await trackVideoCharge(requestId, { userId: req.user.id, kind: chargedKind, cost: chargedCost, modelLabel: chargedLabel, modelId: falModel });

    return res.json({ success: true, job_id: requestId, model_id: falModel, model });
  } catch (error) {
    console.error('[MOTION-CONTROL] Error:', error.message);
    if (chargedKind) {
      refundCredits({
        userId: req.user.id, kind: chargedKind, ip: clientIp(req), cost: chargedCost,
        reason: `fal_motion_control_threw: ${error.message}`.slice(0, 500),
      }).catch(() => {});
    }
    return res.status(500).json({ error: 'Motion control failed: ' + publicError(error.message) });
  }
});

// ─── TEXT-TO-SPEECH (ElevenLabs via FAL) ──────────────────────────
// Audio page Voice Canvas. Two model options:
//
//   - eleven-v3        (latest)         — fal-ai/elevenlabs/tts/eleven-v3
//                                         schema: text · voice · stability · language_code
//   - multilingual-v2  (richer params)  — fal-ai/elevenlabs/tts/multilingual-v2
//                                         schema: + similarity_boost · style · speed
//
// V3 silently ignores extras, but we strip them server-side anyway so
// the FAL request is exactly what the schema expects (clean logs).
//
// fal.subscribe is fine here — TTS jobs return in a couple of seconds,
// no need for queue + status polling like the video routes.
const TTS_MODELS = {
  'eleven-v3':       'fal-ai/elevenlabs/tts/eleven-v3',
  'multilingual-v2': 'fal-ai/elevenlabs/tts/multilingual-v2',
};

// N5: human-facing labels for the per-user allow-list. These are the strings
// the CRM shows and stores, so they must match GET /api/admin/models exactly —
// model-coverage.test.js fails if the two ever drift.
const TTS_MODEL_LABELS = {
  'eleven-v3':       'ElevenLabs v3',
  'multilingual-v2': 'ElevenLabs Multilingual v2',
};
const MUSIC_MODEL_LABEL = 'Lyria 2 (Music)';

app.post('/api/tts', verifyJwt, requireNotBanned, requireFalKey, async (req, res) => {
  const {
    model,
    text,
    voice,
    language_code,
    stability,
    similarity_boost,
    style,
  } = req.body || {};

  // N5: voice was ungated entirely — a restricted account could spend its
  // whole balance here. Gate the RESOLVED label so the default path is checked
  // too, not only an explicitly requested model.
  const ttsLabel = TTS_MODEL_LABELS[model] || TTS_MODEL_LABELS['eleven-v3'];
  if (!modelAllowedForUser(req, ttsLabel)) return res.status(403).json(MODEL_BLOCKED(ttsLabel));

  const falModel = TTS_MODELS[model] || TTS_MODELS['eleven-v3'];
  const usingV3 = falModel.endsWith('eleven-v3');

  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'text required' });
  }
  if (text.length > 5000) {
    return res.status(400).json({ error: 'text too long (max 5000 chars)' });
  }

  // Voice is billed per 1,000 characters (workbook "VOICE MODELS" section).
  // This used to be a FLAT 1 credit per take regardless of length, which lost
  // money on anything over ~380 characters — a full 5,000-char take cost us
  // $0.50 and earned $0.063.
  const voiceModelKey = usingV3 ? 'eleven-v3' : 'multilingual-v2';
  const voiceCost = getVoiceCredits(voiceModelKey, text.length);

  let chargedKind = null;
  let chargedCost = null;
  try {
    const charge = await chargeCredits({
      userId: req.user.id, kind: 'audio', ip: clientIp(req), cost: voiceCost,
      note: `audio: TTS (${Math.ceil(text.length / 1000)}k chars)`, provider: 'fal',
      falCost: estimateFalCost({ kind: 'audio', model: 'TTS', chars: text.length }),
    });
    chargedKind = 'audio';
    chargedCost = charge.cost;
    res.setHeader('X-Credits-Remaining', String(charge.newBalance));
  } catch (e) {
    if (e instanceof InsufficientCreditsError) {
      return res.status(402).json({
        error: 'Not enough credits, please contact admin',
        current_balance: e.balance, required: e.required,
      });
    }
    if (e.code === 'BANNED') return res.status(403).json({ error: 'Account is banned.' });
    console.error('[charge:tts] error:', e);
    return res.status(500).json({ error: 'Credit charge failed.' });
  }

  // Build the FAL input. V3 only honours { text, voice, stability,
  // language_code }; V2 also accepts similarity_boost + style.
  const input = {
    text,
    voice: voice || 'Rachel',
    ...(typeof stability === 'number' ? { stability } : {}),
    ...(language_code && language_code !== 'auto' ? { language_code } : {}),
  };
  if (!usingV3) {
    if (typeof similarity_boost === 'number') input.similarity_boost = similarity_boost;
    if (typeof style === 'number') input.style = style;
  }

  console.log(`[TTS] Model: ${model || 'eleven-v3'} → ${falModel}`);
  console.log(`[TTS] Voice: ${input.voice} · lang: ${input.language_code || 'auto'} · stab: ${input.stability}`);
  console.log(`[TTS] Text: ${text.slice(0, 80)}${text.length > 80 ? '…' : ''}`);

  try {
    const result = await falSubscribe(falModel, { input, logs: false }, 'FAL-TTS');
    const audio = result?.data?.audio;
    const audioUrl = audio?.url;
    if (!audioUrl) {
      throw new Error('No audio URL in FAL response');
    }
    console.log(`[TTS] ✅ ${audioUrl}`);

    return res.json({
      success: true,
      audio_url: audioUrl,
      content_type: audio.content_type,
      file_size: audio.file_size,
      model: model || 'eleven-v3',
      model_id: falModel,
    });
  } catch (error) {
    console.error('[TTS] Error:', error.message);
    if (chargedKind) {
      refundCredits({
        userId: req.user.id, kind: chargedKind, ip: clientIp(req), cost: chargedCost,
        reason: `fal_tts_threw: ${error.message}`.slice(0, 500),
      }).catch(() => {});
    }
    if (respondIfProviderTimeout(res, error)) return;
    return res.status(500).json({ error: 'TTS failed: ' + publicError(error.message) });
  }
});

// ─── MUSIC GENERATION (Google Lyria 2 via FAL) ─────────────────────
// Audio page Music Canvas. Single FAL endpoint:
//
//   - lyria-2  →  fal-ai/lyria2
//                 schema: prompt · negative_prompt? · seed?
//                 output: { audio: { url, content_type, file_size } }
//
// Outputs 48kHz WAV, 30s. Same charge/refund pattern as /api/tts.

app.post('/api/generate-music', verifyJwt, requireNotBanned, noDoubleCharge, requireFalKey, async (req, res) => {
  const { prompt, negative_prompt, seed } = req.body || {};

  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ error: 'prompt required' });
  }
  if (prompt.length > 4000) {
    return res.status(400).json({ error: 'prompt too long (max 4000 chars)' });
  }

  // N5: music was ungated. One fixed model, so the label is a constant.
  if (!modelAllowedForUser(req, MUSIC_MODEL_LABEL)) {
    return res.status(403).json(MODEL_BLOCKED(MUSIC_MODEL_LABEL));
  }

  let chargedKind = null;
  let chargedCost = null;
  try {
    const charge = await chargeCredits({ userId: req.user.id, kind: 'audio', ip: clientIp(req), note: 'audio: Music', provider: 'fal' });
    chargedKind = 'audio';
    res.setHeader('X-Credits-Remaining', String(charge.newBalance));
  } catch (e) {
    if (e instanceof InsufficientCreditsError) {
      return res.status(402).json({
        error: 'Not enough credits, please contact admin',
        current_balance: e.balance, required: e.required,
      });
    }
    if (e.code === 'BANNED') return res.status(403).json({ error: 'Account is banned.' });
    console.error('[charge:music] error:', e);
    return res.status(500).json({ error: 'Credit charge failed.' });
  }

  const input = {
    prompt: prompt.trim(),
    ...(negative_prompt && typeof negative_prompt === 'string' && negative_prompt.trim()
      ? { negative_prompt: negative_prompt.trim() }
      : {}),
    ...(Number.isInteger(seed) ? { seed } : {}),
  };

  console.log(`[MUSIC] Lyria 2 → fal-ai/lyria2`);
  console.log(`[MUSIC] Prompt: ${input.prompt.slice(0, 100)}${input.prompt.length > 100 ? '…' : ''}`);
  if (input.negative_prompt) console.log(`[MUSIC] Negative: ${input.negative_prompt}`);

  try {
    const result = await falSubscribe('fal-ai/lyria2', { input, logs: false }, 'FAL-MUSIC');
    const audio = result?.data?.audio;
    const audioUrl = audio?.url;
    if (!audioUrl) {
      throw new Error('No audio URL in FAL response');
    }
    console.log(`[MUSIC] ✅ ${audioUrl}`);

    return res.json({
      success: true,
      audio_url: audioUrl,
      content_type: audio.content_type,
      file_size: audio.file_size,
      model: 'lyria-2',
      model_id: 'fal-ai/lyria2',
    });
  } catch (error) {
    console.error('[MUSIC] Error:', error.message);
    if (chargedKind) {
      refundCredits({
        userId: req.user.id, kind: chargedKind, ip: clientIp(req), cost: chargedCost,
        reason: `fal_music_threw: ${error.message}`.slice(0, 500),
      }).catch(() => {});
    }
    if (respondIfProviderTimeout(res, error)) return;
    return res.status(500).json({ error: 'Music generation failed: ' + publicError(error.message) });
  }
});

// ─── VOICE PREVIEW (no auth) ───────────────────────────────────────
// Powers the ▶ button inside the Audio page Voice picker. Anyone (logged
// in or not) can hit this — it returns a fixed short sample for any
// voice. The first request per voice triggers a real FAL TTS call and
// the URL is cached in a module-level Map; every subsequent request
// for that voice returns the cached URL with no FAL call and no charge.
//
// N7 (recheck 2026-08-03): the limiter here was a hand-rolled Map keyed on the
// caller's IP that was NEVER evicted (unbounded growth), reset on every deploy,
// and — with two instances in production — allowed double its stated cap.
// Replaced with the same express-rate-limit + clientIp keying every other route
// uses. The cache stays a Map on purpose: it is bounded by the catalogue, so at
// most VOICE_COUNT entries can ever exist.
const PREVIEW_TEXT = 'Hi! This is a quick voice preview. You can pick this voice to read your script.';
const voicePreviewCache = new Map(); // voice id/name → audio_url (max VOICE_COUNT entries)
const previewLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  keyGenerator: ipKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many previews. Try again in an hour.' },
});

// Deliberately public: visitors hear a sample before signing up, and the cache
// means the first listener pays the FAL call and everyone after gets it free.
// N7 keeps it public but bounds it — see voice-catalog.js for why validating
// the voice is a stronger guarantee here than requiring a login.
app.post('/api/tts/preview', previewLimiter, requireFalKey, async (req, res) => {
  const { voice } = req.body || {};
  if (!voice || typeof voice !== 'string') {
    return res.status(400).json({ error: 'voice required' });
  }
  // N7: only voices the picker actually offers. Without this, any made-up
  // string missed the cache and became a billable FAL call.
  if (!isKnownVoice(voice)) {
    console.warn(`[TTS-PREVIEW] rejected unknown voice from ${clientIp(req)}`);
    return res.status(400).json({ error: 'Unknown voice.' });
  }

  // Cache hit → free + zero FAL load.
  const cached = voicePreviewCache.get(voice);
  if (cached) {
    return res.json({ success: true, audio_url: cached, cached: true });
  }

  const falModel = TTS_MODELS['eleven-v3'];
  const input = { text: PREVIEW_TEXT, voice, stability: 0.5 };
  console.log(`[TTS-PREVIEW] miss → ${voice} via ${falModel}`);

  try {
    const result = await falSubscribe(falModel, { input, logs: false }, 'FAL-TTS-PREVIEW');
    const audioUrl = result?.data?.audio?.url;
    if (!audioUrl) throw new Error('No audio URL in FAL response');
    voicePreviewCache.set(voice, audioUrl);
    console.log(`[TTS-PREVIEW] ✅ cached ${voice} → ${audioUrl}`);
    return res.json({ success: true, audio_url: audioUrl, cached: false });
  } catch (error) {
    console.error('[TTS-PREVIEW] Error:', error.message);
    return res.status(500).json({ error: 'Preview failed: ' + publicError(error.message) });
  }
});

// ─── SEEDANCE 2.0 SMART ROUTING ──────────────────────────────────
// Routes to the correct Seedance 2.0 endpoint based on image roles:
//   - No images → text-to-video
//   - Images as reference → reference-to-video (image_urls[])
//   - Image as start/end frame → image-to-video
// Supports both:
//   - "Seedance 2.0"      → bytedance/seedance-2.0/*       (start_frame/end_frame)
//   - "Seedance 2.0 Fast" → bytedance/seedance-2.0/fast/*  (image_url/end_image_url)
app.post('/api/generate-video-ref', verifyJwt, requireNotBanned, noDoubleCharge, requireModelProviderKey, async (req, res) => {
  const { model, prompt, mode, image_urls, video_urls, audio_urls, start_frame, end_frame, duration, aspect_ratio, resolution, generate_audio } = req.body;

  if (!prompt) return res.status(400).json({ error: 'prompt required' });

  const isFast = model === 'Seedance 2.0 Fast';
  const isMini = model === 'Seedance 2.0 Mini';
  const endpointBase = isFast ? 'bytedance/seedance-2.0/fast'
                     : isMini ? 'bytedance/seedance-2.0/mini'
                     : 'bytedance/seedance-2.0';
  // BOTH regular Seedance 2.0 and Fast use image_url / end_image_url
  // for their image-to-video endpoints (verified against FAL schema docs
  // 2026-05). Older code mistakenly sent start_frame/end_frame for the
  // regular variant — FAL silently ignored them and the call failed
  // because the required image_url was missing.
  const frameField    = 'image_url';
  const endFrameField = 'end_image_url';
  const modelLabel = isFast ? 'Seedance 2.0 Fast' : isMini ? 'Seedance 2.0 Mini' : 'Seedance 2.0';

  if (!modelAllowedForUser(req, modelLabel)) return res.status(403).json(MODEL_BLOCKED(modelLabel));

  // C1: server-computed price; client credit_cost is a hint only. Audio
  // defaults ON here (generate_audio !== false), matching the submission.
  const serverCost = priceOrRespond(res, {
    kind: 'video', model: modelLabel, resolution, duration,
    audio: generate_audio !== false,
    clientCost: req.body.credit_cost,
  });
  if (serverCost == null) return;

  let chargedKind = null;
  let chargedCost = null;
  let chargedLabel = null;
  try {
    const charge = await chargeCredits({
      userId: req.user.id, kind: 'video', ip: clientIp(req), cost: serverCost, note: `video: ${modelLabel}`,
      provider: VIDEO_DIRECT_MAP[modelLabel]?.provider === 'kie' ? 'kie' : 'fal',
      kieCredits: VIDEO_DIRECT_MAP[modelLabel]?.provider === 'kie'
        ? estimateKieCredits({ kind: 'video', model: modelLabel, resolution, duration, audio: generate_audio }) : null,
      falCost: VIDEO_DIRECT_MAP[modelLabel]?.provider === 'kie'
        ? null : estimateFalCost({ kind: 'video', model: modelLabel, resolution, duration, audio: generate_audio }),
    });
    chargedKind = 'video';
    chargedCost = charge.cost;
    chargedLabel = charge.label;
    res.setHeader('X-Credits-Remaining', String(charge.newBalance));
  } catch (e) {
    if (e instanceof InsufficientCreditsError) {
      return res.status(402).json({
        error: 'Not enough credits, please contact admin',
        current_balance: e.balance, required: e.required,
      });
    }
    if (e.code === 'BANNED') return res.status(403).json({ error: 'Account is banned.' });
    console.error('[charge:seedance] error:', e);
    return res.status(500).json({ error: 'Credit charge failed.' });
  }

  // Re-host any `data:` URI the upload fallback produced BEFORE the provider
  // sees it — otherwise it rejects with "Only jpeg/jpg/png image formats are
  // supported". Same step the image route has always performed.
  // (Production bug, 2026-08-02.)
  let startFrameUrl = start_frame;
  let endFrameUrl = end_frame;
  let refImageUrls = image_urls;
  try {
    const isKieSeedance = VIDEO_DIRECT_MAP[modelLabel]?.provider === 'kie';
    const opts = { forKie: isKieSeedance, tag: 'REFS-SEEDANCE' };
    if (start_frame) startFrameUrl = (await resolveReferenceUrls([start_frame], opts))[0];
    if (end_frame) endFrameUrl = (await resolveReferenceUrls([end_frame], opts))[0];
    if ((image_urls || []).length) refImageUrls = await resolveReferenceUrls(image_urls, opts);
  } catch (error) {
    console.error('[SEEDANCE] reference re-host failed:', error.message);
    if (chargedKind) {
      refundCredits({
        userId: req.user.id, kind: chargedKind, ip: clientIp(req), cost: chargedCost,
        reason: `seedance_ref_resolve_failed: ${error.message}`.slice(0, 500),
      }).catch(() => {});
    }
    return res.status(400).json({ error: publicError(error.message) });
  }

  // Determine which Seedance endpoint to use
  const hasStartFrame = !!startFrameUrl;
  const hasEndFrame = !!endFrameUrl;
  const hasRefImages = (refImageUrls || []).length > 0;
  const hasRefVideos = (video_urls || []).length > 0;
  const hasRefAudios = (audio_urls || []).length > 0;

  // ── kie.ai-backed Seedance (switched from FAL 2026-07-20) ──
  // One jobs model per variant covers t2v / i2v / reference in a single
  // schema: first_frame_url / last_frame_url / reference_*_urls. Frontend
  // polling works unchanged via the kie:jobs: model_id prefix.
  const seedanceMapping = VIDEO_DIRECT_MAP[modelLabel];
  if (seedanceMapping?.provider === 'kie') {
    try {
      const durInt = Math.min(15, Math.max(4, parseInt(duration, 10) || 5));
      // kie standard supports up to 4k; fast/mini top out at 720p.
      const allowedRes = (isFast || isMini) ? ['480p', '720p'] : ['480p', '720p', '1080p', '4k'];
      const res_ = allowedRes.includes(String(resolution).toLowerCase()) ? String(resolution).toLowerCase() : '720p';
      const body = {
        model: seedanceMapping.kieModel,
        input: {
          prompt,
          aspect_ratio: ['1:1', '4:3', '3:4', '16:9', '9:16', '21:9'].includes(aspect_ratio) ? aspect_ratio : 'adaptive',
          duration: durInt,
          resolution: res_,
          generate_audio: generate_audio !== false,
          ...(hasStartFrame ? { first_frame_url: startFrameUrl } : {}),
          ...(hasEndFrame ? { last_frame_url: endFrameUrl } : {}),
          ...(hasRefImages ? { reference_image_urls: refImageUrls.slice(0, 9) } : {}),
          ...(hasRefVideos ? { reference_video_urls: video_urls.slice(0, 3) } : {}),
          ...(hasRefAudios ? { reference_audio_urls: audio_urls.slice(0, 3) } : {}),
        },
      };
      console.log(`[SEEDANCE] [KIE] Variant: ${modelLabel} →`, seedanceMapping.kieModel);
      const taskId = await kieCreateTask('jobs', body, { tag: 'KIE-SEEDANCE' });
      console.log(`[SEEDANCE] [KIE] ✅ Submitted taskId: ${taskId}`);
      await trackVideoCharge(taskId, { userId: req.user.id, kind: chargedKind, cost: chargedCost, modelLabel: chargedLabel, modelId: 'kie:jobs:' + seedanceMapping.kieModel });
      return res.json({
        success: true,
        job_id: taskId,
        model_id: 'kie:jobs:' + seedanceMapping.kieModel,
        model: modelLabel,
      });
    } catch (error) {
      console.error('[SEEDANCE] [KIE] Error:', error.message);
      if (chargedKind) {
        refundCredits({
          userId: req.user.id, kind: chargedKind, ip: clientIp(req), cost: chargedCost,
          reason: `kie_seedance_threw: ${error.message}`.slice(0, 500),
        }).catch(() => {});
      }
      return res.status(500).json({ error: 'Seedance generation failed: ' + publicError(error.message) });
    }
  }

  let falModel;
  let input = {
    prompt,
    ...(duration ? { duration: String(duration) } : { duration: 'auto' }),
    ...(aspect_ratio ? { aspect_ratio } : { aspect_ratio: 'auto' }),
    ...(resolution ? { resolution } : { resolution: '720p' }),
    generate_audio: generate_audio !== false,
  };

  if (mode === 'frame' || hasStartFrame || hasEndFrame) {
    // Image-to-video mode (start frame / end frame)
    falModel = `${endpointBase}/image-to-video`;
    if (hasStartFrame) input[frameField]    = startFrameUrl;
    if (hasEndFrame)   input[endFrameField] = endFrameUrl;
    console.log(`[SEEDANCE] Mode: image-to-video (start: ${hasStartFrame}, end: ${hasEndFrame})`);
  } else if (mode === 'reference' || hasRefImages || hasRefVideos || hasRefAudios) {
    // Reference-to-video mode (both variants accept image_urls/video_urls/audio_urls)
    falModel = `${endpointBase}/reference-to-video`;
    if (hasRefImages) input.image_urls = refImageUrls;
    if (hasRefVideos) input.video_urls = video_urls;
    if (hasRefAudios) input.audio_urls = audio_urls;
    console.log(`[SEEDANCE] Mode: reference-to-video (images: ${(image_urls||[]).length}, videos: ${(video_urls||[]).length}, audio: ${(audio_urls||[]).length})`);
  } else {
    // Text-to-video mode (no images)
    falModel = `${endpointBase}/text-to-video`;
    console.log(`[SEEDANCE] Mode: text-to-video (no images)`);
  }

  console.log(`[SEEDANCE] Variant: ${modelLabel}`);
  console.log('[SEEDANCE] FAL Model:', falModel);
  console.log('[SEEDANCE] Payload:', JSON.stringify(input, null, 2));

  try {
    const submitted = await fal.queue.submit(falModel, { input });
    console.log(`[SEEDANCE] ✅ Submitted, request_id: ${submitted.request_id}`);
    await trackVideoCharge(submitted.request_id, { userId: req.user.id, kind: chargedKind, cost: chargedCost, modelLabel: chargedLabel, modelId: falModel });

    return res.json({
      success: true,
      job_id: submitted.request_id,
      model_id: falModel,
      model: modelLabel,
    });
  } catch (error) {
    console.error('[SEEDANCE] Error:', error.message);
    if (chargedKind) {
      refundCredits({
        userId: req.user.id, kind: chargedKind, ip: clientIp(req), cost: chargedCost,
        reason: `seedance_threw: ${error.message}`.slice(0, 500),
      }).catch(() => {});
    }
    return res.status(500).json({ error: 'Seedance generation failed: ' + publicError(error.message) });
  }
});

// ─── CHARACTER ELIGIBILITY CHECK ──────────────────────────────────
// Accept an uploaded image as a reusable character element.
//
// N7 (recheck 2026-08-03): had no auth and no limiter, and slept 2 seconds on
// every call — a free way for anyone to hold connections open on a single-
// process server. It is only ever called from the video flow by a signed-in
// user, so requiring a login costs nothing, and the artificial delay is gone.
//
// N10 (recheck 2026-08-03): it also RETURNED approved:true for any string
// beginning with 'http' — it inspected nothing — while the interface presented
// it as a moderation control: a shield icon, "Check eligibility", and
// "Character approved". That is a false compliance record: a user could upload
// a real person's likeness and the platform would stamp it approved.
//
// It now does only what it can honestly do — confirm the reference is an https
// URL on a host we actually serve media from — and the UI no longer claims
// moderation. Adding real content moderation is a separate decision (it needs
// a provider, a cost, and a written policy on what gets rejected); when it
// lands, it belongs right here.
app.post('/api/check-character-eligibility', verifyJwt, requireNotBanned, statusLimiter, async (req, res) => {
  const { image_url } = req.body;
  if (!image_url) return res.status(400).json({ error: 'image_url required' });

  let accepted = false;
  let reason = null;
  try {
    const u = new URL(String(image_url));
    if (u.protocol !== 'https:') {
      reason = 'Reference images must be served over https.';
    } else if (!isAllowedDownloadHost(u.hostname, buildAllowedHostSuffixes())) {
      reason = 'That image is not hosted where we can read it — re-upload it here.';
    } else {
      accepted = true;
    }
  } catch {
    reason = 'That does not look like a valid image address.';
  }

  console.log(`[CHARACTER-ELEMENT] ${accepted ? 'accepted' : `rejected: ${reason}`}`);
  // NOTE: no content inspection happens here. Do not reintroduce wording
  // anywhere that implies this endpoint moderates or approves imagery.
  res.json({ accepted, image_url, ...(reason ? { reason } : {}) });
});

// ─── VIDEO STATUS POLLING ─────────────────────────────────────────
// M5 (audit 2026-07-28): was unauthenticated — anyone could poll any job
// id and read another user's video. Now auth + rate limit + ownership.
app.post('/api/video-status', verifyJwt, requireNotBanned, statusLimiter, async (req, res) => {
  const { job_id, model_id } = req.body;
  if (!job_id || !model_id) return res.status(400).json({ error: 'job_id and model_id required' });

  if (!(await userOwnsJob(req.user.id, job_id))) {
    return res.status(404).json({ error: 'Job not found.' });
  }

  // kie.ai jobs carry a 'kie:'-prefixed model_id (set at submit time);
  // 'kie:jobs:...' → unified Jobs API, plain 'kie:...' → Veo endpoints.
  // Everything else is a FAL request id → FAL polling below.
  if (model_id.startsWith('kie:')) {
    try {
      const family = model_id.startsWith('kie:jobs:') ? 'jobs' : 'veo';
      const t = await kieGetTask(family, job_id, { tag: 'KIE-VIDEO' });
      if (t.state === 'success') {
        await settleVideoCharge(job_id); // completed — charge stands
        const durableUrl = await persistOrFallback(t.resultUrls[0], 'video');
        return res.json({ status: 'COMPLETED', video_url: durableUrl });
      }
      if (t.state === 'fail') {
        await refundFailedVideo(job_id, `kie: ${t.failMsg || 'generation failed'}`);
        return res.json({ status: 'FAILED', error: publicError(t.failMsg, 'Generation failed') });
      }
      return res.json({ status: 'IN_PROGRESS' });
    } catch (error) {
      console.error('[VIDEO-STATUS] [KIE] ❌ Error checking status:', error.message);
      // Transient failures (network, provider 5xx) must NOT refund or kill
      // the job — the video may still be rendering; the client keeps polling
      // (its own 10-min cap bounds this). Only a definitive provider
      // rejection (4xx: unknown/invalid task) settles as FAILED + refund.
      const st = error.httpStatus;
      if (!st || st >= 500) return res.json({ status: 'IN_PROGRESS' });
      await refundFailedVideo(job_id, `kie status error: ${error.message}`);
      return res.json({ status: 'FAILED', error: publicError(error.message) });
    }
  }

  try {
    const status = await fal.queue.status(model_id, { requestId: job_id, logs: false });

    if (status.status === 'COMPLETED') {
      const result = await fal.queue.result(model_id, { requestId: job_id });

      const videoUrl =
        result?.data?.video?.url ||
        result?.data?.video_url ||
        result?.data?.outputs?.[0]?.url ||
        result?.data?.url ||
        result?.video?.url ||
        null;

      if (!videoUrl) {
        await refundFailedVideo(job_id, 'fal: no video URL in result');
        return res.json({ status: 'FAILED', error: 'No video URL in result' });
      }

      await settleVideoCharge(job_id); // completed — charge stands
      // Re-host to our own Spaces bucket so history stays durable after FAL
      // purges its link.
      const durableVideo = await persistOrFallback(videoUrl, 'video');
      return res.json({ status: 'COMPLETED', video_url: durableVideo });
    }

    if (status.status === 'FAILED') {
      await refundFailedVideo(job_id, 'fal: generation failed');
      return res.json({ status: 'FAILED', error: 'Generation failed' });
    }

    return res.json({
      status: status.status,
      queue_position: status.queue_position || null,
    });
  } catch (error) {
    console.error('[VIDEO-STATUS] ❌ Error checking status:', error.message);
    // Same transient-vs-definitive rule as the kie branch: only a 4xx from
    // the provider (bad/unknown request id) settles as FAILED + refund.
    const st = error.status ?? error.httpStatus;
    if (!st || st >= 500) return res.json({ status: 'IN_PROGRESS' });
    await refundFailedVideo(job_id, `fal status error: ${error.message}`);
    return res.json({ status: 'FAILED', error: publicError(error.message) });
  }
});

// ─── SLOW IMAGE STATUS POLLING (2026-08-28) ───────────────────────
// The browser's half of the hand-off. The server-side sweeper below is what
// GUARANTEES delivery; this route only makes it fast, and lets the browser
// write the history row while it still holds the camera, lens and f-stop the
// customer chose. A sweeper-written row cannot have those.
//
// Ownership is checked the same way /api/video-status does it (M5): the row
// is looked up BY task id AND user id, so polling somebody else's job returns
// the same 404 as a job that does not exist.
app.post('/api/image-status', verifyJwt, requireNotBanned, statusLimiter, async (req, res) => {
  if (!dbReady()) return res.status(503).json({ error: 'Database not configured.' });
  const jobId = String(req.body?.job_id || '');
  if (!jobId) return res.status(400).json({ error: 'job_id required' });

  try {
    const { rows } = await pool.query(OWNS_SQL, [jobId, req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'Job not found.' });
    const row = rows[0];

    // Already resolved — by the sweeper, or by this customer's other tab.
    // `already: true` tells the client NOT to write a second history row.
    if (row.status === 'delivered') {
      return res.json({ status: 'COMPLETED', image_url: row.result_url, already: true });
    }
    if (row.status === 'refunded') {
      return res.json({ status: 'FAILED', error: 'That image could not be finished — your credits are back.' });
    }

    const family = req.body?.family === 'veo' ? 'veo' : 'jobs';
    const t = await kieGetTask(family, jobId, { tag: 'KIE-IMG' });
    if (t.state === 'fail') {
      const gone = await pool.query(GIVE_UP_SQL, [jobId, `kie: ${t.failMsg || 'generation failed'}`]);
      if (gone.rowCount) await refundFailedVideo(jobId, `kie: ${t.failMsg || 'generation failed'}`);
      return res.json({ status: 'FAILED', error: publicError(t.failMsg, 'Generation failed') });
    }
    if (t.state !== 'success') return res.json({ status: 'IN_PROGRESS' });

    // Re-host BEFORE claiming: kie urls expire in ~14 days, and a failure here
    // must leave the row 'pending' so the sweeper can try again.
    const { url: durableUrl, thumbUrl } = await persistWithThumb(
      t.resultUrls[0], 'image', { makeThumb: makeThumbnail });
    const claim = await pool.query(CLAIM_SQL, [jobId, durableUrl]);
    if (!claim.rowCount) {
      // The sweeper or another tab won. The image is safe and already in
      // history; writing it again would show the customer two of it.
      return res.json({ status: 'COMPLETED', image_url: durableUrl, already: true });
    }
    await settleVideoCharge(jobId);
    console.log(`[KIE-IMG] late delivery taskId=${jobId} user=${req.user.id} (browser)`);
    return res.json({ status: 'COMPLETED', image_url: durableUrl, thumb_url: thumbUrl || null, already: false });
  } catch (e) {
    // Never a failure verdict from an error we do not understand — the job may
    // be perfectly fine and the sweeper will get it. Saying FAILED here would
    // refund an image that is on its way.
    console.error('[image-status] error:', e.message);
    return res.json({ status: 'IN_PROGRESS' });
  }
});

// ─── FILE UPLOAD (to FAL storage) ──────────────────────────────────
// Wrap multer manually so file-too-large + other multer errors return
// proper JSON (default behaviour is HTML, which makes the frontend show
// "Upload returned no URL" with no useful diagnostic).
// H2 (audit 2026-07-28): was unauthenticated and accepted any file type.
// Now: JWT + not-banned + per-user rate limit + MIME/magic-byte validation.
// Size limit (100 MB, multer) unchanged.
app.post('/api/upload', verifyJwt, requireNotBanned, uploadLimiter, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'File too large. Max 100 MB.' });
    }
    console.error('[UPLOAD] ❌ Multer error:', err.code || err.message);
    return res.status(400).json({ error: `Upload rejected: ${err.message || err.code}` });
  });
}, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided' });

  // Only image/video/audio, validated against the file's real magic bytes —
  // a renamed executable with an image Content-Type is rejected here.
  const verdict = validateUpload({ mimetype: req.file.mimetype, buffer: req.file.buffer });
  if (!verdict.ok) {
    console.error(`[UPLOAD] ❌ rejected for user ${req.user.id}: ${verdict.reason} (${req.file.originalname})`);
    return res.status(415).json({ error: verdict.reason });
  }

  // Validate FAL has a key configured — without this, fal.storage.upload
  // will fail with a cryptic auth error that's hard to interpret.
  if (!FAL_KEY) {
    console.error('[UPLOAD] ❌ FAL_KEY missing on server');
    return res.status(500).json({ error: 'Upload service not configured — please contact support.' });
  }

  const info = `${req.file.originalname} · ${(req.file.size / (1024 * 1024)).toFixed(2)} MB · ${req.file.mimetype}`;
  console.log('[UPLOAD] ⏳', info);

  let attempts = [];

  // ── DO Spaces first ────────────────────────────────────────────
  // A Spaces URL is public https, so BOTH providers can fetch it (kie.ai
  // cannot read data: URIs at all), and it never expires. FAL storage is
  // the fallback because FAL keys without the storage scope get 403
  // "Unauthorized" here even though inference works fine.
  if (spacesReady()) {
    try {
      const url = await persistBuffer(req.file.buffer, req.file.mimetype, 'reference');
      console.log('[UPLOAD] ✅ Spaces URL:', url);
      return res.json({ url });
    } catch (error) {
      attempts.push(`Spaces: ${error.message}`);
      console.error('[UPLOAD] ⚠️ Spaces path failed:', error.message);
    }
  }

  // Try File API first (Node 18+), fall back to Blob if it explodes.
  try {
    const file = new File([req.file.buffer], req.file.originalname, { type: req.file.mimetype });
    const url = await fal.storage.upload(file);
    if (!url || typeof url !== 'string') {
      throw new Error(`FAL returned non-string URL: ${JSON.stringify(url)}`);
    }
    console.log('[UPLOAD] ✅ FAL URL (File):', url);
    return res.json({ url });
  } catch (error) {
    attempts.push(`File: ${error.message}`);
    console.error('[UPLOAD] ⚠️ File path failed:', error.message);
  }

  try {
    const blob = new Blob([req.file.buffer], { type: req.file.mimetype });
    const url = await fal.storage.upload(blob);
    if (!url || typeof url !== 'string') {
      throw new Error(`FAL returned non-string URL: ${JSON.stringify(url)}`);
    }
    console.log('[UPLOAD] ✅ FAL URL (Blob):', url);
    return res.json({ url });
  } catch (e2) {
    attempts.push(`Blob: ${e2.message}`);
    console.error('[UPLOAD] ⚠️ FAL storage rejected, falling back to data URI:', attempts.join(' | '));

    // ── Data-URI fallback ──────────────────────────────────────────
    // FAL storage upload can return 403/Forbidden even when the same
    // FAL_KEY works for fal.subscribe / fal.queue.submit (it's a
    // separate scope on their side). Per FAL docs, all inference
    // endpoints accept data: URIs in place of file URLs:
    //   "You can pass a Base64 data URI as a file input. The API will
    //    handle the file decoding for you."
    // For images this works perfectly. Video data URIs work too but
    // can be slow over 30 MB — we still try them since the alternative
    // is the upload just failing.
    try {
      const base64 = req.file.buffer.toString('base64');
      const dataUri = `data:${req.file.mimetype};base64,${base64}`;
      console.log(`[UPLOAD] ✅ Data URI fallback (${(base64.length / 1024 / 1024).toFixed(2)} MB base64)`);
      return res.json({ url: dataUri, fallback: 'data-uri' });
    } catch (e3) {
      attempts.push(`DataURI: ${e3.message}`);
      console.error('[UPLOAD] ❌ All attempts failed:', attempts.join(' | '));
      return res.status(500).json({
        error: `Upload failed (${info}): ${attempts.join(' | ')}`,
      });
    }
  }
});

// ─── MEDIA DOWNLOAD (proper Content-Disposition for save dialog) ───
// H1 (audit 2026-07-28): was an unauthenticated open proxy (SSRF). Now:
// JWT + not-banned, https-only allow-listed CDN hosts, DNS private-address
// rejection (re-checked on every redirect), an overall deadline, and a
// response-size cap. See download-guard.js for the validation logic.
const DOWNLOAD_TIMEOUT_MS = Number(process.env.DOWNLOAD_TIMEOUT_MS || 60_000);
const DOWNLOAD_MAX_BYTES = Number(process.env.DOWNLOAD_MAX_BYTES || 512 * 1024 * 1024);
const DOWNLOAD_MAX_REDIRECTS = 3;

app.get('/api/download', verifyJwt, requireNotBanned, async (req, res) => {
  const { url, filename } = req.query;
  if (!url) return res.status(400).json({ error: 'url required' });

  // A URL that appears in the CALLER'S OWN history is allowed regardless of
  // which provider hosts it.
  //
  // N4 (recheck 2026-08-03): that reasoning had a hole. "An attacker cannot
  // plant a URL in someone else's history" is true and irrelevant — they plant
  // it in their OWN. POST /api/entities/:name persists arbitrary client JSON,
  // so two requests (write {"result_url":"https://attacker.tld/x"}, then ask
  // to download it) turned this route into an authenticated proxy for any host
  // on the internet, with a 512 MB ceiling and no rate limit.
  //
  // The host allow-list is therefore enforced on EVERY request now, ownership
  // or not. What made the list unworkable before was that it was written from
  // the code that produces new URLs instead of from the URLs that actually
  // exist; it is now derived from the production data (see download-guard.js),
  // including the kie output host that holds 47% of all history.
  //
  // Ownership no longer changes WHERE we will connect. It is recorded so the
  // logs show whether anyone actually downloads media that is not in their own
  // history — this route has broken twice by tightening it on assumption
  // rather than evidence, so the hard refusal waits until the data says it is
  // safe. Everything reachable is already on the allow-list either way.
  const ownedByCaller = await userOwnsMediaUrl(req.user.id, url);
  if (!ownedByCaller) {
    let host = 'unparseable';
    try { host = new URL(String(url)).hostname; } catch { /* keep placeholder */ }
    console.warn(`[download] user ${req.user.id} fetched a url absent from their history (host=${host})`);
  }

  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    // Follow redirects manually so EVERY hop passes the same allow-list +
    // DNS validation — a trusted CDN must not be able to bounce us to an
    // internal address.
    let target = String(url);
    let response = null;
    for (let hop = 0; hop <= DOWNLOAD_MAX_REDIRECTS; hop++) {
      // N4: no skipHostAllowList. The host list, https-only, no-credentials,
      // no-IP-literal and the private/loopback/link-local DNS rejection all
      // apply on the first hop and on every redirect, without exception.
      //
      // Residual, accepted: assertSafeDownloadUrl resolves the name and fetch()
      // resolves it again, so a DNS rebind between the two is theoretically
      // possible. Pinning the validated address needs a custom undici
      // dispatcher; with connections now limited to a handful of known CDNs an
      // attacker would have to control one of THEIR zones, so the exposure is
      // small. Tracked in TECH-DEBT.md.
      const safeUrl = await assertSafeDownloadUrl(target);
      response = await fetch(safeUrl, { redirect: 'manual', signal: controller.signal });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const loc = response.headers.get('location');
        if (!loc) throw new DownloadRejectedError('Redirect without location', 502);
        if (hop === DOWNLOAD_MAX_REDIRECTS) {
          throw new DownloadRejectedError('Too many redirects', 502);
        }
        target = new URL(loc, safeUrl).toString();
        continue;
      }
      break;
    }
    if (!response.ok) {
      return res.status(502).json({ error: 'The file could not be fetched from storage.' });
    }

    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > DOWNLOAD_MAX_BYTES) {
      return res.status(413).json({ error: 'File too large to download.' });
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const ext = contentType.includes('jpeg') || contentType.includes('jpg') ? 'jpg' : 'png';
    const name = sanitizeFilename(filename, `voxel-ai-${Date.now()}.${ext}`);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    if (declared) res.setHeader('Content-Length', String(declared));

    // Stream with a running byte cap instead of buffering the whole file.
    let sent = 0;
    for await (const chunk of response.body) {
      sent += chunk.length;
      if (sent > DOWNLOAD_MAX_BYTES) {
        controller.abort();
        res.destroy();
        return;
      }
      if (!res.write(chunk)) {
        await new Promise((resolve) => res.once('drain', resolve));
      }
    }
    res.end();
  } catch (error) {
    if (res.headersSent) { res.destroy(); return; }
    if (error instanceof DownloadRejectedError) {
      console.error(`[download] rejected url for user ${req.user?.id}: ${error.message}`);
      return res.status(error.status).json({ error: error.message });
    }
    const timedOut = error?.name === 'AbortError';
    console.error('Download proxy error:', error.message);
    res.status(timedOut ? 504 : 500).json({
      error: timedOut ? 'Download timed out — please try again.' : 'Download failed',
    });
  } finally {
    clearTimeout(deadline);
  }
});

// ─── LLM ENDPOINT (for Studio ScriptModule) ───────────────────────
// N7: was unauthenticated. It returns a static placeholder today, so nothing
// leaks and nothing is billed — but it is the wiring for a real LLM call, and
// an endpoint that becomes expensive later should not be public now. Its only
// caller is the app's own client, used while signed in.
app.post('/api/llm', verifyJwt, requireNotBanned, enhanceLimiter, async (req, res) => {
  const { prompt, response_json_schema } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Prompt required' });
  try {
    // Use FAL's LLM or return a structured placeholder
    // For now, generate a script structure based on the prompt
    const result = {
      text: `# Generated Script\n\n## Scene 1\n${prompt}\n\n## Scene 2\nContinuation of the narrative...\n\n## Scene 3\nClimax and resolution.`,
    };
    res.json(result);
  } catch (error) {
    console.error('LLM error:', error.message);
    res.status(500).json({ error: 'LLM generation failed' });
  }
});

// ─── PROMPT ENHANCER ──────────────────────────────────────────────
// Takes the user's prompt, runs it through fal.ai's `any-llm` (Gemini
// Flash for speed/cost), returns a richer cinematic rewrite. Used by the
// red bolt button in the Image and Video prompt areas.
// H2 (audit 2026-07-28): was unauthenticated — every call spends money on
// a provider LLM. Now JWT + not-banned + a conservative per-user limit.
app.post('/api/enhance-prompt', verifyJwt, requireNotBanned, enhanceLimiter, requireLlm, async (req, res) => {
  const { prompt, type } = req.body || {};
  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ error: 'prompt required' });
  }

  const isVideo = type === 'video';
  const system = isVideo
    ? `You rewrite short user prompts into vivid VIDEO generation prompts.
Output ONLY the rewritten prompt — no preamble, no markdown, no quotes.
Add cinematic details: subject, setting, lighting, lens, camera motion, atmosphere, color palette.
Keep the original intent. 60–110 words. One paragraph.`
    : `You rewrite short user prompts into vivid IMAGE generation prompts.
Output ONLY the rewritten prompt — no preamble, no markdown, no quotes.
Add visual details: subject, setting, lighting, lens, framing, mood, color, texture.
Keep the original intent. 50–90 words. One paragraph.`;

  try {
    // Provider choice and reply-shape handling both live in llm.js now. This
    // route had its own copy of the extraction, which is how it came to be
    // broken in exactly the same way as the agent without anyone noticing.
    const enhanced = await llmText({ system, prompt: prompt.trim(), tag: 'ENHANCE' });
    return res.json({ prompt: enhanced });
  } catch (e) {
    if (respondIfProviderTimeout(res, e)) { logProviderError('ENHANCE', e); return; }
    const status = logProviderError('ENHANCE', e);
    if (isProviderRefusal(status)) {
      return res.status(502).json({
        error: 'The prompt enhancer is unavailable — the AI provider refused the request. Your prompt is unchanged.',
      });
    }
    return res.status(500).json({ error: 'Enhancer failed: ' + publicError(e.message) });
  }
});

// ─── EDIT CUT — THE CHAT AGENT ─────────────────────────────────────
// Turns "cut the first three seconds" into commands the timeline understands.
//
// ── WHAT THIS ROUTE DELIBERATELY DOES NOT DO ──────────────────────
// It does not touch the project, and it does not validate the commands. It is
// an LLM proxy and nothing more. The browser holds the real project, checks
// every command against it (src/lib/edit-agent.js) and refuses anything that
// does not fit. Validating here instead would mean trusting a SUMMARY the
// client sent us to describe a project we cannot see — which proves nothing
// and would let a bad answer through with a server's authority behind it.
//
// So the trust boundary is: this route can return nonsense, and the worst
// outcome is a message in the chat saying the edit was refused.
//
// The command list below MUST match COMMANDS in src/lib/edit-agent.js. That is
// not left to discipline — src/lib/edit-agent-contract.test.js fails if they
// drift, because a command the model is never told about looks to a customer
// exactly like the feature quietly not working.
app.post('/api/edit-agent', verifyJwt, requireNotBanned, enhanceLimiter, requireLlm, async (req, res) => {
  const { instruction, timeline } = req.body || {};
  if (!instruction || typeof instruction !== 'string' || !instruction.trim()) {
    return res.status(400).json({ error: 'Say what you want changed.' });
  }
  if (instruction.length > 2000) {
    return res.status(400).json({ error: 'That instruction is very long — try saying it in a sentence.' });
  }

  // The summary is built by the client and is small by construction. A cap
  // anyway, because an oversized body here is a bill, not just a slow request.
  const summary = JSON.stringify(timeline ?? {});
  if (summary.length > 60_000) {
    return res.status(413).json({ error: 'That project is too large for the assistant to read in one go.' });
  }

  try {
    const raw = await llmText({
      system: AGENT_SYSTEM,
      prompt: `TIMELINE:\n${summary}\n\nINSTRUCTION:\n${instruction.trim()}`,
      tag: 'EDIT-AGENT',
    });
    // Returned as TEXT on purpose. The browser parses it, because the browser
    // is the only place that can check it against the real project.
    return res.json({ raw });
  } catch (e) {
    if (respondIfProviderTimeout(res, e)) { logProviderError('EDIT-AGENT', e); return; }
    const status = logProviderError('EDIT-AGENT', e);
    if (isProviderRefusal(status)) {
      // NOT "try again" — nothing the customer does will change it, and the
      // fix is on the account, not in the timeline. Their work is untouched.
      return res.status(502).json({
        error: 'The assistant is unavailable — the AI provider refused the request. Your timeline has not been changed.',
      });
    }
    return res.status(500).json({ error: 'The assistant failed: ' + publicError(e.message) });
  }
});

// ─── ENTITY CRUD (Postgres-backed) ─────────────────────────────────
// Replaces the previous JSON write-through store at server/data/
// entities.json — that file got wiped on every container redeploy on
// DO App Platform, so user history vanished after each push to main.
// Now persisted in the `entities` table (see db.js migrate()).
//
// Per-user isolation: every route requires a valid JWT and only ever
// touches rows where user_id = req.user.id. PUT/DELETE return 404 (not
// 403) for rows owned by another user so the API doesn't leak the
// existence of another user's record.
//
// Response shape stays identical to the old JSON store: a flat object
// `{ id, user_id, created_date, updated_date, ...data }`. Clients
// (Image.jsx / Video.jsx / etc.) need no changes.

// Spread the JSONB `data` over the row metadata so callers get the
// same flat shape they got from the file store.
function rowToItem(row) {
  return {
    id: row.id,
    user_id: row.user_id,
    created_date: row.created_date instanceof Date ? row.created_date.toISOString() : row.created_date,
    updated_date: row.updated_date instanceof Date ? row.updated_date.toISOString() : row.updated_date,
    // ── EVERY OLD FILE, SERVED FROM THE EDGE ────────────────────────────
    // The database keeps the origin url it was written with. This swaps the
    // host on the way OUT, so a history from before the CDN existed gets the
    // same speed as one made today — without rewriting a single record.
    //
    // A no-op until SPACES_CDN_BASE is set, and reverting is deleting that
    // variable: there is no migration to undo. This is the ONE place every
    // entity read passes through, so nothing can be missed and nothing has
    // to be remembered at the call sites.
    ...cdnifyDeep(row.data || {}),
  };
}

// Sort spec like "-created_date" or "created_date" → "ORDER BY ... DESC".
// Whitelist the columns we sort on — JSONB inner-key sort would need
// `data->>'foo'` and isn't worth the surface area today; the only sort
// any caller uses is `-created_date`.
const SORTABLE = new Set(['created_date', 'updated_date']);
function sortClause(sort) {
  if (!sort) return 'ORDER BY created_date DESC';
  const desc = sort.startsWith('-');
  const field = desc ? sort.slice(1) : sort;
  if (!SORTABLE.has(field)) return 'ORDER BY created_date DESC';
  return `ORDER BY ${field} ${desc ? 'DESC' : 'ASC'}`;
}

function clampLimit(limit) {
  const n = Number(limit);
  if (!Number.isFinite(n) || n <= 0) return 200;
  return Math.min(500, Math.floor(n));
}

// Page offset for pagination. Clamped to a non-negative integer; unbounded on
// the high end so a user with 10k+ history items can page all the way through.
function clampOffset(offset) {
  const n = Number(offset);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

app.post('/api/entities/:name/filter', verifyJwt, async (req, res) => {
  if (!dbReady()) return res.status(503).json({ error: 'Database not configured.' });
  try {
    const { query, sort, limit, offset } = req.body || {};
    const params = [req.user.id, req.params.name];
    // A deleted picture must stop appearing the moment it is deleted. This
    // filter is the entire difference between "deleted" and "still there but
    // we called it deleted" — see soft-delete.js, and the guard test that
    // scans every read for it.
    let where = `user_id = $1 AND name = $2 AND deleted_at IS NULL`;
    if (query && typeof query === 'object' && Object.keys(query).length) {
      params.push(JSON.stringify(query));
      where += ` AND data @> $${params.length}::jsonb`;
    }
    params.push(clampLimit(limit));
    const limitIdx = params.length;
    params.push(clampOffset(offset));
    const offsetIdx = params.length;
    const sql = `SELECT * FROM entities WHERE ${where} ${sortClause(sort)} LIMIT $${limitIdx} OFFSET $${offsetIdx}`;
    const { rows } = await pool.query(sql, params);
    res.json(rows.map(rowToItem));
  } catch (e) {
    console.error('[entities:filter] error:', e.message);
    res.status(500).json({ error: 'Filter failed.' });
  }
});

app.get('/api/entities/:name', verifyJwt, async (req, res) => {
  if (!dbReady()) return res.status(503).json({ error: 'Database not configured.' });
  try {
    const params = [req.user.id, req.params.name, clampLimit(req.query.limit), clampOffset(req.query.offset)];
    const sql = `SELECT * FROM entities WHERE user_id = $1 AND name = $2 AND deleted_at IS NULL ${sortClause(req.query.sort)} LIMIT $3 OFFSET $4`;
    const { rows } = await pool.query(sql, params);
    res.json(rows.map(rowToItem));
  } catch (e) {
    console.error('[entities:list] error:', e.message);
    res.status(500).json({ error: 'List failed.' });
  }
});

// N12 (recheck 2026-08-03): create/update carried verifyJwt but NOT
// requireNotBanned, so a banned account could still write history rows —
// storage abuse, and the exact mechanism that lets N4 plant a result_url.
// Reads (GET and the POST /filter query) stay open on purpose: a banned
// user must still be able to load the app far enough to be told they are
// banned, and DELETE stays open so they can remove their own content.
app.post('/api/entities/:name', verifyJwt, requireNotBanned, async (req, res) => {
  if (!dbReady()) return res.status(503).json({ error: 'Database not configured.' });
  try {
    // Strip any client-supplied user_id / id / timestamps before persisting.
    // user_id is the auth-stamped one; the rest are db-managed.
    const { user_id: _u, id: _id, created_date: _c, updated_date: _ud, ...data } = req.body || {};
    const id = crypto.randomUUID();
    const sql = `
      INSERT INTO entities (id, name, user_id, data)
      VALUES ($1, $2, $3, $4::jsonb)
      RETURNING *
    `;
    const { rows } = await pool.query(sql, [id, req.params.name, req.user.id, JSON.stringify(data)]);
    res.json(rowToItem(rows[0]));
  } catch (e) {
    console.error('[entities:create] error:', e.message);
    res.status(500).json({ error: 'Create failed.' });
  }
});

app.put('/api/entities/:name/:id', verifyJwt, requireNotBanned, async (req, res) => {
  if (!dbReady()) return res.status(503).json({ error: 'Database not configured.' });
  try {
    const { user_id: _u, id: _id, created_date: _c, updated_date: _ud, ...patch } = req.body || {};
    // Merge into existing JSONB. `||` is the JSONB concat that does shallow
    // override — same semantics as the old `{...store[idx], ...body}` spread.
    const sql = `
      UPDATE entities
         SET data = data || $1::jsonb,
             updated_date = NOW()
       WHERE id = $2 AND user_id = $3 AND name = $4
       RETURNING *
    `;
    const { rows } = await pool.query(sql, [JSON.stringify(patch), req.params.id, req.user.id, req.params.name]);
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(rowToItem(rows[0]));
  } catch (e) {
    console.error('[entities:update] error:', e.message);
    res.status(500).json({ error: 'Update failed.' });
  }
});

app.delete('/api/entities/:name/:id', verifyJwt, async (req, res) => {
  if (!dbReady()) return res.status(503).json({ error: 'Database not configured.' });
  try {
    // ── HISTORY IS SOFT-DELETED (2026-08-28) ──
    // Until now this route removed the row outright, so a customer who deleted
    // a picture lost it, permanently, with no way for anyone to help them.
    // Amr approved a 30-day recovery window, and the confirmation the customer
    // reads promises exactly that — so history goes to `deleted_at` and the
    // purge collects it a month later.
    //
    // Everything else — node spaces, drafts — is still removed outright.
    // Those are the customer's own working documents, not their paid-for work.
    if (req.params.name === 'GenerationHistory') {
      const { rowCount } = await pool.query(SOFT_DELETE_SQL, [[req.params.id], req.user.id]);
      if (rowCount === 0) return res.status(404).json({ error: 'Not found' });
      return res.json({ success: true, recoverable_days: RECOVERY_DAYS });
    }
    const { rowCount } = await pool.query(
      `DELETE FROM entities WHERE id = $1 AND user_id = $2 AND name = $3`,
      [req.params.id, req.user.id, req.params.name]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (e) {
    console.error('[entities:delete] error:', e.message);
    res.status(500).json({ error: 'Delete failed.' });
  }
});

// ─── SEARCHING YOUR OWN HISTORY (2026-08-28) ───────────────────────
// Words, date, model. Amr's request, and the right one: the grid was already
// paged and lazy, so the remaining pain was never loading — it was FINDING.
// There was no search of any kind. A customer with 349 pictures looking for
// last Tuesday's work had exactly one option: scroll.
//
// The scoping is not in this route. buildSearch REFUSES to produce SQL without
// a user, so a bug here cannot widen it — see history-search.js.
app.post('/api/history/search', verifyJwt, requireNotBanned, async (req, res) => {
  if (!dbReady()) return res.status(503).json({ error: 'Database not configured.' });
  const b = req.body || {};
  try {
    const q = buildSearch({
      userId: req.user.id,
      type: b.type === 'video' ? 'video' : b.type === 'image' ? 'image' : null,
      text: b.text, from: b.from || null, to: b.to || null,
      models: Array.isArray(b.models) ? b.models.slice(0, 40) : null,
      savedOnly: b.saved === true,
      limit: b.limit, offset: b.offset,
    });
    // The count runs alongside, not after: the customer needs "128 pictures"
    // at the same moment as the first 30, or the number arrives too late to
    // tell them whether their search was too narrow.
    const [page, total] = await Promise.all([
      pool.query(q.sql, q.params),
      pool.query(q.countSql, q.countParams),
    ]);
    res.json({ items: page.rows.map(toGridItem), total: total.rows[0]?.total ?? 0 });
  } catch (e) {
    console.error('[history:search] failed:', e.message);
    res.status(500).json({ error: 'Search failed.' });
  }
});

// Just the ids that match, for "Select all 128".
//
// ── WHY THIS EXISTS AT ALL ─────────────────────────────────────────────────
// Bulk delete takes IDS, never a filter — re-running a filter on the server
// could match a DIFFERENT set by the time the request lands, and the customer
// would have confirmed a number that was no longer true.
//
// But the browser only holds the 60 rows it has loaded. Without this, "Select
// all 128" would silently mean "all 60 you can see", the customer would press
// delete expecting everything, and two thirds would quietly survive. So the
// ids come down first, and the delete still sends exactly what was counted.
//
// Capped, and the cap is REPORTED rather than silently applied — a truncated
// selection that says nothing is the same lie in a different place.
app.post('/api/history/search/ids', verifyJwt, requireNotBanned, async (req, res) => {
  if (!dbReady()) return res.status(503).json({ error: 'Database not configured.' });
  const b = req.body || {};
  const CAP = 500;
  try {
    const q = buildSearch({
      userId: req.user.id,
      type: b.type === 'video' ? 'video' : b.type === 'image' ? 'image' : null,
      text: b.text, from: b.from || null, to: b.to || null,
      models: Array.isArray(b.models) ? b.models.slice(0, 40) : null,
      savedOnly: b.saved === true,
      limit: 1, offset: 0,
    });
    // Reuse the search's WHERE so the ids can never describe a different set
    // than the count and the grid did.
    const where = q.countSql.slice(q.countSql.indexOf('WHERE'));
    const { rows } = await pool.query(
      `SELECT id FROM entities ${where} ORDER BY created_date DESC LIMIT ${CAP + 1}`, q.countParams);
    const ids = rows.slice(0, CAP).map((r) => r.id);
    res.json({ ids, capped: rows.length > CAP, cap: CAP });
  } catch (e) {
    console.error('[history:ids] failed:', e.message);
    res.status(500).json({ error: 'Could not select everything.' });
  }
});

// The models THIS customer has used — not all 28. Offering models they have
// never touched, most returning nothing, makes the filter feel broken.
// GET *and* POST. The browser's only helper for calling a function is
// base44Client's `invoke`, which always POSTs — so a GET-only route is
// UNREACHABLE from the app, which is exactly how it shipped: Amr opened the
// model dropdown, it was disabled, and the reason was a 404 nobody saw because
// the client swallows the failure into an empty list.
//
// Sixth time today that "built and deployed" meant "unreachable". The read is
// genuinely a GET, so both verbs are registered rather than pretending it is
// a write.
app.all(['/api/history/models'], verifyJwt, async (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'POST') return next();
  if (!dbReady()) return res.status(503).json({ error: 'Database not configured.' });
  try {
    const asked = req.query.type || req.body?.type;
    const type = asked === 'video' ? 'video' : asked === 'image' ? 'image' : null;
    const { rows } = await pool.query(MODELS_USED_SQL, [req.user.id, type]);
    res.json({ models: rows.map((r) => r.model).filter(Boolean) });
  } catch (e) {
    console.error('[history:models] failed:', e.message);
    res.status(500).json({ error: 'Could not load the model list.' });
  }
});

// ─── RECENTLY DELETED (2026-08-28) ─────────────────────────────────
// The customer's own half of the recovery window, so the ordinary mistake
// never reaches Amr at all. His Recovery tab stays for the cases that need
// him: a closed account, a bulk mistake, somebody who cannot find it.
app.all(['/api/history/deleted'], verifyJwt, async (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'POST') return next();
  if (!dbReady()) return res.status(503).json({ error: 'Database not configured.' });
  try {
    const { rows } = await pool.query(
      `SELECT id, deleted_at, data->>'type' AS type, data->>'model' AS model,
              data->>'thumb_url' AS thumb_url, data->>'result_url' AS result_url,
              left(COALESCE(data->>'prompt',''), 160) AS prompt
         FROM entities
        WHERE user_id = $1 AND name = 'GenerationHistory'
          AND deleted_at IS NOT NULL
          AND deleted_at > NOW() - INTERVAL '${RECOVERY_DAYS} days'
        ORDER BY deleted_at DESC LIMIT 120`, [req.user.id]);
    res.json({
      items: rows.map((r) => ({ ...r, days_left: daysLeft(r.deleted_at) })),
      recovery_days: RECOVERY_DAYS,
    });
  } catch (e) {
    console.error('[history:deleted] failed:', e.message);
    res.status(500).json({ error: 'Could not load recently deleted.' });
  }
});

app.post('/api/history/restore', verifyJwt, requireNotBanned, async (req, res) => {
  if (!dbReady()) return res.status(503).json({ error: 'Database not configured.' });
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.slice(0, 500) : [];
  if (!ids.length) return res.status(400).json({ error: 'Nothing to restore.' });
  try {
    const { rows } = await pool.query(RESTORE_OWN_SQL, [ids, req.user.id]);
    // Says how many, not just "ok". Asking for 40 and getting 38 back is a
    // fact the customer needs — the other two aged out.
    res.json({ restored: rows.length, asked: ids.length });
  } catch (e) {
    console.error('[history:restore] failed:', e.message);
    res.status(500).json({ error: 'Could not restore.' });
  }
});

// Bulk delete. Ids only — NEVER "everything matching this filter" evaluated on
// the server. The browser sends exactly what it counted and showed; a filter
// re-run here could match a different set by the time it arrives, and the
// customer would have confirmed a number that was no longer true.
app.post('/api/history/delete', verifyJwt, requireNotBanned, async (req, res) => {
  if (!dbReady()) return res.status(503).json({ error: 'Database not configured.' });
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.slice(0, 500) : [];
  if (!ids.length) return res.status(400).json({ error: 'Nothing to delete.' });
  try {
    const { rows } = await pool.query(SOFT_DELETE_SQL, [ids, req.user.id]);
    console.log(`[history:delete] user=${req.user.id} deleted ${rows.length} of ${ids.length}`);
    res.json({ deleted: rows.length, asked: ids.length, recoverable_days: RECOVERY_DAYS });
  } catch (e) {
    console.error('[history:delete] failed:', e.message);
    res.status(500).json({ error: 'Could not delete.' });
  }
});

// ─── VOXEL NODE — canvas spaces + single-node run ──────────────────
// A "Node Space" is one infinite canvas graph (React Flow nodes+edges).
// All routes are owner-scoped: a user only ever sees/edits their own
// spaces. Node outputs are persisted inline in the graph JSON for the
// P0-P2 slice; the async run engine + run history table arrive in P3.

// Allow-listed image models for the Image Generator node. The browser
// sends a friendly label (settings.model); the server resolves it to the
// FAL endpoint so a client can't point a node at an arbitrary/expensive
// model. Mirrored on the client (nodeRegistry.js IMAGE_MODELS).
// The Image Generator node reuses the SAME proven model map as the main
// Image page (MODEL_CONFIG above) — so "Nano Banana Pro" hits
// fal-ai/nano-banana-pro, "GPT Image 2" hits openai/gpt-image-2, etc.
// Only text-to-image-capable models are offered as node options (the
// edit-only tools like Face Swap / Relight need an input image and so
// aren't generators). Mirrored on the client (nodeRegistry.js).
// kie-first catalog with FAL fallback (2026-07-21).
const NODE_IMAGE_MODEL_NAMES = [
  'Nano Banana Pro', 'Nano Banana 2', 'GPT Image 2', 'GPT Image 1.5',
  'Seedream 5.0 Lite', 'Seedream 4.5', 'Flux Kontext', 'Flux 2',
  'Soul 2.0', 'Wan 2.2 Image',
];
// Synchronous node run specs (image + audio). Each declares: the credit
// kind to charge, how to resolve the FAL model, how to build the input,
// and how to pull the output URL + which output port to fill. Async
// (video) lives in its own /run-node-async route.
const NODE_SYNC_SPECS = {
  'image-generator': {
    creditKind: 'image',
    // Connected upstream images switch the node out of text-to-image:
    //   • 2+ references + an edit-capable model → multi-image edit (image_urls)
    //   • 1 reference → image-to-image (single image param)
    //   • none → text-to-image
    resolve: (s) => {
      const cfg = MODEL_CONFIG[s?.model] || MODEL_CONFIG['Nano Banana Pro'];
      const n = Array.isArray(s?.image_urls) ? s.image_urls.length : (s?.image_url ? 1 : 0);
      if (n > 1 && cfg.edit) return cfg.edit;
      if (n >= 1) return cfg.i2i || cfg.t2i;
      return cfg.t2i;
    },
    buildInput: (s, prompt) => {
      const cfg = MODEL_CONFIG[s?.model] || MODEL_CONFIG['Nano Banana Pro'];
      const ratio = s?.aspect_ratio || '1:1';
      const quality = s?.quality || '1K';
      const { width, height } = getDimensions(ratio, quality);
      const urls = Array.isArray(s?.image_urls) && s.image_urls.length
        ? s.image_urls.filter(Boolean)
        : (s?.image_url ? [s.image_url] : []);
      const base = {
        prompt, num_images: 1, safety_tolerance: '4',
        ...(cfg.nativeSizing
          ? { aspect_ratio: ratio, resolution: RESOLUTION_MAP[quality] || '1K' }
          : { image_size: { width, height } }),
      };
      // 2+ refs on an edit-capable model → image_urls array; else single i2i.
      if (urls.length > 1 && cfg.edit) return { ...base, image_urls: urls.slice(0, 14) };
      if (urls.length >= 1) return { ...base, [cfg.imgParam || 'image_url']: urls[0] };
      return base;
    },
    extract: (d) => d?.images?.[0]?.url || d?.image?.url || null,
    outKey: 'image',
  },
  'voiceover': {
    creditKind: 'audio',
    resolve: () => 'fal-ai/elevenlabs/tts/multilingual-v2',
    buildInput: (s, prompt) => ({ text: prompt, voice: s?.voice || 'Rachel' }),
    extract: (d) => d?.audio?.url || null,
    outKey: 'audio',
  },
  'music': {
    creditKind: 'audio',
    resolve: () => 'fal-ai/lyria2',
    buildInput: (s, prompt) => ({ prompt }),
    extract: (d) => d?.audio?.url || null,
    outKey: 'audio',
  },
};

// The Video Generator node reuses VIDEO_DIRECT_MAP (the same map the main
// Video page uses) for both text-to-video and image-to-video. Only models
// that actually expose a t2v endpoint are offered. Mirrored client-side.
const NODE_VIDEO_MODEL_NAMES = [
  'Kling 3.0', 'Kling 2.6', 'Veo 3.1', 'Wan 2.6', 'Seedance 2.0',
  'Hailuo 2.3', 'PixVerse 5', 'Sora 2', 'Luma Dream Machine',
];

// Async node video charges are tracked in the shared pending_video_charges
// table (see video-charges.js) — one idempotent refund path for every async
// video, whether it fails via /api/video-status polling or is reported by
// the node client through /api/node/run-failed.

// Ownership guard: returns the row if the caller owns the space, else
// writes the right status and returns null.
async function loadOwnedSpace(req, res) {
  const { rows } = await pool.query(
    `SELECT id, owner_id, name, graph FROM node_spaces WHERE id = $1`,
    [req.params.id]
  );
  if (rows.length === 0) { res.status(404).json({ error: 'Space not found' }); return null; }
  if (rows[0].owner_id !== req.user.id) { res.status(403).json({ error: 'Forbidden' }); return null; }
  return rows[0];
}

// List the caller's spaces (newest first).
app.get('/api/node/spaces', verifyJwt, requireNotBanned, async (req, res) => {
  if (!dbReady()) return res.status(503).json({ error: 'Database not configured.' });
  try {
    const { rows } = await pool.query(
      `SELECT id, name, created_at, updated_at FROM node_spaces WHERE owner_id = $1 ORDER BY updated_at DESC LIMIT 100`,
      [req.user.id]
    );
    res.json(rows);
  } catch (e) {
    console.error('[node:spaces:list] error:', e.message);
    res.status(500).json({ error: 'List failed.' });
  }
});

// Create a new blank space.
app.post('/api/node/spaces', verifyJwt, requireNotBanned, async (req, res) => {
  if (!dbReady()) return res.status(503).json({ error: 'Database not configured.' });
  try {
    const name = (typeof req.body?.name === 'string' && req.body.name.trim())
      ? req.body.name.trim().slice(0, 255)
      : 'Untitled Space';
    const { rows } = await pool.query(
      `INSERT INTO node_spaces (owner_id, name) VALUES ($1, $2) RETURNING id, name, graph, created_at, updated_at`,
      [req.user.id, name]
    );
    console.log(`[node:spaces:create] user=${req.user.id} space=${rows[0].id}`);
    res.json(rows[0]);
  } catch (e) {
    console.error('[node:spaces:create] error:', e.message);
    res.status(500).json({ error: 'Create failed.' });
  }
});

// Load one space's full graph (owner only).
app.get('/api/node/spaces/:id', verifyJwt, requireNotBanned, async (req, res) => {
  if (!dbReady()) return res.status(503).json({ error: 'Database not configured.' });
  try {
    const space = await loadOwnedSpace(req, res);
    if (!space) return;
    res.json(space);
  } catch (e) {
    console.error('[node:spaces:get] error:', e.message);
    res.status(500).json({ error: 'Load failed.' });
  }
});

// Save a space's graph + name (owner only). Client debounces this.
app.put('/api/node/spaces/:id', verifyJwt, requireNotBanned, async (req, res) => {
  if (!dbReady()) return res.status(503).json({ error: 'Database not configured.' });
  try {
    const space = await loadOwnedSpace(req, res);
    if (!space) return;
    const graph = req.body?.graph;
    if (graph && typeof graph === 'object') {
      // Reject oversized graphs (64KB+ per spec D4/§6 validation rule).
      if (JSON.stringify(graph).length > 2 * 1024 * 1024) {
        return res.status(413).json({ error: 'Graph too large (max 2MB).' });
      }
    }
    const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 255) : space.name;
    const { rows } = await pool.query(
      `UPDATE node_spaces SET graph = COALESCE($1::jsonb, graph), name = $2, updated_at = NOW()
        WHERE id = $3 RETURNING id, name, updated_at`,
      [graph ? JSON.stringify(graph) : null, name, req.params.id]
    );
    res.json(rows[0]);
  } catch (e) {
    console.error('[node:spaces:save] error:', e.message);
    res.status(500).json({ error: 'Save failed.' });
  }
});

// Run a single node. Charges credits, calls FAL, refunds on failure.
// Synchronous (fal.subscribe) for the slice — async queue is P3.
app.post('/api/node/run-node', verifyJwt, requireNotBanned, noDoubleCharge, requireFalKey, async (req, res) => {
  if (!dbReady()) return res.status(503).json({ error: 'Database not configured.' });

  const { type, settings } = req.body || {};
  const spec = NODE_SYNC_SPECS[type];
  if (!spec) return res.status(400).json({ error: `Unsupported node type: ${type || '(missing)'}` });

  // N5: the node canvas reaches the same providers as the normal pages, so it
  // honours the same allow-list. The node's chosen model is the label when
  // there is one; otherwise the node type itself.
  const nodeLabel = settings?.model || type;
  if (!modelAllowedForUser(req, nodeLabel)) return res.status(403).json(MODEL_BLOCKED(nodeLabel));

  const falModel = spec.resolve(settings);

  const prompt = settings?.prompt;
  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(422).json({ error: 'prompt required' });
  }
  if (prompt.length > 64 * 1024) {
    return res.status(422).json({ error: 'prompt too long (max 64KB)' });
  }

  let chargedKind = null;
  let chargedCost = null;
  try {
    const charge = await chargeCredits({ userId: req.user.id, kind: spec.creditKind, ip: clientIp(req), note: `node: ${settings?.model || type}`, provider: 'fal' });
    chargedKind = spec.creditKind;
    res.setHeader('X-Credits-Remaining', String(charge.newBalance));
  } catch (e) {
    if (e instanceof InsufficientCreditsError) {
      return res.status(402).json({ error: 'Not enough credits, please contact admin', current_balance: e.balance, required: e.required });
    }
    if (e.code === 'BANNED') return res.status(403).json({ error: 'Account is banned.' });
    console.error('[node:run] charge error:', e.message);
    return res.status(500).json({ error: 'Credit charge failed.' });
  }

  // ── kie.ai-backed image models (Nano Banana Pro, GPT Image 2) ──
  // Same createTask → poll → re-host flow as /api/generate's kie branch.
  const nodeImgCfg = type === 'image-generator'
    ? (MODEL_CONFIG[settings?.model] || MODEL_CONFIG['Nano Banana Pro'])
    : null;
  if (nodeImgCfg?.provider === 'kie') {
    try {
      const rawNodeUrls = Array.isArray(settings?.image_urls) && settings.image_urls.length
        ? settings.image_urls.filter(Boolean)
        : (settings?.image_url ? [settings.image_url] : []);
      const urls = await resolveReferenceUrls(rawNodeUrls, { forKie: true, tag: 'REFS-NODE' });
      const body = buildKieImageInput(nodeImgCfg, {
        prompt: prompt.trim(),
        ratio: settings?.aspect_ratio || '1:1',
        quality: settings?.quality || '1K',
        imageUrls: urls,
      });
      console.log(`[node:run] user=${req.user.id} type=${type} model="${settings?.model || '-'}" → kie:${nodeImgCfg.kieModel}`);
      const taskId = await kieCreateTask(nodeImgCfg.family, body, { tag: 'KIE-NODE' });
      const done = await kiePollUntilDone(nodeImgCfg.family, taskId, { timeoutMs: 90_000, tag: 'KIE-NODE' });
      const url = await persistOrFallback(done.resultUrls[0], 'image');
      console.log(`[node:run] ✅ ${url}`);
      return res.json({ success: true, outputs: { [spec.outKey]: url } });
    } catch (error) {
      console.error('[node:run] [KIE] error:', error.message);
      if (chargedKind) {
        refundCredits({ userId: req.user.id, kind: chargedKind, ip: clientIp(req), reason: `node_run_kie_threw: ${error.message}`.slice(0, 500) }).catch(() => {});
      }
      return res.status(500).json({ error: 'Node run failed: ' + publicError(error.message) });
    }
  }

  const input = spec.buildInput(settings, prompt.trim());
  console.log(`[node:run] user=${req.user.id} type=${type} model="${settings?.model || '-'}" → ${falModel}`);

  try {
    const result = await falSubscribe(falModel, { input, logs: false }, 'FAL-NODE');
    const url = spec.extract(result?.data);
    if (!url) throw new Error('No output returned by model');
    console.log(`[node:run] ✅ ${url}`);
    return res.json({ success: true, outputs: { [spec.outKey]: url } });
  } catch (error) {
    console.error('[node:run] FAL error:', error.message);
    if (chargedKind) {
      refundCredits({ userId: req.user.id, kind: chargedKind, ip: clientIp(req), reason: `node_run_threw: ${error.message}`.slice(0, 500) }).catch(() => {});
    }
    if (respondIfProviderTimeout(res, error)) return;
    return res.status(500).json({ error: 'Node run failed: ' + publicError(error?.body?.detail || error.message) });
  }
});

// Run an ASYNC node (video). Charges credits, submits to the FAL queue,
// returns { job_id, model_id }. The client polls the existing
// /api/video-status route until COMPLETED/FAILED. Used by the Video
// Generator node, which can run text-to-video or — when an upstream
// image is connected — image-to-video (start frame).
app.post('/api/node/run-node-async', verifyJwt, requireNotBanned, noDoubleCharge, requireFalKey, async (req, res) => {
  if (!dbReady()) return res.status(503).json({ error: 'Database not configured.' });

  const { type, settings } = req.body || {};
  if (type !== 'video-generator') {
    return res.status(400).json({ error: `Unsupported async node type: ${type || '(missing)'}` });
  }

  const prompt = settings?.prompt;
  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(422).json({ error: 'prompt required' });
  }
  if (prompt.length > 64 * 1024) {
    return res.status(422).json({ error: 'prompt too long (max 64KB)' });
  }

  const modelLabel = settings?.model;
  // N5: the async video node spends credits like every other path, so it takes
  // the same allow-list gate — before pricing, before charging.
  if (!modelAllowedForUser(req, modelLabel || type)) {
    return res.status(403).json(MODEL_BLOCKED(modelLabel || type));
  }
  // Upstream image(s). image_urls is the multi-reference array; image_url is
  // the single start frame (first reference) for back-compat.
  const imageUrls = Array.isArray(settings?.image_urls)
    ? settings.image_urls.filter(Boolean)
    : (settings?.image_url ? [settings.image_url] : []);
  const imageUrl = settings?.image_url || imageUrls[0] || null;
  // Reuse the same VIDEO_DIRECT_MAP the main Video page uses, so the node
  // hits the exact proven FAL endpoints + correct image field names.
  const dm = VIDEO_DIRECT_MAP[modelLabel] || VIDEO_DIRECT_MAP['Kling 3.0'];
  // Multiple references + a model that supports reference-to-video (Seedance
  // 2.0 family) → use the ref endpoint with image_urls. A single image → i2v
  // start frame. None → text-to-video.
  const useRef = imageUrls.length > 0 && !!dm.ref;
  const useI2V = !useRef && !!imageUrl;
  const falModel = useRef ? dm.ref : (useI2V ? (dm.i2v || dm.t2v) : dm.t2v);

  let chargedKind = null;
  let chargedCost = null;
  let chargedLabel = null;
  try {
    // C1: the node client never sends a price — charge the flat per-kind
    // cost server-side. req.body.credit_cost is deliberately IGNORED here:
    // an attacker could otherwise name their own price.
    const charge = await chargeCredits({ userId: req.user.id, kind: 'video', ip: clientIp(req), note: `node video: ${modelLabel || 'video-generator'}`, provider: 'fal' });
    chargedKind = 'video';
    chargedCost = charge.cost;
    chargedLabel = charge.label;
    res.setHeader('X-Credits-Remaining', String(charge.newBalance));
  } catch (e) {
    if (e instanceof InsufficientCreditsError) {
      return res.status(402).json({ error: 'Not enough credits, please contact admin', current_balance: e.balance, required: e.required });
    }
    if (e.code === 'BANNED') return res.status(403).json({ error: 'Account is banned.' });
    console.error('[node:run-async] charge error:', e.message);
    return res.status(500).json({ error: 'Credit charge failed.' });
  }

  // ── kie.ai-backed video models (Kling 3.0/2.6, Seedance 2.x, Veo 3) ──
  // Submit to kie and hand back a kie:-prefixed model_id; the node polls the
  // same /api/video-status route, which routes the prefix to kie.
  if (dm.provider === 'kie') {
    try {
      let submission;
      if (dm.kieModel?.startsWith('bytedance/seedance')) {
        // Seedance jobs schema: references vs start frame vs plain t2v.
        const allowedRes = dm.kieModel === 'bytedance/seedance-2'
          ? ['480p', '720p', '1080p', '4k'] : ['480p', '720p'];
        const res_ = allowedRes.includes(String(settings?.resolution).toLowerCase())
          ? String(settings.resolution).toLowerCase() : '720p';
        submission = {
          family: 'jobs',
          body: {
            model: dm.kieModel,
            input: {
              prompt: prompt.trim(),
              aspect_ratio: ['1:1', '4:3', '3:4', '16:9', '9:16', '21:9'].includes(settings?.aspect_ratio)
                ? settings.aspect_ratio : 'adaptive',
              duration: Math.min(15, Math.max(4, parseInt(settings?.duration, 10) || 5)),
              resolution: res_,
              generate_audio: true,
              ...(imageUrls.length > 1 ? { reference_image_urls: imageUrls.slice(0, 9) } : {}),
              ...(imageUrls.length === 1 ? { first_frame_url: imageUrls[0] } : {}),
            },
          },
          modelIdTag: 'kie:jobs:' + dm.kieModel,
        };
      } else {
        submission = buildKieVideoSubmission(dm, {
          prompt: prompt.trim(),
          frames: imageUrl ? [imageUrl] : [],
          duration: settings?.duration,
          aspectRatio: settings?.aspect_ratio,
          resolution: settings?.resolution,
        });
      }
      console.log(`[node:run-async] user=${req.user.id} model="${modelLabel}" → ${submission.modelIdTag}`);
      const taskId = await kieCreateTask(submission.family, submission.body, { tag: 'KIE-NODE' });
      await trackVideoCharge(taskId, { userId: req.user.id, kind: chargedKind, cost: chargedCost, modelLabel: chargedLabel, modelId: submission.modelIdTag });
      return res.json({ success: true, job_id: taskId, model_id: submission.modelIdTag });
    } catch (error) {
      console.error('[node:run-async] [KIE] error:', error.message);
      if (chargedKind) {
        refundCredits({ userId: req.user.id, kind: chargedKind, ip: clientIp(req), cost: chargedCost, reason: `node_async_kie_threw: ${error.message}`.slice(0, 500) }).catch(() => {});
      }
      return res.status(500).json({ error: 'Node video failed: ' + publicError(error.message) });
    }
  }

  // Use the model's own start-frame field name (start_image_url / image_url /
  // start_frame) from the map so i2v lands correctly.
  const imageParam = dm.imageParam || 'image_url';
  const input = {
    prompt: prompt.trim(),
    duration: String(settings?.duration || 5),
    aspect_ratio: settings?.aspect_ratio || '16:9',
    ...(useRef ? { image_urls: imageUrls.slice(0, 9), resolution: settings?.resolution || '720p' } : {}),
    ...(useI2V ? { [imageParam]: imageUrl } : {}),
  };
  const mode = useRef ? `ref(${imageUrls.length})` : useI2V ? 'i2v' : 't2v';
  console.log(`[node:run-async] user=${req.user.id} model="${modelLabel}" ${mode} → ${falModel}`);

  try {
    const submitted = await fal.queue.submit(falModel, { input });
    // Registered so /run-failed and /api/video-status can refund on failure.
    await trackVideoCharge(submitted.request_id, { userId: req.user.id, kind: chargedKind, cost: chargedCost, modelLabel: chargedLabel, modelId: falModel });
    return res.json({ success: true, job_id: submitted.request_id, model_id: falModel });
  } catch (error) {
    console.error('[node:run-async] submit error:', error.message);
    if (chargedKind) {
      refundCredits({ userId: req.user.id, kind: chargedKind, ip: clientIp(req), reason: `node_async_threw: ${error.message}`.slice(0, 500) }).catch(() => {});
    }
    return res.status(500).json({ error: 'Video submit failed: ' + publicError(error?.body?.detail || error.message) });
  }
});

// Refund a video node whose FAL job failed during polling. Verifies with
// FAL that the job actually FAILED (so a succeeded job can't be refunded)
// and that the caller owns it, and refunds at most once.
app.post('/api/node/run-failed', verifyJwt, requireNotBanned, async (req, res) => {
  const { job_id } = req.body || {};
  const rec = job_id ? await getVideoCharge(job_id) : null;
  if (!rec) return res.json({ refunded: false, reason: 'unknown_job' });
  if (String(rec.userId) !== String(req.user.id)) return res.status(403).json({ error: 'Forbidden' });
  if (rec.status !== 'pending') return res.json({ refunded: false, reason: 'already' });

  try {
    // Verify the failure with the job's ACTUAL provider before refunding —
    // a client claim alone never moves money. kie:-prefixed model ids poll
    // kie; everything else is a FAL request id.
    let failed;
    if (String(rec.modelId || '').startsWith('kie:')) {
      const family = rec.modelId.startsWith('kie:jobs:') ? 'jobs' : 'veo';
      const t = await kieGetTask(family, job_id, { tag: 'KIE-NODE' });
      failed = t.state === 'fail';
    } else {
      const status = await fal.queue.status(rec.modelId, { requestId: job_id, logs: false });
      failed = status.status === 'FAILED' || status.status === 'ERROR';
    }
    if (!failed) return res.json({ refunded: false, reason: 'not_failed' });
    const refunded = await refundFailedVideo(job_id, 'node client reported failure (provider-verified)');
    return res.json({ refunded });
  } catch (e) {
    console.error('[node:run-failed] error:', e.message);
    return res.status(500).json({ error: 'Refund check failed.' });
  }
});

// ─── AUTH: REGISTER ─────────────────────────────────────────────────
app.post('/api/auth/register', registerLimiter, requireAuthInfra, async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'Invalid email address.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }

    const password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    let result;
    try {
      result = await pool.query(
        `INSERT INTO users (email, password_hash, credits, role)
         VALUES ($1, $2, 0, 'user')
         RETURNING id, email, credits, credit_limit, role, banned, package, created_at`,
        [email, password_hash]
      );
    } catch (err) {
      // 23505 = unique_violation (email already exists)
      if (err.code === '23505') {
        return res.status(409).json({ error: 'An account with that email already exists.' });
      }
      throw err;
    }

    const user = result.rows[0];

    // Mark the signup in credits_history for a clean audit trail. Amount is 0
    // today — when Stripe lands and we grant N free signup credits, the same
    // row will carry the actual amount and a 'signup' action.
    pool.query(
      `INSERT INTO credits_history (user_id, amount, action, ip_address)
       VALUES ($1, 0, 'signup', $2)`,
      [user.id, clientIp(req)]
    ).catch(err => console.error('[auth/register] credits_history insert failed:', err.message));

    const token = jwt.sign(
      { sub: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    res.status(201).json({ token, user });
  } catch (err) {
    console.error('[auth/register] error:', err);
    res.status(500).json({ error: 'Registration failed.' });
  }
});

// ─── AUTH: LOGIN ────────────────────────────────────────────────────
// Note: we deliberately return the same 401 message whether the email is
// unknown OR the password is wrong. Distinguishing them leaks which emails
// have accounts (user-enumeration attack).
//
// Two independent throttles, both keyed on the REAL client IP (clientIp →
// CF-Connecting-IP), NOT the shared Cloudflare edge IP:
//  1. loginLimiter (express-rate-limit, in-memory): 100 requests / 15min / IP
//     — generous so shared NAT/CGNAT IPs aren't throttled as a group.
//  2. failed_logins table check: 10 *failed* attempts / 15min per (IP, email)
//     → 429, even after the request gets past the in-memory limiter (e.g.
//     after a server restart that reset the in-memory counter). Keyed per
//     account so one user's typos don't lock out others on the same IP.
// 2h of INACTIVITY, not 2h absolute: slideAdminSession below re-issues the
// cookie while an admin is working, so the window measures idleness. 30m
// fixed logged the owner out mid-task on 2026-08-17 and the panel showed an
// empty customer screen rather than saying so.
const ADMIN_JWT_EXPIRES = process.env.ADMIN_JWT_EXPIRES_IN || '2h';

// H5: per-account failure ceilings in a 15-minute window. The admin's is
// looser (not absent) — brute-force protection without risking a lockout
// from a few mistyped passwords.
const USER_FAILED_LOGIN_MAX = Number(process.env.FAILED_LOGIN_MAX || 10);
const ADMIN_FAILED_LOGIN_MAX = Number(process.env.ADMIN_FAILED_LOGIN_MAX || 30);

// N2 (recheck 2026-08-03): the ceilings above are scoped to (IP, email), so
// an attacker with a proxy pool got a FRESH allowance per address — 30 admin
// guesses per IP, unlimited IPs, no lockout. These are the account-wide
// ceilings: every failure for one email inside the window counts, whatever
// address it came from. Deliberately well above the per-IP ceiling so a real
// user's typos (or a household on several addresses) never trip them.
//
// Trade-off, accepted knowingly: an attacker who knows an email can now hold
// that ACCOUNT locked for 15 minutes at a time. That is strictly better than
// unlimited distributed guessing, the window self-heals with no operator
// action, and for the admin server/scripts/reset-admin-2fa.mjs clears it.
const USER_ACCOUNT_FAILED_LOGIN_MAX = Number(process.env.ACCOUNT_FAILED_LOGIN_MAX || 25);
const ADMIN_ACCOUNT_FAILED_LOGIN_MAX = Number(process.env.ADMIN_ACCOUNT_FAILED_LOGIN_MAX || 50);

// Best-effort record of a failed attempt — never blocks the response.
function recordFailedLogin(email, ip, ua) {
  return pool.query(
    `INSERT INTO failed_logins (email, ip_address, user_agent) VALUES ($1, $2, $3)`,
    [email || null, ip, ua]
  ).catch(() => {});
}

app.post('/api/auth/login', loginLimiter, requireAuthInfra, async (req, res) => {
  const ip = clientIp(req);
  const ua = req.get('user-agent') || null;
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');

  // Persistent brute-force throttle (survives restart). Fires before any
  // bcrypt work so attackers can't pin CPU even at the throttle's edge.
  //
  // H5 (audit 2026-07-28): the admin used to be SKIPPED here entirely —
  // unlimited password guesses on the most valuable account. The admin is
  // now throttled too, just at a looser ceiling (30 vs 10 failures per 15
  // min) so an operator mistyping a password a few times isn't locked out
  // of the CRM. If it does lock, server/scripts/reset-admin-2fa.mjs clears
  // it from the server.
  try {
    // Scope the throttle to (IP, email) — NOT IP alone. Many legitimate
    // users share one IP (office/campus NAT, mobile carrier CGNAT); keying
    // purely on IP let a handful of unrelated people's typos lock out
    // EVERYONE behind that IP. Per-account keying still stops brute-forcing
    // a single account, while the per-IP loginLimiter above covers spraying.
    // One query, two counters (N2): failures from THIS address, and failures
    // for this account from ANY address. Served by failed_logins_email_recent_idx.
    const { rows: fl } = await pool.query(
      `SELECT count(*) FILTER (WHERE ip_address = $1)::int AS from_ip,
              count(*)::int                                AS from_anywhere
         FROM failed_logins
        WHERE email = $2
          AND created_at > NOW() - INTERVAL '15 minutes'`,
      [ip, email]
    );
    const isAdmin = isAdminAuth(req);
    const verdict = loginThrottleVerdict({
      fromIp: fl[0]?.from_ip ?? 0,
      fromAnywhere: fl[0]?.from_anywhere ?? 0,
      isAdmin,
      ceilings: {
        user:  { perIp: USER_FAILED_LOGIN_MAX,  perAccount: USER_ACCOUNT_FAILED_LOGIN_MAX },
        admin: { perIp: ADMIN_FAILED_LOGIN_MAX, perAccount: ADMIN_ACCOUNT_FAILED_LOGIN_MAX },
      },
    });
    if (verdict.blocked) {
      // The response is identical for both scopes on purpose: saying which
      // ceiling tripped would tell an attacker whether IP rotation is working.
      if (verdict.scope === 'account') {
        console.warn(`[auth/login] ACCOUNT-WIDE lockout for ${email}: ` +
          `${fl[0].from_anywhere} failures from multiple addresses in 15 min`);
      }
      return res.status(429).json({ error: 'Too many failed attempts for this account. Try again in 15 minutes.' });
    }
  } catch (e) {
    console.error('[auth/login] failed_logins precheck error:', e.message);
    // fall through — don't lock everyone out if the table is unreachable
  }

  try {
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const { rows } = await pool.query(
      `SELECT id, email, password_hash, credits, credit_limit, role, banned, package, created_at, expires_at,
              totp_secret, totp_enabled, totp_last_step, totp_recovery_codes
         FROM users WHERE email = $1 LIMIT 1`,
      [email]
    );
    const row = rows[0];

    // Run bcrypt.compare even on miss to keep timing roughly constant.
    const dummyHash = '$2a$12$0123456789012345678901uA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5';
    const ok = await bcrypt.compare(password, row?.password_hash || dummyHash);

    if (!row || !ok) {
      // Best-effort log — don't block the response on it.
      recordFailedLogin(email, ip, ua);
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    if (row.banned) {
      return res.status(403).json({ error: 'Account is banned.' });
    }
    // ── NO EXPIRY CHECK HERE, ON PURPOSE (owner, 2026-08-25, third lockout
    // incident that day) ── "Do not expire any account. This is very
    // important." A stored users.expires_at is a historical record and must
    // NEVER refuse a sign-in; what expires is CREDITS (credit_lots, the
    // 30-day rule). A wiring test asserts this message stays extinct.

    // ── H5: TOTP second factor ──────────────────────────────────────
    // Enforced only for accounts that have COMPLETED setup (totp_enabled),
    // so shipping this can never lock anyone out. A password-correct login
    // without a valid code stops here — no token is issued.
    const second = evaluateSecondFactor(row, {
      totpCode: req.body?.totp_code,
      recoveryCode: req.body?.recovery_code,
    });

    if (second.outcome === 'required') {
      // Password was right but the second factor is missing. The client
      // shows the 6-digit prompt on this signal.
      return res.status(401).json({ error: 'Two-factor code required.', totp_required: true });
    }
    if (second.outcome === 'replayed') {
      await recordFailedLogin(email, ip, ua);
      return res.status(401).json({ error: 'That code has already been used. Wait for the next one.', totp_required: true });
    }
    if (second.outcome === 'invalid') {
      await recordFailedLogin(email, ip, ua);
      return res.status(401).json({ error: 'Invalid two-factor code.', totp_required: true });
    }
    if (second.outcome === 'ok') {
      await pool.query('UPDATE users SET totp_last_step = $1 WHERE id = $2', [String(second.nextStep), row.id]);
    }
    if (second.outcome === 'ok_recovery') {
      await pool.query(
        'UPDATE users SET totp_recovery_codes = $1::jsonb WHERE id = $2',
        [JSON.stringify(second.remainingHashes), row.id]
      );
      console.warn(`[auth/2fa] RECOVERY CODE used for ${row.email} from ${ip} — ${second.remainingHashes.length} left`);
    }

    // Admin tokens expire fast (30m) so a stolen admin token has a small
    // window. Regular users stay logged in for a week.
    const isAdmin = row.role === 'admin';
    const token = jwt.sign(
      { sub: row.id, email: row.email, role: row.role },
      JWT_SECRET,
      { expiresIn: isAdmin ? ADMIN_JWT_EXPIRES : JWT_EXPIRES_IN }
    );

    // Track last login so the admin panel can show "last admin login: <when> from <ip>".
    pool.query(
      `UPDATE users SET last_login_at = NOW(), last_login_ip = $1 WHERE id = $2`,
      [ip, row.id]
    ).catch(err => console.error('[auth/login] last_login update failed:', err.message));

    // Also write admin logins to admin_audit_log (separate "login" route name)
    // so the audit table is the single source of truth for the banner.
    if (isAdmin) {
      pool.query(
        `INSERT INTO admin_audit_log
           (admin_id, admin_email, route, method, ip_address, user_agent)
         VALUES ($1, $2, $3, 'POST', $4, $5)`,
        [row.id, row.email, '/api/auth/login', ip, ua]
      ).catch(err => console.error('[auth/login] audit insert failed:', err.message));
    }

    // H7: for admins, ALSO set the session as an httpOnly cookie that page
    // JavaScript cannot read, plus the readable CSRF token. The bearer
    // token stays in the body during the transition so an older admin tab
    // keeps working; once the frontend is fully on cookies it can stop
    // storing it. See the tradeoff note in docs/SESSION-NOTES.md.
    let csrfToken = null;
    if (isAdmin) {
      csrfToken = newCsrfToken();
      setAdminSessionCookies(res, { token, csrfToken, maxAgeSeconds: ADMIN_SESSION_SECONDS });
    }

    const { password_hash, totp_secret, totp_recovery_codes, totp_last_step, ...user } = row;
    res.json({ token, user, ...(csrfToken ? { csrf_token: csrfToken } : {}) });
  } catch (err) {
    console.error('[auth/login] error:', err);
    res.status(500).json({ error: 'Login failed.' });
  }
});

// ─── SIGN IN WITH GOOGLE ───────────────────────────────────────────
// Server-side authorization-code flow. See google-auth.js for why this rather
// than Google's button widget (it would require loosening script-src) and why
// no new dependency was added.
//
// Three hops:
//   GET  /api/auth/google           → bounce the browser to Google
//   GET  /api/auth/google/callback  → Google returns here with a code
//   POST /api/auth/google/complete  → the SPA trades a cookie for its token
//
// The third hop exists so the session token never appears in a URL, where it
// would land in browser history, server logs and Referer headers.

const HANDOFF_TTL_SECONDS = 120;

// ─── WHICH SIGN-IN METHODS ACTUALLY WORK ────────────────────────────────────
// The login modal used to hard-code `live: true` for Google and Microsoft, so
// both buttons rendered whether or not the server had the credentials. On a
// deploy that lands before the env vars do, every customer sees two prominent
// buttons that bounce them to an error page. Same for password reset: the page
// exists, but without a mail key a request silently sends nothing.
//
// So the UI asks instead of assuming. Booleans only — this is deliberately not
// a config dump: it says WHETHER a method works, never which variable is
// missing or what its value is.
//
// Public and unauthenticated on purpose: it is needed to render the sign-in
// screen, which is by definition seen by people who are not signed in.
app.get('/api/auth/methods', (req, res) => {
  // Short cache: this only changes when the owner edits env vars (which
  // restarts the app anyway), and it is hit on every sign-in screen.
  res.set('Cache-Control', 'public, max-age=300');
  res.json({
    google: googleConfigured() && !!googleRedirectUri(),
    microsoft: microsoftConfigured() && !!microsoftRedirectUri(),
    // Reset needs BOTH a database to store the token and a mailer to send it.
    // Either one missing means the customer would get a confirmation and no
    // email, which is worse than not offering it.
    password_reset: dbReady() && mailConfigured(),
  });
});

app.get('/api/auth/google', authLimiter, (req, res) => {
  if (!googleConfigured()) {
    console.error(`[google] not configured — missing: ${missingGoogleVars().join(', ')}`);
    return res.redirect('/?auth_error=google_unavailable');
  }
  const redirectUri = googleRedirectUri();
  if (!redirectUri) {
    console.error('[google] no redirect uri — set GOOGLE_REDIRECT_URI or PUBLIC_BASE_URL');
    return res.redirect('/?auth_error=google_unavailable');
  }
  const state = newOauthState();
  setOauthCookie(res, OAUTH_STATE_COOKIE, state, 600);
  res.redirect(buildGoogleAuthUrl({
    clientId: process.env.GOOGLE_CLIENT_ID.trim(),
    redirectUri,
    state,
  }));
});

app.get('/api/auth/google/callback', authLimiter, async (req, res) => {
  const fail = (logLine, code = 'google_failed') => {
    console.error(`[google] ${logLine}`);
    clearOauthCookie(res, OAUTH_STATE_COOKIE);
    // Never echo the provider's error text to the browser: it is diagnostic,
    // not user-facing, and can contain request identifiers.
    return res.redirect(`/?auth_error=${code}`);
  };

  if (!googleConfigured() || !dbReady()) return fail('not configured');

  // The user pressed "cancel" on Google's screen.
  if (req.query.error) return fail(`provider returned ${req.query.error}`, 'google_cancelled');

  // CSRF: the state we set must come back unchanged. Without this an attacker
  // could complete a flow of their choosing in the victim's browser and
  // silently sign them into an account the attacker controls.
  const expected = req.cookies?.[OAUTH_STATE_COOKIE];
  if (!stateMatches(String(expected || ''), String(req.query.state || ''))) {
    return fail('state mismatch — possible CSRF, or the sign-in took too long');
  }
  clearOauthCookie(res, OAUTH_STATE_COOKIE);

  const code = String(req.query.code || '');
  if (!code) return fail('no authorization code returned');

  try {
    const tokens = await exchangeCodeForTokens({
      code,
      clientId: process.env.GOOGLE_CLIENT_ID.trim(),
      clientSecret: process.env.GOOGLE_CLIENT_SECRET.trim(),
      redirectUri: googleRedirectUri(),
    });
    const identity = await verifyGoogleIdToken(tokens.id_token);
    const user = await findOrCreateGoogleUser(identity, clientIp(req));
    if (!user) return fail('account is banned', 'account_banned');

    // Hand the session over via a short-lived httpOnly cookie rather than the
    // URL. The SPA immediately trades it in at /complete.
    const handoff = jwt.sign(
      { sub: user.id, email: user.email, role: user.role, handoff: true },
      JWT_SECRET,
      { expiresIn: HANDOFF_TTL_SECONDS }
    );
    setOauthCookie(res, OAUTH_HANDOFF_COOKIE, handoff, HANDOFF_TTL_SECONDS);
    console.log(`[google] signed in user=${user.id} ${user.email}`);
    return res.redirect('/?google=1');
  } catch (e) {
    return fail(`callback failed: ${e.message}`);
  }
});

// The SPA calls this once, on landing with ?google=1.
app.post('/api/auth/google/complete', authLimiter, async (req, res) => {
  const raw = req.cookies?.[OAUTH_HANDOFF_COOKIE];
  clearOauthCookie(res, OAUTH_HANDOFF_COOKIE);
  if (!raw) return res.status(401).json({ error: 'Sign-in link expired. Please try again.' });
  if (!dbReady()) return res.status(503).json({ error: 'Database not configured.' });

  let payload;
  try {
    payload = jwt.verify(raw, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Sign-in link expired. Please try again.' });
  }
  if (!payload?.handoff) return res.status(401).json({ error: 'Invalid sign-in link.' });

  try {
    const { rows } = await pool.query(
      `SELECT id, email, credits, credit_limit, role, banned, package, display_name, created_at,
              expires_at
         FROM users WHERE id = $1`,
      [payload.sub]
    );
    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'Account no longer exists.' });
    if (user.banned) return res.status(403).json({ error: 'Account is banned.' });
    // ── NO EXPIRY CHECK HERE EITHER (owner, 2026-08-25) ── same as the
    // password door: a stored date never refuses a sign-in. Accounts are
    // permanent; credits expire (credit_lots).

    const isAdmin = user.role === 'admin';
    const token = jwt.sign(
      { sub: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: isAdmin ? ADMIN_JWT_EXPIRES : JWT_EXPIRES_IN }
    );
    let csrfToken = null;
    if (isAdmin) {
      csrfToken = newCsrfToken();
      setAdminSessionCookies(res, { token, csrfToken, maxAgeSeconds: ADMIN_SESSION_SECONDS });
    }
    pool.query(`UPDATE users SET last_login_at = NOW(), last_login_ip = $1 WHERE id = $2`,
      [clientIp(req), user.id]).catch(() => {});

    const { banned: _b, ...safeUser } = user;
    res.json({ token, user: safeUser, ...(csrfToken ? { csrf_token: csrfToken } : {}) });
  } catch (e) {
    console.error('[google/complete] error:', e.message);
    res.status(500).json({ error: 'Sign-in failed.' });
  }
});

/**
 * Match a Google identity to a Voxel account, creating one if needed.
 *
 * Linking rule: match on google_sub first (stable and never reused), then fall
 * back to the email address ONLY because verifyGoogleIdToken has already
 * refused any identity Google does not report as email_verified. Without that
 * guarantee this branch would be an account-takeover primitive — set an
 * arbitrary address on a Google account, sign in, inherit the Voxel account.
 *
 * Returns null if the account is banned.
 */
async function findOrCreateGoogleUser(identity, ip) {
  const bySub = await pool.query(
    `SELECT id, email, role, banned FROM users WHERE google_sub = $1`, [identity.sub]
  );
  if (bySub.rows[0]) {
    if (bySub.rows[0].banned) return null;
    return bySub.rows[0];
  }

  const byEmail = await pool.query(
    `SELECT id, email, role, banned, google_sub FROM users WHERE email = $1`, [identity.email]
  );
  if (byEmail.rows[0]) {
    const existing = byEmail.rows[0];
    if (existing.banned) return null;
    // Attach Google to the existing password account. Their password keeps
    // working — this adds a way in, it does not replace one.
    await pool.query(`UPDATE users SET google_sub = $1 WHERE id = $2`, [identity.sub, existing.id]);
    console.log(`[google] linked google account to existing user=${existing.id}`);
    return existing;
  }

  // New account. Mirrors /api/auth/register exactly, including 0 credits and
  // the 'signup' ledger row — deliberately NOT a different amount, because
  // signup credit values are a pricing decision and not mine to make.
  const created = await pool.query(
    `INSERT INTO users (email, password_hash, credits, role, google_sub, display_name)
     VALUES ($1, NULL, 0, 'user', $2, $3)
     RETURNING id, email, role, banned`,
    [identity.email, identity.sub, identity.name]
  );
  const user = created.rows[0];
  pool.query(
    `INSERT INTO credits_history (user_id, amount, action, ip_address)
     VALUES ($1, 0, 'signup', $2)`,
    [user.id, ip]
  ).catch(err => console.error('[google] credits_history insert failed:', err.message));
  console.log(`[google] created user=${user.id} ${user.email}`);
  return user;
}

// ─── SIGN IN WITH MICROSOFT ────────────────────────────────────────
// Same shape as Google, with ONE deliberate difference — see the linking rule
// in findOrCreateMicrosoftUser. Entra ID lets a user set any email address
// without verifying it (the nOAuth attack class), so an email collision with
// an existing Voxel account is REFUSED here rather than linked. Google's
// email_verified makes linking safe there; Microsoft has no equivalent.

app.get('/api/auth/microsoft', authLimiter, (req, res) => {
  if (!microsoftConfigured()) {
    console.error(`[microsoft] not configured — missing: ${missingMicrosoftVars().join(', ')}`);
    return res.redirect('/?auth_error=microsoft_unavailable');
  }
  const redirectUri = microsoftRedirectUri();
  if (!redirectUri) {
    console.error('[microsoft] no redirect uri — set MICROSOFT_REDIRECT_URI or PUBLIC_BASE_URL');
    return res.redirect('/?auth_error=microsoft_unavailable');
  }
  const state = newOauthState();
  setOauthCookie(res, OAUTH_STATE_COOKIE, state, 600);
  res.redirect(buildMicrosoftAuthUrl({
    clientId: process.env.MICROSOFT_CLIENT_ID.trim(),
    redirectUri,
    state,
  }));
});

app.get('/api/auth/microsoft/callback', authLimiter, async (req, res) => {
  const fail = (logLine, code = 'microsoft_failed') => {
    console.error(`[microsoft] ${logLine}`);
    clearOauthCookie(res, OAUTH_STATE_COOKIE);
    return res.redirect(`/?auth_error=${code}`);
  };

  if (!microsoftConfigured() || !dbReady()) return fail('not configured');
  if (req.query.error) return fail(`provider returned ${req.query.error}`, 'microsoft_cancelled');

  const expected = req.cookies?.[OAUTH_STATE_COOKIE];
  if (!stateMatches(String(expected || ''), String(req.query.state || ''))) {
    return fail('state mismatch — possible CSRF, or the sign-in took too long');
  }
  clearOauthCookie(res, OAUTH_STATE_COOKIE);

  const code = String(req.query.code || '');
  if (!code) return fail('no authorization code returned');

  try {
    const tokens = await exchangeMicrosoftCode({
      code,
      clientId: process.env.MICROSOFT_CLIENT_ID.trim(),
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET.trim(),
      redirectUri: microsoftRedirectUri(),
    });
    const identity = await verifyMicrosoftIdToken(tokens.id_token);
    const outcome = await findOrCreateMicrosoftUser(identity, clientIp(req));
    if (outcome.error === 'banned') return fail('account is banned', 'account_banned');
    if (outcome.error === 'email_taken') {
      // Deliberately NOT linked. Tell them how to proceed instead of failing
      // silently: sign in the existing way, and we can attach Microsoft later.
      return fail(
        `refused to link ${identity.email} to an existing account (nOAuth risk)`,
        'microsoft_email_taken'
      );
    }

    const handoff = jwt.sign(
      { sub: outcome.user.id, email: outcome.user.email, role: outcome.user.role, handoff: true },
      JWT_SECRET,
      { expiresIn: HANDOFF_TTL_SECONDS }
    );
    setOauthCookie(res, OAUTH_HANDOFF_COOKIE, handoff, HANDOFF_TTL_SECONDS);
    console.log(`[microsoft] signed in user=${outcome.user.id} ${outcome.user.email}`);
    return res.redirect('/?google=1');
  } catch (e) {
    return fail(`callback failed: ${e.message}`);
  }
});

/**
 * Match a Microsoft identity to a Voxel account.
 *
 * THE LINKING RULE IS STRICTER THAN GOOGLE'S, ON PURPOSE.
 *
 * Entra ID permits a user to set an arbitrary, UNVERIFIED email address on
 * their account. That is the nOAuth attack: create a tenant, set the address to
 * a victim's, sign in, and any app matching on email hands over the account.
 * Google's email_verified is a real guarantee; Microsoft offers none, so:
 *
 *   - identity is the (immutable) subject alone;
 *   - an email that already belongs to another account is REFUSED, never
 *     silently attached. The person signs in their existing way instead.
 *
 * xms_edov, when a tenant enables it, does assert domain ownership — but most
 * tenants do not emit it, so its absence must never be read as "fine".
 */
async function findOrCreateMicrosoftUser(identity, ip) {
  const bySub = await pool.query(
    `SELECT id, email, role, banned FROM users WHERE microsoft_sub = $1`, [identity.sub]
  );
  if (bySub.rows[0]) {
    if (bySub.rows[0].banned) return { error: 'banned' };
    return { user: bySub.rows[0] };
  }

  const byEmail = await pool.query(
    `SELECT id, banned FROM users WHERE email = $1`, [identity.email]
  );
  if (byEmail.rows[0]) {
    if (byEmail.rows[0].banned) return { error: 'banned' };
    // The account exists and belongs to someone who signed up another way.
    // Attaching on an unverifiable address is exactly the nOAuth takeover.
    return { error: 'email_taken' };
  }

  const created = await pool.query(
    `INSERT INTO users (email, password_hash, credits, role, microsoft_sub, display_name)
     VALUES ($1, NULL, 0, 'user', $2, $3)
     RETURNING id, email, role, banned`,
    [identity.email, identity.sub, identity.name]
  );
  const user = created.rows[0];
  pool.query(
    `INSERT INTO credits_history (user_id, amount, action, ip_address)
     VALUES ($1, 0, 'signup', $2)`,
    [user.id, ip]
  ).catch(err => console.error('[microsoft] credits_history insert failed:', err.message));
  console.log(`[microsoft] created user=${user.id} ${user.email} (personal=${identity.isPersonalAccount})`);
  return { user };
}

// ─── /api/auth/logout (H7) ─────────────────────────────────────────
// Clears the admin session cookies server-side. The client still drops its
// own localStorage copy; this makes sure the httpOnly cookie — which the
// client cannot touch — is invalidated too.
app.post('/api/auth/logout', (req, res) => {
  clearAdminSessionCookies(res);
  res.json({ ok: true });
});

// Sender addresses + the email master switch, read fresh so a change in the
// CRM takes effect on the next message rather than the next deploy.
async function mailSettings() {
  if (!dbReady()) return {};
  try {
    const { rows } = await pool.query('SELECT * FROM notification_settings WHERE id = 1');
    return rows[0] || {};
  } catch { return {}; }
}

/** True when this address has unsubscribed. Marketing mail must check it. */
async function isSuppressed(email) {
  if (!dbReady() || !email) return false;
  try {
    const { rows } = await pool.query(
      'SELECT 1 FROM email_suppressions WHERE email = $1', [String(email).trim().toLowerCase()]);
    return rows.length > 0;
  } catch { return false; }
}

// ─── PASSWORD RESET (2026-08-07) ────────────────────────────────────
// Until now a forgotten password meant emailing the owner for a manual reset
// from the CRM — the platform's biggest user-facing gap.
//
// Both routes answer IDENTICALLY whether or not the address exists. Finding
// N11 was this leak on sign-up, merely slowed by a rate limit; a reset
// endpoint is a far easier oracle, so here it is genuinely indistinguishable.
const resetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyGenerator: ipKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many reset requests. Try again in 15 minutes.' },
});

app.post('/api/auth/forgot-password', resetLimiter, async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  // Reply first, work after: identical body and identical timing whether the
  // account exists, the mailer is down, or the address is nonsense.
  res.json(NEUTRAL_REPLY);
  if (!dbReady() || !email) return;
  try {
    const { rows } = await pool.query(
      'SELECT id, email FROM users WHERE lower(email) = $1 AND banned = FALSE', [email]);
    if (!rows.length) return;                       // silent, on purpose
    if (!mailConfigured()) {
      console.warn('[reset] requested but email is not configured — nothing sent');
      return;
    }
    const token = await createReset(pool, rows[0].id);
    const msg = resetEmailBody(resetUrl(token));
    const settings = await mailSettings();
    const out = await sendEmail({ ...msg, to: rows[0].email, kind: 'system' }, { settings });
    if (!out.sent) console.error('[reset] send failed:', out.reason);
  } catch (e) {
    console.error('[reset] request failed:', e.message);
  }
});

app.post('/api/auth/reset-password', resetLimiter, async (req, res) => {
  if (!dbReady()) return res.status(503).json({ error: 'Database not configured.' });
  const token = String(req.body?.token || '');
  const password = String(req.body?.password || '');
  const problem = passwordProblem(password);
  if (problem) return res.status(400).json({ error: problem });
  try {
    const claim = await consumeReset(pool, token);
    if (!claim.ok) {
      return res.status(400).json({ error: 'That reset link is invalid or has expired. Request a new one.' });
    }
    const hash = await bcrypt.hash(password, 12);
    // N9: a password change ends every existing session, so a reset actually
    // locks out whoever might have been in the account.
    await pool.query(
      `UPDATE users SET password_hash = $2, sessions_valid_from = NOW() WHERE id = $1`,
      [claim.userId, hash]);
    console.log(`[reset] password changed for user ${claim.userId}`);
    res.json({ ok: true, message: 'Your password has been changed. You can sign in now.' });
  } catch (e) {
    console.error('[reset] apply failed:', e.message);
    res.status(500).json({ error: 'Could not reset the password.' });
  }
});

// ─── UNSUBSCRIBE ────────────────────────────────────────────────────
// Reachable without login BY DESIGN — someone who was forwarded a campaign
// has no account to sign into. The HMAC token is what authorises it, so the
// link cannot be used to unsubscribe an address the sender did not mail.
app.get('/api/unsubscribe', async (req, res) => {
  const email = String(req.query?.email || '').trim().toLowerCase();
  const token = String(req.query?.t || '');
  const page = (title, body) => res.type('html').send(
    `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
    `<body style="margin:0;background:#0f0f12;color:#e9e9ee;font-family:system-ui,sans-serif">` +
    `<div style="max-width:520px;margin:14vh auto;padding:32px;background:#17171c;border-radius:16px">` +
    `<div style="font-size:19px;font-weight:700;margin-bottom:14px">VOXEL<span style="color:#e0442c">.AI</span></div>` +
    `<h1 style="font-size:20px;margin:0 0 10px">${title}</h1>` +
    `<p style="color:#b6b6c0;line-height:1.6;margin:0">${body}</p></div></body>`);

  if (!email || !verifyUnsubscribeToken(email, token)) {
    return res.status(400).type('html').send(page('Link not valid',
      'That unsubscribe link is not valid. If you keep receiving mail you did not ask for, reply to any message and we will remove you.'));
  }
  try {
    if (dbReady()) {
      await pool.query(
        `INSERT INTO email_suppressions (email, reason) VALUES ($1, 'unsubscribed')
         ON CONFLICT (email) DO NOTHING`, [email]);
    }
    console.log(`[mail] unsubscribed ${email}`);
    return page('You are unsubscribed',
      'You will not receive marketing email from Voxel again. Messages about your own account — password resets and security alerts — still reach you, because you cannot opt out of getting back into your account.');
  } catch (e) {
    console.error('[unsubscribe] failed:', e.message);
    return res.status(500).type('html').send(page('Something went wrong',
      'We could not record that just now. Please try the link again shortly.'));
  }
});

// ─── /api/auth/me ──────────────────────────────────────────────────
// Returns the current user based on the JWT. Reads fresh from DB so
// credits/ban/role reflect the latest state, not what was baked into
// the token at login time.
app.get('/api/auth/me', verifyJwt, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, email, display_name, credits, credit_limit, role, banned, package, created_at
         FROM users WHERE id = $1`,
      [req.user.id]
    );
    if (!rows[0]) return res.status(401).json({ error: 'Account no longer exists.' });
    // The soonest credit expiry rides along so the app can warn BEFORE the
    // sweep takes anything — a removal nobody was told about reads as "my
    // credits disappeared". Soft-fail: the account must load even if the
    // lots read does not.
    let creditExpiry = null;
    try {
      const s = await userCreditSummary(req.user.id);
      if (s.soonest) creditExpiry = { soonest: s.soonest, amount: s.soonestAmount };
    } catch (e) {
      console.error('[auth/me] credit summary failed:', e.message);
    }
    // ON the user object, not beside it: the offline fallback and the
    // localStorage cache both carry the user alone, so a sibling field would
    // exist on some loads and vanish on others.
    res.json({ user: { ...rows[0], credit_expiry: creditExpiry } });
  } catch (err) {
    console.error('[auth/me] error:', err);
    res.status(500).json({ error: 'Failed to load user.' });
  }
});

// ─── USER ACCOUNT (higgsfield-style "Manage Account") ──────────────
// Self-service endpoints scoped to the logged-in user. Provider costs
// (kie_credits / fal_cost) are INTERNAL accounting and are deliberately
// never selected here.

// PATCH /api/me — the only editable field today is display_name.
app.patch('/api/me', verifyJwt, requireNotBanned, async (req, res) => {
  try {
    // Strip control characters — display_name renders in the navbar and
    // account page; React escapes HTML but invisible controls are junk.
    const name = String(req.body?.display_name ?? '')
      .replace(/[\x00-\x1F\x7F]/g, '').trim().slice(0, 80);
    const { rows } = await pool.query(
      `UPDATE users SET display_name = $1 WHERE id = $2
       RETURNING id, email, display_name, credits, credit_limit, role, banned, package, created_at`,
      [name || null, req.user.id]
    );
    if (!rows[0]) return res.status(401).json({ error: 'Account no longer exists.' });
    res.json({ user: rows[0] });
  } catch (err) {
    console.error('[me] update error:', err);
    res.status(500).json({ error: 'Profile update failed.' });
  }
});

// GET /api/me/usage — own usage history: daily spend for the chart (last
// 30 days) + the recent ledger (spends, refunds, grants, promo/gift
// redemptions) for the Usage / Promocode / Gifts sections.
app.get('/api/me/usage', verifyJwt, async (req, res) => {
  try {
    // Range window for the chart / spend-overview / model shares (higgsfield
    // offers 7-day style ranges); recent + lifetime stay range-independent.
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
    const [daily, recent, lifetime, top, models, rangeTotals] = await Promise.all([
      pool.query(
        `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
                COALESCE(SUM(-amount) FILTER (WHERE action = 'spend'), 0)::float AS credits_spent,
                COUNT(*) FILTER (WHERE action = 'spend')::int AS generations
           FROM credits_history
          WHERE user_id = $1 AND created_at > NOW() - ($2 || ' days')::interval
          GROUP BY 1 ORDER BY 1`,
        [req.user.id, days]
      ),
      pool.query(
        `SELECT id, created_at, action, amount, reason
           FROM credits_history
          WHERE user_id = $1
          ORDER BY created_at DESC LIMIT 100`,
        [req.user.id]
      ),
      // Lifetime "Rewind" stats for the Subscription page.
      pool.query(
        `SELECT COUNT(*) FILTER (WHERE action = 'spend')::int AS generations,
                COUNT(*) FILTER (WHERE action = 'spend' AND reason LIKE 'video:%')::int AS videos,
                COUNT(*) FILTER (WHERE action = 'spend' AND reason LIKE 'image:%')::int AS images,
                COALESCE(SUM(-amount) FILTER (WHERE action = 'spend'), 0)::float AS credits_spent
           FROM credits_history WHERE user_id = $1`,
        [req.user.id]
      ),
      pool.query(
        `SELECT reason AS model, COUNT(*)::int AS generations
           FROM credits_history
          WHERE user_id = $1 AND action = 'spend' AND reason IS NOT NULL
          GROUP BY reason ORDER BY generations DESC LIMIT 1`,
        [req.user.id]
      ),
      // Per-model share within the range — powers the spend-overview bar.
      pool.query(
        `SELECT COALESCE(reason, 'Other') AS model,
                SUM(-amount)::float AS credits_spent,
                COUNT(*)::int AS generations
           FROM credits_history
          WHERE user_id = $1 AND action = 'spend'
            AND created_at > NOW() - ($2 || ' days')::interval
          GROUP BY 1 ORDER BY credits_spent DESC LIMIT 20`,
        [req.user.id, days]
      ),
      pool.query(
        `SELECT COALESCE(SUM(-amount) FILTER (WHERE action = 'spend'), 0)::float AS credits_spent,
                COUNT(*) FILTER (WHERE action = 'spend')::int AS generations
           FROM credits_history
          WHERE user_id = $1 AND created_at > NOW() - ($2 || ' days')::interval`,
        [req.user.id, days]
      ),
    ]);
    // Scrub internal provider tags (kie/fal) from every user-visible reason —
    // the admin CRM keeps the raw strings, users get Voxel branding.
    res.json({
      days,
      daily: daily.rows,
      recent: recent.rows.map(r => ({ ...r, reason: publicReason(r.reason) })),
      models: models.rows.map(m => ({ ...m, model: publicReason(m.model) })),
      range: rangeTotals.rows[0],
      lifetime: {
        ...lifetime.rows[0],
        top_model: top.rows[0] ? { ...top.rows[0], model: publicReason(top.rows[0].model) } : null,
      },
    });
  } catch (err) {
    console.error('[me/usage] error:', err);
    res.status(500).json({ error: 'Usage fetch failed.' });
  }
});

// ─── ADMIN: AUDIT MIDDLEWARE ───────────────────────────────────────
// Runs after verifyJwt + requireAdmin. Records the call into admin_audit_log
// BEFORE the route handler runs so even routes that throw still leave a
// trace. Insert is fire-and-forget — we don't block the response on it.
function adminAudit(req, res, next) {
  const targetId = req.params?.id ? parseInt(req.params.id, 10) : null;
  const routePath = req.route?.path || req.originalUrl;
  // M1 (audit 2026-07-28): this used to serialize the WHOLE request body,
  // which wrote customers' new plaintext passwords into the audit table.
  // Now: an explicit per-route field allow-list plus a /password/i-style
  // redaction sweep. See audit-redact.js.
  const summary = buildAuditSummary(routePath, req.method, req.body);
  pool.query(
    `INSERT INTO admin_audit_log
       (admin_id, admin_email, route, method, target_user_id, payload_summary, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      req.user.id,
      req.user.email,
      routePath,
      req.method,
      Number.isFinite(targetId) ? targetId : null,
      summary,
      // M2: the real client IP, consistent with the rate limiters (req.ip
      // is the proxy hop here).
      clientIp(req) || req.ip,
      req.get('user-agent') || null,
    ]
  ).catch(err => console.error('[admin-audit] insert failed:', err.message));
  next();
}

// H7: CSRF guard for cookie-authenticated admin requests. Runs after
// verifyJwt (which sets req.usedCookieAuth) and before anything that
// changes state. Bearer-authenticated requests pass through untouched —
// the browser never attaches those automatically, so they can't be forged.
function requireCsrf(req, res, next) {
  const verdict = checkCsrf({
    method: req.method,
    usedCookieAuth: req.usedCookieAuth,
    csrfCookie: req.cookies?.[CSRF_COOKIE],
    csrfHeader: req.get(CSRF_HEADER),
  });
  if (!verdict.ok) {
    console.error(`[csrf] rejected ${req.method} ${req.path} for user ${req.user?.id}: ${verdict.reason}`);
    return res.status(403).json({ error: verdict.reason });
  }
  next();
}

/**
 * Renew a live admin session while the admin is active.
 *
 * Runs AFTER auth, so it only ever extends a session that was already valid —
 * it cannot resurrect an expired one. Renewal failure must never block the
 * request: the admin is authenticated, and losing a cookie refresh is not a
 * reason to fail the work they came to do.
 */
function slideAdminSession(req, res, next) {
  try {
    if (req.usedCookieAuth && shouldRenewSession({ iat: req.user?.iat, exp: req.user?.exp })) {
      const token = jwt.sign(
        { sub: req.user.sub, email: req.user.email, role: req.user.role },
        JWT_SECRET, { expiresIn: ADMIN_JWT_EXPIRES });
      // Keep the existing CSRF value: rotating it mid-session would invalidate
      // the token any open tab is already holding.
      const csrfToken = req.cookies?.[CSRF_COOKIE] || newCsrfToken();
      setAdminSessionCookies(res, { token, csrfToken, maxAgeSeconds: ADMIN_SESSION_SECONDS });
    }
  } catch (e) {
    console.error('[admin-session] renewal failed (request continues):', e.message);
  }
  next();
}

// One handy gate to apply to every admin route: rate limit, auth, role,
// CSRF (state-changing cookie requests only), audit.
// N3 (recheck 2026-08-03): admin routes accept the httpOnly cookie ONLY.
//
// H7 moved the admin session into a cookie page JavaScript cannot read, but
// left bearer auth accepted "during the transition" — and the transition never
// finished. Two protections were bypassed at once: the admin JWT stayed in
// localStorage where any XSS could read it, and a bearer-authenticated request
// skips CSRF entirely (admin-session.js: `if (!usedCookieAuth) return ok`).
//
// Refusing bearer here closes both. A stolen token is no longer usable against
// /api/admin/* even if something does manage to read localStorage, and every
// admin write is forced back through the double-submit CSRF check.
//
// Expected fallout, once: an admin tab opened before this deploy sends a bearer
// and gets 401 → the panel drops to its sign-in form. Signing in again fixes it.
function requireCookieAuth(req, res, next) {
  if (!req.usedCookieAuth) {
    return res.status(401).json({
      error: 'Admin session required. Please sign in again.',
      reauth: true,
    });
  }
  next();
}

const adminGate = [adminLimiter, verifyJwt, requireCookieAuth, requireAdmin, requireCsrf,
                   slideAdminSession, adminAudit];

// ─── CRM COSTING (2026-08-06) ──────────────────────────────────────
// Own module: index.js is past the ~1500-line split threshold in CLAUDE.md and
// costing is self-contained. It reads and writes only the pricing_* tables —
// server/src/pricing.js remains the single authority for charging (C1).
registerCostingRoutes(app, { pool, dbReady, adminGate });

// ─── CRM OFFERS (2026-08-07) ───────────────────────────────────────
// Promotions with live margin impact from the Costing engine. Reuses that
// engine's settings and the same audit log; nothing here charges a customer.
registerOffersRoutes(app, { pool, dbReady, adminGate });

// ─── CRM NOTIFICATIONS (2026-08-07) ────────────────────────────────
// Admin side goes through adminGate; the customer's own bell goes through
// verifyJwt + requireNotBanned and only ever reads rows owned by req.user.id.
registerNotificationsRoutes(app, {
  pool, dbReady, adminGate,
  userGate: [verifyJwt, requireNotBanned],
});

// ─── ALERTS (Tier 1.1) ───────────────────────────────────────────────────────
// The balance check that used to log and stop. kieGetCredits is injected so a
// provider outage surfaces as its own alert instead of as an absence of them.
registerAlertsRoutes(app, {
  pool, dbReady, adminGate,
  getKieCredits: KIE_KEY ? () => kieGetCredits() : null,
});

// ─── BACKUP RESTORE VERIFICATION (SOP 1) ─────────────────────────────────────
// Backups have run daily to two encrypted places for weeks, and until now
// nothing had ever read one back. RESTORE.md documented the drill; a drill
// nobody performs is a document, not a defence. This fetches the OFFSITE copy,
// decrypts it, checks it against its own manifest, loads rows into a throwaway
// schema, and reports pass OR fail into Alerts.
registerBackupVerifyRoutes(app, pool, adminGate);

// ─── WORKSHOPS + P&L (Tier 1.2) ──────────────────────────────────────────────
// The revenue half. Supplier cost was always knowable; what a workshop was
// INVOICED lived only on the owner's laptop, so "did we make money?" had no
// answer inside the system. Reads only — pricing.js still does all charging.
registerPnlRoutes(app, { pool, dbReady, adminGate });

// ─── RELIABILITY (Tier 1.3) ──────────────────────────────────────────────────
// Which models can be trusted in front of a room. Read-only; the failure
// attribution is an inference and the endpoint reports its own confidence.
registerReliabilityRoutes(app, { pool, dbReady, adminGate });

// ─── CUSTOMER LOOKUP (Tier 2.2) ──────────────────────────────────────────────
// "My video didn't work" → one screen. Read-only; the work is PAIRING each
// charge with its outcome, which the raw ledger has never done.
registerCustomerRoutes(app, { pool, dbReady, adminGate });

// ─── WAITLIST (task #33) ─────────────────────────────────────────────────────
// /edit asked for an address, validated it, showed a success toast and threw
// it away — no table, no endpoint. Everyone who ever asked to hear about VOXEL
// Edit was lost while the page kept asking.
registerWaitlistRoutes(app, {
  pool, dbReady, adminGate, limiter: waitlistLimiter, resolveIp: clientIp,
});

// ─── EDIT ACTIVITY (task #31) ────────────────────────────────────────────────
// The count that decides whether Phase 2 of the editor is worth building.
// Phase 1 runs in the browser and costs nothing; Phase 2 adds a render worker
// at $12–24/month, which is roughly ONE extra Basic subscription. Cheap to
// decide on evidence, expensive to guess.
//
// The ADMIN route ships in the same breath as the recording on purpose: the
// waitlist bug in waitlist.js was addresses nobody could see, and a count
// nobody can read is the same bug wearing a different hat.
registerEditEventRoutes(app, {
  pool, dbReady, verifyJwt, adminGate, limiter: waitlistLimiter,
});

// ─── SOP / DAILY OPERATIONS (task #52) ───────────────────────────────────────
// Every check already existed and not one of them had a face: asked on
// 2026-08-18 how to check the backup system, the honest answer was "open a raw
// API URL". Alerts shows what is WRONG; this shows the whole picture including
// what is FINE, with the action for each line.
registerSopRoutes(app, {
  pool, dbReady, adminGate,
  getKieCredits: KIE_KEY ? () => kieGetCredits() : null,
  getAutoBackupStatus: () => autoBackupStatus,
});

// ─── TASKS (task #49) ────────────────────────────────────────────────────────
// The owner had to ask "what is pending?" every time, and the answer came from
// a file only I could read. This board is now the SINGLE SOURCE OF TRUTH —
// three lists that disagree is worse than one that is merely imperfect.
registerTaskRoutes(app, { pool, dbReady, adminGate });

// ─── LIVE MONITOR (Tier 2.1) ─────────────────────────────────────────────────
// For the two hours you are standing in a room. Read-only, short absolute
// windows, and it says "quiet" rather than rendering zeros that read as an
// outage.
registerLiveRoutes(app, { pool, dbReady, adminGate });

// ─── COSTING: MANUAL REFRESH + THE PRICE REVIEW QUEUE ────────────────────────
// The sweep runs nightly, but "wait until midnight" is not an answer when the
// owner wants to know NOW — and until this existed there was no way to make it
// run at all.
app.post('/api/costing/sync', adminGate, async (req, res) => {
  try {
    const out = await runDailyModelSync(pool, dbReady);
    await pool.query(`UPDATE pricing_settings SET catalog_synced_at = NOW()`);
    console.log(`[costing-sync] manual run by ${req.user?.email}`);
    res.json({
      ok: true,
      missing_costs: out.added || [],
      catalog: out.catalog || null,
      catalog_error: out.catalogError || null,
      kie_catalog: out.kieCatalog || null,
      kie_catalog_error: out.kieCatalogError || null,
      synced_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[costing/sync] error:', err);
    res.status(500).json({ error: 'Sync failed.' });
  }
});

// What the supplier sweep wants the owner to look at.
app.get('/api/costing/price-changes', adminGate, async (req, res) => {
  try {
    const status = String(req.query.status || 'open');
    const filter = status === 'open'
      ? `status IN ('pending','needs_check')`
      : `status = $1`;
    const params = status === 'open' ? [] : [status];
    const [changes, settings] = await Promise.all([
      pool.query(
        `SELECT q.*, m.model_name, m.variant, m.resolution
           FROM pricing_change_queue q
           LEFT JOIN pricing_models m ON m.id = q.model_id
          WHERE ${filter}
          ORDER BY q.detected_at DESC LIMIT 200`, params),
      pool.query(`SELECT catalog_synced_at FROM pricing_settings LIMIT 1`),
    ]);
    res.json({
      changes: changes.rows,
      synced_at: settings.rows[0]?.catalog_synced_at || null,
    });
  } catch (err) {
    console.error('[costing/price-changes] error:', err);
    res.status(500).json({ error: 'Could not load price changes.' });
  }
});

// Approve or skip. THIS is the gate — a supplier price never reaches a
// customer without passing through here, on purpose (see price-watch.js).
//
// Approving writes the new supplier cost onto the costing row and sets the
// credit override. It still does NOT charge anybody: pricing.js remains the
// charging authority (C1), and carrying a costing number into it stays a
// separate, deliberate act.
app.post('/api/costing/price-changes/:id', adminGate, async (req, res) => {
  const client = await pool.connect();
  try {
    const id = parseInt(req.params.id, 10);
    const action = String(req.body?.action || '');
    if (!['approve', 'skip'].includes(action)) {
      return res.status(400).json({ error: "action must be 'approve' or 'skip'." });
    }

    await client.query('BEGIN');
    // Claim it in the same statement that reads it, so two admins clicking at
    // once cannot both apply the same change.
    const { rows } = await client.query(
      `UPDATE pricing_change_queue
          SET status = $2, resolved_at = NOW(), resolved_by = $3
        WHERE id = $1 AND status IN ('pending','needs_check')
        RETURNING *`,
      [id, action === 'approve' ? 'approved' : 'skipped', req.user?.email || 'admin']);
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Already handled.' });
    }
    const c = rows[0];

    if (action === 'approve' && c.model_id) {
      const col = c.provider === 'fal' ? 'fal_cost' : 'kie_cost';
      await client.query(
        `UPDATE pricing_models
            SET ${col} = $2, credits_override = $3, updated_at = NOW(), updated_by = $4
          WHERE id = $1`,
        [c.model_id, c.new_price_usd, c.new_credits, req.user?.email || 'admin']);
      await client.query(
        `INSERT INTO pricing_audit_log (actor, action, detail)
         VALUES ($1, 'price-change-approved', $2)`,
        [req.user?.email || 'admin',
         `${c.family}: ${c.old_price_usd} → ${c.new_price_usd} (${c.pct_change}%), credits ${c.old_credits} → ${c.new_credits}`]);
    }
    await client.query('COMMIT');
    console.log(`[price-watch] ${action} #${id} ${c.family} by ${req.user?.email}`);
    res.json({ ok: true, change: c });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[costing/price-changes/:id] error:', err);
    res.status(500).json({ error: 'Could not update the change.' });
  } finally {
    client.release();
  }
});

// Daily check for models that ship into production without a costing row. A
// model nobody has costed is one nobody is checking the margin on, and that
// failure is silent — so it runs on a timer rather than relying on memory.
// Insert-only: it can never overwrite a cost the owner has entered.
//
// SCHEDULED ON THE CLOCK, NOT ON BOOT. It used to be `setTimeout(90s)` then
// `setInterval(24h)`, which meant it ran 24 hours after the last RESTART — and
// every deploy reset the timer. On a day with fifteen deploys it could complete
// no cycle at all, which is exactly why the New Models queue looked stale.
// Anchoring to 00:00 UTC makes the schedule survive deploys.
const SYNC_HOUR_UTC = 0;

function msUntilNextRun() {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(SYNC_HOUR_UTC, 0, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next - now;
}

function scheduleModelSync() {
  const wait = msUntilNextRun();
  console.log(`[costing-sync] next run in ${Math.round(wait / 3600000)}h (daily at ${SYNC_HOUR_UTC}:00 UTC)`);
  setTimeout(() => {
    runDailyModelSync(pool, dbReady).catch((e) =>
      console.error('[costing-sync] scheduled run failed:', e.message));
    // Re-arm from the clock each time rather than a fixed interval, so drift
    // and DST can never walk the run time away from midnight.
    scheduleModelSync();
  }, wait).unref?.();
}
scheduleModelSync();

// ─── ADMIN: LIST USERS (paginated) ──────────────────────────────────
app.get('/api/admin/users', adminGate, async (req, res) => {
  try {
    const limit  = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const page   = Math.max(parseInt(req.query.page,  10) || 1, 1);
    const offset = (page - 1) * limit;

    const [usersRes, totalRes] = await Promise.all([
      pool.query(
        `SELECT id, email, credits, credit_limit, role, banned, package, created_at, last_login_at, last_login_ip, expires_at
           FROM users ORDER BY id DESC LIMIT $1 OFFSET $2`,
        [limit, offset]
      ),
      pool.query(`SELECT count(*)::int AS c FROM users`),
    ]);

    res.json({
      users: usersRes.rows,
      total: totalRes.rows[0].c,
      page,
      limit,
    });
  } catch (err) {
    console.error('[admin/users] error:', err);
    res.status(500).json({ error: 'Failed to list users.' });
  }
});

// ─── ADMIN: SEARCH USERS BY EMAIL ───────────────────────────────────
app.get('/api/admin/users/search', adminGate, async (req, res) => {
  try {
    const q = String(req.query.email || '').trim().toLowerCase();
    if (!q) return res.json({ users: [] });

    // ILIKE with parameterized argument — SQL-injection safe. Cap to 50 so
    // a single-letter search doesn't return the whole DB.
    const { rows } = await pool.query(
      `SELECT id, email, credits, credit_limit, role, banned, package, created_at, last_login_at
         FROM users WHERE email ILIKE $1 ORDER BY id DESC LIMIT 50`,
      [`%${q}%`]
    );
    res.json({ users: rows });
  } catch (err) {
    console.error('[admin/users/search] error:', err);
    res.status(500).json({ error: 'Search failed.' });
  }
});

// ─── ADMIN: GRANT / REVOKE / SET CREDITS ────────────────────────────
// Body: { amount: number, action: 'grant'|'revoke'|'set', reason: string }
//   grant  → credits += amount   (history row: +amount)
//   revoke → credits -= amount   (history row: -amount; clamped to 0)
//   set    → credits  = amount   (history row: delta to reach amount)
app.post('/api/admin/users/:id/credits', adminGate, async (req, res) => {
  try {
    const targetId = parseInt(req.params.id, 10);
    const amount = Number(req.body?.amount);
    const action = String(req.body?.action || '').trim();
    const reason = String(req.body?.reason || '').trim();

    if (!Number.isFinite(targetId) || targetId <= 0) {
      return res.status(400).json({ error: 'Invalid user id.' });
    }
    if (!Number.isFinite(amount) || amount < 0) {
      return res.status(400).json({ error: 'Amount must be a non-negative number.' });
    }
    if (!['grant', 'revoke', 'set'].includes(action)) {
      return res.status(400).json({ error: 'Action must be grant, revoke, or set.' });
    }
    if (!reason) {
      return res.status(400).json({ error: 'Reason is required (it goes in the audit log forever).' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Lock the row so concurrent admin updates don't stomp each other.
      const cur = await client.query(
        `SELECT credits, credit_limit, expires_at FROM users WHERE id = $1 FOR UPDATE`,
        [targetId]
      );
      if (cur.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'User not found.' });
      }
      const before = Number(cur.rows[0].credits);
      const limitBefore = Number(cur.rows[0].credit_limit);

      let after;
      if (action === 'grant')  after = before + amount;
      if (action === 'revoke') after = Math.max(0, before - amount);
      if (action === 'set')    after = amount;
      const delta = Number((after - before).toFixed(2));

      // credit_limit grows on `grant` and on `set` when the new balance
      // exceeds the previous limit. Revokes don't lower it — the bar should
      // still show "X of Y granted" so the user can see they've used most
      // of their grant.
      let limitAfter = limitBefore;
      if (action === 'grant') limitAfter = limitBefore + amount;
      if (action === 'set')   limitAfter = Math.max(limitBefore, after);

      // ── THE MANUAL-GRANT STANDARD, v2 (owner, 2026-08-25) ──────────────
      // "The credit that added to any account — thirty days and then expire.
      //  Do not expire the account."
      //
      // The 2026-08-20 version stamped a lockout date on the ACCOUNT — the
      // model that put 'Account has expired' in front of paying customers and
      // is now retired. The thirty days belong to the CREDITS: the granted
      // amount becomes a dated lot, the sweep takes whatever is left of it
      // thirty days on, and the account itself is never touched.
      const upd = await client.query(
        `UPDATE users SET credits = $1, credit_limit = $2
          WHERE id = $3
         RETURNING id, email, credits, credit_limit, role, banned, package, expires_at`,
        [after, limitAfter, targetId]
      );
      await client.query(
        `INSERT INTO credits_history
           (user_id, amount, action, admin_email, reason, ip_address)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [targetId, delta, action, req.user.email, reason, clientIp(req)]
      );

      // grant → a new dated lot. set upward → a lot for the added part.
      // revoke / set downward → drain lots the way a spend would, so the
      // dated ledger keeps agreeing with the balance it mirrors.
      if (delta > 0) {
        await addLot(client, {
          userId: targetId, amount: delta, source: action,
          reason: reason || `manual ${action} by ${req.user.email}`,
        });
      } else if (delta < 0) {
        await mirrorLotSpend(client, { userId: targetId, amount: -delta });
      }

      await client.query('COMMIT');
      res.json({ user: upd.rows[0], delta, before, after });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[admin/credits] error:', err);
    res.status(500).json({ error: 'Credit update failed.' });
  }
});

// ─── ADMIN: BAN / UNBAN ─────────────────────────────────────────────
// Body: { banned: boolean, reason?: string }
app.post('/api/admin/users/:id/ban', adminGate, async (req, res) => {
  try {
    const targetId = parseInt(req.params.id, 10);
    if (!Number.isFinite(targetId) || targetId <= 0) {
      return res.status(400).json({ error: 'Invalid user id.' });
    }
    const banned = Boolean(req.body?.banned);
    const reason = String(req.body?.reason || '').trim() || null;

    // Refuse to ban another admin (or yourself). The admin can't lock
    // themselves out from the panel they're using to manage everyone else.
    const target = await pool.query(`SELECT id, role FROM users WHERE id = $1`, [targetId]);
    if (target.rowCount === 0) return res.status(404).json({ error: 'User not found.' });
    if (target.rows[0].role === 'admin') {
      return res.status(403).json({ error: 'Cannot ban an admin user.' });
    }

    const upd = await pool.query(
      `UPDATE users SET banned = $1 WHERE id = $2
       RETURNING id, email, credits, credit_limit, role, banned, package`,
      [banned, targetId]
    );

    // Reuse credits_history with action='ban'/'unban' so the user's full
    // moderation history is in one place.
    pool.query(
      `INSERT INTO credits_history
         (user_id, amount, action, admin_email, reason, ip_address)
       VALUES ($1, 0, $2, $3, $4, $5)`,
      [targetId, banned ? 'ban' : 'unban', req.user.email, reason, clientIp(req)]
    ).catch(() => {});

    res.json({ user: upd.rows[0] });
  } catch (err) {
    console.error('[admin/ban] error:', err);
    res.status(500).json({ error: 'Ban update failed.' });
  }
});

// ─── ADMIN: RESET USER PASSWORD ─────────────────────────────────────
// Passwords are bcrypt-hashed and unrecoverable by design — "forgot my
// password" is resolved by an admin setting a NEW one here and handing it
// to the user. Refuses to touch other admins (self-reset is allowed).
// ─── BULK ACCOUNT EXPIRY ─────────────────────────────────────────────────────
// Close access for a whole cohort at once — the end of a workshop.
//
// Expiry is the ONLY thing this touches. It writes users.expires_at and nothing
// else: the account, its balance, its credit history and every image and video
// it generated all stay exactly where they are, and the CRM keeps showing them
// (the user list has no expiry filter). Clearing the date restores access
// instantly. That is why this is expiry and not deletion.
//
// ADMINS ARE EXCLUDED IN THE SQL, not by asking the caller to remember. An
// "expire everyone" that included admins would lock the owner out of the very
// panel needed to undo it, recoverable only by editing the database directly.
app.post('/api/admin/users/expiry', adminGate, async (req, res) => {
  try {
    const mode = String(req.body?.mode || '');       // 'set' | 'clear'
    const scope = String(req.body?.scope || 'all');  // 'all' | 'existing'
    if (!['set', 'clear'].includes(mode)) {
      return res.status(400).json({ error: "mode must be 'set' or 'clear'." });
    }

    let expiresAt = null;
    if (mode === 'set') {
      expiresAt = req.body?.expires_at ? new Date(req.body.expires_at) : null;
      if (!expiresAt || isNaN(expiresAt)) {
        return res.status(400).json({ error: 'A valid expiry date is required.' });
      }
    }

    // 'existing' = accounts registered before this call, so a cohort closed
    // today does not sweep up someone who signs up an hour later.
    const cutoff = scope === 'existing' ? new Date() : null;

    // ── The cohort that must KEEP working ────────────────────────────────
    // Ending one workshop while another is still running is the normal case,
    // not the exception. `keep_codes` names the live workshops by promo code;
    // anyone who redeemed one is spared.
    const keepCodes = Array.isArray(req.body?.keep_codes)
      ? req.body.keep_codes.map((s) => String(s).trim().toUpperCase()).filter(Boolean)
      : [];

    // A code that matches nothing protects nobody, so a typo would expire the
    // very workshop it was meant to save. Refuse rather than run: the caller
    // gets the bad codes back and can fix them.
    if (keepCodes.length) {
      const { rows: known } = await pool.query(
        `SELECT code FROM promo_codes WHERE upper(code) = ANY($1)`, [keepCodes]);
      const missing = keepCodes.filter((c) => !known.some((k) => k.code.toUpperCase() === c));
      if (missing.length) {
        return res.status(400).json({
          error: `These promo codes do not exist: ${missing.join(', ')}. Nothing was changed.`,
          unknown_codes: missing,
        });
      }
    }

    // Optional: give the spared cohort a window of their own, counted from
    // each person's OWN redemption day rather than one shared date — the whole
    // point of an access period. Applied in the same call so a workshop can
    // never be closed without its replacement being given its window.
    const keepDays = req.body?.keep_access_days != null && req.body.keep_access_days !== ''
      ? parseInt(req.body.keep_access_days, 10) : null;
    if (keepDays != null && (!Number.isInteger(keepDays) || keepDays < 1 || keepDays > 3650)) {
      return res.status(400).json({ error: 'keep_access_days must be between 1 and 3650.' });
    }

    const PROTECTED = `SELECT DISTINCT r.user_id
                         FROM promo_redemptions r JOIN promo_codes p ON p.id = r.code_id
                        WHERE upper(p.code) = ANY($3)`;

    const { rows } = await pool.query(
      `UPDATE users
          SET expires_at = $1
        WHERE role <> 'admin'
          AND ($2::timestamptz IS NULL OR created_at <= $2)
          AND ($3::text[] IS NULL OR id NOT IN (${PROTECTED}))
          AND expires_at IS DISTINCT FROM $1
        RETURNING id`,
      [expiresAt, cutoff, keepCodes.length ? keepCodes : null]
    );

    // The spared cohort: each gets their redemption date + keepDays. GREATEST
    // so a second, shorter code can never cut short a window already granted.
    let kept = 0;
    if (keepCodes.length && keepDays != null) {
      const { rows: k } = await pool.query(
        `UPDATE users u
            SET expires_at = GREATEST(COALESCE(u.expires_at, 'epoch'::timestamptz), w.until)
           FROM (SELECT r.user_id, MAX(r.created_at) + ($2 || ' days')::INTERVAL AS until
                   FROM promo_redemptions r JOIN promo_codes p ON p.id = r.code_id
                  WHERE upper(p.code) = ANY($1)
                  GROUP BY r.user_id) w
          WHERE u.id = w.user_id AND u.role <> 'admin'
          RETURNING u.id`,
        [keepCodes, String(keepDays)]
      );
      kept = k.length;
    }

    const skipped = await pool.query(`SELECT COUNT(*)::int AS n FROM users WHERE role = 'admin'`);
    console.log(`[admin/expiry] ${mode} → ${rows.length} expired, ${kept} kept` +
      (keepCodes.length ? ` (codes: ${keepCodes.join(',')})` : '') +
      ` by ${req.user?.email}` +
      (expiresAt ? ` until ${expiresAt.toISOString().slice(0, 10)}` : ''));
    res.json({
      ok: true,
      changed: rows.length,
      kept_by_promo_code: kept,
      admins_skipped: skipped.rows[0].n,
      expires_at: expiresAt,
    });
  } catch (err) {
    console.error('[admin/expiry] error:', err);
    res.status(500).json({ error: 'Could not update account expiry.' });
  }
});

app.post('/api/admin/users/:id/reset-password', adminGate, async (req, res) => {
  try {
    const targetId = parseInt(req.params.id, 10);
    if (!Number.isFinite(targetId) || targetId <= 0) {
      return res.status(400).json({ error: 'Invalid user id.' });
    }
    const newPassword = String(req.body?.new_password || '');
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }

    const target = await pool.query(`SELECT id, email, role FROM users WHERE id = $1`, [targetId]);
    if (target.rowCount === 0) return res.status(404).json({ error: 'User not found.' });
    if (target.rows[0].role === 'admin' && target.rows[0].id !== req.user.id) {
      return res.status(403).json({ error: "Cannot reset another admin's password." });
    }

    const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    // N9: stamp the session cutoff in the SAME statement as the new hash, so
    // a reset always evicts existing tokens. Previously the attacker whose
    // compromise prompted the reset kept a working session for up to 7 days.
    await pool.query(
      `UPDATE users SET password_hash = $1, sessions_valid_from = NOW() WHERE id = $2`,
      [hash, targetId]
    );

    // Audit trail alongside the other moderation actions.
    pool.query(
      `INSERT INTO credits_history
         (user_id, amount, action, admin_email, reason, ip_address)
       VALUES ($1, 0, 'password_reset', $2, $3, $4)`,
      [targetId, req.user.email, 'admin password reset', clientIp(req)]
    ).catch(() => {});

    console.log(`[admin] password reset for user #${targetId} (${target.rows[0].email}) by ${req.user.email}`);
    res.json({ success: true, email: target.rows[0].email });
  } catch (err) {
    console.error('[admin/reset-password] error:', err);
    res.status(500).json({ error: 'Password reset failed.' });
  }
});

// ─── ADMIN: USER HISTORY ────────────────────────────────────────────
// ── THUMBNAIL DRY RUN ───────────────────────────────────────────────────────
// What a thumbnail backfill WOULD do for one account, and nothing else.
//
// The owner's condition for touching 601 customers' history was that no data
// changes and nothing breaks. I could guarantee the design and not untested
// code, so the first thing that ships is the thing that CANNOT change
// anything — and its output is a number he reads himself rather than one I
// read privately and relay.
//
// GET, not POST, deliberately: a survey that changes nothing should be safe to
// re-run, bookmark, and refresh. If this ever grows a write, it moves to POST
// on the same day.
//
// Scoped by EMAIL because that is what the owner has in his hand ("try it with
// aiworkshop965@gmail.com"), and scoped to ONE account because a job that can
// only touch what you point it at cannot run away.
// ── MEDIA HEALTH ────────────────────────────────────────────────────────────
// How many customer records point at a file that is no longer there?
//
// The thumbnail survey found 16 of one account's 349 images unreadable, and
// then Amr hovered a video tile: the play button appeared — so the record was
// complete and HAD a link — and the file never loaded. A slow picture is
// annoying; a missing one is work a customer paid for and cannot get back.
//
// GET, because it only reads. Most of the answer costs no network at all:
// which HOST a row points at is the risk, and one query counts that. Provider
// links expire by design, and persistOrFallback keeps them when the copy into
// our bucket fails — quietly, so the generation still succeeds. The network is
// only used to measure how many have already died, from a random sample.
// ── MEDIA RESCUE ────────────────────────────────────────────────────────────
// Copy a customer's file out of a provider's temporary storage into ours,
// before it expires. The only endpoint that rewrites result_url.
//
// POST because it writes. Scoped to ONE account by email unless `all: true` is
// passed explicitly — there is no way to run it across every customer by
// accident, which matters for the one operation that could destroy history if
// it were wrong.
//
// The order is the safety: fetch → upload → VERIFY our copy reads back at the
// right size → only then write, recording the provider url in origin_url so
// the old address is never thrown away. Any failure writes nothing at all.
// ── LET OUR OWN PAGES READ MEDIA WITH JAVASCRIPT ────────────────────────────
// Voxel Edit Cut's export reads each clip with fetch(). A cross-origin fetch
// needs the bucket to say who may read it; an <img> tag does not. So galleries
// work while EXPORTING A PROJECT CONTAINING A VOXEL CLIP fails completely.
//
// Runs on the server for the same reason ensureVersioning does: the Spaces
// secret is write-only in the app config, so nothing else holds it.
//
// POST because it changes bucket configuration. Idempotent — if the rule is
// already there it reports changed:false and writes nothing.
// ── THE SPEECH MODEL, IN OUR OWN BUCKET ─────────────────────────────────────
// So a customer's browser never talks to HuggingFace to transcribe their own
// video. mediaConnectSources() already allows our bucket, so this needs NO CSP
// change — the same reasoning that put ffmpeg-core.wasm on our own origin
// instead of a CDN.
//
// Runs here because the Spaces secret is write-only in the app config; it
// cannot be done from a laptop. Idempotent: files already present are skipped,
// so re-running costs nothing.
app.post('/api/admin/whisper-model', adminGate, async (req, res) => {
  if (!spacesReady()) return res.status(503).json({ error: 'Spaces not configured.' });
  try {
    const started = Date.now();
    const out = await installModel({
      force: req.body?.force === true,
      exists: (key) => primaryObjectExists(key),
      put: (key, buf, contentType) => uploadPublicAt(key, buf, contentType),
      size: (key) => objectSize(key),
    });
    const seconds = Math.round((Date.now() - started) / 1000);
    console.log(`[whisper-model] ${JSON.stringify({ ...out, problems: out.problems.length })} in ${seconds}s`);
    // A partial model is not a success. 200 only when every file is there.
    res.status(out.complete ? 200 : 500).json({ tookSeconds: seconds, ...out });
  } catch (e) {
    console.error('[whisper-model] failed:', e.message);
    res.status(500).json({ complete: false, error: e.message });
  }
});

// ── OLD VERSIONS OF DELETED FILES (2026-08-29) ──────────────────────────────
// Versioning is on, deliberately — it is what makes a stolen key survivable.
// It also means a deleted object is never actually deleted, so the 30-day
// purge removes a picture from the SERVICE while the bytes linger forever.
//
// GET describes what WOULD change and writes nothing. Amr reads it first,
// because the difference between "expire old versions" and "delete every live
// customer file" is one word in a JSON body — see version-expiry.js.
app.get('/api/admin/version-expiry', adminGate, async (req, res) => {
  if (!spacesReady()) return res.status(503).json({ error: 'Spaces not configured.' });
  try {
    const rules = await getLifecycleRules();
    res.json(describeExpiryPlan(rules, NONCURRENT_DAYS));
  } catch (e) {
    console.error('[version-expiry] preview failed:', e.message);
    res.status(500).json({ error: `Could not read the bucket rules: ${e.message}` });
  }
});

app.post('/api/admin/version-expiry', adminGate, async (req, res) => {
  if (!spacesReady()) return res.status(503).json({ error: 'Spaces not configured.' });
  try {
    const out = await applyExpiry({
      getRules: getLifecycleRules, putRules: putLifecycleRules, days: NONCURRENT_DAYS,
    });
    console.log(`[version-expiry] ${JSON.stringify(out)}`);
    res.status(out.ok ? 200 : 500).json(out);
  } catch (e) {
    console.error('[version-expiry] failed:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/admin/media-cors', adminGate, async (req, res) => {
  if (!spacesReady()) return res.status(503).json({ error: 'Spaces not configured.' });
  try {
    const out = await ensureMediaCors();
    console.log(`[media-cors] ${JSON.stringify(out)}`);
    res.status(out.ok ? 200 : 500).json(out);
  } catch (e) {
    console.error('[media-cors] failed:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/admin/media-rescue', adminGate, async (req, res) => {
  if (!dbReady()) return res.status(503).json({ error: 'Database not configured.' });
  if (!spacesReady()) return res.status(503).json({ error: 'Spaces not configured — nowhere to rescue files to.' });

  const email = String(req.body?.email || '').trim().toLowerCase();
  const all = req.body?.all === true;
  const limit = Math.max(1, Math.min(500, Number(req.body?.limit) || 20));
  if (!email && !all) {
    return res.status(400).json({ error: 'Give an email to rescue one account, or all:true to run across every account.' });
  }

  try {
    const hosts = ourMediaHosts({
      endpoint: process.env.SPACES_ENDPOINT,
      bucket: process.env.SPACES_BUCKET,
      cdnBase: process.env.SPACES_CDN_BASE,
    });
    if (!hosts.length) return res.status(503).json({ error: 'Cannot tell which files are already ours.' });

    let userId = null;
    if (email) {
      const { rows: users } = await pool.query('SELECT id FROM users WHERE lower(email) = $1', [email]);
      if (!users.length) return res.status(404).json({ error: `No account for ${email}.` });
      userId = users[0].id;
    }

    const { rows } = await pool.query(RESCUE_QUEUE_SQL, [userId, hosts, limit]);
    const started = Date.now();
    const report = await rescueRows(rows, {
      ourHosts: hosts,
      limit,
      persist: (buf, contentType, kind) => persistBuffer(buf, contentType, kind),
      // Verify through the PUBLIC url, not the bucket API: what matters is
      // that the customer's browser can read it, which is a stronger claim
      // than the object existing.
      verify: (url) => headSize(url),
      setUrls: async (id, originUrl, newUrl, rowUserId) => {
        await pool.query(RESCUE_SQL,
          [JSON.stringify(originUrl), JSON.stringify(newUrl), id, rowUserId]);
      },
    });

    const seconds = Math.round((Date.now() - started) / 1000);
    console.log(`[media-rescue] ${email || 'ALL'}: ${report.rescued} rescued, ${report.alreadyGone} already gone, `
      + `${report.failed} failed, ${report.movedMB} MB in ${seconds}s`);
    res.json({ scope: email || 'all accounts', tookSeconds: seconds, ...report });
  } catch (e) {
    console.error('[media-rescue] failed:', e.message);
    res.status(500).json({ error: `The rescue could not finish: ${e.message}` });
  }
});

app.get('/api/admin/media-health', adminGate, async (req, res) => {
  if (!dbReady()) return res.status(503).json({ error: 'Database not configured.' });
  const sampleSize = Math.max(0, Math.min(500, Number(req.query.sample) || 60));

  try {
    const hosts = ourMediaHosts({
      endpoint: process.env.SPACES_ENDPOINT,
      bucket: process.env.SPACES_BUCKET,
      cdnBase: process.env.SPACES_CDN_BASE,
    });
    if (!hosts.length) {
      // Refusing beats guessing: with no idea which host is ours, EVERY row
      // would be classed at risk and the report would be alarming nonsense.
      return res.status(503).json({ error: 'Spaces is not configured here, so nothing can be judged durable.' });
    }

    const { rows: breakdown } = await pool.query(HOST_BREAKDOWN_SQL, [hosts]);
    let sample = null;
    if (sampleSize > 0) {
      const { rows: atRisk } = await pool.query(AT_RISK_SAMPLE_SQL, [hosts, sampleSize]);
      sample = atRisk.length ? await checkSample(atRisk) : null;
    }

    res.json({ readOnly: true, ourHosts: hosts, ...summariseMediaHealth(breakdown, sample) });
  } catch (e) {
    // Named, never swallowed. A health check that fails quietly and returns
    // zero is worse than no health check at all.
    console.error('[media-health] failed:', e.message);
    res.status(500).json({ error: `The check could not finish: ${e.message}` });
  }
});

app.get('/api/admin/thumbnails/survey', adminGate, async (req, res) => {
  if (!dbReady()) return res.status(503).json({ error: 'Database not configured.' });
  const email = String(req.query.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'An email is required — this runs for one account.' });

  try {
    const { rows: users } = await pool.query('SELECT id, email FROM users WHERE lower(email) = $1', [email]);
    if (!users.length) return res.status(404).json({ error: `No account for ${email}.` });

    const { rows } = await pool.query(SURVEY_SQL, [users[0].id]);
    const report = await surveyRows(rows);
    res.json({ account: users[0].email, ...report });
  } catch (e) {
    // Named, not swallowed. A survey that fails silently and returns zero
    // would read as "nothing to do" — the worst possible lie for a number
    // somebody is about to make a decision on.
    console.error('[thumbnails:survey] failed:', e.message);
    res.status(500).json({ error: `The survey could not finish: ${e.message}` });
  }
});

// ── HOW BIG IS THIS JOB, ACROSS EVERYONE? ───────────────────────────────────
// Amr asked "do you need to press it many times?" — his partner's account alone
// needs seven presses, and there are 601 accounts. So a background job is
// plainly right, and this is what has to exist BEFORE one is switched on: the
// count, and what it would cost in data.
//
// GET, and read-only by construction — thumbnail-scale.js contains no write of
// any kind and a test proves that by reading the file.
app.get('/api/admin/thumbnails/scale', adminGate, async (req, res) => {
  if (!dbReady()) return res.status(503).json({ error: 'Database not configured.' });
  const sample = Math.max(0, Math.min(60, Number(req.query.sample) || 25));
  try {
    const { rows } = await pool.query(SCALE_SQL);
    let sizes = [];
    if (sample > 0) {
      const { rows: urls } = await pool.query(SAMPLE_SQL, [sample]);
      // HEAD, not GET. Measuring a bandwidth problem by downloading gigabytes
      // would be a strange way to go about it.
      sizes = await Promise.all(urls.map((r) => headSize(r.url).catch(() => null)));
    }
    res.json(summariseScale(rows[0], sizes));
  } catch (e) {
    // Named, not swallowed. A count that fails quietly and returns zero would
    // read as "nothing to do" — the worst possible lie for a number somebody
    // is about to make a decision on.
    console.error('[thumbnails:scale] failed:', e.message);
    res.status(500).json({ error: `The count could not finish: ${e.message}` });
  }
});

// ── THUMBNAIL BACKFILL ──────────────────────────────────────────────────────
// POST, not GET, because this one WRITES. The survey above stays GET for the
// same reason — the method should say which is which without reading the code.
//
// Scoped to ONE account by email, with a `limit` so a first run can be twenty
// rows rather than all 333. There is no "every account" variant; the broad
// version does not exist yet, and a job that can only touch what you point it
// at cannot run away.
app.post('/api/admin/thumbnails/backfill', adminGate, async (req, res) => {
  if (!dbReady()) return res.status(503).json({ error: 'Database not configured.' });
  if (!spacesReady()) return res.status(503).json({ error: 'Spaces not configured — nowhere to put a thumbnail.' });

  const email = String(req.body?.email || '').trim().toLowerCase();
  const limit = Math.max(1, Math.min(1000, Number(req.body?.limit) || 20));
  if (!email) return res.status(400).json({ error: 'An email is required — this runs for one account.' });

  try {
    const { rows: users } = await pool.query('SELECT id, email FROM users WHERE lower(email) = $1', [email]);
    if (!users.length) return res.status(404).json({ error: `No account for ${email}.` });
    const user = users[0];

    const { rows } = await pool.query(SURVEY_SQL, [user.id]);
    const started = Date.now();
    const report = await backfillRows(rows, {
      limit,
      persist: (buf, contentType, kind) => persistBuffer(buf, contentType, kind),
      // The ONE write. Scoped to the row AND the user, through jsonb_set on a
      // single path — result_url is unreachable from here by construction.
      setThumb: async (id, url) => {
        await pool.query(SET_THUMB_SQL, [JSON.stringify(url), id, user.id]);
      },
    });

    console.log(`[thumbnails] ${user.email}: ${report.done} done, ${report.failed} failed, `
      + `${report.savedMB} MB saved in ${Math.round((Date.now() - started) / 1000)}s`);
    res.json({ account: user.email, tookSeconds: Math.round((Date.now() - started) / 1000), ...report });
  } catch (e) {
    console.error('[thumbnails:backfill] failed:', e.message);
    res.status(500).json({ error: `The backfill could not finish: ${e.message}` });
  }
});

app.get('/api/admin/users/:id/history', adminGate, async (req, res) => {
  try {
    const targetId = parseInt(req.params.id, 10);
    if (!Number.isFinite(targetId) || targetId <= 0) {
      return res.status(400).json({ error: 'Invalid user id.' });
    }
    // Admin tool: show the FULL ledger by default. 10k cap is a payload
    // backstop only — nothing is ever deleted from credits_history.
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10000, 1), 10000);
    const { rows } = await pool.query(
      `SELECT id, amount, action, admin_email, reason, ip_address, created_at, kie_credits, fal_cost
         FROM credits_history WHERE user_id = $1
         ORDER BY created_at DESC LIMIT $2`,
      [targetId, limit]
    );
    res.json({ history: rows });
  } catch (err) {
    console.error('[admin/history] error:', err);
    res.status(500).json({ error: 'History fetch failed.' });
  }
});

// ─── ADMIN: REFUND AUDIT ────────────────────────────────────────────
// Answers "did any user's FAILED generation keep its charge?" by cross-
// referencing failed video GenerationHistory records against the refund
// ledger, per user.
//
// Honest limits of this report:
//   • Failed IMAGES never produce a history record (the sync route refunds
//     inline and the client only saves successes), so images can't be
//     audited retroactively — their refund paths are enforced in code.
//   • refund_count includes image refunds too, so possible_unrefunded =
//     failed_videos − refunds is a CONSERVATIVE floor, not an exact count.
//     A user showing 0 is definitely clean; a positive number deserves a
//     look at their History before granting make-good credits.
app.get('/api/admin/audit/refunds', adminGate, async (req, res) => {
  try {
    const [{ rows: failed }, { rows: refunds }] = await Promise.all([
      pool.query(
        `SELECT e.user_id, u.email, e.id, e.created_date, e.data->>'model' AS model
           FROM entities e JOIN users u ON u.id = e.user_id
          WHERE e.name = 'GenerationHistory'
            AND e.data->>'type' = 'video'
            AND e.data->>'status' = 'failed'
          ORDER BY e.created_date DESC
          LIMIT 2000`
      ),
      pool.query(
        `SELECT user_id, COUNT(*)::int AS refund_count,
                COALESCE(SUM(amount), 0)::float AS refund_total
           FROM credits_history WHERE action = 'refund'
          GROUP BY user_id`
      ),
    ]);

    const refundByUser = new Map(refunds.map((r) => [r.user_id, r]));
    const byUser = new Map();
    for (const f of failed) {
      if (!byUser.has(f.user_id)) {
        byUser.set(f.user_id, { user_id: f.user_id, email: f.email, failures: [] });
      }
      byUser.get(f.user_id).failures.push({ model: f.model || '—', at: f.created_date });
    }

    const report = [...byUser.values()]
      .map((u) => {
        const r = refundByUser.get(u.user_id) || { refund_count: 0, refund_total: 0 };
        return {
          user_id: u.user_id,
          email: u.email,
          failed_videos: u.failures.length,
          refund_count: r.refund_count,
          refund_total: r.refund_total,
          possible_unrefunded: Math.max(0, u.failures.length - r.refund_count),
          failures: u.failures.slice(0, 20),
        };
      })
      .sort((a, b) => b.possible_unrefunded - a.possible_unrefunded || b.failed_videos - a.failed_videos);

    res.json({
      generated_at: new Date().toISOString(),
      failed_videos_total: failed.length,
      users_with_failures: report.length,
      users_with_possible_gaps: report.filter((x) => x.possible_unrefunded > 0).length,
      report,
    });
  } catch (err) {
    console.error('[admin/audit] error:', err);
    res.status(500).json({ error: 'Audit failed.' });
  }
});

// ─── ADMIN: STATS ───────────────────────────────────────────────────
// Single round-trip: aggregate stats + last-10 admin logins for the banner.
// ─── ADMIN: FULL DATABASE BACKUP ────────────────────────────────────
// GET /api/admin/backup → streams a gzipped NDJSON dump of every table.
// Exists because prod runs on an App Platform DEV database: no automated
// backups and no external connections (pg_dump from a laptop times out),
// so the app itself is the only thing that can read the data out.
// First line is a meta record; every following line is {"table","row"}.
// Restore = iterate lines and INSERT per table (order below respects FKs:
// users first). Batched keyset-free pagination (ORDER BY id + OFFSET) is
// fine at this platform's scale and works for both serial and uuid ids.
app.get('/api/admin/backup', adminGate, async (req, res) => {
  if (!dbReady()) return res.status(503).json({ error: 'Database not configured.' });
  const TABLES = ['users', 'credits_history', 'admin_audit_log', 'failed_logins', 'entities', 'node_spaces'];
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  res.setHeader('Content-Type', 'application/gzip');
  res.setHeader('Content-Disposition', `attachment; filename="voxel-backup-${stamp}.ndjson.gz"`);

  const gz = zlib.createGzip();
  gz.pipe(res);
  // Respect gzip backpressure so a large entities table can't balloon memory.
  const write = (obj) => new Promise((resolve, reject) => {
    gz.write(JSON.stringify(obj) + '\n', (err) => (err ? reject(err) : resolve()));
  });

  try {
    await write({ meta: { exported_at: new Date().toISOString(), tables: TABLES, version: 1 } });
    const counts = {};
    for (const table of TABLES) {
      const BATCH = 1000;
      let offset = 0;
      for (;;) {
        const { rows } = await pool.query(`SELECT * FROM ${table} ORDER BY id LIMIT ${BATCH} OFFSET ${offset}`);
        for (const row of rows) await write({ table, row });
        offset += rows.length;
        if (rows.length < BATCH) break;
      }
      counts[table] = offset;
    }
    await write({ done: true, counts });
    gz.end();
    console.log('[admin/backup] ✅ exported', JSON.stringify(counts));
  } catch (err) {
    console.error('[admin/backup] error:', err);
    // Headers are already sent mid-stream — destroy so the client sees a
    // truncated/failed download instead of a silently incomplete backup.
    gz.destroy();
    res.destroy(err);
  }
});

app.get('/api/admin/stats', adminGate, async (req, res) => {
  try {
    const [agg, recent] = await Promise.all([
      pool.query(`
        SELECT
          (SELECT count(*)::int FROM users)                                                                  AS total_users,
          (SELECT count(*)::int FROM users WHERE last_login_at > NOW() - INTERVAL '24 hours')               AS active_today,
          (SELECT count(*)::int FROM users WHERE banned = TRUE)                                              AS total_banned,
          COALESCE((SELECT SUM(credits) FROM users), 0)::NUMERIC(14,2)                                       AS total_credits_outstanding,
          (SELECT count(*)::int FROM credits_history WHERE created_at > NOW() - INTERVAL '24 hours' AND action = 'spend') AS spends_24h
      `),
      pool.query(`
        SELECT admin_email, ip_address, user_agent, created_at
          FROM admin_audit_log
         WHERE route = '/api/auth/login'
         ORDER BY created_at DESC LIMIT 10
      `),
    ]);
    res.json({
      ...agg.rows[0],
      credit_costs: CREDIT_COSTS,
      admin_email: ADMIN_EMAIL,
      recent_admin_logins: recent.rows,
      // Automated Spaces backup status (null last_at = none since boot).
      auto_backup: autoBackupStatus,
    });
  } catch (err) {
    console.error('[admin/stats] error:', err);
    res.status(500).json({ error: 'Stats fetch failed.' });
  }
});

// ─── ADMIN: LOGS (kie.ai-style request ledger) ─────────────────────
// Paginated view of credits_history across ALL users, filterable like
// kie.ai's Logs page: action (their "status"), free-text model match,
// user email, and a date range. Each row carries BOTH meters: `amount`
// (signed voxel credits) and `kie_credits` (estimated KIE credits the
// generation burned from our kie.ai balance; null → rendered "—").
app.get('/api/admin/logs', adminGate, async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const where = [];
    const params = [];
    const p = (v) => { params.push(v); return `$${params.length}`; };

    const action = String(req.query.action || '').toLowerCase();
    if (['spend', 'refund', 'grant', 'revoke', 'promo', 'gift', 'signup'].includes(action)) where.push(`ch.action = ${p(action)}`);
    if (req.query.q) where.push(`ch.reason ILIKE ${p('%' + String(req.query.q).slice(0, 100) + '%')}`);
    if (req.query.email) where.push(`u.email ILIKE ${p('%' + String(req.query.email).slice(0, 100) + '%')}`);
    if (req.query.from) where.push(`ch.created_at >= ${p(new Date(req.query.from))}`);
    if (req.query.to) where.push(`ch.created_at < ${p(new Date(req.query.to))}::timestamptz + INTERVAL '1 day'`);
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const [rows, count] = await Promise.all([
      pool.query(
        `SELECT ch.id, ch.created_at, ch.action, ch.amount, ch.kie_credits, ch.fal_cost,
                ch.reason, u.id AS user_id, u.email
           FROM credits_history ch
           JOIN users u ON u.id = ch.user_id
          ${whereSql}
          ORDER BY ch.created_at DESC
          LIMIT ${p(limit)} OFFSET ${p(offset)}`,
        params
      ),
      pool.query(
        `SELECT count(*)::int AS total
           FROM credits_history ch JOIN users u ON u.id = ch.user_id ${whereSql}`,
        params.slice(0, params.length - 2)
      ),
    ]);
    res.json({ logs: rows.rows, total: count.rows[0].total, limit, offset });
  } catch (err) {
    console.error('[admin/logs] error:', err);
    res.status(500).json({ error: 'Logs fetch failed.' });
  }
});

// ─── ADMIN: API USAGE (kie.ai-style aggregates) ────────────────────
// Daily totals + per-model breakdown for a date range (default last 14
// days, kie.ai's default window). Voxel credits and KIE credits are
// summed side by side; kie_credits is NULL on FAL rows and on rows from
// before per-transaction KIE tracking began, so the KIE series starts at
// that deploy date.
// ─── PROVIDER SPEND DASHBOARD ────────────────────────────────────────────────
// What one supplier actually costs us, laid out the way the provider's own
// console shows it: a headline total, a daily bar chart, and a card per model
// with its own sparkline. The owner compares this against kie.ai's dashboard
// directly, so the shapes deliberately match.
//
// TWO HONESTY RULES, because a cost dashboard that quietly under-reports is
// worse than none at all:
//
//   1. It reports COVERAGE. Charges from 10 Jun – 22 Jul 2026 (13,736 rows,
//      45% of all credits ever spent) carry no provider attribution — labelling
//      was added on 22 Jul. Without saying so, every historical total here
//      reads as complete when it is not.
//
//   2. USD is derived, not billed. We multiply recorded credits by a constant.
//      Against kie.ai's own figure for 2–15 Aug ($1,559.068 vs our 361,087
//      credits) the real rate was ~$0.004318, not the $0.005 we assume — so
//      our dollars run ~14% high. Returned as `usd_rate` so the screen can say
//      where the number came from instead of implying it is an invoice.
app.get('/api/admin/usage/provider', adminGate, async (req, res) => {
  try {
    const provider = String(req.query.provider || 'kie').toLowerCase();
    if (!['kie', 'fal'].includes(provider)) {
      return res.status(400).json({ error: "provider must be 'kie' or 'fal'." });
    }
    const to = req.query.to ? new Date(req.query.to) : new Date();
    const from = req.query.from ? new Date(req.query.from)
      : new Date(Date.now() - 13 * 24 * 3600 * 1000);
    if (isNaN(from) || isNaN(to)) return res.status(400).json({ error: 'Bad date range' });

    // kie is counted in credits and converted; fal is already USD.
    const col = provider === 'kie' ? 'kie_credits' : 'fal_cost';
    // Calibrated against the last real invoice — see KIE_CALIBRATION. Display
    // only; the recorded credits and the margin rules are untouched.
    const rate = provider === 'kie' ? kieBilledUsdPerCredit() : 1;
    const params = [from, to];
    const inRange = `created_at >= $1 AND created_at < $2::timestamptz + INTERVAL '1 day'`;
    const mine = `action = 'spend' AND ${col} IS NOT NULL`;

    const [totals, daily, models, modelDaily, coverage] = await Promise.all([
      pool.query(
        `SELECT COALESCE(SUM(${col}),0)::float AS units,
                COUNT(*)::int AS generations,
                COUNT(DISTINCT user_id)::int AS users,
                COALESCE(SUM(-amount),0)::float AS voxel_credits
           FROM credits_history WHERE ${mine} AND ${inRange}`, params),
      pool.query(
        `SELECT to_char(date_trunc('day', created_at),'YYYY-MM-DD') AS day,
                COALESCE(SUM(${col}),0)::float AS units,
                COUNT(*)::int AS generations
           FROM credits_history WHERE ${mine} AND ${inRange}
          GROUP BY 1 ORDER BY 1`, params),
      pool.query(
        `SELECT COALESCE(reason,'(unlabeled)') AS model,
                COALESCE(SUM(${col}),0)::float AS units,
                COUNT(*)::int AS generations,
                COALESCE(SUM(-amount),0)::float AS voxel_credits
           FROM credits_history WHERE ${mine} AND ${inRange}
          GROUP BY 1 ORDER BY units DESC LIMIT 12`, params),
      // One row per (model, day) for the per-card sparklines. Bounded to the
      // same top models the cards show, so this cannot fan out.
      pool.query(
        `WITH top AS (
           SELECT COALESCE(reason,'(unlabeled)') AS model
             FROM credits_history WHERE ${mine} AND ${inRange}
            GROUP BY 1 ORDER BY COALESCE(SUM(${col}),0) DESC LIMIT 12)
         SELECT COALESCE(reason,'(unlabeled)') AS model,
                to_char(date_trunc('day', created_at),'YYYY-MM-DD') AS day,
                COALESCE(SUM(${col}),0)::float AS units
           FROM credits_history
          WHERE ${mine} AND ${inRange}
            AND COALESCE(reason,'(unlabeled)') IN (SELECT model FROM top)
          GROUP BY 1,2 ORDER BY 1,2`, params),
      // Rule 1: how much spend in this window has NO provider recorded.
      pool.query(
        `SELECT COUNT(*) FILTER (WHERE kie_credits IS NULL AND fal_cost IS NULL)::int AS unattributed_rows,
                COUNT(*)::int AS total_rows,
                COALESCE(SUM(-amount) FILTER (WHERE kie_credits IS NULL AND fal_cost IS NULL),0)::float
                  AS unattributed_voxel_credits
           FROM credits_history WHERE action='spend' AND ${inRange}`, params),
    ]);

    const withUsd = (r) => ({ ...r, usd: Math.round(r.units * rate * 10000) / 10000 });
    const byModel = new Map();
    for (const r of modelDaily.rows) {
      if (!byModel.has(r.model)) byModel.set(r.model, []);
      byModel.get(r.model).push({ day: r.day, units: r.units, usd: Math.round(r.units * rate * 10000) / 10000 });
    }

    res.json({
      provider,
      unit: provider === 'kie' ? 'credits' : 'usd',
      usd_rate: rate,
      // Named so the screen cannot present a derived figure as a billed one.
      usd_is_estimated: true,
      // Where the rate came from, so the screen can show its provenance rather
      // than a bare number nobody can audit.
      calibration: provider === 'kie' ? KIE_CALIBRATION : null,
      list_rate: provider === 'kie' ? KIE_USD_PER_CREDIT : null,
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      totals: withUsd(totals.rows[0]),
      daily: daily.rows.map(withUsd),
      models: models.rows.map((m) => ({ ...withUsd(m), daily: byModel.get(m.model) || [] })),
      coverage: coverage.rows[0],
    });
  } catch (err) {
    console.error('[admin/usage/provider] error:', err);
    res.status(500).json({ error: 'Provider usage fetch failed.' });
  }
});

app.get('/api/admin/usage', adminGate, async (req, res) => {
  try {
    const to = req.query.to ? new Date(req.query.to) : new Date();
    const from = req.query.from
      ? new Date(req.query.from)
      : new Date(Date.now() - 13 * 24 * 3600 * 1000);
    if (isNaN(from) || isNaN(to)) return res.status(400).json({ error: 'Bad date range' });

    const params = [from, to];
    const [daily, models, totals] = await Promise.all([
      pool.query(
        `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
                COALESCE(SUM(-amount) FILTER (WHERE action = 'spend'), 0)::float   AS voxel_spent,
                COALESCE(SUM(amount)  FILTER (WHERE action = 'refund'), 0)::float  AS voxel_refunded,
                COALESCE(SUM(kie_credits) FILTER (WHERE action = 'spend'), 0)::float AS kie_credits,
                COALESCE(SUM(fal_cost) FILTER (WHERE action = 'spend'), 0)::float AS fal_cost,
                COUNT(*) FILTER (WHERE action = 'spend')::int AS generations
           FROM credits_history
          WHERE created_at >= $1 AND created_at < $2::timestamptz + INTERVAL '1 day'
          GROUP BY 1 ORDER BY 1`,
        params
      ),
      pool.query(
        `SELECT COALESCE(reason, '(unlabeled)') AS model,
                COUNT(*)::int AS generations,
                SUM(-amount)::float AS voxel_spent,
                COALESCE(SUM(kie_credits), 0)::float AS kie_credits,
                COALESCE(SUM(fal_cost), 0)::float AS fal_cost
           FROM credits_history
          WHERE action = 'spend' AND created_at >= $1 AND created_at < $2::timestamptz + INTERVAL '1 day'
          GROUP BY 1 ORDER BY voxel_spent DESC LIMIT 50`,
        params
      ),
      pool.query(
        `SELECT COALESCE(SUM(-amount) FILTER (WHERE action = 'spend'), 0)::float  AS voxel_spent,
                COALESCE(SUM(amount)  FILTER (WHERE action = 'refund'), 0)::float AS voxel_refunded,
                COALESCE(SUM(kie_credits) FILTER (WHERE action = 'spend'), 0)::float AS kie_credits,
                COALESCE(SUM(fal_cost) FILTER (WHERE action = 'spend'), 0)::float AS fal_cost,
                COUNT(*) FILTER (WHERE action = 'spend')::int AS generations,
                COUNT(DISTINCT user_id) FILTER (WHERE action = 'spend')::int AS active_users
           FROM credits_history
          WHERE created_at >= $1 AND created_at < $2::timestamptz + INTERVAL '1 day'`,
        params
      ),
    ]);
    res.json({ daily: daily.rows, models: models.rows, totals: totals.rows[0] });
  } catch (err) {
    console.error('[admin/usage] error:', err);
    res.status(500).json({ error: 'Usage fetch failed.' });
  }
});

// ─── ADMIN: KIE BALANCE ────────────────────────────────────────────
// Live remaining credits on OUR kie.ai account, for the API Usage page's
// balance widget. Never cached server-side — the widget has its own
// refresh button and the call is cheap.
app.get('/api/admin/kie-balance', adminGate, async (req, res) => {
  try {
    const credits = await kieGetCredits();
    res.json({ credits, usd: Math.round(credits * 0.005 * 100) / 100 });
  } catch (err) {
    console.error('[admin/kie-balance] error:', err.message);
    res.status(502).json({ error: `kie.ai balance unavailable: ${err.message}` });
  }
});

// ─── PROMO CODES + GIFT CARDS ──────────────────────────────────────
// Admin generates them in the CRM; users redeem via POST /api/redeem-code.
// Redemption grants credits with the SAME mechanics as an admin grant:
// credits += value, credit_limit += value, credits_history row.

// Unambiguous code alphabet (no 0/O/1/I) so codes survive being read aloud.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function randomCode(groups, groupLen = 4) {
  const bytes = randomBytes(groups * groupLen);
  const chars = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]);
  const parts = [];
  for (let g = 0; g < groups; g++) parts.push(chars.slice(g * groupLen, (g + 1) * groupLen).join(''));
  return parts.join('-');
}
const normalizeCode = (c) => String(c || '').trim().toUpperCase().replace(/\s+/g, '');

// Shared grant-on-redeem: mirrors the admin grant transaction. Returns the
// new balance. Caller owns the client + transaction.
async function grantRedeemedCredits(client, { userId, credits, action, reason, days = CREDIT_LIFE_DAYS }) {
  const cur = await client.query('SELECT credits, credit_limit FROM users WHERE id = $1 FOR UPDATE', [userId]);
  if (cur.rowCount === 0) throw new Error('User not found');
  const after = Number(cur.rows[0].credits) + Number(credits);
  const limitAfter = Number(cur.rows[0].credit_limit) + Number(credits);
  await client.query('UPDATE users SET credits = $1, credit_limit = $2 WHERE id = $3', [after, limitAfter, userId]);
  await client.query(
    `INSERT INTO credits_history (user_id, amount, action, reason) VALUES ($1, $2, $3, $4)`,
    [userId, credits, action, reason]
  );
  // The addition is a lot with its own life (a promo code's access_days, or
  // the 30-day standard). NOT wrapped in a savepoint like the spend mirror:
  // an addition without its lot is drift from birth, so if this fails the
  // whole redemption fails and can simply be retried.
  const lot = await addLot(client, { userId, amount: credits, source: action, reason, days });
  return { balance: after, expiresAt: lot?.expires_at || null };
}

// Redeem attempts are a code-guessing surface — throttle hard per IP.
const redeemLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  keyGenerator: ipKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many redeem attempts — try again later.' },
});

// POST /api/redeem-code { code } — one box redeems BOTH kinds: gift cards
// (single-use) are checked first, then promo codes (per-user once, global
// cap via max_redemptions, expiry + active flag).
app.post('/api/redeem-code', redeemLimiter, verifyJwt, requireNotBanned, async (req, res) => {
  const code = normalizeCode(req.body?.code);
  if (!code || code.length < 4 || code.length > 64) {
    return res.status(400).json({ error: 'Enter a valid code.' });
  }
  if (!dbReady()) return res.status(503).json({ error: 'Database not available.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Gift card: atomic claim — the UPDATE only wins for the first redeemer.
    const gift = await client.query(
      `UPDATE gift_cards SET redeemed_by = $1, redeemed_at = NOW()
        WHERE code = $2 AND redeemed_by IS NULL
          AND (expires_at IS NULL OR expires_at > NOW())
        RETURNING credits`,
      [req.user.id, code]
    );
    if (gift.rowCount === 1) {
      const credits = Number(gift.rows[0].credits);
      const { balance, expiresAt } = await grantRedeemedCredits(client, {
        userId: req.user.id, credits, action: 'gift', reason: `gift card: ${code}`,
      });
      await client.query('COMMIT');
      console.log(`[redeem] gift card ${code} → user ${req.user.email} (+${credits})`);
      return res.json({ kind: 'gift', credits, balance, credits_expire_at: expiresAt });
    }

    // Promo code: lock the row, enforce active/expiry/global cap, then a
    // UNIQUE(code_id,user_id) insert enforces once-per-user.
    const promo = await client.query(
      `SELECT id, credits, max_redemptions, redeemed_count, active, expires_at, access_days
         FROM promo_codes WHERE code = $1 FOR UPDATE`,
      [code]
    );
    const p = promo.rows[0];
    const invalid =
      !p || !p.active ||
      (p.expires_at && new Date(p.expires_at) <= new Date()) ||
      (p.max_redemptions != null && p.redeemed_count >= p.max_redemptions);
    if (invalid) {
      await client.query('ROLLBACK');
      // One generic message — don't leak which codes exist vs expired.
      return res.status(404).json({ error: REFUSAL });
    }

    // ── IS THIS CODE ADDRESSED TO THIS PERSON? ────────────────────────────
    // A code with no rows here is open, which is every code issued before
    // 2026-08-20. With a list, only those addresses may redeem — that is what
    // makes a forwarded code worthless to whoever received it.
    //
    // The claim is checked against the account's OWN email from the database,
    // never anything sent with the request.
    const invitedRows = await client.query(
      `SELECT email FROM promo_code_emails WHERE code_id = $1`, [p.id]);
    if (invitedRows.rowCount > 0) {
      const verdict = mayRedeem({
        email: req.user.email,
        invited: new Set(invitedRows.rows.map((r) => r.email)),
      });
      if (!verdict.allowed) {
        await client.query('ROLLBACK');
        console.log(`[redeem] ${code} refused for ${req.user.email} — not on the code's list`);
        // THE SAME WORDS as every other refusal. "You are not on the list"
        // would confirm to whoever holds a leaked code that the code is real
        // and merely mis-addressed.
        return res.status(404).json({ error: REFUSAL });
      }
    }

    try {
      await client.query('INSERT INTO promo_redemptions (code_id, user_id) VALUES ($1, $2)', [p.id, req.user.id]);
    } catch (e) {
      await client.query('ROLLBACK');
      if (String(e.code) === '23505') {
        return res.status(409).json({ error: 'You already redeemed this code.' });
      }
      throw e;
    }
    await client.query('UPDATE promo_codes SET redeemed_count = redeemed_count + 1 WHERE id = $1', [p.id]);
    // Tick the invitation off. Harmlessly matches nothing on an open code.
    await client.query(
      `UPDATE promo_code_emails SET redeemed_by = $2, redeemed_at = NOW()
        WHERE code_id = $1 AND LOWER(email) = LOWER($3) AND redeemed_at IS NULL`,
      [p.id, req.user.id, req.user.email]);
    const credits = Number(p.credits);
    // ACCESS PERIOD → CREDIT LIFE (owner's rule, 2026-08-25). access_days used
    // to extend the ACCOUNT's lockout date; accounts never expire any more.
    // The code's own window now bounds how long ITS CREDITS live, and a code
    // with no window grants the 30-day standard — never open-ended, which is
    // how 584 of 587 accounts once ended up holding credits forever.
    const life = p.access_days != null && Number(p.access_days) > 0
      ? Number(p.access_days) : CREDIT_LIFE_DAYS;
    const { balance, expiresAt } = await grantRedeemedCredits(client, {
      userId: req.user.id, credits, action: 'promo', reason: `promo: ${code}`, days: life,
    });

    await client.query('COMMIT');
    console.log(
      `[redeem] promo ${code} → user ${req.user.email} (+${credits})` +
      (expiresAt ? ` credits live until ${new Date(expiresAt).toISOString().slice(0, 10)}` : ''));
    return res.json({ kind: 'promo', credits, balance, credits_expire_at: expiresAt });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[redeem] error:', err);
    return res.status(500).json({ error: 'Redeem failed — try again.' });
  } finally {
    client.release();
  }
});

// ─── ADMIN: TWO-FACTOR AUTH (H5, audit 2026-07-28) ─────────────────
// Three routes: status → start (returns secret + QR URI) → confirm (proves
// the admin's phone works, and ONLY THEN enables enforcement). Enforcement
// is deliberately opt-in-by-completion so deploying 2FA can never lock the
// admin out of their own CRM.

app.get('/api/admin/2fa/status', adminGate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT totp_enabled, totp_recovery_codes FROM users WHERE id = $1',
      [req.user.id]
    );
    const codes = Array.isArray(rows[0]?.totp_recovery_codes) ? rows[0].totp_recovery_codes : [];
    res.json({ enabled: !!rows[0]?.totp_enabled, recovery_codes_remaining: codes.length });
  } catch (err) {
    console.error('[admin/2fa/status] error:', err.message);
    res.status(500).json({ error: 'Could not read 2FA status.' });
  }
});

// Start enrolment: generate a secret and hand back the otpauth:// URI for
// the QR code. Stored but NOT enabled until /confirm succeeds.
app.post('/api/admin/2fa/setup', adminGate, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT totp_enabled FROM users WHERE id = $1', [req.user.id]);
    if (rows[0]?.totp_enabled) {
      return res.status(409).json({ error: 'Two-factor is already enabled. Disable it first to re-enrol.' });
    }
    const secret = generateSecret();
    await pool.query('UPDATE users SET totp_secret = $1, totp_enabled = FALSE WHERE id = $2', [secret, req.user.id]);
    console.log(`[admin/2fa] enrolment started for ${req.user.email}`);
    res.json({
      secret,
      otpauth_uri: buildOtpAuthUri(secret, { account: req.user.email }),
      next: 'Scan the QR in your authenticator app, then POST the 6-digit code to /api/admin/2fa/confirm.',
    });
  } catch (err) {
    console.error('[admin/2fa/setup] error:', err.message);
    res.status(500).json({ error: '2FA setup failed.' });
  }
});

// Confirm enrolment with a live code, then enable enforcement and return
// the recovery codes ONCE (only their hashes are stored).
app.post('/api/admin/2fa/confirm', adminGate, async (req, res) => {
  try {
    const code = String(req.body?.totp_code || '').trim();
    const { rows } = await pool.query(
      'SELECT totp_secret, totp_enabled FROM users WHERE id = $1', [req.user.id]
    );
    if (!rows[0]?.totp_secret) {
      return res.status(400).json({ error: 'Start setup first (POST /api/admin/2fa/setup).' });
    }
    if (rows[0].totp_enabled) {
      return res.status(409).json({ error: 'Two-factor is already enabled.' });
    }
    const offset = verifyTotp(rows[0].totp_secret, code);
    if (offset === null) {
      return res.status(400).json({ error: 'That code is not valid. Check your phone\'s clock and try the current code.' });
    }

    const recoveryCodes = generateRecoveryCodes(10);
    await pool.query(
      `UPDATE users
          SET totp_enabled = TRUE,
              totp_last_step = $1,
              totp_recovery_codes = $2::jsonb
        WHERE id = $3`,
      [String(currentStep() + offset), JSON.stringify(recoveryCodes.map(hashRecoveryCode)), req.user.id]
    );
    console.warn(`[admin/2fa] ✅ ENABLED for ${req.user.email} — recovery codes issued (hashes stored)`);
    res.json({
      enabled: true,
      recovery_codes: recoveryCodes,
      warning: 'These recovery codes are shown ONCE. Store them in two safe places — they are the only way in if you lose your phone.',
    });
  } catch (err) {
    console.error('[admin/2fa/confirm] error:', err.message);
    res.status(500).json({ error: '2FA confirmation failed.' });
  }
});

// Disable 2FA — requires a CURRENT code, so a hijacked admin session
// cannot quietly switch the second factor off.
app.post('/api/admin/2fa/disable', adminGate, async (req, res) => {
  try {
    const code = String(req.body?.totp_code || '').trim();
    const { rows } = await pool.query(
      'SELECT totp_secret, totp_enabled FROM users WHERE id = $1', [req.user.id]
    );
    if (!rows[0]?.totp_enabled) return res.status(400).json({ error: 'Two-factor is not enabled.' });
    if (verifyTotp(rows[0].totp_secret, code) === null) {
      return res.status(400).json({ error: 'A valid current code is required to disable two-factor.' });
    }
    await pool.query(
      `UPDATE users SET totp_enabled = FALSE, totp_secret = NULL,
              totp_recovery_codes = NULL, totp_last_step = NULL
        WHERE id = $1`,
      [req.user.id]
    );
    console.warn(`[admin/2fa] ⚠️ DISABLED for ${req.user.email}`);
    res.json({ enabled: false });
  } catch (err) {
    console.error('[admin/2fa/disable] error:', err.message);
    res.status(500).json({ error: '2FA disable failed.' });
  }
});

// ─── ADMIN: MODEL CATALOG (for the Bulk tab's allow-list picker) ───
// Server is the source of truth for model labels — the same keys the
// generate routes resolve and the allow-list gate compares against.
app.get('/api/admin/models', adminGate, (req, res) => {
  // N5: this used to offer only image + video, while the server gated only
  // those three routes. Now that voice, music, editing, motion control and the
  // node canvas are gated too, they have to be grantable — otherwise
  // restricting an account would silently remove them with no way back.
  res.json({
    image: Object.keys(MODEL_CONFIG),
    video: Object.keys(VIDEO_DIRECT_MAP),
    audio: [...Object.values(TTS_MODEL_LABELS), MUSIC_MODEL_LABEL],
    editing: [...Object.keys(EDIT_VIDEO_MODELS), ...Object.keys(MOTION_CONTROL_MODELS)],
    node: Object.keys(NODE_SYNC_SPECS),
  });
});

// ── COUNTING ARRIVALS (#64) ────────────────────────────────────────────────
// Runs on every request, decides with the pure rules in audience.js, and
// records OUT OF BAND — next() is called first, so a visitor never waits for a
// counter and a database hiccup can never take a page down with it. Analytics
// are worth considerably less than the site.
app.use(audienceMiddleware(pool, {
  dbReady,
  resolveIp: clientIp,
  // Our own pages are not a source of our own traffic: /image → /video is
  // navigation, and counting it would crowd out the real referrers.
  ownHosts: ['voxel-ai.ai', 'www.voxel-ai.ai', 'voxel-app-dev-b8a2h.ondigitalocean.app'],
}));

// ── WHAT THE BUSINESS COSTS (#59) ─────────────────────────────────────────
// Three sources, each labelled on the screen: TYPED (the handful that barely
// moves), MEASURED (FAL and kie, off the ledger), PULLED (DigitalOcean, from
// their billing API using a token the owner sets — never a password I hold).
app.get('/api/admin/expenses', adminGate, async (req, res) => {
  if (!dbReady()) return res.status(503).json({ error: 'Database not available.' });
  try {
    const months = Math.min(Math.max(parseInt(req.query.months, 10) || 6, 1), 24);
    const margin = Number(req.query.margin);

    const [expenses, measured, invoices] = await Promise.all([
      listExpenses(pool),
      measuredSupplierCost(pool, { months }).catch(() => []),
      cachedInvoices(pool, 'digitalocean').catch(() => []),
    ]);

    const thisMonth = new Date().toISOString().slice(0, 7);
    const current = measured.find((m) => m.month === thisMonth) || { fal: 0, kie: 0 };
    const rate = runRate(expenses, current);
    const renewalList = renewals(expenses);

    res.json({
      expenses,
      runRate: rate,
      renewals: renewalList,
      renewalHeadline: renewalHeadline(renewalList),
      // Break-even needs a margin per subscription. Passed in rather than
      // assumed: an invented margin would flow straight into the answer and
      // look like a fact.
      breakEven: breakEven(rate.fixed, margin),
      series: monthlySeries({ invoices, measured, months }),
      measured,
      digitalocean: {
        cached: invoices.length,
        lastFetched: invoices[0]?.fetched_at || null,
        // Said plainly so an empty DigitalOcean line is never mistaken for zero
        // cost — it means nobody has given the server a way to look.
        note: invoices.length ? null
          : 'No DigitalOcean invoices pulled yet. Set DIGITALOCEAN_TOKEN in the app '
            + 'environment (a READ-ONLY token is enough) and press Refresh.',
      },
      cycles: CYCLES,
    });
  } catch (err) {
    console.error('[admin/expenses] error:', err);
    res.status(500).json({ error: 'Could not build the expenses report.' });
  }
});

app.post('/api/admin/expenses', adminGate, async (req, res) => {
  if (!dbReady()) return res.status(503).json({ error: 'Database not available.' });
  try {
    await ensureExpenseTables(pool);
    const name = String(req.body?.name || '').trim().slice(0, 120);
    const amount = Number(req.body?.amount);
    const cycle = CYCLES.includes(req.body?.cycle) ? req.body.cycle : 'monthly';
    if (!name) return res.status(400).json({ error: 'A name is required.' });
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Amount must be a positive number.' });
    }
    const renewsOn = req.body?.renews_on ? new Date(req.body.renews_on) : null;
    if (renewsOn && Number.isNaN(renewsOn.getTime())) {
      return res.status(400).json({ error: 'Bad renewal date.' });
    }
    const { rows } = await pool.query(
      `INSERT INTO expenses (name, category, amount, cycle, renews_on, critical, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [name, String(req.body?.category || 'other').slice(0, 40), amount, cycle,
       renewsOn, Boolean(req.body?.critical),
       String(req.body?.note || '').slice(0, 500) || null]);
    res.json({ expense: rows[0] });
  } catch (err) {
    console.error('[admin/expenses] create failed:', err);
    res.status(500).json({ error: 'Could not save the expense.' });
  }
});

// Cancel, never delete — a cost that disappears makes last quarter look wrong.
app.post('/api/admin/expenses/:id/cancel', adminGate, async (req, res) => {
  if (!dbReady()) return res.status(503).json({ error: 'Database not available.' });
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id.' });
    const reopen = req.body?.reopen === true;
    const { rows } = await pool.query(
      `UPDATE expenses SET cancelled_at = ${reopen ? 'NULL' : 'NOW()'}, updated_at = NOW()
        WHERE id = $1 RETURNING *`, [id]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found.' });
    res.json({ expense: rows[0] });
  } catch (err) {
    console.error('[admin/expenses] cancel failed:', err);
    res.status(500).json({ error: 'Could not update the expense.' });
  }
});

app.post('/api/admin/expenses/refresh-digitalocean', adminGate, async (req, res) => {
  if (!dbReady()) return res.status(503).json({ error: 'Database not available.' });
  try {
    const result = await fetchDigitalOceanInvoices();
    if (result.error) return res.status(400).json({ error: result.error });
    const n = await cacheInvoices(pool, 'digitalocean', result.invoices);
    console.log(`[expenses] pulled ${n} DigitalOcean invoice(s)`);
    res.json({ pulled: n, invoices: result.invoices });
  } catch (err) {
    console.error('[admin/expenses] refresh failed:', err);
    res.status(500).json({ error: 'Could not reach DigitalOcean billing.' });
  }
});

app.get('/api/admin/audience', adminGate, async (req, res) => {
  if (!dbReady()) return res.status(503).json({ error: 'Database not available.' });
  try {
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 90, 1), 1095);
    res.json(await audienceReport(pool, { days }));
  } catch (err) {
    console.error('[admin/audience] error:', err);
    res.status(500).json({ error: 'Could not build the audience report.' });
  }
});

// ─── ADMIN: BULK USER PROVISIONING (CRM Bulk tab) ──────────────────
// Creates up to 200 accounts from an uploaded sheet's email list, each
// with: a generated password (returned ONCE for the admin to distribute),
// the chosen plan's credits (granted like an admin grant), an optional
// model allow-list, and an optional account expiry.
// WHO LOSES ACCESS, AND WHEN.
//
// Added urgently on 2026-08-20. The owner asked which accounts created on
// 21-23 June expire "tomorrow", and there was no way to find out: the Users tab
// shows an access column per row and nothing sorts or filters by it, so
// answering meant scrolling 601 rows — a chore that produces a guess. Nothing
// warned in advance either, so the first sign of an expiry was a customer
// unable to sign in, possibly during a workshop they had paid for.
// ── HAS THE BACKUP PASSPHRASE CHANGED? ────────────────────────────────────
// The owner, 2026-08-21, on whether it was rotated after appearing in a
// screenshot on 18 August: "I did not remember."
//
// Nobody has to. If the CURRENT passphrase opens the OLDEST archive still held,
// it has not changed since that archive was written. If it fails, it has — and
// everything older than the change is unreadable, which is a thing to find out
// deliberately rather than during a real restore.
//
// Read-only: it downloads one archive, decrypts it in memory, and writes
// nothing. It runs the same verification as the monthly check; only the choice
// of archive differs.
app.post('/api/admin/backup/passphrase-check', adminGate, async (req, res) => {
  if (!dbReady()) return res.status(503).json({ error: 'Database not available.' });
  try {
    const r = await runRestoreVerification(pool, { fetcher: fetchOldestOffsite });
    res.json({
      opened: r.ok,
      archive: r.key || null,
      exported_at: r.exportedAt || null,
      problems: r.problems || [],
      verdict: r.ok
        ? 'The current passphrase opened the oldest archive we hold — it has not been changed since that archive was written.'
        : 'The current passphrase could NOT open the oldest archive. Either it was changed, or that archive is damaged — see problems.',
    });
  } catch (err) {
    console.error('[passphrase-check] error:', err);
    res.status(500).json({ error: `Could not check: ${err.message}` });
  }
});

app.get('/api/admin/users/expiry-report', adminGate, async (req, res) => {
  if (!dbReady()) return res.status(503).json({ error: 'Database not available.' });
  try {
    const within = Math.min(Math.max(parseInt(req.query.days, 10) || SOON_DAYS, 1), 365);
    // Every account, because "open-ended" is a finding in its own right — that
    // was the 2026-08-11 problem, when 584 of 587 sat with no expiry at all and
    // the CRM showed nothing about it.
    const { rows } = await pool.query(
      `SELECT id, email, credits, package, expires_at, created_at
         FROM users WHERE banned = FALSE ORDER BY expires_at NULLS LAST, email`);
    const report = groupByExpiryDay(rows);
    res.json({
      summary: summarise(report),
      upcoming: actionable(report, within),
      open_ended: report.openEnded,
      already_expired: report.alreadyExpired,
      total_accounts: report.total,
      window_days: within,
    });
  } catch (err) {
    console.error('[admin/expiry-report] error:', err);
    res.status(500).json({ error: 'Could not read the expiry report.' });
  }
});

// ── CREDIT LOTS: THE 30-DAY RULE'S CONTROLS (owner, 2026-08-25) ───────────
// "Do not expire the account. Only expire the credit if it passed thirty days
// from the day that the credit added." Two endpoints, same discipline as
// everything destructive here: one that only looks, one that acts and is
// pressed by a person who has read the first.
//
// The look shows: what the first press takes (credits already past their 30
// days), how many locked accounts it unlocks, and the day-by-day look-ahead
// after that. The press does BOTH halves of the owner's instruction in one
// step — every account unlocked, the overdue credits swept — and turns the
// hourly sweep on from then on. Until it is pressed, nothing changes for
// anyone: the sweep stays off and the locked stay locked, so the old workshop
// credits cannot be spent through a gap between deploy and activation.
//
// (This replaced the 2026-08-20 credit-expiry pair, which zeroed balances AND
// closed account access — the half the owner has now reversed. The per-grant
// successor keeps the ledger honest the same way: one 'expire' row per sweep
// per account, naming the addition dates it took.)

app.get('/api/admin/credit-lots/overview', adminGate, async (req, res) => {
  if (!dbReady()) return res.status(503).json({ error: 'Database not available.' });
  try {
    const ahead = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
    res.json(await lotsOverview({ aheadDays: ahead }));
  } catch (err) {
    console.error('[admin/credit-lots] overview error:', err);
    res.status(500).json({ error: 'Could not read the credit-expiry picture.' });
  }
});

app.post('/api/admin/credit-lots/activate', adminGate, async (req, res) => {
  if (!dbReady()) return res.status(503).json({ error: 'Database not available.' });
  // Nothing runs without the exact numbers the admin was shown. If the picture
  // moved since they read it — a redemption, a top-up — this refuses and makes
  // them look again. A destructive action must not run against a list that
  // changed while it was being considered.
  const expectAccounts = Number(req.body?.expect_accounts);
  const expectCredits = Number(req.body?.expect_credits);
  if (!Number.isInteger(expectAccounts) || expectAccounts < 0 || !Number.isFinite(expectCredits)) {
    return res.status(400).json({ error: 'expect_accounts and expect_credits are required — they are the numbers you were shown.' });
  }
  try {
    const r = await activateNow({ adminEmail: req.user?.email, expectAccounts, expectCredits });
    if (r.conflict === 'already-activated') {
      return res.status(409).json({ error: 'The 30-day rule is already active.', activated_at: r.activated_at });
    }
    if (r.conflict === 'numbers-moved') {
      return res.status(409).json({
        error: `The picture changed since you looked — it is now ${r.now.accounts} account(s) and ${r.now.credits} credits past their 30 days. Review it again.`,
        now: r.now,
      });
    }
    res.json(r);
  } catch (err) {
    console.error('[admin/credit-lots] activate error:', err);
    res.status(500).json({ error: 'Activation failed — nothing was changed.' });
  }
});

app.post('/api/admin/users/bulk', adminGate, async (req, res) => {
  if (!dbReady()) return res.status(503).json({ error: 'Database not available.' });
  try {
    const { valid, invalid, dupes } = normalizeBulkEmails(req.body?.emails);
    if (valid.length === 0) {
      return res.status(400).json({ error: 'No valid email addresses found.', invalid, dupes });
    }
    if (valid.length > 200) {
      return res.status(400).json({ error: `Too many emails (${valid.length}) — max 200 per batch.` });
    }

    const pkg = String(req.body?.package || 'Free').slice(0, 32);
    const credits = Math.min(Math.max(Number(req.body?.credits) || 0, 0), 100000);
    // expires_at used to set an ACCOUNT lockout date here. Retired 2026-08-25
    // by the owner's rule — accounts never expire; the batch's credits get the
    // 30-day life instead. The field is accepted and ignored so an older UI
    // still in someone's tab cannot recreate lockouts.
    if (req.body?.expires_at) {
      console.log('[admin/bulk] expires_at ignored — account expiry is retired; credits expire per the 30-day rule');
    }
    // allowed_models: null/empty = unrestricted (all models).
    const allowedModels = Array.isArray(req.body?.allowed_models) && req.body.allowed_models.length
      ? req.body.allowed_models.map(m => String(m).slice(0, 64)).slice(0, 100)
      : null;

    // Bulk passwords are 14-char random (~68 bits entropy) — the entropy is
    // the defense, so a lighter bcrypt cost keeps a 200-user batch fast
    // instead of minutes at interactive-login cost.
    const BULK_BCRYPT_ROUNDS = 8;
    const results = [];
    for (const email of valid) {
      // M5 (audit 2026-07-28): each user is created inside its OWN
      // transaction, so the user row and its credit-grant ledger row
      // commit or roll back together. Previously a failure between the two
      // INSERTs left a credited user with no ledger row — the balance and
      // the audit trail disagreed, and the credits appeared from nowhere.
      // Per-user (not per-batch) so one bad address doesn't discard the
      // whole batch, which is what the admin expects from this screen.
      const client = await pool.connect();
      try {
        const exists = await client.query('SELECT 1 FROM users WHERE email = $1', [email]);
        if (exists.rowCount > 0) {
          results.push({ email, status: 'exists' });
          continue;
        }
        const password = generateBulkPassword();
        const hash = await bcrypt.hash(password, BULK_BCRYPT_ROUNDS);

        await client.query('BEGIN');
        const ins = await client.query(
          `INSERT INTO users (email, password_hash, credits, credit_limit, role, package, allowed_models)
           VALUES ($1, $2, $3, $3, 'user', $4, $5) RETURNING id`,
          [email, hash, credits, pkg, allowedModels ? JSON.stringify(allowedModels) : null]
        );
        if (credits > 0) {
          await client.query(
            `INSERT INTO credits_history (user_id, amount, action, admin_email, reason)
             VALUES ($1, $2, 'grant', $3, $4)`,
            [ins.rows[0].id, credits, req.user?.email || ADMIN_EMAIL, `bulk provision: ${pkg} plan`]
          );
          // The batch's starting credits are an addition like any other:
          // thirty days from today, per the owner's rule.
          await addLot(client, {
            userId: ins.rows[0].id, amount: credits, source: 'bulk',
            reason: `bulk provision: ${pkg} plan`,
          });
        }
        await client.query('COMMIT');
        results.push({ email, password, status: 'created' });
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('[admin/bulk] failed for', email, e.message);
        results.push({ email, status: 'error' });
      } finally {
        client.release();
      }
    }
    const created = results.filter(r => r.status === 'created').length;
    console.log(`[admin/bulk] ✅ ${created}/${valid.length} created (pkg=${pkg}, credits=${credits}, models=${allowedModels ? allowedModels.length : 'all'}, credit life=${credits > 0 ? `${CREDIT_LIFE_DAYS}d` : 'n/a'})`);
    res.json({ results, created, skipped_existing: results.filter(r => r.status === 'exists').length, invalid, dupes });
  } catch (err) {
    console.error('[admin/bulk] error:', err);
    res.status(500).json({ error: 'Bulk creation failed.' });
  }
});

// ─── ADMIN: PROMO CODE GENERATION ──────────────────────────────────
app.post('/api/admin/promocodes', adminGate, async (req, res) => {
  try {
    const credits = Number(req.body?.credits);
    if (!Number.isFinite(credits) || credits <= 0 || credits > 100000) {
      return res.status(400).json({ error: 'Credits must be a positive number.' });
    }
    const code = req.body?.code ? normalizeCode(req.body.code) : `VOXEL-${randomCode(2)}`;
    if (code.length < 4 || code.length > 64) {
      return res.status(400).json({ error: 'Code must be 4-64 characters.' });
    }
    // Custom codes: letters/digits/dashes only, so what the admin prints is
    // exactly what a user can type (normalizeCode uppercases both sides).
    if (!/^[A-Z0-9-]+$/.test(code)) {
      return res.status(400).json({ error: 'Codes may only contain letters, numbers, and dashes.' });
    }
    const maxRedemptions = req.body?.max_redemptions != null && req.body.max_redemptions !== ''
      ? Math.max(1, parseInt(req.body.max_redemptions, 10)) : null;
    const expiresAt = req.body?.expires_at ? new Date(req.body.expires_at) : null;
    if (expiresAt && isNaN(expiresAt)) return res.status(400).json({ error: 'Bad expiry date.' });

    // Free text so the admin can record who the code is for. Capped only to
    // keep the table readable; no format is imposed.
    const description = String(req.body?.description || '').trim().slice(0, 500) || null;

    // How many days of ACCESS redeeming this code buys. Distinct from
    // expires_at above, which is the last day the code may be redeemed.
    // Blank = open-ended, the historical behaviour.
    let accessDays = null;
    if (req.body?.access_days != null && req.body.access_days !== '') {
      accessDays = parseInt(req.body.access_days, 10);
      if (!Number.isInteger(accessDays) || accessDays < 1 || accessDays > 3650) {
        return res.status(400).json({ error: 'Access days must be a whole number between 1 and 3650, or blank for the standard 30-day credit life.' });
      }
    }

    // ── WHO the code is for ───────────────────────────────────────────────
    // Optional. Without a list the code behaves exactly as every code issued
    // so far: anyone signed in who knows the string may redeem it once.
    const { valid: invited, invalid: badEmails, dupes: dupeEmails } =
      normalizeBulkEmails(req.body?.emails);
    if (invited.length > 5000) {
      return res.status(400).json({ error: `Too many emails (${invited.length}) — max 5000 per code.` });
    }
    // "One hundred emails, one hundred uses": the list IS the cap, so the two
    // cannot drift apart. A smaller deliberate cap is still honoured.
    const cap = capForInvites({ inviteCount: invited.length, requested: maxRedemptions });

    // The code and its list commit together. A code that exists with half its
    // audience missing would be open to exactly the people left off it.
    const client = await pool.connect();
    let created;
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO promo_codes (code, credits, max_redemptions, expires_at, created_by, description, access_days)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [code, credits, cap, expiresAt, req.user?.email || ADMIN_EMAIL, description, accessDays]
      );
      created = rows[0];
      for (const email of invited) {
        await client.query(
          `INSERT INTO promo_code_emails (code_id, email) VALUES ($1, $2)
           ON CONFLICT (code_id, email) DO NOTHING`,
          [created.id, email]);
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
    console.log(`[admin/promocodes] ${created.code} created — ${credits} credits, `
      + `${invited.length ? `${invited.length} invited, cap ${cap}` : 'open to anyone with the code'}`);
    res.json({ promo: created, invited: invited.length, invalid: badEmails, dupes: dupeEmails });
  } catch (err) {
    if (String(err.code) === '23505') return res.status(409).json({ error: 'That code already exists.' });
    console.error('[admin/promocodes] error:', err);
    res.status(500).json({ error: 'Promo creation failed.' });
  }
});

app.get('/api/admin/promocodes', adminGate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.*,
              (SELECT COUNT(*)::int FROM promo_redemptions r WHERE r.code_id = p.id) AS unique_redeemers
         FROM promo_codes p ORDER BY p.created_at DESC LIMIT 500`
    );
    res.json({ promos: rows });
  } catch (err) {
    console.error('[admin/promocodes] list error:', err);
    res.status(500).json({ error: 'Promo list failed.' });
  }
});

// Edit a promo code after creation (CRM 2026-08-06).
//
// ONLY the description and the expiry are editable, deliberately:
//   - `credits` must not change once anyone has redeemed. The amount granted is
//     already recorded in credits_history; altering it here would make the
//     ledger disagree with the code that produced it.
//   - `code` must not change because printed/shared codes are already in the
//     wild, and promo_redemptions references this row by id, not by text.
// If either is genuinely needed, deactivate this code and create a new one.
//
// Extending the expiry REVIVES an expired code immediately: redemption checks
// `expires_at > NOW()` at redeem time, so nothing needs republishing.
app.patch('/api/admin/promocodes/:id', adminGate, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Bad promo id.' });

    const fields = [];
    const values = [];
    const set = (sql, value) => { values.push(value); fields.push(`${sql} = $${values.length}`); };

    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'description')) {
      const d = String(req.body.description ?? '').trim().slice(0, 500);
      set('description', d || null);
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'expires_at')) {
      const raw = req.body.expires_at;
      if (raw === null || raw === '') {
        // Explicitly clearing it — "never expires".
        set('expires_at', null);
      } else {
        const d = new Date(raw);
        if (isNaN(d)) return res.status(400).json({ error: 'Bad expiry date.' });
        set('expires_at', d);
      }
    }
    if (!fields.length) return res.status(400).json({ error: 'Nothing to update.' });

    values.push(id);
    const { rows } = await pool.query(
      `UPDATE promo_codes SET ${fields.join(', ')} WHERE id = $${values.length} RETURNING *`,
      values
    );
    if (!rows[0]) return res.status(404).json({ error: 'Promo code not found.' });
    console.log(`[admin/promocodes] ${req.user?.email} edited promo ${rows[0].code}`);
    res.json({ promo: rows[0] });
  } catch (err) {
    console.error('[admin/promocodes] patch error:', err);
    res.status(500).json({ error: 'Promo update failed.' });
  }
});

// Which accounts redeemed this code. The data has always been recorded in
// promo_redemptions; it has simply never been shown, so the admin could see a
// count but not who it was.
app.get('/api/admin/promocodes/:id/redemptions', adminGate, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Bad promo id.' });
    // Everything the per-code Excel export needs, one row per redeeming user.
    // `created_at` (the redemption moment) keeps its old name so the existing
    // UI is untouched; the user's own dates get explicit aliases because a
    // bare created_at would be ambiguous between "redeemed" and "registered".
    const { rows } = await pool.query(
      `SELECT r.user_id,
              r.created_at,
              r.created_at              AS redeemed_at,
              u.email,
              u.display_name,
              u.package,
              u.banned,
              u.created_at              AS registered_at,
              -- When THIS code's CREDITS end for this person (2026-08-25:
              -- accounts never expire — the code's window bounds its credits'
              -- life instead). Read from the lot the redemption planted, so
              -- "redeemed on X, credits end Y" reads off one line. NULL for
              -- redemptions made before the lots existed — blank, not a guess.
              (SELECT MAX(l.expires_at) FROM credit_lots l
                WHERE l.user_id = u.id AND l.source = 'promo'
                  AND l.reason = 'promo: ' || (SELECT code FROM promo_codes WHERE id = $1))
                                        AS credits_end_at,
              u.credits                 AS current_credits,
              u.last_login_at,
              -- Credits this user got from EVERY promo code, and how many codes
              -- they redeemed. Without these the sheet showed only the wallet
              -- total (u.credits), which is every grant, gift and refund minus
              -- everything spent — a user with a 158-credit code read as 9,716
              -- because of an unrelated admin grant. Owner reported it, rightly.
              (SELECT COALESCE(SUM(c2.credits), 0)
                 FROM promo_redemptions r2
                 JOIN promo_codes c2 ON c2.id = r2.code_id
                WHERE r2.user_id = u.id)          AS promo_credits_all,
              (SELECT COUNT(*)
                 FROM promo_redemptions r2
                WHERE r2.user_id = u.id)::int     AS promo_codes_count
         FROM promo_redemptions r
         JOIN users u ON u.id = r.user_id
        WHERE r.code_id = $1
        ORDER BY r.created_at DESC
        LIMIT 1000`,
      [id]
    );
    res.json({ redemptions: rows });
  } catch (err) {
    console.error('[admin/promocodes] redemptions error:', err);
    res.status(500).json({ error: 'Could not load redemptions.' });
  }
});

// Who was invited, and who has actually turned up.
//
// The screen that earns its keep BEFORE a workshop. The predictable failure is
// not fraud — it is someone invited as ahmed@company.com signing up with
// ahmed.k@gmail.com. A list showing only redemptions cannot surface that; one
// showing who is still outstanding lets it be fixed in seconds.
app.get('/api/admin/promocodes/:id/invites', adminGate, async (req, res) => {
  if (!dbReady()) return res.status(503).json({ error: 'Database not available.' });
  try {
    const codeId = parseInt(req.params.id, 10);
    if (!Number.isFinite(codeId) || codeId <= 0) {
      return res.status(400).json({ error: 'Invalid code id.' });
    }
    const { rows } = await pool.query(
      `SELECT e.email, e.redeemed_at, u.email AS redeemed_by_email
         FROM promo_code_emails e
         LEFT JOIN users u ON u.id = e.redeemed_by
        WHERE e.code_id = $1
        ORDER BY e.redeemed_at NULLS FIRST, e.email`,
      [codeId]);
    res.json(splitInvites(rows));
  } catch (err) {
    console.error('[admin/promocodes/invites] error:', err);
    res.status(500).json({ error: 'Could not read the invitation list.' });
  }
});

app.post('/api/admin/promocodes/:id/toggle', adminGate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE promo_codes SET active = NOT active WHERE id = $1 RETURNING *`,
      [parseInt(req.params.id, 10)]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Promo not found.' });
    res.json({ promo: rows[0] });
  } catch (err) {
    console.error('[admin/promocodes] toggle error:', err);
    res.status(500).json({ error: 'Toggle failed.' });
  }
});

// ─── ADMIN: GIFT CARD GENERATION ───────────────────────────────────
// Batch-generate single-use cards. Codes are returned ONCE in full here;
// the list endpoint shows them too (admin-only surface) so they can be
// re-copied and exported to CSV.
app.post('/api/admin/giftcards', adminGate, async (req, res) => {
  try {
    const credits = Number(req.body?.credits);
    const count = Math.min(Math.max(parseInt(req.body?.count, 10) || 1, 1), 500);
    if (!Number.isFinite(credits) || credits <= 0 || credits > 100000) {
      return res.status(400).json({ error: 'Credits must be a positive number.' });
    }
    const note = String(req.body?.note || '').slice(0, 200) || null;
    const expiresAt = req.body?.expires_at ? new Date(req.body.expires_at) : null;
    if (expiresAt && isNaN(expiresAt)) return res.status(400).json({ error: 'Bad expiry date.' });

    const cards = [];
    for (let i = 0; i < count; i++) {
      const code = `VGC-${randomCode(3)}`;
      const { rows } = await pool.query(
        `INSERT INTO gift_cards (code, credits, note, expires_at, created_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (code) DO NOTHING RETURNING *`,
        [code, credits, note, expiresAt, req.user?.email || ADMIN_EMAIL]
      );
      if (rows[0]) cards.push(rows[0]);
      else i--; // astronomically unlikely collision — retry
    }
    res.json({ cards });
  } catch (err) {
    console.error('[admin/giftcards] error:', err);
    res.status(500).json({ error: 'Gift card generation failed.' });
  }
});

app.get('/api/admin/giftcards', adminGate, async (req, res) => {
  try {
    const status = String(req.query.status || 'all');
    const where = status === 'unused' ? 'WHERE g.redeemed_by IS NULL'
      : status === 'redeemed' ? 'WHERE g.redeemed_by IS NOT NULL' : '';
    const { rows } = await pool.query(
      `SELECT g.*, u.email AS redeemed_by_email
         FROM gift_cards g LEFT JOIN users u ON u.id = g.redeemed_by
         ${where} ORDER BY g.created_at DESC LIMIT 1000`
    );
    res.json({ cards: rows });
  } catch (err) {
    console.error('[admin/giftcards] list error:', err);
    res.status(500).json({ error: 'Gift card list failed.' });
  }
});

// ─── PRICING (C1) ──────────────────────────────────────────────────
// Public read-only mirror of the authoritative sale-price tables in
// pricing.js. The frontend fetches this at boot so its displayed prices
// can never drift from what the server actually charges.
app.get('/api/pricing', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json({ image: PRICE_IMAGE_CREDITS, video: PRICE_VIDEO_CREDITS });
});

// ─── HEALTH CHECK ──────────────────────────────────────────────────
// Process start time — lets an external check tell WHEN the api container
// last restarted (i.e. whether a backend-only deploy actually rolled, since
// those don't change the frontend bundle hash).
const SERVER_STARTED_AT = new Date().toISOString();

// ── LIVENESS ──────────────────────────────────────────────────────
// DigitalOcean's health_check calls this every 10 seconds and restarts the
// container after six failures. It answers ONE question — has this process
// wedged — and it must never touch a dependency: a database that is merely
// SLOW would start killing healthy containers and turn a degradation into an
// outage. `db_configured` means a pool was CONSTRUCTED, nothing more. For
// "does the database actually answer", see /api/ready below.
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    started_at: SERVER_STARTED_AT,
    fal_configured: !!FAL_KEY,
    kie_configured: !!KIE_KEY,
    db_configured: dbReady(),
    auth_configured: !!JWT_SECRET,
    // ── IS THE CDN ACTUALLY IN USE? ───────────────────────────────────
    // Enabling the CDN on the Space and setting SPACES_CDN_BASE are two
    // separate steps in two different DigitalOcean screens, and doing only
    // the first leaves the CDN switched on and completely idle — which looks
    // identical to working. That happened here on 2026-08-27.
    //
    // The value is a PUBLIC url — the address every customer's browser
    // requests images from — so reporting it leaks nothing, and it means the
    // question "is the edge live" is answerable from outside, forever,
    // without a deploy log or a sign-in.
    media_cdn: mediaCdnBase() || null,
  });
});

// ── READINESS ─────────────────────────────────────────────────────
// "Is the site actually working", for an EXTERNAL monitor — the only kind
// that can tell you anything when the whole app is down, because a check
// running inside a dead app runs not at all.
//
// Answers 503 when the database does not reply. That status code is the
// entire point: an uptime monitor reads the code, and a body saying
// {"ok":false} with a 200 on it is a check that never fires — worse than no
// check, because it actively reassures.
//
// UNAUTHENTICATED on purpose, so a monitor can call it without holding a
// credential. It therefore says as little as possible: coarse per-dependency
// state, never a connection string. Rate limited because it is the one open
// endpoint that touches the database.
const readyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,                       // a monitor needs one every 2 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many readiness checks.' },
});

app.get('/api/ready', readyLimiter, async (req, res) => {
  const result = await deepHealth({
    pool: dbReady() ? pool : null,
    storageReady: spacesReady(),
  });
  if (!result.ok) {
    // Full detail to the LOG, where it is safe and where somebody debugging
    // will look. The response stays coarse.
    console.error('[ready] NOT READY:', JSON.stringify(result.checks));
  }
  res.status(result.status).json({
    ok: result.ok,
    started_at: SERVER_STARTED_AT,
    checks: result.checks,
  });
});

// ─── STATIC FRONTEND (production / DO buildpack) ──────────────────
// In dev, Vite serves the SPA on :5173 and proxies /api → :3001.
// In prod (DO buildpack or any single-process deploy), Express serves
// the built dist/ for everything that isn't /api/*. Skipped if dist
// doesn't exist (e.g. running just the api locally).
import { existsSync, readFileSync } from 'node:fs';
const DIST_DIR = path.resolve(__dirname, '../../dist');

// Per-route SEO meta (2026-07 audit findings #6/#10): the SPA shell used to
// serve the HOMEPAGE title/description/canonical on every route, so search
// results showed identical snippets for /image, /pricing, etc. The fallback
// below string-injects this map into the cached shell per request. Keys are
// lowercase paths without the leading slash; routes NOT in this map get the
// shell with HTTP 404 + noindex (fixes soft-404s, audit finding #4).
const ROUTE_META = {
  '': null, // homepage keeps the shell's own tags
  'explore': { title: 'Explore AI Creations — VOXEL.AI', desc: 'Browse the VOXEL.AI community feed — AI images and videos made with Kling, Veo, Seedance, Nano Banana Pro and more.' },
  'image': { title: 'AI Image Generator — VOXEL.AI', desc: 'Generate production-quality AI images with camera, lens and aperture control. Nano Banana Pro, GPT Image 2, Midjourney and more.' },
  'video': { title: 'AI Video Generator — VOXEL.AI', desc: 'Create cinematic AI video from text or images with Kling 3.0, Veo 3, Sora 2, Seedance 2.0 — camera motion, duration and audio control.' },
  'audio': { title: 'AI Audio & Voice Studio — VOXEL.AI', desc: 'Synthesize voice-overs and audio with ElevenLabs-quality AI voices in the VOXEL.AI Audio Studio.' },
  // Rewritten 2026-08-21 when the editor actually shipped. It used to promise
  // "Kling O1 and omni editing tools", which /edit has never had — this is the
  // description search engines index, so it was the site advertising a feature
  // that did not exist (task #30's problem, in the one place nobody looks).
  // TEMPORARY, with a ROUTE_META entry ON PURPOSE. Leaving it out is what this
  // very list warns about: an unlisted route renders perfectly inside the SPA
  // and answers HTTP 404 to every real request — so the page built for the
  // owner to LOOK at could not be opened. noindex so it is never surfaced.
  'timelinepreview': { title: 'Timeline preview — VOXEL', desc: 'Internal preview of the Voxel Edit Cut timeline. Not a public page.', noindex: true },
  'edit': { title: 'Free Video Editor — VOXEL.AI', desc: 'Trim your AI-generated videos, resize them for Reels, posts and YouTube, and add captions — free, with no credits used.' },
  'apps': { title: 'AI Apps & Tools — VOXEL.AI', desc: 'Face swap, relight, upscale, skin enhancer and more one-click AI apps on VOXEL.AI.' },
  'templates': { title: 'AI Templates — VOXEL.AI', desc: 'Start from proven AI generation templates for images and video on VOXEL.AI.' },
  'community': { title: 'Community — VOXEL.AI', desc: 'See what creators are making with VOXEL.AI and share your own AI generations.' },
  'pricing': { title: 'Pricing & Credits — VOXEL.AI', desc: 'Simple credit pricing from $5/month. Every plan unlocks every model with the same cost per credit — no watermarks, commercial rights included.' },
  'node': { title: 'Voxel Node Canvas — VOXEL.AI', desc: 'Chain AI models visually on the Voxel Node canvas — build repeatable image and video workflows.' },
  'studio': { title: 'Studio — VOXEL.AI', desc: 'The VOXEL.AI studio workspace for advanced creative sessions.' },
  'about': { title: 'About — VOXEL.AI', desc: 'VOXEL.AI is an AI-powered creative studio for images, video and audio — built for creators, marketers and studios.' },
  'contact': { title: 'Contact — VOXEL.AI', desc: 'Contact the VOXEL.AI team — support, billing, privacy and partnership enquiries.' },
  'terms': { title: 'Terms of Service — VOXEL.AI', desc: 'The terms that govern your use of VOXEL.AI — accounts, credits, content ownership and acceptable use.' },
  'account': { title: 'Your Account — VOXEL.AI', desc: 'Manage your VOXEL.AI profile, subscription, credit usage, promo codes and gifts.' },
  // The page the reset email links to. It MUST be listed here: an unlisted
  // route answers 404, and a 404 on the link in a password-reset email is the
  // kind of thing only a locked-out customer discovers. noindex because a
  // reset screen has no business in search results.
  'reset-password': { title: 'Reset your password — VOXEL.AI', desc: 'Set a new password for your VOXEL.AI account.', noindex: true },
};

// Paths that USED to exist and were deliberately removed — 410 Gone tells
// crawlers to drop them from the index instead of soft-404 limbo.
const GONE_PATHS = new Set(['privacy']);

function injectMeta(shell, { title, desc, canonical, noindex }) {
  let html = shell;
  if (title) {
    html = html
      .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
      .replace(/(property="og:title" content=")[^"]*(")/, `$1${title}$2`)
      .replace(/(name="twitter:title" content=")[^"]*(")/, `$1${title}$2`);
  }
  if (desc) {
    html = html
      .replace(/(name="description" content=")[^"]*(")/, `$1${desc}$2`)
      .replace(/(property="og:description" content=")[^"]*(")/, `$1${desc}$2`)
      .replace(/(name="twitter:description" content=")[^"]*(")/, `$1${desc}$2`);
  }
  if (canonical) {
    html = html
      .replace(/(rel="canonical" href=")[^"]*(")/, `$1${canonical}$2`)
      .replace(/(property="og:url" content=")[^"]*(")/, `$1${canonical}$2`);
  }
  if (noindex) {
    html = html.replace(/(name="robots" content=")[^"]*(")/, '$1noindex$2');
  }
  return html;
}

if (existsSync(DIST_DIR)) {
  // Cache the shell once per boot — it only changes on deploy (which boots
  // a fresh process anyway).
  const SHELL = readFileSync(path.join(DIST_DIR, 'index.html'), 'utf8');

  app.use(express.static(DIST_DIR, { maxAge: '1y', index: false }));
  app.get(/^\/(?!api\/).*/, (req, res) => {
    // Anything with a file extension that express.static didn't match does
    // not exist — return a real 404 instead of index.html. Serving HTML at
    // /sitemap1.xml, /robots.txt, etc. made SEO crawlers report "8 invalid
    // sitemaps" (every probed path answered 200 with the SPA shell).
    if (path.extname(req.path)) {
      return res.status(404).type('text/plain').send('Not found');
    }

    const route = req.path.toLowerCase().replace(/^\/+|\/+$/g, '');

    // HTML gets a SHORT freshness lifetime (60s), not a long one: hashed
    // asset URLs change every deploy, so stale HTML points at dead bundles.
    res.set('Cache-Control', 'public, max-age=60, must-revalidate');
    res.type('html');

    // Every HTML answer leaves through here, so the analytics tag is added in
    // ONE place. The control panel takes the 404 branch below (it is not in
    // ROUTE_META), which is exactly why injectClarity excludes it by ROUTE and
    // not by whether the route is known — a session replay of that screen would
    // ship 601 customers' emails, balances and revenue to a third party as
    // video. See clarity.js.
    const page = (html) => injectClarity(html, route);

    if (GONE_PATHS.has(route)) {
      return res.status(410).send(page(injectMeta(SHELL, {
        title: 'Page removed — VOXEL.AI', noindex: true,
      })));
    }
    if (!(route in ROUTE_META)) {
      // Unknown route: still render the SPA (client shows its 404 page) but
      // with an honest 404 status + noindex so crawlers don't index junk.
      return res.status(404).send(page(injectMeta(SHELL, {
        title: 'Page not found — VOXEL.AI', noindex: true,
      })));
    }
    const meta = ROUTE_META[route];
    if (!meta) return res.send(page(SHELL)); // homepage — shell tags already right
    // A noindex route gets no canonical: pointing crawlers at a page we are
    // simultaneously telling them to ignore is a contradiction.
    return res.send(page(injectMeta(SHELL, {
      ...meta,
      canonical: meta.noindex ? undefined : `https://voxel-ai.ai/${route}`,
    })));
  });
  console.log(`[voxel-api] serving static frontend from ${DIST_DIR}`);
} else {
  console.log(`[voxel-api] no dist/ found at ${DIST_DIR} — running api-only`);
}

// ─── START SERVER ──────────────────────────────────────────────────
// Run DB migrations FIRST (await), then listen. If the DB is unreachable we
// still listen — non-auth routes keep working, auth returns 503 with a clear
// message. This is intentional: a transient PG outage shouldn't take down
// the whole API.
function startListening() {
  app.listen(PORT, () => {
    console.log(
      `[voxel-api] listening on :${PORT} — FAL_KEY=${!!FAL_KEY}, KIE_KEY=${!!KIE_KEY}, db=${dbReady()}, jwt=${!!JWT_SECRET} — entities now in Postgres`
    );
  });
}

// ─── KIE-credit backfill (historical ledger rows) ──────────────────
// Rows created before per-transaction KIE tracking shipped have
// kie_credits = NULL. Fill them with label+amount-derived estimates
// (kie-pricing.js backfillKieEstimate) so the admin Logs/Usage pages show
// history, not dashes. Idempotent and safe to run every boot:
//   • only touches rows BEFORE the tracking cutoff — live-tracked rows and
//     genuinely-null ones (FAL, unlabeled, pre-kie-switch) are never written
//   • groups by (reason, amount) so it's a handful of UPDATEs, not
//     thousands of row round-trips
const KIE_TRACKING_STARTED = '2026-07-26T16:00:00Z';
async function backfillProviderCosts() {
  if (!dbReady()) return;
  try {
    const { rows: groups } = await pool.query(
      `SELECT reason, amount, MIN(created_at) AS first_at, MAX(created_at) AS last_at, COUNT(*)::int AS n
         FROM credits_history
        WHERE action = 'spend' AND reason IS NOT NULL
          AND (kie_credits IS NULL OR fal_cost IS NULL)
          AND created_at < $1
        GROUP BY reason, amount`,
      [KIE_TRACKING_STARTED]
    );
    let kieRows = 0, falRows = 0;
    for (const g of groups) {
      const sw = kieSwitchDateFor(g.reason); // switch day, or the cutoff sentinel for never-switched models

      // KIE side: rows AT/AFTER the model's kie switch (estimator returns
      // null pre-switch, so probing last_at covers the newest rows).
      const kieEst = backfillKieEstimate({ reason: g.reason, amount: g.amount, createdAt: g.last_at });
      if (kieEst != null) {
        const r = await pool.query(
          `UPDATE credits_history SET kie_credits = $1
            WHERE action = 'spend' AND kie_credits IS NULL AND reason = $2 AND amount = $3
              AND created_at >= $4 AND created_at < $5`,
          [kieEst, g.reason, g.amount, sw, KIE_TRACKING_STARTED]
        );
        kieRows += r.rowCount;
      }

      // FAL side: the complement — rows BEFORE the switch (or the whole
      // pre-tracking span for models that never moved to kie).
      const falEst = backfillFalEstimate({ reason: g.reason, amount: g.amount, createdAt: g.first_at });
      if (falEst != null) {
        const r = await pool.query(
          `UPDATE credits_history SET fal_cost = $1
            WHERE action = 'spend' AND fal_cost IS NULL AND reason = $2 AND amount = $3
              AND created_at < LEAST($4::timestamptz, $5::timestamptz)`,
          [falEst, g.reason, g.amount, sw, KIE_TRACKING_STARTED]
        );
        falRows += r.rowCount;
      }
    }
    if (kieRows || falRows) {
      console.log(`[provider-backfill] estimated kie_credits on ${kieRows} and fal_cost on ${falRows} historical ledger row(s)`);
    }
  } catch (err) {
    console.error('[provider-backfill] non-fatal:', err.message);
  }
}
// The switch date for a labeled model, for the per-row cut when a group
// straddles it. Mirrors KIE_SWITCH_DATE in kie-pricing.js via the estimator.
function kieSwitchDateFor(reason) {
  // Probe earliest-first: the first switch day at which the model already
  // estimates non-null IS its switch day.
  for (const d of ['2026-07-20', '2026-07-21']) {
    if (backfillKieEstimate({ reason, amount: 1, createdAt: d }) != null) return d;
  }
  return KIE_TRACKING_STARTED; // unpriced model — matches nothing
}

// ─── AUTOMATED DAILY BACKUPS → DO Spaces (2026-07 audit finding #1) ─
// The prod DB is a dev-tier instance with NO managed backups and one prior
// total data loss (2026-06-09). Until it moves to a production cluster,
// this job dumps every table to a PRIVATE gzip NDJSON object in Spaces
// daily and keeps the newest 14. Status is exposed on /api/admin/stats.
const BACKUP_TABLES = ['users', 'credits_history', 'admin_audit_log', 'failed_logins', 'entities', 'node_spaces', 'promo_codes', 'promo_redemptions', 'gift_cards'];
const BACKUP_KEEP = 14;
// LIVE since 2026-08-18: the owner read the dry-run list and approved it.
// Set OFFSITE_PRUNE_DRY_RUN=true to go back to printing without deleting.
const OFFSITE_PRUNE_DRY_RUN = process.env.OFFSITE_PRUNE_DRY_RUN === 'true';
// The offsite copy keeps LONGER than Spaces, deliberately.
//
// Spaces is the convenient copy you reach for on an ordinary bad day.
// Backblaze is the DISASTER copy — the one that survives losing the
// DigitalOcean account — and that is exactly the case where a problem may go
// unnoticed for a while. A 14-day window means anything discovered on day 15
// is gone. 30 days costs about 160 MB against a 10 GB tier, so the wider
// window is effectively free protection.
// Generous on purpose: the owner's decision last time was to keep more, not
// less. 60 daily archives is two months and costs almost nothing at this size.
const PRIMARY_KEEP = Number(process.env.PRIMARY_KEEP) || 60;
// Deleting is opt-IN. Set PRIMARY_PRUNE_DRY_RUN=false to arm it.
const PRIMARY_PRUNE_DRY_RUN = String(process.env.PRIMARY_PRUNE_DRY_RUN ?? 'true') !== 'false';
const OFFSITE_KEEP = 30;
const autoBackupStatus = {
  last_at: null, last_key: null, last_error: null,
  // M3: surfaced on /api/admin/stats so the CRM can show whether the
  // second copy and the encryption are actually in place.
  encrypted: false, offsite_key: null, offsite_error: null,
  // TRUE means "one copy on purpose" (dev). Distinct from offsite_error,
  // which means a second copy was expected and did not arrive.
  offsite_skipped: false,
};

/**
 * The archive key for a given UTC day — the same string runAutomatedBackup
 * writes, so the guard below can ask about exactly the object it would create.
 *
 * UTC, not Kuwait: the stamp comes from toISOString(), so the backup "day"
 * rolls at 03:00 local. Stated because a guard that computed the day
 * differently from the writer would skip the wrong one for three hours a night.
 */
export function archiveKeyFor(day, encrypted) {
  return `backups/voxel-auto-${day}.ndjson.gz${encrypted ? '.enc' : ''}`;
}

/**
 * ── WHY A BACKUP MAY DECLINE TO RUN ────────────────────────────────────────
 * runAutomatedBackup fires five minutes after EVERY BOOT. Production runs two
 * instances, so a single deploy produced TWO backups, and eight deploys on
 * 2026-08-21 produced SIXTEEN — 122.4 MB where 7.6 MB was needed.
 *
 * Every one of those copies was valid, which is why nothing complained. What it
 * cost was a full table scan of production per run, on a 1 vCPU box also
 * serving customers, with both instances scanning at once. It stayed invisible
 * until bucket versioning was switched on and the duplicates stopped
 * overwriting each other.
 *
 * TWO DIFFERENT RACES, TWO DIFFERENT ANSWERS:
 *
 *   ACROSS TIME (deploy at 09:00, another at 14:00) — the first run's archive
 *   is already in the bucket, so asking "does today's key exist?" settles it.
 *
 *   AT THE SAME INSTANT (both instances booting from one deploy) — neither has
 *   written anything yet, so both would see "no" and both would proceed. The
 *   existence check alone takes 16 down to 2, not to 1. A Postgres advisory
 *   lock decides which instance goes; the other returns immediately.
 *
 * THE BOOT RUN IS KEPT, NOT DELETED. On a fresh environment it is the only
 * thing that produces a first backup — and it is what gave the owner a verified
 * archive five minutes after rotating the passphrase on 2026-08-23. The problem
 * was never that it runs on boot; it was that nothing asked whether it needed to.
 *
 * FAILING OPEN IS DELIBERATE. If the existence check cannot reach Backblaze it
 * returns null, and null means "I do not know" — in which case the backup RUNS.
 * A duplicate archive is waste; a skipped one is a missing day, and only one of
 * those is recoverable.
 */
const BACKUP_LOCK_ID = 8_432_119; // arbitrary, stable, this job only

async function claimTodaysBackup() {
  const day = new Date().toISOString().slice(0, 10);
  const key = archiveKeyFor(day, Boolean(process.env.BACKUP_ENCRYPTION_PASSPHRASE));

  // ── ASK THE DESTINATION THIS ENVIRONMENT ACTUALLY WRITES TO ──────────────
  // The first version of this guard asked the OFFSITE bucket, full stop. That
  // is right on production and useless on dev, which has no offsite bucket by
  // design (#51). There the check returned "not configured", the guard failed
  // open, and dev backed up on EVERY BOOT — and dev deploys far more often than
  // production, so the environment with the least valuable data was doing the
  // most backing up.
  //
  // Found the same day it shipped, by the owner asking whether dev needed
  // backups at all. The honest answer was that the guard I had just deployed
  // did not work there. A guard that only holds in one environment is not a
  // guard; it is a guard-shaped thing that happens to cover production.
  const where = offsiteConfigured() ? 'offsite' : 'primary';
  const already = await (offsiteConfigured()
    ? offsiteObjectExists(key)
    : primaryObjectExists(key)).catch(() => null);

  if (already === true) {
    console.log(`[auto-backup] skipped — ${key} already exists (${where})`);
    return null;
  }
  if (already === null) {
    console.warn('[auto-backup] could not confirm whether today’s archive exists — '
      + 'running anyway. A duplicate is waste; a missing day is not recoverable.');
  }

  // A dedicated client: a session-level advisory lock belongs to its connection,
  // so taking it on a pooled client and handing that connection back would leak
  // the lock into whatever query ran next.
  let client;
  try {
    client = await pool.connect();
  } catch (e) {
    console.warn(`[auto-backup] no database client for the lock (${e.message}) — running unguarded`);
    return { key, release: async () => {} };
  }
  const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS got', [BACKUP_LOCK_ID]);
  if (!rows[0]?.got) {
    client.release();
    console.log('[auto-backup] skipped — the other instance is already backing up');
    return null;
  }
  return {
    key,
    release: async () => {
      try { await client.query('SELECT pg_advisory_unlock($1)', [BACKUP_LOCK_ID]); } catch {}
      client.release();
    },
  };
}

async function runAutomatedBackup() {
  if (!dbReady() || !spacesReady()) return;

  const claim = await claimTodaysBackup().catch((e) => {
    // The guard must never be the reason a backup does not happen.
    console.error(`[auto-backup] guard failed (${e.message}) — running anyway`);
    return { key: null, release: async () => {} };
  });
  if (!claim) return;

  try {
    const gz = zlib.createGzip();
    const chunks = [];
    gz.on('data', (c) => chunks.push(c));
    const gzDone = new Promise((resolve, reject) => { gz.on('end', resolve); gz.on('error', reject); });
    const write = (obj) => new Promise((resolve, reject) => {
      gz.write(JSON.stringify(obj) + '\n', (err) => (err ? reject(err) : resolve()));
    });

    await write({ meta: { exported_at: new Date().toISOString(), tables: BACKUP_TABLES, version: 1, kind: 'auto' } });
    const counts = {};
    for (const table of BACKUP_TABLES) {
      const BATCH = 1000;
      let offset = 0;
      for (;;) {
        let rows;
        try {
          ({ rows } = await pool.query(`SELECT * FROM ${table} ORDER BY id LIMIT ${BATCH} OFFSET ${offset}`));
        } catch (e) {
          // Table may not exist yet on older schemas — record and move on.
          await write({ table, error: e.message });
          break;
        }
        for (const row of rows) await write({ table, row });
        offset += rows.length;
        if (rows.length < BATCH) break;
      }
      counts[table] = offset;
    }
    await write({ done: true, counts });
    gz.end();
    await gzDone;

    const archive = Buffer.concat(chunks);
    const stamp = new Date().toISOString().slice(0, 10);

    // ── M3: encrypt before anything leaves the process ──────────────
    // Neither storage provider should ever hold readable customer data.
    // Without a passphrase we keep making the (unencrypted) primary copy
    // rather than stopping backups altogether — but say so loudly.
    const passphrase = (process.env.BACKUP_ENCRYPTION_PASSPHRASE || '').trim();
    const encrypted = passphrase ? encryptBackup(archive, passphrase) : null;
    if (!passphrase) {
      console.error('[auto-backup] ⚠️ BACKUP_ENCRYPTION_PASSPHRASE is not set — ' +
        'backups are being stored UNENCRYPTED. See RESTORE.md.');
    }

    const key = passphrase
      ? `backups/voxel-auto-${stamp}.ndjson.gz.enc`
      : `backups/voxel-auto-${stamp}.ndjson.gz`;

    // ── Destination 1: DO Spaces (unchanged, still the first copy) ──
    await uploadPrivate(key, encrypted || archive);
    console.log(`[auto-backup] ✅ primary (DO Spaces): ${key}`);

    // ── Destination 2: a DIFFERENT provider/account ─────────────────
    // The whole point of M3: losing the DO account must not lose the
    // backups too. Only encrypted archives are sent offsite.
    let offsiteKey = null;
    let offsiteError = null;
    let offsiteSkipped = false;
    if (offsiteConfigured()) {
      if (!passphrase) {
        offsiteError = 'refused to send an UNENCRYPTED archive offsite — set BACKUP_ENCRYPTION_PASSPHRASE';
        console.error(`[auto-backup] ❌ offsite: ${offsiteError}`);
      } else {
        try {
          offsiteKey = await uploadOffsite(key, encrypted);
          console.log(`[auto-backup] ✅ offsite: ${offsiteKey}`);
        } catch (e) {
          offsiteError = e.message;
          console.error('[auto-backup] ❌ offsite upload FAILED:', e.message);
        }
      }
    } else {
      // NOT CONFIGURED is a deliberate choice, not a failure. Dev keeps ONE
      // copy on purpose (task #51): it shared production's Backblaze caps, and
      // a backup of a scrubbed copy of production is not worth risking the
      // allowance production needs during a real restore.
      //
      // The loud-failure rule below is still exactly right where a second copy
      // IS configured and did not arrive. The difference is intent.
      offsiteSkipped = true;
      console.warn('[auto-backup] ⚠️ no offsite bucket configured — '
        + 'this environment keeps ONE copy by design');
    }

    autoBackupStatus.last_at = new Date().toISOString();
    autoBackupStatus.last_key = key;
    autoBackupStatus.encrypted = !!passphrase;
    autoBackupStatus.offsite_key = offsiteKey;
    autoBackupStatus.offsite_error = offsiteError;
    autoBackupStatus.offsite_skipped = offsiteSkipped;
    autoBackupStatus.last_error = null;
    console.log(`[auto-backup] counts`, JSON.stringify(counts));

    // RETENTION RUNS FIRST, and unconditionally.
    //
    // It used to sit after the throw below, so any offsite problem silently
    // stopped old backups being deleted — they accumulated for as long as the
    // condition lasted. A storage bill is a poor way to find out about a
    // backup fault, and housekeeping has nothing to do with the second copy.
    try {
      const all = (await listKeys('backups/')).sort((a, b) => String(b.key).localeCompare(String(a.key)));
      for (const obj of all.slice(BACKUP_KEEP)) {
        await deleteKey(obj.key);
        console.log(`[auto-backup] retention: deleted ${obj.key}`);
      }
    } catch (e) {
      console.error('[auto-backup] retention failed:', e.message);
    }

    // ── Retention on the SECOND copy ────────────────────────────────
    // Nothing had ever deleted from the offsite bucket: the block above only
    // ever touched Spaces, so Backblaze kept every archive since 2 August and
    // would have filled its 10 GB tier around December, at which point offsite
    // uploads would start failing.
    //
    // It shipped in dry run first: it printed every file it intended to remove,
    // the owner read that list, and approved it. What they approved was NOT
    // what I first proposed — I had suggested deleting three old production
    // archives to save 16 MB. Keeping them is better. They are the only copies
    // reaching back beyond 14 days, and storage is not a constraint here, so
    // the only argument for deleting them was tidiness. Production retention
    // therefore WIDENED to 30 days; only dev's orphans are removed.
    if (offsiteConfigured()) {
      try {
        await pruneOffsite({
          prefix: (process.env.OFFSITE_S3_PREFIX || 'backups/').replace(/^\/+/, ''),
          keep: OFFSITE_KEEP,
          dryRun: OFFSITE_PRUNE_DRY_RUN,
        });
        // Dev used to write here and no longer can, so nothing would ever
        // clean these up. keep: 0 — they are copies of a scrubbed copy of
        // production and protect nothing.
        await pruneOffsite({ prefix: 'dev-backups/', keep: 0, dryRun: OFFSITE_PRUNE_DRY_RUN });
      } catch (e) {
        console.error('[offsite-prune] failed (backup itself was fine):', e.message);
      }
    }

    // ── THE PRIMARY COPY, WHICH NOTHING HAS EVER PRUNED ──────────────────
    // pruneOffsite covers Backblaze and always has. Spaces has never been
    // covered, so the primary grew without limit and — the worse half — without
    // anyone able to SEE it growing. The two copies have been quietly
    // diverging: offsite trimmed to a retention, primary unbounded.
    //
    // DRY unless PRIMARY_PRUNE_DRY_RUN is explicitly turned off. The last time
    // backups were pruned the owner read the list first and the answer was to
    // WIDEN retention rather than delete — those archives are the only copies
    // reaching back, and storage is not a constraint here. So this reports and
    // does not delete until somebody deliberately says otherwise.
    try {
      const r = await prunePrimary({
        prefix: 'backups/',
        keep: PRIMARY_KEEP,
        dryRun: PRIMARY_PRUNE_DRY_RUN,
        list: (prefix) => listKeys(prefix),
        remove: (key) => deleteKey(key),
      });
      console.log(`[primary-prune] ${r.objects} archive(s) in Spaces, keeping ${PRIMARY_KEEP}`);
    } catch (e) {
      // Housekeeping must never fail a backup that already succeeded.
      console.error('[primary-prune] failed (backup itself was fine):', e.message);
    }

    // Fail LOUDLY when a second copy was EXPECTED and did not arrive. Silently
    // succeeding on one destination is exactly how people end up believing
    // they have backups they don't have. Skipped-by-design is not that.
    if (offsiteError) {
      autoBackupStatus.last_error = `only ONE copy exists: ${offsiteError}`;
      console.error('[auto-backup] ❌ INCOMPLETE — only one copy of this backup exists.');
      throw new Error(`Backup incomplete — offsite copy failed: ${offsiteError}`);
    }
  } catch (err) {
    autoBackupStatus.last_error = err.message;
    console.error('[auto-backup] FAILED:', err.message);
  } finally {
    // Released whether the backup succeeded, failed, or threw. A session-level
    // advisory lock survives its own function; left held, the OTHER instance
    // would skip every run until this process restarted — turning a fix for too
    // many backups into a cause of none.
    await claim.release();
  }
}

// ─── KIE BALANCE WATCHDOG (audit finding #9) ───────────────────────
// Generations for every user fail the moment the kie.ai balance hits zero.
// Hourly check; loud log line when low so DO log alerts can catch it. The
// CRM's API Usage tab shows the same number with a red state.

// H4 (audit 2026-07-28): ask the provider what happened to every video
// charge left 'pending' across a restart, and refund the failed ones. This
// is what makes the refund survive a deploy — the case the old in-memory
// Map lost silently. Runs shortly after boot so it never delays listening,
// and hourly after that to catch jobs abandoned mid-poll.
// Returns {verdict, reason}. The reason exists because every give-up path here
// used to return a bare 'pending' and log nothing, so the hourly pass reported
// "still pending 124" for days without saying why (see reconcilePendingCharges).
async function videoJobVerdict(row) {
  const modelId = String(row.model_id || '');
  if (modelId.startsWith('kie:')) {
    const family = modelId.startsWith('kie:jobs:') ? 'jobs' : 'veo';
    const t = await kieGetTask(family, row.job_id, { tag: 'KIE-RECONCILE' });
    if (t.state === 'fail') return { verdict: 'failed', reason: null };
    if (t.state === 'success') return { verdict: 'completed', reason: null };
    return { verdict: 'pending', reason: `kie-state:${t.state || 'none'}` };
  }
  // No provider recorded: nothing to ask, so this row can NEVER resolve on its
  // own. It is the prime suspect for the stuck backlog — surface it by name
  // rather than silently counting it as "still working".
  if (!modelId) return { verdict: 'pending', reason: 'no-model-id' };
  const status = await fal.queue.status(modelId, { requestId: row.job_id, logs: false });
  if (status.status === 'FAILED' || status.status === 'ERROR') return { verdict: 'failed', reason: null };
  if (status.status === 'COMPLETED') return { verdict: 'completed', reason: null };
  return { verdict: 'pending', reason: `fal-status:${status.status || 'none'}` };
}

// ─── THE 30-DAY PURGE (2026-08-28) ─────────────────────────────────
// Without this, "after 30 days it is permanently deleted" is not true — the
// row would sit marked forever and the file would sit with it. A retention
// promise nobody keeps is worse than no promise, and Amr is about to put this
// period into his B2B legal documents.
//
// ROW FIRST, THEN THE FILE. If the file survives, the result is an orphan
// costing pennies that nobody can reach. The other order leaves a row that
// still LOOKS recoverable while its picture is gone — and restoring it would
// tell the customer their work is back when it is not. The safe failure is
// the waste, so that is the one this chooses. See soft-delete.js.
//
// Daily, and capped per run. There is no hurry: a row one day past its window
// is no more urgent than one an hour past it, and a slow purge cannot look
// like an attack on our own bucket.
async function purgeExpiredDeletions() {
  if (!dbReady()) return;
  const { rows } = await pool.query(DUE_FOR_PURGE_SQL, [200]);
  if (!rows.length) return;

  const report = await purgeRows(rows, {
    dropRow: async (id) => (await pool.query(PURGE_ROW_SQL, [id])).rowCount,
    dropFile: async (url) => {
      // NULL for anything not ours — a provider link left by a failed re-host,
      // someone else's host. Nothing to delete, and guessing a key here would
      // delete the wrong object with no undo beneath it.
      const key = keyFromUrl(url);
      if (!key || !spacesReady()) return;
      await deleteKey(key);
    },
  });

  console.log(`[purge] ${report.purged} of ${report.considered} removed for good, `
    + `${report.filesRemoved} file(s) deleted`
    + (report.problems.length
      ? ` · ${report.problems.length} problem(s): ${report.problems.slice(0, 3)
        .map((x) => `${x.id}: ${x.why}`).join('; ')}`
      : ''));
}

// ─── THE RESCUE, RUNNING ON ITS OWN (2026-08-29) ───────────────────
// 12,568 files still live only on the provider's storage. At 60 per press
// that is 210 presses, so the button was never going to finish it — the same
// mistake as the thumbnails, and Amr was right to push back on it there.
//
// NEWEST FIRST, which matters more here than anywhere: the newest stranded
// files are the ones most likely to still EXIST. Oldest-first would spend
// every run discovering things that died months ago.
//
// Deliberately slow. This downloads and re-uploads real customer media, so a
// small batch every few minutes spreads the bandwidth across days instead of
// hammering the provider and our own bucket. There is no deadline — only a
// clock on the files, and steady progress beats a burst.
let rescueSweepRunning = false;
async function sweepRescue() {
  if (!dbReady() || !spacesReady() || rescueSweepRunning) return;
  const hosts = ourMediaHosts({
    endpoint: process.env.SPACES_ENDPOINT,
    bucket: process.env.SPACES_BUCKET,
    cdnBase: process.env.SPACES_CDN_BASE,
  });
  if (!hosts.length) return;

  rescueSweepRunning = true;
  try {
    const { rows } = await pool.query(RESCUE_QUEUE_SQL, [null, hosts, 15]);
    if (!rows.length) return;

    const report = await rescueRows(rows, {
      ourHosts: hosts,
      limit: rows.length,
      persist: (buf, contentType, kind) => persistBuffer(buf, contentType, kind),
      verify: (url) => headSize(url),
      setUrls: async (id, originUrl, newUrl, rowUserId) => {
        await pool.query(RESCUE_SQL,
          [JSON.stringify(originUrl), JSON.stringify(newUrl), id, rowUserId]);
      },
    });

    // Mark what is already gone, or this takes the same dead rows every pass
    // and never reaches the ones still alive. Additive — the customer's row and
    // its link are untouched.
    for (const id of report.goneIds || []) {
      await pool.query(MARK_GONE_SQL, [id]).catch((e) =>
        console.error(`[rescue-sweep] could not mark ${id}: ${e.message}`));
    }

    const { rows: left } = await pool.query(REMAINING_SQL, [hosts]);
    console.log(`[rescue-sweep] ${report.rescued} saved, ${report.alreadyGone} already gone, `
      + `${report.failed} failed, ${report.movedMB} MB · ${left[0]?.n ?? '?'} still to try`);
  } catch (e) {
    console.error('[rescue-sweep] pass failed:', e.message);
  } finally {
    rescueSweepRunning = false;
  }
}

function scheduleRescueSweep() {
  const run = () => sweepRescue().catch((e) => console.error('[rescue-sweep] failed:', e.message));
  // Five minutes after boot, then every three. 15 files a pass is roughly 300
  // an hour — the 12,568 clear in about two days without anybody noticing the
  // bandwidth.
  setTimeout(run, 5 * 60 * 1000).unref?.();
  setInterval(run, 3 * 60 * 1000).unref?.();
}

function schedulePurge() {
  const run = () => purgeExpiredDeletions().catch((e) =>
    console.error('[purge] pass failed:', e.message));
  // Ten minutes after boot rather than immediately: a deploy should not begin
  // by deleting things while the process is still warming up.
  setTimeout(run, 10 * 60 * 1000).unref?.();
  setInterval(run, 24 * 60 * 60 * 1000).unref?.();
}

function scheduleVideoChargeReconcile() {
  const run = () => reconcilePendingCharges(videoJobVerdict).catch((e) =>
    console.error('[video-reconcile] pass failed:', e.message));
  setTimeout(run, 30 * 1000).unref?.();
  setInterval(run, 60 * 60 * 1000).unref?.();
}

// ─── SLOW IMAGE SWEEPER (2026-08-28) ───────────────────────────────
// The part that makes the hand-off a promise rather than a hope.
//
// /api/image-status only works while a browser is open on the page. This
// finishes the job when the tab is closed, the laptop is shut, or the customer
// simply walks away — the ordinary case in a workshop room. Without it the
// image would still be lost, just later and more quietly than before.
//
// Every MINUTE, not hourly like the video reconcile: the whole point is that
// the picture is waiting a couple of minutes, and an hourly sweep would turn a
// two-minute wait into an hour of thinking it failed.
//
// Safe on two instances by construction — the exactly-once claim is a
// conditional UPDATE, so a duplicate pass loses the race and does nothing.
// No lock, no leader, nothing held in process memory.
async function sweepSlowImages() {
  if (!dbReady()) return;
  const { rows } = await pool.query(DUE_SQL, [50]);
  if (!rows.length) return;

  const report = await sweepJobs(rows, {
    check: (family, taskId) => kieGetTask(family, taskId, { tag: 'KIE-IMG-SWEEP' }),
    // Returns {url, thumbUrl} — the sweeper writes the history row itself, so
    // it must put the thumbnail in too. A row written without one would be the
    // slow-grid bug re-entering through the back door.
    persist: (url) => persistWithThumb(url, 'image', { makeThumb: makeThumbnail }),
    claim: async (taskId, url) => {
      const r = await pool.query(CLAIM_SQL, [taskId, url]);
      return r.rowCount ? r.rows[0] : null;
    },
    giveUp: async (taskId, why) => {
      const r = await pool.query(GIVE_UP_SQL, [taskId, String(why).slice(0, 500)]);
      return r.rowCount ? r.rows[0].user_id : null;
    },
    // The sweeper writes the history row ITSELF. This is the step the browser
    // would normally do, and the reason the whole table carries the prompt and
    // the model: with the tab gone, nothing else knows what was asked for.
    saveRow: async (job, url, thumbUrl) => {
      await pool.query(
        `INSERT INTO entities (id, name, user_id, data) VALUES ($1, 'GenerationHistory', $2, $3::jsonb)`,
        [crypto.randomUUID(), job.user_id,
         JSON.stringify({ ...historyRowFor(job, url, thumbUrl), job_id: job.task_id })]
      );
    },
    settle: (taskId) => settleVideoCharge(taskId),
    refund: (taskId, why) => refundFailedVideo(taskId, String(why).slice(0, 500)),
    touch: (taskId, note) => pool.query(TOUCH_SQL, [taskId, String(note).slice(0, 500)]),
  });

  // Logged only when something happened — a line every minute saying "0 of 0"
  // is how a log stops being read.
  if (report.delivered || report.refunded || report.problems.length) {
    console.log(`[image-sweep] ${report.delivered} delivered, ${report.refunded} refunded, `
      + `${report.waiting} still working${report.problems.length ? `, ${report.problems.length} problem(s): `
        + report.problems.map((p) => `${p.taskId}: ${p.why}`).join('; ') : ''}`);
  }
}

function scheduleSlowImageSweep() {
  const run = () => sweepSlowImages().catch((e) =>
    console.error('[image-sweep] pass failed:', e.message));
  setTimeout(run, 20 * 1000).unref?.();
  setInterval(run, 60 * 1000).unref?.();
}

/**
 * Copy customer media offsite, a slice at a time.
 *
 * INERT until MEDIA_SYNC_ENABLED is set — syncMediaOffsite checks that itself
 * and returns immediately. Backblaze refuses every upload above 10 GB without a
 * payment method, so an eager sync would spend its first night failing
 * thousands of times.
 *
 * The `running` guard matters more than it looks. A slow run can outlast the
 * interval, and two passes at once would copy the same objects twice and double
 * the bandwidth for no benefit — each would see the same "missing" list,
 * because neither has finished writing yet.
 */
let mediaSyncRunning = false;
let mediaSyncStartedAt = 0;
function scheduleMediaSync() {
  const run = async () => {
    // ── THE GUARD THAT SILENCED THE JOB FOR THREE HOURS ──────────────────
    // This was `if (mediaSyncRunning) return;` — silent. On 2026-08-20 a copy
    // hung: a stream that neither resolved nor rejected, so the promise never
    // settled, the flag stayed true, and every tick after it returned without
    // a word. The process was alive and the alerts kept logging, so nothing
    // looked wrong. The sync had simply stopped, permanently and quietly.
    //
    // Two changes, and the second is the one that matters: a skip now SAYS it
    // skipped, and a run that has outlived the watchdog is declared dead so the
    // next tick can take over. Silence is no longer a state this job can reach.
    if (mediaSyncRunning) {
      const stuckMs = Date.now() - mediaSyncStartedAt;
      if (stuckMs < RUN_WATCHDOG_MS) {
        console.log(`[media-sync] previous run still going (${Math.round(stuckMs / 1000)}s) — skipping this tick`);
        return;
      }
      console.error(`[media-sync] previous run has been stuck for ${Math.round(stuckMs / 60000)} min `
        + '— assuming it is dead and starting a fresh one. If this repeats, a copy is hanging.');
    }
    mediaSyncRunning = true;
    mediaSyncStartedAt = Date.now();
    try {
      const r = await syncMediaOffsite({
        listSource: listAllMedia,
        listDest: listOffsiteMedia,
        read: readObject,
        write: writeMediaObject,
        readDest: readMediaObject,
        // OUR OWN RECORD of what has been copied. With this, a failed offsite
        // listing is a warning rather than a full stop — which is the whole
        // point, after seventeen hours of no backup on 29 August.
        ledger: dbReady() ? {
          seed: async (rows) => {
            if (!rows?.length) return;
            await pool.query(LEDGER_SEED_SQL, [
              rows.map((x) => x.key), rows.map((x) => String(x.size ?? 0)),
            ]);
          },
          // Returns what is ALREADY copied, in the shape runSync expects for
          // its `dest` — so anything not in the ledger is treated as missing.
          missing: async (sourceObjects) => {
            const keys = (sourceObjects || []).map((o) => o.key).filter(Boolean);
            if (!keys.length) return [];
            const { rows } = await pool.query(LEDGER_MISSING_SQL, [keys]);
            const notCopied = new Set(rows.map((r2) => r2.k));
            return (sourceObjects || [])
              .filter((o) => !notCopied.has(o.key))
              .map((o) => ({ key: destKeyFor(o.key), size: o.size }));
          },
          record: (key, size) => pool.query(LEDGER_RECORD_SQL, [key, String(size)]),
        } : null,
      });
      if (r.error) console.error(`[media-sync] ${r.error}`);
      else if (dbReady()) {
        // ── THE HEARTBEAT (2026-08-28) ──
        // Recorded ONLY on a clean pass. Tonight the sync failed 22 times in a
        // row while the alerts pass said "0 open" every five minutes, because
        // nothing anywhere was watching whether the backup was still backing
        // up. A row, not a variable: this app redeploys several times a day
        // and a memory heartbeat would reset to healthy every time.
        await pool.query(SYNC_OK_SQL, [SYNC_FLAG, r.copied ?? 0, String(r.bytes ?? 0)])
          .catch((e) => console.error('[media-sync] heartbeat not recorded:', e.message));
      }
    } catch (e) {
      // Never let a backup job take the web process down — it would have made
      // things worse than the gap it was closing.
      console.error('[media-sync] pass failed:', e.message);
    } finally {
      mediaSyncRunning = false;
    }
  };
  // Two minutes after boot, so a redeploy does not start heavy I/O while the
  // process is still warming up and serving its first requests.
  setTimeout(run, 2 * 60 * 1000).unref?.();
  setInterval(run, 15 * 60 * 1000).unref?.();
}

migrate()
  .then(async () => {
    await backfillProviderCosts();
    // First backup shortly after boot (deploys restart daily-ish anyway),
    // then every 24h; balance check hourly starting now.
    setTimeout(runAutomatedBackup, 5 * 60 * 1000).unref?.();
    setInterval(runAutomatedBackup, 24 * 60 * 60 * 1000).unref?.();
    // Alerts, every 5 minutes. This REPLACES the hourly checkKieBalance()
    // whose only output was console.error — the condition was being detected
    // correctly for weeks and reported to a log nobody opens. Hourly was also
    // too slow: a busy workshop can go from above the threshold to empty
    // between two checks, which is what appears to have happened on 8 August.
    const alertsTick = () => {
      // Attempts whose browser tab was closed never report back. Marked
      // 'unknown' rather than failed — counting a generation we never heard
      // about as either success or failure would be a guess, and this is the
      // same root cause as the 124 stuck charges.
      sweepStale(6).catch(() => {});
      sweepIdempotency(26).catch(() => {});
      return runAlertChecks(pool, dbReady, { getKieCredits: KIE_KEY ? () => kieGetCredits() : null })
        .catch((e) => console.error('[alerts] scheduled check failed:', e.message));
    };
    alertsTick();
    setInterval(alertsTick, 5 * 60 * 1000).unref?.();
    scheduleVideoChargeReconcile();
    // Finishes any image the browser never came back for. Every minute,
    // because a customer waiting two minutes for a picture should not have to
    // wait an hour to find out it arrived.
    scheduleSlowImageSweep();
    // Makes "after 30 days it is permanently deleted" true. Nothing else in
    // the app removes a deleted row or its file.
    schedulePurge();
    // The 12,568 files still on provider links, saved a few at a time rather
    // than by 210 button presses nobody would make.
    scheduleRescueSweep();
    // Credit lots (owner's rule, 2026-08-25): date every existing balance
    // from the ledger once — harmless, touches no balances — then sweep
    // hourly. The sweep takes nothing until the owner activates the rule
    // from the CRM, and is safe under two instances by construction.
    backfillAllUsers().catch((e) => console.error('[credit-lots] boot backfill failed:', e.message));
    scheduleCreditLotSweep({ ready: dbReady });
    // Monthly, plus once within ten minutes of the first boot that has never
    // recorded a verification — so "can we restore?" is answered now rather
    // than in a month's time.
    scheduleRestoreVerification(pool, dbReady);
    // #55, first half — versioning is NOT enabled from here, and the reason is
    // worth writing down because I got it wrong first.
    //
    // I originally called ensureVersioning() at boot. It failed on dev with
    // "Access Denied", and the explanation was already in DigitalOcean's own
    // create-key dialog: bucket CONFIGURATION — lifecycle, policies,
    // versioning, CORS — is granted only to FULL ACCESS keys. Our production
    // key is deliberately Limited Access, scoped to one bucket, which is
    // precisely what we spent today achieving.
    //
    // So making this work would have meant handing the app back permanent
    // permission to reconfigure and delete any bucket, in order to perform a
    // ONE-OFF setting. The boot call is gone rather than the scoping.
    //
    // Versioning is switched on once with a temporary full-access key that is
    // then deleted: server/scripts/enable-versioning.mjs. The SOP screen reads
    // the bucket daily and says plainly whether it is on, so a setting nobody
    // applied cannot quietly look applied.

    // #55, second half — the offsite copy of customer media.
    //
    // EVERY 15 MINUTES, not daily, and the arithmetic is the reason: each run
    // is capped at 400 objects and 2 GiB so it cannot hog a web process that
    // gets redeployed several times a day. At that cap, 11,320 objects and
    // 66 GiB need ~34 runs. Daily, the first full copy would finish in 34 DAYS;
    // every fifteen minutes it finishes in about 8.5 hours. Once caught up a
    // run is two list calls and no work at all, so the frequency costs nothing
    // afterwards.
    //
    // 900_000 ms is comfortably inside the 32-bit timer limit. A delay above
    // 2,147,483,647 is silently coerced to 1ms — the bug that ran the restore
    // verification 294 times in five seconds on 2026-08-17 and exhausted a
    // provider's daily cap.
    scheduleMediaSync();
    // Owner-editable cadences, driven by the last recorded run rather than a
    // timer, so they survive the many redeploys this app sees in a day.
    scheduleSopJobs(pool, dbReady);
    // Seed the board once. Only adds refs that are absent, so a status the
    // owner has since changed is never overwritten — a seed that overwrites is
    // a seed that silently undoes someone's work.
    ensureTasksTable(pool)
      .then(() => seedTasks(pool, { upsertTask }))
      .catch((e) => console.error('[tasks] seed failed:', e.message));
    startListening();
  })
  .catch((err) => {
    console.error('[voxel-api] continuing despite migration error:', err.message);
    startListening();
  });
