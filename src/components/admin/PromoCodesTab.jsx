// ─── PromoCodesTab ───────────────────────────────────────────────────────────
// CRM promo-code generation: create reusable marketing codes (credits per
// redemption, optional global cap + expiry, one redemption per user), list
// them with live redemption counts, and toggle them on/off. Users redeem in
// their account's Promocode section via POST /api/redeem-code.
//
// 2026-08-06 additions, all admin-side only — the redemption path a customer
// uses is untouched:
//   1. DESCRIPTION on each code, so months later you can still tell who it was
//      for. Editable after creation.
//   2. EDIT the expiry after creation. Extending a lapsed code revives it
//      immediately, because redemption checks the expiry at redeem time.
//   3. SEARCH across description, code and creator.
//   4. WHO REDEEMED IT — the accounts behind the count, which the database has
//      always recorded but nothing ever displayed.
//
// Credits and the code text stay LOCKED on purpose: the granted amount is
// already written into credits_history, and printed codes are in the wild.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import Field, { FieldRow, buttonRowOffset } from './FormField';
import { adminApi } from '@/lib/adminApi';
import PromoTopUpPanel from './PromoTopUpPanel';

/** Active / expired / used up — more useful than active-or-not now that
 *  expiry dates are something the admin manages. */
function promoStatus(p) {
  if (!p.active) return { label: 'off', color: 'var(--crm-red)', bg: 'var(--crm-red-bg)' };
  if (p.expires_at && new Date(p.expires_at) <= new Date()) {
    return { label: 'expired', color: 'var(--crm-amber)', bg: 'var(--crm-amber-bg)' };
  }
  if (p.max_redemptions != null && p.redeemed_count >= p.max_redemptions) {
    return { label: 'used up', color: 'var(--crm-amber)', bg: 'var(--crm-amber-bg)' };
  }
  return { label: 'active', color: 'var(--crm-green)', bg: 'var(--crm-green-bg)' };
}

/** yyyy-mm-dd for <input type="date">, in LOCAL time. Using toISOString here
 *  would shift the date by a day for anyone east or west of UTC. */
function toDateInput(value) {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d)) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Headline numbers for the promo dashboard.
 *
 * "Credits outstanding" is the honest one to get right: it is what you could
 * still be liable for, i.e. for each usable code, (cap - already redeemed) ×
 * credits. Codes with NO cap are unbounded — they are counted separately
 * rather than silently treated as zero, which would understate the exposure.
 */
function promoTotals(promos) {
  const t = {
    total: 0, active: 0, inactive: 0, usable: 0,
    expired: 0, usedUp: 0,
    creditsOutstanding: 0, uncappedCodes: 0, redemptions: 0,
    creditsGranted: 0,
  };
  const now = new Date();
  for (const p of promos || []) {
    t.total += 1;
    const credits = Number(p.credits) || 0;
    const used = Number(p.redeemed_count) || 0;
    t.redemptions += used;
    t.creditsGranted += used * credits;

    if (!p.active) { t.inactive += 1; continue; }
    t.active += 1;

    const expired = p.expires_at && new Date(p.expires_at) <= now;
    const cappedOut = p.max_redemptions != null && used >= p.max_redemptions;
    if (expired) t.expired += 1;
    if (cappedOut) t.usedUp += 1;
    if (expired || cappedOut) continue;

    // Genuinely redeemable right now.
    t.usable += 1;
    if (p.max_redemptions == null) t.uncappedCodes += 1;
    else t.creditsOutstanding += Math.max(0, p.max_redemptions - used) * credits;
  }
  return t;
}

const fmt = (n) => Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });

export default function PromoCodesTab({ onError }) {
  const [promos, setPromos] = useState(null);
  const [creating, setCreating] = useState(false);
  // Required boxes go red only after a create attempt, not while typing.
  const [tried, setTried] = useState(false);
  const [query, setQuery] = useState('');

  // Create form
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [credits, setCredits] = useState('');
  const [maxRedemptions, setMaxRedemptions] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [accessDays, setAccessDays] = useState('');
  // WHO the code is for. Blank = open to anyone holding the code, which is how
  // every code issued before 2026-08-20 behaves and must keep behaving.
  const [inviteText, setInviteText] = useState('');
  const [inviteFileName, setInviteFileName] = useState('');

  // Per-row edit + expanded redemption list
  const [editingId, setEditingId] = useState(null);
  const [editDescription, setEditDescription] = useState('');
  const [editExpiresAt, setEditExpiresAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [redemptions, setRedemptions] = useState({}); // promo id → rows
  const [invites, setInvites] = useState({});         // promo id → invited/waiting
  // Adding one person to a list that already exists — see addInvites below.
  const [addTo, setAddTo] = useState(null);           // promo id the box is open on
  const [addText, setAddText] = useState('');
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await adminApi.listPromos();
      setPromos(r.promos);
    } catch (e) { onError?.(e, 'Promo list failed'); }
  }, [onError]);

  useEffect(() => { load(); }, [load]);

  const missCredits = tried && !(Number(credits) > 0);

  // Split on anything a spreadsheet or a mail client is likely to produce:
  // newlines, commas, semicolons, tabs. Validation itself happens on the
  // server, where normalizeBulkEmails is the single definition of a good
  // address — a second, slightly different rule in the browser is how the two
  // drift apart and start disagreeing about the same list.
  const invitedEmails = useMemo(
    () => inviteText.split(/[\s,;]+/).map((e) => e.trim()).filter(Boolean),
    [inviteText]);

  // A .csv or .txt is read here; a real .xlsx is not. Deliberately: parsing
  // spreadsheets in the browser means shipping a library with its own
  // advisories, and "Save As → CSV" is one step. Says so on the screen rather
  // than silently accepting a file it cannot read.
  const readInviteFile = useCallback(async (file) => {
    if (!file) return;
    const text = await file.text();
    setInviteText(text);
    setInviteFileName(file.name);
  }, []);

  const create = useCallback(async () => {
    setTried(true);
    const c = Number(credits);
    if (!Number.isFinite(c) || c <= 0) { toast.error('Enter the credits each redemption grants'); return; }
    setCreating(true);
    try {
      const r = await adminApi.createPromo({
        code: code.trim() || undefined,           // blank = auto-generate VOXEL-XXXX-XXXX
        description: description.trim() || undefined,
        credits: c,
        max_redemptions: maxRedemptions.trim() || undefined,
        access_days: accessDays.trim() || undefined,
        expires_at: expiresAt || undefined,
        emails: invitedEmails.length ? invitedEmails : undefined,
      });
      toast.success(r.invited
        ? `Promo created: ${r.promo.code} — locked to ${r.invited} email${r.invited === 1 ? '' : 's'}, ${r.promo.credits} credits each`
        : `Promo created: ${r.promo.code} (+${r.promo.credits} credits per redemption)`);
      if (r.invalid?.length) {
        toast.error(`${r.invalid.length} address(es) were not valid and were left out: ${r.invalid.slice(0, 3).join(', ')}`);
      }
      // ☠ THE FORM IS FRESH AGAIN, SO THE VALIDATION MUST BE TOO.
      // `tried` gates the red highlighting: do not shout at someone who has
      // not submitted yet. Clearing the boxes without clearing `tried` made
      // "Credits per redemption" go red the instant a code was CREATED
      // SUCCESSFULLY — reported by Amr on 2026-09-03, who reasonably asked
      // whether something had gone wrong. Nothing had. The screen said it had.
      setTried(false);
      setCode(''); setDescription(''); setCredits(''); setMaxRedemptions(''); setExpiresAt('');
      // ☠ AND access_days, which was never cleared. It is not cosmetic: it sets
      // how long the credits a code grants stay alive. A 90-day workshop code
      // followed by an unrelated code silently gave the second one 90 days too,
      // and the only place it showed was a column reading "90" instead of
      // "30 (standard)" on a code nobody was looking at.
      setAccessDays('');
      setInviteText(''); setInviteFileName('');
      load();
    } catch (e) { onError?.(e, 'Promo creation failed'); }
    finally { setCreating(false); }
  }, [code, description, credits, maxRedemptions, expiresAt, accessDays, invitedEmails, load, onError]);

  const toggle = useCallback(async (p) => {
    try {
      await adminApi.togglePromo(p.id);
      toast.success(`${p.code} ${p.active ? 'deactivated' : 'activated'}`);
      load();
    } catch (e) { onError?.(e, 'Toggle failed'); }
  }, [load, onError]);

  const startEdit = useCallback((p) => {
    setEditingId(p.id);
    setEditDescription(p.description || '');
    setEditExpiresAt(toDateInput(p.expires_at));
  }, []);

  const saveEdit = useCallback(async (p) => {
    setSaving(true);
    try {
      // Send expires_at as null (not undefined) when cleared, so the server
      // knows the difference between "leave it alone" and "never expires".
      await adminApi.updatePromo(p.id, {
        description: editDescription.trim(),
        expires_at: editExpiresAt ? editExpiresAt : null,
      });
      const wasExpired = p.expires_at && new Date(p.expires_at) <= new Date();
      const nowLater = !editExpiresAt || new Date(editExpiresAt) > new Date();
      toast.success(wasExpired && nowLater
        ? `${p.code} updated — it works again for users`
        : `${p.code} updated`);
      setEditingId(null);
      load();
    } catch (e) { onError?.(e, 'Update failed'); }
    finally { setSaving(false); }
  }, [editDescription, editExpiresAt, load, onError]);

  const toggleRedemptions = useCallback(async (p) => {
    if (expandedId === p.id) { setExpandedId(null); return; }
    setExpandedId(p.id);
    if (redemptions[p.id]) return;                 // already fetched
    try {
      const r = await adminApi.promoRedemptions(p.id);
      setRedemptions(prev => ({ ...prev, [p.id]: r.redemptions }));
    } catch (e) { onError?.(e, 'Could not load redemptions'); }
    // Fetched alongside, because the useful question before a workshop is not
    // "who redeemed" but "who HASN'T yet" — and only the invitation list can
    // answer that. An open code simply returns nothing and renders nothing.
    try {
      const inv = await adminApi.promoInvites(p.id);
      setInvites(prev => ({ ...prev, [p.id]: inv }));
    } catch (e) {
      // ☠ A SWALLOWED ERROR LOOKED EXACTLY LIKE AN OPEN CODE.
      // This used to be `catch {}` with the note "an open code has no list;
      // not a failure worth a toast". But an open code and a failed request
      // render identically — nothing — so a broken endpoint would have read as
      // "this code has no invitation list", and the owner would have believed
      // it. That is the silent-failure class this project keeps finding.
      // Recorded so the drawer can say which of the two it is.
      setInvites(prev => ({ ...prev, [p.id]: { failed: e?.message || 'could not be read' } }));
    }
  }, [expandedId, redemptions, onError]);

  /**
   * Add somebody to a list that already exists.
   *
   * ── WHY THERE WAS NO SUCH THING ────────────────────────────────────────
   * On 2026-09-02 one attendee of 84 could not redeem, and the only answers
   * available were "issue a whole second code" or "grant the credits by hand".
   * Amr issued a second code, and wrote himself a note not to forget it. A
   * week later the code's own screen shows nothing about any of it.
   *
   * The list is reloaded from the server rather than patched here, so what
   * appears is what was actually stored — including the address in the form
   * the server normalised it to, which is the whole point after today.
   */
  const addInvites = useCallback(async (p) => {
    const text = addText.trim();
    if (!text) { toast.error('Enter an email address'); return; }
    setAdding(true);
    try {
      const r = await adminApi.promoInvitesAdd(p.id, text);
      const parts = [];
      if (r.added) parts.push(`${r.added} added to ${p.code}`);
      if (r.duplicate?.length) parts.push(`${r.duplicate.length} already on the list`);
      if (r.invalid?.length) parts.push(`${r.invalid.length} not a usable address`);
      (r.added ? toast.success : toast.error)(parts.join(' · ') || 'Nothing to add');
      // Said separately and left on screen: a cap the owner set by hand is now
      // smaller than the list it guards, and the person just added WILL be
      // refused. A success toast that scrolls away is not good enough for that.
      if (r.capWarning) toast.warning(r.capWarning, { duration: 15000 });
      setAddText('');
      const inv = await adminApi.promoInvites(p.id);
      setInvites(prev => ({ ...prev, [p.id]: inv }));
      load();                                   // the redemption cap may have moved
    } catch (e) { onError?.(e, 'Could not add to the list'); }
    finally { setAdding(false); }
  }, [addText, load, onError]);

  /**
   * One Excel file PER CODE: the users who redeemed this promo, with their
   * registration date and account details. SheetJS is lazy-imported exactly
   * like the Bulk tab does, so the admin bundle stays small until the first
   * export — and it is a real .xlsx, not a CSV renamed.
   */
  const exportRedemptionsXlsx = useCallback(async (p) => {
    const rows = redemptions[p.id];
    if (!rows?.length) { toast.error('Nothing to export — nobody has redeemed this code'); return; }
    try {
      // exceljs, not SheetJS. SheetJS carries two unfixable HIGH advisories —
      // prototype pollution and a ReDoS — with no upstream fix and none coming.
      // Both are PARSING bugs, so this write path was never the exposure; it is
      // ported anyway so the dependency can be removed entirely rather than
      // kept alive by one caller.
      const ExcelJS = (await import('exceljs')).default;
      const fmt = (v) => v ? new Date(v).toISOString().slice(0, 10) : '';
      const sheetRows = rows.map(r => ({
        'Email':            r.email,
        'Name':             r.display_name || '',
        'Plan':             r.package || 'Free',
        'Registered':       fmt(r.registered_at),
        'Redeemed':         fmt(r.redeemed_at || r.created_at),
        // Redemption and credit-expiry next to each other, so "redeemed on X,
        // credits end Y" reads off a single row. Blank for redemptions made
        // before the 30-day rule existed — blank is honest, a guess is not.
        'Credits end':      fmt(r.credits_end_at) || '',
        'Days left':        r.credits_end_at
                              ? Math.ceil((new Date(r.credits_end_at) - new Date()) / 86400000)
                              : '',
        // What THIS code gave this person. The number on the code itself.
        'Credits from this code': Number(p.credits),
        // Every promo code of yours this person has redeemed, added up.
        'Credits from all promo codes': r.promo_credits_all == null ? '' : Number(r.promo_credits_all),
        'Promo codes redeemed': r.promo_codes_count == null ? '' : Number(r.promo_codes_count),
        // The whole wallet — grants, gifts, refunds, minus everything spent.
        // Named in full so it can never again be read as "left from this code":
        // credits merge on arrival, so per-code remaining is not recoverable.
        'Wallet balance (all sources)': r.current_credits == null ? '' : Number(r.current_credits),
        'Last login':       fmt(r.last_login_at),
        'Account status':   r.banned ? 'banned' : 'active',
      }));
      const wb = new ExcelJS.Workbook();
      // Sheet names are capped at 31 chars and reject some symbols — same rule
      // as before, it is Excel's limit rather than a library's.
      const ws = wb.addWorksheet(String(p.code).replace(/[\\/?*\[\]:]/g, '-').slice(0, 31));

      // Readable column widths — a sheet where every email is clipped is noise.
      const headers = Object.keys(sheetRows[0]);
      const widths = [32, 18, 10, 12, 12, 13, 10, 20, 24, 19, 24, 12, 13];
      ws.columns = headers.map((h, i) => ({ header: h, key: h, width: widths[i] || 16 }));
      ws.addRows(sheetRows);
      ws.getRow(1).font = { bold: true };

      // exceljs has no writeFile in a browser — it produces the bytes and the
      // page hands them to the user. Same result, one more step.
      const buffer = await wb.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `voxel-promo-${p.code}-users-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoked, or the whole file stays in memory until the tab closes.
      URL.revokeObjectURL(url);
      toast.success(`Exported ${rows.length} user${rows.length === 1 ? '' : 's'} for ${p.code}`
        + (rows.length === 1000 ? ' (first 1,000 — the list is capped)' : ''));
    } catch (e) {
      console.error('[promo] xlsx export failed:', e);
      toast.error('Could not build the Excel file');
    }
  }, [redemptions]);

  const copy = (text) => {
    navigator.clipboard?.writeText(text).then(
      () => toast.success(`Copied ${text}`),
      () => toast.error('Copy failed')
    );
  };

  // Search description, code AND creator — you rarely remember which one you
  // know. Filtering client-side keeps it instant; the list is capped at 500.
  const visible = useMemo(() => {
    if (!promos) return promos;
    const q = query.trim().toLowerCase();
    if (!q) return promos;
    return promos.filter(p =>
      (p.description || '').toLowerCase().includes(q) ||
      (p.code || '').toLowerCase().includes(q) ||
      (p.created_by || '').toLowerCase().includes(q)
    );
  }, [promos, query]);

  // Always over ALL codes, never the filtered view — a dashboard that changed
  // as you typed a search would be misleading.
  const totals = useMemo(() => promoTotals(promos), [promos]);

  const COLS = 9;   // +1 for Access days

  return (
    <div>
      <div style={{ color: 'var(--crm-w40)', fontSize: 13, marginBottom: 16 }}>
        Reusable marketing codes. Each user can redeem a code once; the optional
        “max redemptions” caps total uses across all users. Users enter codes in
        their account’s Promocode section.
      </div>

      {/* Dashboard */}
      <div style={{
        display: 'grid', gap: 10, marginBottom: 16,
        gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
      }}>
        <Stat label="Promo codes created" value={promos ? fmt(totals.total) : '—'}
          note={promos ? `${fmt(totals.redemptions)} redemptions so far` : ''} />
        <Stat label="Active" value={promos ? fmt(totals.active) : '—'}
          note={promos ? `${fmt(totals.inactive)} deactivated` : ''} color="var(--crm-green)" />
        <Stat label="Usable right now" value={promos ? fmt(totals.usable) : '—'}
          note={promos
            ? [totals.expired ? `${totals.expired} expired` : null,
               totals.usedUp ? `${totals.usedUp} used up` : null]
              .filter(Boolean).join(' · ') || 'none expired or used up'
            : ''}
          color="var(--crm-blue)" />
        <Stat label="Credits outstanding" value={promos ? fmt(totals.creditsOutstanding) : '—'}
          note={promos
            ? (totals.uncappedCodes
                ? `+ ${totals.uncappedCodes} code${totals.uncappedCodes === 1 ? '' : 's'} with no limit`
                : 'across usable codes')
            : ''}
          color="var(--crm-amber)" />
      </div>

      {/* Create form */}
      <div style={panelStyle}>
        <div style={panelTitleStyle}>Create promo code</div>
        {/* Every box carries a permanent label, an ⓘ explaining what goes in
            it, and a red * when it is required. Before this the form was
            placeholder-only — and a placeholder vanishes the moment you type,
            so there was nothing left to tell you what a box was for. */}
        <FieldRow>
          <Field label="Description"
            info="A private note for you — who this code is for, or why you made it. Customers never see it. It is what you will search on later, so “Ramadan campaign — Instagram” beats “promo 3”.">
            <input placeholder="Who is this for?" value={description}
              onChange={e => setDescription(e.target.value)} style={{ ...inputStyle, minWidth: 260 }} />
          </Field>
          <Field label="Code"
            info="The code the customer types to redeem. Leave it empty and one is generated for you. Letters, numbers and hyphens only, 4–64 characters.">
            <input placeholder="Blank = auto-generate" value={code}
              onChange={e => setCode(e.target.value.toUpperCase())} style={{ ...inputStyle, minWidth: 210 }} />
          </Field>
          <Field label="Credits per redemption" required invalid={missCredits}
            message="Enter how many credits each redemption grants"
            info="How many credits land in an account each time someone redeems this code. Must be above zero. This is the only box you have to fill.">
            <input placeholder="e.g. 50" type="number" min="0.5" step="0.5" value={credits}
              aria-required="true" aria-invalid={missCredits}
              onChange={e => setCredits(e.target.value)}
              style={{ ...inputStyle, width: 180, ...(missCredits ? invalidStyle : null) }} />
          </Field>
          <Field label="Max redemptions"
            info="How many times the code may be used in total, across all customers. Leave it empty for unlimited use.">
            <input placeholder="Blank = unlimited" type="number" min="1" value={maxRedemptions}
              onChange={e => setMaxRedemptions(e.target.value)} style={{ ...inputStyle, width: 200 }} />
          </Field>
          <Field label="Expires"
            info="The last day the code can be REDEEMED. Leave it empty and it never expires. You can change this later from the table below.">
            <input type="date" value={expiresAt} onChange={e => setExpiresAt(e.target.value)}
              style={inputStyle} />
          </Field>
          <Field label="Access days"
            info="How long this code's CREDITS live after redeeming — 7, 14, 30. This is different from Expires above, which is the last day the code can be redeemed. Leave it empty and the credits get the standard 30 days. (2026-08-25: this used to set an account lockout; accounts never expire any more — only credits do.)">
            <input placeholder="Blank = 30 days" type="number" min="1" max="3650" value={accessDays}
              onChange={e => setAccessDays(e.target.value)} style={{ ...inputStyle, width: 200 }} />
          </Field>
          <div style={buttonRowOffset}>
            <button onClick={create} disabled={creating} style={primaryBtnStyle}>
              {creating ? 'Creating…' : '+ Create promo'}
            </button>
          </div>
        </FieldRow>

        {/* WHO the code is for. Its own row because it is the only box here
            that changes what the code IS — everything above tunes an open
            code; this one stops it being a bearer token. */}
        <FieldRow>
          <Field label="Lock to these emails"
            info="Paste the attendee list, or upload a .csv / .txt saved from Excel. Only these addresses can redeem the code, and each one only once — so a code that gets forwarded or screenshotted is worthless to whoever receives it. The redemption limit fills in from the list automatically. LEAVE IT EMPTY for an open code that anyone with the string can use, which is how every existing code works.">
            <textarea
              placeholder={'ahmed@company.com\nsara@company.com\n… or paste a whole column from Excel'}
              value={inviteText}
              onChange={e => { setInviteText(e.target.value); setInviteFileName(''); }}
              rows={3}
              style={{ ...inputStyle, minWidth: 340, width: '100%', fontFamily: 'inherit', resize: 'vertical' }} />
          </Field>
          <div style={buttonRowOffset}>
            <label style={{ ...btnStyle, display: 'inline-block', cursor: 'pointer' }}>
              Upload list…
              <input type="file" accept=".csv,.txt,text/csv,text/plain"
                onChange={e => readInviteFile(e.target.files?.[0])}
                style={{ display: 'none' }} />
            </label>
          </div>
        </FieldRow>
        <div style={{ fontSize: 11.5, marginTop: 6,
                      color: invitedEmails.length ? 'var(--crm-green)' : 'var(--crm-w40)' }}>
          {invitedEmails.length
            ? `${invitedEmails.length} address${invitedEmails.length === 1 ? '' : 'es'} — `
              + `only these can redeem it, once each${inviteFileName ? ` (from ${inviteFileName})` : ''}`
            : 'Empty = open code: anyone who has the string can redeem it once.'}
          {' '}Excel files: save as CSV first — this reads .csv and .txt, not .xlsx.
        </div>
        <div style={{ color: 'var(--crm-w40)', fontSize: 11.5, marginTop: 10 }}>
          Boxes marked <span style={{ color: 'var(--crm-red)', fontWeight: 700 }}>*</span> must be filled ·
          press <b>ⓘ</b> beside a box to see exactly what it expects.
        </div>
      </div>

      {/* Search */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 16 }}>
        <input
          placeholder="Search description, code or creator…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          style={{ ...inputStyle, flex: '1 1 320px', maxWidth: 460 }}
        />
        {query && (
          <button onClick={() => setQuery('')} style={btnStyle}>Clear</button>
        )}
        <span style={{ color: 'var(--crm-w40)', fontSize: 12 }}>
          {promos ? `${visible.length} of ${promos.length}` : ''}
        </span>
      </div>

      {/* List */}
      <div style={{ overflowX: 'auto', border: '1px solid var(--crm-w08)', borderRadius: 12, marginTop: 12 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              {['Description', 'Code', 'Credits', 'Redemptions', 'Expires', 'Access days', 'Status', 'Created', ''].map((h, i) => (
                <th key={i} style={thStyle}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {promos === null && <tr><td colSpan={COLS} style={emptyStyle}>Loading…</td></tr>}
            {promos?.length === 0 && <tr><td colSpan={COLS} style={emptyStyle}>No promo codes yet — create the first one above.</td></tr>}
            {promos?.length > 0 && visible.length === 0 && (
              <tr><td colSpan={COLS} style={emptyStyle}>No promo codes match “{query}”.</td></tr>
            )}
            {visible?.map(p => {
              const status = promoStatus(p);
              const isEditing = editingId === p.id;
              const isExpanded = expandedId === p.id;
              const rows = redemptions[p.id];
              return (
                <React.Fragment key={p.id}>
                  <tr style={{ borderTop: '1px solid var(--crm-w06)' }}>
                    <td style={{ ...tdStyle, maxWidth: 280 }}>
                      {isEditing ? (
                        <input value={editDescription} onChange={e => setEditDescription(e.target.value)}
                          placeholder="Who is this for?" autoFocus
                          style={{ ...inputStyle, width: '100%', minWidth: 200 }} />
                      ) : (
                        <span style={{ color: p.description ? 'var(--crm-ink)' : 'var(--crm-w30)' }}>
                          {p.description || '—'}
                        </span>
                      )}
                    </td>
                    <td style={{ ...tdStyle, fontFamily: '"JetBrains Mono", monospace', cursor: 'pointer' }}
                      onClick={() => copy(p.code)} title="Click to copy">
                      {p.code}
                    </td>
                    <td style={{ ...tdStyle, color: 'var(--crm-green)', fontWeight: 600 }}>+{Number(p.credits)}</td>
                    <td style={tdStyle}>
                      <button
                        onClick={() => toggleRedemptions(p)}
                        title={p.redeemed_count ? 'Show the accounts that redeemed this' : 'Nobody has redeemed this yet'}
                        style={{
                          ...btnStyle, padding: '2px 10px',
                          color: p.redeemed_count ? 'var(--crm-ink)' : 'var(--crm-w40)',
                        }}>
                        {p.redeemed_count}{p.max_redemptions != null ? ` / ${p.max_redemptions}` : ' / ∞'}
                        {p.redeemed_count > 0 && <span style={{ marginLeft: 6 }}>{isExpanded ? '▾' : '▸'}</span>}
                      </button>
                    </td>
                    <td style={tdStyle}>
                      {isEditing ? (
                        <input type="date" value={editExpiresAt}
                          onChange={e => setEditExpiresAt(e.target.value)}
                          title="Blank = never expires"
                          style={{ ...inputStyle, width: 150 }} />
                      ) : (
                        p.expires_at ? new Date(p.expires_at).toLocaleDateString() : 'never'
                      )}
                    </td>
                    {/* Access days — how long this code's CREDITS live after
                        redeeming (accounts themselves never expire, 2026-08-25).
                        Sits next to Expires (the redeem deadline) so the two are
                        read as the pair they are, not confused. */}
                    <td style={tdStyle}>
                      {p.access_days
                        ? <span style={{ color: 'var(--crm-ink)' }}>{p.access_days} days</span>
                        : <span style={{ color: 'var(--crm-w30)' }}>30 (standard)</span>}
                    </td>
                    <td style={tdStyle}>
                      <span style={{
                        color: status.color, background: status.bg,
                        padding: '2px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600,
                      }}>
                        {status.label}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, color: 'var(--crm-w40)' }}>{new Date(p.created_at).toLocaleDateString()}</td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                      {isEditing ? (
                        <>
                          <button onClick={() => saveEdit(p)} disabled={saving} style={primaryBtnStyle}>
                            {saving ? 'Saving…' : 'Save'}
                          </button>
                          <button onClick={() => setEditingId(null)} style={{ ...btnStyle, marginLeft: 6 }}>
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => startEdit(p)} style={btnStyle}>Edit</button>
                          <button onClick={() => toggle(p)} style={{ ...btnStyle, marginLeft: 6 }}>
                            {p.active ? 'Deactivate' : 'Activate'}
                          </button>
                        </>
                      )}
                    </td>
                  </tr>

                  {/* Who redeemed it — the accounts behind the count. */}
                  {isExpanded && (
                    <tr style={{ background: 'var(--crm-w03)' }}>
                      <td colSpan={COLS} style={{ padding: '12px 14px 16px' }}>
                        {/* ── RAISE THE VALUE FOR EVERYONE WHO USED IT ─────
                            ☠ FIRST, AND OUTSIDE EVERY CONDITIONAL. It was
                            nested inside `invites[p.id]?.total > 0` — so it
                            appeared only on codes with an email list, and was
                            invisible on every OPEN code. Every code issued
                            before 20 August is open, including all the SPA
                            ones: the button would have been missing from
                            exactly the codes it was built for. Caught by
                            reading the JSX before telling the owner where to
                            find it, after doing the opposite with the sidebar
                            an hour earlier. */}
                        <div style={{ marginBottom: 14 }}>
                          <PromoTopUpPanel promo={p} onError={onError} onDone={load} />
                        </div>

                        {/* ── WHO HAS NOT TURNED UP ─────────────────────────
                            Shown ABOVE the redemptions, because before a
                            workshop the outstanding names are the useful ones.
                            The predictable problem is not fraud — it is being
                            invited as ahmed@company.com and signing up as
                            ahmed.k@gmail.com, which a redemption list can
                            never reveal. Only a code with a list renders it. */}
                        {/* The list could not be read. Said out loud, because
                            silence here is indistinguishable from "this code
                            has no list" — and one of those is a lie. */}
                        {invites[p.id]?.failed && (
                          <div style={{
                            marginBottom: 14, padding: '10px 12px', borderRadius: 8,
                            background: 'var(--crm-amber-bg)', border: '1px solid var(--crm-w08)',
                            fontSize: 12, color: 'var(--crm-ink)',
                          }}>
                            <strong>The invitation list could not be read.</strong>{' '}
                            This does <em>not</em> mean {p.code} has no list — it means we do not
                            know. ({invites[p.id].failed})
                          </div>
                        )}
                        {/* An OPEN code, stated rather than left blank: it is a
                            real and important property of the code, not an
                            absence of information. */}
                        {invites[p.id] && !invites[p.id].failed && !invites[p.id].total && (
                          <div style={{ marginBottom: 14, fontSize: 12, color: 'var(--crm-w40)' }}>
                            <strong style={{ color: 'var(--crm-w60)' }}>Open code</strong> — not
                            locked to any list, so anyone signed in who has the string can redeem
                            it once. Every code issued before 20 August is open.
                            {' '}Adding an address here would lock {p.code} to that one person and
                            shut everybody else out, so there is nothing to add to.
                          </div>
                        )}
                        {invites[p.id]?.total > 0 && (
                          <div style={{ marginBottom: 14 }}>
                            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                              Locked to {invites[p.id].total} email{invites[p.id].total === 1 ? '' : 's'} ·{' '}
                              <span style={{ color: 'var(--crm-green)' }}>
                                {invites[p.id].redeemedCount} redeemed
                              </span>
                              {invites[p.id].waitingCount > 0 && <>
                                {' · '}
                                <span style={{ color: 'var(--crm-amber)' }}>
                                  {invites[p.id].waitingCount} not yet
                                </span>
                              </>}
                            </div>
                            {invites[p.id].waitingCount > 0 && (
                              <>
                                <div style={{ fontSize: 11.5, color: 'var(--crm-w40)', marginBottom: 4 }}>
                                  Still to redeem — if someone says the code does not work, check they
                                  signed up with the exact address below:
                                </div>
                                <div style={{
                                  fontFamily: '"JetBrains Mono", monospace', fontSize: 11.5,
                                  color: 'var(--crm-w60)', lineHeight: 1.7, wordBreak: 'break-all',
                                }}>
                                  {invites[p.id].waiting.map(r => r.email).join(' · ')}
                                </div>
                              </>
                            )}

                            {/* ── ADD SOMEBODY WHO WAS LEFT OFF ──────────────
                                The answer to "one person on the sheet cannot
                                redeem". Before this existed the only options
                                were a whole second code or credits by hand,
                                and neither leaves a mark here. */}
                            <div style={{ marginTop: 10 }}>
                              {addTo === p.id ? (
                                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                                  <input
                                    value={addText}
                                    onChange={e => setAddText(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter' && !adding) addInvites(p); }}
                                    placeholder="someone@example.com — or paste several"
                                    aria-label={`Add an email address to ${p.code}`}
                                    autoFocus
                                    style={{ ...inputStyle, flex: '1 1 300px', maxWidth: 420, fontSize: 12 }} />
                                  <button onClick={() => addInvites(p)} disabled={adding} style={primaryBtnStyle}>
                                    {adding ? 'Adding…' : 'Add to list'}
                                  </button>
                                  <button onClick={() => { setAddTo(null); setAddText(''); }} style={btnStyle}>
                                    Cancel
                                  </button>
                                  <div style={{ flexBasis: '100%', fontSize: 11, color: 'var(--crm-w40)' }}>
                                    They can redeem {p.code} straight away — nothing is emailed to them.
                                    {' '}The redemption cap grows with the list, unless you set it by hand.
                                  </div>
                                </div>
                              ) : (
                                <button onClick={() => { setAddTo(p.id); setAddText(''); }} style={btnStyle}
                                  title={`Add an email address to ${p.code}'s list`}>
                                  + Add email to this list
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                        {!rows && <div style={{ color: 'var(--crm-w40)', fontSize: 12 }}>Loading…</div>}
                        {rows?.length === 0 && (
                          <div style={{ color: 'var(--crm-w40)', fontSize: 12 }}>
                            Nobody has redeemed {p.code} yet.
                          </div>
                        )}
                        {rows?.length > 0 && (
                          <>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                              <span style={{ color: 'var(--crm-w50)', fontSize: 12 }}>
                                {rows.length} account{rows.length === 1 ? '' : 's'} redeemed {p.code}
                              </span>
                              <button onClick={() => exportRedemptionsXlsx(p)} style={btnStyle}
                                title={`Download an Excel sheet of the users who redeemed ${p.code}`}>
                                ⬇ Excel — {p.code}
                              </button>
                            </div>
                            <div style={{
                              display: 'grid',
                              gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
                              gap: 6,
                            }}>
                              {rows.map(r => (
                                <div key={r.user_id} style={{
                                  display: 'flex', justifyContent: 'space-between', gap: 10,
                                  padding: '6px 10px', borderRadius: 8,
                                  background: 'var(--crm-w04)', fontSize: 12,
                                }}>
                                  <span style={{ color: r.banned ? 'var(--crm-red)' : 'var(--crm-ink)' }}>
                                    {r.email}{r.banned ? ' (banned)' : ''}
                                  </span>
                                  <span style={{ color: 'var(--crm-w40)', whiteSpace: 'nowrap' }}>
                                    {new Date(r.created_at).toLocaleDateString()}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value, note, color }) {
  return (
    <div style={{
      padding: '14px 16px', background: 'var(--crm-w03)',
      border: '1px solid var(--crm-w08)', borderRadius: 12,
    }}>
      <div style={{
        fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
        letterSpacing: '0.05em', color: 'var(--crm-w40)', marginBottom: 6,
      }}>{label}</div>
      <div style={{
        fontSize: 26, fontWeight: 700, lineHeight: 1.1,
        color: color || 'var(--crm-ink)', fontVariantNumeric: 'tabular-nums',
      }}>{value}</div>
      {note ? (
        <div style={{ fontSize: 12, color: 'var(--crm-w40)', marginTop: 4 }}>{note}</div>
      ) : null}
    </div>
  );
}

const invalidStyle = { border: '1px solid var(--crm-red)', background: 'var(--crm-red-bg)' };
const inputStyle = {
  height: 36, padding: '0 12px', background: 'var(--crm-w04)',
  border: '1px solid var(--crm-w10)', borderRadius: 8,
  color: 'var(--crm-ink)', fontSize: 13, outline: 'none', fontFamily: 'inherit',
};
const btnStyle = {
  height: 32, padding: '0 12px', background: 'var(--crm-w06)',
  border: '1px solid var(--crm-w12)', borderRadius: 8,
  color: 'var(--crm-w85)', fontSize: 12, fontWeight: 600,
  cursor: 'pointer', fontFamily: 'inherit',
};
const primaryBtnStyle = {
  height: 36, padding: '0 18px', background: '#e0442c', border: 'none',
  borderRadius: 8, color: 'var(--crm-ink)', fontSize: 13, fontWeight: 700,
  cursor: 'pointer', fontFamily: 'inherit',
};
const panelStyle = {
  padding: 16, background: 'var(--crm-w03)',
  border: '1px solid var(--crm-w08)', borderRadius: 12,
};
const panelTitleStyle = { fontSize: 13, fontWeight: 600, color: 'var(--crm-w60)', marginBottom: 12 };
const thStyle = {
  textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600,
  textTransform: 'uppercase', letterSpacing: '0.05em',
  color: 'var(--crm-w40)', background: 'var(--crm-w03)',
  whiteSpace: 'nowrap',
};
const tdStyle = { padding: '10px 14px', color: 'var(--crm-w85)' };
const emptyStyle = { padding: '24px 14px', textAlign: 'center', color: 'var(--crm-w35)' };
