import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import multer from 'multer';
import { fal } from '@fal-ai/client';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool, isReady as dbReady, migrate, ADMIN_EMAIL } from './db.js';
import { persistOrFallback } from './storage.js';
import { configureKie, kieCreateTask, kieGetTask, kiePollUntilDone } from './kie.js';
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

app.use(helmet({
  // We serve the SPA + Tailwind from the same origin and FAL's image URLs
  // come from arbitrary hosts. A strict CSP would break both. Tightening
  // this is a separate task once we have a stable inventory of asset hosts.
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

// Lock CORS to known origins. Empty Origin (curl, server-to-server) is
// allowed because admin curl + DO health probe both have no Origin header.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ||
  'https://voxel-ai.ai,http://localhost:5173,http://localhost:8080')
  .split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: false,
}));

app.use(express.json({ limit: '50mb' }));

// Real client IP. Behind Cloudflare → DO App Platform ingress → Node, `req.ip`
// resolves to a SHARED upstream IP, so keying rate limits on it throttles
// thousands of unrelated users TOGETHER (one bucket for everyone → "Too many
// attempts" for all). We must recover the true visitor IP. Try, in order:
//   1. CF-Connecting-IP / True-Client-IP — Cloudflare's real-visitor headers
//   2. leftmost X-Forwarded-For entry — the original client behind the proxies
//   3. req.ip — last resort (local dev / direct origin hits)
// (Trustworthy only because the origin is Cloudflare-fronted; lock the DO
// origin firewall to CF IP ranges so these headers can't be spoofed direct.)
function xffFirst(req) {
  const xff = req.headers['x-forwarded-for'];
  if (!xff) return '';
  return String(xff).split(',')[0].trim();
}
const clientIp = (req) =>
  String(
    req.headers['cf-connecting-ip'] ||
    req.headers['true-client-ip'] ||
    xffFirst(req) ||
    req.ip ||
    ''
  );
// IPv6-safe key for express-rate-limit v8 (normalizes /64 subnets).
const ipKey = (req) => ipKeyGenerator(clientIp(req));

// Is this login/register request for the admin account? Used to exempt the
// admin from the brute-force throttles so an operator can ALWAYS recover CRM
// access even after many failed attempts. NOTE: this trades brute-force
// protection on the admin email for guaranteed recoverability — acceptable
// short-term; revisit once a proper account-recovery flow exists.
const isAdminAuth = (req) =>
  String(req.body?.email || '').trim().toLowerCase() === ADMIN_EMAIL;

// Brute-force protection, keyed on the REAL client IP (see clientIp above).
//  • loginLimiter: tight, paired with the failed_logins DB check in
//    /api/auth/login for a second restart-surviving throttle.
//  • registerLimiter: more generous — many legitimate users legitimately share
//    one IP (office/campus NAT, mobile carrier CGNAT) and must all be able to
//    sign up. adminLimiter stays generous for the admin UI's burst of reads.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  // Generous per-IP ceiling: many legitimate users share one IP (office/campus
  // NAT, carrier CGNAT) and all must be able to log in. This counts ALL login
  // requests (success + fail); per-account brute-force is throttled separately
  // by the failed_logins (IP, email) check inside /api/auth/login.
  max: 100,
  keyGenerator: ipKey,
  skip: isAdminAuth, // admin is never rate-limited (recoverability over brute-force hardening)
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again in a few minutes.' },
});
const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100, // generous: NAT/campus/carrier can put many real signups behind one IP
  keyGenerator: ipKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many sign-up attempts. Try again in a few minutes.' },
});
const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many admin requests.' },
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
function requireFalKey(req, res, next) {
  if (!FAL_KEY) {
    return res.status(503).json({
      error:
        'FAL_KEY not configured on the server — generation is disabled. Check server/.env and restart the API.',
    });
  }
  next();
}

