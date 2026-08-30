// ─── SpeechLab.jsx ───────────────────────────────────────────────────────────
// A measuring instrument, not a feature.
//
// ── WHY THIS PAGE EXISTS ───────────────────────────────────────────────────
// Amr chose Whisper so the microphone stops asking which language he is
// speaking. Whisper detects it — that part is certain. What is NOT certain is
// whether it is fast enough to be an improvement, because it transcribes AFTER
// you stop rather than as you speak, and because it runs single-threaded on
// whatever laptop is in the workshop room.
//
// Three numbers decide it, and all three were unknown when this was written:
//
//   1. How long the 43 MB first load takes ON THE REAL HOST, under the real
//      CSP — not on localhost, where Vite sends no CSP at all and everything
//      passes. That distinction has already shipped one broken feature to
//      every user of this site.
//   2. How long a spoken prompt takes to come back on an ordinary machine.
//   3. Whether `tiny` actually gets Arabic right, or only nearly right.
//
// So this page measures and reports, and NOTHING here is wired to a customer's
// prompt box. If transcription takes six seconds, that is far better to learn
// from this page than from five prompt boxes and a workshop.
//
// It is gated to dev hosts. It should be deleted once the decision is made —
// a measuring instrument left in the product becomes a feature nobody owns.

import React, { useState, useRef, useCallback } from 'react';
import { devOnlyVisible } from '@/lib/dev-only';
import {
  whisperSupported, cdnReadable, loadTranscriber, toMono16k, transcribe, SOURCES,
} from '@/lib/whisper';

const MONO = '"JetBrains Mono", ui-monospace, monospace';

const secs = (ms) => `${(ms / 1000).toFixed(2)}s`;
const mb = (b) => `${(b / 1048576).toFixed(1)} MB`;

/** What the machine can offer, as facts rather than assumptions. */
function machineFacts() {
  const nav = typeof navigator !== 'undefined' ? navigator : {};
  const conn = nav.connection || {};
  return [
    ['WebGPU', typeof navigator !== 'undefined' && 'gpu' in navigator ? 'yes — the fast path' : 'no — CPU only'],
    ['CPU cores reported', nav.hardwareConcurrency ?? 'unknown'],
    ['Threads we can use', '1 (SharedArrayBuffer needs COOP+COEP, which would break customer media)'],
    ['Connection', conn.effectiveType ? `${conn.effectiveType}${conn.downlink ? ` · ~${conn.downlink} Mb/s` : ''}` : 'not reported'],
    ['Browser can record', nav.mediaDevices?.getUserMedia ? 'yes' : 'NO — nothing here will work'],
  ];
}

