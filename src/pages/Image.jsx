import React, { useState, useRef, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { useHistoryFeed, useOnVisible } from '@/lib/history-feed';
const History_ = base44.entities.GenerationHistory;
import ImagePromptBar from '@/components/image/ImagePromptBar';
import { buildCompositionPrompt, detectCompositionIntent } from '@/lib/enhancePrompt';
import { uploadAllToFal } from '@/lib/uploadToFal';
import { getImageCredits } from '@/lib/creditPricing';
import { downloadViaApi } from '@/lib/downloadFile';
import { waitForImage, waitedLabel } from '@/lib/wait-for-image';
import HistoryFilterBar, { EMPTY as EMPTY_FILTER, toQuery, isFiltering } from '@/components/history/HistoryFilterBar';

const STYLE_SUFFIXES = {
  Cinematic:    ', cinematic color grading, anamorphic lens flare, film grain, dramatic lighting, movie still',
  Realistic:    ', ultra photorealistic, hyperrealistic, 8K detail, photographic quality, natural lighting',
  Anime:        ', anime style, japanese animation, bold outlines, cel shading, vibrant colors',
  '3D':         ', 3D render, Unreal Engine 5, volumetric lighting, ray tracing, CGI, octane render',
  '2D':         ', 2D flat art, clean shapes, vector style, flat design',
  Illustration: ', detailed illustration, hand-drawn, artistic, ink and watercolor',
  Pixar:        ', Pixar CGI style, warm expressive lighting, 3D animated, Disney Pixar render',
  Cartoon:      ', cartoon style, bold outlines, vibrant saturated colors, exaggerated features',
};
import TemplateModal from '@/components/common/TemplateModal';
import ImageDetailModal from '@/components/image/ImageDetailModal';
import { History, Globe, Heart, Download, RefreshCw, Maximize2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';

const MODEL_SUBTITLES = {
  'Nano Banana Pro': 'Create stunning, high-aesthetic images in seconds',
  'Nano Banana 2': 'Pro-level quality at Flash speed',
  'Soul 2.0': 'Fashion-forward portraits with cultural fluency',
  'Seedream 5.0 Lite': 'Intelligent visual reasoning — unlimited access',
  'Seedream 4.5': 'Next-gen 4K photorealistic detail',
  'GPT Image 2': "OpenAI's next-gen alpha — 4K with reference editing",
  'GPT Image 1.5': 'True-color precision rendering by OpenAI',
  'Flux Kontext': 'Stylistic diversity for any aesthetic',
  'Flux 2': 'Strong prompt adherence at high speed',
  'Wan 2.2 Image': 'Artistic and illustrated visual creation',
  'Skin Enhancer': 'Natural realistic skin texture enhancement',
  'Face Swap': 'Seamless instant face replacement',
  'Relight': 'Change the light, change the mood',
  'GPT-4o Image': 'Strong prompt-following with crisp text rendering',
  'Flux Kontext Max': "BFL's best-in-class editing and consistency",
  'Midjourney': 'The Midjourney aesthetic — 4 variations per run',
};

const RESULT_GRADIENTS = [
'linear-gradient(135deg, #1a0000 0%, #8B0000 50%, #1a1a1a 100%)',
'linear-gradient(135deg, #0a0a1a 0%, #1a0a2a 50%, #2a0a0a 100%)',
'linear-gradient(135deg, #0d0d0d 0%, #2a0000 60%, #111 100%)',
'linear-gradient(135deg, #1a1a0a 0%, #3a1a00 50%, #0a0a0a 100%)',
'linear-gradient(135deg, #0a1a0a 0%, #0a3a1a 50%, #0a0a0a 100%)',
'linear-gradient(135deg, #1a1a2a 0%, #0a0a3a 50%, #2a1a1a 100%)'];


// Varied heights for masonry feel
const HEIGHTS = [220, 280, 240, 320, 200, 260, 300, 220, 250, 270];

const font = '"DM Sans", sans-serif';

// ─────────────────────────────────────────────────────────────────────────────
// Backend-only prompt injection.
//
// This is the ONLY place camera selections are merged into the prompt.
// It runs at the API boundary — the user's textarea state (`prompt`) and the
// on-screen "INJECTING:" bar are never modified by this function.
//
// Every field is optional. If the user selects nothing, `userPrompt` is
// returned unchanged.
// ─────────────────────────────────────────────────────────────────────────────
function buildFinalPrompt(userPrompt, cameraState) {
  const parts = [userPrompt.trim()];

  if (cameraState?.camera) {
    parts.push(cameraState.camera.tag);
  }

  if (cameraState?.lens) {
    parts.push(cameraState.lens.name + ' lens');
    if (cameraState.lens.type === 'anamorphic') {
      parts.push('anamorphic lens, oval bokeh, horizontal lens flares, 2.39:1 widescreen');
    }
  }

  if (cameraState?.focalLength) {
    parts.push(cameraState.focalLength + ' focal length');
  }

  if (cameraState?.fstop) {
    parts.push(cameraState.fstop + ' aperture');
  }

  return parts.join(', ');
}

// Loading card component — red-glow treatment per VOXEL_IMAGE_PAGE_SPEC §A1.5
// Replaces the previous shimmer-gradient with a translucent red-bordered
// card, blurred radial blob, ✦ glyph, and a "RENDERING N%" mono caption.
function LoadingCard({ index = 0 }) {
  const [pct, setPct] = useState(0);
  const intervalRef = useRef(null);

  useEffect(() => {
    let tick = 0;
    const total = 3000 / 80;
    intervalRef.current = setInterval(() => {
      tick++;
      setPct(Math.min(Math.round(tick / total * 100), 97));
    }, 80);
    return () => clearInterval(intervalRef.current);
  }, []);

  return (
    <div style={{
      borderRadius: 12, border: '1px solid #E01E1E',
      overflow: 'hidden', background: 'rgba(20,10,10,0.6)',
      backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
      display: 'flex', flexDirection: 'column', width: '100%', aspectRatio: '1 / 1',
      position: 'relative',
      boxShadow: '0 0 30px rgba(224,30,30,0.35), 0 12px 36px rgba(0,0,0,0.5)',
    }}>
      {/* Red glow blob + ✦ glyph centered */}
      <div style={{
        flex: 1, position: 'relative',
        background: 'linear-gradient(135deg,rgba(224,30,30,0.2),rgba(139,15,15,0.4))',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{
          width: 40, height: 40, borderRadius: '50%',
          background: 'radial-gradient(circle, #FF2A2A, transparent)',
          filter: 'blur(8px)', opacity: 0.8,
        }} />
        <div style={{
          position: 'absolute', fontSize: 20, color: '#FFF',
          animation: 'imgSpin 1.5s linear infinite',
          willChange: 'transform',
        }}>✦</div>
      </div>
      {/* Footer: RENDERING N% in JetBrains Mono red, 2px progress bar */}
      <div style={{ padding: '10px 12px' }}>
        <div style={{
          fontSize: 10, color: '#E01E1E', fontWeight: 700,
          fontFamily: '"JetBrains Mono", monospace', marginBottom: 5,
          letterSpacing: '0.1em', textTransform: 'uppercase',
        }}>Rendering {pct}%</div>
        <div style={{ height: 2, background: 'rgba(255,255,255,0.1)', borderRadius: 999 }}>
          <div style={{
            height: '100%', width: `${pct}%`,
            background: '#E01E1E', borderRadius: 999,
            boxShadow: '0 0 10px #E01E1E',
            transition: 'width 0.12s ease',
          }} />
        </div>
      </div>
    </div>);

}

// Single image card — polished per VOXEL_IMAGE_PAGE_SPEC §A1.3-A1.4.
// Hairline white border, radius 12, deep shadow, faint inner radial
// highlight overlay, optional NEW MODEL pill on the first card when the
// selected model carries a NEW badge.
function ImageCard({ img, index, onExpand, onLoaded, isFirst = false, modelBadge = null }) {
  const [hovered, setHovered] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const h = HEIGHTS[index % HEIGHTS.length];
  const showShimmer = img.url && !imgLoaded;

  return (
    <div
      style={{
        borderRadius: 12, overflow: 'hidden',
        background: img.gradient, cursor: 'pointer',
        position: 'relative', width: '100%', aspectRatio: '1 / 1',
        border: '1px solid rgba(255,255,255,0.06)',
        boxShadow: '0 12px 36px rgba(0,0,0,0.5)',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => imgLoaded && onExpand(img)}>

      {/* Faint inner radial highlight overlay — adds dimension without noise */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 1,
        background: 'radial-gradient(ellipse at 30% 70%, rgba(255,255,255,0.18), transparent 55%)',
      }} />

      {/* NEW MODEL pill on first card when the selected model has badge='NEW' */}
      {isFirst && modelBadge === 'NEW' && (
        <div style={{
          position: 'absolute', top: 10, left: 10, zIndex: 3,
          padding: '4px 9px', borderRadius: 4,
          background: '#E01E1E', fontSize: 9, fontWeight: 800,
          letterSpacing: '0.1em', textTransform: 'uppercase',
          fontFamily: '"DM Sans", sans-serif', color: '#FFF',
        }}>NEW MODEL</div>
      )}

      {/* loading="lazy": cells download only when they approach the screen.
          Without it, every loaded page's FULL-SIZE originals fetched eagerly
          and the first visible row queued behind hundreds of off-screen
          files — half of the "history takes forever" report (#75). */}
      {img.url && (
        <img
          // Thumbnail first, original as the fallback. A cell is 7.5 MB
          // without this and about 8 KB with it — measured on a real account:
          // 349 images totalling 2,500.9 MB, none under 60 KB, all drawn at
          // 160×96. The full file is still what opens when it is clicked.
          src={img.thumbUrl || img.url}
          alt={img.prompt}
          loading="lazy"
          decoding="async"
          onLoad={() => { setImgLoaded(true); onLoaded && onLoaded(img.id); }}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: imgLoaded ? 1 : 0, transition: 'opacity 0.3s' }}
        />
      )}

      {/* Shimmer while loading */}
      {showShimmer && (
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, #1a0000 0%, #2a0a0a 50%, #1a1a1a 100%)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, transparent 0%, rgba(224,30,30,0.08) 50%, transparent 100%)', backgroundSize: '200% 100%', animation: 'imgShimmer 1.6s linear infinite' }} />
          <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(224,30,30,0.12)', border: '1px solid rgba(224,30,30,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'imgSpin 1.8s linear infinite' }}>
            <Sparkles style={{ width: 18, height: 18, color: '#FF4444' }} />
          </div>
        </div>
      )}

      {/* Hover overlay — floating glass icons, no dark bar */}
      {imgLoaded && (
        <div
          style={{
            position: 'absolute', inset: 0,
            background: hovered
              ? 'linear-gradient(to top, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.08) 25%, transparent 45%)'
              : 'transparent',
            opacity: hovered ? 1 : 0,
            transition: 'opacity 0.18s ease, background 0.18s ease',
            display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end',
            padding: 10, gap: 6,
            pointerEvents: hovered ? 'auto' : 'none',
          }}
        >
          {[Heart, RefreshCw, Maximize2].map((Icon, i) =>
            <div key={i} style={{
              width: 30, height: 30, borderRadius: 999,
              background: 'rgba(255,255,255,0.12)',
              backdropFilter: 'blur(14px) saturate(160%)',
              WebkitBackdropFilter: 'blur(14px) saturate(160%)',
              border: '1px solid rgba(255,255,255,0.18)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', pointerEvents: 'none',
              boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
            }}>
              <Icon style={{ width: 13, height: 13 }} />
            </div>
          )}
          <a
            href="#download"
            onClick={e => {
              e.preventDefault();
              e.stopPropagation();
              downloadViaApi(img.url, `voxel-${(img.prompt || 'image').slice(0,30).replace(/[^a-zA-Z0-9]/g,'-')}.png`);
            }}
            style={{
              width: 30, height: 30, borderRadius: 999,
              background: 'rgba(255,255,255,0.12)',
              backdropFilter: 'blur(14px) saturate(160%)',
              WebkitBackdropFilter: 'blur(14px) saturate(160%)',
              border: '1px solid rgba(255,255,255,0.18)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', textDecoration: 'none',
              boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
            }}>
            <Download style={{ width: 13, height: 13 }} />
          </a>
        </div>
      )}
    </div>);

}

