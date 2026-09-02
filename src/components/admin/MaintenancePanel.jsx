// ─── MaintenancePanel.jsx ────────────────────────────────────────────────────
// The four one-shot jobs, with faces.
//
// ── WHY THIS EXISTS, WHICH IS NOT A FLATTERING STORY ───────────────────────
// Four endpoints were written, tested, reviewed and deployed — the rescue, the
// thumbnails, the bucket's CORS rule, the speech model — and NOT ONE OF THEM
// COULD BE PRESSED. A GET can be run by pasting its url in the address bar
// while signed in as admin, which is how the health check was run. A POST
// cannot: it needs the CSRF header that only this client sends.
//
// So "built and deployed" meant "unreachable", and the owner was told the work
// was ready. That is the same mistake as the task board — correct code, tested,
// that never reached a screen — which is the reason RULE 2 is written down.
//
// ── WHAT THE DESIGN IS FOR ─────────────────────────────────────────────────
// These are not dashboard tiles. Two of them WRITE TO 601 CUSTOMERS' HISTORY,
// and they sit one tab away from the button that expires accounts. So:
//
//   · every card states what it writes BEFORE the button, not after
//   · the two that touch customer rows are scoped to an account by default,
//     and running across every account takes a deliberate second action
//   · the result is printed from the endpoint's own numbers, and a partial
//     run says PARTIAL — see maintenance-outcome.js, which is where the only
//     part of this that can lie lives, and where its tests are

import React, { useState } from 'react';
import { toast } from 'sonner';
import { adminApi } from '@/lib/adminApi';
import { outcomeOf } from '@/lib/maintenance-outcome';
import InfoDot from './InfoDot';

/**
 * The largest batch that can actually FINISH.
 *
 * These jobs run while the page waits, and Cloudflare cuts a proxied request
 * at about 100 seconds. The real measured rate on production was 20 thumbnails
 * in 24 seconds — 1.2s each — so anything past roughly 80 is cut off.
 *
 * Nothing is lost when that happens: each thumbnail is saved as it is made, so
 * the finished ones keep theirs. But the screen shows a failure that is not
 * one, and a box that accepts 1000 while 80 is the ceiling is a trap I built
 * and Amr would have walked into.
 */
export const MAX_BATCH = 60;

const TONE = {
  ok:      { dot: 'var(--crm-green)', bg: 'transparent' },
  idle:    { dot: 'var(--crm-w40)',   bg: 'var(--crm-w03)' },
  partial: { dot: 'var(--crm-amber)', bg: 'var(--crm-amber-bg)' },
  bad:     { dot: 'var(--crm-red)',   bg: 'var(--crm-red-bg)' },
};

/**
 * The jobs, in the order they matter.
 *
 * `writes` is the sentence the owner reads before deciding. It is deliberately
 * blunt about customer data, because two of these do write to it and a vague
 * description of that is worse than none.
 */
