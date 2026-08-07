// ─── NotificationsTab ────────────────────────────────────────────────────────
// Compose · Automations · History, following the reference prototype's
// structure with the CRM's dark surface.
//
// THREE THINGS THIS SCREEN MUST SAY OUT LOUD:
//   1. Email is ON HOLD and Push is LATER — both disabled, both badged.
//   2. Three automations can never fire (no checkout ⇒ no renewals, no
//      charges). They are shown switched off and labelled, not hidden.
//   3. {renewal_date} has no source. If an admin types it, the preview warns
//      BEFORE sending rather than after a customer reads a broken sentence.

import React, { useCallback, useEffect, useState } from 'react';
import { adminApi } from '@/lib/adminApi';
import Field, { adminInput, MissingSummary } from './FormField';
import { toast } from 'sonner';

const num = (v) => Number(v || 0).toLocaleString('en-US');
const pctOf = (a, b) => (!b ? '0%' : `${Math.round((a / b) * 100)}%`);

const TYPE_META = {
  announce: { label: 'Announcement / news', icon: '📣', color: 'var(--crm-blue)', desc: 'General news to everyone or a segment.' },
  feature:  { label: 'New feature',         icon: '🚀', color: 'var(--crm-violet)', desc: 'Feature release — links to its page, optional spotlight.' },
  promo:    { label: 'Offer / promo code',  icon: '🎁', color: 'var(--crm-green)', desc: 'Attach an offer — code or auto-applied.' },
  personal: { label: 'Personal message',    icon: '💬', color: 'var(--crm-orange)', desc: 'A direct message to a few hand-picked clients.' },
  welcome:  { icon: '👋', color: 'var(--crm-blue)' }, renewal: { icon: '🔄', color: 'var(--crm-blue)' },
  credits:  { icon: '⚡', color: 'var(--crm-orange)' }, gen: { icon: '🎬', color: 'var(--crm-green)' },
  payment:  { icon: '💳', color: 'var(--crm-red)' },
};
const MANUAL = ['announce', 'feature', 'promo', 'personal'];

export default function NotificationsTab({ onError }) {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('compose');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setData(await adminApi.notificationsState()); }
    catch (e) { onError?.(e, 'Could not load notifications'); }
  }, [onError]);
  useEffect(() => { load(); }, [load]);

  if (!data) return <div style={muted}>Loading notifications…</div>;

  const S = data.settings || {};

  return (
    <div>
      <div style={{
        padding: '10px 14px', marginBottom: 14, borderRadius: 10, fontSize: 13,
        background: 'var(--crm-blue-bg)', border: '1px solid var(--crm-blue-br)',
        color: 'var(--crm-w85)',
      }}>
        <b>In-app notifications.</b> Manual messages you compose here, plus automatic rules.
        Email is on hold and push is not built — everything below is the in-app bell only.
        {!S.bell_enabled && (
          <> <b style={{ color: 'var(--crm-amber)' }}>The customer bell is currently switched off</b>, so
          messages are recorded but nobody sees them yet.</>
        )}
      </div>

      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--crm-w10)', marginBottom: 12 }}>
        {[['compose', 'Compose'], ['auto', 'Automations'], ['history', 'History'], ['settings', 'Settings']]
          .map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} style={{
              border: 'none', background: 'none', padding: '9px 14px', cursor: 'pointer',
              fontFamily: 'inherit', fontSize: 14,
              color: tab === id ? 'var(--crm-ink)' : 'var(--crm-w45)',
              fontWeight: tab === id ? 700 : 500,
              borderBottom: tab === id ? '2px solid #e0442c' : '2px solid transparent',
            }}>{label}</button>
          ))}
      </div>

      {tab === 'compose' && <Compose data={data} busy={busy} setBusy={setBusy} onError={onError} onSent={load} />}
      {tab === 'auto' && <Automations rows={data.automations || []} onError={onError} onChanged={load} />}
      {tab === 'history' && <History rows={data.history || []} />}
      {tab === 'settings' && <Settings settings={S} onError={onError} onChanged={load} />}
    </div>
  );
}

