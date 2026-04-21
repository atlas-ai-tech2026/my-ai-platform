import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Sparkles, ChevronRight } from 'lucide-react';
import { Pill, SectionLabel, StyledTextarea, RedButton, ImageGrid, ErrorBanner, LockedAssets, stepStyles } from './DirectorShared';

const LOCATION_TYPES = ['Interior', 'Exterior'];
const ENVIRONMENTS = ['City Street', 'Forest', 'Beach', 'Desert', 'Office', 'Luxury Home', 'Studio', 'Rooftop', 'Underground', 'Space', 'Fantasy World', 'Historical', 'Custom'];
const TIMES = ['Dawn', 'Morning', 'Midday', 'Golden Hour', 'Sunset', 'Night', 'Midnight'];
const WEATHER = ['Clear', 'Cloudy', 'Rain', 'Heavy Rain', 'Snow', 'Fog', 'Storm', 'Heatwave'];

export default function Step3Location({ character, wardrobe, onComplete, onBack }) {
  const [locationType, setLocationType] = useState('Exterior');
  const [environment, setEnvironment] = useState('City Street');
  const [timeOfDay, setTimeOfDay] = useState('Golden Hour');
  const [weather, setWeather] = useState('Clear');
  const [mood, setMood] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedImages, setGeneratedImages] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [error, setError] = useState(null);

  const buildPrompt = () =>
    `${locationType} establishing shot, ${environment} environment, ${timeOfDay} lighting, ${weather} weather. ${mood ? `Atmosphere: ${mood}.` : ''} Wide cinematic shot, no people, photorealistic, 4K, ultra detailed, no text, no watermark. Cinematic composition, professional photography.`;

  const handleGenerate = async () => {
    setIsGenerating(true);
    setError(null);
    setGeneratedImages([]);
    setSelectedIndex(null);
    const prompt = buildPrompt();
    const results = [];
    for (let i = 0; i < 4; i++) {
      const res = await base44.integrations.Core.GenerateImage({ prompt });
      results.push(res.url);
      setGeneratedImages([...results]);
    }
    setIsGenerating(false);
  };

  const handleLockLocation = () => {
    if (selectedIndex === null) return;
    onComplete({
      location_url: generatedImages[selectedIndex],
      location_name: environment,
      location_desc: buildPrompt(),
    });
  };

  const lockedAssets = [];
  if (character?.image_url) lockedAssets.push({ url: character.image_url, label: 'Character' });
  if (wardrobe?.wardrobe_url) lockedAssets.push({ url: wardrobe.wardrobe_url, label: 'Wardrobe', wide: true });

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <style>{stepStyles}</style>
      <LockedAssets assets={lockedAssets} />
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }} className="hide-scrollbar">
        <div style={{ maxWidth: 780, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            <div>
              <SectionLabel>Location Type</SectionLabel>
              <div style={{ display: 'flex', gap: 6 }}>
                {LOCATION_TYPES.map(t => <Pill key={t} label={t} active={locationType === t} onClick={() => setLocationType(t)} />)}
              </div>
            </div>
            <div>
              <SectionLabel>Time of Day</SectionLabel>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {TIMES.map(t => <Pill key={t} label={t} active={timeOfDay === t} onClick={() => setTimeOfDay(t)} />)}
              </div>
            </div>
          </div>

          <div>
            <SectionLabel>Environment</SectionLabel>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {ENVIRONMENTS.map(e => <Pill key={e} label={e} active={environment === e} onClick={() => setEnvironment(e)} />)}
            </div>
          </div>

          <div>
            <SectionLabel>Weather</SectionLabel>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {WEATHER.map(w => <Pill key={w} label={w} active={weather === w} onClick={() => setWeather(w)} />)}
            </div>
          </div>

          <div>
            <SectionLabel>Mood / Atmosphere</SectionLabel>
            <StyledTextarea value={mood} onChange={setMood} placeholder="e.g. neon-lit rainy Tokyo back alley, dark and moody, puddle reflections" rows={2} />
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={onBack} style={{
              background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)',
              borderRadius: 10, color: 'rgba(255,255,255,0.6)', fontSize: 13,
              padding: '11px 18px', cursor: 'pointer', fontFamily: '"DM Sans", sans-serif',
            }}>← Back</button>
            <RedButton onClick={handleGenerate} disabled={isGenerating} style={{ flex: 1 }}>
              <Sparkles size={16} />
              {isGenerating ? 'Generating locations...' : 'Generate Locations →'}
            </RedButton>
          </div>

          {error && <ErrorBanner message={error} onRetry={handleGenerate} />}

          {(generatedImages.length > 0 || isGenerating) && (
            <div>
              <SectionLabel>Choose Your Location</SectionLabel>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {(isGenerating && generatedImages.length === 0 ? [0, 1, 2, 3] : generatedImages).map((url, i) => (
                  isGenerating && generatedImages.length === 0
                    ? <div key={i} style={{ aspectRatio: '16/9', background: 'rgba(255,255,255,0.03)', borderRadius: 10, border: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <div style={{ width: 24, height: 24, border: '2px solid rgba(229,57,53,0.3)', borderTopColor: '#E53935', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                      </div>
                    : <button key={i} onClick={() => setSelectedIndex(i)} style={{
                        position: 'relative', aspectRatio: '16/9', borderRadius: 10, overflow: 'hidden',
                        border: `2px solid ${selectedIndex === i ? '#E53935' : 'rgba(255,255,255,0.07)'}`,
                        cursor: 'pointer', padding: 0, transition: 'border-color 0.2s',
                        boxShadow: selectedIndex === i ? '0 0 16px rgba(229,57,53,0.35)' : 'none',
                      }}>
                        <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        {selectedIndex === i && (
                          <div style={{ position: 'absolute', bottom: 6, left: '50%', transform: 'translateX(-50%)', background: '#E53935', borderRadius: 20, padding: '3px 10px', fontSize: 11, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap' }}>Selected ✓</div>
                        )}
                      </button>
                ))}
              </div>
              {selectedIndex !== null && (
                <RedButton onClick={handleLockLocation} style={{ width: '100%', marginTop: 12 }}>
                  <ChevronRight size={16} /> Lock Location ✓ →
                </RedButton>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}