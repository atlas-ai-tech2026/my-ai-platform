// ─── edit-agent.test.js ──────────────────────────────────────────────────────
// This file guards the one place in the editor where something that cannot be
// trusted gets to touch a customer's work.
//
// The tests that matter are NOT "does split split". They are the ways a wrong
// answer from a model could look like a successful edit:
//
//   · a clip id that does not exist — timeline.js returns the project
//     unchanged and says nothing, so the customer would be told "done"
//   · a locked track — same silence, from a different function
//   · a batch that fails halfway — leaving a timeline matching neither what
//     they had nor what they asked for
//   · an op nobody implemented — skipped quietly is an edit they think happened
//
// Every one of those is a LIE told to the customer, not a crash. Crashes get
// noticed.

import { describe, it, expect } from 'vitest';
import {
  createProject, createClip, addClip, addSource, __resetIds, locateClip, clipDuration, projectDuration,
} from './timeline';
import {
  applyCommands, summarise, parseAgentReply, COMMAND_NAMES, RESPONSE_SCHEMA, MAX_COMMANDS,
} from './edit-agent';

/** A project with two 10s shots back to back on the video track. */
function fixture() {
  __resetIds();
  let p = createProject({ name: 'Test' });
  p = addSource(p, { id: 's1', url: 'https://x/a.mp4', prompt: 'a dragon over a castle', duration: 10 });
  p = addSource(p, { id: 's2', url: 'https://x/b.mp4', prompt: 'a quiet street at dawn', duration: 10 });
  const [video] = p.tracks;
  p = addClip(p, video.id, createClip({ kind: 'video', sourceId: 's1', start: 0, in: 0, out: 10, name: 'Dragon' }));
  p = addClip(p, video.id, createClip({ kind: 'video', sourceId: 's2', start: 10, in: 0, out: 10, name: 'Street' }));
  const ids = p.tracks[0].clips.map((c) => c.id);
  return { p, videoTrack: p.tracks[0].id, audioTrack: p.tracks[1].id, a: ids[0], b: ids[1] };
}

describe('an edit that cannot happen is REFUSED, not silently skipped', () => {
  it('refuses a clip id that does not exist', () => {
    // removeClip is `clips.filter(c => c.id !== clipId)`. Hand it an invented
    // id and it returns the project, unchanged, with no error at all — the
    // customer would be told the clip was deleted.
    const { p } = fixture();
    const r = applyCommands(p, [{ op: 'delete', clipId: 'c-nope' }]);

    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no clip called c-nope/i);
    expect(r.project, 'the project should come back untouched').toBe(p);
  });

  it('refuses to cut a LOCKED track instead of pretending it worked', () => {
    // splitClip skips locked tracks silently. Different function, same lie.
    const { p, a } = fixture();
    const locked = { ...p, tracks: p.tracks.map((t, i) => (i === 0 ? { ...t, locked: true } : t)) };

    const r = applyCommands(locked, [{ op: 'split', clipId: a, at: 5 }]);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/locked/i);
  });

  it('refuses a cut that lands on a clip edge, and says where the clip actually is', () => {
    // splitClip declines a cut within a frame of either edge — silently.
    const { p, a } = fixture();
    const r = applyCommands(p, [{ op: 'split', clipId: a, at: 0 }]);

    expect(r.ok).toBe(false);
    expect(r.error, 'the reason should name the real range').toMatch(/runs from 0s to 10s/);
  });

  it('refuses a trim that would erase the clip rather than leaving a sliver', () => {
    // trimClip CLAMPS. Asking to trim 30s off a 10s clip leaves a one-frame
    // fragment and reports success — "it did something, but not what you said".
    const { p, a } = fixture();
    const r = applyCommands(p, [{ op: 'trim', clipId: a, edge: 'end', seconds: 30 }]);

    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/only 10s long/);
    expect(r.project).toBe(p);
  });

  it('names an op it does not know instead of ignoring it', () => {
    const { p } = fixture();
    const r = applyCommands(p, [{ op: 'colourGrade', clipId: 'c1' }]);

    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/colourGrade/);
    expect(r.applied).toEqual([]);
  });

  it('refuses a runaway batch rather than applying forty edits nobody asked for', () => {
    const { p, a } = fixture();
    const many = Array.from({ length: MAX_COMMANDS + 1 }, () => ({ op: 'delete', clipId: a }));
    const r = applyCommands(p, many);

    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/more than this will apply at once/);
  });

  it('refuses an empty instruction', () => {
    const { p } = fixture();
    expect(applyCommands(p, []).ok).toBe(false);
    expect(applyCommands(p, null).ok).toBe(false);
  });
});

