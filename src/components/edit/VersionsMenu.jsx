// ─── VersionsMenu.jsx ────────────────────────────────────────────────────────
// `Versions (⌘S)` in the header, matching ChatCut's own label.
//
// ── WHY RESTORING IS ONE UNDO ──────────────────────────────────────────────
// Coming back to a version replaces the whole timeline, which is the single
// most destructive thing this editor can do to twenty minutes of work. So it
// goes through the same commit path as every other edit: ⌘Z puts it back.
//
// The alternative — a confirmation dialog — is worse. It stops you every time
// including the nineteen times you meant it, and it still cannot help once you
// have clicked Yes. Undo helps in exactly the case that matters.
//
// ── AND WHY IT SAYS THE VERSIONS ARE LOCAL ─────────────────────────────────
// They live in this browser. Somebody who assumes their save points follow
// them to another machine and finds out when they need one has been misled by
// silence, so the panel says it plainly and quietly.

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { History, Save, Trash2, RotateCcw } from 'lucide-react';
import Tip from './Tip';
import { listVersions, saveVersion, restoreVersion, deleteVersion, describeVersion, MAX_VERSIONS } from '@/lib/versions';

// forwardRef because ⌘S drives the same save() this menu's button calls. A
// plain function component silently ignores `ref`, so the shortcut would have
// done nothing at all — working button, dead keyboard, no error anywhere.
const VersionsMenu = forwardRef(function VersionsMenu({ projectId, project, onRestore, onNotice }, ref) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState([]);
  const rootRef = useRef(null);

  const refresh = () => setList(listVersions(projectId));

  useEffect(() => { if (open) refresh(); }, [open, projectId]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!rootRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const save = () => {
    const r = saveVersion(projectId, project);
    // Both outcomes are said out loud. A save point somebody believes exists
    // and does not is worse than having none, because they stop keeping their
    // own copies.
    if (r.ok) onNotice?.(`Version saved — ${r.version.label}`, 'ok');
    else onNotice?.(r.reason, 'error');
    refresh();
    return r.ok;
  };

  useImperativeHandle(ref, () => ({ save }));

  const restore = (id) => {
    const p = restoreVersion(projectId, id);
    if (!p) { onNotice?.('That version could not be read.', 'error'); return; }
    onRestore?.(p);
    setOpen(false);
    onNotice?.('Restored. Press ⌘Z if that was not what you meant.', 'ok');
  };

  return (
    <span ref={rootRef} className="relative">
      {/* side="bottom" because this button lives in the editor's TOP row.
          Upwards it lands inside the site nav, which is fixed and was winning
          the paint order — the tooltip was there at full opacity and simply
          could not be seen. Every other control in this row already knew. */}
      <Tip label={`Versions (⌘S) — ${list.length || 'no'} saved`} side="bottom">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label="Versions"
          aria-expanded={open}
          data-testid="versions-open"
          className="p-2 rounded text-foreground-muted hover:text-white hover:bg-background-elevated"
        >
          <History className="w-4 h-4" />
        </button>
      </Tip>

      {open && (
        <div
          role="menu"
          data-testid="versions-menu"
          className="absolute right-0 top-full mt-1 z-50 w-72 rounded-lg border border-border bg-background-elevated shadow-xl py-1 text-sm"
        >
          <div className="px-3 py-1 flex items-center justify-between">
            <span className="text-[10px] tracking-widest text-foreground-muted">VERSIONS</span>
            <span className="text-[10px] text-foreground-muted">{list.length}/{MAX_VERSIONS}</span>
          </div>

          <Tip label="Take a snapshot of the timeline as it is now" fill>
            <button
              type="button"
              onClick={save}
              data-testid="versions-save"
              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-background text-left text-foreground"
            >
              <Save className="w-3.5 h-3.5 text-foreground-muted" />
              Save this version
              <span className="ml-auto text-[10px] text-foreground-muted">⌘S</span>
            </button>
          </Tip>

          <div className="my-1 border-t border-border" />

          <div className="max-h-64 overflow-y-auto">
            {list.length === 0 && (
              <p className="px-3 py-2 text-xs text-foreground-muted">
                No versions yet. Save one before you try something you might want
                to undo later.
              </p>
            )}

            {list.map((v) => {
              const d = describeVersion(v);
              return (
                <div key={v.id} className="group/row flex items-center gap-1 px-1">
                  <Tip label={`Go back to “${v.label}” — ${d.summary}`} fill>
                    <button
                      type="button"
                      onClick={() => restore(v.id)}
                      data-testid={`version-${v.id}`}
                      className="flex-1 min-w-0 flex items-center gap-2 px-2 py-1.5 rounded hover:bg-background text-left"
                    >
                      <RotateCcw className="w-3.5 h-3.5 shrink-0 text-foreground-muted" />
                      <span className="min-w-0">
                        <span className="block truncate text-foreground">{v.label}</span>
                        <span className="block text-[11px] text-foreground-muted">{d.summary}</span>
                      </span>
                    </button>
                  </Tip>
                  <Tip label={`Delete “${v.label}”`}>
                    <button
                      type="button"
                      onClick={() => { setList(deleteVersion(projectId, v.id)); }}
                      aria-label={`Delete ${v.label}`}
                      data-testid={`version-delete-${v.id}`}
                      className="p-1.5 rounded text-foreground-muted hover:text-primary opacity-0 group-hover/row:opacity-100"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </Tip>
                </div>
              );
            })}
          </div>

          <div className="my-1 border-t border-border" />
          {/* Said plainly rather than discovered. */}
          <p className="px-3 py-1.5 text-[10px] text-foreground-muted">
            Kept in this browser — they do not follow you to another machine.
          </p>
        </div>
      )}
    </span>
  );
});

export default VersionsMenu;
