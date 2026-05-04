// Voice Canvas — Audio page (A3 direction).
//
// Wired to ElevenLabs TTS via /api/tts. Click Synthesize → POST text +
// voice + language + sliders → fetch the returned MP3 → decode with Web
// Audio API for the real waveform → play via a hidden <audio> with the
// playhead synced to currentTime via requestAnimationFrame.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import AudioModeTabs from '@/components/audio/AudioModeTabs';
import WaveformStage from '@/components/audio/WaveformStage';
import ScriptPanel from '@/components/audio/ScriptPanel';
import { useAuth } from '@/lib/AuthContext';
import { genPreviewAmplitudes, pcmToAmplitudes, authJsonHeaders } from '@/components/audio/audioUtils';
import { VOICES } from '@/components/audio/voices';

const RED = '#E01E1E';

const DEFAULT_SCRIPT =
  'In the quiet between heartbeats, the city exhales — a long, low note that no one hears. The signal travels through copper, through glass, through skin.';

const PREVIEW_DURATION = 18; // shown on the ruler when no real audio yet

export default function Audio() {
  const { isAuthenticated, openAuthModal, refresh: refreshAuth } = useAuth();

  // ─── Mode tabs (Voice / Music / SFX / Lipsync) ───
  const [mode, setMode] = useState('voice');

  // ─── Waveform + transport state ───
  const [previewSeed, setPreviewSeed] = useState(1);
  const [decodedAmplitudes, setDecodedAmplitudes] = useState(null);
  const previewAmps = useMemo(() => genPreviewAmplitudes(previewSeed), [previewSeed]);
  const amplitudes = decodedAmplitudes || previewAmps;

  const [audioUrl, setAudioUrl] = useState(null);
  const [audioDuration, setAudioDuration] = useState(PREVIEW_DURATION);
  const [playhead, setPlayhead] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selection, setSelection] = useState({ start: 0.18, end: 0.42 });
  const [isSynthesizing, setIsSynthesizing] = useState(false);

  // ─── Script panel state (sent to /api/tts) ───
  const [voice, setVoice] = useState('Rachel');
  const [language, setLanguage] = useState('auto');
  const [ttsModel, setTtsModel] = useState('eleven-v3');
  const [script, setScript] = useState(DEFAULT_SCRIPT);
  const [highlighted, setHighlighted] = useState('exhales');
  const [stability, setStability]   = useState(0.5);
  const [similarity, setSimilarity] = useState(0.75);
  const [style, setStyle]           = useState(0.30);

  const audioElRef = useRef(null);

  // RAF loop synced to <audio>.currentTime so the playhead follows real
  // playback (handles seeks, pauses, browser throttling) without us
  // having to integrate dt by hand.
  const rafRef = useRef(null);
  useEffect(() => {
    if (!isPlaying) return undefined;
    const tick = () => {
      const a = audioElRef.current;
      if (a) {
        setPlayhead(a.currentTime);
        if (a.ended || a.paused) {
          setIsPlaying(false);
          return;
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [isPlaying]);

  const handlePlayToggle = async () => {
    const a = audioElRef.current;
    if (!a || !audioUrl) {
      toast.info('Click Synthesize first to generate audio.');
      return;
    }
    if (isPlaying) {
      a.pause();
      setIsPlaying(false);
    } else {
      if (a.ended) a.currentTime = 0;
      try {
        await a.play();
        setIsPlaying(true);
      } catch (err) {
        toast.error('Playback failed: ' + err.message);
      }
    }
  };
  const handleSeek = (sec) => {
    const clamped = Math.min(audioDuration, Math.max(0, sec));
    setPlayhead(clamped);
    const a = audioElRef.current;
    if (a) a.currentTime = clamped;
  };
  const handleSkipStart = () => { handleSeek(0); audioElRef.current?.pause(); setIsPlaying(false); };
  const handleSkipEnd   = () => { handleSeek(audioDuration); audioElRef.current?.pause(); setIsPlaying(false); };

  // POST to /api/tts → fetch the returned MP3 → decode with Web Audio
  // → downsample to 220 bins → swap into the waveform. The same MP3 URL
  // is also fed to a hidden <audio> tag for transport playback.
  const handleSynthesize = async () => {
    if (isSynthesizing) return;
    if (!script.trim()) { toast.error('Type a script to synthesize'); return; }
    if (!isAuthenticated) {
      toast.info('Please sign in to synthesize.');
      openAuthModal?.('login');
      return;
    }
    setIsSynthesizing(true);
    setIsPlaying(false);
    try {
      // Send voice_id (not the human name) — FAL/ElevenLabs's name
      // resolver throws 422 on ambiguous library names, but voice_id
      // is unambiguous and always resolves. Falls back to the typed
      // name if we can't find a matching entry (defensive — shouldn't
      // happen since the picker is closed-set).
      const voiceEntry = VOICES.find(v => v.name === voice);
      const voicePayload = voiceEntry?.voice_id || voice;
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify({
          model: ttsModel,
          text: script.trim(),
          voice: voicePayload,
          language_code: language,
          stability,
          similarity_boost: similarity,
          style,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.audio_url) {
        if (response.status === 401) {
          toast.error('Your session expired — please sign in again.');
          openAuthModal?.('login');
        } else if (response.status === 402) {
          toast.error(data.error || 'Not enough credits — ask the admin to add more.');
        } else {
          toast.error(data.error || 'Synthesis failed');
        }
        refreshAuth?.();
        return;
      }

      // Decode the MP3 into a real amplitude profile.
      try {
        const buf = await fetch(data.audio_url).then(r => r.arrayBuffer());
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const decoded = await ctx.decodeAudioData(buf);
        const ch = decoded.getChannelData(0);
        setDecodedAmplitudes(pcmToAmplitudes(ch));
        setAudioDuration(decoded.duration);
        ctx.close?.();
      } catch (e) {
        // If decoding fails (CORS, codec) fall back to the preview bars
        // but still let playback work via the <audio> element.
        console.warn('[audio] decode failed, falling back to preview:', e.message);
        setPreviewSeed(s => s + 1);
      }

      setAudioUrl(data.audio_url);
      setPlayhead(0);
      toast.success('Audio ready — press play.');
      refreshAuth?.();
    } catch (err) {
      toast.error(err.message || 'Synthesis failed');
      refreshAuth?.();
    } finally {
      setIsSynthesizing(false);
    }
  };

  // Keep the hidden <audio> in sync with audioUrl + capture metadata.
  useEffect(() => {
    const a = audioElRef.current;
    if (!a) return undefined;
    const onMeta = () => {
      if (Number.isFinite(a.duration)) setAudioDuration(a.duration);
    };
    a.addEventListener('loadedmetadata', onMeta);
    return () => a.removeEventListener('loadedmetadata', onMeta);
  }, [audioUrl]);

  // Mode tabs swap the header label / track title for v1; only Voice
  // wires to the TTS backend right now.
  const modeLabel = {
    voice:   { caption: 'VOICE · ELEVENLABS', title: 'VOICE CANVAS',   trackTitle: 'Voice Take · 03', voiceLabel: `${voice} · 44.1kHz · 16bit · ${audioDuration.toFixed(1)}s` },
    music:   { caption: 'MUSIC · UDIO',       title: 'MUSIC CANVAS',   trackTitle: 'Music Bed · 01',  voiceLabel: 'Stems · 44.1kHz · 16bit · 00:18' },
    sfx:     { caption: 'SFX · ELEVENLABS',   title: 'SFX CANVAS',     trackTitle: 'SFX Take · 01',   voiceLabel: 'One-shot · 44.1kHz · 16bit · 00:18' },
    lipsync: { caption: 'LIPSYNC · KLING',    title: 'LIPSYNC CANVAS', trackTitle: 'Dub · 01',        voiceLabel: 'A2V · 44.1kHz · 16bit · 00:18' },
  }[mode];

  return (
    <div style={{
      position: 'relative',
      minHeight: 'calc(100vh - 64px)',
      background: '#0A0A0A',
      overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none' }}>
        <div style={{
          position: 'absolute', top: '-20%', right: '-10%', width: 900, height: 900,
          background: 'radial-gradient(circle, rgba(224,30,30,0.22), transparent 60%)',
          filter: 'blur(60px)',
        }} />
        <div style={{
          position: 'absolute', bottom: '-20%', left: '-10%', width: 700, height: 700,
          background: 'radial-gradient(circle, rgba(139,15,15,0.36), transparent 65%)',
          filter: 'blur(60px)',
        }} />
      </div>

      <div style={{
        position: 'relative', zIndex: 2,
        padding: '20px 28px',
        display: 'flex', flexDirection: 'column', gap: 16,
        flex: 1, minHeight: 0,
      }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
          flexWrap: 'wrap', gap: 12,
        }}>
          <div>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: 10.5, color: 'rgba(255,255,255,0.55)',
              letterSpacing: '0.18em', textTransform: 'uppercase',
              marginBottom: 6,
            }}>
              <span style={{
                width: 7, height: 7, borderRadius: '50%',
                background: RED, boxShadow: `0 0 8px ${RED}`,
              }} />
              {modeLabel.caption}
            </div>
            <h1 style={{
              margin: 0,
              fontFamily: 'Anton, sans-serif',
              fontSize: 36, color: '#FFF',
              letterSpacing: '0.02em', textTransform: 'uppercase',
              lineHeight: 1,
            }}>{modeLabel.title}</h1>
          </div>
          <AudioModeTabs active={mode} onChange={setMode} />
        </div>

        <style>{`
          .voxel-audio-grid { display: grid; gap: 12px; flex: 1; min-height: 0; grid-template-columns: 1fr 360px; }
          @media (max-width: 1023px) { .voxel-audio-grid { grid-template-columns: 1fr; } }
        `}</style>
        <div className="voxel-audio-grid">
          <WaveformStage
            amplitudes={amplitudes}
            duration={audioDuration}
            playhead={playhead}
            onSeek={handleSeek}
            isPlaying={isPlaying}
            onPlayToggle={handlePlayToggle}
            onSkipStart={handleSkipStart}
            onSkipEnd={handleSkipEnd}
            selection={selection}
            onSelectionChange={setSelection}
            trackTitle={modeLabel.trackTitle}
            voiceLabel={modeLabel.voiceLabel}
          />
          <ScriptPanel
            voice={voice} onVoiceChange={setVoice}
            language={language} onLanguageChange={setLanguage}
            model={ttsModel} onModelChange={setTtsModel}
            script={script} onScriptChange={setScript}
            highlighted={highlighted} onHighlightChange={setHighlighted}
            stability={stability} onStabilityChange={setStability}
            similarity={similarity} onSimilarityChange={setSimilarity}
            style={style} onStyleChange={setStyle}
            onSynthesize={handleSynthesize}
            isSynthesizing={isSynthesizing}
          />
        </div>
      </div>

      {/* Hidden <audio> — transport target. Lives outside the grid so
          it survives layout changes; src is bound to the latest TTS
          result and currentTime is driven by handleSeek. */}
      <audio ref={audioElRef} src={audioUrl || undefined} preload="auto" style={{ display: 'none' }} />
    </div>
  );
}