// Exported so a test can count the REAL list. It used to assert a literal 6,
// which is a number that is wrong the moment a job is added — and a test that
// has to be edited to add a feature teaches people to edit tests.
export const JOBS = [
  {
    id: 'rescue',
    title: 'Rescue expiring files',
    blurb: 'Copies files that still live on the provider\'s storage into ours, before their '
      + 'links expire. Run it in batches; each press takes the next batch.',
    writes: 'WRITES to customer history — replaces the link on a generation with our own copy. '
      + 'Only after the copy is verified byte-for-byte, so a failure leaves the row untouched.',
    info: 'The provider deletes output files after a while. Anything still on their storage is on '
      + 'a clock. This copies the file into our bucket and points the row at our copy. A file that '
      + 'has ALREADY expired cannot be recovered by this or anything else — it reports those '
      + 'separately as "already gone" so the two are never confused.',
    scoped: true,
    danger: true,
    run: (f) => adminApi.mediaRescue(f.all ? { all: true, limit: f.limit } : { email: f.email, limit: f.limit }),
  },
  {
    id: 'thumbs',
    title: 'Make small versions',
    blurb: 'Builds a small copy of each picture so the history grid loads those instead of the '
      + 'full-size file. YOU NO LONGER NEED THIS FOR NORMAL USE: new pictures get a small version '
      + 'as they are made, and a background job works through the older ones on its own. Use it '
      + 'only to push one account to the front of the queue.',
    writes: 'WRITES to customer history — adds a thumb_url. The original is never touched, moved '
      + 'or deleted, and opening a picture still shows it at full size.',
    info: 'The grid was downloading twelve full-size files at 7.5 MB each. This makes a small copy '
      + 'for the grid only. It ADDS a field; nothing existing is modified, so the worst case for a '
      + 'row that fails is that it stays exactly as slow as it is today. Two things now do this '
      + 'without anybody pressing a button: every new picture gets one as it is saved, and a '
      + 'background sweep does 25 of the older ones every five minutes, newest first, across all '
      + 'accounts. This button remains for when one customer should not wait their turn.',
    scoped: true,
    emailOnly: true,
    run: (f) => adminApi.thumbsBackfill({ email: f.email, limit: f.limit }),
  },
  {
    id: 'cors',
    title: 'Let the editor read our files',
    blurb: 'Adds the read-only rule the browser needs before Edit Cut can export a timeline '
      + 'containing a Voxel clip.',
    writes: 'Touches bucket SETTINGS only. No customer row, no file. Read-only: GET and HEAD.',
    info: 'Export builds the video in the browser, so the browser has to READ the clip. Without '
      + 'this rule the bucket serves the file to an <img> but refuses it to the exporter, and the '
      + 'export fails with a message about the network that has nothing to do with the network.',
    run: () => adminApi.mediaCors(),
  },
  {
    id: 'whisper',
    title: 'Install the speech model',
    blurb: 'Puts the transcription model in our own bucket, so a customer\'s browser never '
      + 'contacts a third party to transcribe their own video. About 40 MB, once.',
    writes: 'Writes to models/ in the bucket. Nowhere near customer media, and no database row.',
    info: 'Transcription runs inside the customer\'s browser and the audio never leaves their '
      + 'computer — which stops being true if the browser has to fetch the model from HuggingFace. '
      + 'Hosting it ourselves also needs no CSP change. Safe to press twice: files already there '
      + 'are skipped.',
    run: () => adminApi.whisperModel(false),
  },
  {
    id: 'expiry',
    title: 'Stop keeping deleted files forever',
    blurb: 'Old versions of deleted or overwritten files are removed after 60 days. LIVE files are '
      + 'never touched — this only affects copies the bucket keeps after something is deleted.',
    writes: 'Changes ONE bucket rule. No customer row, no live file. Read the preview first — press '
      + 'Preview before Run.',
    info: 'Versioning is switched on, which is what makes a stolen key or a mistaken script '
      + 'survivable — deleting an object keeps the old bytes recoverable. The cost is that a file '
      + 'deleted by a customer is never really deleted, so "permanently deleted after 30 days" is '
      + 'true of the service and not of the storage. 60 days is a month past the customer window, so '
      + 'a late-discovered mistake is still fixable and destruction eventually follows. Preview '
      + 'writes nothing and shows exactly what would change.',
    preview: () => adminApi.versionExpiryPlan(),
    run: () => adminApi.versionExpiryApply(),
  },
  {
    // Added 2026-08-31, the day the backup verification was fixed. It answers
    // the question the fix leaves behind rather than assuming the answer.
    id: 'ledgerAudit',
    title: 'Check the files copied while the backup was blind',
    blurb: 'For eleven days the backup recorded a file as safe because the upload did not fail — '
      + 'nothing was ever read back. This reads a random sample of those files back from '
      + 'Backblaze and reports whether they are really there, at the right size.',
    writes: 'Writes NOTHING. It only reads files back. A file that fails is reported, never '
      + 'deleted and never re-copied — that would be a repair, and a repair is your decision.',
    info: 'Between 20 August and 31 August the check that reads copies back was broken by a '
      + 'connection leak in our own code, so every file copied in that window was marked backed '
      + 'up on the strength of the upload alone. The copies are very probably fine — Backblaze\u2019s '
      + 'own console showed the media arriving throughout — but "very probably" is not the '
      + 'standard for a backup. A sample of 200 rather than all ~17,000: if 200 random files all '
      + 'read back correctly, widespread loss did not happen. If even one fails, that is a '
      + 'finding, and every file from that window needs reading back.',
    run: () => adminApi.ledgerAudit(),
  },
  {
    id: 'passphrase',
    title: 'Was the backup passphrase changed?',
    blurb: 'Tries the current passphrase against the OLDEST archive we still hold. If it opens, '
      + 'the passphrase has not changed since that archive was written.',
    writes: 'Writes nothing. Downloads one archive and decrypts it in memory. The passphrase is '
      + 'never shown, logged, or sent anywhere.',
    info: 'Asked on 21 August: had it been rotated after appearing in a screenshot? Nobody has to '
      + 'remember. If it opens the oldest archive, it has not changed. If it does not, everything '
      + 'written before the change is unreadable — which is worth knowing on a quiet afternoon '
      + 'rather than during a real restore.',
    run: () => adminApi.passphraseCheck(),
  },
  {
    id: 'restoreVerify',
    title: 'Prove the backup can actually be restored',
    blurb: 'Downloads the newest encrypted archive, decrypts it, and loads it into a scratch '
      + 'database to confirm the rows are really there. Preview shows the last twelve runs '
      + 'without running anything.',
    writes: 'Writes NOTHING to customer data. It builds a throwaway copy, counts what came back, '
      + 'and records the result. The live database is never touched.',
    info: 'This runs monthly on its own, and its own code says the answer to "are we safe?" should '
      + 'never be "wait a month and find out" — yet until now there was no way to ask. Press Preview '
      + 'to read the history; press Run only when you actually want to prove it now. A run downloads '
      + 'and decrypts a real archive, so it takes a minute and can be cut off at 100 seconds by the '
      + 'proxy — the result is still recorded server-side either way, so check Preview again if the '
      + 'page gives up first.',
    preview: () => adminApi.backupVerification(),
    run: () => adminApi.backupVerifyNow(),
  },
  {
    id: 'advisories',
    title: 'Accept the dependency advisories you have read',
    blurb: 'Marks the advisories from the last weekly audit as reviewed, so the SOP line stops '
      + 'saying "none reviewed yet" and reports only what appears from now on.',
    writes: 'Writes a list of advisory names to our own table. No customer row, no file, and it '
      + 'changes NO dependency — accepting is a note that you have read something, not a fix.',
    info: 'The advisory line has told you to "review them once and accept them" since the day it '
      + 'shipped, and until now there was no way to accept anything: the function existed and was '
      + 'called by nothing. That is why the line has read "first check, none reviewed yet" every '
      + 'week. Press Preview first — this list is dismissed permanently, and anything already on '
      + 'it will never be announced again. It accepts the STORED list from the last audit, not a '
      + 'fresh one, so what you dismiss is exactly what you read.',
    preview: () => adminApi.advisories(),
    run: () => adminApi.acceptAdvisories(),
  },
];