describe('a batch is all or nothing', () => {
  it('a failure at step 2 leaves the timeline exactly as it was', () => {
    // The half-applied edit is the worst outcome: the customer is holding a
    // timeline matching neither what they had nor what they asked for, and
    // has to work out which half happened.
    const { p, a } = fixture();
    const r = applyCommands(p, [
      { op: 'split', clipId: a, at: 5 },        // would succeed
      { op: 'delete', clipId: 'c-invented' },   // fails
    ]);

    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/^Step 2 of 2/);
    expect(r.project, 'the split from step 1 was left behind').toBe(p);
    expect(r.project.tracks[0].clips).toHaveLength(2);
  });

  it('CANNOT name a clip an earlier command created — which is why removeRange exists', () => {
    // This test is why removeRange was written. The obvious spelling of
    // "cut out 5s to 10s" is split → split → delete the middle, and it is
    // IMPOSSIBLE: the middle piece gets its id when the split runs, and the
    // whole batch has to be written before any of it is applied. A model
    // guessing that id is a model naming a clip that does not exist.
    //
    // Left as a test rather than a comment so nobody re-adds the capability
    // by guessing ids and calls it fixed.
    const { p, a } = fixture();
    const guessed = applyCommands(p, [
      { op: 'split', clipId: a, at: 5 },
      { op: 'delete', clipId: 'c99' },   // any guess at the new half
    ]);
    expect(guessed.ok).toBe(false);
    expect(guessed.error).toMatch(/no clip called c99/i);
  });

  it('removeRange does in ONE command what could not be said in three', () => {
    const { p, videoTrack } = fixture();
    // Two 10s shots, 0-20. Take out 5s to 15s and pull the rest up.
    const r = applyCommands(p, [{ op: 'removeRange', trackId: videoTrack, from: 5, to: 15 }]);

    expect(r.ok, r.error).toBe(true);
    const clips = r.project.tracks[0].clips;
    expect(clips).toHaveLength(2);
    expect(clips[0].start).toBe(0);
    expect(clips[0].end ?? clipDuration(clips[0])).toBeCloseTo(5, 3);
    // Rippled: the survivor moved up to meet the cut instead of leaving a hole.
    expect(clips[1].start).toBeCloseTo(5, 3);
    expect(projectDuration(r.project)).toBeCloseTo(10, 3);
  });

  it('removeRange can leave the hole when the pause was deliberate', () => {
    const { p, videoTrack } = fixture();
    const r = applyCommands(p, [{ op: 'removeRange', trackId: videoTrack, from: 5, to: 15, ripple: false }]);

    expect(r.ok, r.error).toBe(true);
    expect(r.project.tracks[0].clips[1].start).toBeCloseTo(15, 3);
    expect(projectDuration(r.project)).toBeCloseTo(20, 3);
  });

  it('removeRange refuses a range with nothing in it', () => {
    const { p, videoTrack } = fixture();
    const r = applyCommands(p, [{ op: 'removeRange', trackId: videoTrack, from: 40, to: 50 }]);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/nothing between 40s and 50s/);
  });

  it('reports what it did, in order, so the chat can show it', () => {
    const { p, a } = fixture();
    const r = applyCommands(p, [
      { op: 'setSpeed', clipId: a, speed: 2 },
      { op: 'rename', clipId: a, name: 'Fast dragon' },
    ]);

    expect(r.ok).toBe(true);
    expect(r.applied).toHaveLength(2);
    expect(r.applied[1]).toMatch(/Fast dragon/);
  });
});

