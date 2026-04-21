import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Sparkles, ChevronRight } from 'lucide-react';
import { Pill, SectionLabel, StyledInput, RedButton, GhostButton, ImageGrid, ErrorBanner, stepStyles } from './DirectorShared';

const GENDERS = ['Male', 'Female', 'Non-binary'];
const BUILDS = ['Slim', 'Athletic', 'Average', 'Heavy'];
const ETHNICITIES = ['African', 'Asian', 'Caucasian', 'Hispanic', 'Middle Eastern', 'Mixed'];
const EXPRESSIONS = [
  { label: 'Neutral', emoji: '😐' },
  { label: 'Serious', emoji: '😠' },
  { label: 'Happy', emoji: '😊' },
  { label: 'Intense', emoji: '😤' },
  { label: 'Sad', emoji: '😢' },
  { label: 'Fierce', emoji: '🔥' },
];

export default function Step1Character({ savedCharacters, onComplete }) {
  const [age, setAge] = useState('');
  const [gender, setGender] = useState('Male');
  const [ethnicity, setEthnicity] = useState('');
  const [build, setBuild] = useState('Athletic');
  const [hair, setHair] = useState('');
  const [face, setFace] = useState('');
  const [expression, setExpression] = useState('Neutral');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedImages, setGeneratedImages] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [error, setError] = useState(null);

  const canGenerate = age && ethnicity.trim() && hair.trim() && face.trim();

  const buildPrompt = () =>
    `Photorealistic cinematic portrait, close-up face shot. ${age} year old ${gender} person, ${ethnicity} ethnicity, ${build} build. Hair: ${hair}. Face: ${face}. Expression: ${expression}. Professional headshot lighting, sharp focus, 4K, ultra detailed skin texture, no text, no watermark.`;

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

  const handleUseCharacter = () => {
    if (selectedIndex === null) return;
    onComplete({
      image_url: generatedImages[selectedIndex],
      description: buildPrompt(),
      name: `${age}yo ${gender}`,
    });
  };

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }} className="hide-scrollbar">
      <style>{stepStyles}</style>
      <div style={{ maxWidth: 780, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* Row 1: demographics */}
        <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr 1fr 1fr', gap: 12 }}>
          <div>
            <SectionLabel>Age</SectionLabel>
            <input
              type="number" min={1} max={99} value={age}
              onChange={e => setAge(e.target.value)}
              placeholder="25"
              style={{
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)',
                borderRadius: 8, color: '#fff', fontSize: 13, padding: '9px 12px',
                outline: 'none', width: '100%', fontFamily: '"DM Sans", sans-serif',
              }}
              onFocus={e => e.target.style.borderColor = 'rgba(229,57,53,0.45)'}
              onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.09)'}
            />
          </div>
          <div>
            <SectionLabel>Gender</SectionLabel>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              {GENDERS.map(g => <Pill key={g} label={g} active={gender === g} onClick={() => setGender(g)} />)}
            </div>
          </div>
          <div>
            <SectionLabel>Physical Build</SectionLabel>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              {BUILDS.map(b => <Pill key={b} label={b} active={build === b} onClick={() => setBuild(b)} />)}
            </div>
          </div>
          <div>
            <SectionLabel>Ethnicity</SectionLabel>
            <StyledInput value={ethnicity} onChange={setEthnicity} placeholder="e.g. Asian" />
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 5 }}>
              {ETHNICITIES.map(e => (
                <button key={e} onClick={() => setEthnicity(e)} style={{
                  padding: '2px 8px', borderRadius: 20, fontSize: 11, cursor: 'pointer',
                  background: ethnicity === e ? 'rgba(229,57,53,0.15)' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${ethnicity === e ? 'rgba(229,57,53,0.4)' : 'rgba(255,255,255,0.07)'}`,
                  color: ethnicity === e ? '#E53935' : 'rgba(255,255,255,0.5)',
                  fontFamily: '"DM Sans", sans-serif',
                }}>{e}</button>
              ))}
            </div>
          </div>
        </div>

        {/* Row 2: hair + face */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <SectionLabel>Hair Color & Style</SectionLabel>
            <StyledInput value={hair} onChange={setHair} placeholder="e.g. short black curly hair" />
          </div>
          <div>
            <SectionLabel>Face Features</SectionLabel>
            <StyledInput value={face} onChange={setFace} placeholder="e.g. strong jawline, green eyes, freckles" />
          </div>
        </div>

        {/* Expression */}
        <div>
          <SectionLabel>Emotional Expression</SectionLabel>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {EXPRESSIONS.map(ex => (
              <button key={ex.label} onClick={() => setExpression(ex.label)} style={{
                padding: '7px 14px', borderRadius: 20, fontSize: 13, cursor: 'pointer',
                background: expression === ex.label ? 'rgba(229,57,53,0.18)' : 'rgba(255,255,255,0.05)',
                border: `1px solid ${expression === ex.label ? 'rgba(229,57,53,0.55)' : 'rgba(255,255,255,0.08)'}`,
                color: expression === ex.label ? '#E53935' : 'rgba(255,255,255,0.65)',
                fontFamily: '"DM Sans", sans-serif', fontWeight: expression === ex.label ? 600 : 400,
                transition: 'all 0.15s',
              }}>
                {ex.emoji} {ex.label}
              </button>
            ))}
          </div>
        </div>

        {/* Generate button */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <RedButton onClick={handleGenerate} disabled={isGenerating || !canGenerate} style={{ flex: 1 }}>
            <Sparkles size={16} />
            {isGenerating ? 'Generating 4 portraits...' : 'Generate Character Faces →'}
          </RedButton>
        </div>

        {error && <ErrorBanner message={error} onRetry={handleGenerate} />}

        {/* Image grid */}
        {(generatedImages.length > 0 || isGenerating) && (
          <div>
            <SectionLabel>Choose Your Character</SectionLabel>
            <ImageGrid
              images={generatedImages}
              selected={selectedIndex}
              onSelect={setSelectedIndex}
              isGenerating={isGenerating && generatedImages.length === 0}
            />
            {selectedIndex !== null && (
              <RedButton onClick={handleUseCharacter} style={{ width: '100%', marginTop: 12 }}>
                <ChevronRight size={16} /> Use This Character →
              </RedButton>
            )}
          </div>
        )}

        {/* Saved characters */}
        {savedCharacters && savedCharacters.length > 0 && (
          <div>
            <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '8px 0' }} />
            <SectionLabel>My Saved Characters</SectionLabel>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {savedCharacters.map(c => (
                <button key={c.id} onClick={() => onComplete({ image_url: c.image_url, description: c.description, name: c.name, id: c.id })} style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 10, padding: 10, cursor: 'pointer', transition: 'all 0.15s', width: 90,
                }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(229,57,53,0.4)'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; }}
                >
                  {c.image_url
                    ? <img src={c.image_url} alt={c.name} style={{ width: 60, height: 60, borderRadius: 8, objectFit: 'cover' }} />
                    : <div style={{ width: 60, height: 60, borderRadius: 8, background: '#2a0000', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>👤</div>
                  }
                  <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: 11, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' }}>{c.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}