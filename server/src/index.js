import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { fal } from '@fal-ai/client';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool, isReady as dbReady, migrate, ADMIN_EMAIL } from './db.js';
import { verifyJwt, requireAdmin, requireNotBanned } from './middleware/auth.js';
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
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

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
  "Kling Motion Control":  "fal-ai/kling-video/v1.6/pro/text-to-video",
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
  "Kling Motion Control":  { t2v: "fal-ai/kling-video/v1.6/pro/text-to-video",       i2v: "fal-ai/kling-video/v1.6/pro/image-to-video",       imageParam: "image_url",       endParam: "tail_image_url" },
  // Wan uses image_url
  "Wan 2.6":               { t2v: "fal-ai/wan-t2v",                                  i2v: "fal-ai/wan-i2v",                                   imageParam: "image_url",       endParam: null },
  "Wan 2.2":               { t2v: "fal-ai/wan-t2v",                                  i2v: "fal-ai/wan-i2v",                                   imageParam: "image_url",       endParam: null },
  "Wan 2.1":               { t2v: "fal-ai/wan-t2v",                                  i2v: "fal-ai/wan-i2v",                                   imageParam: "image_url",       endParam: null },
  // Seedance
  "Seedance 1.5 Pro":      { t2v: "fal-ai/bytedance/seedance-1-5-pro-t2v",           i2v: "fal-ai/kling-video/v3/pro/image-to-video",         imageParam: "start_image_url", endParam: "end_image_url" },
  "Seedance 2.0":          { t2v: "bytedance/seedance-2.0/text-to-video",            i2v: "bytedance/seedance-2.0/image-to-video",            ref: "bytedance/seedance-2.0/reference-to-video", imageParam: "start_frame", endParam: "end_frame" },
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