export default function MaintenancePanel({ onError }) {
  const [busy, setBusy] = useState(null);
  const [scale, setScale] = useState(null);
  const [results, setResults] = useState({});
  const [form, setForm] = useState({ email: '', limit: 20, all: false });

  async function run(job, { preview = false } = {}) {
    if (!preview && job.scoped && !form.all && !form.email.trim()) {
      toast.error('Put an account email in first.');
      return;
    }
    setBusy(job.id);
    try {
      const call = preview ? job.preview : job.run;
      const body = await call({ ...form, email: form.email.trim(), limit: Number(form.limit) || 20 });
      // The limit round-trips so the outcome can tell a FULL batch (there is
      // more queued) from a part-full one (that was everything).
      setResults((r) => ({ ...r, [job.id]: { limit: Number(form.limit) || 20, ...body } }));
    } catch (e) {
      // A thrown ApiError still carries the server's own words. Show those —
      // the 500 on a half-installed model is deliberate, and its body is the
      // report, not a stack trace.
      if (e?.body) setResults((r) => ({ ...r, [job.id]: { limit: Number(form.limit) || 20, ...e.body } }));
      else onError?.(e, `${job.title} could not run`);
    } finally { setBusy(null); }
  }

  return (
    <section style={{ marginTop: 26 }}>
      <div style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 700, color: 'var(--crm-ink)', fontSize: 14 }}>Jobs you run by hand</span>
          <InfoDot
            label="Jobs you run by hand"
            text={'One-off work that is not on a schedule. Each says what it writes before you press '
              + 'it. Nothing here deletes anything, and the two that touch customer history are '
              + 'scoped to one account unless you deliberately widen them.'}
          />
        </div>
        <div style={{ fontSize: 12, color: 'var(--crm-w50)', marginTop: 2 }}>
          Read what each one writes before pressing. Results below are the job&apos;s own numbers.
        </div>
      </div>

      <div style={{
        display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end',
        padding: '12px 14px', borderRadius: 10, marginBottom: 12,
        border: '1px solid var(--crm-w08)', background: 'var(--crm-w03)',
      }}>
        <label style={{ fontSize: 12, color: 'var(--crm-w55)' }}>
          <div style={{ marginBottom: 4 }}>Account email</div>
          <input
            type="email" value={form.email} disabled={form.all}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            placeholder="someone@example.com"
            style={{ ...inp, width: 260, opacity: form.all ? 0.45 : 1 }}
          />
        </label>
        <label style={{ fontSize: 12, color: 'var(--crm-w55)' }}>
          <div style={{ marginBottom: 4 }}>Batch size</div>
          <input
            type="number" min="1" max={MAX_BATCH} value={form.limit}
            onChange={(e) => setForm((f) => ({
              // Clamped on the way IN, not validated on the way out. A number
              // that cannot finish should be impossible to type, not corrected
              // after it has already failed.
              ...f, limit: Math.min(MAX_BATCH, Math.max(1, Number(e.target.value) || 1)),
            }))}
            style={{ ...inp, width: 90 }}
          />
          <div style={{ fontSize: 11, color: 'var(--crm-w40)', marginTop: 3 }}>
            {MAX_BATCH} max — bigger runs get cut off at 100s
          </div>
        </label>
        <label style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer',
          fontSize: 12.5, color: 'var(--crm-ink)', paddingBottom: 7,
        }}>
          <input
            type="checkbox" checked={form.all}
            onChange={(e) => setForm((f) => ({ ...f, all: e.target.checked }))}
          />
          Every account (rescue only)
        </label>
        {form.all && (
          <div style={{ flexBasis: '100%', fontSize: 12, color: 'var(--crm-amber)' }}>
            The rescue will run across all accounts, newest files first, up to the batch size.
            Small batches are safer and you can press it as many times as you like.
          </div>
        )}
      </div>

      <ScaleLine scale={scale} onLoad={async () => {
        setBusy('scale');
        try { setScale(await adminApi.thumbsScale()); }
        catch (e) { onError?.(e, 'The count could not run'); }
        finally { setBusy(null); }
      }} busy={busy === 'scale'} anyBusy={!!busy} />

      {JOBS.map((job) => (
        <Card key={job.id} job={job} busy={busy === job.id} anyBusy={!!busy}
          result={results[job.id]}
          onRun={() => run(job)}
          onPreview={() => run(job, { preview: true })} />
      ))}
    </section>
  );
}

