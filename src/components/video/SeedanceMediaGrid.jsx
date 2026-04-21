import React, { useState } from 'react';
import { X, Check, Loader2, ShieldCheck, ShieldX, Image as ImageIcon, Film, Music, ChevronDown } from 'lucide-react';

const S = { font: '"DM Sans", sans-serif' };

const STATUS_CONFIG = {
  uploading:  { bg: 'rgba(0,0,0,0.6)',   text: 'Uploading...',  icon: Loader2,    spin: true,  color: '#fff' },
  uploaded:   { bg: null,                  text: 'Check eligibility', icon: ShieldCheck, spin: false, color: '#fff' },
  checking:   { bg: 'rgba(0,0,0,0.6)',   text: 'Checking...',   icon: Loader2,    spin: true,  color: '#fbbf24' },
  approved:   { bg: null,                  text: null,            icon: Check,      spin: false, color: '#10B981' },
  rejected:   { bg: null,                  text: null,            icon: ShieldX,    spin: false, color: '#ef4444' },
};

const TYPE_ICONS = { image: ImageIcon, video: Film, audio: Music };

const ROLE_LABELS = {
  reference: 'Reference',
  start_frame: 'Start Frame',
  end_frame: 'End Frame',
};
const ROLE_COLORS = {
  reference: '#0D9488',
  start_frame: '#3B82F6',
  end_frame: '#8B5CF6',
};

