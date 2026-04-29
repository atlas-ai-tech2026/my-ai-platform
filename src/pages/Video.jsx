import React, { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import VideoLeftPanel from '@/components/video/VideoLeftPanel';
const History_ = base44.entities.GenerationHistory;
import VideoRightArea from '@/components/video/VideoRightArea';
import VideoModelModal from '@/components/video/VideoModelModal';
import VideoDetailModal from '@/components/video/VideoDetailModal';
import SeedanceLeftPanel from '@/components/video/SeedanceLeftPanel';
import SeedanceRightPanel from '@/components/video/SeedanceRightPanel';
import { toast } from 'sonner';
import { prepareImageForFal } from '@/lib/uploadToFal';
import { useAuth } from '@/lib/AuthContext';
import { VOXEL_TOKEN_KEY } from '@/lib/adminApi';

// /api/generate-video and /api/generate-video-ref both go through verifyJwt
// on the server. The raw fetch calls in this file don't go through the
// axios client that auto-attaches the bearer token, so we build the
// auth-aware headers explicitly.
function authJsonHeaders() {
  const token = localStorage.getItem(VOXEL_TOKEN_KEY);
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

const DEFAULT_MODEL = { id: 'kling-3', name: 'Kling 3.0', brand: 'Kling', color: '#2563EB' };

export default function Video() {
  const { isAuthenticated, openAuthModal, refresh: refreshAuth } = useAuth();
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [count, setCount] = useState(1);
  const [videos, setVideos] = useState([]);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [duration, setDuration] = useState('5s');
  const [resolution, setResolution] = useState('1080p');
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [showModelModal, setShowModelModal] = useState(false);
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [startFrame, setStartFrame] = useState(null);
  const [endFrame, setEndFrame] = useState(null);
  const [cameraMotion, setCameraMotion] = useState(null); // { id, label } | null — backend-only injection
  const pollingRef = useRef({});

  // ─── Seedance 2.0 specific state ───
  const isSeedance2 = model.id === 'seedance-2';
  const [seedanceMedia, setSeedanceMedia] = useState({ images: [], videos: [], audios: [] });
  const [seedanceElements, setSeedanceElements] = useState([]);
  const [seedanceAudioOn, setSeedanceAudioOn] = useState(true);
  const [seedanceRightTab, setSeedanceRightTab] = useState('uploads');
  const [seedanceDuration, setSeedanceDuration] = useState('auto');
  const [seedanceAspect, setSeedanceAspect] = useState('auto');
  const [seedanceRes, setSeedanceRes] = useState('720p');
  const [showSeedanceMediaPopup, setShowSeedanceMediaPopup] = useState(false);
  // Image role tracking: { itemId: 'reference' | 'start_frame' | 'end_frame' }
  const [seedanceImageRoles, setSeedanceImageRoles] = useState({});

  // Load history
  useEffect(() => {
    History_.filter({ type: 'video' }, '-created_date', 50).then(records => {
      const loaded = records.map(r => ({
        id: r.id, prompt: r.prompt, model: r.model,
        duration: r.duration, aspectRatio: r.ratio,
        result_url: r.result_url, status: r.status || 'completed',
        job_id: r.job_id, model_id: r.model_id,
        created_date: r.created_date,
      }));
      setVideos(loaded);
      loaded.filter(v => v.status === 'pending' && v.job_id && v.model_id)
        .forEach(v => pollVideo(v.id, v.job_id, v.model_id));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    return () => Object.values(pollingRef.current).forEach(clearInterval);
  }, []);

  const pollVideo = (recordId, jobId, modelId) => {
    let retries = 0;
    let errorCount = 0;
    const MAX_RETRIES = 200;    // ~10 min at 3s intervals
    const MAX_ERRORS = 5;       // 5 consecutive network errors → fail

    const markFailed = async (reason) => {
      clearInterval(interval);
      delete pollingRef.current[recordId];
      try { await History_.update(recordId, { status: 'failed' }); } catch {}
      setVideos(prev => prev.map(v => v.id === recordId ? { ...v, status: 'failed' } : v));
      toast.error(reason || 'Video generation failed');
    };

    const interval = setInterval(async () => {
      retries++;
      if (retries > MAX_RETRIES) {
        markFailed('Video timed out after 10 minutes — please try again');
        return;
      }

      try {
        const res = await fetch('/api/video-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ job_id: jobId, model_id: modelId }),
        });
        const d = await res.json();
        const st = (d.status || '').toUpperCase();

        if (st === 'COMPLETED' && d.video_url) {
          clearInterval(interval);
          delete pollingRef.current[recordId];
          errorCount = 0;
          await History_.update(recordId, { status: 'completed', result_url: d.video_url });
          setVideos(prev => prev.map(v => v.id === recordId ? { ...v, status: 'completed', result_url: d.video_url } : v));
          toast.success('Video ready!');
        } else if (st === 'FAILED' || st === 'ERROR') {
          // FAL returned an error (422 sensitive content, generation failed, etc.)
          markFailed(d.error || 'Video generation failed');
        } else {
          // Still in progress — reset error counter
          errorCount = 0;
        }
      } catch (err) {
        console.error('[POLL] Error polling video status:', err.message);
        errorCount++;
        if (errorCount >= MAX_ERRORS) {
          markFailed('Lost connection to server — video status unknown');
        }
      }
    }, 3000);
    pollingRef.current[recordId] = interval;
  };

  // ─── Standard video generate ───
  const handleGenerate = async () => {
    if (!prompt.trim()) { toast.error('Please enter a prompt'); return; }
    if (!isAuthenticated) {
      toast.info('Sign up to start generating — it takes 10 seconds.');
      openAuthModal('signup');
      return;
    }
    setIsGenerating(true);
    try {
      let imageUrl = null;
      let tailImageUrl = null;
      if (startFrame) imageUrl = await prepareImageForFal(startFrame, 0);
      if (endFrame) tailImageUrl = await prepareImageForFal(endFrame, 1);

      // Backend-only camera-motion injection — prompt textarea stays clean
      const finalPrompt = cameraMotion?.label
        ? `${prompt.trim()}, camera motion: ${cameraMotion.label.toLowerCase()}`
        : prompt;

      const response = await fetch('/api/generate-video', {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify({
          model: model.name, prompt: finalPrompt,
          duration: parseInt(duration) || 5,
          aspect_ratio: aspectRatio === 'Auto' ? '16:9' : aspectRatio,
          ...(imageUrl ? { image_url: imageUrl } : {}),
          ...(tailImageUrl ? { tail_image_url: tailImageUrl } : {}),
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.job_id) {
        toast.error(data.error || 'Video generation failed');
        // 402 / banned / etc. — pull the latest balance into the navbar.
        refreshAuth();
        return;
      }

      const saved = await History_.create({
        type: 'video', model: model.name, prompt,
        job_id: data.job_id, model_id: data.model_id,
        status: 'pending', duration: parseInt(duration) || 5, ratio: aspectRatio,
      });
      setVideos(prev => [{ id: saved.id, prompt, model: model.name, duration: parseInt(duration) || 5, aspectRatio, status: 'pending', job_id: data.job_id, model_id: data.model_id, created_date: saved.created_date }, ...prev]);
      pollVideo(saved.id, data.job_id, data.model_id);
      toast.success('Video generating — you can keep working!');
      // Charge happens at submit (not at poll-completion), so refresh now.
      refreshAuth();
    } catch (err) {
      toast.error(err.message || 'Video generation failed');
      refreshAuth();
    }
    finally { setIsGenerating(false); }
  };

  // ─── Seedance 2.0 media upload ───
  const handleSeedanceMediaUpload = async (type, file) => {
    const id = Date.now().toString() + Math.random();
    const previewUrl = URL.createObjectURL(file);
    const typeKey = type === 'image' ? 'images' : type === 'video' ? 'videos' : 'audios';
    const count = seedanceMedia[typeKey].length + 1;
    const label = type === 'image' ? `@Image${count}` : type === 'video' ? `@Video${count}` : `@Audio${count}`;

    setSeedanceMedia(prev => ({
      ...prev,
      [typeKey]: [...prev[typeKey], { id, type, previewUrl, url: null, status: 'uploading', label }],
    }));

    try {
      console.log(`[SEEDANCE UPLOAD] Uploading ${type} file:`, file.name, file.size, file.type);
      const url = await prepareImageForFal(file, 0);
      console.log(`[SEEDANCE UPLOAD] ✅ Uploaded:`, url);
      setSeedanceMedia(prev => ({
        ...prev,
        [typeKey]: prev[typeKey].map(i => i.id === id ? { ...i, url, status: 'uploaded' } : i),
      }));
    } catch (err) {
      console.error(`[SEEDANCE UPLOAD] ❌ Upload failed:`, err);
      setSeedanceMedia(prev => ({
        ...prev,
        [typeKey]: prev[typeKey].filter(i => i.id !== id),
      }));
      toast.error('Upload failed: ' + (err.message || 'Unknown error'));
    }
  };

  const handleSeedanceMediaRemove = (itemId) => {
    setSeedanceMedia(prev => ({
      images: prev.images.filter(i => i.id !== itemId),
      videos: prev.videos.filter(i => i.id !== itemId),
      audios: prev.audios.filter(i => i.id !== itemId),
    }));
    // Also remove any role assignment
    setSeedanceImageRoles(prev => {
      const next = { ...prev };
      delete next[itemId];
      return next;
    });
  };

  // ─── Image role change (reference / start_frame / end_frame) ───
  const handleImageRoleChange = (itemId, role) => {
    setSeedanceImageRoles(prev => {
      const next = { ...prev };
      if (!role) {
        delete next[itemId];
      } else {
        // Ensure only one start_frame and one end_frame at a time
        if (role === 'start_frame' || role === 'end_frame') {
          Object.keys(next).forEach(key => {
            if (next[key] === role) delete next[key];
          });
        }
        next[itemId] = role;
      }
      return next;
    });
  };

  // ─── Seedance character eligibility check ───
  const handleCheckEligibility = async (itemId) => {
    // Find item
    const allItems = [...seedanceMedia.images, ...seedanceMedia.videos, ...seedanceMedia.audios];
    const item = allItems.find(i => i.id === itemId);
    if (!item) return;

    // Set checking status
    const typeKey = item.type === 'image' ? 'images' : item.type === 'video' ? 'videos' : 'audios';
    setSeedanceMedia(prev => ({
      ...prev,
      [typeKey]: prev[typeKey].map(i => i.id === itemId ? { ...i, status: 'checking' } : i),
    }));

    try {
      const res = await fetch('/api/check-character-eligibility', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: item.url }),
      });
      const data = await res.json();
      const approved = data.approved !== false;

      setSeedanceMedia(prev => ({
        ...prev,
        [typeKey]: prev[typeKey].map(i => i.id === itemId ? { ...i, status: approved ? 'approved' : 'rejected' } : i),
      }));

      if (approved) {
        const elementLabel = `@Element${seedanceElements.length + 1}`;
        setSeedanceElements(prev => [...prev, { ...item, status: 'approved', label: elementLabel }]);
        setSeedanceRightTab('elements');
        toast.success(`Character approved as ${elementLabel}`);
      } else {
        toast.error('Character not eligible');
      }
    } catch {
      setSeedanceMedia(prev => ({
        ...prev,
        [typeKey]: prev[typeKey].map(i => i.id === itemId ? { ...i, status: 'uploaded' } : i),
      }));
      toast.error('Eligibility check failed');
    }
  };

  // ─── Seedance 2.0 smart generate ───
  // Routes to correct API based on image roles:
  //   No images → text-to-video
  //   Images as reference → reference-to-video (image_urls[])
  //   Images as start/end frame → image-to-video (start_frame, end_frame)
  const handleSeedanceGenerate = async () => {
    if (!prompt.trim()) { toast.error('Please enter a prompt'); return; }
    if (!isAuthenticated) {
      toast.info('Sign up to start generating — it takes 10 seconds.');
      openAuthModal('signup');
      return;
    }
    setIsGenerating(true);
    try {
      const readyImages = seedanceMedia.images.filter(i => i.url && (i.status === 'uploaded' || i.status === 'approved'));
      const videoUrls = seedanceMedia.videos.filter(v => v.url).map(v => v.url);
      const audioUrls = seedanceMedia.audios.filter(a => a.url).map(a => a.url);

      // Separate images by role
      const referenceUrls = [];
      let startFrameUrl = null;
      let endFrameUrl = null;

      readyImages.forEach(img => {
        const role = seedanceImageRoles[img.id];
        if (role === 'start_frame') startFrameUrl = img.url;
        else if (role === 'end_frame') endFrameUrl = img.url;
        else if (role === 'reference') referenceUrls.push(img.url);
        else referenceUrls.push(img.url); // Default: treat as reference
      });

      // Determine mode
      const hasFrames = !!startFrameUrl || !!endFrameUrl;
      const hasRefs = referenceUrls.length > 0 || videoUrls.length > 0 || audioUrls.length > 0;
      const mode = hasFrames ? 'frame' : hasRefs ? 'reference' : 'text';

      console.log('[SEEDANCE] Mode:', mode, '| Refs:', referenceUrls.length, '| Start:', !!startFrameUrl, '| End:', !!endFrameUrl);

      const body = {
        prompt,
        mode,
        duration: seedanceDuration === 'auto' ? 'auto' : String(parseInt(seedanceDuration) || 5),
        aspect_ratio: seedanceAspect,
        resolution: seedanceRes,
        generate_audio: seedanceAudioOn,
      };

      // Add mode-specific params
      if (mode === 'frame') {
        if (startFrameUrl) body.start_frame = startFrameUrl;
        if (endFrameUrl) body.end_frame = endFrameUrl;
      } else if (mode === 'reference') {
        if (referenceUrls.length > 0) body.image_urls = referenceUrls;
        if (videoUrls.length > 0) body.video_urls = videoUrls;
        if (audioUrls.length > 0) body.audio_urls = audioUrls;
      }

      const response = await fetch('/api/generate-video-ref', {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify(body),
      });

      const data = await response.json();
      if (!response.ok || !data.job_id) {
        toast.error(data.error || 'Generation failed');
        refreshAuth();
        return;
      }

      const saved = await History_.create({
        type: 'video', model: 'Seedance 2.0', prompt,
        job_id: data.job_id, model_id: data.model_id,
        status: 'pending', duration: seedanceDuration, ratio: seedanceAspect,
      });

      setVideos(prev => [{ id: saved.id, prompt, model: 'Seedance 2.0', duration: seedanceDuration, aspectRatio: seedanceAspect, status: 'pending', job_id: data.job_id, model_id: data.model_id, created_date: saved.created_date }, ...prev]);
      pollVideo(saved.id, data.job_id, data.model_id);
      toast.success('Seedance generating — you can keep working!');
      refreshAuth();
    } catch (err) {
      toast.error(err.message || 'Generation failed');
      refreshAuth();
    }
    finally { setIsGenerating(false); }
  };

  return (
    <div style={{ display: 'flex', background: '#0A0A0A', height: 'calc(100vh - 64px)', overflow: 'hidden' }}>
      {/* Left panel */}
      {isSeedance2 ? (
        <SeedanceLeftPanel
          prompt={prompt}
          onPromptChange={setPrompt}
          onGenerate={handleSeedanceGenerate}
          isGenerating={isGenerating}
          model={model}
          onModelClick={() => setShowModelModal(true)}
          duration={seedanceDuration}
          onDurationChange={setSeedanceDuration}
          aspectRatio={seedanceAspect}
          onAspectRatioChange={setSeedanceAspect}
          resolution={seedanceRes}
          onResolutionChange={setSeedanceRes}
          audioOn={seedanceAudioOn}
          onAudioToggle={() => setSeedanceAudioOn(v => !v)}
          media={seedanceMedia}
          onMediaRemove={handleSeedanceMediaRemove}
          onCheckEligibility={handleCheckEligibility}
          elements={seedanceElements}
          onElementsClick={() => setShowSeedanceMediaPopup(true)}
          showMediaPopup={showSeedanceMediaPopup}
          onCloseMediaPopup={() => setShowSeedanceMediaPopup(false)}
          imageRoles={seedanceImageRoles}
          onImageRoleChange={handleImageRoleChange}
        />
      ) : (
        <VideoLeftPanel
          prompt={prompt} onPromptChange={setPrompt}
          onGenerate={handleGenerate} isGenerating={isGenerating}
          count={count} onCountChange={setCount}
          model={model} onModelClick={() => setShowModelModal(true)}
          duration={duration} onDurationChange={setDuration}
          resolution={resolution} onResolutionChange={setResolution}
          aspectRatio={aspectRatio} onAspectRatioChange={setAspectRatio}
          startFrame={startFrame} endFrame={endFrame}
          onStartFrameChange={setStartFrame} onEndFrameChange={setEndFrame}
          onCameraMotionChange={setCameraMotion}
        />
      )}

      {/* Right panel — ALWAYS show video history for all models */}
      <VideoRightArea
        videos={videos} isGenerating={isGenerating}
        durationMs={3000} aspectRatio={isSeedance2 ? seedanceAspect : aspectRatio}
        onRecreate={(t) => setPrompt(t.prompt)}
        onVideoClick={(v) => setSelectedVideo(v)}
        leftPanelWidth={380}
      />

      {/* Seedance media popup overlay */}
      {isSeedance2 && showSeedanceMediaPopup && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', zIndex: 100,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }} onClick={() => setShowSeedanceMediaPopup(false)}>
          <div onClick={e => e.stopPropagation()} style={{
            width: 700, maxHeight: '80vh', background: '#111', borderRadius: 16,
            border: '1px solid rgba(255,255,255,0.1)', overflow: 'hidden',
            display: 'flex', flexDirection: 'column',
            backdropFilter: 'blur(20px)',
          }}>
            <SeedanceRightPanel
              activeTab={seedanceRightTab}
              onTabChange={setSeedanceRightTab}
              media={seedanceMedia}
              elements={seedanceElements}
              onCheckEligibility={handleCheckEligibility}
              onMediaRemove={handleSeedanceMediaRemove}
              onMediaUpload={handleSeedanceMediaUpload}
              videos={videos}
              isPopup
              onClose={() => setShowSeedanceMediaPopup(false)}
              imageRoles={seedanceImageRoles}
              onImageRoleChange={handleImageRoleChange}
            />
          </div>
        </div>
      )}

      {/* Modals */}
      {showModelModal && (
        <VideoModelModal selectedId={model.id} onSelect={(m) => setModel(m)} onClose={() => setShowModelModal(false)} />
      )}
      {selectedVideo && (
        <VideoDetailModal video={selectedVideo} videos={videos} onClose={() => setSelectedVideo(null)} onNavigate={setSelectedVideo} />
      )}
    </div>
  );
}