/**
 * How much work is left, across everyone.
 *
 * Separate from the job cards because it CHANGES NOTHING — it is the number
 * you read before deciding, not a thing you run. And it exists because Amr
 * asked the right question: pressing a button once per account, 601 times, is
 * not a plan.
 */
function ScaleLine({ scale, onLoad, busy, anyBusy }) {
  return (
    <div style={{
      padding: '12px 14px', borderRadius: 10, marginBottom: 10,
      border: '1px solid var(--crm-w08)', background: 'var(--crm-w03)',
    }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--crm-ink)' }}>
          How much is left, across every account
        </span>
        <InfoDot
          label="How much is left"
          text={'Counts every picture that still loads at full size, and measures a random sample to '
            + 'estimate the data still to move. It writes NOTHING. This is now a PROGRESS figure, not '
            + 'a decision: a background sweep works through 25 every five minutes, newest first, '
            + 'across all accounts, so this number should fall on its own between visits. It counts '
            + 'separately the rows the sweep will never take — deleted pictures, and originals that '
            + 'have gone — so it can actually reach zero instead of stalling and looking stuck. If '
            + 'the data cost cannot be measured it says "unknown", never zero.'}
        />
        <button onClick={onLoad} disabled={anyBusy} style={{ ...btn, marginLeft: 'auto' }}>
          {busy ? 'Counting…' : scale ? 'Count again' : 'Count'}
        </button>
      </div>

      {scale && (
        <div style={{ marginTop: 10, fontSize: 12.5, color: 'var(--crm-w55)', lineHeight: 1.7 }}>
          <div style={{ color: 'var(--crm-ink)', fontWeight: 600, marginBottom: 4 }}>{scale.verdict}</div>
          <div>
            {scale.have.toLocaleString()} already done
            {scale.done_pct !== null ? ` (${scale.done_pct}%)` : ''}
            {' · '}{scale.accounts_waiting.toLocaleString()} of {scale.accounts_total.toLocaleString()} accounts waiting
          </div>
          <div>
            {/* The number that answers "do I have to press this myself?" —
                and the answer is now no. Shown as a plain statement rather
                than an amber warning, because there is nothing to act on. */}
            <strong style={{ color: 'var(--crm-green)' }}>
              {scale.presses_by_hand === 0
                ? 'Nothing to press — the sweep does this on its own'
                : `${scale.presses_by_hand.toLocaleString()} presses by hand`}
            </strong>
            {scale.days_at_slow_pace > 0 && (
              <>{' · '}about {scale.days_at_slow_pace} days left at its current pace</>
            )}
            {scale.skipped > 0 && (
              <span style={{ color: 'var(--crm-w40)' }}>
                {' · '}{scale.skipped.toLocaleString()} skipped (deleted or original gone)
              </span>
            )}
          </div>
          <div style={{ color: 'var(--crm-w40)', fontSize: 11.5 }}>
            {scale.estimated_gb_moved === null
              ? 'Data cost UNKNOWN — nothing could be measured. Do not read that as zero.'
              : `~${scale.estimated_gb_moved} GB moved (estimated from ${scale.sampled} files averaging ${scale.avg_mb} MB)`}
          </div>
        </div>
      )}
    </div>
  );
}

