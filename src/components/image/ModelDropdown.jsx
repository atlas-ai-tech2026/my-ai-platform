import React, { useState, useEffect, useRef } from 'react';
import { Check, Search, Sparkles, BarChart2, X } from 'lucide-react';

const featuredModels = [
  { id: 'soul-2', name: 'Soul 2.0', description: 'Next generation ultra-realistic fashion visuals', badge: 'NEW' },
  { id: 'seedream-5-lite', name: 'Seedream 5.0 Lite', description: 'Intelligent visual reasoning, unlimited access' },
  { id: 'seedream-4', name: 'Seedream 4.5', description: "ByteDance's next-gen 4K image model" },
  { id: 'nano-2', name: 'Nano Banana 2', description: 'Pro quality at Flash speed', badge: 'NEW', dot: true },
  { id: 'nano-pro', name: 'Nano Banana Pro', description: "Google's flagship generation model" },
  { id: 'gpt-image', name: 'GPT Image 1.5', description: 'True-color precision rendering', badge: 'PREMIUM' },
];

const otherModels = [
  { id: 'nano', name: 'Nano Banana', description: "Google's standard generation model", badge: 'PREMIUM' },
  { id: 'soul', name: 'Soul', description: 'Ultra-realistic fashion visuals' },
  { id: 'face-swap', name: 'Face Swap', description: 'Seamless face swapping' },
  { id: 'flux', name: 'Flux Kontext', description: 'Stylistic variations' },
];

const modelColors = {
  'soul-2': '#8B0000',
  'seedream-5-lite': '#1a1a8B',
  'seedream-4': '#0a3d6b',
  'nano-2': '#2d1b00',
  'nano-pro': '#E01E1E',
  'gpt-image': '#1a5c1a',
  'nano': '#555',
  'soul': '#6b1a6b',
  'face-swap': '#1a4a4a',
  'flux': '#3a1a6b',
};

export default function ModelDropdown({ selectedModelId, onSelect, onClose }) {
  const [search, setSearch] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  const filterFn = (m) => m.name.toLowerCase().includes(search.toLowerCase());
  const filteredFeatured = featuredModels.filter(filterFn);
  const filteredOther = otherModels.filter(filterFn);

  const ModelRow = ({ model }) => {
    const isSelected = selectedModelId === model.id;
    return (
      <button
        onClick={() => { onSelect(model); onClose(); }}
        className="w-full flex items-start gap-3 px-4 py-3 text-left transition-colors"
        style={{ background: isSelected ? '#252525' : undefined }}
        onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = '#222222'; }}
        onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = ''; }}
      >
        {/* Color icon */}
        <div
          className="w-7 h-7 rounded-md flex-shrink-0 mt-0.5"
          style={{ background: modelColors[model.id] || '#333' }}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {model.dot && <span className="w-1.5 h-1.5 rounded-full bg-primary inline-block" />}
            <span className="text-white font-medium text-sm">{model.name}</span>
          </div>
          <p className="text-xs mt-0.5" style={{ color: '#888' }}>{model.description}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {model.badge && (
            <span
              className="text-[10px] font-bold px-1.5 py-0.5 rounded"
              style={{
                background: model.badge === 'PREMIUM' ? 'rgba(224,30,30,0.15)' : 'rgba(255,255,255,0.08)',
                color: model.badge === 'PREMIUM' ? '#E01E1E' : '#aaa',
                border: `1px solid ${model.badge === 'PREMIUM' ? 'rgba(224,30,30,0.3)' : 'rgba(255,255,255,0.1)'}`,
              }}
            >
              {model.badge}
            </span>
          )}
          {isSelected && <Check className="w-4 h-4 text-primary" />}
        </div>
      </button>
    );
  };

  return (
    <div
      ref={ref}
      className="absolute z-50 overflow-y-auto"
      style={{
        bottom: 'calc(100% + 12px)',
        left: 0,
        width: 320,
        background: '#0A0A0A',
        border: '1px solid #2A2A2A',
        borderRadius: 14,
        boxShadow: '0 -8px 40px rgba(0,0,0,0.7)',
        maxHeight: 480,
      }}
    >
      {/* Search */}
      <div className="px-3 pt-3 pb-2">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: '#252525' }}>
          <Search className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#555' }} />
          <input
            autoFocus
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search..."
            className="bg-transparent w-full text-sm text-white outline-none placeholder:text-[#555]"
          />
        </div>
      </div>

      {/* Featured */}
      {filteredFeatured.length > 0 && (
        <>
          <div className="px-4 py-2 text-[11px] uppercase tracking-wider" style={{ color: '#555' }}>
            ✦ Featured models
          </div>
          {filteredFeatured.map(m => <ModelRow key={m.id} model={m} />)}
        </>
      )}

      {/* Other */}
      {filteredOther.length > 0 && (
        <>
          <div className="px-4 py-2 mt-1 text-[11px] uppercase tracking-wider" style={{ color: '#555', borderTop: '1px solid #2A2A2A' }}>
            📊 Other models
          </div>
          {filteredOther.map(m => <ModelRow key={m.id} model={m} />)}
        </>
      )}

      {filteredFeatured.length === 0 && filteredOther.length === 0 && (
        <div className="px-4 py-6 text-center text-sm" style={{ color: '#555' }}>No models found</div>
      )}
    </div>
  );
}