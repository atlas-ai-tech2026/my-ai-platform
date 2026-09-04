// ─── BulkTab ─────────────────────────────────────────────────────────────────
// CRM bulk user provisioning: upload an Excel/CSV sheet of email addresses
// (parsed client-side with SheetJS — every cell that looks like an email is
// picked up, any column layout works), choose a Voxel plan, restrict the
// model list (or leave "all models"), and generate. Passwords are created
// server-side and shown ONCE — export the credentials CSV before leaving the
// page. (2026-08-25: the account-expiry date field is gone — accounts never
// expire; the batch's credits expire 30 days after creation instead.)

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import Field from './FormField';
import { adminApi } from '@/lib/adminApi';
import ListCheckPanel from './ListCheckPanel';
import BulkCreditsPanel from './BulkCreditsPanel';
import { CREDIT_PLANS } from '@/lib/creditPricing';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const MODEL_GROUP_LABELS = {
  image: 'Image models',
  video: 'Video models',
  audio: 'Voice & music',
  editing: 'Editing & motion',
  node: 'Node canvas',
};

/**
 * Pull every email address out of an uploaded sheet.
 *
 * ── WHY THIS IS A FUNCTION AND NOT BURIED IN A COMPONENT ───────────────────
 * This is the only place the platform parses a file somebody else made, which
 * makes it the one path the SheetJS advisories were actually about — prototype
 * pollution and a ReDoS, both while parsing. It was rewritten on 2026-08-21 to
 * use exceljs, and it had no test coverage whatsoever because it lived inside a
 * click handler. Security-relevant parsing that cannot be tested is trusted
 * rather than verified.
 *
 * Legacy .xls is refused. exceljs does not read the 2003 binary format, and
 * carrying an unfixable vulnerability to support it was the worse trade —
 * decided with the owner. Refused with an instruction, never a silent failure.
 */
export async function extractEmails(file, { loadExcelJS = () => import('exceljs') } = {}) {
  const name = String(file?.name || '').toLowerCase();
  if (name.endsWith('.xls')) {
    return { error: 'That is an old .xls file. Open it in Excel and use '
      + 'File → Save As → .xlsx, then upload it again.' };
  }

  const buf = await file.arrayBuffer();
  const found = [];

  if (name.endsWith('.csv') || name.endsWith('.txt')) {
    // A separated-values file needs no library to yield its cells, and not
    // reaching for one removes a parser from the attack surface entirely.
    const text = new TextDecoder().decode(buf);
    for (const line of text.split(/\r?\n/)) {
      for (const cell of line.split(/[,;\t]/)) {
        const v = String(cell ?? '').trim().replace(/^"|"$/g, '').toLowerCase();
        if (EMAIL_RE.test(v)) found.push(v);
      }
    }
    return { found };
  }

  const ExcelJS = (await loadExcelJS()).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  wb.eachSheet((ws) => {
    ws.eachRow((row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        // A cell may be a string, a number, a formula result, or a HYPERLINK
        // object — which is what Excel turns a pasted email into. Reading only
        // .value would miss exactly the case that happens most.
        const raw = cell.text ?? cell.value ?? '';
        const v = String(typeof raw === 'object' && raw !== null
          ? (raw.text || raw.result || raw.hyperlink || '') : raw)
          .trim().replace(/^mailto:/, '').toLowerCase();
        if (EMAIL_RE.test(v)) found.push(v);
      });
    });
  });
  return { found };
}

