import { fal } from "npm:@fal-ai/client@^1";
import { createClientFromRequest } from "npm:@base44/sdk@0.8.23";

const MODEL_CONFIG = {
  "Nano Banana Pro":   { t2i: "fal-ai/nano-banana-pro",          i2i: "fal-ai/nano-banana-pro",        imgParam: "reference_image_url", nativeSizing: true  },
  "Nano Banana 2":     { t2i: "fal-ai/nano-banana-2",            i2i: "fal-ai/nano-banana-2",          imgParam: "reference_image_url", nativeSizing: true  },
  "Flux Kontext":      { t2i: "fal-ai/flux-pro/kontext",          i2i: "fal-ai/flux-pro/kontext",       imgParam: "image_url",           nativeSizing: false },
  "Flux 2":            { t2i: "fal-ai/flux-pro/v1.1",             i2i: "fal-ai/flux-pro/kontext",       imgParam: "image_url",           nativeSizing: false },
  "Seedream 4.5":      { t2i: "fal-ai/bytedance/seedream-3",     i2i: "fal-ai/flux-pro/kontext",       imgParam: "image_url",           nativeSizing: false },
  "Seedream 5.0 Lite": { t2i: "fal-ai/bytedance/seedream-3",     i2i: "fal-ai/flux-pro/kontext",       imgParam: "image_url",           nativeSizing: false },
  "Soul 2.0":          { t2i: "fal-ai/flux/dev",                  i2i: "fal-ai/flux-pro/kontext",       imgParam: "image_url",           nativeSizing: false },
  "Wan 2.2 Image":     { t2i: "fal-ai/wan-t2i",                  i2i: "fal-ai/wan-i2i",                imgParam: "image_url",           nativeSizing: false },
  "Skin Enhancer":     { t2i: "fal-ai/aura-sr",                  i2i: "fal-ai/aura-sr",                imgParam: "image_url",           nativeSizing: false },
  "Face Swap":         { t2i: "fal-ai/face-swap",                 i2i: "fal-ai/face-swap",              imgParam: "image_url",           nativeSizing: false },
  "Relight":           { t2i: "fal-ai/ic-light",                  i2i: "fal-ai/ic-light",               imgParam: "image_url",           nativeSizing: false },
  "GPT Image 1.5":     { t2i: "fal-ai/gpt-image-1",              i2i: "fal-ai/gpt-image-1",            imgParam: "image_url",           nativeSizing: false },
};

