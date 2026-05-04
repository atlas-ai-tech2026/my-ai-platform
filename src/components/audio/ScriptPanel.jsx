// Glass-shell right column on the Audio page.
//
// Composition only — every slider, picker, and the textarea live in
// their own files. ScriptPanel just wires props into them and owns the
// layout + the SYNTHESIZE CTA.
import React from 'react';
import VoicePicker from './VoicePicker';
import LanguagePicker from './LanguagePicker';
import AudioModelPicker from './AudioModelPicker';
import GradientSlider from './GradientSlider';
import ScriptTextarea from './ScriptTextarea';

const RED_HOT = '#FF2A2A';
const RED_DEEP = '#8B0F0F';

export default function ScriptPanel({
  voice, onVoiceChange,
  language, onLanguageChange,
  model, onModelChange,
  script, onScriptChange,
  highlighted, onHighlightChange,
  stability, onStabilityChange,
  similarity, onSimilarityChange,
  style, onStyleChange,
  onSynthesize, isSynthesizing,
}) {
  // V3 schema only honours stability + language. We let the user move the
  // other two sliders so the UI doesn't lie about state, but mark them as
  // ignored and skip them server-side. Switching to Multilingual V2
  // re-enables the full trio.
  const isV3 = (model || 'eleven-v3') === 'eleven-v3';
  const ignoreHint = 'Eleven V3 ignores this. Switch to Multilingual V2 to use it.';

  return (
    <div className="voxel-script-scroll" style={{
      background: 'rgba(20,18,20,0.38)',
      backdropFilter: 'blur(36px) saturate(1.4)',
      WebkitBackdropFilter: 'blur(36px) saturate(1.4)',
      border: '1px solid rgba(255,255,255,0.10)',
      boxShadow: '0 30px 80px rgba(0,0,0,0.55), 0 1px 0 rgba(255,255,255,0.10) inset, 0 0 60px rgba(224,30,30,0.08)',
      borderRadius: 18,
      padding: 14,
      display: 'flex', flexDirection: 'column', gap: 9,
      minHeight: 0,
      overflowY: 'auto',
      // Same scroll-containment trick as the voice picker — wheel
      // events scroll THIS panel and don't leak up to the page.
      overscrollBehavior: 'contain',
    }}>
      <style>{`
        /* Visible custom scrollbar so the user has an obvious affordance
           when the panel content overflows (textarea + sliders + Synthesize
           CTA together can run past the viewport on shorter screens). */
        .voxel-script-scroll {
          scrollbar-width: thin;
          scrollbar-color: rgba(224,30,30,0.6) rgba(255,255,255,0.05);
        }
        .voxel-script-scroll::-webkit-scrollbar { width: 8px; }
        .voxel-script-scroll::-webkit-scrollbar-track {
          background: rgba(255,255,255,0.04);
          border-radius: 999px;
        }
        .voxel-script-scroll::-webkit-scrollbar-thumb {
          background: linear-gradient(180deg, rgba(224,30,30,0.7), rgba(139,15,15,0.7));
          border-radius: 999px;
        }
      `}</style>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#FFF' }}>Script</div>

      <VoicePicker value={voice} onChange={onVoiceChange} />
      <LanguagePicker value={language} onChange={onLanguageChange} />

      <ScriptTextarea
        value={script}
        onChange={onScriptChange}
        highlighted={highlighted}
        onHighlightChange={onHighlightChange}
      />

      <AudioModelPicker value={model} onChange={onModelChange} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <GradientSlider label="Stability"  value={stability}  onChange={onStabilityChange} />
        <GradientSlider label="Similarity" value={similarity} onChange={onSimilarityChange} disabled={isV3} disabledHint={ignoreHint} />
        <GradientSlider label="Style"      value={style}      onChange={onStyleChange}      disabled={isV3} disabledHint={ignoreHint} />
      </div>

      <button
        type="button"
        onClick={onSynthesize}
        disabled={isSynthesizing}
        style={{
          padding: '11px 0',
          borderRadius: 10,
          border: 'none',
          background: isSynthesizing
            ? 'rgba(139,15,15,0.6)'
            : `linear-gradient(180deg, ${RED_HOT}, ${RED_DEEP})`,
          color: '#FFF',
          fontFamily: 'Anton, sans-serif',
          fontSize: 13, fontWeight: 700,
          letterSpacing: '0.06em', textTransform: 'uppercase',
          cursor: isSynthesizing ? 'not-allowed' : 'pointer',
          boxShadow: isSynthesizing ? 'none' : `
            0 0 24px rgba(224,30,30,0.55),
            0 4px 14px rgba(139,15,15,0.5),
            inset 0 1px 0 rgba(255,255,255,0.25)
          `,
          transition: 'box-shadow 0.18s, transform 0.1s',
        }}
        onMouseEnter={e => {
          if (isSynthesizing) return;
          e.currentTarget.style.boxShadow = '0 0 32px rgba(224,30,30,0.7), 0 6px 18px rgba(139,15,15,0.6), inset 0 1px 0 rgba(255,255,255,0.3)';
        }}
        onMouseLeave={e => {
          if (isSynthesizing) return;
          e.currentTarget.style.boxShadow = '0 0 24px rgba(224,30,30,0.55), 0 4px 14px rgba(139,15,15,0.5), inset 0 1px 0 rgba(255,255,255,0.25)';
        }}
        onMouseDown={e => { if (!isSynthesizing) e.currentTarget.style.transform = 'translateY(1px)'; }}
        onMouseUp={e => { if (!isSynthesizing) e.currentTarget.style.transform = 'none'; }}
      >
        {isSynthesizing ? 'Synthesizing…' : 'Synthesize'}
      </button>
    </div>
  );
}
