// ─── costing-seed.js ─────────────────────────────────────────────────────────
// The 50 model rows from the costing brief (2026-08-06), extracted
// programmatically from VOXEL_COSTING_FEATURE_SPEC.md rather than retyped —
// these are supplier costs, and a transcription slip would silently move a
// price. Verified against "Voxel Plans & Credits V 1.0".
//
// fal_cost null = KIE is the only supplier for that row (22 of the 50).
//
// NOT the platform's full catalogue: production charges 52 models and this
// covers 20 of them. costing-coverage.js reports the gap so it stays visible
// rather than looking like the whole picture.

export const COSTING_SEED = [
  { sort: 1, category: "image", model_name: "Nano Banana", variant: "Base (T2I)", resolution: "Any", unit: "image", kie_cost: 0.02, fal_cost: 0.039 },
  { sort: 2, category: "image", model_name: "Nano Banana", variant: "Base Edit (I2I)", resolution: "Any", unit: "image", kie_cost: 0.02, fal_cost: 0.039 },
  { sort: 3, category: "image", model_name: "Nano Banana Pro", variant: "Gemini 3 Pro", resolution: "1K / 2K", unit: "image", kie_cost: 0.09, fal_cost: 0.15 },
  { sort: 4, category: "image", model_name: "Nano Banana Pro", variant: "Gemini 3 Pro", resolution: "4K", unit: "image", kie_cost: 0.12, fal_cost: 0.3 },
  { sort: 5, category: "image", model_name: "Nano Banana 2", variant: "Gemini 3 Pro", resolution: "1K", unit: "image", kie_cost: 0.04, fal_cost: 0.15 },
  { sort: 6, category: "image", model_name: "Nano Banana 2", variant: "Gemini 3 Pro", resolution: "2K", unit: "image", kie_cost: 0.06, fal_cost: 0.15 },
  { sort: 7, category: "image", model_name: "Nano Banana 2", variant: "Gemini 3 Pro", resolution: "4K", unit: "image", kie_cost: 0.09, fal_cost: 0.3 },
  { sort: 8, category: "image", model_name: "GPT Image 2", variant: "T2I / I2I", resolution: "1K", unit: "image", kie_cost: 0.03, fal_cost: 0.219 },
  { sort: 9, category: "image", model_name: "GPT Image 2", variant: "T2I / I2I", resolution: "2K", unit: "image", kie_cost: 0.05, fal_cost: 0.234 },
  { sort: 10, category: "image", model_name: "GPT Image 2", variant: "T2I / I2I", resolution: "4K", unit: "image", kie_cost: 0.08, fal_cost: 0.413 },
  { sort: 11, category: "image", model_name: "Imagen 4", variant: "Fast", resolution: "Any", unit: "image", kie_cost: 0.02, fal_cost: 0.04 },
  { sort: 12, category: "image", model_name: "Imagen 4", variant: "Default", resolution: "Any", unit: "image", kie_cost: 0.04, fal_cost: 0.05 },
  { sort: 13, category: "image", model_name: "Imagen 4", variant: "Ultra", resolution: "Any", unit: "image", kie_cost: 0.06, fal_cost: 0.06 },
  { sort: 14, category: "image", model_name: "Seedream 5 Pro", variant: "T/I-to-Image", resolution: "1K", unit: "image", kie_cost: 0.035, fal_cost: null },
  { sort: 15, category: "image", model_name: "Seedream 5 Pro", variant: "T/I-to-Image", resolution: "2K", unit: "image", kie_cost: 0.07, fal_cost: null },
  { sort: 16, category: "image", model_name: "Seedream 5.0 Lite", variant: "T/I-to-Image", resolution: "Any", unit: "image", kie_cost: 0.0275, fal_cost: 0.035 },
  { sort: 17, category: "image", model_name: "Topaz Image Upscale", variant: "Upscale", resolution: "2K", unit: "image", kie_cost: 0.05, fal_cost: 0.08 },
  { sort: 18, category: "image", model_name: "Topaz Image Upscale", variant: "Upscale", resolution: "4K", unit: "image", kie_cost: 0.1, fal_cost: 0.16 },
  { sort: 19, category: "image", model_name: "Topaz Image Upscale", variant: "Upscale", resolution: "8K", unit: "image", kie_cost: 0.2, fal_cost: 0.32 },
  { sort: 20, category: "video_sec", model_name: "Seedance 2.0", variant: "Standard", resolution: "480p", unit: "second", kie_cost: 0.095, fal_cost: 0.1406 },
  { sort: 21, category: "video_sec", model_name: "Seedance 2.0", variant: "Standard", resolution: "720p", unit: "second", kie_cost: 0.205, fal_cost: 0.3024 },
  { sort: 22, category: "video_sec", model_name: "Seedance 2.0", variant: "Standard", resolution: "1080p", unit: "second", kie_cost: 0.51, fal_cost: 0.6804 },
  { sort: 23, category: "video_sec", model_name: "Seedance 2.0", variant: "Standard", resolution: "4K", unit: "second", kie_cost: 1.04, fal_cost: 1.56 },
  { sort: 24, category: "video_sec", model_name: "Seedance 2.0 Fast", variant: "Fast", resolution: "480p", unit: "second", kie_cost: 0.0775, fal_cost: 0.1125 },
  { sort: 25, category: "video_sec", model_name: "Seedance 2.0 Fast", variant: "Fast", resolution: "720p", unit: "second", kie_cost: 0.165, fal_cost: 0.2419 },
  { sort: 26, category: "video_sec", model_name: "Seedance 2.0 Mini", variant: "Mini", resolution: "480p", unit: "second", kie_cost: 0.0475, fal_cost: null },
  { sort: 27, category: "video_sec", model_name: "Seedance 2.0 Mini", variant: "Mini", resolution: "720p", unit: "second", kie_cost: 0.1025, fal_cost: null },
  { sort: 28, category: "video_sec", model_name: "Kling 3.0", variant: "no audio", resolution: "1080p", unit: "second", kie_cost: 0.09, fal_cost: 0.084 },
  { sort: 29, category: "video_sec", model_name: "Kling 3.0", variant: "with audio", resolution: "1080p", unit: "second", kie_cost: 0.135, fal_cost: 0.112 },
  { sort: 30, category: "video_sec", model_name: "Kling 3.0", variant: "audio", resolution: "4K", unit: "second", kie_cost: 0.335, fal_cost: null },
  { sort: 31, category: "video_sec", model_name: "Kling 3.0 Turbo", variant: "T/I-to-Video", resolution: "720p", unit: "second", kie_cost: 0.09, fal_cost: null },
  { sort: 32, category: "video_sec", model_name: "Kling 3.0 Turbo", variant: "T/I-to-Video", resolution: "1080p", unit: "second", kie_cost: 0.1125, fal_cost: null },
  { sort: 33, category: "video_sec", model_name: "Kling AI Avatar", variant: "Lip sync", resolution: "720p", unit: "second", kie_cost: 0.04, fal_cost: null },
  { sort: 34, category: "video_sec", model_name: "Topaz Video Upscale", variant: "1x / 2x", resolution: "-", unit: "second", kie_cost: 0.04, fal_cost: null },
  { sort: 35, category: "video_sec", model_name: "Topaz Video Upscale", variant: "4x", resolution: "-", unit: "second", kie_cost: 0.07, fal_cost: null },
  { sort: 36, category: "video_clip", model_name: "Veo 3.1", variant: "Quality", resolution: "720p", unit: "video", kie_cost: 1.25, fal_cost: null },
  { sort: 37, category: "video_clip", model_name: "Veo 3.1", variant: "Quality", resolution: "1080p", unit: "video", kie_cost: 1.275, fal_cost: null },
  { sort: 38, category: "video_clip", model_name: "Veo 3.1", variant: "Quality", resolution: "4K", unit: "video", kie_cost: 1.85, fal_cost: null },
  { sort: 39, category: "video_clip", model_name: "Veo 3.1", variant: "Fast", resolution: "720p", unit: "video", kie_cost: 0.3, fal_cost: null },
  { sort: 40, category: "video_clip", model_name: "Veo 3.1", variant: "Fast", resolution: "1080p", unit: "video", kie_cost: 0.325, fal_cost: null },
  { sort: 41, category: "video_clip", model_name: "Veo 3.1", variant: "Lite", resolution: "720p", unit: "video", kie_cost: 0.15, fal_cost: null },
  { sort: 42, category: "video_clip", model_name: "Gemini Omni", variant: "6s clip", resolution: "720p / 1080p", unit: "video", kie_cost: 0.42, fal_cost: null },
  { sort: 43, category: "video_clip", model_name: "Gemini Omni", variant: "6s clip", resolution: "4K", unit: "video", kie_cost: 0.84, fal_cost: null },
  { sort: 44, category: "video_clip", model_name: "Kling 2.6", variant: "5s, no audio", resolution: "-", unit: "video", kie_cost: 0.275, fal_cost: null },
  { sort: 45, category: "video_clip", model_name: "Kling 2.6", variant: "5s, with audio", resolution: "-", unit: "video", kie_cost: 0.55, fal_cost: null },
  { sort: 46, category: "video_clip", model_name: "Kling 2.5 Turbo Pro", variant: "5s clip", resolution: "-", unit: "video", kie_cost: 0.21, fal_cost: null },
  { sort: 47, category: "video_clip", model_name: "Kling 2.5 Turbo Pro", variant: "10s clip", resolution: "-", unit: "video", kie_cost: 0.42, fal_cost: null },
  { sort: 48, category: "voice", model_name: "ElevenLabs TTS", variant: "Multilingual v2", resolution: "-", unit: "1,000 chars", kie_cost: 0.06, fal_cost: 0.1 },
  { sort: 49, category: "voice", model_name: "ElevenLabs TTS", variant: "Turbo v2.5", resolution: "-", unit: "1,000 chars", kie_cost: 0.03, fal_cost: 0.05 },
  { sort: 50, category: "voice", model_name: "ElevenLabs V3", variant: "Text-to-Dialogue", resolution: "-", unit: "1,000 chars", kie_cost: 0.07, fal_cost: 0.1 },
];

export const SEED_SETTINGS = {
  margin_target: 0.40,
  // The $19 / 300-credit anchor. Kept as a fraction so it is exact rather than
  // a rounded decimal that would drift the whole table.
  credit_value: 19 / 300,
};

export const SEED_PLANS = [
  { name: 'Micro',   price_usd: 5,   sort_order: 1 },
  { name: 'Starter', price_usd: 10,  sort_order: 2 },
  { name: 'Basic',   price_usd: 19,  sort_order: 3 },
  { name: 'Plus',    price_usd: 59,  sort_order: 4 },
  { name: 'Pro',     price_usd: 95,  sort_order: 5 },
  { name: 'Max',     price_usd: 129, sort_order: 6 },
];
