// ─── SpeechLabTab.jsx ────────────────────────────────────────────────────────
// A measuring instrument, in the control panel — Amr, 2026-08-30.
//
// ── WHAT IT IS FOR ─────────────────────────────────────────────────────────
// Amr chose Whisper so the microphone stops asking which language he is
// speaking. Whisper detects it; that part is settled. What is NOT settled is
// whether it is fast enough to be an improvement, because it transcribes AFTER
// you stop rather than as you speak — and he came to this from "it's not
// fast".
//
// One number decides it: the wait between stopping speaking and seeing words.
// This measures that, on whatever machine and network you are actually on.
//
// ── AND WHY IT IS IN THE CONTROL PANEL RATHER THAN A DEV URL ───────────────
// It was a dev-only page first. Amr asked for it here, on production as well
// as dev, and he is right: production's boxes, production's CDN and a
// workshop's wifi are the conditions that matter. A number measured on dev
// answers a question nobody asked.
//
// NOTHING HERE IS CONNECTED TO A CUSTOMER'S PROMPT BOX. The microphone
// customers use is the browser's own recogniser and is untouched by this.
//
// ── THE MODEL IS PER-ENVIRONMENT ───────────────────────────────────────────
// It lives in each environment's own Spaces bucket, so dev having it does not
// mean production does — and on 2026-08-30 production's bucket returned 403
// for every file. Hence the readiness check before anything else: an honest
// "not installed here, press this" beats a raw "Could not locate file", which
// is exactly what Amr saw on the first attempt.

import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  whisperSupported, cdnReadable, loadTranscriber, toMono16k, transcribe, SOURCES,
} from '@/lib/whisper';

const MONO = '"JetBrains Mono", ui-monospace, monospace';
const secs = (ms) => `${(ms / 1000).toFixed(2)}s`;
const mb = (b) => `${(b / 1048576).toFixed(1)} MB`;

/** Facts about this machine, read rather than assumed. */
function machineFacts() {
  const nav = typeof navigator !== 'undefined' ? navigator : {};
  const conn = nav.connection || {};
  return [
    ['WebGPU', typeof navigator !== 'undefined' && 'gpu' in navigator ? 'yes — the fast path' : 'no — CPU only'],
    ['CPU cores reported', String(nav.hardwareConcurrency ?? 'unknown')],
    ['Threads we can use', '1 — real threads need COOP+COEP, which would break customer media'],
    ['Connection', conn.effectiveType ? `${conn.effectiveType}${conn.downlink ? ` · ~${conn.downlink} Mb/s` : ''}` : 'not reported'],
    ['Browser can record', nav.mediaDevices?.getUserMedia ? 'yes' : 'NO — nothing here will work'],
  ];
}

