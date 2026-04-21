import React, { useState } from 'react';
import { Lock, Film } from 'lucide-react';
import StoryboardTab from '@/components/studio/director/StoryboardTab';
import AnimateTab from '@/components/studio/director/AnimateTab';

export default function DirectorModule({ characters, locations, activeScene, onGenerateScene, isGenerating, generationProgress }) {
  const [activeTab, setActiveTab] = useState('storyboard');
  const [storyboardFrames, setStoryboardFrames] = useState([]);
  const [videoClips, setVideoClips] = useState([]);
  const [animateFrameId, setAnimateFrameId] = useState(null);

  const canAnimate = storyboardFrames.length > 0;

  const handleAnimateFrame = (frame) => {
    setAnimateFrameId(frame.id);
    setActiveTab('animate');
  };

  const handleFrameAnimated = (frameId, videoUrl, durationSec) => {
    // Mark frame as animated
    setStoryboardFrames(prev => prev.map(f => f.id === frameId ? { ...f, animated: true, video_url: videoUrl } : f));
    // Add to video clips
    const newClip = { id: `clip-${frameId}`, url: videoUrl, duration: durationSec, frameId };
    setVideoClips(prev => {
      const existing = prev.findIndex(c => c.frameId === frameId);
      if (existing >= 0) {
        const updated = [...prev];
        updated[existing] = newClip;
        return updated;
      }
      return [...prev, newClip];
    });
  };

  const tabBtn = (id, label, icon, locked) => {
    const active = activeTab === id;
    return (
      <button
        onClick={() => !locked && setActiveTab(id)}
        disabled={locked}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '9px 22px',
          borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: locked ? 'not-allowed' : 'pointer',
          fontFamily: '"DM Sans", sans-serif', transition: 'all 0.18s',
          background: active ? '#E53935' : 'rgba(255,255,255,0.05)',
          border: `1px solid ${active ? '#E53935' : 'rgba(255,255,255,0.1)'}`,
          color: active ? '#fff' : locked ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.65)',
          opacity: locked ? 0.5 : 1,
        }}
      >
        {icon} {label} {locked && <Lock size={12} style={{ opacity: 0.6 }} />}
      </button>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Tab bar */}
      <div style={{
        height: 52, borderBottom: '1px solid rgba(255,255,255,0.06)',
        display: 'flex', alignItems: 'center', padding: '0 16px', gap: 8, flexShrink: 0,
        background: 'rgba(0,0,0,0.2)',
      }}>
        {tabBtn('storyboard', 'Storyboard', '📋', false)}
        {tabBtn('animate', 'Animate', '🎬', !canAnimate)}
        {!canAnimate && (
          <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 12, marginLeft: 4 }}>
            Generate at least one scene to unlock Animate
          </span>
        )}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
        {activeTab === 'storyboard' && (
          <StoryboardTab
            characters={characters}
            locations={locations}
            storyboardFrames={storyboardFrames}
            onFramesChange={setStoryboardFrames}
            onAnimateFrame={handleAnimateFrame}
          />
        )}
        {activeTab === 'animate' && (
          <AnimateTab
            storyboardFrames={storyboardFrames}
            initialFrameId={animateFrameId}
            onFrameAnimated={handleFrameAnimated}
            onBackToStoryboard={() => setActiveTab('storyboard')}
            videoClips={videoClips}
          />
        )}
      </div>
    </div>
  );
}