export default function SeedanceMediaGrid({ items = [], onCheckEligibility, onRemove, compact = false, imageRoles = {}, onImageRoleChange }) {
  const size = compact ? 64 : 120;
  const [openRoleMenu, setOpenRoleMenu] = useState(null);

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: compact ? 6 : 10 }}>
      {items.map(item => {
        const cfg = STATUS_CONFIG[item.status] || {};
        const TypeIcon = TYPE_ICONS[item.type] || ImageIcon;
        const isImage = item.type === 'image';
        const isVideo = item.type === 'video';
        const role = imageRoles[item.id];
        const roleColor = role ? ROLE_COLORS[role] : null;
        const showRoleSelector = isImage && (item.status === 'uploaded' || item.status === 'approved') && onImageRoleChange;

        return (
          <div key={item.id} style={{ position: 'relative', flexShrink: 0 }}>
            <div style={{
              width: size, height: size, borderRadius: 10, overflow: 'hidden',
              position: 'relative',
              border: role ? `2px solid ${roleColor}` : item.status === 'approved' ? '2px solid #10B981' : '1px solid rgba(255,255,255,0.1)',
              background: '#0D0D0D',
            }}>
              {/* Thumbnail */}
              {isImage && item.previewUrl && (
                <img src={item.previewUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              )}
              {isVideo && item.previewUrl && (
                <video src={item.previewUrl + '#t=0.1'} muted playsInline preload="auto"
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              )}
              {!item.previewUrl && (
                <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <TypeIcon style={{ width: 24, height: 24, color: 'rgba(255,255,255,0.2)' }} />
                </div>
              )}

              {/* Label badge */}
              {item.label && (
                <div style={{
                  position: 'absolute', top: 3, left: 3, fontSize: 8, fontWeight: 600,
                  background: 'rgba(0,0,0,0.7)', color: '#fff', padding: '1px 4px',
                  borderRadius: 3, fontFamily: S.font, backdropFilter: 'blur(4px)',
                }}>{item.label}</div>
              )}

              {/* Role badge */}
              {role && (
                <div style={{
                  position: 'absolute', top: 3, right: compact ? 3 : 22, fontSize: 7, fontWeight: 700,
                  background: roleColor, color: '#fff', padding: '1px 4px',
                  borderRadius: 3, fontFamily: S.font, textTransform: 'uppercase', letterSpacing: 0.3,
                }}>{ROLE_LABELS[role]}</div>
              )}

              {/* Remove button */}
              {onRemove && item.status !== 'checking' && (
                <button onClick={(e) => { e.stopPropagation(); onRemove(item.id); }}
                  style={{
                    position: 'absolute', top: 3, right: 3, width: 16, height: 16,
                    borderRadius: '50%', background: 'rgba(0,0,0,0.7)', border: 'none',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', color: '#fff', fontSize: 9,
                  }}>
                  <X style={{ width: 9, height: 9 }} />
                </button>
              )}

              {/* Status overlay */}
              {(item.status === 'uploading' || item.status === 'checking') && (
                <div style={{
                  position: 'absolute', inset: 0, background: cfg.bg,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
                }}>
                  <cfg.icon style={{
                    width: 18, height: 18, color: cfg.color,
                    ...(cfg.spin ? { animation: 'spin 1s linear infinite' } : {}),
                  }} />
                  <span style={{ fontSize: 9, color: cfg.color, fontFamily: S.font }}>{cfg.text}</span>
                </div>
              )}

              {/* Check eligibility button */}
              {item.status === 'uploaded' && onCheckEligibility && (
                <button onClick={(e) => { e.stopPropagation(); onCheckEligibility(item.id); }}
                  style={{
                    position: 'absolute', bottom: 0, left: 0, right: 0,
                    padding: compact ? '4px 0' : '6px 0', background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)',
                    border: 'none', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3,
                    color: '#fff', fontSize: compact ? 8 : 10, fontWeight: 500, fontFamily: S.font,
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(16,185,129,0.3)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'rgba(0,0,0,0.75)'}
                >
                  <ShieldCheck style={{ width: compact ? 10 : 12, height: compact ? 10 : 12 }} />
                  Check
                </button>
              )}

              {/* Approved badge */}
              {item.status === 'approved' && !role && (
                <div style={{
                  position: 'absolute', bottom: 3, right: 3,
                  width: compact ? 16 : 22, height: compact ? 16 : 22, borderRadius: '50%', background: '#10B981',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 0 8px rgba(16,185,129,0.5)',
                }}>
                  <Check style={{ width: compact ? 10 : 14, height: compact ? 10 : 14, color: '#fff', strokeWidth: 3 }} />
                </div>
              )}

              {/* Rejected badge */}
              {item.status === 'rejected' && (
                <div style={{
                  position: 'absolute', bottom: 3, right: 3,
                  width: compact ? 16 : 22, height: compact ? 16 : 22, borderRadius: '50%', background: '#ef4444',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <X style={{ width: compact ? 10 : 14, height: compact ? 10 : 14, color: '#fff', strokeWidth: 3 }} />
                </div>
              )}

              <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
            </div>

            {/* Role selector button (below thumbnail for images) */}
            {showRoleSelector && (
              <div style={{ position: 'relative', marginTop: 3 }}>
                <button
                  onClick={(e) => { e.stopPropagation(); setOpenRoleMenu(openRoleMenu === item.id ? null : item.id); }}
                  style={{
                    width: size, padding: '3px 4px', borderRadius: 5,
                    background: role ? roleColor : 'rgba(255,255,255,0.08)',
                    border: `1px solid ${role ? roleColor : 'rgba(255,255,255,0.15)'}`,
                    color: '#fff', fontSize: 8, fontFamily: S.font, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2,
                    fontWeight: 600, transition: 'all 0.15s',
                  }}
                >
                  {role ? ROLE_LABELS[role] : 'Set Role'}
                  <ChevronDown style={{ width: 8, height: 8 }} />
                </button>

                {/* Role dropdown */}
                {openRoleMenu === item.id && (
                  <div style={{
                    position: 'absolute', top: '100%', left: 0, zIndex: 30,
                    width: compact ? 100 : 130, marginTop: 2,
                    background: '#1A1A1A', border: '1px solid rgba(255,255,255,0.2)',
                    borderRadius: 6, padding: 3, boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
                  }}>
                    {[
                      { key: 'reference', label: 'Reference', desc: 'Style guide' },
                      { key: 'start_frame', label: 'Start Frame', desc: 'First frame' },
                      { key: 'end_frame', label: 'End Frame', desc: 'Last frame' },
                    ].map(r => (
                      <button key={r.key}
                        onClick={(e) => {
                          e.stopPropagation();
                          onImageRoleChange(item.id, role === r.key ? null : r.key);
                          setOpenRoleMenu(null);
                        }}
                        style={{
                          display: 'block', width: '100%', textAlign: 'left',
                          padding: '4px 6px', background: role === r.key ? `${ROLE_COLORS[r.key]}22` : 'transparent',
                          border: 'none', color: role === r.key ? ROLE_COLORS[r.key] : '#fff',
                          fontSize: 9, fontFamily: S.font, cursor: 'pointer', borderRadius: 4,
                          fontWeight: role === r.key ? 700 : 400,
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = `${ROLE_COLORS[r.key]}22`}
                        onMouseLeave={e => e.currentTarget.style.background = role === r.key ? `${ROLE_COLORS[r.key]}22` : 'transparent'}
                      >
                        <div>{r.label}</div>
                        {!compact && <div style={{ fontSize: 7, color: 'rgba(255,255,255,0.3)', marginTop: 1 }}>{r.desc}</div>}
                      </button>
                    ))}
                    {role && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onImageRoleChange(item.id, null); setOpenRoleMenu(null); }}
                        style={{
                          display: 'block', width: '100%', textAlign: 'center',
                          padding: '3px 6px', background: 'transparent', border: 'none',
                          color: 'rgba(255,255,255,0.4)', fontSize: 8, fontFamily: S.font,
                          cursor: 'pointer', borderRadius: 4, marginTop: 2,
                          borderTop: '1px solid rgba(255,255,255,0.1)',
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                      >Clear Role</button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
