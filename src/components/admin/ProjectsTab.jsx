// ─── ProjectsTab.jsx ─────────────────────────────────────────────────────────
// THE BOARD AMR AND MOHANED SHARE.
//
// Their own work together — proposals, demos, follow-ups, the things that are
// mostly not software — where they already look every day, instead of a
// spreadsheet only one of them has open.
//
// Modelled on the SALT dashboard Amr sent, with three deliberate departures:
//
//  · IT WEARS THIS PANEL'S CLOTHES. The sample is oxblood on paper. Every
//    colour here comes from --crm-*, because a tab that looks like a different
//    product is one you stop trusting to tell you the truth about this one.
//  · ARCHIVE, NOT DELETE, on the row button. A board two people share is
//    exactly where one removes something the other still needed. Delete exists
//    for a row typed by mistake, and it says what it is before it does it.
//  · OVERDUE IS COMPUTED, NEVER STORED. A stored flag is wrong the morning
//    after it is written and nothing wakes up to fix it.

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { adminApi } from '@/lib/adminApi';
import InfoDot from './InfoDot';

const STATUSES = ['Not Started', 'In Progress', 'Pending', 'Approval Pending', 'Completed'];
const PRIORITIES = ['High', 'Medium', 'Low'];
const RISKS = ['Low', 'Medium', 'High'];

const STATUS_COLOR = {
  'Not Started': 'var(--crm-w40)',
  'In Progress': 'var(--crm-blue)',
  Pending: 'var(--crm-amber)',
  'Approval Pending': 'var(--crm-purple)',
  Completed: 'var(--crm-green)',
  Overdue: 'var(--crm-red)',
};
const PRIORITY_COLOR = { High: 'var(--crm-red)', Medium: 'var(--crm-amber)', Low: 'var(--crm-w45)' };

const card = {
  background: 'var(--crm-w03)', border: '1px solid var(--crm-w08)',
  borderRadius: 12, padding: '14px 16px',
};
const btn = {
  padding: '7px 13px', borderRadius: 8, border: '1px solid var(--crm-w14)',
  background: 'var(--crm-w06)', color: 'var(--crm-ink)', fontSize: 12.5,
  fontWeight: 600, cursor: 'pointer',
};
const field = {
  padding: '8px 10px', borderRadius: 8, border: '1px solid var(--crm-w14)',
  background: 'var(--crm-w06)', color: 'var(--crm-ink)', fontSize: 13, width: '100%',
};