export default function SpeechLabTab({ onError }) {
  const [ready, setReady] = useState(null);       // null = still checking
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
  const startedAt = useRef(0);
  const spokeMs = useRef(0);

  const say = useCallback((line) => setLog((l) => [...l, line]), []);

  // Is the model in THIS environment's bucket? Asked through our own route, so
  // the answer does not depend on the bucket's CORS rule being right.
  useEffect(() => {
    let alive = true;
    fetch('/api/speech/model/whisper-tiny/config.json')
      .then((r) => alive && setReady(r.ok))
      .catch(() => alive && setReady(false));
    return () => { alive = false; };
  }, []);

  const load = async () => {
    setError(''); setBusy('Checking whether the bucket is readable from script…');
    const t0 = performance.now();
    let seen = 0;
    try {
      const cdnBase = await fetch('/api/health')
        .then((r) => r.json()).then((h) => h.media_cdn).catch(() => null);

      // A real fetch: there is no way to ASK a browser whether CORS would
      // allow something. Cheap, and it is the difference between a 43 MB
      // download that fails at the very end and one never started.
      const direct = cdnBase ? await cdnReadable(cdnBase) : false;
      const use = direct ? SOURCES.cdn : SOURCES.origin;
      setSource(use);
      say(direct
        ? `✓ bucket readable from script — loading straight from the CDN (${cdnBase})`
        : '✗ the bucket did NOT return Access-Control-Allow-Origin, so this is coming '
          + 'through our own server instead. It works, but every byte goes through the '
          + 'same box that answers /api/generate. Press "Media CORS" in SOP → Maintenance.');

      setBusy('Downloading the model…');
      asr.current = await loadTranscriber({
        source: use,
        cdnBase,
        onProgress: (p) => {
          if (p?.status === 'progress' && p.total) setBusy(`${p.file} — ${Math.round(p.progress)}%`);
          if (p?.status === 'done' && p.total) { seen += p.total; setBytes(seen); }
        },
      });
      const took = performance.now() - t0;
      setLoadMs(took);
      say(`✓ ready in ${secs(took)}${seen ? ` (${mb(seen)} downloaded)` : ' (from cache)'}`);
    } catch (e) {
      const msg = e?.message || String(e);
      setError(`Loading failed: ${msg}`);
      say(`✗ ${msg}`);
      onError?.(msg);
    } finally {
      setBusy('');
    }
  };

  const run = async () => {
    setBusy('Transcribing…');
    try {
      const blob = new Blob(chunks.current, { type: chunks.current[0]?.type || 'audio/webm' });
      const t0 = performance.now();
      const audio = await toMono16k(await blob.arrayBuffer());
      const decoded = performance.now() - t0;

      const t1 = performance.now();
      const text = await transcribe(asr.current, audio);
      const asrMs = performance.now() - t1;

      // THE number. Not "how fast is Whisper" — how long a person waits between
      // stopping speaking and seeing words, which is the only thing being
      // compared against.
      setResult({ text, wait: decoded + asrMs, decoded, asrMs, spokeMs: spokeMs.current });
      say(`✓ spoke ${secs(spokeMs.current)} → waited ${secs(decoded + asrMs)}`);
    } catch (e) {
      const msg = e?.message || String(e);
      setError(`Transcription failed: ${msg}`);
      say(`✗ ${msg}`);
    } finally {
      setBusy('');
    }
  };

  const startRec = async () => {
    setError(''); setResult(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks.current = [];
      const rec = new MediaRecorder(stream);
      rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        spokeMs.current = performance.now() - startedAt.current;
        await run();
      };
      recorder.current = rec;
      startedAt.current = performance.now();
      rec.start();
      setRecording(true);
    } catch (e) {
      setError(`Microphone: ${e?.message || e}`);
    }
  };

  const stopRec = () => { recorder.current?.stop(); setRecording(false); };

  const Row = ({ k, v }) => (
    <div style={{ display: 'flex', gap: 12, padding: '6px 0', borderBottom: '1px solid var(--crm-w06)' }}>
      <span style={{ minWidth: 220, color: 'var(--crm-w50)', fontSize: 12.5 }}>{k}</span>
      <span style={{ fontFamily: MONO, fontSize: 12.5, color: 'var(--crm-ink)' }}>{v}</span>
    </div>
  );

  const H = ({ children }) => (
    <h3 style={{
      fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.14em',
      color: 'var(--crm-w40)', margin: '26px 0 10px', fontWeight: 600,
    }}>{children}</h3>
  );

  // The two skins kept whole rather than assembled from ternaries, so the one
  // legitimate colour literal — white text ON the brand red — is written next
  // to the red it sits on. Everything else follows the theme.
  const ACCENT = { background: '#E01E1E', color: '#fff', border: 'none' };
  const PLAIN = { background: 'var(--crm-w08)', color: 'var(--crm-ink)', border: '1px solid var(--crm-w20)' };

  const btn = (enabled, accent) => ({
    padding: '10px 18px', borderRadius: 8, fontSize: 14, fontWeight: 600,
    cursor: enabled ? 'pointer' : 'not-allowed', opacity: enabled ? 1 : 0.45,
    ...(accent ? ACCENT : PLAIN),
  });

  if (!whisperSupported()) {
    return (
      <div style={{ padding: 16, borderRadius: 10, background: 'var(--crm-red-bg)', border: '1px solid var(--crm-red-br)', color: 'var(--crm-ink)' }}>
        This browser cannot run it — it needs WebAssembly, audio decoding and microphone
        access. Chrome or Edge can.
      </div>
    );
  }

  return (
    <div style={{ color: 'var(--crm-ink)', maxWidth: 820 }}>
      {/* The model is per-environment, so this must be said before anything
          else. Production's bucket was empty on the day this was written. */}
      {ready === false && (
        <div style={{
          padding: 14, borderRadius: 10, marginBottom: 18,
          background: 'var(--crm-amber-bg)', border: '1px solid var(--crm-amber-br)',
        }}>
          <strong>The speech model is not installed in this environment.</strong>
          <div style={{ marginTop: 6, fontSize: 13.5, color: 'var(--crm-ink-2)' }}>
            It lives in each environment&apos;s own storage, so dev having it does not mean
            production does. Open <strong>SOP → Maintenance</strong> and press
            {' '}<strong>Install speech model</strong> (about a minute, one time), then come back.
          </div>
        </div>
      )}

      <H>This machine</H>
      {machineFacts().map(([k, v]) => <Row key={k} k={k} v={v} />)}

      <H>1 · Load the model</H>
      <button type="button" onClick={load} disabled={!!busy || ready === false} style={btn(!busy && ready !== false, true)}>
        {loadMs ? 'Load again — should be cached now' : 'Load — about 43 MB the first time'}
      </button>
      {loadMs !== null && (
        <div style={{ marginTop: 12 }}>
          <Row k="Time to ready" v={secs(loadMs)} />
          <Row k="Downloaded" v={bytes ? mb(bytes) : 'served from cache'} />
          <Row k="Came from" v={source === SOURCES.cdn ? 'the CDN — good' : 'our own server — CORS fallback'} />
        </div>
      )}

      <H>2 · Say a prompt</H>
      <p style={{ color: 'var(--crm-w45)', fontSize: 13, marginBottom: 10 }}>
        Say it in Arabic, in English, or both in one sentence — no language is chosen
        anywhere on this screen. That is the whole point of the test.
      </p>
      <button type="button" onClick={recording ? stopRec : startRec} disabled={!asr.current || !!busy} style={btn(!!asr.current && !busy, recording)}>
        {recording ? 'Stop and transcribe' : 'Record'}
      </button>

      {busy && <p style={{ marginTop: 12, color: 'var(--crm-amber)', fontFamily: MONO, fontSize: 13 }}>{busy}</p>}
      {error && <p style={{ marginTop: 12, color: 'var(--crm-red)', fontFamily: MONO, fontSize: 13 }}>{error}</p>}

      {result && (
        <div style={{
          marginTop: 18, padding: 16, borderRadius: 10,
          background: 'var(--crm-w04)', border: '1px solid var(--crm-w10)',
        }}>
          <div style={{ fontSize: 16, lineHeight: 1.6, marginBottom: 14 }}>
            {result.text || '(nothing heard)'}
          </div>
          <Row k="⏱ WAIT AFTER SPEAKING" v={secs(result.wait)} />
          <Row k="  of which decoding audio" v={secs(result.decoded)} />
          <Row k="  of which the model" v={secs(result.asrMs)} />
          <Row k="You spoke for" v={secs(result.spokeMs)} />
          <Row k="Ratio (wait ÷ speech)" v={`${(result.wait / Math.max(result.spokeMs, 1)).toFixed(2)}×`} />
        </div>
      )}

      {log.length > 0 && (
        <>
          <H>What happened</H>
          <pre style={{
            fontFamily: MONO, fontSize: 12, color: 'var(--crm-w70)',
            whiteSpace: 'pre-wrap', lineHeight: 1.7, margin: 0,
          }}>{log.join('\n')}</pre>
        </>
      )}
    </div>
  );
}