describe('the edits themselves land', () => {
  it('split produces two clips that meet exactly', () => {
    const { p, a } = fixture();
    const r = applyCommands(p, [{ op: 'split', clipId: a, at: 4 }]);
    const clips = r.project.tracks[0].clips;

    expect(clips).toHaveLength(3);
    expect(clips[0].start).toBe(0);
    expect(clips[1].start).toBe(4);
    // No gap, no overlap — a rounding error here is a one-frame flash on export.
    expect(clips[0].out).toBe(clips[1].in);
  });

  it('trimming the start moves the clip so it does not slide the wrong way', () => {
    const { p, a } = fixture();
    const before = clipDuration(locateClip(p, a).clip);
    const r = applyCommands(p, [{ op: 'trim', clipId: a, edge: 'start', seconds: 2 }]);

    expect(r.ok, r.error).toBe(true);
    expect(clipDuration(locateClip(r.project, a).clip)).toBeCloseTo(before - 2, 3);
  });

  it('setRatio refuses the shape it is already on rather than adding an undo step', () => {
    const { p } = fixture();
    expect(applyCommands(p, [{ op: 'setRatio', ratio: '16:9' }]).error).toMatch(/already 16:9/);
    expect(applyCommands(p, [{ op: 'setRatio', ratio: '9:16' }]).project.ratio).toBe('9:16');
  });

  it('setRatio rejects a shape that is not offered, listing the ones that are', () => {
    const { p } = fixture();
    const r = applyCommands(p, [{ op: 'setRatio', ratio: '21:9' }]);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/9:16/);
  });

  it('rejects a speed that would make a clip infinite or negative', () => {
    const { p, a } = fixture();
    for (const speed of [0, -1, 50]) {
      expect(applyCommands(p, [{ op: 'setSpeed', clipId: a, speed }]).ok, `speed ${speed}`).toBe(false);
    }
  });

  it('rejects fades longer than the clip they are on', () => {
    const { p, a } = fixture();
    const r = applyCommands(p, [{ op: 'fade', clipId: a, in: 8, out: 8 }]);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/add up to longer/);
  });
});

describe('what the agent is shown', () => {
  it('carries ids, times and the PROMPT that made each shot', () => {
    // "Delete the castle one" only works if the prompt is visible.
    const { p, a } = fixture();
    const s = summarise(p);

    expect(s.duration).toBe(20);
    expect(s.ratio).toBe('16:9');
    const clip = s.tracks[0].clips.find((c) => c.id === a);
    expect(clip.prompt).toMatch(/dragon/);
    expect(clip.start).toBe(0);
    expect(clip.end).toBe(10);
  });

  it('does not ship source urls to the model', () => {
    // They are long, they are signed, they cost tokens on every message, and
    // nothing about choosing where to cut needs them.
    const { p } = fixture();
    expect(JSON.stringify(summarise(p))).not.toMatch(/https?:/);
  });

  it('shows the holes, because they are what somebody usually wants closed', () => {
    const { p, b, videoTrack } = fixture();
    const moved = applyCommands(p, [{ op: 'move', clipId: b, start: 15 }]);
    const s = summarise(moved.project);

    const track = s.tracks.find((t) => t.id === videoTrack);
    expect(track.gaps).toEqual([{ start: 10, end: 15 }]);
  });

  it('survives being handed nothing', () => {
    expect(summarise(null).tracks).toEqual([]);
  });
});

describe('reading a model reply without trusting it', () => {
  it('takes a plain object', () => {
    expect(parseAgentReply({ reply: 'Done', commands: [{ op: 'delete', clipId: 'c1' }] }).commands).toHaveLength(1);
  });

  it('unwraps a ```json fence, which is what models actually send', () => {
    const raw = 'Sure!\n```json\n{"reply":"Cut it","commands":[{"op":"delete","clipId":"c3"}]}\n```';
    const r = parseAgentReply(raw);
    expect(r.reply).toBe('Cut it');
    expect(r.commands[0].clipId).toBe('c3');
  });

  it('treats prose as something to SAY, and touches nothing', () => {
    // A model answering a question rather than issuing an edit is normal, and
    // must not throw inside a chat panel or silently show an empty bubble.
    const r = parseAgentReply('I can help with that — which clip did you mean?');
    expect(r.reply).toMatch(/which clip/);
    expect(r.commands).toEqual([]);
  });

  it('never returns a non-array for commands, whatever it is handed', () => {
    for (const junk of [null, undefined, 42, [], '{"reply":"hi","commands":"nope"}']) {
      expect(Array.isArray(parseAgentReply(junk).commands), String(junk)).toBe(true);
    }
  });
});

describe('the schema and the vocabulary cannot drift apart', () => {
  it('every command the executor knows is offered to the model', () => {
    // A command added to COMMANDS without a schema entry is one the model is
    // never told about — the feature looks quietly broken rather than missing.
    expect(RESPONSE_SCHEMA.properties.commands.items.properties.op.enum).toEqual(COMMAND_NAMES);
  });
});
