// ─── maintenance-outcome.js ──────────────────────────────────────────────────
// Turn the JSON a maintenance endpoint returns into the sentence the owner
// reads.
//
// ── WHY THIS IS A MODULE AND NOT A FEW LINES OF JSX ────────────────────────
// Because it is the only part that can lie. Every one of these jobs can come
// back HALF DONE — six of seven model files, forty of sixty files rescued —
// and every one of them returns HTTP 200 while doing so. A green tick on a
// half-finished rescue is worse than a red cross, because the owner stops
// looking.
//
// So the rule is one line, and the tests are mostly about it:
//
//   SUCCESS MEANS NOTHING FAILED AND SOMETHING HAPPENED.
//
// Partial → 'partial'. Nothing to do → 'idle', never 'ok'. And a run that did
// half the queue is a REASON TO RUN AGAIN, which the sentence has to say,
// because "40 rescued" reads like an ending.

/** A count that is missing is unknown, not zero. Zero is a claim. */
const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const plural = (c, one, many = `${one}s`) => `${c} ${c === 1 ? one : many}`;

/**
 * @returns {{tone:'ok'|'partial'|'idle'|'bad', headline:string, detail:string,
 *            again:boolean}} `again` = there is more queued; running it once
 *            more is the correct next action rather than a retry of a failure.
 */
export function outcomeOf(action, result) {
  if (!result) return { tone: 'bad', headline: 'No answer came back.', detail: '', again: false };
  if (result.error) {
    // Keep `stage` if the server gave one. It is the difference between "the
    // write was refused" and "the write worked and reading it back did not",
    // and only the second means the bucket may already have changed.
    const where = result.stage ? `Failed while ${result.stage}. ` : '';

    // ── "ACCESS DENIED" IS NOT A FAULT, IT IS A DESIGN DECISION ────────────
    // Amr pressed Preview on 2026-08-31 and got "It did not run. Could not
    // read the bucket rules: Access Denied." — which reads like something
    // broke. Nothing broke. The app's storage key is deliberately LIMITED
    // ACCESS (the security work of 2026-08-19, after three keys with full
    // access to every bucket were found), and DigitalOcean grants bucket
    // CONFIGURATION — lifecycle, versioning, CORS, policies — only to FULL
    // ACCESS keys.
    //
    // The versioning path has said this since it was written, and pointed at
    // a script. The lifecycle path shipped without it, so the owner was left
    // at a dead end on a job I had told him was one press away.
    //
    // An expected refusal must never look like a malfunction.
    // `access\s*denied`, not `access denied`: the S3 SDK's error NAME is
    // "AccessDenied" with no space, and that is the form that actually
    // arrives. The spaced-only version was caught by the test below, not by
    // reading it back.
    if (/access\s*denied|forbidden|not authoriz/i.test(String(result.error))) {
      return {
        tone: 'partial',
        headline: 'This key is not allowed to change bucket settings — by design.',
        detail: 'The app runs on a Limited Access key that can read and write FILES but '
          + 'not bucket rules. That is deliberate: giving the running app permanent '
          + 'authority to reconfigure or delete any bucket, for a setting used once, '
          + 'would undo the key cleanup of 19 August. It needs a temporary Full Access '
          + 'key run from a laptop — ask Claude for the steps.',
        again: false,
      };
    }

    return { tone: 'bad', headline: 'It did not run.', detail: `${where}${result.error}`, again: false };
  }

  switch (action) {
    case 'whisper': return whisper(result);
    case 'cors':    return cors(result);
    case 'rescue':  return rescue(result);
    case 'thumbs':  return thumbs(result);
    case 'passphrase': return passphrase(result);
    case 'expiry':  return expiry(result);
    // The server already produced the sentence — it holds the numbers and the
    // failing keys. Repeating that judgement here would be a second place for
    // it to disagree with itself.
    case 'ledgerAudit': return {
      tone: result.tone === 'ok' ? 'ok' : (result.tone === 'bad' ? 'bad' : 'idle'),
      headline: result.headline || 'No answer came back.',
      detail: result.detail || '',
      again: false,
    };
    default:        return { tone: 'bad', headline: 'Unknown job.', detail: '', again: false };
  }
}

