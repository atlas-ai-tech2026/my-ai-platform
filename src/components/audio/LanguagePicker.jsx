// Language picker for the Audio page. Sends an ISO 639-1 code to the
// backend (`language_code`) which forwards it to ElevenLabs. The
// special `'auto'` value tells the server NOT to send a language_code,
// letting the model auto-detect.
//
// Same popover shell as VoicePicker so the two pickers stack visually
// in the Script panel.
import React, { useState, useRef, useEffect } from 'react';
import { Check, Globe, ChevronRight } from 'lucide-react';

const RED = '#E01E1E';

// 16 most common languages on ElevenLabs's V3 + Multilingual roster.
// Order: Auto first, then English, then alphabetical by native label.
const LANGUAGES = [
  { code: 'auto', label: 'Auto-detect', native: 'Auto'        },
  { code: 'en',   label: 'English',     native: 'English'      },
  { code: 'ar',   label: 'Arabic',      native: 'العربية'       },
  { code: 'zh',   label: 'Chinese',     native: '中文'         },
  { code: 'nl',   label: 'Dutch',       native: 'Nederlands'   },
  { code: 'fr',   label: 'French',      native: 'Français'     },
  { code: 'de',   label: 'German',      native: 'Deutsch'      },
  { code: 'hi',   label: 'Hindi',       native: 'हिन्दी'        },
  { code: 'it',   label: 'Italian',     native: 'Italiano'     },
  { code: 'ja',   label: 'Japanese',    native: '日本語'        },
  { code: 'ko',   label: 'Korean',      native: '한국어'         },
  { code: 'pl',   label: 'Polish',      native: 'Polski'       },
  { code: 'pt',   label: 'Portuguese',  native: 'Português'    },
  { code: 'ru',   label: 'Russian',     native: 'Русский'      },
  { code: 'es',   label: 'Spanish',     native: 'Español'      },
  { code: 'tr',   label: 'Turkish',     native: 'Türkçe'       },
];

export default function LanguagePicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const current = LANGUAGES.find(l => l.code === value) || LANGUAGES[0];

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%',
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '8px 12px',
          borderRadius: 12,
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
          cursor: 'pointer',
          textAlign: 'left',
          transition: 'filter 0.15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.filter = 'brightness(1.1)'; }}
        onMouseLeave={e => { e.currentTarget.style.filter = 'none'; }}
      >
        <div style={{
          width: 32, height: 32, borderRadius: '50%',
          background: 'rgba(255,255,255,0.06)',
          border: '1px solid rgba(255,255,255,0.12)',
          flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Globe style={{ width: 14, height: 14, color: RED }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: 10, color: 'rgba(255,255,255,0.55)',
            letterSpacing: '0.06em', textTransform: 'uppercase',
          }}>Language</div>
          <div style={{
            fontSize: 13, fontWeight: 600, color: '#FFF',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{current.native} {current.code !== 'auto' && (
            <span style={{
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: 10, color: 'rgba(255,255,255,0.5)',
            }}>· {current.code.toUpperCase()}</span>
          )}</div>
        </div>
        <ChevronRight style={{ width: 16, height: 16, color: 'rgba(255,255,255,0.5)' }} />
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0,
          background: 'rgba(20,18,20,0.97)',
          backdropFilter: 'blur(20px)',
          border: '1px solid rgba(255,255,255,0.10)',
          borderRadius: 14,
          boxShadow: '0 18px 48px rgba(0,0,0,0.55)',
          zIndex: 30,
          maxHeight: 320, overflowY: 'auto',
          padding: 6,
        }}>
          {LANGUAGES.map(l => {
            const isActive = l.code === current.code;
            return (
              <div
                key={l.code}
                onClick={() => { onChange?.(l.code); setOpen(false); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 10px', borderRadius: 10,
                  cursor: 'pointer',
                  background: isActive ? 'rgba(224,30,30,0.12)' : 'transparent',
                  border: `1px solid ${isActive ? 'rgba(224,30,30,0.4)' : 'transparent'}`,
                  transition: 'background 0.12s',
                }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
              >
                <span style={{
                  width: 32, fontFamily: '"JetBrains Mono", monospace',
                  fontSize: 10, color: 'rgba(255,255,255,0.55)',
                  letterSpacing: '0.05em', textAlign: 'center',
                  padding: '2px 4px', borderRadius: 4,
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  flexShrink: 0,
                }}>{l.code === 'auto' ? '…' : l.code.toUpperCase()}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: '#FFF', whiteSpace: 'nowrap' }}>{l.native}</div>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', whiteSpace: 'nowrap' }}>{l.label}</div>
                </div>
                {isActive && <Check style={{ width: 13, height: 13, color: RED, flexShrink: 0 }} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
