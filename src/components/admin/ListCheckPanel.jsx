// ─── ListCheckPanel ──────────────────────────────────────────────────────────
// "A customer sent me 84 emails. Which of them already have accounts?"
//
// ☠ WHY THIS EXISTS, IN THE OWNER'S OWN DATA. The SPA 4 credit report listed
// FIFTEEN accounts that received credits twice on the same day, hours apart —
// faai-2011@hotmail.com got 79 credits at 14:18 and another 395 at 22:17.
// Nobody intended it. There was simply no way to look at a list and see which
// half was already known before acting on it.
//
// Bulk CREATES accounts and silently skips anyone who already has one. A promo
// code INVITES and silently refuses anyone it does not recognise. Both answer
// "who is already here?" too late — in a report, after the money has moved.
//
// This answers it first, and hands each group back as a CSV ready for the tool
// that handles it. Read-only: it looks at addresses and reports. It cannot
// create an account, grant a credit, or change anything.
import React, { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';
import { adminApi } from '@/lib/adminApi';
import InfoDot from './InfoDot';

/** Download one group as a CSV, ready to paste into Bulk or a promo code. */
function downloadCsv(name, emails) {
  const blob = new Blob(['email\n' + emails.join('\n') + '\n'], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const money = (n) => Number(n ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 });

export default function ListCheckPanel({ onError }) {
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const fileRef = useRef(null);

  const readFile = useCallback(async (file) => {
    if (!file) return;
    try {
      setText(await file.text());
      setFileName(file.name);
      setResult(null);
    } catch (e) { onError?.(e, 'Could not read that file'); }
  }, [onError]);

  const check = useCallback(async () => {
    const raw = text.trim();
    if (!raw) { toast.error('Paste a list, or upload a file'); return; }
    setBusy(true);
    try {
      const r = await adminApi.checkUserList(raw);
      setResult(r);
    } catch (e) { onError?.(e, 'Could not check the list'); }
    finally { setBusy(false); }
  }, [text, onError]);

  const clear = useCallback(() => {
    setText(''); setFileName(''); setResult(null);
    if (fileRef.current) fileRef.current.value = '';
  }, []);

  const c = result?.counts;
  // The credits the people we already know are holding right now — because the
  // next question after "who is here?" is always "how much do they have?".
  const heldCredits = (result?.accounts || []).reduce((t, a) => t + (Number(a.credits) || 0), 0);

  return (
    <div style={{ ...panelStyle, marginBottom: 16 }}>
      <div style={{ ...panelTitleStyle, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 7 }}>
        Check a list first
        <InfoDot
          label="Check a list first"
          text={'Paste or upload the addresses a customer sent you. This says which already have '
            + 'accounts, which are new, and which cannot be delivered to — before you create '
            + 'anything or move any credits. It changes nothing; it only looks. '
            + 'Each group can then be downloaded as a CSV for the right tool: new addresses to '
            + 'Bulk or a promo code, existing ones to a top-up.'} />
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--crm-w40)', marginBottom: 12, lineHeight: 1.55 }}>
        Nothing is created and no credits move. Addresses are matched the same way sign-in matches
        them, so capital letters and the invisible characters Arabic Excel adds do not make an
        existing customer look new.
      </div>

      <textarea
        value={text}
        onChange={(e) => { setText(e.target.value); setResult(null); }}
        placeholder={'ahmed@company.com\nsara@company.com\n…'}
        aria-label="Addresses to check"
        rows={4}
        style={{
          ...inputStyle, height: 'auto', minHeight: 84, width: '100%', padding: '10px 12px',
          fontFamily: '"JetBrains Mono", monospace', fontSize: 12.5, resize: 'vertical',
        }} />

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
        <button onClick={check} disabled={busy} style={primaryBtnStyle}>
          {busy ? 'Checking…' : 'Check list'}
        </button>
        <label style={{ ...btnStyle, cursor: 'pointer' }}>
          Upload file…
          <input ref={fileRef} type="file" accept=".csv,.txt,text/csv,text/plain"
            onChange={(e) => readFile(e.target.files?.[0])} style={{ display: 'none' }} />
        </label>
        {(text || result) && <button onClick={clear} style={btnStyle}>Clear</button>}
        {fileName && <span style={{ fontSize: 12, color: 'var(--crm-w40)' }}>{fileName}</span>}
      </div>

      {result && (
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* The decision, as a sentence. Four bare numbers make the reader do
              the work; this says what they are looking at. */}
          <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--crm-ink)' }}>
            {result.sentence}
          </div>

          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))' }}>
            <Group
              tone="green"
              title={`${c.existing} already ${c.existing === 1 ? 'has an account' : 'have accounts'}`}
              note={c.existing
                ? `Holding ${money(heldCredits)} credits between them. Top these up — do not create them again.`
                : 'Nobody on this list has an account yet.'}
              emails={result.existing}
              onDownload={() => downloadCsv('existing-accounts.csv', result.existing)} />
            <Group
              tone="blue"
              title={`${c.fresh} ${c.fresh === 1 ? 'is' : 'are'} new`}
              note={c.fresh
                ? 'These need creating — through Bulk, or invited to a promo code.'
                : 'Everyone on this list is already known.'}
              emails={result.fresh}
              onDownload={() => downloadCsv('new-accounts.csv', result.fresh)} />
            <Group
              tone="red"
              title={c.invalid
                ? `${c.invalid} cannot be delivered to`
                : 'Every address is usable'}
              note={c.invalid
                ? 'Check these with the customer before doing anything with the rest.'
                : (c.duplicates ? `${c.duplicates} repeated inside the list, counted once.` : 'Nothing to fix.')}
              emails={result.invalid}
              onDownload={() => downloadCsv('unusable-addresses.csv', result.invalid)} />
          </div>
        </div>
      )}
    </div>
  );
}

