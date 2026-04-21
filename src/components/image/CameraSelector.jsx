import React, { useState, useEffect, useMemo, useRef } from 'react';
import { CAMERA_DATA, FSTOP_DESCRIPTIONS } from '@/lib/cameraData';

const FONT = '"DM Sans", sans-serif';

// ── Aperture blade icon (f-stop column) ───────────────────────────────────────
function ApertureIcon({ size = 34, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.4">
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="3" />
      <line x1="12" y1="2" x2="12" y2="9" />
      <line x1="12" y1="15" x2="12" y2="22" />
      <line x1="2" y1="12" x2="9" y2="12" />
      <line x1="15" y1="12" x2="22" y2="12" />
      <line x1="4.93" y1="4.93" x2="9.17" y2="9.17" />
      <line x1="14.83" y1="14.83" x2="19.07" y2="19.07" />
      <line x1="19.07" y1="4.93" x2="14.83" y2="9.17" />
      <line x1="9.17" y1="14.83" x2="4.93" y2="19.07" />
    </svg>
  );
}

// ── Cinema camera silhouette (transparent, no background) ─────────────────────
function CameraSilhouette({ size = 54, color = 'rgba(255,255,255,0.85)' }) {
  return (
    <svg width={size} height={size * 0.72} viewBox="0 0 100 72" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* top handle */}
      <rect x="36" y="2" width="20" height="6" rx="1.4" fill={color} opacity="0.85" />
      <rect x="44" y="7" width="4" height="5" fill={color} opacity="0.7" />
      {/* body */}
      <rect x="10" y="14" width="58" height="38" rx="3" fill={color} />
      {/* lens barrel */}
      <rect x="60" y="22" width="28" height="22" rx="2" fill={color} opacity="0.92" />
      {/* lens glass */}
      <circle cx="80" cy="33" r="7" fill="#0a0a0c" opacity="0.55" />
      <circle cx="80" cy="33" r="4" fill={color} opacity="0.35" />
      {/* viewfinder */}
      <rect x="14" y="6" width="14" height="10" rx="1.5" fill={color} opacity="0.85" />
      {/* record dot */}
      <circle cx="22" cy="26" r="2" fill="#FF4444" opacity="0.9" />
      {/* details */}
      <rect x="14" y="34" width="14" height="2" fill="#0a0a0c" opacity="0.5" />
      <rect x="14" y="39" width="10" height="2" fill="#0a0a0c" opacity="0.5" />
      {/* tripod base */}
      <rect x="34" y="54" width="14" height="4" fill={color} opacity="0.6" />
      <rect x="30" y="58" width="22" height="3" rx="1" fill={color} opacity="0.5" />
    </svg>
  );
}

// ── Focal length icon (field of view / focal) ─────────────────────────────────
function FocalIcon({ size = 40, active = false }) {
  const stroke = active ? '#fff' : 'rgba(255,255,255,0.8)';
  return (
    <svg width={size} height={size * 0.8} viewBox="0 0 50 40" fill="none">
      {/* lens glass at left */}
      <circle cx="10" cy="20" r="6" stroke={stroke} strokeWidth="1.6" fill="none" />
      <circle cx="10" cy="20" r="2.5" fill={stroke} opacity="0.6" />
      {/* FOV cone */}
      <line x1="14" y1="16" x2="46" y2="4" stroke={stroke} strokeWidth="1.4" strokeDasharray="2 2" />
      <line x1="14" y1="24" x2="46" y2="36" stroke={stroke} strokeWidth="1.4" strokeDasharray="2 2" />
      {/* subject plane */}
      <line x1="46" y1="4" x2="46" y2="36" stroke={stroke} strokeWidth="1.6" />
    </svg>
  );
}