/** Overdue is decided here too, so a card and its row can never disagree. */
function isOverdue(p) {
  if (!p?.end_date || p.status === 'Completed') return false;
  const end = new Date(p.end_date);
  if (Number.isNaN(end.getTime())) return false;
  end.setHours(23, 59, 59, 999);
  return end < new Date();
}
const effStatus = (p) => (isOverdue(p) ? 'Overdue' : p.status);
const day = (d) => (d ? new Date(d).toLocaleDateString('en-GB',
  { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const money = (n) => (Number(n) || 0).toLocaleString('en-US');

export default function ProjectsTab({ onError }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null);      // a row, or {} for new
  const [view, setView] = useState('table');
  const [showArchived, setShowArchived] = useState(false);
  const [filters, setFilters] = useState({ owner: '', status: '', priority: '', q: '' });

  const load = useCallback(async (archived = showArchived) => {
    setBusy(true);
    try { setData(await adminApi.projects({ archived })); }
    catch (e) { onError?.(e, 'The board could not be loaded'); }
    finally { setBusy(false); }
  }, [onError, showArchived]);

  useEffect(() => { load(); }, [load]);

  const projects = data?.projects || [];
  const owners = useMemo(
    () => [...new Set(projects.map((p) => p.owner).filter(Boolean))].sort(), [projects]);

  const shown = useMemo(() => projects.filter((p) => {
    if (filters.owner && p.owner !== filters.owner) return false;
    if (filters.status && effStatus(p) !== filters.status) return false;
    if (filters.priority && p.priority !== filters.priority) return false;
    if (filters.q) {
      const hay = [p.name, p.description, p.owner, p.client, p.category, (p.tags || []).join(' ')]
        .join(' ').toLowerCase();
      if (!hay.includes(filters.q.toLowerCase())) return false;
    }
    return true;
  }), [projects, filters]);

  async function save(form) {
    setBusy(true);
    try {
      if (form.id) await adminApi.projectUpdate(form.id, form);
      else await adminApi.projectCreate(form);
      setEditing(null);
      await load();
    } catch (e) { onError?.(e, 'The project could not be saved'); }
    finally { setBusy(false); }
  }

  async function archive(p, archived) {
    try { await adminApi.projectArchive(p.id, archived); await load(); }
    catch (e) { onError?.(e, 'It could not be archived'); }
  }

  async function move(p, status) {
    if (p.status === status) return;
    // Completing sets progress to 100 — "Completed · 60%" is a contradiction
    // somebody then has to stop and resolve.
    await save({ ...p, status, progress: status === 'Completed' ? 100 : p.progress });
  }

  const s = data?.summary;

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
        <span style={{ fontWeight: 700, color: 'var(--crm-ink)', fontSize: 14 }}>The board</span>
        <InfoDot
          label="The board"
          text={'The projects you and Mohaned are running together — proposals, demos, follow-ups, '
            + 'whatever is in flight. It is separate from the Tasks tab on purpose: that one is the '
            + 'record of what Claude is building here and is rewritten from code on every deploy, '
            + 'which would overwrite anything you typed. This one is yours. Overdue is worked out '
            + 'from the end date every time it is read, never stored, so it cannot go stale. The row '
            + 'button ARCHIVES rather than deletes — a shared board is exactly where one person '
            + 'removes something the other still needed.'}
        />
        <input
          value={filters.q}
          onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
          placeholder="Search projects, owners, tags…"
          aria-label="Search projects"
          style={{ ...field, width: 240, marginLeft: 'auto' }}
        />
        <button onClick={() => setEditing({})} style={{ ...btn, borderColor: 'var(--crm-red)', color: 'var(--crm-red)' }}>
          + New project
        </button>
      </div>

      {s && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(132px, 1fr))', gap: 10, marginBottom: 16 }}>
          <Kpi label="Total" value={s.total} colour="var(--crm-ink)" foot="On the board" />
          <Kpi label="In progress" value={s.in_progress} colour="var(--crm-blue)" foot="Being worked" />
          <Kpi label="Pending" value={s.pending} colour="var(--crm-amber)" foot="Waiting on someone" />
          <Kpi label="Approval" value={s.approval} colour="var(--crm-purple)" foot="Awaiting sign-off" />
          <Kpi label="Completed" value={s.completed} colour="var(--crm-green)" foot="Delivered" />
          <Kpi label="Overdue" value={s.overdue} colour="var(--crm-red)"
            foot={s.due_this_week ? `${s.due_this_week} due this week` : 'Past the end date'} />
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        {['table', 'board'].map((v) => (
          <button key={v} onClick={() => setView(v)}
            style={{ ...btn, background: view === v ? 'var(--crm-w14)' : 'var(--crm-w06)' }}>
            {v === 'table' ? 'List' : 'Board'}
          </button>
        ))}
        <Picker label="Owner" value={filters.owner} options={owners}
          onChange={(owner) => setFilters((f) => ({ ...f, owner }))} />
        <Picker label="Status" value={filters.status} options={[...STATUSES, 'Overdue']}
          onChange={(status) => setFilters((f) => ({ ...f, status }))} />
        <Picker label="Priority" value={filters.priority} options={PRIORITIES}
          onChange={(priority) => setFilters((f) => ({ ...f, priority }))} />
        <label style={{ fontSize: 12.5, color: 'var(--crm-w55)', display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={showArchived}
            onChange={(e) => { setShowArchived(e.target.checked); load(e.target.checked); }} />
          Show archived
        </label>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--crm-w45)' }}>
          {busy ? 'Loading…' : `${shown.length} shown`}
        </span>
      </div>

      {view === 'table'
        ? <Table rows={shown} onEdit={setEditing} onArchive={archive} />
        : <Board rows={shown} onEdit={setEditing} onMove={move} />}

      {s && (
        <div style={{ ...card, marginTop: 16, display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 12.5 }}>
          <Money label="Budget" n={s.budget} />
          <Money label="Cost" n={s.cost} />
          <Money label="Revenue" n={s.revenue} />
          {/* Revenue minus COST, never minus budget. Budget is what was agreed;
              confusing the two is how a project looks profitable while nobody
              has actually paid. */}
          <Money label="Profit" n={s.profit} colour={s.profit >= 0 ? 'var(--crm-green)' : 'var(--crm-red)'} />
          <InfoDot label="Money" text={'Totals across every project on the board. Profit is revenue minus '
            + 'COST — not budget minus cost. Budget is what was agreed, cost is what it took, revenue is '
            + 'what actually arrived. Reading profit against budget is how something looks profitable '
            + 'while nobody has paid yet.'} />
        </div>
      )}

      {editing && (
        <Editor
          project={editing}
          onCancel={() => setEditing(null)}
          onSave={save}
          onDelete={async (p) => {
            await adminApi.projectDelete(p.id).catch((e) => onError?.(e, 'It could not be deleted'));
            setEditing(null); await load();
          }}
          owners={owners}
          busy={busy}
        />
      )}
    </div>
  );
}

function Kpi({ label, value, colour, foot }) {
  return (
    <div style={{ ...card, borderLeft: `3px solid ${colour}` }}>
      <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--crm-w50)', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--crm-ink)', marginTop: 5, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--crm-w40)', marginTop: 4 }}>{foot}</div>
    </div>
  );
}