const VIDEO_MODELS = {
  "Kling 3.0 Omni":        "fal-ai/kling-video/v2.1/pro/text-to-video",
  "Kling 3.0":             "fal-ai/kling-video/v2.1/standard/text-to-video",
  "Kling 2.6":             "fal-ai/kling-video/v1.6/pro/text-to-video",
  "Kling 2.5":             "fal-ai/kling-video/v1.5/pro/text-to-video",
  "Kling 2.1":             "fal-ai/kling-video/v1/pro/text-to-video",
  "Kling O1":              "fal-ai/kling-video/v1.6/pro/text-to-video",
  "Kling Motion Control":  "fal-ai/kling-video/v1.6/pro/text-to-video",
  "Wan 2.6":               "fal-ai/wan-i2v",
  "Wan 2.2":               "fal-ai/wan-t2v",
  "Seedance 1.5 Pro":      "fal-ai/bytedance/seedance-1-5-pro-t2v",
  "Seedance 2.0":          "fal-ai/bytedance/seedance-1-5-pro-t2v",
  "Seedance 1":            "fal-ai/bytedance/seedance-1-lite-t2v",
  "LTX 2":                 "fal-ai/ltx-video-13b-distilled",
  "Hailuo 2.3":            "fal-ai/minimax/video-01-live",
  "PixVerse 5":            "fal-ai/pixverse/v4.5/text-to-video",
  "Vidu Q3":               "fal-ai/vidu/q1",
  "Vidu Q2":               "fal-ai/vidu/q1",
  "Veo 3.1":               "fal-ai/veo2",
  "Sora 2":                "fal-ai/sora",
  "Nano Banana Pro Video": "fal-ai/kling-video/v1.6/pro/text-to-video",
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

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  // CHECK FAL_KEY
  const falKey = (Deno.env.get("FAL_KEY") || "").trim();
  if (!falKey) {
    console.error("FAL_KEY is not set in environment variables");
    return Response.json({ error: "FAL_KEY not configured" }, { status: 500 });
  }
  fal.config({ credentials: falKey });

  const body = await req.json();
  const { model, prompt, type, duration, ratio, imageUrls, negativePrompt } = body;

  if (!model || typeof model !== "string") return Response.json({ error: "Invalid model" }, { status: 400 });
  if (!prompt || typeof prompt !== "string") return Response.json({ error: "Prompt required" }, { status: 400 });
  if (!type || (type !== "image" && type !== "video")) return Response.json({ error: "Type must be image or video" }, { status: 400 });

  try {
    // ── IMAGE GENERATION ──
    if (type === "image") {
      const cfg = MODEL_CONFIG[model];
      if (!cfg) return Response.json({ error: "Unknown image model: " + model }, { status: 400 });

      const readyUrls = Array.isArray(imageUrls)
        ? imageUrls.filter(u => u && typeof u === "string" && u.startsWith("http"))
        : [];
      const hasImages = readyUrls.length > 0;
      const falModelId = hasImages ? cfg.i2i : cfg.t2i;

      console.log("=== IMAGE GENERATION ===");
      console.log("Model:", model, "→", falModelId);
      console.log("Mode:", hasImages ? "image-to-image" : "text-to-image");
      console.log("Images:", readyUrls.length);

      const { width, height } = getDimensions(ratio, body.quality);
      const input = {
        prompt,
        ...(negativePrompt ? { negative_prompt: negativePrompt } : {}),
        ...(cfg.nativeSizing
          ? { aspect_ratio: ratio || "16:9", resolution: RESOLUTION_MAP[body.quality] || "1K" }
          : (hasImages ? {} : { image_size: { width, height } })
        ),
        ...(hasImages ? { [cfg.imgParam]: readyUrls[0] } : {}),
      };

      console.log("Input keys:", Object.keys(input));

      const result = await fal.subscribe(falModelId, { input, logs: false });

      const imageUrl =
        result?.data?.images?.[0]?.url ||
        result?.data?.image?.url ||
        result?.images?.[0]?.url ||
        result?.image?.url ||
        null;

      if (!imageUrl) {
        console.error("No image URL in result:", JSON.stringify(result));
        return Response.json({ error: "No image returned. Please try again." }, { status: 500 });
      }

      return Response.json({ success: true, type: "image", result_url: imageUrl, mode: hasImages ? "image-to-image" : "text-to-image" });
    }

    // ── VIDEO GENERATION ──
    if (type === "video") {
      const modelId = VIDEO_MODELS[model];
      if (!modelId) return Response.json({ error: "Unknown video model: " + model }, { status: 400 });

      const input = {
        prompt,
        duration: String(duration || 5),
        aspect_ratio: ratio || "16:9",
        ...(negativePrompt ? { negative_prompt: negativePrompt } : {}),
      };

      const submitted = await fal.queue.submit(modelId, { input });
      return Response.json({ success: true, type: "video", job_id: submitted.request_id, model_id: modelId });
    }

    return Response.json({ error: "Unsupported type" }, { status: 400 });

  } catch (error) {
    console.error("=== GENERATION ERROR ===");
    console.error("Model:", model);
    console.error("Error message:", error.message);
    console.error("Error body:", error.body ? JSON.stringify(error.body) : "none");
    console.error("========================");
    return Response.json({ error: "Generation failed: " + error.message }, { status: 500 });
  }
});