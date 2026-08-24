// ─── AgentChat.jsx ───────────────────────────────────────────────────────────
// "Cut this to thirty seconds" — the part that makes this Edit CUT and not
// just another timeline.
//
// ── THE ONE RULE THIS COMPONENT FOLLOWS ────────────────────────────────────
// It never says an edit happened without showing WHAT happened. Every applied
// instruction lists the actual changes underneath the reply, because the model
// writes the reply and the model is the one thing here that can be confidently
// wrong. "Done!" with a list of three edits under it can be checked at a
// glance. "Done!" on its own has to be taken on trust, and a customer who
// takes it on trust once and finds their timeline wrong stops trusting the
// whole feature.
//
// A refusal is a MESSAGE, not a toast. It belongs in the conversation, it
// stays on screen, and it says which step failed and why — a toast that
// disappears after four seconds is the wrong shape for "step 2 of 3 could not
// be done, so nothing was changed".
//
// ── AND WHY THE TYPED TEXT SURVIVES A FAILURE ──────────────────────────────
// Clearing the box on send is right when it worked and infuriating when it
// did not. Somebody who typed two sentences and got a network error should not
// have to type them again to retry.

import React, { useEffect, useRef, useState } from 'react';
import { Sparkles, CornerDownLeft, AlertCircle, Check, Loader2 } from 'lucide-react';
import Tip from './Tip';
import { base44 } from '@/api/base44Client';
import { summarise, parseAgentReply, applyCommands } from '@/lib/edit-agent';

/** Openers, shown only on an empty conversation. Not a tutorial — three
 *  examples of the SHAPE of thing that works, which is faster to read than a
 *  paragraph explaining it. */
const EXAMPLES = [
  'Cut the first 3 seconds',
  'Make it vertical for Reels',
  'Remove the gap and speed the last clip up 2×',
];