export default function SpeechLab() {
  const [log, setLog] = useState([]);
  const [source, setSource] = useState(null);
  const [loadMs, setLoadMs] = useState(null);
  const [bytes, setBytes] = useState(0);
  const [busy, setBusy] = useState('');
  const [recording, setRecording] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const asr = useRef(null);
  const recorder = useRef(null);
  const chunks = useRef([]);
  const clipStarted = useRef(0);
  const clipMs = useRef(0);

  const say = useCallback((line) => setLog((l) => [...l, line]), []);

  if (!devOnlyVisible()) return null;
  const supported = whisperSupported();

  // ── STEP 1 ── load the model, and record which path it came down
  const load = async () => {
    setError(''); setBusy('Working out whether the bucket is readable from script…');
    const t0 = performance.now();
    let seen = 0;
    try {
      const cdnBase = await fetch('/api/health')
        .then((r) => r.json()).then((h) => h.media_cdn).catch(() => null);

      // A real fetch, because there is no way to ASK a browser whether CORS
      // would allow something. Cheap, and it is the difference between a 43 MB
      // download that fails at the end and one that is never started.
      const direct = cdnBase ? await cdnReadable(cdnBase) : false;
      const use = direct ? SOURCES.cdn : SOURCES.origin;
      setSource(use);
      say(direct
        ? `✓ bucket is readable from script — loading straight from the CDN (${cdnBase})`
        : '✗ bucket did NOT return Access-Control-Allow-Origin — falling back to our own '
          + 'server. Works, but every byte goes through the same box that answers /api/generate. '
          + 'Press "Media CORS" in the maintenance panel to fix it.');

      setBusy('Downloading the model…');
      asr.current = await loadTranscriber({
        source: use,
        cdnBase,
        onProgress: (p) => {
          if (p?.status === 'progress' && p.total) {
            setBusy(`${p.file} — ${Math.round(p.progress)}%`);
          }
          if (p?.status === 'done' && p.total) { seen += p.total; setBytes(seen); }
        },
      });
      const took = performance.now() - t0;
      setLoadMs(took);
      say(`✓ model ready in ${secs(took)}${seen ? ` (${mb(seen)} downloaded)` : ''}`);
      say('  — a second load in this browser is served from cache and should be near-instant.');
    } catch (e) {
      setError(`Loading failed: ${e?.message || e}`);
      say(`✗ ${e?.message || e}`);
    } finally {
      setBusy('');
    }
  };

  // ── STEP 2 ── record, then transcribe, timing each half separately
  const startRec = async () => {
    setError(''); setResult(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks.current = [];
      const rec = new MediaRecorder(stream);
      rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        clipMs.current = performance.now() - clipStarted.current;
        await run();
      };
      recorder.current = rec;
      clipStarted.current = performance.now();
      rec.start();
      setRecording(true);
    } catch (e) {
      setError(`Microphone: ${e?.message || e}`);
    }
  };

  const stopRec = () => { recorder.current?.stop(); setRecording(false); };

  const run = async () => {
    if (!asr.current) { setError('Load the model first.'); return; }
    setBusy('Transcribing…');
    try {
      const blob = new Blob(chunks.current, { type: chunks.current[0]?.type || 'audio/webm' });
      const t0 = performance.now();
      const audio = await toMono16k(await blob.arrayBuffer());
      const decoded = performance.now() - t0;

      const t1 = performance.now();
      const text = await transcribe(asr.current, audio);
      const asrMs = performance.now() - t1;

      // THE number. Not "how fast is Whisper" — how long the person waits
      // between stopping speaking and seeing words, which is the only thing
      // Amr is comparing against.
      const wait = decoded + asrMs;
      setResult({ text, wait, decoded, asrMs, spokeMs: clipMs.current, bytes: blob.size });
      say(`✓ spoke ${secs(clipMs.current)} → waited ${secs(wait)} → "${text.slice(0, 60)}${text.length > 60 ? '…' : ''}"`);
    } catch (e) {
      setError(`Transcription failed: ${e?.message || e}`);
      say(`✗ ${e?.message || e}`);
    } finally {
      setBusy('');
    }
  };

  const Row = ({ k, v }) => (
    <div style={{ display: 'flex', gap: 12, padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
      <span style={{ minWidth: 210, color: 'rgba(255,255,255,0.5)', fontSize: 12.5 }}>{k}</span>
      <span style={{ fontFamily: MONO, fontSize: 12.5 }}>{v}</span>
    </div>
  );

  return (
    <div style={{
      minHeight: '100vh', background: '#0A0A0B', color: '#fff', padding: '40px 24px',
      fontFamily: '"DM Sans", sans-serif',
    }}>
      <div style={{ maxWidth: 780, margin: '0 auto' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>Speech lab</h1>
        <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: 14, lineHeight: 1.6, marginBottom: 26 }}>
          Measuring whether Whisper is fast enough to replace the browser&apos;s recogniser
          on the prompt box. Whisper detects the language by itself — that is not in
          question. What is in question is the wait after you stop speaking.
          <strong style={{ color: '#fff' }}> Nothing here is connected to a customer&apos;s prompt box.</strong>
        </p>

        {!supported && (
          <div style={{ padding: 14, borderRadius: 10, background: 'rgba(224,30,30,0.12)', border: '1px solid rgba(224,30,30,0.4)', marginBottom: 20 }}>
            This browser cannot run it — no WebAssembly, no audio, or no microphone access.
          </div>
        )}

        <h2 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'rgba(255,255,255,0.4)', margin: '26px 0 8px' }}>This machine</h2>
        {machineFacts().map(([k, v]) => <Row key={k} k={k} v={String(v)} />)}

        <h2 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'rgba(255,255,255,0.4)', margin: '26px 0 10px' }}>1 · Load the model</h2>
        <button
          type="button" onClick={load} disabled={!!busy || !supported}
          style={{
            padding: '10px 18px', borderRadius: 8, cursor: busy ? 'wait' : 'pointer',
            background: '#E01E1E', border: 'none', color: '#fff', fontWeight: 600, fontSize: 14,
            opacity: busy || !supported ? 0.5 : 1,
          }}
        >
          {loadMs ? 'Load again (should be cached)' : 'Load — about 43 MB the first time'}
        </button>
        {loadMs !== null && (
          <div style={{ marginTop: 12 }}>
            <Row k="Time to ready" v={secs(loadMs)} />
            <Row k="Downloaded" v={bytes ? mb(bytes) : 'served from cache'} />
            <Row k="Came from" v={source === SOURCES.cdn ? 'the CDN (good)' : 'our own server (CORS fallback)'} />
          </div>
        )}

        <h2 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'rgba(255,255,255,0.4)', margin: '26px 0 10px' }}>2 · Say a prompt</h2>
        <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13, marginBottom: 10 }}>
          Say it in Arabic, in English, or in both in one sentence — no language is
          chosen anywhere in this page.
        </p>
        <button
          type="button" onClick={recording ? stopRec : startRec}
          disabled={!asr.current || !!busy}
          style={{
            padding: '10px 18px', borderRadius: 8, cursor: 'pointer',
            background: recording ? '#E01E1E' : 'rgba(255,255,255,0.1)',
            border: '1px solid rgba(255,255,255,0.2)', color: '#fff', fontWeight: 600, fontSize: 14,
            opacity: !asr.current || busy ? 0.5 : 1,
          }}
        >
          {recording ? 'Stop and transcribe' : 'Record'}
        </button>

        {busy && <p style={{ marginTop: 12, color: '#FFB020', fontFamily: MONO, fontSize: 13 }}>{busy}</p>}
        {error && <p style={{ marginTop: 12, color: '#FF6B6B', fontFamily: MONO, fontSize: 13 }}>{error}</p>}

        {result && (
          <div style={{ marginTop: 18, padding: 16, borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}>
            <div style={{ fontSize: 16, lineHeight: 1.6, marginBottom: 14 }}>{result.text || '(nothing heard)'}</div>
            {/* The wait is the headline, because it is the only number Amr is
                comparing against — everything else is detail underneath it. */}
            <Row k="⏱ WAIT AFTER SPEAKING" v={secs(result.wait)} />
            <Row k="  of which decoding audio" v={secs(result.decoded)} />
            <Row k="  of which the model" v={secs(result.asrMs)} />
            <Row k="You spoke for" v={secs(result.spokeMs)} />
            <Row k="Ratio (wait ÷ speech)" v={`${(result.wait / Math.max(result.spokeMs, 1)).toFixed(2)}×`} />
          </div>
        )}

        {log.length > 0 && (
          <>
            <h2 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'rgba(255,255,255,0.4)', margin: '26px 0 8px' }}>What happened</h2>
            <pre style={{ fontFamily: MONO, fontSize: 12, color: 'rgba(255,255,255,0.7)', whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>
              {log.join('\n')}
            </pre>
          </>
        )}
      </div>
    </div>
  );
}
