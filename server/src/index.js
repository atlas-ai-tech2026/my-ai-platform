import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { fal } from '@fal-ai/client';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool, isReady as dbReady, migrate, ADMIN_EMAIL } from './db.js';
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
const _envSummary = ['FAL_KEY', 'JWT_SECRET', 'DATABASE_URL', 'PORT', 'NODE_ENV']
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

// Brute-force protection. authLimiter caps login/register to 5 attempts per
// IP per 15 min — combined with the failed_logins DB check inside
// /api/auth/login, that's two independent throttles. adminLimiter is more
// generous (admin UI fires multiple reads per page load) but still capped.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many auth attempts. Try again in 15 minutes.' },
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
  "Nano Banana Pro":   { t2i: "fal-ai/nano-banana-pro",      i2i: "fal-ai/nano-banana-pro",        edit: "fal-ai/nano-banana-pro/edit",  imgParam: "reference_image_url", nativeSizing: true  },
  "Nano Banana 2":     { t2i: "fal-ai/nano-banana-2",        i2i: "fal-ai/nano-banana-2",          edit: "fal-ai/nano-banana-2/edit",    imgParam: "reference_image_url", nativeSizing: true  },
  "Flux Kontext":      { t2i: "fal-ai/flux-pro/kontext",     i2i: "fal-ai/flux-pro/kontext",       edit: "fal-ai/flux-pro/kontext",      imgParam: "image_url",           nativeSizing: false },
  "Flux 2":            { t2i: "fal-ai/flux-pro/v1.1",        i2i: "fal-ai/flux-pro/kontext",       edit: "fal-ai/flux-pro/kontext",      imgParam: "image_url",           nativeSizing: false },
  "Seedream 4.5":      { t2i: "fal-ai/bytedance/seedream-3", i2i: "fal-ai/flux-pro/kontext",       edit: "fal-ai/nano-banana-pro/edit",  imgParam: "image_url",           nativeSizing: false },
  "Seedream 5.0 Lite": { t2i: "fal-ai/bytedance/seedream-3", i2i: "fal-ai/flux-pro/kontext",       edit: "fal-ai/nano-banana-pro/edit",  imgParam: "image_url",           nativeSizing: false },
  "Soul 2.0":          { t2i: "fal-ai/flux/dev",             i2i: "fal-ai/flux-pro/kontext",       edit: "fal-ai/nano-banana-pro/edit",  imgParam: "image_url",           nativeSizing: false },
  "Wan 2.2 Image":     { t2i: "fal-ai/wan-t2i",             i2i: "fal-ai/wan-i2i",                edit: "fal-ai/nano-banana-pro/edit",  imgParam: "image_url",           nativeSizing: false },
  "Skin Enhancer":     { t2i: "fal-ai/aura-sr",             i2i: "fal-ai/aura-sr",                edit: "fal-ai/nano-banana-pro/edit",  imgParam: "image_url",           nativeSizing: false },
  "Face Swap":         { t2i: "fal-ai/face-swap",            i2i: "fal-ai/face-swap",              edit: "fal-ai/nano-banana-pro/edit",  imgParam: "image_url",           nativeSizing: false },
  "Relight":           { t2i: "fal-ai/ic-light",             i2i: "fal-ai/ic-light",               edit: "fal-ai/nano-banana-pro/edit",  imgParam: "image_url",           nativeSizing: false },
  "GPT Image 1.5":     { t2i: "fal-ai/gpt-image-1",         i2i: "fal-ai/gpt-image-1",            edit: "fal-ai/nano-banana-pro/edit",  imgParam: "image_url",           nativeSizing: false },
  "GPT Image 2":       { t2i: "openai/gpt-image-2",         i2i: "openai/gpt-image-2/edit",       edit: "openai/gpt-image-2/edit",      imgParam: "image_url",           nativeSizing: false },
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
  "Kling 3.0":             { t2v: "fal-ai/kling-video/v3/pro/text-to-video",         i2v: "fal-ai/kling-video/v3/pro/image-to-video",         imageParam: "start_image_url", endParam: "end_image_url" },
  // Kling V2.6 uses start_image_url / end_image_url
  "Kling 2.6":             { t2v: "fal-ai/kling-video/v1.6/pro/text-to-video",       i2v: "fal-ai/kling-video/v1.6/pro/image-to-video",       imageParam: "start_image_url", endParam: "end_image_url" },
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
  "Wan 2.6":               { t2v: "fal-ai/wan-t2v",                                  i2v: "fal-ai/wan-i2v",                                   imageParam: "image_url",       endParam: null },
  "Wan 2.2":               { t2v: "fal-ai/wan-t2v",                                  i2v: "fal-ai/wan-i2v",                                   imageParam: "image_url",       endParam: null },
  "Wan 2.1":               { t2v: "fal-ai/wan-t2v",                                  i2v: "fal-ai/wan-i2v",                                   imageParam: "image_url",       endParam: null },
  // Seedance
  "Seedance 1.5 Pro":      { t2v: "fal-ai/bytedance/seedance-1-5-pro-t2v",           i2v: "fal-ai/kling-video/v3/pro/image-to-video",         imageParam: "start_image_url", endParam: "end_image_url" },
  "Seedance 2.0":          { t2v: "bytedance/seedance-2.0/text-to-video",            i2v: "bytedance/seedance-2.0/image-to-video",            ref: "bytedance/seedance-2.0/reference-to-video", imageParam: "image_url", endParam: "end_image_url" },
  "Seedance 2.0 Fast":     { t2v: "bytedance/seedance-2.0/fast/text-to-video",       i2v: "bytedance/seedance-2.0/fast/image-to-video",       ref: "bytedance/seedance-2.0/fast/reference-to-video", imageParam: "image_url", endParam: "end_image_url" },
  "Seedance 1":            { t2v: "fal-ai/bytedance/seedance-1-lite-t2v",            i2v: "fal-ai/kling-video/v3/pro/image-to-video",         imageParam: "start_image_url", endParam: "end_image_url" },
  // Others
  "LTX 2":                 { t2v: "fal-ai/ltx-video-13b-distilled",                  i2v: "fal-ai/kling-video/v3/pro/image-to-video",         imageParam: "start_image_url", endParam: "end_image_url" },
  "Hailuo 2.3":            { t2v: "fal-ai/minimax/video-01",                         i2v: "fal-ai/minimax/video-01",                          imageParam: "image_url",       endParam: null },
  "Hailuo T2V-01":         { t2v: "fal-ai/minimax/video-01",                         i2v: "fal-ai/minimax/video-01",                          imageParam: "image_url",       endParam: null },
  "Hailuo T2V-01 Director":{ t2v: "fal-ai/minimax/video-01-director",                i2v: "fal-ai/minimax/video-01",                          imageParam: "image_url",       endParam: null },
  "PixVerse 5":            { t2v: "fal-ai/pixverse/v4.5/text-to-video",              i2v: "fal-ai/kling-video/v3/pro/image-to-video",         imageParam: "start_image_url", endParam: "end_image_url" },
  "Vidu Q3":               { t2v: "fal-ai/vidu/q1",                                  i2v: "fal-ai/kling-video/v3/pro/image-to-video",         imageParam: "start_image_url", endParam: "end_image_url" },
  "Vidu Q2":               { t2v: "fal-ai/vidu/q1",                                  i2v: "fal-ai/kling-video/v3/pro/image-to-video",         imageParam: "start_image_url", endParam: "end_image_url" },
  "Veo 3":                 { t2v: "fal-ai/veo3",                                     i2v: "fal-ai/kling-video/v3/pro/image-to-video",         imageParam: "start_image_url", endParam: "end_image_url" },
  "Veo 3.1":               { t2v: "fal-ai/veo3",                                     i2v: "fal-ai/kling-video/v3/pro/image-to-video",         imageParam: "start_image_url", endParam: "end_image_url" },
  "Sora 2":                { t2v: "fal-ai/kling-video/v3/pro/text-to-video",         i2v: "fal-ai/kling-video/v3/pro/image-to-video",         imageParam: "start_image_url", endParam: "end_image_url" },
  "Luma Dream Machine":    { t2v: "fal-ai/luma-dream-machine",                       i2v: "fal-ai/luma-dream-machine/image-to-video",         imageParam: "image_url",       endParam: null },
  "Grok Imagine":          { t2v: "fal-ai/kling-video/v3/pro/text-to-video",         i2v: "fal-ai/kling-video/v3/pro/image-to-video",         imageParam: "start_image_url", endParam: "end_image_url" },
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