const TONE = {
  green: { fg: 'var(--crm-green)', bg: 'var(--crm-green-bg)' },
  blue: { fg: 'var(--crm-blue)', bg: 'var(--crm-blue-bg)' },
  red: { fg: 'var(--crm-red)', bg: 'var(--crm-red-bg)' },
};

function Group({ tone, title, note, emails = [], onDownload }) {
  const t = TONE[tone] || TONE.blue;
  const [open, setOpen] = useState(false);
  // NEVER a silent cap: the header says a number, so a shortened list has to
  // say it is shortened. That rule is in this project because a line once read
  // "11" above a detail listing six, with nothing to say five were hidden.
  const shown = open ? emails : emails.slice(0, 8);
  return (
    <div style={{ border: '1px solid var(--crm-w08)', background: t.bg, borderRadius: 10, padding: '11px 13px' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: t.fg, marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 12, color: 'var(--crm-w50)', lineHeight: 1.5, marginBottom: emails.length ? 9 : 0 }}>
        {note}
      </div>
      {emails.length > 0 && (
        <>
          <div style={{
            fontFamily: '"JetBrains Mono", monospace', fontSize: 11.5, lineHeight: 1.75,
            color: 'var(--crm-w60)', wordBreak: 'break-all', marginBottom: 8,
          }}>
            {shown.join(' · ')}
            {!open && emails.length > shown.length && (
              <> … <button onClick={() => setOpen(true)}
                style={{ background: 'none', border: 'none', color: t.fg, cursor: 'pointer',
                         font: 'inherit', textDecoration: 'underline', padding: 0 }}>
                and {emails.length - shown.length} more
              </button></>
            )}
          </div>
          <button onClick={onDownload} style={{ ...btnStyle, height: 30, fontSize: 12 }}>
            ⬇ CSV — {emails.length}
          </button>
        </>
      )}
    </div>
  );
}

const inputStyle = {
  height: 36, padding: '0 12px', borderRadius: 10,
  background: 'var(--crm-w04)', border: '1px solid var(--crm-w10)',
  color: 'var(--crm-ink)', fontSize: 13, outline: 'none', fontFamily: 'inherit',
};
const btnStyle = {
  height: 34, padding: '0 12px', borderRadius: 10, cursor: 'pointer',
  background: 'var(--crm-w06)', border: '1px solid var(--crm-w12)',
  color: 'var(--crm-ink)', fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
  display: 'inline-flex', alignItems: 'center', gap: 6,
};
const primaryBtnStyle = {
  height: 38, padding: '0 18px', borderRadius: 10, cursor: 'pointer',
  background: '#e0442c', border: 'none', color: '#fff', fontSize: 13, fontWeight: 700,
  fontFamily: 'inherit',
};
const panelStyle = {
  background: 'var(--crm-w03)', border: '1px solid var(--crm-w08)',
  borderRadius: 12, padding: 16,
};
const panelTitleStyle = { fontSize: 13, fontWeight: 600, color: 'var(--crm-w60)', marginBottom: 12 };