function Money({ label, n, colour }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--crm-w50)', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: colour || 'var(--crm-ink)', marginTop: 3 }}>{money(n)}</div>
    </div>
  );
}

function Picker({ label, value, options, onChange }) {
  return (
    <label style={{ fontSize: 12.5, color: 'var(--crm-w55)', display: 'flex', gap: 6, alignItems: 'center' }}>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}
        style={{ ...field, width: 'auto', padding: '6px 8px' }}>
        <option value="">All</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

function Badge({ status }) {
  const c = STATUS_COLOR[status] || 'var(--crm-w40)';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 700,
      padding: '3px 9px', borderRadius: 20, color: c, border: `1px solid ${c}`,
    }}>
      <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: '50%', background: c }} />
      {status}
    </span>
  );
}

function Table({ rows, onEdit, onArchive }) {
  if (!rows.length) {
    return <div style={{ ...card, textAlign: 'center', color: 'var(--crm-w45)', padding: 40 }}>
      Nothing here yet. Press <strong style={{ color: 'var(--crm-ink)' }}>+ New project</strong> to add the first one.
    </div>;
  }
  return (
    <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {['Project', 'Owner', 'Status', 'Priority', 'Progress', 'End', ''].map((h) => (
              <th key={h} style={{
                textAlign: 'left', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.06em',
                color: 'var(--crm-w50)', fontWeight: 700, padding: '11px 14px',
                borderBottom: '1px solid var(--crm-w08)', whiteSpace: 'nowrap',
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id} onClick={() => onEdit(p)} style={{ cursor: 'pointer', opacity: p.archived ? 0.55 : 1 }}>
              <td style={td}>
                <div style={{ fontWeight: 700, color: 'var(--crm-ink)', fontSize: 13.5 }}>
                  {p.name}{p.archived && <span style={{ color: 'var(--crm-w40)', fontWeight: 500 }}> · archived</span>}
                </div>
                {p.description && <div style={{ fontSize: 12, color: 'var(--crm-w50)', marginTop: 2, maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.description}</div>}
              </td>
              <td style={td}>{p.owner || '—'}</td>
              <td style={td}><Badge status={effStatus(p)} /></td>
              <td style={{ ...td, color: PRIORITY_COLOR[p.priority], fontWeight: 700, fontSize: 12 }}>{p.priority}</td>
              <td style={td}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 54, height: 6, borderRadius: 4, background: 'var(--crm-w10)', overflow: 'hidden' }}>
                    <div style={{ width: `${p.progress}%`, height: '100%', background: 'var(--crm-red)' }} />
                  </div>
                  <span style={{ fontSize: 11.5, color: 'var(--crm-w50)', fontWeight: 600 }}>{p.progress}%</span>
                </div>
              </td>
              <td style={{ ...td, color: isOverdue(p) ? 'var(--crm-red)' : 'var(--crm-w55)', fontWeight: isOverdue(p) ? 700 : 500 }}>
                {day(p.end_date)}
              </td>
              <td style={td}>
                <button
                  onClick={(e) => { e.stopPropagation(); onArchive(p, !p.archived); }}
                  style={{ ...btn, padding: '4px 9px', fontSize: 11.5 }}
                >{p.archived ? 'Restore' : 'Archive'}</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
const td = { padding: '11px 14px', borderBottom: '1px solid var(--crm-w05)', fontSize: 13, color: 'var(--crm-w72)', verticalAlign: 'middle' };

/** Drag a card to change its status. */
function Board({ rows, onEdit, onMove }) {
  const [over, setOver] = useState(null);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${STATUSES.length}, minmax(190px, 1fr))`, gap: 10, alignItems: 'start', overflowX: 'auto' }}>
      {STATUSES.map((st) => {
        const items = rows.filter((p) => p.status === st);
        return (
          <div
            key={st}
            onDragOver={(e) => { e.preventDefault(); setOver(st); }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => {
              e.preventDefault(); setOver(null);
              const id = Number(e.dataTransfer.getData('text/plain'));
              const p = rows.find((r) => r.id === id);
              if (p) onMove(p, st);
            }}
            style={{
              ...card, background: 'var(--crm-w04)', padding: 10,
              outline: over === st ? '2px dashed var(--crm-red)' : 'none', outlineOffset: -3,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '2px 2px 10px', fontSize: 12, fontWeight: 700, color: 'var(--crm-ink)' }}>
              <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLOR[st] }} />
              {st}
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--crm-w45)' }}>{items.length}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 16 }}>
              {items.map((p) => (
                <div
                  key={p.id}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData('text/plain', String(p.id))}
                  onClick={() => onEdit(p)}
                  style={{ ...card, padding: '10px 11px', cursor: 'grab' }}
                >
                  <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--crm-ink)', marginBottom: 4 }}>{p.name}</div>
                  {p.description && <div style={{ fontSize: 11.5, color: 'var(--crm-w50)', lineHeight: 1.45, marginBottom: 8, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.description}</div>}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5 }}>
                    <span style={{ color: 'var(--crm-w50)' }}>{p.owner || 'Unassigned'}</span>
                    {isOverdue(p) && <Badge status="Overdue" />}
                    <span style={{ marginLeft: 'auto', color: PRIORITY_COLOR[p.priority], fontWeight: 700 }}>{p.priority}</span>
                  </div>
                </div>
              ))}
              {!items.length && <div style={{ fontSize: 11.5, color: 'var(--crm-w35)', padding: '6px 2px' }}>Nothing here</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Editor({ project, onCancel, onSave, onDelete, owners, busy }) {
  const [f, setF] = useState(() => ({
    id: project.id, name: project.name || '', client: project.client || '',
    owner: project.owner || '', description: project.description || '',
    status: project.status || 'Not Started', priority: project.priority || 'Medium',
    progress: project.progress ?? 0, risk: project.risk || 'Medium',
    start_date: project.start_date ? String(project.start_date).slice(0, 10) : '',
    end_date: project.end_date ? String(project.end_date).slice(0, 10) : '',
    budget: project.budget ?? 0, cost: project.cost ?? 0, revenue: project.revenue ?? 0,
    category: project.category || '', tags: (project.tags || []).join(', '),
    notes: project.notes || '',
  }));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
      style={{
        position: 'fixed', inset: 0, background: 'var(--crm-overlay)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 24,
      }}
    >
      <div style={{ ...card, background: 'var(--crm-surface)', width: '100%', maxWidth: 620, maxHeight: '88vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
          <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--crm-ink)' }}>
            {f.id ? 'Edit project' : 'New project'}
          </span>
          <button onClick={onCancel} style={{ ...btn, marginLeft: 'auto' }}>Close</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <F label="Project name" full><input value={f.name} onChange={set('name')} style={field} autoFocus /></F>
          <F label="Client"><input value={f.client} onChange={set('client')} style={field} /></F>
          <F label="Owner">
            <input value={f.owner} onChange={set('owner')} list="proj-owners" style={field} />
            <datalist id="proj-owners">{owners.map((o) => <option key={o} value={o} />)}</datalist>
          </F>
          <F label="What needs to happen" full>
            <textarea value={f.description} onChange={set('description')} style={{ ...field, minHeight: 64, resize: 'vertical' }} />
          </F>
          <F label="Status"><select value={f.status} onChange={set('status')} style={field}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select></F>
          <F label="Priority"><select value={f.priority} onChange={set('priority')} style={field}>{PRIORITIES.map((s) => <option key={s}>{s}</option>)}</select></F>
          <F label="Progress %"><input type="number" min="0" max="100" value={f.progress} onChange={set('progress')} style={field} /></F>
          <F label="Risk"><select value={f.risk} onChange={set('risk')} style={field}>{RISKS.map((s) => <option key={s}>{s}</option>)}</select></F>
          <F label="Start"><input type="date" value={f.start_date} onChange={set('start_date')} style={field} /></F>
          <F label="End"><input type="date" value={f.end_date} onChange={set('end_date')} style={field} /></F>
          <F label="Budget"><input type="number" min="0" value={f.budget} onChange={set('budget')} style={field} /></F>
          <F label="Cost"><input type="number" min="0" value={f.cost} onChange={set('cost')} style={field} /></F>
          <F label="Revenue"><input type="number" min="0" value={f.revenue} onChange={set('revenue')} style={field} /></F>
          <F label="Category"><input value={f.category} onChange={set('category')} style={field} /></F>
          <F label="Tags (comma separated)" full><input value={f.tags} onChange={set('tags')} style={field} /></F>
          <F label="Notes" full><textarea value={f.notes} onChange={set('notes')} style={{ ...field, minHeight: 56, resize: 'vertical' }} /></F>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 16, alignItems: 'center' }}>
          {f.id && (
            confirmDelete ? (
              <>
                <span style={{ fontSize: 12, color: 'var(--crm-red)' }}>
                  Delete permanently? Archive keeps it and can be undone.
                </span>
                <button onClick={() => onDelete(project)} style={{ ...btn, color: 'var(--crm-red)', borderColor: 'var(--crm-red)' }}>Yes, delete</button>
                <button onClick={() => setConfirmDelete(false)} style={btn}>Keep it</button>
              </>
            ) : (
              // Delete is for a row typed by mistake. Archive is the button on
              // the board, and it says so right here rather than in a manual.
              <button onClick={() => setConfirmDelete(true)} style={{ ...btn, color: 'var(--crm-red)' }}>Delete…</button>
            )
          )}
          <button onClick={onCancel} style={{ ...btn, marginLeft: 'auto' }}>Cancel</button>
          <button
            onClick={() => onSave({ ...f, tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean) })}
            disabled={busy || !f.name.trim()}
            style={{ ...btn, borderColor: 'var(--crm-red)', color: 'var(--crm-red)', opacity: busy || !f.name.trim() ? 0.5 : 1 }}
          >{busy ? 'Saving…' : 'Save project'}</button>
        </div>
      </div>
    </div>
  );
}

function F({ label, children, full }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5, gridColumn: full ? '1 / -1' : undefined }}>
      <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--crm-w50)' }}>{label}</span>
      {children}
    </label>
  );
}