function Card({ job, busy, anyBusy, result, onRun, onPreview }) {
  const out = result ? outcomeOf(job.id, result) : null;
  const tone = out ? TONE[out.tone] : null;

  return (
    <div style={{
      padding: '12px 14px', borderRadius: 10, marginBottom: 8,
      border: `1px solid ${job.danger ? 'var(--crm-amber)' : 'var(--crm-w08)'}`,
      background: 'var(--crm-w03)',
    }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--crm-ink)' }}>{job.title}</span>
        <InfoDot label={job.title} text={job.info} />
        {/* Named, not just "Run". Five identical buttons on one screen is a
            way to press the wrong one, and two of these write to customer
            history. Screen readers get the same benefit. */}
        {/* Some jobs can be understood before they are done. Preview writes
            nothing — it is the difference between reading a bucket rule and
            applying one. */}
        {job.preview && (
          <button
            onClick={onPreview} disabled={anyBusy} aria-label={`Preview: ${job.title}`}
            style={{ ...btn, marginLeft: 'auto' }}
          >
            {busy ? '…' : 'Preview'}
          </button>
        )}
        <button
          onClick={onRun} disabled={anyBusy} aria-label={`${out?.again ? 'Run again' : 'Run'}: ${job.title}`}
          style={{ ...btn, marginLeft: job.preview ? 0 : 'auto' }}
        >
          {busy ? 'Running…' : out?.again ? 'Run again' : 'Run'}
        </button>
      </div>

      <div style={{ fontSize: 12, color: 'var(--crm-w55)', marginTop: 6, lineHeight: 1.6 }}>
        {job.blurb}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--crm-w40)', marginTop: 4, lineHeight: 1.6 }}>
        {job.writes}
      </div>

      {out && (
        <div style={{
          display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 10,
          padding: '10px 12px', borderRadius: 8,
          background: tone.bg, border: '1px solid var(--crm-w08)',
        }}>
          <span aria-hidden="true" style={{
            width: 9, height: 9, borderRadius: '50%', background: tone.dot,
            flex: 'none', marginTop: 5,
          }} />
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--crm-ink)' }}>{out.headline}</div>
            {out.detail && (
              <div style={{ fontSize: 12, color: 'var(--crm-w55)', marginTop: 3, lineHeight: 1.6 }}>
                {out.detail}
              </div>
            )}
            {Number.isFinite(Number(result.tookSeconds)) && (
              <div style={{ fontSize: 11, color: 'var(--crm-w40)', marginTop: 3 }}>
                took {result.tookSeconds}s
                {result.account ? ` · ${result.account}` : result.scope ? ` · ${result.scope}` : ''}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const inp = {
  height: 30, borderRadius: 7, padding: '0 9px', fontSize: 12.5, fontFamily: 'inherit',
  background: 'var(--crm-w06)', border: '1px solid var(--crm-w12)', color: 'var(--crm-ink)',
};

const btn = {
  height: 30, padding: '0 14px', borderRadius: 9, cursor: 'pointer',
  background: 'var(--crm-w06)', border: '1px solid var(--crm-w12)',
  color: 'var(--crm-ink)', fontSize: 12.5, fontWeight: 600, fontFamily: 'inherit',
};
