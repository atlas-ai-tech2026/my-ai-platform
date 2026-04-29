import React, { useState, useRef, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
const History_ = base44.entities.GenerationHistory;
import ImagePromptBar from '@/components/image/ImagePromptBar';
import { buildCompositionPrompt, detectCompositionIntent } from '@/lib/enhancePrompt';
import { uploadAllToFal } from '@/lib/uploadToFal';

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
import { History, Globe, Heart, Download, RefreshCw, Maximize2, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';

const MODEL_SUBTITLES = {
  'Nano Banana Pro': 'Create stunning, high-aesthetic images in seconds',
  'Nano Banana 2': 'Pro-level quality at Flash speed',
  'Soul 2.0': 'Fashion-forward portraits with cultural fluency',
  'Seedream 5.0 Lite': 'Intelligent visual reasoning — unlimited access',
  'Seedream 4.5': 'Next-gen 4K photorealistic detail',
  'GPT Image 1.5': 'True-color precision rendering by OpenAI',
  'Flux Kontext': 'Stylistic diversity for any aesthetic',
  'Flux 2': 'Strong prompt adherence at high speed',
  'Wan 2.2 Image': 'Artistic and illustrated visual creation',
  'Skin Enhancer': 'Natural realistic skin texture enhancement',
  'Face Swap': 'Seamless instant face replacement',
  'Relight': 'Change the light, change the mood'
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

// Loading card component
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
      borderRadius: 14, border: '1px solid rgba(224,30,30,0.3)',
      overflow: 'hidden', background: '#161616',
      display: 'flex', flexDirection: 'column', width: '100%', aspectRatio: '1 / 1',
      position: 'relative'
    }}>
      {/* Shimmer */}
      <div style={{ flex: 1, background: 'linear-gradient(135deg, #1a0000 0%, #2a0a0a 50%, #1a1a1a 100%)', position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, transparent 0%, rgba(224,30,30,0.08) 50%, transparent 100%)', backgroundSize: '200% 100%', animation: 'imgShimmer 1.6s linear infinite' }} />
        <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(224,30,30,0.12)', border: '1px solid rgba(224,30,30,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'imgSpin 1.8s linear infinite' }}>
          <Sparkles style={{ width: 18, height: 18, color: '#FF4444' }} />
        </div>
      </div>
      {/* Progress bar */}
      <div style={{ padding: '8px 10px', background: '#161616' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', fontFamily: font }}>Generating...</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#FF4444', fontFamily: font }}>{pct}%</span>
        </div>
        <div style={{ height: 3, background: '#2A2A2A', borderRadius: 999 }}>
          <div style={{ height: '100%', width: `${pct}%`, background: 'linear-gradient(90deg, #CC0000, #FF2222)', borderRadius: 999, transition: 'width 0.12s ease', boxShadow: '0 0 6px rgba(224,30,30,0.5)' }} />
        </div>
      </div>
    </div>);

}

