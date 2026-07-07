import React, { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import VideoLeftPanel from '@/components/video/VideoLeftPanel';
const History_ = base44.entities.GenerationHistory;
import VideoRightArea from '@/components/video/VideoRightArea';
import VideoModelModal from '@/components/video/VideoModelModal';
import VideoDetailModal from '@/components/video/VideoDetailModal';
import SeedanceLeftPanel from '@/components/video/SeedanceLeftPanel';
import SeedanceRightPanel from '@/components/video/SeedanceRightPanel';
import VideoEditOmniLeftPanel from '@/components/video/VideoEditOmniLeftPanel';
import VideoMotionControlLeftPanel from '@/components/video/VideoMotionControlLeftPanel';
import VideoTopTabs from '@/components/video/VideoTopTabs';
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
  const { user, isAuthenticated, isLoadingAuth, openAuthModal, refresh: refreshAuth } = useAuth();
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

  // ─── Top-tab nav (Create / Edit / Motion) ───
  // videoTab is the source of truth for which left panel renders.
  // Each tab owns its own model state — Create uses the existing
  // `model` picker, Edit and Motion each have their own InlineModelPicker
  // (one per panel). No tab-change side-effects needed.
  const [videoTab, setVideoTab] = useState('create');

  // ─── Edit Video state (Kling Omni Edit + Kling O1 Video Edit) ───
  // Default model: Kling O1 Video Edit (matches Higgsfield's default).
  const [editVideoFile, setEditVideoFile] = useState(null);
  const [editRefImages, setEditRefImages] = useState([]);
  const [editKeepAudio, setEditKeepAudio] = useState(true);
  const [editAutoSettings, setEditAutoSettings] = useState(true);
  const [editQuality, setEditQuality] = useState('720p');
  const [editModel, setEditModel] = useState('Kling O1 Video Edit');

  // ─── Motion Control state (motion transfer) ───
  // Default model: Kling 3.0 Motion Control (the flagship; uses Omni One
  // physics). scene_control persists to history but isn't sent to FAL
  // today (server-side note explains why).
  const [motionCharImage, setMotionCharImage] = useState(null);
  const [motionRefVideo, setMotionRefVideo] = useState(null);
  const [motionQuality, setMotionQuality] = useState('720p');
  const [motionSceneControl, setMotionSceneControl] = useState(true);
  const [motionModel, setMotionModel] = useState('Kling 3.0 Motion Control');

  // ─── Seedance 2.0 specific state ───
  const isSeedance2 = model.id === 'seedance-2' || model.id === 'seedance-2-fast' || model.id === 'seedance-2-mini';
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

  // Load history whenever auth resolves to a logged-in user. Keyed on
  // user.id so logging out then back in always re-fetches that user's
  // server-side history instead of showing stale/empty results.
  useEffect(() => {
    if (isLoadingAuth) return;
    if (!isAuthenticated) { setVideos([]); return; }
    let cancelled = false;

    const mapRecord = (r) => ({
      id: r.id, prompt: r.prompt, model: r.model,
      duration: r.duration, aspectRatio: r.ratio,
      result_url: r.result_url, status: r.status || 'completed',
      job_id: r.job_id, model_id: r.model_id,
      // Edit-Video / Motion-Control extras — survive server restart so
      // the detail modal can still show source video, refs, audio,
      // character image, motion ref video, quality, and scene_control.
      source_video_url: r.source_video_url,
      reference_image_urls: r.reference_image_urls,
      keep_audio: r.keep_audio,
      character_image_url: r.character_image_url,
      motion_video_url: r.motion_video_url,
      quality: r.quality,
      scene_control: r.scene_control,
      created_date: r.created_date,
    });

    // Page through the FULL video history (offset pagination) so nothing is
    // capped — the first page paints immediately, later pages append.
    (async () => {
      const PAGE = 200;
      let offset = 0;
      let first = true;
      for (let page = 0; page < 1000 && !cancelled; page++) {
        let records;
        try {
          records = await History_.filter({ type: 'video' }, '-created_date', PAGE, offset);
        } catch {
          break;
        }
        if (cancelled) return;
        const mapped = records.map(mapRecord);
        setVideos(prev => first ? mapped : [...prev, ...mapped]);
        first = false;
        mapped.filter(v => v.status === 'pending' && v.job_id && v.model_id)
          .forEach(v => pollVideo(v.id, v.job_id, v.model_id));
        offset += records.length;
        if (records.length < PAGE) break;
      }
    })();

    return () => { cancelled = true; };
  }, [isLoadingAuth, isAuthenticated, user?.id]);

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
  const handleGenerate = async (creditCost) => {
    if (!prompt.trim()) { toast.error('Please enter a prompt'); return; }
    if (!isAuthenticated) {
      toast.info('Please sign in to generate.');
      openAuthModal('login');
      return;
    }
    setIsGenerating(true);
    try {
      // Upload frames ONCE — same uploaded URLs reused for every variant.
      let imageUrl = null;
      let tailImageUrl = null;
      if (startFrame) imageUrl = await prepareImageForFal(startFrame, 0);
      if (endFrame) tailImageUrl = await prepareImageForFal(endFrame, 1);

      // Backend-only camera-motion injection — prompt textarea stays clean
      const finalPrompt = cameraMotion?.label
        ? `${prompt.trim()}, camera motion: ${cameraMotion.label.toLowerCase()}`
        : prompt;

      const dur = parseInt(duration) || 5;
      const ratio = aspectRatio === 'Auto' ? '16:9' : aspectRatio;
      const payload = {
        model: model.name, prompt: finalPrompt,
        duration: dur, aspect_ratio: ratio,
        credit_cost: creditCost,
        ...(imageUrl ? { image_url: imageUrl } : {}),
        ...(tailImageUrl ? { tail_image_url: tailImageUrl } : {}),
      };

      const N = Math.max(1, Math.min(4, count || 1));

      const generateOne = async () => {
        try {
          const response = await fetch('/api/generate-video', {
            method: 'POST',
            headers: authJsonHeaders(),
            body: JSON.stringify(payload),
          });
          const data = await response.json();
          if (!response.ok || !data.job_id) {
            return { ok: false, status: response.status, error: data.error };
          }
          const saved = await History_.create({
            type: 'video', model: model.name, prompt,
            job_id: data.job_id, model_id: data.model_id,
            status: 'pending', duration: dur, ratio: aspectRatio,
          });
          setVideos(prev => [{ id: saved.id, prompt, model: model.name, duration: dur, aspectRatio, status: 'pending', job_id: data.job_id, model_id: data.model_id, created_date: saved.created_date }, ...prev]);
          pollVideo(saved.id, data.job_id, data.model_id);
          return { ok: true };
        } catch (err) {
          return { ok: false, status: 0, error: err.message };
        }
      };

      const results = await Promise.allSettled(
        Array.from({ length: N }, () => generateOne())
      );
      const outcomes = results.map(r => r.status === 'fulfilled' ? r.value : { ok: false, status: 0, error: r.reason?.message });
      const successes = outcomes.filter(o => o.ok).length;
      const failures = outcomes.filter(o => !o.ok);

      if (successes === N) {
        toast.success(N === 1 ? 'Video generating — you can keep working!' : `Generating ${N} videos — you can keep working!`);
      } else if (successes > 0) {
        const first = failures[0];
        const reason = first.status === 402 ? 'not enough credits for the rest' : (first.error || 'failed');
        toast.warning(`Started ${successes} of ${N} — ${reason}`);
      } else {
        const first = failures[0] || { status: 0, error: 'Video generation failed' };
        if (first.status === 401) {
          toast.error('Your session expired — please sign in again.');
          openAuthModal('login');
        } else if (first.status === 402) {
          toast.error(first.error || 'Not enough credits — ask the admin to add more.');
        } else {
          toast.error(first.error || 'Video generation failed');
        }
      }

      // Charge happens at submit (not at poll-completion), so refresh now.
      refreshAuth();
    } catch (err) {
      toast.error(err.message || 'Video generation failed');
      refreshAuth();
    }
    finally { setIsGenerating(false); }
  };

  // ─── Motion Control (motion transfer) generate ───
  // Uploads the character image + the motion reference video once via
  // /api/upload, then POSTs to /api/motion-control. The backend
  // dispatches to the right Kling endpoint based on `model`. scene_control
  // is sent for forward-compatibility — the server omits it from the FAL
  // payload until Kling exposes the flag publicly.
  const handleMotionControl = async (creditCost) => {
    if (!motionRefVideo) { toast.error('Add a motion reference video'); return; }
    if (!motionCharImage) { toast.error('Add a character image'); return; }
    if (!isAuthenticated) {
      toast.info('Please sign in to generate.');
      openAuthModal('login');
      return;
    }
    setIsGenerating(true);
    try {
      const charUrl = await prepareImageForFal(motionCharImage, 0);
      const motionUrl = await prepareImageForFal(motionRefVideo, 1);

      const response = await fetch('/api/motion-control', {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify({
          model: motionModel,
          image_url: charUrl,
          video_url: motionUrl,
          ...(prompt?.trim() ? { prompt: prompt.trim() } : {}),
          quality: motionQuality,
          scene_control: motionSceneControl,
          credit_cost: creditCost,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.job_id) {
        if (response.status === 401) {
          toast.error('Your session expired — please sign in again.');
          openAuthModal('login');
        } else if (response.status === 402) {
          toast.error(data.error || 'Not enough credits — ask the admin to add more.');
        } else {
          toast.error(data.error || 'Motion control failed');
        }
        refreshAuth();
        return;
      }

      const saved = await History_.create({
        type: 'video', model: motionModel, prompt: prompt || '',
        job_id: data.job_id, model_id: data.model_id,
        status: 'pending',
        character_image_url: charUrl,
        motion_video_url: motionUrl,
        quality: motionQuality,
        scene_control: motionSceneControl,
      });
      setVideos(prev => [{
        id: saved.id, prompt: prompt || '', model: motionModel,
        status: 'pending', job_id: data.job_id, model_id: data.model_id,
        character_image_url: charUrl,
        motion_video_url: motionUrl,
        quality: motionQuality,
        scene_control: motionSceneControl,
        created_date: saved.created_date,
      }, ...prev]);
      pollVideo(saved.id, data.job_id, data.model_id);
      toast.success('Motion transfer rendering — you can keep working!');
      refreshAuth();
    } catch (err) {
      toast.error(err.message || 'Motion control failed');
      refreshAuth();
    } finally {
      setIsGenerating(false);
    }
  };

  // ─── Edit Video (Kling Omni Edit + Kling O1 Video Edit) generate ───
  // Uploads source video + each ref image via /api/upload (100 MB multer
  // cap covers a typical 3–10 s 1080p MP4), then POSTs the URLs to
  // /api/edit-video-omni with the chosen `editModel`. Backend dispatches
  // to the right FAL endpoint. pollVideo() handles the status loop.
  const handleEditVideo = async (creditCost) => {
    if (!editVideoFile) { toast.error('Upload a video to edit'); return; }
    if (!prompt.trim()) { toast.error('Type a prompt to describe the change'); return; }
    if (!isAuthenticated) {
      toast.info('Please sign in to generate.');
      openAuthModal('login');
      return;
    }
    setIsGenerating(true);
    try {
      const videoUrl = await prepareImageForFal(editVideoFile, 0);
      const refUrls = await Promise.all(
        (editRefImages || []).slice(0, 4).map((f, i) => prepareImageForFal(f, i + 1))
      );
      const cleanRefs = refUrls.filter(Boolean);

      const dur = parseInt(duration) || 5;
      const ratio = aspectRatio === 'Auto' ? '16:9' : aspectRatio;

      // Quality is sent only when Auto settings is OFF; backend ignores
      // unknown fields so the resolution stays at the FAL default when
      // Auto is on.
      const response = await fetch('/api/edit-video-omni', {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify({
          model: editModel,
          video_url: videoUrl,
          image_urls: cleanRefs,
          prompt: prompt.trim(),
          duration: dur,
          aspect_ratio: ratio,
          keep_audio: editKeepAudio,
          credit_cost: creditCost,
          ...(editAutoSettings ? {} : { quality: editQuality }),
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.job_id) {
        if (response.status === 401) {
          toast.error('Your session expired — please sign in again.');
          openAuthModal('login');
        } else if (response.status === 402) {
          toast.error(data.error || 'Not enough credits — ask the admin to add more.');
        } else {
          toast.error(data.error || 'Video edit failed');
        }
        refreshAuth();
        return;
      }

      const saved = await History_.create({
        type: 'video', model: editModel, prompt,
        job_id: data.job_id, model_id: data.model_id,
        status: 'pending', duration: dur, ratio,
        source_video_url: videoUrl,
        reference_image_urls: cleanRefs,
        keep_audio: editKeepAudio,
        ...(editAutoSettings ? {} : { quality: editQuality }),
      });
      setVideos(prev => [{
        id: saved.id, prompt, model: editModel,
        duration: dur, aspectRatio: ratio,
        status: 'pending', job_id: data.job_id, model_id: data.model_id,
        source_video_url: videoUrl,
        reference_image_urls: cleanRefs,
        keep_audio: editKeepAudio,
        ...(editAutoSettings ? {} : { quality: editQuality }),
        created_date: saved.created_date,
      }, ...prev]);
      pollVideo(saved.id, data.job_id, data.model_id);
      toast.success('Video editing — you can keep working!');
      refreshAuth();
    } catch (err) {
      toast.error(err.message || 'Video edit failed');
      refreshAuth();
    } finally {
      setIsGenerating(false);
    }
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
  const handleSeedanceGenerate = async (creditCost) => {
    if (!prompt.trim()) { toast.error('Please enter a prompt'); return; }
    if (!isAuthenticated) {
      toast.info('Please sign in to generate.');
      openAuthModal('login');
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

      // Seedance's image-to-video and reference-to-video are SEPARATE FAL
      // endpoints — you can't combine a start frame with reference images
      // in a single call. If the user assigned both, refuse upfront with a
      // clear toast so they know what to fix (instead of FAL silently
      // failing and us refunding the credits).
      if (hasFrames && hasRefs) {
        setIsGenerating(false);
        toast.error(
          'Seedance can use either a Start/End Frame OR Reference images — not both. ' +
          'Please remove one role from your images and try again.'
        );
        return;
      }

      const mode = hasFrames ? 'frame' : hasRefs ? 'reference' : 'text';

      console.log('[SEEDANCE] Model:', model.name, '| Mode:', mode, '| Resolution:', seedanceRes, '| Refs:', referenceUrls.length, '| Start:', !!startFrameUrl, '| End:', !!endFrameUrl);
      // Per-image role breakdown for debugging
      readyImages.forEach((img, i) => {
        console.log(`[SEEDANCE]   Image ${i+1}: role=${seedanceImageRoles[img.id] || '(none → reference)'}`);
      });

      const body = {
        model: model.name, // 'Seedance 2.0' or 'Seedance 2.0 Fast' — backend routes accordingly
        prompt,
        mode,
        duration: seedanceDuration === 'auto' ? 'auto' : String(parseInt(seedanceDuration) || 5),
        aspect_ratio: seedanceAspect,
        resolution: seedanceRes,
        generate_audio: seedanceAudioOn,
        credit_cost: creditCost,
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
        if (response.status === 401) {
          toast.error('Your session expired — please sign in again.');
          openAuthModal('login');
        } else if (response.status === 402) {
          toast.error(data.error || 'Not enough credits — ask the admin to add more.');
        } else {
          toast.error(data.error || 'Generation failed');
        }
        refreshAuth();
        return;
      }

      const saved = await History_.create({
        type: 'video', model: model.name, prompt,
        job_id: data.job_id, model_id: data.model_id,
        status: 'pending', duration: seedanceDuration, ratio: seedanceAspect,
      });

      setVideos(prev => [{ id: saved.id, prompt, model: model.name, duration: seedanceDuration, aspectRatio: seedanceAspect, status: 'pending', job_id: data.job_id, model_id: data.model_id, created_date: saved.created_date }, ...prev]);
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
    <div style={{ display: 'flex', flexDirection: 'column', background: '#0A0A0A', height: 'calc(100vh - 64px)', overflow: 'hidden', position: 'relative' }}>

      {/* Red ambient glow background — clean, no noise. zIndex 0 so the
          panels render above. Matches the brand contract from
          design_handoff_voxel — same pattern used on the Image page. */}
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

      {/* Top tab nav — Higgsfield-parity, brand red underline. The tab
          state is the source of truth for which left panel renders. */}
      <VideoTopTabs active={videoTab} onChange={setVideoTab} />

      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden', position: 'relative' }}>

      {/* LEFT — glass control panel (was on the right pre-#9). 380px wide,
          hugs the left edge. Margin flipped from `20 20 20 0` →
          `20 0 20 20`. Inner panel uses flex: 1 + min-height: 0 so the
          textarea can shrink and the GENERATE footer pins to the bottom
          regardless of viewport height (no scrolling needed). */}
      <div style={{
        position: 'relative', zIndex: 2,
        width: 380, margin: '14px 0 20px 20px',
        borderRadius: 22,
        background: 'rgba(20,18,20,0.38)',
        backdropFilter: 'blur(36px) saturate(1.4)',
        WebkitBackdropFilter: 'blur(36px) saturate(1.4)',
        border: '1px solid rgba(255,255,255,0.1)',
        boxShadow: '0 30px 80px rgba(0,0,0,0.55), 0 1px 0 rgba(255,255,255,0.12) inset, 0 0 60px rgba(224,30,30,0.08)',
        // Scroll vertically when the panel is taller than a short viewport so
        // the GENERATE footer stays reachable (was overflow:hidden → clipped).
        overflowY: 'auto', overflowX: 'hidden',
        flexShrink: 0,
        display: 'flex', flexDirection: 'column',
      }}>
        {videoTab === 'motion' ? (
          <VideoMotionControlLeftPanel
            charImage={motionCharImage} onCharImageChange={setMotionCharImage}
            motionVideo={motionRefVideo} onMotionVideoChange={setMotionRefVideo}
            quality={motionQuality} onQualityChange={setMotionQuality}
            sceneControl={motionSceneControl} onSceneControlChange={setMotionSceneControl}
            model={motionModel} onModelChange={setMotionModel}
            onGenerate={handleMotionControl} isGenerating={isGenerating}
          />
        ) : videoTab === 'edit' ? (
          <VideoEditOmniLeftPanel
            prompt={prompt} onPromptChange={setPrompt}
            videoFile={editVideoFile} onVideoFileChange={setEditVideoFile}
            refImages={editRefImages} onRefImagesChange={setEditRefImages}
            keepAudio={editKeepAudio} onKeepAudioChange={setEditKeepAudio}
            autoSettings={editAutoSettings} onAutoSettingsChange={setEditAutoSettings}
            quality={editQuality} onQualityChange={setEditQuality}
            model={editModel} onModelChange={setEditModel}
            onGenerate={handleEditVideo} isGenerating={isGenerating}
          />
        ) : isSeedance2 ? (
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
      </div>

      {/* RIGHT — feed / history. Carries the BRING IT TO LIFE hero +
          Creations/Collections pills + 3-col grid. */}
      <div style={{ position: 'relative', zIndex: 2, flex: 1, height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <VideoRightArea
          videos={videos} isGenerating={isGenerating}
          durationMs={3000} aspectRatio={isSeedance2 ? seedanceAspect : aspectRatio}
          onRecreate={(t) => setPrompt(t.prompt)}
          onVideoClick={(v) => setSelectedVideo(v)}
          modelName={videoTab === 'edit' ? editModel : videoTab === 'motion' ? motionModel : (model?.name || 'Kling 3.0')}
        />
      </div>

      </div>{/* /row */}

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