// ─── GENERATE ENDPOINT ─────────────────────────────────────────────
// Auth + credit gating:
//   1. verifyJwt — must be logged in
//   2. requireNotBanned — banned users immediately blocked (no JWT revocation needed)
//   3. requireFalKey — server must have a FAL key configured
//   4. chargeCredits — atomic balance deduct + history insert; 402 if insufficient
//   5. If FAL call fails → refundCredits so the user isn't billed for nothing
app.post('/api/generate', verifyJwt, requireNotBanned, requireFalKey, async (req, res) => {
  const { model, prompt, type, duration, ratio, imageUrls, negativePrompt, quality, numImages, safetyTolerance } = req.body;

  console.log('=== REQUEST ===', { model, type, imageUrls: (imageUrls || []).length, quality, ratio, numImages, user: req.user?.email });

  if (!model || typeof model !== 'string') return res.status(400).json({ error: 'Invalid model' });
  if (!prompt || typeof prompt !== 'string') return res.status(400).json({ error: 'Prompt required' });
  if (!type || (type !== 'image' && type !== 'video')) return res.status(400).json({ error: 'Type must be image or video' });

  // Charge BEFORE the FAL call so a user can't burn through quota by spamming
  // requests that race past the balance check.
  let chargedKind = null;
  try {
    const charge = await chargeCredits({ userId: req.user.id, kind: type, ip: req.ip });
    chargedKind = type;
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
      const cfg = MODEL_CONFIG[model];
      if (!cfg) return res.status(400).json({ error: 'Unknown image model: ' + model });

      const readyUrls = Array.isArray(imageUrls)
        ? imageUrls.filter(u => u && typeof u === 'string' && u.startsWith('http'))
        : [];
      const hasImages = readyUrls.length > 0;

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

      return res.json({ success: true, type: 'image', result_url: imageUrl, mode });
    }

    // ── VIDEO GENERATION ──
    if (type === 'video') {
      let modelId = VIDEO_MODELS[model];
      if (!modelId) return res.status(400).json({ error: 'Unknown video model: ' + model });

      const readyUrls = Array.isArray(imageUrls)
        ? imageUrls.filter(u => u && typeof u === 'string' && u.startsWith('http'))
        : [];
      const hasFrames = readyUrls.length > 0;

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
    if (chargedKind) {
      refundCredits({
        userId: req.user.id,
        kind: chargedKind,
        ip: req.ip,
        reason: `fal_threw: ${humanReason}`.slice(0, 500),
      }).catch(() => {});
    }

    return res.status(500).json({
      error: 'Generation failed: ' + humanReason,
      details: {
        reason: 'fal_threw',
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

      return res.json({ status: 'COMPLETED', video_url: videoUrl, image_url: imageUrl });
    }

    if (status.status === 'FAILED') {
      return res.json({ status: 'FAILED', error: 'Generation failed. Please try again.' });
    }

    return res.json({ status: status.status, queue_position: status.queue_position || null });

  } catch (error) {
    console.error('Status check error:', error.message);
    return res.status(500).json({ status: 'ERROR', error: 'Could not check status.' });
  }
});

// ─── GENERATE VIDEO (new endpoint with polling) ───────────────────
app.post('/api/generate-video', verifyJwt, requireNotBanned, requireFalKey, async (req, res) => {
  const { model, prompt, image_url, tail_image_url, duration, aspect_ratio } = req.body;

  if (!model) return res.status(400).json({ error: 'model name required' });
  if (!prompt) return res.status(400).json({ error: 'prompt required' });

  // Charge BEFORE submission so we don't enqueue a FAL job we can't bill for.
  let chargedKind = null;
  try {
    const charge = await chargeCredits({ userId: req.user.id, kind: 'video', ip: req.ip });
    chargedKind = 'video';
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

  // Look up the model by name — use EXACT model user selected
  const mapping = VIDEO_DIRECT_MAP[model];
  if (!mapping) {
    console.error(`[VIDEO] Model not supported: "${model}"`);
    return res.status(400).json({ error: `Model not supported: ${model}` });
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
        userId: req.user.id, kind: chargedKind, ip: req.ip,
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
  try {
    const charge = await chargeCredits({ userId: req.user.id, kind: 'video', ip: req.ip });
    chargedKind = 'video';
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

    return res.json({ success: true, job_id: requestId, model_id: falModel, model });
  } catch (error) {
    console.error('[VIDEO-EDIT-OMNI] Error:', error.message);
    if (chargedKind) {
      refundCredits({
        userId: req.user.id, kind: chargedKind, ip: req.ip,
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
  try {
    const charge = await chargeCredits({ userId: req.user.id, kind: 'video', ip: req.ip });
    chargedKind = 'video';
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

    return res.json({ success: true, job_id: requestId, model_id: falModel, model });
  } catch (error) {
    console.error('[MOTION-CONTROL] Error:', error.message);
    if (chargedKind) {
      refundCredits({
        userId: req.user.id, kind: chargedKind, ip: req.ip,
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
        userId: req.user.id, kind: chargedKind, ip: req.ip,
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
        userId: req.user.id, kind: chargedKind, ip: req.ip,
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
app.post('/api/generate-video-ref', verifyJwt, requireNotBanned, requireFalKey, async (req, res) => {
  const { model, prompt, mode, image_urls, video_urls, audio_urls, start_frame, end_frame, duration, aspect_ratio, resolution, generate_audio } = req.body;

  if (!prompt) return res.status(400).json({ error: 'prompt required' });

  const isFast = model === 'Seedance 2.0 Fast';
  const endpointBase = isFast ? 'bytedance/seedance-2.0/fast' : 'bytedance/seedance-2.0';
  // BOTH regular Seedance 2.0 and Fast use image_url / end_image_url
  // for their image-to-video endpoints (verified against FAL schema docs
  // 2026-05). Older code mistakenly sent start_frame/end_frame for the
  // regular variant — FAL silently ignored them and the call failed
  // because the required image_url was missing.
  const frameField    = 'image_url';
  const endFrameField = 'end_image_url';
  const modelLabel = isFast ? 'Seedance 2.0 Fast' : 'Seedance 2.0';

  let chargedKind = null;
  try {
    const charge = await chargeCredits({ userId: req.user.id, kind: 'video', ip: req.ip });
    chargedKind = 'video';
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
        userId: req.user.id, kind: chargedKind, ip: req.ip,
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
        return res.json({ status: 'FAILED', error: 'No video URL in result' });
      }

      return res.json({ status: 'COMPLETED', video_url: videoUrl });
    }

    if (status.status === 'FAILED') {
      return res.json({ status: 'FAILED', error: 'Generation failed' });
    }

    return res.json({
      status: status.status,
      queue_position: status.queue_position || null,
    });
  } catch (error) {
    console.error('[VIDEO-STATUS] ❌ Error checking status:', error.message);
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

app.post('/api/entities/:name/filter', verifyJwt, async (req, res) => {
  if (!dbReady()) return res.status(503).json({ error: 'Database not configured.' });
  try {
    const { query, sort, limit } = req.body || {};
    const params = [req.user.id, req.params.name];
    let where = `user_id = $1 AND name = $2`;
    if (query && typeof query === 'object' && Object.keys(query).length) {
      params.push(JSON.stringify(query));
      where += ` AND data @> $${params.length}::jsonb`;
    }
    params.push(clampLimit(limit));
    const sql = `SELECT * FROM entities WHERE ${where} ${sortClause(sort)} LIMIT $${params.length}`;
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
    const params = [req.user.id, req.params.name, clampLimit(req.query.limit)];
    const sql = `SELECT * FROM entities WHERE user_id = $1 AND name = $2 ${sortClause(req.query.sort)} LIMIT $3`;
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
const NODE_IMAGE_MODELS = {
  'Flux Dev':       'fal-ai/flux/dev',
  'Flux Schnell':   'fal-ai/flux/schnell',
  'Flux Pro Ultra': 'fal-ai/flux-pro/v1.1-ultra',
  'Seedream 4':     'fal-ai/bytedance/seedream/v4/text-to-image',
  'Ideogram v3':    'fal-ai/ideogram/v3',
  'Recraft v3':     'fal-ai/recraft/v3/text-to-image',
  'Nano Banana':    'fal-ai/nano-banana',
};
// Node type → resolver. Each returns the FAL model id for a given settings.
const NODE_RUN_RESOLVERS = {
  'image-generator': (settings) =>
    NODE_IMAGE_MODELS[settings?.model] || NODE_IMAGE_MODELS['Flux Dev'],
};

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
  const resolver = NODE_RUN_RESOLVERS[type];
  if (!resolver) return res.status(400).json({ error: `Unsupported node type: ${type || '(missing)'}` });
  const falModel = resolver(settings);

  const prompt = settings?.prompt;
  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(422).json({ error: 'prompt required' });
  }
  if (prompt.length > 64 * 1024) {
    return res.status(422).json({ error: 'prompt too long (max 64KB)' });
  }

  let chargedKind = null;
  try {
    const charge = await chargeCredits({ userId: req.user.id, kind: 'image', ip: req.ip });
    chargedKind = 'image';
    res.setHeader('X-Credits-Remaining', String(charge.newBalance));
  } catch (e) {
    if (e instanceof InsufficientCreditsError) {
      return res.status(402).json({ error: 'Not enough credits, please contact admin', current_balance: e.balance, required: e.required });
    }
    if (e.code === 'BANNED') return res.status(403).json({ error: 'Account is banned.' });
    console.error('[node:run] charge error:', e.message);
    return res.status(500).json({ error: 'Credit charge failed.' });
  }

  const input = {
    prompt: prompt.trim(),
    image_size: settings?.image_size || 'landscape_16_9',
    num_images: 1,
    enable_safety_checker: true,
  };
  console.log(`[node:run] user=${req.user.id} type=${type} → ${falModel}`);

  try {
    const result = await fal.subscribe(falModel, { input, logs: false });
    const imageUrl = result?.data?.images?.[0]?.url || result?.data?.image?.url || null;
    if (!imageUrl) throw new Error('No image returned by model');
    console.log(`[node:run] ✅ ${imageUrl}`);
    return res.json({ success: true, outputs: { image: imageUrl } });
  } catch (error) {
    console.error('[node:run] FAL error:', error.message);
    if (chargedKind) {
      refundCredits({ userId: req.user.id, kind: chargedKind, ip: req.ip, reason: `node_run_threw: ${error.message}`.slice(0, 500) }).catch(() => {});
    }
    return res.status(500).json({ error: 'Node run failed: ' + (error?.body?.detail || error.message) });
  }
});

// ─── AUTH: REGISTER ─────────────────────────────────────────────────
app.post('/api/auth/register', authLimiter, requireAuthInfra, async (req, res) => {
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
      [user.id, req.ip]
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
// Two independent throttles:
//  1. authLimiter (express-rate-limit, in-memory): 5 requests / 15min / IP.
//  2. failed_logins table check: 5 *failed* attempts / 15min / IP → 429
//     even after the request gets past the in-memory limiter (e.g. after
//     a server restart that reset the in-memory counter).
const ADMIN_JWT_EXPIRES = process.env.ADMIN_JWT_EXPIRES_IN || '30m';

app.post('/api/auth/login', authLimiter, requireAuthInfra, async (req, res) => {
  const ip = req.ip;
  const ua = req.get('user-agent') || null;
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');

  // Persistent brute-force throttle (survives restart). Fires before any
  // bcrypt work so attackers can't pin CPU even at the throttle's edge.
  try {
    const { rows: fl } = await pool.query(
      `SELECT count(*)::int AS c FROM failed_logins
       WHERE ip_address = $1 AND created_at > NOW() - INTERVAL '15 minutes'`,
      [ip]
    );
    if (fl[0]?.c >= 5) {
      return res.status(429).json({ error: 'Too many failed attempts from your IP. Try again in 1 hour.' });
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
      `[voxel-api] listening on :${PORT} — FAL_KEY=${!!FAL_KEY}, db=${dbReady()}, jwt=${!!JWT_SECRET} — entities now in Postgres`
    );
  });
}

migrate()
  .then(startListening)
  .catch((err) => {
    console.error('[voxel-api] continuing despite migration error:', err.message);
    startListening();
  });
