// Math + transport helpers for the Audio page. Extracted so Audio.jsx
// stays focused on state and orchestration.
import { VOXEL_TOKEN_KEY } from '@/lib/adminApi';

export const BAR_COUNT = 220;

// Pseudo-random preview amplitudes — used before the first synthesis
// so the canvas isn't blank. Seeded so re-renders don't flicker.
export function genPreviewAmplitudes(seed, count = BAR_COUNT) {
  const out = [];
  let x = seed * 9999 + 17;
  for (let i = 0; i < count; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    const r = x / 0x7fffffff;
    const env = 0.4 + Math.sin((i / count) * Math.PI * 2.7 + seed) * 0.18;
    out.push(Math.max(0.06, Math.min(1, env + (r - 0.5) * 0.65)));
  }
  return out;
}

// Downsample a Float32Array of PCM samples into N peak-magnitude bins.
// Each bin is the average abs amplitude of its slice — close enough to
// what an FFT would show for visual purposes, and ~10× cheaper.
// Output is normalised so the loudest bin = 1.0.
export function pcmToAmplitudes(pcm, count = BAR_COUNT) {
  const out = new Array(count).fill(0);
  const sliceLen = pcm.length / count;
  let max = 0;
  for (let i = 0; i < count; i++) {
    const start = Math.floor(i * sliceLen);
    const end = Math.min(pcm.length, Math.floor((i + 1) * sliceLen));
    let sum = 0;
    for (let j = start; j < end; j++) sum += Math.abs(pcm[j]);
    const v = end > start ? sum / (end - start) : 0;
    out[i] = v;
    if (v > max) max = v;
  }
  const norm = max > 0 ? max : 1;
  return out.map(v => Math.max(0.06, Math.min(1, v / norm)));
}

// Same auth-header helper used by the Video page — adds the bearer
// token from localStorage if signed in. Public-site routes (the TTS
// route requires auth) get a 401 with a useful message we surface
// as a toast in the page handler.
export function authJsonHeaders() {
  const token = localStorage.getItem(VOXEL_TOKEN_KEY);
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}
