import React from 'react';
import { Lock } from 'lucide-react';

// Reusable Pill/Chip selector
export const Pill = ({ label, active, onClick, disabled }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    style={{
      padding: '5px 13px', borderRadius: 20, fontSize: 12, cursor: disabled ? 'default' : 'pointer',
      background: active ? 'rgba(229,57,53,0.18)' : 'rgba(255,255,255,0.05)',
      border: `1px solid ${active ? 'rgba(229,57,53,0.55)' : 'rgba(255,255,255,0.08)'}`,
      color: active ? '#E53935' : 'rgba(255,255,255,0.65)',
      transition: 'all 0.15s', fontFamily: '"DM Sans", sans-serif', whiteSpace: 'nowrap',
      fontWeight: active ? 600 : 400,
    }}
  >{label}</button>
);

// Section label
export const SectionLabel = ({ children }) => (
  <div style={{
    color: 'rgba(255,255,255,0.35)', fontSize: 10, fontWeight: 700,
    letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 7,
  }}>
    {children}
  </div>
);

// Text input
export const StyledInput = ({ value, onChange, placeholder, style }) => (
  <input
    value={value}
    onChange={e => onChange(e.target.value)}
    placeholder={placeholder}
    style={{
      background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)',
      borderRadius: 8, color: '#fff', fontSize: 13, padding: '9px 12px',
      outline: 'none', width: '100%', fontFamily: '"DM Sans", sans-serif',
      transition: 'border-color 0.2s', ...style,
    }}
    onFocus={e => e.target.style.borderColor = 'rgba(229,57,53,0.45)'}
    onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.09)'}
  />
);

// Textarea
export const StyledTextarea = ({ value, onChange, placeholder, rows = 2 }) => (
  <textarea
    value={value}
    onChange={e => onChange(e.target.value)}
    placeholder={placeholder}
    rows={rows}
    style={{
      background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)',
      borderRadius: 8, color: '#fff', fontSize: 13, padding: '9px 12px',
      outline: 'none', width: '100%', fontFamily: '"DM Sans", sans-serif',
      resize: 'none', lineHeight: 1.6, transition: 'border-color 0.2s',
    }}
    onFocus={e => e.target.style.borderColor = 'rgba(229,57,53,0.45)'}
    onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.09)'}
  />
);

// Red primary action button
export const RedButton = ({ children, onClick, disabled, style }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    style={{
      background: disabled ? 'rgba(229,57,53,0.3)' : '#E53935',
      border: 'none', borderRadius: 10, color: '#fff', fontSize: 14, fontWeight: 700,
      cursor: disabled ? 'not-allowed' : 'pointer', padding: '11px 20px',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      fontFamily: '"DM Sans", sans-serif', transition: 'all 0.18s',
      boxShadow: disabled ? 'none' : '0 0 20px rgba(229,57,53,0.3)', ...style,
    }}
    onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = '#ff2222'; }}
    onMouseLeave={e => { if (!disabled) e.currentTarget.style.background = '#E53935'; }}
  >{children}</button>
);

// Ghost secondary button
export const GhostButton = ({ children, onClick, style }) => (
  <button
    onClick={onClick}
    style={{
      background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: 8, color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: 500,
      cursor: 'pointer', padding: '9px 16px',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
      fontFamily: '"DM Sans", sans-serif', transition: 'all 0.15s', ...style,
    }}
    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.09)'; e.currentTarget.style.color = '#fff'; }}
    onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = 'rgba(255,255,255,0.7)'; }}
  >{children}</button>
);

// 4-image selection grid
export const ImageGrid = ({ images, selected, onSelect, isGenerating }) => (
  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
    {isGenerating
      ? [0, 1, 2, 3].map(i => (
          <div key={i} style={{
            aspectRatio: '3/4', background: 'rgba(255,255,255,0.03)',
            borderRadius: 10, border: '1px solid rgba(255,255,255,0.07)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            animation: 'shimmer 1.5s ease-in-out infinite',
          }}>
            <div style={{ width: 28, height: 28, borderRadius: '50%', border: '2px solid rgba(229,57,53,0.3)', borderTopColor: '#E53935', animation: 'spin 0.8s linear infinite' }} />
          </div>
        ))
      : images.map((url, i) => (
          <button
            key={i}
            onClick={() => onSelect(i)}
            style={{
              position: 'relative', aspectRatio: '3/4', borderRadius: 10, overflow: 'hidden', cursor: 'pointer', padding: 0,
              border: `2px solid ${selected === i ? '#E53935' : 'rgba(255,255,255,0.07)'}`,
              transition: 'border-color 0.2s',
              boxShadow: selected === i ? '0 0 16px rgba(229,57,53,0.35)' : 'none',
            }}
          >
            <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            {selected === i && (
              <div style={{
                position: 'absolute', bottom: 6, left: '50%', transform: 'translateX(-50%)',
                background: '#E53935', borderRadius: 20, padding: '3px 10px',
                fontSize: 11, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap',
              }}>Selected ✓</div>
            )}
          </button>
        ))
    }
  </div>
);

// Locked asset thumbnail strip
export const LockedAssets = ({ assets }) => {
  if (!assets || assets.length === 0) return null;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '8px 12px', background: 'rgba(0,0,0,0.3)',
      borderBottom: '1px solid rgba(255,255,255,0.05)', flexShrink: 0,
    }}>
      {assets.map((a, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ position: 'relative' }}>
            <img src={a.url} alt={a.label} style={{
              width: a.wide ? 56 : 36, height: 36, objectFit: 'cover',
              borderRadius: 6, border: '1px solid rgba(229,57,53,0.35)',
            }} />
            <Lock size={9} style={{ position: 'absolute', bottom: 2, right: 2, color: '#E53935' }} />
          </div>
          <div>
            <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{a.label}</div>
            <div style={{ color: '#4CAF50', fontSize: 10, fontWeight: 600 }}>locked ✓</div>
          </div>
          {i < assets.length - 1 && <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.07)', marginLeft: 4 }} />}
        </div>
      ))}
    </div>
  );
};

// Generation error banner
export const ErrorBanner = ({ message, onRetry }) => (
  <div style={{
    background: 'rgba(229,57,53,0.1)', border: '1px solid rgba(229,57,53,0.3)',
    borderRadius: 8, padding: '10px 14px', display: 'flex', alignItems: 'center',
    justifyContent: 'space-between', gap: 12,
  }}>
    <span style={{ color: '#ff6b6b', fontSize: 13 }}>⚠ {message}</span>
    <button onClick={onRetry} style={{
      background: '#E53935', border: 'none', borderRadius: 6, color: '#fff',
      fontSize: 12, fontWeight: 600, padding: '5px 12px', cursor: 'pointer',
      fontFamily: '"DM Sans", sans-serif',
    }}>Try Again</button>
  </div>
);

export const stepStyles = `
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes shimmer {
    0%, 100% { opacity: 0.4; }
    50% { opacity: 0.7; }
  }
`;