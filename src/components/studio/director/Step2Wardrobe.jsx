import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Sparkles, ChevronRight } from 'lucide-react';
import { Pill, SectionLabel, StyledInput, StyledTextarea, RedButton, ImageGrid, ErrorBanner, LockedAssets, stepStyles } from './DirectorShared';

const OUTFIT_STYLES = ['Casual', 'Business', 'Luxury', 'Street', 'Athletic', 'Formal', 'Fantasy', 'Sci-Fi', 'Historical', 'Military', 'Swimwear', 'Custom'];
const PRESET_COLORS = ['#111', '#fff', '#1a1a2e', '#8B0000', '#2d5a27', '#1e3a5f', '#4a2040', '#8B4513', '#2f4f4f', '#ffd700'];

export default function Step2Wardrobe({ character, onComplete, onBack }) {
  const [outfitStyle, setOutfitStyle] = useState('Casual');
  const [primaryColor, setPrimaryColor] = useState('#111');
  const [customColor, setCustomColor] = useState('');
  const [outfitDesc, setOutfitDesc] = useState('');
  const [accessories, setAccessories] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedImages, setGeneratedImages] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [error, setError] = useState(null);

  const canGenerate = outfitDesc.trim();

  const buildPrompt = () => {
    const color = customColor || primaryColor;
    return `Full body portrait, photorealistic, cinematic. Same character as reference image. ${outfitStyle} style outfit. Primary clothing color: ${color}. Outfit: ${outfitDesc}. Accessories: ${accessories || 'none'}. Standing pose, neutral expression, plain background, full body visible from head to toe, 4K ultra detailed, no text.`;
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    setError(null);
    setGeneratedImages([]);
    setSelectedIndex(null);
    const prompt = buildPrompt();
    const refUrls = character?.image_url ? [character.image_url] : [];
    const results = [];
    for (let i = 0; i < 4; i++) {
      const res = await base44.integrations.Core.GenerateImage({ prompt, existing_image_urls: refUrls });
      results.push(res.url);
      setGeneratedImages([...results]);
    }
    setIsGenerating(false);
  };

  const handleLockWardrobe = () => {
    if (selectedIndex === null) return;
    onComplete({
      wardrobe_url: generatedImages[selectedIndex],
      wardrobe_desc: `${outfitStyle}: ${outfitDesc}`,
      outfit_style: outfitStyle,
    });
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <style>{stepStyles}</style>
      <LockedAssets assets={character?.image_url ? [{ url: character.image_url, label: 'Character' }] : []} />
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }} className="hide-scrollbar">
        <div style={{ maxWidth: 780, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Outfit Style */}
          <div>
            <SectionLabel>Outfit Style</SectionLabel>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {OUTFIT_STYLES.map(s => <Pill key={s} label={s} active={outfitStyle === s} onClick={() => setOutfitStyle(s)} />)}
            </div>
          </div>

          {/* Primary Color */}
          <div>
            <SectionLabel>Primary Clothing Color</SectionLabel>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {PRESET_COLORS.map(c => (
                <button key={c} onClick={() => { setPrimaryColor(c); setCustomColor(''); }} style={{
                  width: 28, height: 28, borderRadius: 6, background: c,
                  border: `2px solid ${primaryColor === c && !customColor ? '#E53935' : 'rgba(255,255,255,0.15)'}`,
                  cursor: 'pointer', transition: 'border-color 0.15s', flexShrink: 0,
                }} />
              ))}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="text" value={customColor} onChange={e => setCustomColor(e.target.value)}
                  placeholder="#hex"
                  style={{
                    width: 80, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)',
                    borderRadius: 8, color: '#fff', fontSize: 12, padding: '6px 10px',
                    outline: 'none', fontFamily: '"DM Sans", sans-serif',
                  }}
                />
                {customColor && (
                  <div style={{ width: 24, height: 24, borderRadius: 4, background: customColor, border: '1px solid rgba(255,255,255,0.2)' }} />
                )}
              </div>
            </div>
          </div>

          {/* Outfit description */}
          <div>
            <SectionLabel>Outfit Description</SectionLabel>
            <StyledTextarea value={outfitDesc} onChange={setOutfitDesc} placeholder="e.g. black leather jacket, white shirt, dark jeans, silver chain necklace" rows={2} />
          </div>

          {/* Accessories */}
          <div>
            <SectionLabel>Accessories</SectionLabel>
            <StyledInput value={accessories} onChange={setAccessories} placeholder="e.g. gold watch, sunglasses on head, black leather belt" />
          </div>

          {/* Generate */}
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={onBack} style={{
              background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)',
              borderRadius: 10, color: 'rgba(255,255,255,0.6)', fontSize: 13,
              padding: '11px 18px', cursor: 'pointer', fontFamily: '"DM Sans", sans-serif',
            }}>← Back</button>
            <RedButton onClick={handleGenerate} disabled={isGenerating || !canGenerate} style={{ flex: 1 }}>
              <Sparkles size={16} />
              {isGenerating ? 'Generating outfits...' : 'Generate Outfit →'}
            </RedButton>
          </div>

          {error && <ErrorBanner message={error} onRetry={handleGenerate} />}

          {(generatedImages.length > 0 || isGenerating) && (
            <div>
              <SectionLabel>Choose the Outfit</SectionLabel>
              <ImageGrid
                images={generatedImages}
                selected={selectedIndex}
                onSelect={setSelectedIndex}
                isGenerating={isGenerating && generatedImages.length === 0}
              />
              {selectedIndex !== null && (
                <RedButton onClick={handleLockWardrobe} style={{ width: '100%', marginTop: 12 }}>
                  <ChevronRight size={16} /> Lock Wardrobe ✓ →
                </RedButton>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}