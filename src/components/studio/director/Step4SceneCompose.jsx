import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { RefreshCw, ChevronRight } from 'lucide-react';
import { Pill, SectionLabel, StyledTextarea, RedButton, GhostButton, ErrorBanner, LockedAssets, stepStyles } from './DirectorShared';

const POSITIONS = ['Left', 'Center', 'Right'];
const FRAMINGS = ['Full Body', 'Waist Up', 'Close-Up'];

export default function Step4SceneCompose({ character, wardrobe, location, onComplete, onBack }) {
  const [position, setPosition] = useState('Center');
  const [framing, setFraming] = useState('Full Body');
  const [pose, setPose] = useState('');
  const [composedUrl, setComposedUrl] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState(null);

  const buildPrompt = () => {
    const charDesc = wardrobe?.wardrobe_desc || character?.description || 'person';
    const locDesc = location?.location_name || 'environment';
    return `Cinematic ${framing} shot. Character placed ${position} of frame in ${locDesc}. ${charDesc}. ${pose ? `Pose: ${pose}.` : ''} Natural lighting matching location, photorealistic, 4K, no text.`;
  };

  useEffect(() => {
    // Auto-generate on mount
    handleGenerate();
  }, []);

  const handleGenerate = async () => {
    setIsGenerating(true);
    setError(null);
    const prompt = buildPrompt();
    const refs = [];
    if (wardrobe?.wardrobe_url) refs.push(wardrobe.wardrobe_url);
    else if (character?.image_url) refs.push(character.image_url);
    if (location?.location_url) refs.push(location.location_url);
    const res = await base44.integrations.Core.GenerateImage({ prompt, existing_image_urls: refs });
    setComposedUrl(res.url);
    setIsGenerating(false);
  };

  const handleContinue = () => {
    onComplete({ composed_url: composedUrl });
  };

  const lockedAssets = [];
  if (character?.image_url) lockedAssets.push({ url: character.image_url, label: 'Character' });
  if (wardrobe?.wardrobe_url) lockedAssets.push({ url: wardrobe.wardrobe_url, label: 'Wardrobe', wide: true });
  if (location?.location_url) lockedAssets.push({ url: location.location_url, label: 'Location', wide: true });

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <style>{stepStyles}</style>
      <LockedAssets assets={lockedAssets} />
      <div style={{ flex: 1, display: 'flex', gap: 0, minHeight: 0, overflow: 'hidden' }}>
        {/* Center canvas */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 20, gap: 14, overflow: 'hidden' }}>
          {/* 16:9 canvas */}
          <div style={{
            flex: 1, background: '#0D0D0D', borderRadius: 12,
            border: '1px solid rgba(255,255,255,0.07)', overflow: 'hidden',
            position: 'relative', minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            aspectRatio: '16/9', maxHeight: 420,
          }}>
            {isGenerating && (
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: '#1a1a1a', zIndex: 10 }}>
                <div style={{ height: '100%', width: '70%', background: '#E53935', boxShadow: '0 0 10px rgba(229,57,53,0.6)', animation: 'composePulse 1.5s ease-in-out infinite' }} />
                <style>{`@keyframes composePulse { 0%,100%{opacity:0.7;} 50%{opacity:1;} }`}</style>
              </div>
            )}
            {isGenerating ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
                <div style={{ width: 48, height: 48, border: '3px solid rgba(255,255,255,0.08)', borderTopColor: '#E53935', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14 }}>Composing scene...</div>
              </div>
            ) : composedUrl ? (
              <img src={composedUrl} alt="Composed scene" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            ) : (
              <div style={{ color: 'rgba(255,255,255,0.2)', fontSize: 14 }}>Composing your scene...</div>
            )}
          </div>

          {/* Controls */}
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            <div>
              <SectionLabel>Character Position</SectionLabel>
              <div style={{ display: 'flex', gap: 5 }}>
                {POSITIONS.map(p => <Pill key={p} label={p} active={position === p} onClick={() => setPosition(p)} />)}
              </div>
            </div>
            <div>
              <SectionLabel>Shot Framing</SectionLabel>
              <div style={{ display: 'flex', gap: 5 }}>
                {FRAMINGS.map(f => <Pill key={f} label={f} active={framing === f} onClick={() => setFraming(f)} />)}
              </div>
            </div>
          </div>

          <div>
            <SectionLabel>Character Pose</SectionLabel>
            <StyledTextarea value={pose} onChange={setPose} placeholder="e.g. standing with arms crossed, looking at camera" rows={2} />
          </div>

          {error && <ErrorBanner message={error} onRetry={handleGenerate} />}

          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={onBack} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 10, color: 'rgba(255,255,255,0.6)', fontSize: 13, padding: '11px 18px', cursor: 'pointer', fontFamily: '"DM Sans", sans-serif' }}>← Back</button>
            <GhostButton onClick={handleGenerate} disabled={isGenerating}>
              <RefreshCw size={14} /> {isGenerating ? 'Recomposing...' : 'Recompose Scene'}
            </GhostButton>
            <RedButton onClick={handleContinue} disabled={!composedUrl || isGenerating} style={{ flex: 1 }}>
              <ChevronRight size={16} /> This looks good — Direct the Shot →
            </RedButton>
          </div>
        </div>

        {/* Right reference panel */}
        <div style={{ width: 180, borderLeft: '1px solid rgba(255,255,255,0.06)', padding: '20px 14px', display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto' }} className="hide-scrollbar">
          <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>References</div>
          {character?.image_url && (
            <div>
              <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10, marginBottom: 5 }}>Character</div>
              <img src={character.image_url} alt="" style={{ width: '100%', aspectRatio: '3/4', objectFit: 'cover', borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)' }} />
            </div>
          )}
          {(wardrobe?.wardrobe_url || character?.image_url) && (
            <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontSize: 18 }}>+</div>
          )}
          {location?.location_url && (
            <div>
              <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10, marginBottom: 5 }}>Location</div>
              <img src={location.location_url} alt="" style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)' }} />
            </div>
          )}
          {composedUrl && (
            <>
              <div style={{ height: 1, background: 'rgba(255,255,255,0.06)' }} />
              <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10, marginBottom: 5 }}>Composed</div>
              <img src={composedUrl} alt="" style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', borderRadius: 8, border: '1px solid rgba(229,57,53,0.3)' }} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}