export default function AgentChat({ project, onApply, disabled = false, disabledReason = '' }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);
  const boxRef = useRef(null);

  // Follow the conversation down as it grows — but only within this panel.
  // scrollIntoView on the element itself would scroll the whole editor and
  // move the timeline out from under the customer's cursor.
  useEffect(() => {
    const box = boxRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [messages, busy]);

  const say = (m) => setMessages((prev) => [...prev, m]);

  async function send(instruction) {
    const asked = instruction.trim();
    if (!asked || busy || disabled) return;

    say({ role: 'you', text: asked });
    setBusy(true);
    try {
      // Only a SUMMARY crosses the network — ids, times, gaps and prompts.
      // Never source urls: long, signed, and useless for deciding where to cut.
      const { data } = await base44.functions.invoke('edit-agent', {
        instruction: asked,
        timeline: summarise(project),
      });

      const { reply, commands } = parseAgentReply(data?.raw ?? data);

      if (!commands.length) {
        // A question, a clarification, or an answer to something that was not
        // an edit. All normal, and none of them should look like a failure.
        say({ role: 'agent', text: reply || 'I did not catch that — say it another way?' });
        setText('');
        return;
      }

      // THE FIREWALL. Checked against the real project, not the summary the
      // model was shown, and applied all-or-nothing.
      const result = applyCommands(project, commands);
      if (!result.ok) {
        say({ role: 'agent', text: reply, error: result.error });
        return;   // text deliberately kept, so it can be reworded and retried
      }

      // ONE undo step for the whole instruction. Seven internal operations
      // that take seven presses of Cmd+Z to reverse is not an undo, it is a
      // puzzle.
      onApply?.(result.project);
      say({ role: 'agent', text: reply, applied: result.applied });
      setText('');
    } catch (e) {
      // The server's own words where it has them — it knows things this
      // component does not, like being rate limited or missing a key.
      const server = e?.response?.data?.error;
      say({
        role: 'agent',
        error: server || e?.message || 'Could not reach the assistant. Nothing was changed.',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col min-h-0 flex-1" data-testid="agent-chat">
      {/* ── TRANSCRIPT ─────────────────────────────────────────────────── */}
      <div ref={boxRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-2">
        {messages.length === 0 && (
          <div className="text-[11px] text-foreground-muted space-y-2 pt-1">
            <p className="flex items-center gap-1.5 text-foreground-secondary">
              <Sparkles className="w-3 h-3 text-primary" /> Tell me what to change.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLES.map((e) => (
                <Tip key={e} label="Send this as an instruction"><button
                  type="button"
                  onClick={() => send(e)}
                  disabled={disabled}
                  aria-label={`Try: ${e}`}
                  data-testid={`example-${e.slice(0, 8)}`}
                  className="rounded-full border border-border px-2 py-1 text-[10px]
                    hover:border-primary hover:text-white disabled:opacity-40"
                >
                  {e}
                </button></Tip>
              ))}
            </div>
            <p className="pt-1 leading-relaxed">
              Every edit is one undo — press ⌘Z if it is not what you meant.
            </p>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} data-testid={`msg-${m.role}`} className="text-[11px] leading-relaxed">
            {m.role === 'you' ? (
              <p className="rounded-lg bg-background-elevated px-2.5 py-1.5 text-foreground-secondary">
                {m.text}
              </p>
            ) : (
              <div className="space-y-1.5">
                {m.text && <p className="text-white px-0.5">{m.text}</p>}

                {/* WHAT ACTUALLY CHANGED. The reply is written by the model;
                    this list is generated from what the executor really did. */}
                {m.applied?.length > 0 && (
                  <ul className="space-y-0.5 rounded-lg border border-border/60 px-2.5 py-1.5" data-testid="applied">
                    {m.applied.map((a, j) => (
                      <li key={j} className="flex items-start gap-1.5 text-foreground-muted">
                        <Check className="w-3 h-3 mt-0.5 shrink-0 text-primary" />
                        <span>{a}</span>
                      </li>
                    ))}
                  </ul>
                )}

                {m.error && (
                  <p
                    data-testid="agent-error"
                    className="flex items-start gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-2.5 py-1.5 text-foreground-secondary"
                  >
                    <AlertCircle className="w-3 h-3 mt-0.5 shrink-0 text-primary" />
                    <span>{m.error}</span>
                  </p>
                )}
              </div>
            )}
          </div>
        ))}

        {busy && (
          <p className="flex items-center gap-1.5 text-[11px] text-foreground-muted px-0.5" data-testid="agent-busy">
            <Loader2 className="w-3 h-3 animate-spin" /> Working it out…
          </p>
        )}
        <div ref={endRef} />
      </div>

      {/* ── COMPOSER ───────────────────────────────────────────────────────
          Bottom of the column, where ChatCut puts it and where a primary
          input belongs — always reachable without scrolling the transcript. */}
      <div className="border-t border-border p-2.5 shrink-0">
        {disabled ? (
          <p className="rounded-lg border border-border/60 px-3 py-2 text-[11px] text-foreground-muted">
            {disabledReason || 'Sign in to use the assistant.'}
          </p>
        ) : (
          <div className="flex items-end gap-1.5">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                // Enter sends; Shift+Enter is a newline. The editor keyboard
                // is full of single-key shortcuts (C splits, Delete deletes),
                // and isTyping() in useEditorShortcuts is what stops typing
                // "cut" here from cutting the timeline.
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(text); }
              }}
              rows={2}
              placeholder="Cut the first 3 seconds…"
              aria-label="Tell the assistant what to change"
              data-testid="agent-input"
              className="flex-1 min-w-0 resize-none rounded-lg border border-border bg-transparent px-2.5 py-2
                text-[11px] text-white placeholder:text-foreground-muted outline-none focus:border-primary"
            />
            <Tip label="Send (Enter)"><button
              type="button"
              onClick={() => send(text)}
              disabled={busy || !text.trim()}
              aria-label="Send"
              data-testid="agent-send"
              className="shrink-0 rounded-lg bg-primary p-2 text-white disabled:opacity-40"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CornerDownLeft className="w-3.5 h-3.5" />}
            </button></Tip>
          </div>
        )}
      </div>
    </div>
  );
}
