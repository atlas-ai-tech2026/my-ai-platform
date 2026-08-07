// ─── BulkTab ─────────────────────────────────────────────────────────────────
// CRM bulk user provisioning: upload an Excel/CSV sheet of email addresses
// (parsed client-side with SheetJS — every cell that looks like an email is
// picked up, any column layout works), choose a Voxel plan, restrict the
// model list (or leave "all models"), set an optional account expiry, and
// generate. Passwords are created server-side and shown ONCE — export the
// credentials CSV before leaving the page.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import Field from './FormField';
import { adminApi } from '@/lib/adminApi';
import { CREDIT_PLANS } from '@/lib/creditPricing';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default function BulkTab({ onError }) {
  // Emails (from file or pasted)
  const [emails, setEmails] = useState([]);
  const [fileName, setFileName] = useState('');
  const [pasted, setPasted] = useState('');

  // Options
  const [plan, setPlan] = useState('Basic');
  const [credits, setCredits] = useState('300');
  const [expiresAt, setExpiresAt] = useState('');
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
      // SheetJS loads lazily so the admin chunk stays small until needed.
      const XLSX = await import('xlsx');
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const found = [];
      for (const sheetName of wb.SheetNames) {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: false });
        for (const row of rows) {
          for (const cell of (row || [])) {
            const v = String(cell ?? '').trim().toLowerCase();
            if (EMAIL_RE.test(v)) found.push(v);
          }
        }
      }
      if (!found.length) { toast.error('No email addresses found in that sheet'); return; }
      addEmails(found);
      toast.success(`Found ${found.length} email(s) in ${file.name}`);
    } catch (e) {
      console.error('[bulk] sheet parse failed:', e);
      toast.error('Could not read that file — is it a valid .xlsx / .csv?');
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
  const pastExpiry = !!expiresAt && new Date(expiresAt) <= new Date();

  const generate = useCallback(async () => {
    setTried(true);
    if (!emails.length) { toast.error('Add emails first (upload a sheet or paste)'); return; }
    if (!allModels && picked.size === 0) { toast.error('Pick at least one model, or choose All models'); return; }
    const c = Number(credits);
    if (!Number.isFinite(c) || c < 0) { toast.error('Credits must be a number'); return; }
    // The server refuses a past expiry; catch it here so the admin sees WHICH
    // box is wrong instead of the whole batch failing after submit.
    if (expiresAt && new Date(expiresAt) <= new Date()) {
      toast.error('Expiry must be a future date'); return;
    }
    if (!window.confirm(`Create ${emails.length} account(s) on the ${plan} plan with ${c} credits each${expiresAt ? `, expiring ${expiresAt}` : ''}?`)) return;
    setRunning(true);
    try {
      const r = await adminApi.bulkCreateUsers({
        emails,
        package: plan,
        credits: c,
        expires_at: expiresAt || undefined,
        allowed_models: allModels ? undefined : [...picked],
      });
      setResult(r);
      toast.success(`Created ${r.created} account(s) — download the credentials CSV now (passwords are shown once)`);
    } catch (e) {
      onError?.(e, 'Bulk creation failed');
    } finally {
      setRunning(false);
    }
  }, [emails, allModels, picked, credits, plan, expiresAt, onError]);

  const downloadCsv = useCallback(() => {
    if (!result?.results?.length) return;
    const csv = [
      ['email', 'password', 'status', 'plan', 'credits', 'expires'].join(','),
      ...result.results.map(r => [r.email, r.password || '', r.status, plan, credits, expiresAt || 'never'].join(',')),
    ].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `voxel-bulk-users-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [result, plan, credits, expiresAt]);

  const modelGroups = useMemo(() => catalog
    ? [['Image models', catalog.image || []], ['Video models', catalog.video || []]]
    : [], [catalog]);

  return (
    <div>
      <div style={{ color: 'var(--crm-w40)', fontSize: 13, marginBottom: 16 }}>
        Provision accounts in bulk from a spreadsheet of emails. Each account gets a
        generated password (shown once — export the CSV), the chosen plan&rsquo;s credits,
        an optional model allow-list, and an optional expiry date.
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

      {/* Step 2 — plan, credits, expiry */}
      <div style={{ ...panelStyle, marginTop: 12 }}>
        <div style={panelTitleStyle}>2 · Plan &amp; expiry</div>
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
          {/* The server rejects a past date outright ("Expiry must be a future
              date"), but nothing here checked it — so the whole batch failed
              after submitting, with no indication which box was wrong. */}
          <Field label="Expires" invalid={pastExpiry}
            message="Pick a future date — accounts cannot be created already expired"
            info="The day these accounts stop working. Leave it empty and they never expire. Useful for workshop or trial accounts. It must be a date in the future.">
            <input type="date" value={expiresAt} onChange={e => setExpiresAt(e.target.value)}
              aria-invalid={pastExpiry}
              style={{ ...inputStyle, ...(pastExpiry ? invalidStyle : null) }} />
          </Field>
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