export default function BulkTab({ onError }) {
  // Emails (from file or pasted)
  const [emails, setEmails] = useState([]);
  const [fileName, setFileName] = useState('');
  const [pasted, setPasted] = useState('');

  // Options
  const [plan, setPlan] = useState('Basic');
  const [credits, setCredits] = useState('300');
  const [accessDays, setAccessDays] = useState('');
  const [batchReason, setBatchReason] = useState('');
  const [allModels, setAllModels] = useState(true);
  const [catalog, setCatalog] = useState(null); // { image: [], video: [] }
  const [picked, setPicked] = useState(new Set());

  // Run state
  const [running, setRunning] = useState(false);
  // Required boxes go red only after a generate attempt.
  const [tried, setTried] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    adminApi.listModels().then(setCatalog).catch(e => onError?.(e, 'Model list failed'));
  }, [onError]);

  // Keep the credits field in sync when a plan is picked (still editable).
  const pickPlan = (name) => {
    setPlan(name);
    const p = CREDIT_PLANS.find(x => x.name === name);
    if (p) setCredits(String(p.creditsPerMonth));
  };

  const addEmails = useCallback((list) => {
    setEmails(prev => {
      const seen = new Set(prev);
      const merged = [...prev];
      for (const e of list) {
        const email = String(e || '').trim().toLowerCase();
        if (email && !seen.has(email)) { seen.add(email); merged.push(email); }
      }
      return merged;
    });
  }, []);

  const onFile = useCallback(async (file) => {
    if (!file) return;
    setFileName(file.name);
    try {
      const { found, error } = await extractEmails(file);
      if (error) { toast.error(error); setFileName(''); return; }
      if (!found.length) { toast.error('No email addresses found in that sheet'); return; }
      addEmails(found);
      toast.success(`Found ${found.length} email(s) in ${file.name}`);
    } catch (e) {
      // A sheet that will not open is a finding, not a crash — and the reason
      // is shown, because "could not read that file" sends someone hunting.
      console.error('[bulk] could not read the sheet:', e);
      toast.error(`Could not read that file — ${e.message}`);
      setFileName('');
    }
  }, [addEmails]);

  const addPasted = () => {
    const list = pasted.split(/[\s,;]+/).filter(Boolean);
    const valid = list.filter(e => EMAIL_RE.test(e.trim().toLowerCase()));
    if (!valid.length) { toast.error('No valid emails in the pasted text'); return; }
    addEmails(valid);
    setPasted('');
    toast.success(`Added ${valid.length} email(s)`);
  };

  const togglePicked = (m) => {
    setPicked(prev => {
      const next = new Set(prev);
      next.has(m) ? next.delete(m) : next.add(m);
      return next;
    });
  };

  const missCredits = tried && !(Number(credits) >= 0);

  const generate = useCallback(async () => {
    setTried(true);
    if (!emails.length) { toast.error('Add emails first (upload a sheet or paste)'); return; }
    if (!allModels && picked.size === 0) { toast.error('Pick at least one model, or choose All models'); return; }
    const c = Number(credits);
    if (!Number.isFinite(c) || c < 0) { toast.error('Credits must be a number'); return; }
    if (!window.confirm(
      `Create ${emails.length} account(s) on the ${plan} plan with ${c} credits each?`
      + (c > 0 ? `\nTheir credits live for ${accessDays || 30} days.` : '')
      + (batchReason.trim() ? `\nRecorded as: ${batchReason.trim()}` : '\nNo reason given — these credits will not be traceable to a workshop.')
    )) return;
    setRunning(true);
    try {
      const r = await adminApi.bulkCreateUsers({
        reason: batchReason.trim() || undefined,
        access_days: accessDays || undefined,
        emails,
        package: plan,
        credits: c,
        allowed_models: allModels ? undefined : [...picked],
      });
      setResult(r);
      toast.success(`Created ${r.created} account(s) — download the credentials CSV now (passwords are shown once)`);
    } catch (e) {
      onError?.(e, 'Bulk creation failed');
    } finally {
      setRunning(false);
    }
  }, [emails, allModels, picked, credits, plan, onError]);

  const downloadCsv = useCallback(() => {
    if (!result?.results?.length) return;
    const csv = [
      ['email', 'password', 'status', 'plan', 'credits', 'expires'].join(','),
      ...result.results.map(r => [r.email, r.password || '', r.status, plan, credits].join(',')),
    ].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `voxel-bulk-users-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [result, plan, credits]);

  // N5: derived from whatever the server offers, not a hardcoded pair. The
  // server now gates voice, music, editing, motion control and node models
  // too, so all of them must be grantable here — a category the server
  // enforces but this screen cannot grant would silently lock users out.
  const modelGroups = useMemo(() => (catalog
    ? Object.entries(catalog)
        .filter(([, models]) => Array.isArray(models) && models.length)
        .map(([key, models]) => [MODEL_GROUP_LABELS[key] || key, models])
    : []), [catalog]);

  return (
    <div>
      <div style={{ color: 'var(--crm-w40)', fontSize: 13, marginBottom: 16 }}>
        Provision accounts in bulk from a spreadsheet of emails. Each account gets a
        generated password (shown once — export the CSV), the chosen plan&rsquo;s credits,
        an optional model allow-list, and an optional expiry date.
      </div>

      {/* Before anything else: which of these people do we already have?
          Bulk skips existing accounts, so a list that is half returning
          customers half-works — and reads as success. Answering first is
          cheaper than explaining afterwards. */}
      <ListCheckPanel onError={onError} />

      {/* ☠ TWO MODES, NAMED — never one button that guesses.
          Creating an account and topping one up are different things done to
          different people. A single control that "creates if missing, tops up
          if present" leaves you unable to say afterwards which happened to
          whom, which is the confusion these screens exist to end. */}
      <BulkCreditsPanel onError={onError} />

      <div style={{ margin: '18px 0 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, height: 1, background: 'var(--crm-w08)' }} />
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.1em',
                       textTransform: 'uppercase', color: 'var(--crm-w40)' }}>
          or create new accounts
        </span>
        <div style={{ flex: 1, height: 1, background: 'var(--crm-w08)' }} />
      </div>

      {/* ── WHAT THIS SCREEN DOES NOT DO ──────────────────────────────────
          The owner nearly topped up an existing customer through here on
          2026-08-20 and asked first. Bulk checks whether an email exists and
          SKIPS it before reaching the credit code, so a returning attendee
          receives nothing while everyone new in the same list gets their
          credits. The batch half-works, which is the dangerous kind: it reads
          as success. Said before the button, not only in the results. */}
      <div style={{
        border: '1px solid var(--crm-amber-br)', background: 'var(--crm-amber-bg)',
        borderRadius: 10, padding: '10px 14px', marginBottom: 14,
        fontSize: 12.5, lineHeight: 1.55, color: 'var(--crm-ink)',
      }}>
        <b>Creates NEW accounts only.</b> An email that already has an account is
        skipped and receives <b>no credits</b> — it is listed as “already existed”
        in the results. To top up someone who already has an account, use{' '}
        <b>Users → grant</b>, which adds to their balance instead of replacing it.
      </div>

      {/* Step 1 — emails */}
      <div style={panelStyle}>
        <div style={panelTitleStyle}>1 · Emails ({emails.length})</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <label style={{ ...btnStyle, cursor: 'pointer' }}>
            📄 Upload .xlsx / .csv
            <input type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }}
              onChange={e => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          {fileName && <span style={{ fontSize: 12, color: 'var(--crm-w45)' }}>{fileName}</span>}
          <input placeholder="…or paste emails here" value={pasted}
            onChange={e => setPasted(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addPasted()}
            style={{ ...inputStyle, minWidth: 240 }} />
          <button onClick={addPasted} style={btnStyle}>+ Add</button>
          {emails.length > 0 && <button onClick={() => { setEmails([]); setFileName(''); setResult(null); }} style={btnStyle}>Clear</button>}
        </div>
        {emails.length > 0 && (
          <div style={{ marginTop: 10, maxHeight: 120, overflowY: 'auto', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {emails.map(e => (
              <span key={e} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 999, background: 'var(--crm-w06)', color: 'var(--crm-w70)' }}>{e}</span>
            ))}
          </div>
        )}
      </div>

      {/* Step 2 — plan and credits */}
      <div style={{ ...panelStyle, marginTop: 12 }}>
        <div style={panelTitleStyle}>2 · Plan &amp; credits</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={plan} onChange={e => pickPlan(e.target.value)} style={inputStyle}>
            {CREDIT_PLANS.map(p => (
              <option key={p.id} value={p.name}>{p.name} — ${p.pricePerMonth}/mo · {p.creditsPerMonth} cr</option>
            ))}
            <option value="Free">Free — 0 cr</option>
          </select>
          <Field label="Credits each" required invalid={missCredits}
            message="Enter a number — 0 or more"
            info="How many credits every account in this batch starts with. The same number goes to all of them. Enter 0 to create accounts with no credits.">
            <input type="number" min="0" value={credits} onChange={e => setCredits(e.target.value)}
              aria-required="true" aria-invalid={missCredits}
              style={{ ...inputStyle, width: 110, ...(missCredits ? invalidStyle : null) }} />
          </Field>
          {/* 2026-08-25: the "Expires" date box is gone on purpose. Accounts
              never expire any more. What follows is the CREDIT life, which is
              a different thing and does something. */}
          <Field label="Access days"
            info="How many days these credits live before the unspent remainder expires. Blank means the standard 30, exactly as a promo code's Access days. Some workshops run longer than a month — this is where you say so. Accounts themselves never expire.">
            <input type="number" min="1" max="3650" value={accessDays}
              onChange={e => setAccessDays(e.target.value)}
              placeholder="Blank = 30 days"
              style={{ ...inputStyle, width: 150 }} />
          </Field>
        </div>

        {/* ☠ WHAT THIS BATCH WAS FOR — the link that did not exist.
            The ledger used to say only "bulk provision: Basic plan": the plan,
            never the WORKSHOP. So an account created here carried nothing
            tying it to the customer who paid, and Workshops & P&L — which
            joins a workshop to its people by promo code — could not see these
            people at all. Half a cohort could vanish from a profit number
            with nothing to say so. */}
        <div style={{ marginTop: 12 }}>
          <Field label="What is this batch for?"
            info="Written into every credit entry this batch creates, so months later the record says which workshop or customer it was. It is what Logs, the credit report and any invoice read back — find the batch under SYSTEM \u2192 Logs with Status \u201cgrant\u201d and this text in the details filter. (NOT Manual Credits: that screen shows only credits typed one at a time on the Users tab, and a bulk batch is deliberately not one of those.) Optional — but a batch with no reason cannot be traced to anybody.">
            <input value={batchReason} onChange={e => setBatchReason(e.target.value)}
              placeholder="e.g. SPA News Academy 5th"
              style={{ ...inputStyle, width: '100%', maxWidth: 420 }} />
          </Field>
          {!batchReason.trim() && Number(credits) > 0 && (
            <div style={{ fontSize: 11.5, color: 'var(--crm-amber)', marginTop: 5 }}>
              Without this, these credits will say only &ldquo;{plan} plan&rdquo; — with nothing to
              tie them to a workshop or an invoice.
            </div>
          )}
        </div>
      </div>

      {/* Step 3 — model access */}
      <div style={{ ...panelStyle, marginTop: 12 }}>
        <div style={panelTitleStyle}>3 · Model access</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--crm-ink)', cursor: 'pointer' }}>
          <input type="checkbox" checked={allModels} onChange={e => setAllModels(e.target.checked)} />
          All models (no restriction)
        </label>
        {!allModels && (catalog ? modelGroups.map(([label, models]) => (
          <div key={label} style={{ marginTop: 10 }}>
            <div style={{ fontSize: 11, color: 'var(--crm-w40)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {models.map(m => (
                <button key={m} onClick={() => togglePicked(m)}
                  style={{
                    ...btnStyle, height: 28, fontSize: 12,
                    background: picked.has(m) ? '#e0442c' : 'var(--crm-w06)',
                    border: picked.has(m) ? '1px solid #e0442c' : '1px solid var(--crm-w12)',
                  }}>
                  {m}
                </button>
              ))}
            </div>
          </div>
        )) : <div style={{ fontSize: 12, color: 'var(--crm-w35)', marginTop: 8 }}>Loading model list…</div>)}
        {!allModels && picked.size > 0 && (
          <div style={{ fontSize: 12, color: 'var(--crm-w45)', marginTop: 8 }}>{picked.size} model(s) selected</div>
        )}
      </div>

      {/* Generate */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 14 }}>
        <button onClick={generate} disabled={running || !emails.length} style={{ ...primaryBtnStyle, opacity: running || !emails.length ? 0.6 : 1 }}>
          {running ? 'Creating…' : `🚀 Generate ${emails.length || ''} account(s)`}
        </button>
        {result && <button onClick={downloadCsv} style={btnStyle}>⬇ Download credentials CSV</button>}
      </div>

      {/* Results */}
      {result && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 13, color: 'var(--crm-w60)', marginBottom: 8 }}>
            <b style={{ color: 'var(--crm-green)' }}>{result.created} created</b>
            {result.skipped_existing > 0 && <> · <span style={{ color: 'var(--crm-amber)' }}>{result.skipped_existing} already existed</span></>}
            {result.invalid?.length > 0 && <> · <span style={{ color: 'var(--crm-red)' }}>{result.invalid.length} invalid</span></>}
            &nbsp;— passwords are shown ONCE, export the CSV now.
          </div>
          <div style={{ overflowX: 'auto', border: '1px solid var(--crm-w08)', borderRadius: 12, maxHeight: 320, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>{['Email', 'Password', 'Status'].map(h => <th key={h} style={thStyle}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {result.results.map(r => (
                  <tr key={r.email} style={{ borderTop: '1px solid var(--crm-w06)' }}>
                    <td style={tdStyle}>{r.email}</td>
                    <td style={{ ...tdStyle, fontFamily: '"JetBrains Mono", monospace' }}>{r.password || '—'}</td>
                    <td style={tdStyle}>
                      <span style={{
                        padding: '2px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600,
                        color: r.status === 'created' ? 'var(--crm-green)' : r.status === 'exists' ? 'var(--crm-amber)' : 'var(--crm-red)',
                        background: r.status === 'created' ? 'var(--crm-green-bg)' : r.status === 'exists' ? 'var(--crm-amber-bg)' : 'var(--crm-red-bg)',
                      }}>{r.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

const invalidStyle = { border: '1px solid var(--crm-red)', background: 'var(--crm-red-bg)' };
const inputStyle = {
  height: 36, padding: '0 12px', borderRadius: 10,
  background: 'var(--crm-w04)', border: '1px solid var(--crm-w10)',
  color: 'var(--crm-ink)', fontSize: 13, outline: 'none', fontFamily: 'inherit', colorScheme: 'dark',
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
const thStyle = {
  textAlign: 'left', padding: '10px 14px', fontSize: 12, fontWeight: 600,
  color: 'var(--crm-w45)', background: 'var(--crm-w03)', whiteSpace: 'nowrap',
  position: 'sticky', top: 0,
};
const tdStyle = { padding: '8px 14px', color: 'var(--crm-w85)', whiteSpace: 'nowrap' };