// ── Cinema lens silhouette ────────────────────────────────────────────────────
function LensSilhouette({ size = 54, color = 'rgba(255,255,255,0.85)' }) {
  return (
    <svg width={size} height={size * 0.7} viewBox="0 0 100 70" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* mount ring */}
      <rect x="6" y="20" width="8" height="30" rx="1" fill={color} opacity="0.7" />
      {/* barrel */}
      <rect x="14" y="14" width="56" height="42" rx="3" fill={color} opacity="0.9" />
      {/* focus ring 1 */}
      <rect x="22" y="14" width="4" height="42" fill="#0a0a0c" opacity="0.55" />
      <rect x="38" y="14" width="4" height="42" fill="#0a0a0c" opacity="0.55" />
      <rect x="54" y="14" width="4" height="42" fill="#0a0a0c" opacity="0.55" />
      {/* front element */}
      <rect x="70" y="10" width="22" height="50" rx="3" fill={color} />
      {/* glass */}
      <circle cx="81" cy="35" r="11" fill="#0a0a0c" opacity="0.6" />
      <circle cx="81" cy="35" r="7" fill={color} opacity="0.22" />
      <circle cx="78" cy="31" r="2" fill={color} opacity="0.8" />
      {/* hash marks */}
      <rect x="16" y="17" width="2" height="2" fill="#0a0a0c" opacity="0.6" />
      <rect x="16" y="23" width="2" height="2" fill="#0a0a0c" opacity="0.6" />
      <rect x="16" y="29" width="2" height="2" fill="#0a0a0c" opacity="0.6" />
    </svg>
  );
}