export default function Image() {
  const { user, isAuthenticated, isLoadingAuth, openAuthModal, refresh: refreshAuth } = useAuth();
  const [selectedModel, setSelectedModel] = useState({ id: 'nano-pro', name: 'Nano Banana Pro' });
  const [prompt, setPrompt] = useState('');
  // Number of images currently being generated across ALL in-flight batches.
  // A counter (not a boolean lock) lets the user fire several generations
  // back-to-back without the button locking — each batch charges credits
  // independently and the grid shows one loading card per pending image.
  const [pending, setPending] = useState(0);
  // Shown while an image the server handed off is still finishing. Kept
  // separate from the error state on purpose: this is NOT a failure, and the
  // whole bug was slow images being announced as failed ones.
  const [slowNote, setSlowNote] = useState('');
  // The filter bar. `filterRef` exists because the feed holds onto fetchPage
  // and would otherwise search with whatever the filter was when the callback
  // was created — the classic stale-closure bug, and here it would show the
  // customer results for a search they had already changed.
  const [filter, setFilter] = useState(EMPTY_FILTER);
  const [matchTotal, setMatchTotal] = useState(null);
  const [myModels, setMyModels] = useState([]);
  const filterRef = useRef(filter);
  filterRef.current = filter;
  const isGenerating = pending > 0;
  const [imageCount, setImageCount] = useState(1);
  const [expandedImage, setExpandedImage] = useState(null);
  const [detailImage, setDetailImage] = useState(null);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [activeTab, setActiveTab] = useState('history');
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [style, setStyle] = useState(null);
  const [quality, setQuality] = useState('2K');
  const [imageUrls, setImageUrls] = useState([]);  // ready uploaded URLs
  const [negativePrompt, setNegativePrompt] = useState('');
  const [cameraSelection, setCameraSelection] = useState({ camera: null, focalLength: null, lens: null, fstop: null });

  // Pre-fill prompt from URL params (e.g. from Discover page)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const p = params.get('prompt');
    if (p) setPrompt(p);
  }, []);

  // ── LOADING THE LIBRARY ──────────────────────────────────────────────────
  // This used to LOOP until it had every row — 200 at a time, sequentially,
  // on every page load. A customer with 3,000 images waited on fifteen round
  // trips before their library was usable, and the customers who generate
  // most waited longest. Now: one page, then more when they scroll.
  //
  // The loop was not gratuitous — the Saved tab was a client-side filter over
  // it. That is why there are TWO feeds below instead of one page plus a
  // .filter(): see the comment on `savedFeed`.
  const signedIn = !isLoadingAuth && isAuthenticated;

  const mapRecord = useCallback((r) => ({
    id: r.id,
    url: r.result_url,
    // ── THE SMALL COPY, WHEN ONE EXISTS ──────────────────────────────────
    // Written by the thumbnail backfill; absent on everything it has not
    // reached yet. The GRID prefers it; opening the picture always uses
    // `url`, the full original, untouched.
    thumbUrl: r.thumb_url || null,
    prompt: r.prompt,
    model: r.model,
    aspect: r.ratio,
    style: r.style,
    quality: r.quality,
    camera: r.camera || null,
    lens: r.lens || null,
    lensType: r.lens_type || null,
    focalLength: r.focal_length || null,
    fstop: r.fstop || null,
    saved: r.saved || false,
    gradient: RESULT_GRADIENTS[0],
  }), []);

  // Keyed on user.id via `enabled` + the feed's own run counter, so logging
  // out then back in re-fetches rather than showing the previous account's
  // rows — and a page still in flight for the old account never lands.
  const historyFeed = useHistoryFeed({
    fetchPage: useCallback(async (limit, offset) => {
      // No filter means the ORDINARY feed — not a search with empty terms.
      // Two code paths for the same pictures could disagree with each other,
      // and the unfiltered case is the one every customer sees every day.
      if (!isFiltering(filterRef.current)) {
        if (offset === 0) setMatchTotal(null);
        return History_.filter({ type: 'image' }, '-created_date', limit, offset);
      }
      const r = await base44.functions.invoke('history/search', {
        ...toQuery(filterRef.current, { type: 'image' }), limit, offset,
      });
      // The count comes back with the FIRST page and is the total that
      // matched, not what fits on screen — the only way to tell "too narrow"
      // from "not there" in a grid that loads as you scroll.
      if (offset === 0) setMatchTotal(r.data?.total ?? 0);
      return r.data?.items || [];
    }, []),
    map: mapRecord,
    enabled: signedIn,
    // The filter is part of the key, so changing it restarts the feed from
    // page one rather than appending new results underneath the old ones.
    resetKey: `${user?.id || ''}|${filter.text}|${filter.preset}|${filter.model}`,
  });

  // THE SAVED TAB ASKS THE SERVER, and this is the whole reason the change is
  // more than deleting a loop. It used to be `images.filter(img => img.saved)`
  // — correct only because every image was in memory. Filtering one PAGE
  // instead would hide an image saved six months ago, and a favourite that is
  // simply gone reads as lost work, not as a paging limit.
  const savedFeed = useHistoryFeed({
    fetchPage: useCallback(
      (limit, offset) => History_.filter({ type: 'image', saved: true }, '-created_date', limit, offset),
      [],
    ),
    map: mapRecord,
    enabled: signedIn && activeTab === 'saved',
    resetKey: user?.id,
  });

  // Their models, not all 28. Loaded once per account; a failure here leaves
  // the dropdown disabled rather than breaking the page — the filter is a
  // convenience and must never be able to take the history down with it.
  useEffect(() => {
    if (!signedIn) { setMyModels([]); return; }
    let alive = true;
    base44.functions.invoke('history/models', {})
      .then((r) => { if (alive) setMyModels(r.data?.models || []); })
      .catch(() => { if (alive) setMyModels([]); });
    return () => { alive = false; };
  }, [signedIn, user?.id]);

  const images = historyFeed.items;
  const setImages = historyFeed.setItems;

  // Scrolling near the bottom fetches the next page. The button below it is
  // not a fallback nobody sees — it is what works when IntersectionObserver
  // does not exist, and what a keyboard user can actually reach.
  const moreRef = useRef(null);

  const handleGenerate = async (creditCost) => {
    if (!prompt.trim()) { toast.error('Please enter a prompt'); return; }
    // Sign-up wall: an unauthenticated user clicking Generate gets the
    // sign-up modal instead of a silent backend 401. The modal closes on
    // success and they can hit Generate again.
    if (!isAuthenticated) {
      toast.info('Please sign in to generate.');
      openAuthModal('login');
      return;
    }
    // Concurrent-friendly: this batch adds its image count to the shared
    // `pending` counter and removes exactly that amount when done. No lock —
    // the user can start another generation immediately. Optimistically assume
    // `imageCount`; reconcile below once composition detection may force it to 1.
    let added = imageCount || 1;
    setPending(n => n + added);
    setActiveTab('history');
    try {
      // ─── Step 1: Upload ALL images to FAL storage ───
      console.log('[FAL] Starting image upload, count:', imageUrls.length);
      const uploadedUrls = await uploadAllToFal(imageUrls);
      console.log('[FAL] ✅ All images ready:', uploadedUrls);

      // Assert: all images made it
      if (uploadedUrls.length !== imageUrls.length) {
        console.error(`[FAL] ❌ Expected ${imageUrls.length} URLs but got ${uploadedUrls.length}`);
        toast.error(`${imageUrls.length - uploadedUrls.length} image(s) failed to upload`);
      }

      // ─── Step 2: Build prompt (backend-only injection) ───
      // The user's textarea (`prompt` state) is NEVER mutated.
      // Camera selections are merged in here, just before the API call.
      const styleSuffix = style ? (STYLE_SUFFIXES[style] || '') : '';
      const promptWithStyle = prompt + styleSuffix;
      const promptWithCamera = buildFinalPrompt(promptWithStyle, cameraSelection);
      const finalPrompt = buildCompositionPrompt(promptWithCamera, uploadedUrls.length);
      const isComposition = uploadedUrls.length >= 2 && detectCompositionIntent(prompt);
      const selectedNumImages = isComposition ? 1 : (imageCount || 1);
      // Reconcile the optimistic pending count with the real image count.
      if (selectedNumImages !== added) {
        setPending(n => n + (selectedNumImages - added));
        added = selectedNumImages;
      }

      console.log('[API PROMPT]', finalPrompt);
      console.log(`[Prompt] Composition: ${isComposition}, num_images: ${selectedNumImages}`);

      // ─── Step 3: Generate ───
      const generateOne = async (index) => {
        const payload = {
          type: 'image',
          model: selectedModel.name,
          prompt: finalPrompt,
          ratio: aspectRatio,
          quality,
          imageUrls: uploadedUrls,
          numImages: isComposition ? 1 : 1,
          safetyTolerance: '4',
          // Per-image credit cost charged server-side. Prefer the exact value
          // the Generate button showed (passed up from the prompt bar) so the
          // charge always matches the display; fall back to a recompute.
          credit_cost: creditCost ?? getImageCredits(selectedModel.id, quality),
          ...(negativePrompt?.trim() ? { negativePrompt } : {}),
        };

        console.log('[FAL PAYLOAD FINAL]', JSON.stringify(payload, null, 2));

        const response = await base44.functions.invoke('generate', payload);

        console.log('[FAL RESPONSE]', JSON.stringify(response.data, null, 2));

        // ── A HANDED-OFF IMAGE (2026-08-28) ──
        // The server stops holding the request at 90s (Cloudflare cuts a
        // proxied request at ~100), but the job keeps going. Six customers on
        // 28 August were told their image failed when all six had succeeded at
        // 94–314 seconds, so "slow" must never again be reported as "failed".
        //
        // If this wait is abandoned — tab closed, laptop shut — the server's
        // sweeper still delivers it into history. Nothing here is load-bearing
        // for the image arriving; it only means the customer watches it land.
        let url = response.data?.result_url;
        // The server makes the small version now; the history row is written
        // HERE, so it has to travel. A thumb_url the client never sends is a
        // field nothing reads — which is exactly what the grid had until today.
        let thumbUrl = response.data?.thumb_url || null;
        let alreadyInHistory = false;
        if (!url && response.data?.pending && response.data?.job_id) {
          const jobId = response.data.job_id;
          toast.info(response.data.message || 'This one is taking longer than usual — still working.');
          try {
            const out = await waitForImage(jobId, {
              poll: async (id) => (await base44.functions.invoke('image-status', { job_id: id })).data,
              onTick: (secs) => setSlowNote(`Still working — ${waitedLabel(secs)}. You can leave this page; `
                + 'it will be in your history when it is done.'),
            });
            if (!out.done) {
              // Stopped watching, NOT failed. Saying anything stronger would be
              // the original bug wearing a friendlier face.
              toast.info('Still generating. It will appear in your history on its own — no credits lost.');
              return null;
            }
            url = out.url;
            thumbUrl = out.thumbUrl || thumbUrl;
            alreadyInHistory = out.already;
          } catch (err) {
            toast.error(err.message || 'That image could not be finished — your credits are back.');
            return null;
          } finally {
            setSlowNote('');
          }
        }

        if (!url) {
          console.error('[Generate] FAL response', {
            error: response.data?.error,
            details: response.data?.details,
            raw: response.data,
          });
          const reason = response.data?.error || 'Generation failed — please try again';
          toast.error(reason);
          return null;
        }

        // The image EXISTS and has already been paid for. If persisting the
        // history row fails we must still show it — but say so plainly
        // rather than pretending it was saved (H7).
        // `alreadyInHistory` means the server's sweeper (or this customer's
        // other tab) won the claim and has already written the row. Writing a
        // second one would show the same picture twice in their own history.
        let savedRecord = null;
        if (!alreadyInHistory) {
          try {
            savedRecord = await History_.create({
              type: 'image', model: selectedModel.name, prompt,
              result_url: url, status: 'completed',
              ...(thumbUrl ? { thumb_url: thumbUrl } : {}),
              ratio: aspectRatio, style, quality,
              camera: cameraSelection?.camera?.name || null,
              lens: cameraSelection?.lens?.name || null,
              lens_type: cameraSelection?.lens?.type || null,
              focal_length: cameraSelection?.focalLength || null,
              fstop: cameraSelection?.fstop || null,
            });
          } catch (err) {
            console.error('[image] history save failed:', err);
            toast.error('Image generated, but saving it to your history failed — download it now to keep it.');
          }
        }
        return {
          id: savedRecord?.id ?? `unsaved-${crypto.randomUUID()}`,
          unsaved: !savedRecord,
          gradient: RESULT_GRADIENTS[(images.length + index) % RESULT_GRADIENTS.length],
          prompt, model: selectedModel.name,
          aspect: aspectRatio, style, quality,
          camera: cameraSelection?.camera?.label || cameraSelection?.camera?.name || null,
          lens: cameraSelection?.lens?.name || null,
          lensType: cameraSelection?.lens?.type || null,
          focalLength: cameraSelection?.focalLength || null,
          fstop: cameraSelection?.fstop || null,
          saved: false, url, thumbUrl,
        };
      };

      const promises = Array.from({ length: selectedNumImages }, (_, i) => generateOne(i));
      const results = await Promise.allSettled(promises);
      const newImages = results.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value);

      if (newImages.length > 0) {
        setImages((prev) => [...newImages, ...prev]);
        toast.success(`${newImages.length} image${newImages.length > 1 ? 's' : ''} generated!`);
      } else {
        // All N generations failed. Promise.allSettled doesn't bubble the
        // throw, so the parent catch block below never sees these errors.
        // Pull the actual reason out of the rejected promises and the
        // 401/402 status codes so the user sees what FAL actually said
        // (content moderation, quota, etc.) instead of a generic message.
        const rejected = results.find(r => r.status === 'rejected');
        const reason = rejected?.reason;
        const status = reason?.response?.status;
        const backendMsg = reason?.response?.data?.error;
        if (status === 401) {
          toast.error('Your session expired — please sign in again.');
          openAuthModal('login');
        } else if (status === 402) {
          toast.error(backendMsg || 'Not enough credits — ask the admin to add more.');
        } else if (backendMsg) {
          // FAL's real reason: content moderation, model timeout, etc.
          toast.error(backendMsg);
        } else if (reason?.message) {
          toast.error(reason.message);
        } else {
          toast.error('Generation failed — please try again');
        }
        console.error('[Generate] All attempts failed. First rejection:', reason);
      }
      // Pull the post-charge balance into the navbar pill. Fire-and-forget;
      // the next /api/auth/me round-trip will reflect the deduction. Also
      // safe to call when generation failed — it'll just return the
      // unchanged balance.
      refreshAuth();
    } catch (err) {
      console.error('[Generate] ❌ Error:', err);
      // axios attaches the real backend response under `err.response.data`.
      // Surface the backend's `error` string when available (e.g.
      // "Not enough credits, please contact admin") so the user sees
      // something actionable instead of a generic axios message.
      const status = err.response?.status;
      const backendMsg = err.response?.data?.error;
      if (status === 401) {
        // Token expired between page load and Generate click — drop it and
        // re-open the login modal so the user can re-authenticate without
        // losing the page.
        toast.error('Your session expired — please sign in again.');
        openAuthModal('login');
      } else if (status === 402) {
        toast.error(backendMsg || 'Not enough credits — ask the admin to add more.');
      } else {
        toast.error(backendMsg || err.message || 'Generation failed — please try again');
      }
      // If the throw was from a 402 InsufficientCredits, refreshing also
      // makes sure the displayed balance matches what the server thinks.
      refreshAuth();
    } finally {
      // Remove exactly what this batch added, so concurrent batches don't
      // clobber each other's count.
      setPending(n => Math.max(0, n - added));
    }
  };

  const handleSave = async (imgId, newSaved) => {
    // H7: a failed save must LOOK failed — don't flip the heart and claim
    // success when the server rejected the write.
    try {
      await History_.update(imgId, { saved: newSaved });
    } catch (err) {
      console.error('[image] save toggle failed:', err);
      toast.error(err.message || 'Could not save — please try again.');
      return;
    }
    setImages(prev => prev.map(img => img.id === imgId ? { ...img, saved: newSaved } : img));
    // Un-saving while looking AT the Saved tab has to remove the card, or the
    // heart goes empty and the image sits there anyway. Saving does not need
    // to insert one: switching to the tab re-asks the server.
    if (!newSaved) savedFeed.setItems(prev => prev.filter(img => img.id !== imgId));
    if (detailImage && detailImage.id === imgId) setDetailImage(prev => ({ ...prev, saved: newSaved }));
    toast.success(newSaved ? 'Saved!' : 'Removed from saved');
  };

  const handleRecreate = (template) => {
    setPrompt(template.prompt);
    setSelectedTemplate(null);
  };

  // Whichever tab is open reads from its OWN feed. `saved` is no longer a
  // filter over the history — it is its own server query.
  const feed = activeTab === 'saved' ? savedFeed : historyFeed;
  const displayImages = feed.items;

  useOnVisible(moreRef, feed.loadMore, feed.hasMore && !feed.loadingMore);

  return (
    <div style={{ height: 'calc(100vh - 64px)', overflow: 'hidden', background: '#0A0A0A', display: 'flex', flexDirection: 'column', position: 'relative' }}>

      <style>{`
        @keyframes imgShimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
        @keyframes imgSpin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes imgFadeIn { from{opacity:0;transform:scale(0.96)} to{opacity:1;transform:scale(1)} }
        @keyframes glowPulse2 { 0%,100%{opacity:0.5} 50%{opacity:1} }
      `}</style>

      {/* Red ambient glow background — clean, no noise. Lives at zIndex 0,
          content sits above at zIndex 2. Matches the design handoff brand
          contract: cinema feel, deep blacks, two corner red glows. */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none' }}>
        <div style={{
          position: 'absolute', top: '-20%', right: '-10%', width: 900, height: 900,
          background: 'radial-gradient(circle, rgba(224,30,30,0.28), transparent 60%)',
          filter: 'blur(60px)',
        }} />
        <div style={{
          position: 'absolute', bottom: '-20%', left: '-10%', width: 700, height: 700,
          background: 'radial-gradient(circle, rgba(139,15,15,0.4), transparent 65%)',
          filter: 'blur(60px)',
        }} />
      </div>

      {/* Model hero — eyebrow + Anton headline on the left, tabs on the right.
          Replaces the old sticky tabs row + isometric cube empty state. The
          hero is always visible, even with content (it's tall enough to read
          at the top of any feed). */}
      <div style={{
        position: 'relative', zIndex: 2,
        padding: '20px 28px 0',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 16,
      }}>
        <div>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            fontSize: 10.5, color: '#E01E1E',
            fontFamily: '"JetBrains Mono", monospace',
            letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 10,
            fontWeight: 600,
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: '#E01E1E',
              boxShadow: '0 0 10px #E01E1E',
              animation: 'glowPulse2 2s ease-in-out infinite',
            }} />
            Flagship · {selectedModel.name}
          </div>
          <div style={{
            fontFamily: 'Anton, sans-serif',
            fontSize: 52, letterSpacing: '0.01em', lineHeight: 0.95,
            color: '#FFF', textTransform: 'uppercase',
            margin: 0,
          }}>
            CREATE WITHOUT LIMITS
          </div>
          <div style={{ marginTop: 10, fontSize: 14, color: 'rgba(255,255,255,0.6)', maxWidth: 560 }}>
            {MODEL_SUBTITLES[selectedModel.name] || '4K image generation with cinematic control. Describe anything, generate in seconds.'}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {['history', 'saved', 'community'].map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)} style={{
              padding: '7px 14px', fontSize: 12, fontWeight: 500, borderRadius: 999,
              background: activeTab === tab ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${activeTab === tab ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.08)'}`,
              color: activeTab === tab ? '#FFF' : 'rgba(255,255,255,0.6)',
              backdropFilter: 'blur(14px)',
              cursor: 'pointer', textTransform: 'capitalize',
              fontFamily: font, display: 'inline-flex', alignItems: 'center', gap: 6,
              transition: 'all 0.15s',
            }}>
              {tab === 'history' && <History style={{ width: 12, height: 12 }} />}
              {tab === 'saved' && <Heart style={{ width: 12, height: 12 }} />}
              {tab === 'community' && <Globe style={{ width: 12, height: 12 }} />}
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Main content — minHeight:0 lets this flex child shrink below its
          content so overflowY actually scrolls; paddingBottom clears the
          fixed prompt bar (bottom:28 + ~204px tall) so the last row shows. */}
      <div style={{ position: 'relative', zIndex: 2, flex: 1, minHeight: 0, overflowY: 'auto', paddingBottom: 248 }}>

        {/* Search your own work. Only on the history tab — the Saved tab is a
            different server query, and a search box that silently did nothing
            there would be worse than no search box. */}
        {activeTab === 'history' && signedIn && (
          <div style={{ paddingTop: 14 }}>
            <HistoryFilterBar
              value={filter}
              onChange={setFilter}
              models={myModels}
              total={isFiltering(filter) ? matchTotal : null}
              loading={historyFeed.loading && isFiltering(filter)}
            />
          </div>
        )}

        {/* THE MOST IMPORTANT SENTENCE ON THIS PAGE.
            A customer who filters to nothing must never suspect their work was
            deleted. That fear is the single biggest risk in adding a filter,
            and it costs one line to remove. */}
        {activeTab === 'history' && isFiltering(filter)
          && !historyFeed.loading && images.length === 0 && (
          <div style={{
            margin: '4px 28px 0', padding: '14px 16px', borderRadius: 10,
            border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.04)',
            color: 'rgba(255,255,255,0.72)', fontFamily: font, fontSize: 13, lineHeight: 1.6,
          }}>
            Nothing matches that. <strong style={{ color: '#FFF' }}>Your older work is still here</strong>
            {' '}— widen the date, or clear the search.
          </div>
        )}

        {/* A handed-off image, still finishing. Deliberately NOT styled like an
            error: the whole bug being fixed here was a slow image being
            announced as a failed one. It says the wait is safe to walk away
            from, because it genuinely is — the server finishes it either way. */}
        {slowNote && (
          <div style={{
            margin: '16px 28px 0', padding: '11px 14px', borderRadius: 10,
            border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)',
            color: 'rgba(255,255,255,0.72)', fontFamily: font, fontSize: 13, lineHeight: 1.6,
          }}>
            {slowNote}
          </div>
        )}

        {/* Masonry grid (always rendered — when empty, only loading cards / nothing) */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10, padding: '20px 28px 14px'
        }}>
            {/* Loading cards — one per in-flight image across all batches */}
            {Array.from({ length: pending }).map((_, i) =>
          <div key={`loading-${i}`} style={{ animation: 'imgFadeIn 0.4s ease forwards' }}>
                <LoadingCard index={i} />
              </div>
          )}
            {/* Generated images */}
            {displayImages.map((img, i) =>
          <div key={img.id} style={{ animation: 'imgFadeIn 0.4s ease forwards' }}>
                <ImageCard img={img} index={i} onExpand={setDetailImage} onLoaded={() => {}} isFirst={i === 0} modelBadge={selectedModel.badge} />
              </div>
          )}
        </div>

        {/* ── MORE OF THE LIBRARY ────────────────────────────────────────
            A failure here says so and leaves the loaded rows alone, rather
            than blanking the grid and looking like the work is gone. */}
        {feed.error && (
          <p style={{ padding: '0 28px 12px', fontSize: 12, color: '#F87171' }} data-testid="feed-error">
            {feed.error}{' '}
            <button type="button" onClick={feed.loadMore}
              style={{ color: '#F87171', textDecoration: 'underline', background: 'none', border: 0, cursor: 'pointer' }}>
              Try again
            </button>
          </p>
        )}
        {feed.hasMore && (
          <div ref={moreRef} style={{ display: 'flex', justifyContent: 'center', padding: '4px 0 24px' }}>
            <button
              type="button"
              onClick={feed.loadMore}
              disabled={feed.loadingMore}
              data-testid="load-more"
              style={{
                fontSize: 12, color: 'rgba(255,255,255,0.7)', padding: '8px 18px', borderRadius: 8,
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
                cursor: feed.loadingMore ? 'default' : 'pointer',
              }}>
              {feed.loadingMore ? 'Loading…' : 'Load more'}
            </button>
          </div>
        )}
      </div>

      {/* Prompt bar */}
      <ImagePromptBar
        prompt={prompt}
        onPromptChange={setPrompt}
        onGenerate={handleGenerate}
        isGenerating={isGenerating}
        selectedModel={selectedModel}
        onModelChange={setSelectedModel}
        imageCount={imageCount}
        onCountChange={setImageCount}
        onAspectRatioChange={setAspectRatio}
        onStyleChange={setStyle}
        onQualityChange={setQuality}
        onImagesChange={setImageUrls}
        onNegativePromptChange={setNegativePrompt}
        cameraSelection={cameraSelection}
        onCameraChange={setCameraSelection} />


      {detailImage &&
      <ImageDetailModal
        image={detailImage}
        images={displayImages}
        onClose={() => setDetailImage(null)}
        onNavigate={setDetailImage}
        onSave={handleSave} />

      }

      {selectedTemplate &&
      <TemplateModal
        template={selectedTemplate}
        onClose={() => setSelectedTemplate(null)}
        type="image"
        onRecreate={handleRecreate} />

      }
    </div>);

}