// ─── compose ─────────────────────────────────────────────────────────────────
function Compose({ data, busy, setBusy, onError, onSent }) {
  const [type, setType] = useState('announce');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [ctaText, setCtaText] = useState('');
  const [ctaUrl, setCtaUrl] = useState('');
  const [offerId, setOfferId] = useState('');
  const [aud, setAud] = useState('all');
  const [filters, setFilters] = useState({});
  const [picked, setPicked] = useState([]);
  const [pickQuery, setPickQuery] = useState('');
  const [pickResults, setPickResults] = useState([]);
  const [audience, setAudience] = useState(null);
  const [preview, setPreview] = useState(null);
  const [expires, setExpires] = useState('');
  const [errs, setErrs] = useState([]);
  // Required boxes only turn red AFTER a send attempt. Painting the form red
  // before the admin has typed anything is nagging, not help.
  const [tried, setTried] = useState(false);

  // What is missing, per box. Mirrors the server's rules in
  // notifications-engine.js validateCompose() so the screen and the API agree.
  const missing = {
    title: !title.trim(),
    body: !body.trim(),
    // A button with no destination does nothing when a customer taps it.
    ctaUrl: !!ctaText.trim() && !ctaUrl.trim(),
    picked: aud === 'picked' && picked.length === 0,
  };
  const miss = tried
    ? missing
    : { title: false, body: false, ctaUrl: false, picked: false };
  const missingCount = Object.values(missing).filter(Boolean).length;

  // Audience size, debounced — every keystroke would otherwise scan users.
  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        setAudience(await adminApi.notificationsAudience({
          audience_mode: aud, filters, picked_client_ids: picked.map((p) => p.id),
        }));
      } catch (e) { onError?.(e, 'Could not size that audience'); }
    }, 350);
    return () => clearTimeout(t);
  }, [aud, filters, picked, onError]);

  // The preview is rendered by the SERVER against a real user, so what the
  // admin approves is what the engine will actually produce.
  useEffect(() => {
    const t = setTimeout(async () => {
      if (!title && !body) { setPreview(null); return; }
      try { setPreview(await adminApi.notificationsPreview({ title, body })); }
      catch { setPreview(null); }
    }, 300);
    return () => clearTimeout(t);
  }, [title, body]);

  useEffect(() => {
    if (aud !== 'picked') return;
    const t = setTimeout(async () => {
      if (!pickQuery.trim()) { setPickResults([]); return; }
      try { const r = await adminApi.searchUsers(pickQuery.trim()); setPickResults(r?.users || r || []); }
      catch { setPickResults([]); }
    }, 350);
    return () => clearTimeout(t);
  }, [aud, pickQuery]);

  async function send() {
    setTried(true);
    setErrs([]);
    // Stop here and mark the boxes, rather than sending a request we already
    // know the server will reject. The extra checks below are the ones the
    // server also enforces but which have no single box to point at.
    const extra = [];
    if (ctaUrl.trim() && !(ctaUrl.trim().startsWith('/') && !ctaUrl.trim().startsWith('//'))) {
      extra.push('the button link must be a path on this site, like /pricing');
    }
    if (aud === 'segment' && audience?.count === 0) extra.push('this segment matches 0 clients');
    if (Object.values(missing).some(Boolean) || extra.length) {
      setErrs(extra);
      return;
    }

    setBusy(true);
    try {
      const r = await adminApi.notificationsSend({
        type, title, body, cta_text: ctaText || null, cta_url: ctaUrl || null,
        offer_id: offerId || null, audience_mode: aud,
        filters: aud === 'segment' ? filters : null,
        picked_client_ids: aud === 'picked' ? picked.map((p) => p.id) : [],
        expires_at: expires || null,
      });
      toast.success(
        `Sent to ${r.delivered} client${r.delivered === 1 ? '' : 's'}` +
        (r.skipped_cap ? ` · ${r.skipped_cap} held by the daily cap` : ''));
      setTitle(''); setBody(''); setCtaText(''); setCtaUrl('');
      onSent?.();
    } catch (e) {
      if (e?.body?.errors) setErrs(e.body.errors);
      else onError?.(e, 'Could not send');
    } finally { setBusy(false); }
  }

  const offers = data.offers || [];

  return (
    <div>
      <Card step="1" title="What kind of message?" why="Manual notifications you compose. Automatic ones live in the Automations tab.">
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
          {MANUAL.map((k) => {
            const m = TYPE_META[k]; const sel = type === k;
            return (
              <button key={k} type="button" onClick={() => {
                setType(k);
                if (k === 'personal' && aud === 'all') setAud('picked');
              }} style={{
                textAlign: 'left', padding: '12px 14px', borderRadius: 12, cursor: 'pointer',
                fontFamily: 'inherit', position: 'relative',
                background: sel ? `${m.color}14` : 'var(--crm-w03)',
                border: `1.5px solid ${sel ? m.color : 'var(--crm-w10)'}`,
              }}>
                {sel && <span style={{
                  position: 'absolute', top: 9, right: 10, width: 19, height: 19, borderRadius: '50%',
                  background: m.color, color: '#0b0b0b', fontSize: 12, fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>✓</span>}
                <div style={{
                  width: 34, height: 34, borderRadius: 9, marginBottom: 7, fontSize: 17,
                  background: `${m.color}22`, color: m.color,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>{m.icon}</div>
                <div style={{ fontWeight: 650, color: 'var(--crm-ink)' }}>{m.label}</div>
                <div style={{ color: 'var(--crm-w55)', fontSize: 12, marginTop: 2 }}>{m.desc}</div>
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 14 }}>
          <Field label="Title" required invalid={miss.title} aria-required
            info="The bold headline the client sees first in their notification bell. Keep it short — around 6 to 10 words. Example: “Eid offer: 15% off everything”.">
            <input value={title} onChange={(e) => setTitle(e.target.value)}
              aria-required="true" aria-invalid={miss.title}
              placeholder="e.g. Eid offer: 15% off everything"
              style={{ ...adminInput(miss.title), width: 320 }} />
          </Field>
        </div>
        <div style={{ marginTop: 10 }}>
          <Field label="Message" required invalid={miss.body}
            info="The body of the notification, under the title. You can use {name}, {plan} and {credits} — each client sees their own values. Two or three sentences works best.">
            <textarea value={body} onChange={(e) => setBody(e.target.value)}
              aria-required="true" aria-invalid={miss.body}
              placeholder="Write the message your clients will see…"
              style={{ ...adminInput(miss.body), width: '100%', maxWidth: 620, height: 76, padding: 10, resize: 'vertical' }} />
          </Field>
        </div>

        {preview?.unresolved?.length > 0 && (
          <div style={{ ...noteBox('var(--crm-amber)'), marginTop: 10 }}>
            <b>{preview.unresolved.join(', ')} cannot be filled in.</b> Nothing in the database holds a
            renewal date — Voxel has no subscriptions yet — so this would reach your customers as
            “—”. Remove it, or write the date into the message yourself.
          </div>
        )}

        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 12, alignItems: 'flex-end' }}>
          <Field label="Button text (CTA)"
            info="Optional. The words on the button under the message — for example “Claim the offer”. Leave it empty for a message with no button.">
            <input value={ctaText} onChange={(e) => setCtaText(e.target.value)}
              placeholder="e.g. Claim the offer" style={{ ...input, width: 190 }} />
          </Field>
          {/* Conditionally required: a button with no destination does nothing
              when a customer taps it. Only marked once they have typed CTA text. */}
          <Field label="Button link" required={!!ctaText.trim()} invalid={miss.ctaUrl}
            message="The button needs a link, or remove the button text"
            info="Where the button takes the client. Must be a path on your own site, starting with a slash — for example /pricing or /features/node-canvas. Full web addresses are refused.">
            <input value={ctaUrl} onChange={(e) => setCtaUrl(e.target.value)}
              aria-invalid={miss.ctaUrl}
              placeholder="/pricing" style={{ ...adminInput(miss.ctaUrl), width: 220 }} />
          </Field>
          <Field label="Attach offer"
            info="Optional. Links this message to an offer you already created in the Offers tab, so the client sees its promo code with the notification.">
            <select value={offerId} onChange={(e) => setOfferId(e.target.value)} style={{ ...input, width: 240 }}>
              <option style={opt} value="">None</option>
              {offers.map((o) => (
                <option style={opt} key={o.id} value={o.id}>
                  {o.name}{o.code ? ` — code ${o.code}` : ' (auto-applied)'}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Card>

      <Card step="2" title="Who receives it?" why="The same audience engine as Offers — everyone, a filtered segment, or hand-picked clients.">
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 11 }}>
          {[['all', 'Everyone'], ['segment', 'Filtered segment'], ['picked', 'Hand-picked clients']].map(([v, l]) => (
            <label key={v} style={radio}>
              <input type="radio" name="naud" checked={aud === v} onChange={() => setAud(v)} /> {l}
            </label>
          ))}
        </div>

        {aud === 'segment' && (
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
            {[['months_min', 'Months subscribed ≥'], ['usage_min', 'Credits used / month ≥'],
              ['inactive_min', 'Inactive ≥ days'], ['remaining_lt', 'Credits remaining < %']].map(([k, l]) => (
              <Field key={k} label={l}>
                <input type="number" min="0" placeholder="any" style={{ ...input, width: 120 }}
                  value={filters[k] ?? ''}
                  onChange={(e) => setFilters((f) => ({ ...f, [k]: e.target.value === '' ? null : Number(e.target.value) }))} />
              </Field>
            ))}
          </div>
        )}

        {aud === 'picked' && (
          <div>
            <Field label="Search clients">
              <input value={pickQuery} onChange={(e) => setPickQuery(e.target.value)}
                placeholder="email…" style={{ ...input, width: 300 }} />
            </Field>
            <div style={{ maxHeight: 200, overflow: 'auto', border: '1px solid var(--crm-w08)',
              borderRadius: 9, marginTop: 8, maxWidth: 620 }}>
              {pickResults.map((u) => {
                const on = picked.some((p) => p.id === u.id);
                return (
                  <label key={u.id} style={{
                    display: 'flex', gap: 9, padding: '6px 11px', alignItems: 'center', fontSize: 12.5,
                    borderBottom: '1px solid var(--crm-w06)', cursor: 'pointer',
                  }}>
                    <input type="checkbox" checked={on} onChange={() => setPicked((ps) =>
                      on ? ps.filter((p) => p.id !== u.id) : [...ps, u])} />
                    <b style={{ color: 'var(--crm-ink)' }}>{u.email}</b>
                    <span style={muted}>· {u.package || 'no plan'}</span>
                  </label>
                );
              })}
              {!pickResults.length && <div style={{ ...muted, padding: 11 }}>Search by email to add clients.</div>}
            </div>
            <div style={{ ...muted, marginTop: 8 }}>{picked.length} selected</div>
          </div>
        )}

        <div style={{ marginTop: 11 }}>
          <span style={{ fontSize: 16, fontWeight: 650, color: 'var(--crm-ink)' }}>
            {aud === 'picked' ? picked.length : (audience?.count ?? '…')}
          </span>{' '}
          <span style={muted}>clients will receive this</span>
        </div>
      </Card>

      <Card step="3" title="Schedule & channels" why="In-app bell now. Email joins when the mail server is configured.">
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Field label="Expires (auto-hide)">
            <input type="date" value={expires} onChange={(e) => setExpires(e.target.value)}
              style={{ ...input, width: 170 }} />
          </Field>
          <Field label="Channels">
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              <label style={radio}><input type="checkbox" checked disabled /> In-app bell</label>
              <label style={{ ...radio, opacity: 0.55, cursor: 'not-allowed' }}>
                <input type="checkbox" disabled /> Email<span style={badge('var(--crm-amber)')}>ON HOLD</span>
              </label>
              <label style={{ ...radio, opacity: 0.55, cursor: 'not-allowed' }}>
                <input type="checkbox" disabled /> Push<span style={badge('var(--crm-blue)')}>LATER</span>
              </label>
            </div>
          </Field>
        </div>
        <div style={{ ...muted, marginTop: 8, fontSize: 12 }}>
          Frequency cap: a client receives at most {data.settings?.daily_marketing_cap ?? 2} marketing
          notifications per day. System notifications (generation ready, low credits) are never blocked.
        </div>
      </Card>

      <Card step="4" title="Preview — exactly as a client sees it"
        why={preview?.sample_user ? `Variables filled with a real account (${preview.sample_user}).` : 'Variables filled with a real account.'}>
        <div style={{ maxWidth: 440, border: '1px solid var(--crm-w10)', borderRadius: 12, overflow: 'hidden' }}>
          <NotificationCard n={{
            type, title: preview?.title || title || '…', body: preview?.body || body || '…',
            cta_text: ctaText, created_at: new Date().toISOString(), read_at: null,
          }} />
        </div>
      </Card>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button disabled={busy} onClick={send} style={{
          padding: '9px 18px', fontSize: 14, fontWeight: 700, color: 'var(--crm-ink)', border: 'none', borderRadius: 10,
          background: busy ? 'rgba(139,0,0,0.4)' : 'linear-gradient(90deg,#CC0000 0%,#FF2222 50%,#E01E1E 100%)',
          cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit',
        }}>Send notification</button>
      </div>
      {tried && <MissingSummary count={missingCount} extra={errs} />}
      <div style={{ ...muted, marginTop: 10, fontSize: 12 }}>
        Boxes marked <span style={{ color: 'var(--crm-red)', fontWeight: 700 }}>*</span> must be filled.
        Press <b>ⓘ</b> beside any box to see what goes in it. Sending writes the audit log.
      </div>
    </div>
  );
}

// ─── automations ─────────────────────────────────────────────────────────────
function Automations({ rows, onError, onChanged }) {
  const [busy, setBusy] = useState(null);

  const update = async (key, body) => {
    setBusy(key);
    try { await adminApi.notificationsAutomation(key, body); onChanged?.(); }
    catch (e) { onError?.(e, 'Could not update that rule'); }
    finally { setBusy(null); }
  };

  const dead = rows.filter((r) => r.needs_checkout).length;

  return (
    <div>
      {dead > 0 && (
        <div style={{ ...noteBox('var(--crm-amber)'), marginBottom: 12 }}>
          <b>{dead} rules cannot run yet.</b> They depend on subscription renewals and card charges,
          and Voxel has no checkout — so nothing could ever trigger them. They are switched off and
          cannot be enabled; they will start working the day a payment flow exists.
        </div>
      )}
      <div style={{ ...panel, padding: 0, overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
          <thead><tr>
            <th style={{ ...th, textAlign: 'left' }}></th>
            {['Rule', 'Trigger', 'Template', 'Channels', 'Active'].map((h) => (
              <th key={h} style={{ ...th, textAlign: 'left' }}>{h}</th>))}
          </tr></thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.key} style={{
                borderTop: '1px solid var(--crm-w06)',
                background: a.needs_checkout ? 'var(--crm-amber-bg)' : 'transparent',
                opacity: a.needs_checkout ? 0.75 : 1,
              }}>
                <td style={{ ...td, fontSize: 16 }}>{a.icon}</td>
                <td style={{ ...td, textAlign: 'left', color: 'var(--crm-ink)', fontWeight: 600 }}>
                  {a.name}
                  {a.is_system && <span style={{ ...muted, fontWeight: 400, fontSize: 11 }}> · system</span>}
                  {a.needs_checkout && <span style={badge('var(--crm-amber)')}>NEEDS CHECKOUT</span>}
                </td>
                <td style={{ ...td, textAlign: 'left' }}>
                  {a.n != null && (
                    <input type="number" min="0" defaultValue={a.n} disabled={a.needs_checkout}
                      style={{ ...input, width: 62, height: 28, marginRight: 6 }}
                      onBlur={(e) => {
                        const v = Number(e.target.value);
                        if (Number.isFinite(v) && v !== a.n) update(a.key, { n: v });
                      }} />
                  )}
                  {a.trigger_label}
                </td>
                <td style={{ ...td, textAlign: 'left', whiteSpace: 'normal', maxWidth: 330, ...muted }}>
                  {a.template}
                </td>
                <td style={{ ...td, textAlign: 'left' }}>
                  In-app<span style={badge('var(--crm-amber)')}>EMAIL ON HOLD</span>
                </td>
                <td style={td}>
                  <label style={{ cursor: a.needs_checkout ? 'not-allowed' : 'pointer' }}
                    title={a.needs_checkout ? 'No checkout exists, so nothing can trigger this rule' : ''}>
                    <input type="checkbox" checked={a.enabled} disabled={a.needs_checkout || busy === a.key}
                      onChange={(e) => update(a.key, { enabled: e.target.checked })} />
                  </label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ ...muted, marginTop: 10, fontSize: 12 }}>
        Variables {'{name} {plan} {credits}'} are filled per client. System rules bypass the daily cap.
      </div>
    </div>
  );
}

// ─── history ─────────────────────────────────────────────────────────────────
function History({ rows }) {
  if (!rows.length) return <div style={{ ...panel, ...muted }}>Nothing sent yet.</div>;
  return (
    <div>
      <div style={{ ...panel, padding: 0, overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
          <thead><tr>
            {['Sent', '', 'Title', 'Audience'].map((h) => <th key={h} style={{ ...th, textAlign: 'left' }}>{h}</th>)}
            {['Delivered', 'Held by cap', 'Read', 'Clicked'].map((h) => <th key={h} style={th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} style={{ borderTop: '1px solid var(--crm-w06)' }}>
                <td style={{ ...td, textAlign: 'left' }}>{String(c.sent_at || c.created_at).slice(0, 10)}</td>
                <td style={{ ...td, textAlign: 'left', fontSize: 15 }}>{TYPE_META[c.type]?.icon || '🔔'}</td>
                <td style={{ ...td, textAlign: 'left', color: 'var(--crm-ink)', fontWeight: 600 }}>{c.title}</td>
                <td style={{ ...td, textAlign: 'left' }}>
                  {c.audience_mode === 'all' ? 'Everyone' : c.audience_mode === 'picked' ? 'Hand-picked' : 'Segment'}
                </td>
                <td style={td}>{num(c.delivered_now)}</td>
                <td style={td}>{c.skipped_cap ? num(c.skipped_cap) : '—'}</td>
                <td style={td}>{pctOf(c.read_count, c.delivered_now)}</td>
                <td style={td}>{pctOf(c.click_count, c.delivered_now)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ ...muted, marginTop: 10, fontSize: 12 }}>
        Read and click rates per notification — this is how you learn which messages clients respond to.
      </div>
    </div>
  );
}

// ─── settings ────────────────────────────────────────────────────────────────
function Settings({ settings, onError, onChanged }) {
  const [busy, setBusy] = useState(false);
  const save = async (body) => {
    setBusy(true);
    try { await adminApi.notificationsSettings(body); toast.success('Saved'); onChanged?.(); }
    catch (e) { onError?.(e, 'Could not save'); }
    finally { setBusy(false); }
  };
  return (
    <div style={{ ...panel, maxWidth: 640 }}>
      <div style={{ marginBottom: 16 }}>
        <Field label="Marketing notifications per client per day">
          <input type="number" min="0" max="20" defaultValue={settings.daily_marketing_cap}
            disabled={busy} style={{ ...input, width: 90 }}
            onBlur={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v) && v !== settings.daily_marketing_cap) save({ daily_marketing_cap: v });
            }} />
        </Field>
        <div style={{ ...muted, fontSize: 12, marginTop: 4 }}>
          System notifications — generation ready, low credits — are never blocked by this.
          Setting it to 0 pauses all marketing notifications.
        </div>
      </div>

      <div style={{ borderTop: '1px solid var(--crm-w08)', paddingTop: 14 }}>
        <label style={{ ...radio, fontSize: 14 }}>
          <input type="checkbox" checked={!!settings.bell_enabled} disabled={busy}
            onChange={(e) => save({ bell_enabled: e.target.checked })} />
          <b style={{ color: 'var(--crm-ink)' }}>Show the notification bell to customers</b>
        </label>
        <div style={{ ...muted, fontSize: 12, marginTop: 6 }}>
          While this is off, notifications are still recorded but no customer sees the bell —
          so you can send a test message and check it before anyone else does. Turn it on when
          you are happy with what you see.
        </div>
      </div>
    </div>
  );
}

// ─── shared bits ─────────────────────────────────────────────────────────────
export function NotificationCard({ n }) {
  const m = TYPE_META[n.type] || { icon: '🔔', color: 'var(--crm-blue)' };
  return (
    <div style={{
      display: 'flex', gap: 11, padding: '12px 14px', position: 'relative',
      background: n.read_at ? 'transparent' : 'var(--crm-blue-bg)',
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: 10, flex: 'none', fontSize: 17,
        background: `${m.color}22`, color: m.color,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>{m.icon}</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 650, fontSize: 13, color: 'var(--crm-ink)' }}>{n.title}</div>
        <div style={{ color: 'var(--crm-w70)', fontSize: 12.5, marginTop: 1, whiteSpace: 'pre-wrap' }}>{n.body}</div>
        {n.code && (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 7, padding: '4px 10px',
            border: '1.5px dashed var(--crm-w25)', borderRadius: 8,
            fontWeight: 700, letterSpacing: '.06em', fontSize: 13, color: 'var(--crm-ink)',
          }}>{n.code}</div>
        )}
        {n.cta_text && (
          <div style={{ marginTop: 7 }}>
            <span style={{
              display: 'inline-block', padding: '5px 12px', borderRadius: 7, fontSize: 12.5,
              background: '#e0442c', color: '#fff', fontWeight: 600,
            }}>{n.cta_text}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function Card({ step, title, why, children }) {
  return (
    <div style={{ ...panel, marginBottom: 14 }}>
      <h3 style={{ margin: '0 0 4px', fontSize: 15, display: 'flex', alignItems: 'center', gap: 10, color: 'var(--crm-ink)' }}>
        <span style={{
          width: 26, height: 26, borderRadius: 8, background: '#e0442c', color: '#fff',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13.5, fontWeight: 700, flex: 'none',
        }}>{step}</span>
        {title}
      </h3>
      <div style={{ ...muted, fontSize: 12, margin: '2px 0 14px 36px' }}>{why}</div>
      <div style={{ marginLeft: 36 }}>{children}</div>
    </div>
  );
}
const badge = (c) => ({
  marginLeft: 8, padding: '1.5px 7px', borderRadius: 5, fontSize: 10,
  fontWeight: 700, letterSpacing: '.03em', background: `${c}22`, color: c, whiteSpace: 'nowrap',
});
const noteBox = (c) => ({
  padding: '10px 13px', borderRadius: 10, fontSize: 12.5,
  background: `${c}14`, border: `1px solid ${c}55`, color: 'var(--crm-w85)',
});
const muted = { color: 'var(--crm-w45)', fontSize: 13 };
const panel = {
  padding: 14, background: 'var(--crm-w03)',
  border: '1px solid var(--crm-w08)', borderRadius: 12,
};
const th = {
  padding: '9px 10px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
  letterSpacing: '.03em', color: 'var(--crm-w45)', textAlign: 'right', whiteSpace: 'nowrap',
};
const td = { padding: '7px 10px', textAlign: 'right', color: 'var(--crm-w85)', whiteSpace: 'nowrap' };
const input = adminInput();
// An <option> list is painted by the OS: without an explicit pair it renders
// black-on-black in dark mode. Same fix as the Offers screen.
const opt = { background: 'var(--crm-tooltip-bg)', color: 'var(--crm-ink)' };
const radio = { display: 'inline-flex', gap: 6, alignItems: 'center', cursor: 'pointer',
  color: 'var(--crm-w80)', fontSize: 13 };
