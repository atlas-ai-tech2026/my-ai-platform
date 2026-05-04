// Voice picker — the row at the top of the Script panel that opens an
// inline popover listing the full ElevenLabs premade library (~40
// voices). Search bar + accent filter chips at the top.
//
// ▶ on each row plays a real preview generated via /api/tts. The result
// URL is cached in a module-level Map keyed by voice name, so the user
// can shop several voices without re-charging credits for the same
// voice. (First click costs 1 audio credit; subsequent clicks for that
// voice are free.)
//
// Multilingual hint at the top reminds users that ALL voices speak
// 30+ languages including Arabic — pick the language in the
// LanguagePicker below.
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { VOICES, ACCENTS } from './voices';
import VoiceRow from './VoiceRow';
import VoicePopoverHeader from './VoicePopoverHeader';

// Module-level cache so re-mounts of the picker don't lose preview URLs.
// Key: voice name; value: audio URL string.
const previewCache = new Map();

export default function VoicePicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [accent, setAccent] = useState('All');
  const [loadingName, setLoadingName] = useState(null); // which voice is fetching
  const [playingName, setPlayingName] = useState(null);
  const wrapRef = useRef(null);
  const audioRef = useRef(null);

  const current = VOICES.find(v => v.name === value) || VOICES[0];

  // Close on outside click + stop preview audio.
  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
        if (audioRef.current) { audioRef.current.pause(); }
        setPlayingName(null);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  // Cleanup playback when picker is closed.
  useEffect(() => {
    if (!open && audioRef.current) {
      audioRef.current.pause();
      setPlayingName(null);
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return VOICES.filter(v => {
      if (accent !== 'All' && v.accent !== accent) return false;
      if (!q) return true;
      return v.name.toLowerCase().includes(q)
        || v.desc.toLowerCase().includes(q)
        || v.accent.toLowerCase().includes(q);
    });
  }, [query, accent]);

  // Click ▶ → if cached, play immediately. Otherwise POST /api/tts
  // with the fixed preview text + this voice. Cache the result.
  const handlePreview = async (voice) => {
    const a = audioRef.current;
    if (!a) return;

    // If THIS voice is currently playing → pause.
    if (playingName === voice.name && !a.paused) {
      a.pause();
      setPlayingName(null);
      return;
    }

    const cached = previewCache.get(voice.voice_id);
    if (cached) {
      a.src = cached;
      try {
        await a.play();
        setPlayingName(voice.name);
      } catch (err) {
        toast.error('Playback failed: ' + err.message);
      }
      return;
    }

    // Previews use the public /api/tts/preview route. No auth required —
    // the server returns a fixed sample text for each voice and caches
    // the result by voice_id (first listener pays the FAL call, everyone
    // after gets it free). We send `voice_id` not `voice.name` because
    // the FAL/ElevenLabs name resolver chokes on ambiguous library names
    // (e.g. "Bella", "Antoni") with 422 Unprocessable Entity, but the
    // voice_id is unambiguous and always resolves.
    setLoadingName(voice.name);
    try {
      const resp = await fetch('/api/tts/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voice: voice.voice_id }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.audio_url) {
        if (resp.status === 429) toast.error('Too many previews — try again in an hour.');
        else toast.error(data.error || 'Preview failed');
        return;
      }
      previewCache.set(voice.voice_id, data.audio_url);
      a.src = data.audio_url;
      await a.play();
      setPlayingName(voice.name);
    } catch (err) {
      toast.error(err.message || 'Preview failed');
    } finally {
      setLoadingName(null);
    }
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <audio
        ref={audioRef}
        onEnded={() => setPlayingName(null)}
        onPause={() => setPlayingName(null)}
        style={{ display: 'none' }}
      />

      {/* Trigger pill — compact (avatar 24px, padding tightened) so the
          Script panel can fit textarea + sliders + Synthesize on shorter
          viewports without scrolling. */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 9,
          padding: '6px 10px', borderRadius: 10,
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
          cursor: 'pointer', textAlign: 'left',
          transition: 'filter 0.15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.filter = 'brightness(1.1)'; }}
        onMouseLeave={e => { e.currentTarget.style.filter = 'none'; }}
      >
        <div style={{
          width: 24, height: 24, borderRadius: '50%',
          background: current.gradient, flexShrink: 0,
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.18)',
        }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: 9, color: 'rgba(255,255,255,0.55)',
            letterSpacing: '0.06em', textTransform: 'uppercase',
            lineHeight: 1.1,
          }}>Voice</div>
          <div style={{
            fontSize: 12, fontWeight: 600, color: '#FFF',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            lineHeight: 1.2, marginTop: 1,
          }}>{current.name} · {current.desc}</div>
        </div>
        <span style={{
          padding: '1px 5px', borderRadius: 3,
          background: 'rgba(255,255,255,0.06)',
          color: 'rgba(255,255,255,0.6)',
          fontSize: 8.5, fontWeight: 600, letterSpacing: '0.05em',
          flexShrink: 0,
        }}>{current.accent}</span>
        <ChevronRight style={{ width: 14, height: 14, color: 'rgba(255,255,255,0.5)' }} />
      </button>

      {/* Popover */}
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0,
          background: 'rgba(20,18,20,0.97)',
          backdropFilter: 'blur(20px)',
          border: '1px solid rgba(255,255,255,0.10)',
          borderRadius: 14,
          boxShadow: '0 18px 48px rgba(0,0,0,0.55)',
          zIndex: 30,
          maxHeight: 560, display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}>
          <VoicePopoverHeader
            total={VOICES.length}
            shown={filtered.length}
            query={query} onQueryChange={setQuery}
            accent={accent} onAccentChange={setAccent}
            accents={ACCENTS}
          />

          {/* Voice list (scrollable) + bottom fade hinting at more rows.
              `flex: 1` + `min-height: 0` + `overflow-y: auto` directly on
              the SAME element — the prior nested wrapper with
              `height: 100%` doesn't resolve in all browsers because
              `flex: 1`'s computed height isn't a "definite" value for
              percentage children to inherit, so the inner div grew
              beyond the popover's max-height and the scrollbar fell
              outside the clipped region. */}
          <div className="voxel-voice-scroll" style={{
            position: 'relative',
            flex: 1, minHeight: 0,
            overflowY: 'auto',
            padding: 6,
            // Stop wheel events from "chaining" to the parent ScriptPanel
            // when this list reaches its scroll edge — without this the
            // user's mousewheel scrolls the panel instead of the list.
            overscrollBehavior: 'contain',
          }}>
            <style>{`
              /* Force a visible custom scrollbar so users on macOS (where
                 native scrollbars are hidden until active scroll) realise
                 the list IS scrollable. */
              .voxel-voice-scroll {
                scrollbar-width: thin;
                scrollbar-color: rgba(224,30,30,0.6) rgba(255,255,255,0.05);
              }
              .voxel-voice-scroll::-webkit-scrollbar { width: 8px; }
              .voxel-voice-scroll::-webkit-scrollbar-track {
                background: rgba(255,255,255,0.04);
                border-radius: 999px;
              }
              .voxel-voice-scroll::-webkit-scrollbar-thumb {
                background: linear-gradient(180deg, rgba(224,30,30,0.7), rgba(139,15,15,0.7));
                border-radius: 999px;
              }
              .voxel-voice-scroll::-webkit-scrollbar-thumb:hover {
                background: linear-gradient(180deg, rgba(255,42,42,0.9), rgba(139,15,15,0.9));
              }
            `}</style>
            {filtered.length === 0 && (
              <div style={{
                padding: '20px 12px', textAlign: 'center',
                color: 'rgba(255,255,255,0.4)', fontSize: 12,
              }}>No voices match.</div>
            )}
            {filtered.map(v => (
              <VoiceRow
                key={v.name}
                voice={v}
                isActive={v.name === current.name}
                isLoading={loadingName === v.name}
                isPlaying={playingName === v.name}
                onSelect={() => { onChange?.(v.name); setOpen(false); }}
                onPreview={() => handlePreview(v)}
              />
            ))}
          </div>
          {filtered.length > 6 && (
            <div style={{
              position: 'absolute',
              left: 0, right: 0, bottom: 0,
              height: 32,
              background: 'linear-gradient(180deg, transparent, rgba(20,18,20,0.97))',
              pointerEvents: 'none',
            }} />
          )}

          {/* Spinner CSS */}
          <style>{`
            .anim-spin { animation: voxel-spin 0.9s linear infinite; }
            @keyframes voxel-spin { to { transform: rotate(360deg); } }
          `}</style>
        </div>
      )}
    </div>
  );
}
