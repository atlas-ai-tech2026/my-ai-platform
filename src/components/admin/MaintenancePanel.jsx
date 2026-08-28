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
const JOBS = [
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
      + 'full-size file. Run it per account — and re-run it as new pictures are made, because '
      + 'nothing creates these automatically yet.',
    writes: 'WRITES to customer history — adds a thumb_url. The original is never touched, moved '
      + 'or deleted, and opening a picture still shows it at full size.',
    info: 'The grid was downloading twelve full-size files at 7.5 MB each. This makes a small copy '
      + 'for the grid only. It ADDS a field; nothing existing is modified, so the worst case for a '
      + 'row that fails is that it stays exactly as slow as it is today. NOTE: a picture generated '
      + 'today does NOT get one on its own — only this button creates them, so the grid gets slower '
      + 'again as new work is made. Making it automatic is still to be built.',
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
];

export default function MaintenancePanel({ onError }) {
  const [busy, setBusy] = useState(null);
  const [scale, setScale] = useState(null);
  const [results, setResults] = useState({});
  const [form, setForm] = useState({ email: '', limit: 20, all: false });

  async function run(job) {
    if (job.scoped && !form.all && !form.email.trim()) {
      toast.error('Put an account email in first.');
      return;
    }
    setBusy(job.id);
    try {
      const body = await job.run({ ...form, email: form.email.trim(), limit: Number(form.limit) || 20 });
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
          result={results[job.id]} onRun={() => run(job)} />
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
            + 'estimate the data a catch-up would move. It writes NOTHING — it is the number you read '
            + 'before deciding, not a job. If the data cost cannot be measured it says "unknown", '
            + 'never zero.'}
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
            {/* The number that answers "do I have to press this myself?" */}
            <strong style={{ color: 'var(--crm-amber)' }}>
              {scale.presses_by_hand.toLocaleString()} presses by hand
            </strong>
            {' · '}about {scale.estimated_hours}h of work
            {' · '}{scale.days_at_slow_pace} days at a deliberately slow pace
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

function Card({ job, busy, anyBusy, result, onRun }) {
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
        <button
          onClick={onRun} disabled={anyBusy} aria-label={`${out?.again ? 'Run again' : 'Run'}: ${job.title}`}
          style={{ ...btn, marginLeft: 'auto' }}
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