// ─── KIE.AI CONFIG ─────────────────────────────────────────────────
// Second model aggregator alongside FAL. Same wiring pattern: key from env,
// configured once here, guarded per-route. kie.js never reads process.env
// itself (dotenv runs after imports are hoisted).
const KIE_KEY = (process.env.KIE_KEY || '').trim();
configureKie(KIE_KEY);
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
    return res.status(503).json({
      error:
        'KIE_KEY not configured on the server — kie.ai models are disabled. Check server/.env and restart the API.',
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
// fail MINUTES later at the provider. Without this, a late failure meant
// the user paid for nothing. Every async submit registers its charge here;
// /api/video-status auto-refunds (once) when a job reaches FAILED.
// In-memory by design (single-file convention): a server restart forgets
// in-flight jobs, so those rare failures need a manual admin refund —
// look for '[video-refund]' gaps in the logs.
const asyncVideoCharges = new Map(); // job_id → { userId, kind, cost, refunded }

function trackVideoCharge(jobId, { userId, kind, cost }) {
  if (!jobId) return;
  // Backstop prune so the map can't grow unbounded.
  if (asyncVideoCharges.size > 5000) {
    asyncVideoCharges.delete(asyncVideoCharges.keys().next().value);
  }
  asyncVideoCharges.set(jobId, { userId, kind, cost, refunded: false });
}

// Refund a failed async job exactly once. The `refunded` flag flips
// synchronously before the awaited refund, so concurrent pollers (two tabs,
// rapid polls) can't double-refund.
async function refundFailedVideo(jobId, reason) {
  const rec = asyncVideoCharges.get(jobId);
  if (!rec || rec.refunded) return;
  rec.refunded = true;
  try {
    await refundCredits({
      userId: rec.userId, kind: rec.kind, cost: rec.cost,
      reason: `video_failed_async: ${reason}`.slice(0, 500),
    });
    console.log(`[video-refund] refunded job ${jobId} user=${rec.userId} (${reason})`);
  } catch (e) {
    console.error(`[video-refund] FAILED for job ${jobId} user=${rec.userId}:`, e.message);
  } finally {
    asyncVideoCharges.delete(jobId);
  }
}

// Build the kie.ai submission for a video model: which family endpoint to
// hit, the POST body, and the 'kie:'-prefixed model_id the status routes
// parse ('kie:jobs:' → Jobs API, plain 'kie:' → dedicated Veo endpoints).
// Shared by /api/generate-video and the legacy /api/generate video branch.
function buildKieVideoSubmission(mapping, { prompt, frames, duration, aspectRatio, resolution, audio = false }) {
  if (mapping.family === 'jobs' && mapping.kieModel === 'kling-3.0/video') {
    // Kling 3.0: one model for t2v + i2v; quality via mode (std 720p /
    // pro 1080p / 4K); duration string "3"-"15".
    const dur = Math.min(15, Math.max(3, parseInt(duration, 10) || 5));
    const mode = String(resolution).toUpperCase() === '4K' ? '4K' : 'pro';
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
          // kie REQUIRES multi_shots ("multi_shots cannot be empty") — we
          // always generate single-shot clips from the Video page.
          multi_shots: false,
          ...(frames.length ? { image_urls: frames } : {}),
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

// ─── GENERATE ENDPOINT ─────────────────────────────────────────────
// Auth + credit gating:
//   1. verifyJwt — must be logged in
//   2. requireNotBanned — banned users immediately blocked (no JWT revocation needed)
//   3. requireModelProviderKey — server must have the key for the model's provider (FAL or kie.ai)
//   4. chargeCredits — atomic balance deduct + history insert; 402 if insufficient
//   5. If the provider call fails → refundCredits so the user isn't billed for nothing
app.post('/api/generate', verifyJwt, requireNotBanned, requireModelProviderKey, async (req, res) => {
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

  // Charge BEFORE the provider call so a user can't burn through quota by
  // spamming requests that race past the balance check.
  let chargedKind = null;
  let chargedCost = null;
  try {
    const charge = await chargeCredits({ userId: req.user.id, kind: type, ip: req.ip, cost: req.body.credit_cost });
    chargedKind = type;
    chargedCost = charge.cost;
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
      const readyUrls = Array.isArray(imageUrls)
        ? imageUrls.filter(u => u && typeof u === 'string' && u.startsWith('http'))
        : [];
      const hasImages = readyUrls.length > 0;

      // ── kie.ai-backed image models: createTask → poll → re-host ──
      // Synchronous within the request like fal.subscribe. Poll capped at 90s
      // (< Cloudflare's ~100s proxied-request limit, < the frontend's 180s
      // axios timeout). Throws fall into the catch below → refund + named error.
      if (cfg.provider === 'kie') {
        const mode = hasImages ? (readyUrls.length >= 2 ? 'multi-image-edit' : 'image-to-image') : 'text-to-image';
        const kieInput = buildKieImageInput(cfg, { prompt, ratio, quality, imageUrls: readyUrls });
        const taskId = await kieCreateTask(cfg.family, kieInput, { tag: 'KIE-IMG' });
        const done = await kiePollUntilDone(cfg.family, taskId, { timeoutMs: 90_000, tag: 'KIE-IMG' });

        // kie result urls expire after ~14 days — re-host to our Spaces
        // bucket so history stays durable (same as FAL outputs).
        const durableUrl = await persistOrFallback(done.resultUrls[0], 'image');
        // Midjourney returns 4 images per task; surface the extras so the
        // client can use them later without another charge.
        const extra = done.resultUrls.slice(1);
        return res.json({
          success: true,
          type: 'image',
          result_url: durableUrl,
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

      const result = await fal.subscribe(falModelId, {
        input,
        logs: true,
        onQueueUpdate: (update) => {
          console.log('[FAL STATUS]', update.status, update.logs?.length ? `(${update.logs.length} logs)` : '');
        },
      });

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
        return res.status(500).json({
          error: reason,
          details: {
            reason: 'empty_result',
            result: result?.data || result,
          },
        });
      }

      // Copy FAL's ephemeral output into our own Spaces bucket so the image
      // survives in history after FAL purges its link. Falls back to the FAL
      // url if Spaces isn't configured or the copy fails.
      const durableUrl = await persistOrFallback(imageUrl, 'image');
      return res.json({ success: true, type: 'image', result_url: durableUrl, mode });
    }

    // ── VIDEO GENERATION ──
    if (type === 'video') {
      const readyUrls = Array.isArray(imageUrls)
        ? imageUrls.filter(u => u && typeof u === 'string' && u.startsWith('http'))
        : [];
      const hasFrames = readyUrls.length > 0;

      // kie.ai-backed video (Veo 3 / Kling): async task; the kie:-prefixed
      // model_id tells /api/video-status to poll kie instead of FAL.
      const directMapping = VIDEO_DIRECT_MAP[model];
      if (directMapping?.provider === 'kie') {
        const { family, body, modelIdTag } = buildKieVideoSubmission(directMapping, {
          prompt, frames: readyUrls.slice(0, 2), duration, aspectRatio: ratio,
        });
        const taskId = await kieCreateTask(family, body, { tag: 'KIE-VIDEO' });
        trackVideoCharge(taskId, { userId: req.user.id, kind: chargedKind, cost: chargedCost });
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
      trackVideoCharge(submitted.request_id, { userId: req.user.id, kind: chargedKind, cost: chargedCost });
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
        ip: req.ip,
        cost: chargedCost,
        reason: `${providerTag}: ${humanReason}`.slice(0, 500),
      }).catch(() => {});
    }

    return res.status(500).json({
      error: 'Generation failed: ' + humanReason,
      details: {
        reason: providerTag,
        status: error.status ?? null,
        statusCode: error.statusCode ?? null,
        body: error.body ?? null,
        responseData: error.response?.data ?? null,
      },
    });
  }
});

// ─── CHECK STATUS ENDPOINT ─────────────────────────────────────────
app.post('/api/checkStatus', async (req, res) => {
  const { job_id, model_id } = req.body;

  if (!job_id || typeof job_id !== 'string') return res.status(400).json({ error: 'Invalid job_id' });
  if (!model_id || typeof model_id !== 'string') return res.status(400).json({ error: 'Invalid model_id' });

  // kie.ai jobs — same prefix convention as /api/video-status.
  if (model_id.startsWith('kie:')) {
    try {
      const family = model_id.startsWith('kie:jobs:') ? 'jobs' : 'veo';
      const t = await kieGetTask(family, job_id, { tag: 'KIE-STATUS' });
      if (t.state === 'success') {
        asyncVideoCharges.delete(job_id); // settled — charge stands
        const durableUrl = await persistOrFallback(t.resultUrls[0], 'video');
        return res.json({ status: 'COMPLETED', video_url: durableUrl, image_url: null });
      }
      if (t.state === 'fail') {
        await refundFailedVideo(job_id, `kie: ${t.failMsg || 'generation failed'}`);
        return res.json({ status: 'FAILED', error: t.failMsg || 'Generation failed' });
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

      asyncVideoCharges.delete(job_id); // settled — charge stands
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
app.post('/api/generate-video', verifyJwt, requireNotBanned, requireModelProviderKey, async (req, res) => {
  const { model, prompt, image_url, tail_image_url, duration, aspect_ratio, resolution, audio } = req.body;

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

  // Charge BEFORE submission so we don't enqueue a job we can't bill for.
  let chargedKind = null;
  let chargedCost = null;
  try {
    const charge = await chargeCredits({ userId: req.user.id, kind: 'video', ip: req.ip, cost: req.body.credit_cost });
    chargedKind = 'video';
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
    console.error('[charge:video] error:', e);
    return res.status(500).json({ error: 'Credit charge failed.' });
  }

  // ── kie.ai-backed video (Veo 3 / Veo 3 Fast / Kling 3.0 / Kling 2.6) ──
  // Async task like FAL's queue; the kie:-prefixed model_id routes
  // /api/video-status polling to kie ('kie:jobs:' → Jobs API, plain 'kie:' →
  // Veo family). Old history rows carry unprefixed FAL ids and keep polling FAL.
  if (mapping.provider === 'kie') {
    try {
      const frames = image_url ? (tail_image_url ? [image_url, tail_image_url] : [image_url]) : [];
      const { family, body, modelIdTag } = buildKieVideoSubmission(mapping, {
        prompt, frames, duration, aspectRatio: aspect_ratio, resolution, audio,
      });
      const taskId = await kieCreateTask(family, body, { tag: 'KIE-VIDEO' });
      console.log(`[KIE-VIDEO] ✅ Submitted ${model} taskId: ${taskId}`);
      trackVideoCharge(taskId, { userId: req.user.id, kind: chargedKind, cost: chargedCost });
      return res.json({ success: true, job_id: taskId, model_id: modelIdTag, model });
    } catch (error) {
      console.error('[KIE-VIDEO] Error:', error.message);
      if (chargedKind) {
        refundCredits({
          userId: req.user.id, kind: chargedKind, ip: req.ip, cost: chargedCost,
          reason: `kie_video_threw: ${error.message}`.slice(0, 500),
        }).catch(() => {});
      }
      return res.status(500).json({ error: 'Video generation failed: ' + error.message });
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

  // Add start image with the correct param name for this model
  if (image_url) {
    input[mapping.imageParam] = image_url;
  }

  // Add end image with the correct param name for this model
  if (tail_image_url && mapping.endParam) {
    input[mapping.endParam] = tail_image_url;
  }

  console.log('[VIDEO] Payload:', JSON.stringify(input, null, 2));

  try {
    // Submit to queue and return immediately — frontend polls via /api/video-status
    const submitted = await fal.queue.submit(falModel, { input });
    const requestId = submitted.request_id;
    console.log(`[VIDEO] ✅ Submitted, request_id: ${requestId}`);
    trackVideoCharge(requestId, { userId: req.user.id, kind: chargedKind, cost: chargedCost });

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
        userId: req.user.id, kind: chargedKind, ip: req.ip, cost: chargedCost,
        reason: `fal_video_threw: ${error.message}`.slice(0, 500),
      }).catch(() => {});
    }
    return res.status(500).json({ error: 'Video generation failed: ' + error.message });
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

app.post('/api/edit-video-omni', verifyJwt, requireNotBanned, requireFalKey, async (req, res) => {
  const { model, video_url, image_urls, prompt, duration, aspect_ratio, keep_audio } = req.body || {};

  if (!model || !EDIT_VIDEO_MODELS[model]) {
    return res.status(400).json({ error: `Edit model not supported: ${model || '(missing)'}` });
  }
  if (!video_url) return res.status(400).json({ error: 'video_url required' });
  if (!prompt) return res.status(400).json({ error: 'prompt required' });

  let chargedKind = null;
  let chargedCost = null;
  try {
    const charge = await chargeCredits({ userId: req.user.id, kind: 'video', ip: req.ip, cost: req.body.credit_cost });
    chargedKind = 'video';
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
    trackVideoCharge(requestId, { userId: req.user.id, kind: chargedKind, cost: chargedCost });

    return res.json({ success: true, job_id: requestId, model_id: falModel, model });
  } catch (error) {
    console.error('[VIDEO-EDIT-OMNI] Error:', error.message);
    if (chargedKind) {
      refundCredits({
        userId: req.user.id, kind: chargedKind, ip: req.ip, cost: chargedCost,
        reason: `fal_video_edit_omni_threw: ${error.message}`.slice(0, 500),
      }).catch(() => {});
    }
    return res.status(500).json({ error: 'Video edit failed: ' + error.message });
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

  let chargedKind = null;
  let chargedCost = null;
  try {
    const charge = await chargeCredits({ userId: req.user.id, kind: 'video', ip: req.ip, cost: req.body.credit_cost });
    chargedKind = 'video';
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
    trackVideoCharge(requestId, { userId: req.user.id, kind: chargedKind, cost: chargedCost });

    return res.json({ success: true, job_id: requestId, model_id: falModel, model });
  } catch (error) {
    console.error('[MOTION-CONTROL] Error:', error.message);
    if (chargedKind) {
      refundCredits({
        userId: req.user.id, kind: chargedKind, ip: req.ip, cost: chargedCost,
        reason: `fal_motion_control_threw: ${error.message}`.slice(0, 500),
      }).catch(() => {});
    }
    return res.status(500).json({ error: 'Motion control failed: ' + error.message });
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

  const falModel = TTS_MODELS[model] || TTS_MODELS['eleven-v3'];
  const usingV3 = falModel.endsWith('eleven-v3');

  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'text required' });
  }
  if (text.length > 5000) {
    return res.status(400).json({ error: 'text too long (max 5000 chars)' });
  }

  let chargedKind = null;
  let chargedCost = null;
  try {
    const charge = await chargeCredits({ userId: req.user.id, kind: 'audio', ip: req.ip });
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
    const result = await fal.subscribe(falModel, { input, logs: false });
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
        userId: req.user.id, kind: chargedKind, ip: req.ip, cost: chargedCost,
        reason: `fal_tts_threw: ${error.message}`.slice(0, 500),
      }).catch(() => {});
    }
    return res.status(500).json({ error: 'TTS failed: ' + error.message });
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

app.post('/api/generate-music', verifyJwt, requireNotBanned, requireFalKey, async (req, res) => {
  const { prompt, negative_prompt, seed } = req.body || {};

  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ error: 'prompt required' });
  }
  if (prompt.length > 4000) {
    return res.status(400).json({ error: 'prompt too long (max 4000 chars)' });
  }

  let chargedKind = null;
  let chargedCost = null;
  try {
    const charge = await chargeCredits({ userId: req.user.id, kind: 'audio', ip: req.ip });
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
    const result = await fal.subscribe('fal-ai/lyria2', { input, logs: false });
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
        userId: req.user.id, kind: chargedKind, ip: req.ip, cost: chargedCost,
        reason: `fal_music_threw: ${error.message}`.slice(0, 500),
      }).catch(() => {});
    }
    return res.status(500).json({ error: 'Music generation failed: ' + error.message });
  }
});

// ─── VOICE PREVIEW (no auth) ───────────────────────────────────────
// Powers the ▶ button inside the Audio page Voice picker. Anyone (logged
// in or not) can hit this — it returns a fixed short sample for any
// voice. The first request per voice triggers a real FAL TTS call and
// the URL is cached in a module-level Map; every subsequent request
// for that voice returns the cached URL with no FAL call and no charge.
//
// Rate-limited per IP so a malicious caller can't burn through every
// voice and force a fresh FAL call for each. Cap = 30 fresh previews
// per IP per hour.
const PREVIEW_TEXT = 'Hi! This is a quick voice preview. You can pick this voice to read your script.';
const voicePreviewCache = new Map(); // voice name → audio_url
const previewRateBucket = new Map(); // ip → { count, resetAt }
const PREVIEW_RATE_MAX = 30;
const PREVIEW_RATE_WINDOW_MS = 60 * 60 * 1000;

function checkPreviewRate(ip) {
  const now = Date.now();
  const cur = previewRateBucket.get(ip);
  if (!cur || cur.resetAt < now) {
    previewRateBucket.set(ip, { count: 1, resetAt: now + PREVIEW_RATE_WINDOW_MS });
    return true;
  }
  if (cur.count >= PREVIEW_RATE_MAX) return false;
  cur.count++;
  return true;
}

app.post('/api/tts/preview', requireFalKey, async (req, res) => {
  const { voice } = req.body || {};
  if (!voice || typeof voice !== 'string') {
    return res.status(400).json({ error: 'voice required' });
  }

  // Cache hit → free + zero FAL load.
  const cached = voicePreviewCache.get(voice);
  if (cached) {
    return res.json({ success: true, audio_url: cached, cached: true });
  }

  // Cache miss → FAL call. Gate on per-IP rate limit so it can't
  // be abused to fill the cache from one source.
  if (!checkPreviewRate(req.ip || 'unknown')) {
    return res.status(429).json({ error: 'Too many previews. Try again in an hour.' });
  }

  const falModel = TTS_MODELS['eleven-v3'];
  const input = { text: PREVIEW_TEXT, voice, stability: 0.5 };
  console.log(`[TTS-PREVIEW] miss → ${voice} via ${falModel}`);

  try {
    const result = await fal.subscribe(falModel, { input, logs: false });
    const audioUrl = result?.data?.audio?.url;
    if (!audioUrl) throw new Error('No audio URL in FAL response');
    voicePreviewCache.set(voice, audioUrl);
    console.log(`[TTS-PREVIEW] ✅ cached ${voice} → ${audioUrl}`);
    return res.json({ success: true, audio_url: audioUrl, cached: false });
  } catch (error) {
    console.error('[TTS-PREVIEW] Error:', error.message);
    return res.status(500).json({ error: 'Preview failed: ' + error.message });
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
app.post('/api/generate-video-ref', verifyJwt, requireNotBanned, requireModelProviderKey, async (req, res) => {
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

  let chargedKind = null;
  let chargedCost = null;
  try {
    const charge = await chargeCredits({ userId: req.user.id, kind: 'video', ip: req.ip, cost: req.body.credit_cost });
    chargedKind = 'video';
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
    console.error('[charge:seedance] error:', e);
    return res.status(500).json({ error: 'Credit charge failed.' });
  }

  // Determine which Seedance endpoint to use
  const hasStartFrame = !!start_frame;
  const hasEndFrame = !!end_frame;
  const hasRefImages = (image_urls || []).length > 0;
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
          ...(hasStartFrame ? { first_frame_url: start_frame } : {}),
          ...(hasEndFrame ? { last_frame_url: end_frame } : {}),
          ...(hasRefImages ? { reference_image_urls: image_urls.slice(0, 9) } : {}),
          ...(hasRefVideos ? { reference_video_urls: video_urls.slice(0, 3) } : {}),
          ...(hasRefAudios ? { reference_audio_urls: audio_urls.slice(0, 3) } : {}),
        },
      };
      console.log(`[SEEDANCE] [KIE] Variant: ${modelLabel} →`, seedanceMapping.kieModel);
      const taskId = await kieCreateTask('jobs', body, { tag: 'KIE-SEEDANCE' });
      console.log(`[SEEDANCE] [KIE] ✅ Submitted taskId: ${taskId}`);
      trackVideoCharge(taskId, { userId: req.user.id, kind: chargedKind, cost: chargedCost });
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
          userId: req.user.id, kind: chargedKind, ip: req.ip, cost: chargedCost,
          reason: `kie_seedance_threw: ${error.message}`.slice(0, 500),
        }).catch(() => {});
      }
      return res.status(500).json({ error: 'Seedance generation failed: ' + error.message });
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
    if (hasStartFrame) input[frameField]    = start_frame;
    if (hasEndFrame)   input[endFrameField] = end_frame;
    console.log(`[SEEDANCE] Mode: image-to-video (start: ${hasStartFrame}, end: ${hasEndFrame})`);
  } else if (mode === 'reference' || hasRefImages || hasRefVideos || hasRefAudios) {
    // Reference-to-video mode (both variants accept image_urls/video_urls/audio_urls)
    falModel = `${endpointBase}/reference-to-video`;
    if (hasRefImages) input.image_urls = image_urls;
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
    trackVideoCharge(submitted.request_id, { userId: req.user.id, kind: chargedKind, cost: chargedCost });

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
        userId: req.user.id, kind: chargedKind, ip: req.ip, cost: chargedCost,
        reason: `seedance_threw: ${error.message}`.slice(0, 500),
      }).catch(() => {});
    }
    return res.status(500).json({ error: 'Seedance generation failed: ' + error.message });
  }
});