// ── Scrollable column with fade-edges + chevrons ──────────────────────────────
function ScrollColumn({ title, children, hasItems, emptyText }) {
  const scrollRef = useRef(null);
  const [canUp, setCanUp] = useState(false);
  const [canDown, setCanDown] = useState(false);

  const updateScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setCanUp(el.scrollTop > 4);
    setCanDown(el.scrollTop + el.clientHeight < el.scrollHeight - 4);
  };

  useEffect(() => {
    updateScroll();
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', updateScroll);
    window.addEventListener('resize', updateScroll);
    return () => {
      el.removeEventListener('scroll', updateScroll);
      window.removeEventListener('resize', updateScroll);
    };
  }, [children]);

  const scroll = (dir) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ top: dir * 110, behavior: 'smooth' });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, position: 'relative' }}>
      <div style={{
        fontSize: 9, fontWeight: 700, letterSpacing: '0.16em',
        textTransform: 'uppercase', color: 'rgba(255,255,255,0.42)',
        textAlign: 'center', marginBottom: 4,
      }}>{title}</div>

      {/* Up chevron */}
      <button
        onClick={() => scroll(-1)}
        disabled={!canUp}
        style={{
          position: 'absolute', top: 20, left: '50%', transform: 'translateX(-50%)',
          width: 26, height: 18, borderRadius: 10,
          background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: canUp ? 'pointer' : 'default', opacity: canUp ? 1 : 0.2,
          transition: 'all 0.18s', zIndex: 3, padding: 0,
        }}
        onMouseEnter={e => { if (canUp) e.currentTarget.style.background = 'rgba(255,255,255,0.12)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15" /></svg>
      </button>

      <div
        ref={scrollRef}
        className="cam-col-scroll"
        style={{
          flex: 1,
          overflowY: 'auto',
          scrollSnapType: 'y proximity',
          paddingTop: 42, paddingBottom: 42,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', gap: 8,
          minHeight: 0,
          WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 22%, black 78%, transparent 100%)',
          maskImage: 'linear-gradient(to bottom, transparent 0%, black 22%, black 78%, transparent 100%)',
          scrollbarWidth: 'none',
        }}
      >
        {hasItems ? children : (
          <div style={{
            color: 'rgba(255,255,255,0.3)', fontSize: 11, textAlign: 'center',
            padding: '30px 6px', fontStyle: 'italic',
          }}>{emptyText || 'Select a camera first'}</div>
        )}
      </div>

      {/* Down chevron */}
      <button
        onClick={() => scroll(1)}
        disabled={!canDown}
        style={{
          position: 'absolute', bottom: 2, left: '50%', transform: 'translateX(-50%)',
          width: 26, height: 18, borderRadius: 10,
          background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: canDown ? 'pointer' : 'default', opacity: canDown ? 1 : 0.2,
          transition: 'all 0.18s', zIndex: 3, padding: 0,
        }}
        onMouseEnter={e => { if (canDown) e.currentTarget.style.background = 'rgba(255,255,255,0.12)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
      </button>
    </div>
  );
}

// ── Pill card ─────────────────────────────────────────────────────────────────
function PillCard({ active, label, subLabel, subLabelTone, imageSrc, imageFallback, fallbackIcon, onClick }) {
  const [imgError, setImgError] = useState(false);
  const [useFallback, setUseFallback] = useState(false);
  return (
    <button
      onClick={onClick}
      style={{
        scrollSnapAlign: 'center', flexShrink: 0,
        width: '100%', maxWidth: 130, height: 80,
        borderRadius: 46,
        cursor: 'pointer',
        border: active ? '1.5px solid rgba(255,255,255,0.9)' : '1.5px solid transparent',
        background: active ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.025)',
        padding: 0, overflow: 'hidden',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        fontFamily: FONT,
        transition: 'all 0.18s ease',
        boxShadow: active ? '0 0 0 3px rgba(255,255,255,0.04)' : 'none',
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.055)'; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.025)'; }}
    >
      <div style={{
        flex: 1, width: '100%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '8px 10px 1px 10px', minHeight: 0,
      }}>
        {imageSrc && !imgError ? (
          <img
            src={useFallback && imageFallback ? imageFallback : imageSrc}
            alt={label}
            className="cam-img-nobg"
            onError={() => {
              if (!useFallback && imageFallback) setUseFallback(true);
              else setImgError(true);
            }}
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block' }}
          />
        ) : fallbackIcon}
      </div>
      <div style={{ width: '100%', padding: '0 8px 8px 8px', textAlign: 'center' }}>
        <div style={{
          fontSize: 10.5, fontWeight: 600,
          color: active ? '#fff' : 'rgba(255,255,255,0.82)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{label}</div>
        {subLabel && (
          <div style={{
            fontSize: 8.5,
            color: subLabelTone === 'anamorphic' ? '#FFB072'
                 : subLabelTone === 'spherical'  ? 'rgba(160,190,220,0.75)'
                 : 'rgba(255,255,255,0.42)',
            fontWeight: subLabelTone ? 700 : 400,
            letterSpacing: subLabelTone ? '0.08em' : 'normal',
            marginTop: 1,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{subLabel}</div>
        )}
      </div>
    </button>
  );
}

// ── Main: CameraSelector floating modal ───────────────────────────────────────
export default function CameraSelector({ selection, onChange, onClose }) {
  const [selCamera, setSelCamera] = useState(selection?.camera || null);
  const [selFocal, setSelFocal] = useState(selection?.focalLength || null);
  const [selLens, setSelLens] = useState(selection?.lens || null);
  const [selFstop, setSelFstop] = useState(selection?.fstop || null);
  const ref = useRef(null);

  useEffect(() => {
    const fn = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose?.(); };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, [onClose]);

  const emit = (s) => onChange?.(s);

  const pickCamera = (cam) => {
    if (selCamera?.id === cam.id) {
      setSelCamera(null); setSelFocal(null); setSelLens(null); setSelFstop(null);
      emit({ camera: null, focalLength: null, lens: null, fstop: null });
      return;
    }
    setSelCamera(cam); setSelFocal(null); setSelLens(null);
    const keepFs = cam.fstops.includes(selFstop) ? selFstop : null;
    if (!cam.fstops.includes(selFstop)) setSelFstop(null);
    emit({ camera: cam, focalLength: null, lens: null, fstop: keepFs });
  };

  const pickLens = (lens) => {
    const same = selLens?.name === lens.name;
    setSelLens(same ? null : lens);
    emit({ camera: selCamera, focalLength: selFocal, lens: same ? null : lens, fstop: selFstop });
  };

  const pickFocal = (mm) => {
    const same = selFocal === mm;
    setSelFocal(same ? null : mm);
    emit({ camera: selCamera, focalLength: same ? null : mm, lens: selLens, fstop: selFstop });
  };

  const pickFstop = (fs) => {
    const same = selFstop === fs;
    setSelFstop(same ? null : fs);
    emit({ camera: selCamera, focalLength: selFocal, lens: selLens, fstop: same ? null : fs });
  };

  const clearAll = () => {
    setSelCamera(null); setSelFocal(null); setSelLens(null); setSelFstop(null);
    emit({ camera: null, focalLength: null, lens: null, fstop: null });
  };

  // Lens list — lens family names only (no focal baked in)
  const uniqueLenses = useMemo(() => {
    if (!selCamera) return [];
    return selCamera.lenses;
  }, [selCamera]);

  // Focal lengths — flat string array, independent of selected lens
  const uniqueFocals = useMemo(() => {
    if (!selCamera) return [];
    return selCamera.focals;
  }, [selCamera]);

  const fstops = selCamera?.fstops || [];
  const hasSelection = !!(selCamera || selLens || selFstop);

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        bottom: 'calc(28px + 160px + 10px)',
        left: '50%',
        transform: 'translateX(-50%)',
        width: 'min(720px, 94vw)',
        background: 'rgba(18, 18, 26, 0.12)',
        backdropFilter: 'blur(60px) saturate(220%)',
        WebkitBackdropFilter: 'blur(60px) saturate(220%)',
        border: '1px solid rgba(255, 255, 255, 0.15)',
        borderRadius: 22,
        boxShadow: '0 28px 80px rgba(0, 0, 0, 0.38), inset 0 1px 0 rgba(255,255,255,0.12), inset 0 -1px 0 rgba(255,255,255,0.03)',
        padding: '14px 14px 12px 14px',
        zIndex: 200,
        fontFamily: FONT,
        animation: 'camSlideUp 0.26s cubic-bezier(0.4,0,0.2,1)',
        display: 'flex', flexDirection: 'column',
      }}
    >
      <style>{`
        @keyframes camSlideUp {
          from { opacity: 0; transform: translateX(-50%) translateY(12px); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
        .cam-col-scroll::-webkit-scrollbar { display: none; }
        .cam-img-nobg {
          mix-blend-mode: screen;
          filter: contrast(1.12) brightness(1.1) saturate(1.05);
        }
      `}</style>

      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        paddingBottom: 8,
      }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>Camera Settings</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {hasSelection && (
            <button
              onClick={clearAll}
              style={{
                padding: '4px 10px', borderRadius: 999,
                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                color: 'rgba(255,255,255,0.72)', fontSize: 10.5, fontFamily: FONT, cursor: 'pointer',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = '#fff'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = 'rgba(255,255,255,0.72)'; }}
            >Reset</button>
          )}
          <button
            onClick={onClose}
            style={{
              width: 24, height: 24, borderRadius: '50%',
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
              color: 'rgba(255,255,255,0.7)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.12)'; e.currentTarget.style.color = '#fff'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = 'rgba(255,255,255,0.7)'; }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
      </div>

      {/* 4 columns */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1.1fr 1.1fr 0.85fr 0.95fr', gap: 6,
        height: 300, minHeight: 0,
        background: 'rgba(255,255,255,0.018)',
        border: '1px solid rgba(255,255,255,0.05)',
        borderRadius: 14, padding: 6,
      }}>
        <ScrollColumn title="Cameras" hasItems={CAMERA_DATA.length > 0}>
          {CAMERA_DATA.map(cam => (
            <PillCard
              key={cam.id}
              active={selCamera?.id === cam.id}
              label={cam.name}
              subLabel={cam.sub}
              imageSrc={cam.image}
              imageFallback={cam.imageFallback}
              fallbackIcon={<CameraSilhouette size={44} />}
              onClick={() => pickCamera(cam)}
            />
          ))}
        </ScrollColumn>

        <ScrollColumn title="Lenses" hasItems={uniqueLenses.length > 0}>
          {uniqueLenses.map((lens, i) => (
            <PillCard
              key={`${lens.name}-${i}`}
              active={selLens?.name === lens.name}
              label={lens.name}
              subLabel={lens.type === 'anamorphic' ? 'ANAMORPHIC' : 'SPHERICAL'}
              subLabelTone={lens.type === 'anamorphic' ? 'anamorphic' : 'spherical'}
              imageSrc={lens.image}
              fallbackIcon={<LensSilhouette size={44} />}
              onClick={() => pickLens(lens)}
            />
          ))}
        </ScrollColumn>

        <ScrollColumn title="Focal" hasItems={uniqueFocals.length > 0}>
          {uniqueFocals.map(mm => (
            <PillCard
              key={mm}
              active={selFocal === mm}
              label={mm}
              subLabel={null}
              fallbackIcon={<FocalIcon size={40} active={selFocal === mm} />}
              onClick={() => pickFocal(mm)}
            />
          ))}
        </ScrollColumn>

        <ScrollColumn title="F-Stop" hasItems={fstops.length > 0}>
          {fstops.map(fs => (
            <PillCard
              key={fs}
              active={selFstop === fs}
              label={fs}
              subLabel={FSTOP_DESCRIPTIONS[fs]?.split('·')[0].trim()}
              fallbackIcon={<ApertureIcon size={36} color={selFstop === fs ? '#fff' : 'rgba(255,255,255,0.7)'} />}
              onClick={() => pickFstop(fs)}
            />
          ))}
        </ScrollColumn>
      </div>

    </div>
  );
}
