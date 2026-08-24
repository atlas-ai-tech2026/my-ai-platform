// ─── edit-agent-live-reply.test.js ───────────────────────────────────────────
// A REAL reply from the real provider, kept as a fixture.
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────────
// Every other test of the agent feeds it a reply I wrote myself. That proves
// the parser handles what I IMAGINED a model would send, which is a different
// and much easier question than whether it handles what gemini-2.5-flash on
// kie.ai actually sends.
//
// The whole of #76 was three wrong guesses in a row about a provider's
// behaviour — the model id, the URL shape, and the protocol — each of which
// looked fine until something real disagreed. So the moment a real reply
// existed, it went in the repo.
//
// Captured 2026-08-24 by calling llm.js with the production AGENT_SYSTEM
// prompt and the timeline below. Verbatim, including the spacing. Cost: 0.01
// credits.
//
// If a future model swap makes the assistant behave oddly, this is the
// baseline: run the same instruction and compare.

import { describe, it, expect } from 'vitest';
import { parseAgentReply, applyCommands } from './edit-agent.js';

/** The exact project sent to the model. */
const PROJECT = {
  duration: 20,
  tracks: [
    { name: 'Video 1', kind: 'video', clips: [
      { id: 'c1', name: 'racing car', start: 0, end: 8 },
      { id: 'c2', name: 'castle', start: 8, end: 20 }] },
    { name: 'Audio 1', kind: 'audio', clips: [{ id: 'a1', name: 'music bed', start: 0, end: 20 }] },
  ],
};

/** Instruction: "delete the castle clip and mute the music".
 *  Reply, byte for byte, in 2430ms. */
const LIVE_REPLY =
  '{"reply": "I have deleted the castle clip and muted the music track for you.", '
  + '"commands": [{"op": "delete", "clipId": "c2"}, {"op": "setVolume", "clipId": "a1", "volume": 0}]}';

describe('a real reply from gemini-2.5-flash on kie.ai', () => {
  it('parses without a fence, without preamble, without repair', () => {
    // Models wrap JSON in ```json fences more often than not, and the parser
    // handles that. This one did not need it — worth knowing, because it means
    // the strict-output instruction in AGENT_SYSTEM is landing.
    const parsed = parseAgentReply(LIVE_REPLY);
    expect(parsed.reply).toMatch(/deleted the castle clip/);
    expect(parsed.commands).toHaveLength(2);
  });

  it('resolved the clips BY NAME to the right ids', () => {
    // The actual intelligence being bought. "the castle clip" had to become
    // c2 and "the music" a1, from names alone.
    const { commands } = parseAgentReply(LIVE_REPLY);
    expect(commands[0]).toMatchObject({ op: 'delete', clipId: 'c2' });
    expect(commands[1]).toMatchObject({ op: 'setVolume', clipId: 'a1', volume: 0 });
  });

  it('uses only ops the executor actually implements', () => {
    // The failure this guards is a model inventing a plausible verb —
    // "removeClip", "silence" — that the client would refuse at apply time,
    // leaving the customer told it worked when nothing happened.
    const { commands } = parseAgentReply(LIVE_REPLY);
    const result = applyCommands(PROJECT, commands, {
      permissions: { localEdits: true },
    });
    expect(result.error, result.error || '').toBeFalsy();
  });

  it('actually removes the castle clip and silences the music', () => {
    // Verify the EFFECT, not that the command list looked right.
    const { commands } = parseAgentReply(LIVE_REPLY);
    const { project } = applyCommands(PROJECT, commands, { permissions: { localEdits: true } });
    const video = project.tracks.find((t) => t.name === 'Video 1');
    const audio = project.tracks.find((t) => t.name === 'Audio 1');
    expect(video.clips.map((c) => c.id), 'castle should be gone').toEqual(['c1']);
    expect(audio.clips[0].volume).toBe(0);
  });

  it('leaves the original project untouched', () => {
    const { commands } = parseAgentReply(LIVE_REPLY);
    applyCommands(PROJECT, commands, { permissions: { localEdits: true } });
    expect(PROJECT.tracks[0].clips).toHaveLength(2);
  });
});