// Single image card
function ImageCard({ img, index, onExpand, onLoaded }) {
  const [hovered, setHovered] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const h = HEIGHTS[index % HEIGHTS.length];
  const showShimmer = img.url && !imgLoaded;

  return (
    <div
      style={{ borderRadius: 14, overflow: 'hidden', background: img.gradient, cursor: 'pointer', position: 'relative', width: '100%', aspectRatio: '1 / 1' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => imgLoaded && onExpand(img)}>

      {img.url && (
        <img
          src={img.url}
          alt={img.prompt}
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
            href={`/api/download?url=${encodeURIComponent(img.url)}&filename=voxel-${(img.prompt || 'image').slice(0,30).replace(/[^a-zA-Z0-9]/g,'-')}.png`}
            download
            onClick={e => e.stopPropagation()}
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
  const { isAuthenticated, openAuthModal, refresh: refreshAuth } = useAuth();
  const [selectedModel, setSelectedModel] = useState({ id: 'nano-pro', name: 'Nano Banana Pro' });
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [images, setImages] = useState([]);
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

  // Load history on mount
  useEffect(() => {
    History_.filter({ type: 'image' }, '-created_date', 50).then(records => {
      const loaded = records.map(r => ({
        id: r.id,
        url: r.result_url,
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
      }));
      setImages(loaded);
    }).catch(() => {});
  }, []);

  const handleGenerate = async () => {
    if (!prompt.trim()) { toast.error('Please enter a prompt'); return; }
    // Sign-up wall: an unauthenticated user clicking Generate gets the
    // sign-up modal instead of a silent backend 401. The modal closes on
    // success and they can hit Generate again.
    if (!isAuthenticated) {
      toast.info('Sign up to start generating — it takes 10 seconds.');
      openAuthModal('signup');
      return;
    }
    setIsGenerating(true);
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
          ...(negativePrompt?.trim() ? { negativePrompt } : {}),
        };

        console.log('[FAL PAYLOAD FINAL]', JSON.stringify(payload, null, 2));

        const response = await base44.functions.invoke('generate', payload);

        console.log('[FAL RESPONSE]', JSON.stringify(response.data, null, 2));

        const url = response.data?.result_url;
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

        const savedRecord = await History_.create({
          type: 'image', model: selectedModel.name, prompt,
          result_url: url, status: 'completed',
          ratio: aspectRatio, style, quality,
          camera: cameraSelection?.camera?.name || null,
          lens: cameraSelection?.lens?.name || null,
          lens_type: cameraSelection?.lens?.type || null,
          focal_length: cameraSelection?.focalLength || null,
          fstop: cameraSelection?.fstop || null,
        });
        return {
          id: savedRecord.id,
          gradient: RESULT_GRADIENTS[(images.length + index) % RESULT_GRADIENTS.length],
          prompt, model: selectedModel.name,
          aspect: aspectRatio, style, quality,
          camera: cameraSelection?.camera?.label || cameraSelection?.camera?.name || null,
          lens: cameraSelection?.lens?.name || null,
          lensType: cameraSelection?.lens?.type || null,
          focalLength: cameraSelection?.focalLength || null,
          fstop: cameraSelection?.fstop || null,
          saved: false, url,
        };
      };

      const promises = Array.from({ length: selectedNumImages }, (_, i) => generateOne(i));
      const results = await Promise.allSettled(promises);
      const newImages = results.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value);

      if (newImages.length > 0) {
        setImages((prev) => [...newImages, ...prev]);
        toast.success(`${newImages.length} image${newImages.length > 1 ? 's' : ''} generated!`);
      } else {
        toast.error('Generation failed — please try again');
      }
      // Pull the post-charge balance into the navbar pill. Fire-and-forget;
      // the next /api/auth/me round-trip will reflect the deduction. Also
      // safe to call when generation failed — it'll just return the
      // unchanged balance.
      refreshAuth();
    } catch (err) {
      console.error('[Generate] ❌ Error:', err);
      toast.error(err.message || 'Generation failed — please try again');
      // If the throw was from a 402 InsufficientCredits, refreshing also
      // makes sure the displayed balance matches what the server thinks.
      refreshAuth();
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSave = async (imgId, newSaved) => {
    await History_.update(imgId, { saved: newSaved });
    setImages(prev => prev.map(img => img.id === imgId ? { ...img, saved: newSaved } : img));
    if (detailImage && detailImage.id === imgId) setDetailImage(prev => ({ ...prev, saved: newSaved }));
    toast.success(newSaved ? 'Saved!' : 'Removed from saved');
  };

  const handleRecreate = (template) => {
    setPrompt(template.prompt);
    setSelectedTemplate(null);
  };

  const displayImages = activeTab === 'saved' ? images.filter(img => img.saved) : images;
  const hasContent = displayImages.length > 0 || isGenerating;

  return (
    <div style={{ minHeight: 'calc(100vh - 64px)', background: '#141414', display: 'flex', flexDirection: 'column', position: 'relative' }}>

      <style>{`
        @keyframes imgShimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
        @keyframes imgSpin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes imgFadeIn { from{opacity:0;transform:scale(0.96)} to{opacity:1;transform:scale(1)} }
        @keyframes glowPulse2 { 0%,100%{opacity:0.5} 50%{opacity:1} }
      `}</style>

      {/* Tabs row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', borderBottom: '1px solid #1A1A1A', background: '#141414', position: 'sticky', top: 0, zIndex: 10 }}>
        {['history', 'saved', 'community'].map(tab => (
          <button key={tab}
            onClick={() => setActiveTab(tab)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 999, fontSize: 13, color: activeTab === tab ? '#fff' : '#666', border: `1px solid ${activeTab === tab ? 'rgba(255,255,255,0.2)' : '#2A2A2A'}`, background: activeTab === tab ? 'rgba(255,255,255,0.08)' : 'transparent', cursor: 'pointer', fontFamily: font, transition: 'all 0.15s', fontWeight: activeTab === tab ? 600 : 400, textTransform: 'capitalize' }}>
            {tab === 'history' && <History style={{ width: 14, height: 14 }} />}
            {tab === 'saved' && <Heart style={{ width: 14, height: 14 }} />}
            {tab === 'community' && <Globe style={{ width: 14, height: 14 }} />}
            {tab}
          </button>
        ))}
      </div>

      {/* Main content */}
      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 180 }}>

        {/* Empty state */}
        {!hasContent &&
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 'calc(100vh - 200px)', textAlign: 'center', padding: '0 16px' }} className="bg-[#1f1e1e]">
            <div style={{ position: 'relative', width: 110, height: 110, marginBottom: 32 }}>
              <span style={{ position: 'absolute', top: -8, right: -4, fontSize: 18, color: '#E01E1E', animation: 'glowPulse2 2s ease-in-out infinite' }}>✦</span>
              <span style={{ position: 'absolute', top: 20, right: -18, fontSize: 11, color: '#ff5555', animation: 'glowPulse2 2s ease-in-out infinite', animationDelay: '0.7s' }}>✦</span>
              <span style={{ position: 'absolute', bottom: 0, left: -10, fontSize: 14, color: '#8B0000', animation: 'glowPulse2 2s ease-in-out infinite', animationDelay: '1.4s' }}>✦</span>
              <svg width="110" height="110" viewBox="0 0 110 110" fill="none">
                <defs>
                  <linearGradient id="ig1" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#8B0000" /><stop offset="100%" stopColor="#E01E1E" /></linearGradient>
                  <linearGradient id="ig2" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#5a0000" /><stop offset="100%" stopColor="#8B0000" /></linearGradient>
                  <linearGradient id="ig3" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#3a0000" /><stop offset="100%" stopColor="#5a0000" /></linearGradient>
                </defs>
                <rect x="18" y="30" width="60" height="52" rx="8" fill="url(#ig1)" />
                <path d="M18 30 L38 14 L98 14 L78 30 Z" fill="url(#ig2)" />
                <path d="M78 30 L98 14 L98 66 L78 82 Z" fill="url(#ig3)" />
                <circle cx="38" cy="50" r="7" fill="rgba(255,255,255,0.25)" />
                <path d="M22 74 L36 56 L50 68 L62 54 L76 74 Z" fill="rgba(255,255,255,0.18)" />
              </svg>
            </div>
            <h1 style={{ fontFamily: 'Anton, sans-serif', fontSize: 'clamp(48px, 7vw, 88px)', color: '#fff', lineHeight: 1, margin: '0 0 12px 0', textTransform: 'uppercase' }}>
              {selectedModel.name}
            </h1>
            <p style={{ fontFamily: font, fontSize: 15, color: '#555', margin: 0 }}>
              {MODEL_SUBTITLES[selectedModel.name] || 'Create stunning images in seconds'}
            </p>
          </div>
        }

        {/* Masonry grid */}
        {hasContent &&
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10, padding: '14px 14px'
        }}>
            {/* Loading cards */}
            {isGenerating && Array.from({ length: imageCount }).map((_, i) =>
          <div key={`loading-${i}`} style={{ animation: 'imgFadeIn 0.4s ease forwards' }}>
                <LoadingCard index={i} />
              </div>
          )}
            {/* Generated images */}
            {displayImages.map((img, i) =>
          <div key={img.id} style={{ animation: 'imgFadeIn 0.4s ease forwards' }}>
                <ImageCard img={img} index={i} onExpand={setDetailImage} onLoaded={() => {}} />
              </div>
          )}
          </div>
        }
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