// ─── CHARACTER ELIGIBILITY CHECK ──────────────────────────────────
app.post('/api/check-character-eligibility', async (req, res) => {
  const { image_url } = req.body;
  if (!image_url) return res.status(400).json({ error: 'image_url required' });

  console.log('[ELIGIBILITY] Checking:', image_url);

  // Simulate a 2-second approval check
  // In production, this could call a face detection/content moderation API
  await new Promise(r => setTimeout(r, 2000));

  // For now: always approve if the URL is valid
  const approved = image_url.startsWith('http');
  console.log('[ELIGIBILITY]', approved ? '✅ Approved' : '❌ Rejected');

  res.json({ approved, image_url });
});

// ─── VIDEO STATUS POLLING ─────────────────────────────────────────
app.post('/api/video-status', async (req, res) => {
  const { job_id, model_id } = req.body;
  if (!job_id || !model_id) return res.status(400).json({ error: 'job_id and model_id required' });

  // kie.ai jobs carry a 'kie:'-prefixed model_id (set at submit time);
  // 'kie:jobs:...' → unified Jobs API, plain 'kie:...' → Veo endpoints.
  // Everything else is a FAL request id → FAL polling below.
  if (model_id.startsWith('kie:')) {
    try {
      const family = model_id.startsWith('kie:jobs:') ? 'jobs' : 'veo';
      const t = await kieGetTask(family, job_id, { tag: 'KIE-VIDEO' });
      if (t.state === 'success') {
        asyncVideoCharges.delete(job_id); // settled — charge stands
        const durableUrl = await persistOrFallback(t.resultUrls[0], 'video');
        return res.json({ status: 'COMPLETED', video_url: durableUrl });
      }
      if (t.state === 'fail') {
        await refundFailedVideo(job_id, `kie: ${t.failMsg || 'generation failed'}`);
        return res.json({ status: 'FAILED', error: t.failMsg || 'Generation failed' });
      }
      return res.json({ status: 'IN_PROGRESS' });
    } catch (error) {
      console.error('[VIDEO-STATUS] [KIE] ❌ Error checking status:', error.message);
      await refundFailedVideo(job_id, `kie status error: ${error.message}`);
      return res.json({ status: 'FAILED', error: error.message });
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

      asyncVideoCharges.delete(job_id); // settled — charge stands
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
    await refundFailedVideo(job_id, `fal status error: ${error.message}`);
    return res.json({ status: 'FAILED', error: error.message });
  }
});

// ─── FILE UPLOAD (to FAL storage) ──────────────────────────────────
// Wrap multer manually so file-too-large + other multer errors return
// proper JSON (default behaviour is HTML, which makes the frontend show
// "Upload returned no URL" with no useful diagnostic).
app.post('/api/upload', (req, res, next) => {
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

  // Validate FAL has a key configured — without this, fal.storage.upload
  // will fail with a cryptic auth error that's hard to interpret.
  if (!FAL_KEY) {
    console.error('[UPLOAD] ❌ FAL_KEY missing on server');
    return res.status(500).json({ error: 'Upload service not configured (FAL_KEY missing on server)' });
  }

  const info = `${req.file.originalname} · ${(req.file.size / (1024 * 1024)).toFixed(2)} MB · ${req.file.mimetype}`;
  console.log('[UPLOAD] ⏳', info);

  // Try File API first (Node 18+), fall back to Blob if it explodes.
  let attempts = [];
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

// ─── IMAGE DOWNLOAD (proper Content-Disposition for save dialog) ───
app.get('/api/download', async (req, res) => {
  const { url, filename } = req.query;
  if (!url) return res.status(400).json({ error: 'url required' });
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch image');
    const contentType = response.headers.get('content-type') || 'image/png';
    const ext = contentType.includes('jpeg') || contentType.includes('jpg') ? 'jpg' : 'png';
    const name = filename || `voxel-ai-${Date.now()}.${ext}`;
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    const buffer = Buffer.from(await response.arrayBuffer());
    res.send(buffer);
  } catch (error) {
    console.error('Download proxy error:', error.message);
    res.status(500).json({ error: 'Download failed' });
  }
});

// ─── LLM ENDPOINT (for Studio ScriptModule) ───────────────────────
app.post('/api/llm', async (req, res) => {
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
app.post('/api/enhance-prompt', requireFalKey, async (req, res) => {
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
    const result = await fal.subscribe('fal-ai/any-llm', {
      input: {
        model: 'google/gemini-flash-1.5',
        prompt: prompt.trim(),
        system_prompt: system,
      },
      logs: false,
    });
    // any-llm returns the text under .output (sometimes nested in .data)
    const raw =
      result?.data?.output ??
      result?.output ??
      result?.data?.text ??
      result?.text ??
      '';
    const enhanced = String(raw).trim();
    if (!enhanced) {
      console.error('[ENHANCE] empty LLM response. Raw:', JSON.stringify(result, null, 2));
      return res.status(502).json({
        error: 'Enhancer returned no output. Try again or rephrase your prompt.',
      });
    }
    return res.json({ prompt: enhanced });
  } catch (e) {
    console.error('[ENHANCE] ❌ LLM error:', e.message);
    return res.status(500).json({ error: 'Enhancer failed: ' + e.message });
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
    ...(row.data || {}),
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
    let where = `user_id = $1 AND name = $2`;
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
    const sql = `SELECT * FROM entities WHERE user_id = $1 AND name = $2 ${sortClause(req.query.sort)} LIMIT $3 OFFSET $4`;
    const { rows } = await pool.query(sql, params);
    res.json(rows.map(rowToItem));
  } catch (e) {
    console.error('[entities:list] error:', e.message);
    res.status(500).json({ error: 'List failed.' });
  }
});

app.post('/api/entities/:name', verifyJwt, async (req, res) => {
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

app.put('/api/entities/:name/:id', verifyJwt, async (req, res) => {
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

// Tracks submitted async (video) node jobs so we can refund the charge if
// the FAL job later FAILS during client-side polling. In-memory (single
// instance) — on restart we simply lose the ability to auto-refund a
// then-in-flight job, which is acceptable and never double-charges.
// Keyed by job_id → { userId, kind, modelId, refunded }.
const videoNodeJobs = new Map();

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
app.post('/api/node/run-node', verifyJwt, requireNotBanned, requireFalKey, async (req, res) => {
  if (!dbReady()) return res.status(503).json({ error: 'Database not configured.' });

  const { type, settings } = req.body || {};
  const spec = NODE_SYNC_SPECS[type];
  if (!spec) return res.status(400).json({ error: `Unsupported node type: ${type || '(missing)'}` });
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
    const charge = await chargeCredits({ userId: req.user.id, kind: spec.creditKind, ip: req.ip });
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
      const urls = Array.isArray(settings?.image_urls) && settings.image_urls.length
        ? settings.image_urls.filter(Boolean)
        : (settings?.image_url ? [settings.image_url] : []);
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
        refundCredits({ userId: req.user.id, kind: chargedKind, ip: req.ip, reason: `node_run_kie_threw: ${error.message}`.slice(0, 500) }).catch(() => {});
      }
      return res.status(500).json({ error: 'Node run failed: ' + error.message });
    }
  }

  const input = spec.buildInput(settings, prompt.trim());
  console.log(`[node:run] user=${req.user.id} type=${type} model="${settings?.model || '-'}" → ${falModel}`);

  try {
    const result = await fal.subscribe(falModel, { input, logs: false });
    const url = spec.extract(result?.data);
    if (!url) throw new Error('No output returned by model');
    console.log(`[node:run] ✅ ${url}`);
    return res.json({ success: true, outputs: { [spec.outKey]: url } });
  } catch (error) {
    console.error('[node:run] FAL error:', error.message);
    if (chargedKind) {
      refundCredits({ userId: req.user.id, kind: chargedKind, ip: req.ip, reason: `node_run_threw: ${error.message}`.slice(0, 500) }).catch(() => {});
    }
    return res.status(500).json({ error: 'Node run failed: ' + (error?.body?.detail || error.message) });
  }
});

// Run an ASYNC node (video). Charges credits, submits to the FAL queue,
// returns { job_id, model_id }. The client polls the existing
// /api/video-status route until COMPLETED/FAILED. Used by the Video
// Generator node, which can run text-to-video or — when an upstream
// image is connected — image-to-video (start frame).
app.post('/api/node/run-node-async', verifyJwt, requireNotBanned, requireFalKey, async (req, res) => {
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
  try {
    const charge = await chargeCredits({ userId: req.user.id, kind: 'video', ip: req.ip, cost: req.body.credit_cost });
    chargedKind = 'video';
    chargedCost = charge.cost;
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
      videoNodeJobs.set(taskId, { userId: req.user.id, kind: chargedKind, modelId: submission.modelIdTag, refunded: false });
      return res.json({ success: true, job_id: taskId, model_id: submission.modelIdTag });
    } catch (error) {
      console.error('[node:run-async] [KIE] error:', error.message);
      if (chargedKind) {
        refundCredits({ userId: req.user.id, kind: chargedKind, ip: req.ip, cost: chargedCost, reason: `node_async_kie_threw: ${error.message}`.slice(0, 500) }).catch(() => {});
      }
      return res.status(500).json({ error: 'Node video failed: ' + error.message });
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
    // Remember the job so /run-failed can refund if it later fails.
    videoNodeJobs.set(submitted.request_id, { userId: req.user.id, kind: chargedKind, modelId: falModel, refunded: false });
    return res.json({ success: true, job_id: submitted.request_id, model_id: falModel });
  } catch (error) {
    console.error('[node:run-async] submit error:', error.message);
    if (chargedKind) {
      refundCredits({ userId: req.user.id, kind: chargedKind, ip: req.ip, reason: `node_async_threw: ${error.message}`.slice(0, 500) }).catch(() => {});
    }
    return res.status(500).json({ error: 'Video submit failed: ' + (error?.body?.detail || error.message) });
  }
});

// Refund a video node whose FAL job failed during polling. Verifies with
// FAL that the job actually FAILED (so a succeeded job can't be refunded)
// and that the caller owns it, and refunds at most once.
app.post('/api/node/run-failed', verifyJwt, requireNotBanned, async (req, res) => {
  const { job_id } = req.body || {};
  const rec = job_id && videoNodeJobs.get(job_id);
  if (!rec) return res.json({ refunded: false, reason: 'unknown_job' });
  if (rec.userId !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  if (rec.refunded) return res.json({ refunded: false, reason: 'already' });

  try {
    const status = await fal.queue.status(rec.modelId, { requestId: job_id, logs: false });
    const failed = status.status === 'FAILED' || status.status === 'ERROR';
    if (!failed) return res.json({ refunded: false, reason: 'not_failed', status: status.status });
    rec.refunded = true;
    await refundCredits({ userId: rec.userId, kind: rec.kind, ip: req.ip, reason: `node_video_job_failed: ${job_id}` });
    console.log(`[node:run-failed] refunded video job ${job_id} for user=${rec.userId}`);
    return res.json({ refunded: true });
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
const ADMIN_JWT_EXPIRES = process.env.ADMIN_JWT_EXPIRES_IN || '30m';

app.post('/api/auth/login', loginLimiter, requireAuthInfra, async (req, res) => {
  const ip = clientIp(req);
  const ua = req.get('user-agent') || null;
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');

  // Persistent brute-force throttle (survives restart). Fires before any
  // bcrypt work so attackers can't pin CPU even at the throttle's edge.
  // Skipped for the admin account so CRM access is always recoverable.
  if (!isAdminAuth(req)) {
    try {
      // Scope the throttle to (IP, email) — NOT IP alone. Many legitimate
      // users share one IP (office/campus NAT, mobile carrier CGNAT); keying
      // purely on IP let a handful of unrelated people's typos lock out
      // EVERYONE behind that IP. Per-account keying still stops brute-forcing
      // a single account, while the per-IP loginLimiter above covers spraying.
      const { rows: fl } = await pool.query(
        `SELECT count(*)::int AS c FROM failed_logins
         WHERE ip_address = $1 AND email = $2
           AND created_at > NOW() - INTERVAL '15 minutes'`,
        [ip, email]
      );
      if (fl[0]?.c >= 10) {
        return res.status(429).json({ error: 'Too many failed attempts for this account. Try again in 15 minutes.' });
      }
    } catch (e) {
      console.error('[auth/login] failed_logins precheck error:', e.message);
      // fall through — don't lock everyone out if the table is unreachable
    }
  }

  try {
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const { rows } = await pool.query(
      `SELECT id, email, password_hash, credits, credit_limit, role, banned, package, created_at
         FROM users WHERE email = $1 LIMIT 1`,
      [email]
    );
    const row = rows[0];

    // Run bcrypt.compare even on miss to keep timing roughly constant.
    const dummyHash = '$2a$12$0123456789012345678901uA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5';
    const ok = await bcrypt.compare(password, row?.password_hash || dummyHash);

    if (!row || !ok) {
      // Best-effort log — don't block the response on it.
      pool.query(
        `INSERT INTO failed_logins (email, ip_address, user_agent) VALUES ($1, $2, $3)`,
        [email || null, ip, ua]
      ).catch(() => {});
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    if (row.banned) {
      return res.status(403).json({ error: 'Account is banned.' });
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

    const { password_hash, ...user } = row; // never ship the hash to the client
    res.json({ token, user });
  } catch (err) {
    console.error('[auth/login] error:', err);
    res.status(500).json({ error: 'Login failed.' });
  }
});

// ─── /api/auth/me ──────────────────────────────────────────────────
// Returns the current user based on the JWT. Reads fresh from DB so
// credits/ban/role reflect the latest state, not what was baked into
// the token at login time.
app.get('/api/auth/me', verifyJwt, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, email, credits, credit_limit, role, banned, package, created_at
         FROM users WHERE id = $1`,
      [req.user.id]
    );
    if (!rows[0]) return res.status(401).json({ error: 'Account no longer exists.' });
    res.json({ user: rows[0] });
  } catch (err) {
    console.error('[auth/me] error:', err);
    res.status(500).json({ error: 'Failed to load user.' });
  }
});

// ─── ADMIN: AUDIT MIDDLEWARE ───────────────────────────────────────
// Runs after verifyJwt + requireAdmin. Records the call into admin_audit_log
// BEFORE the route handler runs so even routes that throw still leave a
// trace. Insert is fire-and-forget — we don't block the response on it.
function adminAudit(req, res, next) {
  const targetId = req.params?.id ? parseInt(req.params.id, 10) : null;
  const summary = (req.method === 'POST' && req.body) ? req.body : null;
  pool.query(
    `INSERT INTO admin_audit_log
       (admin_id, admin_email, route, method, target_user_id, payload_summary, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      req.user.id,
      req.user.email,
      req.route?.path || req.originalUrl,
      req.method,
      Number.isFinite(targetId) ? targetId : null,
      summary ? JSON.stringify(summary).slice(0, 2000) : null,
      req.ip,
      req.get('user-agent') || null,
    ]
  ).catch(err => console.error('[admin-audit] insert failed:', err.message));
  next();
}

// One handy gate to apply to every admin route: rate limit, auth, role, audit.
const adminGate = [adminLimiter, verifyJwt, requireAdmin, adminAudit];

// ─── ADMIN: LIST USERS (paginated) ──────────────────────────────────
app.get('/api/admin/users', adminGate, async (req, res) => {
  try {
    const limit  = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const page   = Math.max(parseInt(req.query.page,  10) || 1, 1);
    const offset = (page - 1) * limit;

    const [usersRes, totalRes] = await Promise.all([
      pool.query(
        `SELECT id, email, credits, credit_limit, role, banned, package, created_at, last_login_at, last_login_ip
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
        `SELECT credits, credit_limit FROM users WHERE id = $1 FOR UPDATE`,
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

      const upd = await client.query(
        `UPDATE users SET credits = $1, credit_limit = $2 WHERE id = $3
         RETURNING id, email, credits, credit_limit, role, banned, package`,
        [after, limitAfter, targetId]
      );
      await client.query(
        `INSERT INTO credits_history
           (user_id, amount, action, admin_email, reason, ip_address)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [targetId, delta, action, req.user.email, reason, req.ip]
      );

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
      [targetId, banned ? 'ban' : 'unban', req.user.email, reason, req.ip]
    ).catch(() => {});

    res.json({ user: upd.rows[0] });
  } catch (err) {
    console.error('[admin/ban] error:', err);
    res.status(500).json({ error: 'Ban update failed.' });
  }
});

// ─── ADMIN: USER HISTORY ────────────────────────────────────────────
app.get('/api/admin/users/:id/history', adminGate, async (req, res) => {
  try {
    const targetId = parseInt(req.params.id, 10);
    if (!Number.isFinite(targetId) || targetId <= 0) {
      return res.status(400).json({ error: 'Invalid user id.' });
    }
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
    const { rows } = await pool.query(
      `SELECT id, amount, action, admin_email, reason, ip_address, created_at
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

// ─── ADMIN: STATS ───────────────────────────────────────────────────
// Single round-trip: aggregate stats + last-10 admin logins for the banner.
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
    });
  } catch (err) {
    console.error('[admin/stats] error:', err);
    res.status(500).json({ error: 'Stats fetch failed.' });
  }
});

// ─── HEALTH CHECK ──────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    fal_configured: !!FAL_KEY,
    kie_configured: !!KIE_KEY,
    db_configured: dbReady(),
    auth_configured: !!JWT_SECRET,
  });
});

// ─── STATIC FRONTEND (production / DO buildpack) ──────────────────
// In dev, Vite serves the SPA on :5173 and proxies /api → :3001.
// In prod (DO buildpack or any single-process deploy), Express serves
// the built dist/ for everything that isn't /api/*. Skipped if dist
// doesn't exist (e.g. running just the api locally).
import { existsSync } from 'node:fs';
const DIST_DIR = path.resolve(__dirname, '../../dist');
if (existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR, { maxAge: '1y', index: false }));
  app.get(/^\/(?!api\/).*/, (req, res) => {
    res.sendFile(path.join(DIST_DIR, 'index.html'));
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

migrate()
  .then(startListening)
  .catch((err) => {
    console.error('[voxel-api] continuing despite migration error:', err.message);
    startListening();
  });
