import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Sparkles, RefreshCw, ChevronRight, ChevronDown } from 'lucide-react';
import { Pill, SectionLabel, StyledTextarea, StyledInput, RedButton, GhostButton, ErrorBanner, LockedAssets, stepStyles } from './DirectorShared';

const CAMERA_ANGLES = ['Wide Shot', 'Medium Shot', 'Close-Up', 'Extreme Close-Up', 'Over the Shoulder', "Bird's Eye View", 'Low Angle', 'Dutch Angle', 'POV'];
const LIGHTING = ['Natural', 'Cinematic', 'Golden Hour', 'Night', 'Studio', 'Dramatic', 'Neon', 'Backlit', 'Foggy', 'Harsh Midday'];
const COLOR_GRADES = ['None', 'Warm Orange', 'Cool Blue', 'Desaturated', 'High Contrast', 'Vintage Film', 'Teal & Orange', 'Black & White', 'Neon Cyberpunk'];

export default function Step5DirectShot({ character, wardrobe, location, composed, onComplete, onBack }) {
  const [cameraAngle, setCameraAngle] = useState('Medium Shot');
  const [lighting, setLighting] = useState('Cinematic');
  const [colorGrade, setColorGrade] = useState('None');
  const [sceneAction, setSceneAction] = useState('');
  const [extraDirection, setExtraDirection] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [outputUrl, setOutputUrl] = useState(null);
  const [error, setError] = useState(null);

  const buildPrompt = () => {
    const parts = [];
    parts.push(`Cinematic ${cameraAngle} shot`);
    parts.push(`${lighting} lighting`);
    if (colorGrade !== 'None') parts.push(`${colorGrade} color grade`);
    const charDesc = wardrobe?.wardrobe_desc || character?.description || '';
    if (charDesc) parts.push(charDesc);
    if (sceneAction) parts.push(`Action: ${sceneAction}`);
    if (extraDirection) parts.push(extraDirection);
    parts.push('photorealistic, 4K, ultra detailed, no text, no watermark');
    return parts.join(', ');
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    setError(null);
    const prompt = buildPrompt();
    const refs = [];
    if (composed?.composed_url) refs.push(composed.composed_url);
    else if (wardrobe?.wardrobe_url) refs.push(wardrobe.wardrobe_url);
    if (location?.location_url) refs.push(location.location_url);
    const res = await base44.integrations.Core.GenerateImage({ prompt, existing_image_urls: refs });
    setOutputUrl(res.url);
    setIsGenerating(false);
  };

  const livePrompt = buildPrompt();

  const lockedAssets = [];
  if (composed?.composed_url) lockedAssets.push({ url: composed.composed_url, label: 'Scene', wide: true });
  else if (character?.image_url) lockedAssets.push({ url: character.image_url, label: 'Character' });

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <style>{stepStyles}</style>
      <LockedAssets assets={lockedAssets} />
      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
        {/* Left controls */}
        <div style={{ width: 320, borderRight: '1px solid rgba(255,255,255,0.06)', padding: '16px 14px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }} className="hide-scrollbar">
          <div>
            <SectionLabel>Camera Angle</SectionLabel>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {CAMERA_ANGLES.map(a => <Pill key={a} label={a} active={cameraAngle === a} onClick={() => setCameraAngle(a)} />)}
            </div>
          </div>
          <div>
            <SectionLabel>Lighting Style</SectionLabel>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {LIGHTING.map(l => <Pill key={l} label={l} active={lighting === l} onClick={() => setLighting(l)} />)}
            </div>
          </div>
          <div>
            <SectionLabel>Color Grade</SectionLabel>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {COLOR_GRADES.map(g => <Pill key={g} label={g} active={colorGrade === g} onClick={() => setColorGrade(g)} />)}
            </div>
          </div>
          <div>
            <SectionLabel>Scene Action</SectionLabel>
            <StyledTextarea value={sceneAction} onChange={setSceneAction} placeholder="e.g. walking slowly toward camera, glancing back over shoulder" rows={2} />
          </div>
          <div>
            <SectionLabel>Additional Direction</SectionLabel>
            <StyledTextarea value={extraDirection} onChange={setExtraDirection} placeholder="e.g. shallow depth of field, bokeh background, film grain, anamorphic lens flare" rows={2} />
          </div>
          {/* Live prompt */}
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8, padding: 10 }}>
            <div style={{ color: 'rgba(255,255,255,0.25)', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 5 }}>Live Prompt Preview</div>
            <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, lineHeight: 1.6, fontFamily: '"JetBrains Mono", monospace' }}>{livePrompt}</div>
          </div>
        </div>

        {/* Right canvas */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 20, gap: 14, overflow: 'hidden' }}>
          <div style={{
            flex: 1, background: '#0D0D0D', borderRadius: 12,
            border: '1px solid rgba(255,255,255,0.07)', overflow: 'hidden',
            position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center',
            maxHeight: 380,
          }}>
            {isGenerating ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
                <div style={{ width: 48, height: 48, border: '3px solid rgba(255,255,255,0.08)', borderTopColor: '#E53935', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14 }}>Generating directed shot...</div>
              </div>
            ) : outputUrl ? (
              <img src={outputUrl} alt="Directed shot" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            ) : composed?.composed_url ? (
              <img src={composed.composed_url} alt="Composed scene" style={{ width: '100%', height: '100%', objectFit: 'contain', opacity: 0.5 }} />
            ) : (
              <div style={{ color: 'rgba(255,255,255,0.2)', fontSize: 14, textAlign: 'center', padding: 24 }}>
                <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.3 }}>🎬</div>
                Configure your shot and generate
              </div>
            )}
          </div>

          {error && <ErrorBanner message={error} onRetry={handleGenerate} />}

          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={onBack} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 10, color: 'rgba(255,255,255,0.6)', fontSize: 13, padding: '11px 18px', cursor: 'pointer', fontFamily: '"DM Sans", sans-serif' }}>← Back</button>
            {outputUrl && (
              <GhostButton onClick={handleGenerate} disabled={isGenerating}>
                <RefreshCw size={14} /> Regenerate
              </GhostButton>
            )}
            {outputUrl && (
              <GhostButton onClick={() => setOutputUrl(null)}>
                Adjust
              </GhostButton>
            )}
            <RedButton
              onClick={outputUrl ? () => onComplete({ shot_url: outputUrl }) : handleGenerate}
              disabled={isGenerating}
              style={{ flex: 1 }}
            >
              <Sparkles size={16} />
              {isGenerating ? 'Generating...' : outputUrl ? 'This is perfect — Generate Video →' : 'Generate Scene Image →'}
            </RedButton>
          </div>
        </div>
      </div>
    </div>
  );
}