// ── The speech model ────────────────────────────────────────────────────────
// `complete` is the only field that decides. Files stored is progress, and
// progress is not a model: six of seven fails inside a web worker on a
// customer's machine, which is the hardest place there is to debug.
function whisper(r) {
  const stored = n(r.stored) ?? 0;
  const skipped = n(r.skipped) ?? 0;
  const size = r.downloadedMB ? ` (${r.downloadedMB} MB downloaded)` : '';

  if (!r.complete) {
    return {
      tone: 'partial',
      headline: 'The model is NOT installed.',
      detail: `${plural(stored + skipped, 'file')} of the set are there. `
        + `${firstProblems(r.problems)} Nothing will use a half-installed model — press it again.`,
      again: true,
    };
  }
  if (stored === 0) {
    return { tone: 'idle', headline: 'Already installed — nothing to do.',
      detail: `All ${skipped} files were already in the bucket.`, again: false };
  }
  return { tone: 'ok', headline: 'The speech model is in our bucket.',
    detail: `${plural(stored, 'file')} stored${size}. Transcription can now run entirely `
      + 'in the customer\'s browser — no audio leaves their computer.', again: false };
}

// ── The bucket's CORS rule ──────────────────────────────────────────────────
function cors(r) {
  if (!r.ok) {
    return { tone: 'bad', headline: 'The rule was not applied.',
      detail: `Failed while ${r.stage || 'running'}. ${r.error || ''}`.trim(), again: false };
  }
  if (r.changed === false) {
    return { tone: 'idle', headline: 'The rule was already there.',
      detail: 'Nothing was written. Export can read a Voxel clip.', again: false };
  }
  return { tone: 'ok', headline: 'Export can now read a Voxel clip.',
    detail: 'The bucket answers the editor with the header the browser needs. '
      + 'Read-only: GET and HEAD, nothing that can write.', again: false };
}

// ── The file rescue ─────────────────────────────────────────────────────────
// The one with real consequences, so it is the one that states plainly what
// it could NOT do. "Already gone" is not a failure and not a save — those
// files were lost before this ran, and no run will bring them back.
function rescue(r) {
  const rescued = n(r.rescued) ?? 0;
  const gone = n(r.alreadyGone) ?? 0;
  const failed = n(r.failed) ?? 0;
  const considered = n(r.considered) ?? (rescued + gone + failed);
  const moved = r.movedMB ? `, ${r.movedMB} MB copied` : '';

  const parts = [];
  if (rescued) parts.push(`${plural(rescued, 'file')} copied into our own storage${moved}`);
  if (gone) parts.push(`${plural(gone, 'file')} ${gone === 1 ? 'was' : 'were'} already gone before this ran`);
  if (failed) parts.push(`${plural(failed, 'file')} failed. ${firstProblems(r.problems)}`);

  if (!considered) {
    return { tone: 'idle', headline: 'Nothing was queued.',
      detail: 'No at-risk files were found for this scope. That is the answer, not an error.',
      again: false };
  }
  // A full batch means the queue is almost certainly longer than the limit.
  const more = considered >= (n(r.limit) || considered) && rescued > 0;
  if (failed) {
    return { tone: 'partial', headline: `${plural(rescued, 'file')} saved, ${failed} failed.`,
      detail: `${parts.join('. ')}.`, again: true };
  }
  if (!rescued) {
    // The queue is NEWEST FIRST. So a batch that is entirely gone means the
    // older ones are gone too — this is a finished answer, not a bad batch,
    // and pressing again will say the same thing. Saying so stops the owner
    // pressing a button that cannot change its reply.
    return {
      tone: 'idle',
      headline: 'Nothing left to save here.',
      detail: `${parts.join('. ')}. These are checked NEWEST FIRST, so everything older is gone `
        + 'too — there is nothing more for this scope. They expired at the provider before we '
        + 'started copying files into our own storage.',
      again: false,
    };
  }
  return {
    tone: 'ok',
    headline: `${plural(rescued, 'file')} rescued.`,
    detail: `${parts.join('. ')}.`
      + (more ? ' This was one batch — press it again to take the next one.' : ''),
    again: more,
  };
}

