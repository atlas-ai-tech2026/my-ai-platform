// ─── mediaSeconds.js ─────────────────────────────────────────────────────────
// How long is this video file, in seconds, as the browser reads it?
//
// Used the moment a reference video is picked for Seedance, so the panel can
// price the job (Seedance bills per second and, with a reference video, the
// output follows that video's length). The server re-reads the length from
// the file itself and bills THAT; this number is display and a cross-check.
//
// Resolves null — never throws — when the browser cannot read the metadata
// (an unsupported container, a broken file). The server then says so.

export function readMediaSeconds(file) {
  return new Promise((resolve) => {
    if (!file) { resolve(null); return; }
    let url;
    try { url = URL.createObjectURL(file); } catch { resolve(null); return; }
    const el = document.createElement('video');
    el.preload = 'metadata';
    el.muted = true;
    const done = (value) => { try { URL.revokeObjectURL(url); } catch { /* ignore */ } resolve(value); };
    el.onloadedmetadata = () => done(Number.isFinite(el.duration) && el.duration > 0 ? el.duration : null);
    el.onerror = () => done(null);
    el.src = url;
  });
}
