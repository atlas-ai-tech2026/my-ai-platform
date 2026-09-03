// ─── seedance-reference.js ───────────────────────────────────────────────────
// How long is a Seedance job that carries a reference VIDEO, for billing?
//
// Owner, 2026-09-03: a customer attached a video and an audio clip to
// Seedance 2.5 and got kie's refusal back — "Seedance identified your task as
// video editing based on your prompt … `ratio` must be `adaptive` … `duration`
// must be -1". Seedance decides from the prompt whether a job EDITS the
// attached video; when it does, the output takes the input video's length and
// shape, so it refuses a fixed length or ratio. Voxel always sent a fixed
// length — "Auto" on the picker was silently 5 seconds.
//
// So with a reference video the request sends duration -1 / ratio adaptive
// (kie: "the model picks", valid for any Seedance 2.x job) and the charge is
// per second of the LONGEST reference video, read from the file itself
// (media-probe.js). The browser also sends what it read; that number is a
// cross-check, and the fallback only when the file cannot be parsed.

/**
 * @param probed      seconds read from each reference video's file (null = unreadable)
 * @param declared    seconds the browser reported for the longest video (optional)
 * @param maxSeconds  the model's ceiling — 30 for Seedance 2.5, 15 for the 2.0 family
 * @param minSeconds  Seedance's floor for a reference video (4)
 */
export function referenceVideoBilling({ probed = [], declared, maxSeconds = 30, minSeconds = 4 } = {}) {
  const fromFile = (probed || []).filter((s) => Number.isFinite(s) && s > 0);
  const declaredNum = Number(declared);
  const hasDeclared = Number.isFinite(declaredNum) && declaredNum > 0;
  if (!fromFile.length && !hasDeclared) return { unreadable: true };

  const source = fromFile.length ? 'file' : 'declared';
  const longest = Math.round(source === 'file' ? Math.max(...fromFile) : declaredNum);
  const outOfRange = longest < minSeconds || longest > maxSeconds;
  const seconds = Math.max(minSeconds, Math.min(maxSeconds, longest));
  const declaredRounded = hasDeclared ? Math.round(declaredNum) : null;
  const drift = source === 'file' && hasDeclared && declaredRounded !== longest;
  return { unreadable: false, source, longest, outOfRange, seconds, drift, declared: declaredRounded };
}