// ─── SEEDANCE 2.0 SMART ROUTING ──────────────────────────────────
// Routes to the correct Seedance 2.0 endpoint based on image roles:
//   - No images → text-to-video
//   - Images as reference → reference-to-video (image_urls[])
//   - Image as start/end frame → image-to-video (start_frame, end_frame)
app.post('/api/generate-video-ref', verifyJwt, requireNotBanned, requireFalKey, async (req, res) => {
  const { prompt, mode, image_urls, video_urls, audio_urls, start_frame, end_frame, duration, aspect_ratio, resolution, generate_audio } = req.body;

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
    falModel = 'bytedance/seedance-2.0/image-to-video';
    if (hasStartFrame) input.start_frame = start_frame;
    if (hasEndFrame) input.end_frame = end_frame;
    console.log(`[SEEDANCE] Mode: image-to-video (start: ${hasStartFrame}, end: ${hasEndFrame})`);
  } else if (mode === 'reference' || hasRefImages || hasRefVideos || hasRefAudios) {
    // Reference-to-video mode
    falModel = 'bytedance/seedance-2.0/reference-to-video';
    if (hasRefImages) input.image_urls = image_urls;
    if (hasRefVideos) input.video_urls = video_urls;
    if (hasRefAudios) input.audio_urls = audio_urls;
    console.log(`[SEEDANCE] Mode: reference-to-video (images: ${(image_urls||[]).length}, videos: ${(video_urls||[]).length}, audio: ${(audio_urls||[]).length})`);
  } else {
    // Text-to-video mode (no images)
    falModel = 'bytedance/seedance-2.0/text-to-video';
    console.log(`[SEEDANCE] Mode: text-to-video (no images)`);
  }

  console.log('[SEEDANCE] FAL Model:', falModel);
  console.log('[SEEDANCE] Payload:', JSON.stringify(input, null, 2));

  try {
    const submitted = await fal.queue.submit(falModel, { input });
    console.log(`[SEEDANCE] ✅ Submitted, request_id: ${submitted.request_id}`);

    return res.json({
      success: true,
      job_id: submitted.request_id,
      model_id: falModel,
      model: 'Seedance 2.0',
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
app.post('/api/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided' });
  try {
    // Use Node.js compatible File/Blob for FAL upload
    const file = new File([req.file.buffer], req.file.originalname, { type: req.file.mimetype });
    console.log('[UPLOAD] Uploading to FAL:', req.file.originalname, req.file.size, 'bytes');
    const url = await fal.storage.upload(file);
    console.log('[UPLOAD] ✅ FAL URL:', url);
    res.json({ url });
  } catch (error) {
    console.error('[UPLOAD] ❌ Error:', error.message, error.stack?.split('\n')[1]);
    // Fallback: try with Blob if File fails
    try {
      const blob = new Blob([req.file.buffer], { type: req.file.mimetype });
      const url = await fal.storage.upload(blob);
      console.log('[UPLOAD] ✅ FAL URL (blob fallback):', url);
      res.json({ url });
    } catch (e2) {
      console.error('[UPLOAD] ❌ Blob fallback also failed:', e2.message);
      res.status(500).json({ error: 'Upload failed: ' + error.message });
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

// ─── ENTITY CRUD (JSON-backed write-through store) ────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../data');
const DATA_FILE = path.join(DATA_DIR, 'entities.json');
let entityStore = {};
let flushTimer = null;

async function loadStore() {
  try {
    const raw = await readFile(DATA_FILE, 'utf8');
    entityStore = JSON.parse(raw);
  } catch {
    entityStore = {};
  }
}

function scheduleFlush() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(async () => {
    try {
      await mkdir(DATA_DIR, { recursive: true });
      await writeFile(DATA_FILE, JSON.stringify(entityStore, null, 2));
    } catch (e) {
      console.error('[entity-store] flush failed:', e);
    }
  }, 250);
}

await loadStore();

function getStore(name) {
  if (!entityStore[name]) entityStore[name] = [];
  return entityStore[name];
}

// ─── ENTITY STORE — PER-USER ISOLATION ─────────────────────────────
// Every entity is owned by exactly one user (req.user.id). All four
// routes require a valid JWT and only ever touch rows where
// `user_id === req.user.id`. Pre-existing rows without `user_id` (from
// before this gating was added) are invisible to every user — they sit
// orphaned on disk until manually cleaned up.
//
// On PUT/DELETE we deliberately return 404 (not 403) when the row exists
// but belongs to someone else, so the API doesn't leak that another
// user's record with that ID exists.

app.post('/api/entities/:name/filter', verifyJwt, (req, res) => {
  const { query, sort, limit } = req.body;
  const userId = req.user.id;
  let items = getStore(req.params.name).filter(i => i.user_id === userId);
  if (query) {
    items = items.filter(item => Object.entries(query).every(([k, v]) => item[k] === v));
  }
  if (sort) {
    const desc = sort.startsWith('-');
    const field = desc ? sort.slice(1) : sort;
    items.sort((a, b) => {
      const av = a[field] || 0, bv = b[field] || 0;
      return desc ? (bv > av ? 1 : -1) : (av > bv ? 1 : -1);
    });
  }
  res.json(limit ? items.slice(0, limit) : items);
});

app.get('/api/entities/:name', verifyJwt, (req, res) => {
  const { sort, limit } = req.query;
  const userId = req.user.id;
  let items = getStore(req.params.name).filter(i => i.user_id === userId);
  if (sort) {
    const desc = sort.startsWith('-');
    const field = desc ? sort.slice(1) : sort;
    items = [...items].sort((a, b) => {
      const av = a[field] || '', bv = b[field] || '';
      return desc ? (bv > av ? 1 : -1) : (av > bv ? 1 : -1);
    });
  }
  res.json(limit ? items.slice(0, Number(limit)) : items);
});

app.post('/api/entities/:name', verifyJwt, (req, res) => {
  const store = getStore(req.params.name);
  // Strip any client-supplied user_id from the body before stamping the
  // server-side one, so a malicious client can't masquerade as another
  // user by sending `{user_id: 99, ...}`.
  const { user_id: _ignored, ...body } = req.body || {};
  const item = {
    ...body,
    id: crypto.randomUUID(),
    user_id: req.user.id,
    created_date: new Date().toISOString(),
    updated_date: new Date().toISOString(),
  };
  store.unshift(item);
  scheduleFlush();
  res.json(item);
});

app.put('/api/entities/:name/:id', verifyJwt, (req, res) => {
  const store = getStore(req.params.name);
  const idx = store.findIndex(i => i.id === req.params.id);
  if (idx === -1 || store[idx].user_id !== req.user.id) {
    return res.status(404).json({ error: 'Not found' });
  }
  // user_id is immutable from the client side.
  const { user_id: _ignored, ...body } = req.body || {};
  store[idx] = { ...store[idx], ...body, updated_date: new Date().toISOString() };
  scheduleFlush();
  res.json(store[idx]);
});

app.delete('/api/entities/:name/:id', verifyJwt, (req, res) => {
  const store = getStore(req.params.name);
  const idx = store.findIndex(i => i.id === req.params.id);
  if (idx === -1 || store[idx].user_id !== req.user.id) {
    return res.status(404).json({ error: 'Not found' });
  }
  store.splice(idx, 1);
  scheduleFlush();
  res.json({ success: true });
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
         RETURNING id, email, credits, role, banned, package, created_at`,
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
      `SELECT id, email, password_hash, credits, role, banned, package, created_at
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
      `SELECT id, email, credits, role, banned, package, created_at
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
        `SELECT id, email, credits, role, banned, package, created_at, last_login_at, last_login_ip
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
      `SELECT id, email, credits, role, banned, package, created_at, last_login_at
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
        `SELECT credits FROM users WHERE id = $1 FOR UPDATE`,
        [targetId]
      );
      if (cur.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'User not found.' });
      }
      const before = Number(cur.rows[0].credits);

      let after;
      if (action === 'grant')  after = before + amount;
      if (action === 'revoke') after = Math.max(0, before - amount);
      if (action === 'set')    after = amount;
      const delta = Number((after - before).toFixed(2));

      const upd = await client.query(
        `UPDATE users SET credits = $1 WHERE id = $2
         RETURNING id, email, credits, role, banned, package`,
        [after, targetId]
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
       RETURNING id, email, credits, role, banned, package`,
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
    const entityCount = Object.values(entityStore).reduce((n, arr) => n + (Array.isArray(arr) ? arr.length : 0), 0);
    console.log(
      `[voxel-api] listening on :${PORT} — FAL_KEY=${!!FAL_KEY}, db=${dbReady()}, jwt=${!!JWT_SECRET}, entities=${entityCount}`
    );
  });
}

migrate()
  .then(startListening)
  .catch((err) => {
    console.error('[voxel-api] continuing despite migration error:', err.message);
    startListening();
  });