// ── Thumbnails ──────────────────────────────────────────────────────────────
function thumbs(r) {
  const done = n(r.done) ?? 0;
  const failed = n(r.failed) ?? 0;
  const attempted = n(r.attempted) ?? (done + failed);
  const saved = r.savedMB ? `, ${r.savedMB} MB less to download` : '';

  if (!attempted) {
    return { tone: 'idle', headline: 'Nothing needed one.',
      detail: 'Every generation in this account already has a small version.', again: false };
  }
  if (failed) {
    return { tone: 'partial', headline: `${plural(done, 'thumbnail')} made, ${failed} failed.`,
      detail: `The ${failed} that failed kept their original and lost nothing — they just did not `
        + `get faster. ${firstProblems(r.problems)}`, again: true };
  }
  return { tone: 'ok', headline: `${plural(done, 'thumbnail')} made.`,
    detail: `The grid loads these instead of the full-size file${saved}. `
      + 'Opening a picture still shows the original.'
      + (done >= (n(r.limit) || done) ? ' Press it again for the next batch.' : ''),
    again: done >= (n(r.limit) || done) };
}

// ── Was the backup passphrase rotated? ──────────────────────────────────────
// A FAILURE HERE IS NOT A BUG. It means the passphrase changed and everything
// written before the change can no longer be opened — which is exactly the
// thing worth finding out on a quiet afternoon rather than during a restore.
// So it is amber, not red, and the sentence says which of the two it is.
function passphrase(r) {
  const which = r.archive ? ` Archive tested: ${r.archive}.` : '';
  if (r.opened) {
    return { tone: 'ok', headline: 'The passphrase has not changed.',
      detail: 'The current passphrase opened the OLDEST archive we still hold, so every archive '
        + `in between opens too.${which}`, again: false };
  }
  return {
    tone: 'partial',
    headline: 'The oldest archive could NOT be opened.',
    detail: `${r.verdict || 'Either the passphrase was changed, or that archive is damaged.'} `
      + `This is a finding, not a crash — but archives older than the change are unreadable.${which} `
      + `${firstProblems(r.problems)}`.trim(),
    again: false,
  };
}

// ── The bucket rule ─────────────────────────────────────────────────────────
// The preview and the apply come back through here. A preview must never read
// as "done" — it changed nothing, and mistaking one for the other on THIS job
// is how somebody concludes the rule is in place when it is not.
function expiry(r) {
  // Any rule that deletes LIVE files outranks everything else on this screen.
  if (r.dangerousRules?.length || r.liveExpiryRules?.length) {
    const names = (r.dangerousRules || r.liveExpiryRules).join(', ');
    return {
      tone: 'bad',
      headline: 'STOP — a rule on this bucket deletes LIVE files.',
      detail: `Rule(s): ${names}. That removes customers' actual pictures on a timer, not old `
        + 'versions of deleted ones. Do not run anything else here until it is understood.',
      again: false,
    };
  }
  if (r.ok === undefined) {
    // A preview. It wrote nothing, and says so first.
    return {
      tone: 'idle',
      headline: r.unchanged ? 'Already set — Run would change nothing.' : 'Preview only — nothing changed.',
      detail: `${r.summary}${r.otherRules?.length ? ` Other rules left alone: ${r.otherRules.join(', ')}.` : ''}`,
      again: false,
    };
  }
  if (!r.ok) {
    return { tone: 'bad', headline: 'The rule was not applied.',
      detail: `Failed while ${r.stage || 'running'}. ${r.error || ''}`.trim(), again: false };
  }
  if (!r.changed) {
    return { tone: 'idle', headline: 'Already set — nothing was written.', detail: r.summary || '', again: false };
  }
  return {
    tone: 'ok',
    headline: `Old versions now expire after ${r.days} days.`,
    detail: 'Read back and confirmed. Live files are untouched — this only removes copies the '
      + 'bucket kept after something was deleted or overwritten.',
    again: false,
  };
}

/** Name what went wrong. A count with no reason cannot be acted on. */
function firstProblems(problems, max = 2) {
  if (!Array.isArray(problems) || !problems.length) return '';
  const shown = problems.slice(0, max)
    .map((p) => `${p.file || p.id || 'one'}: ${p.why || p.error || 'no reason given'}`);
  const rest = problems.length - shown.length;
  return `${shown.join('; ')}${rest > 0 ? ` (and ${rest} more)` : ''}.`;
}
