// ─── edit-agent-contract.test.js ─────────────────────────────────────────────
// The agent's vocabulary is written down in two places that cannot import each
// other at runtime:
//
//   src/lib/edit-agent.js            what the browser can actually EXECUTE
//   server/src/edit-agent-prompt.js  what the model is TOLD it can ask for
//
// They are separate because the server must not import a browser module, and
// the browser must not ship a server one. That separation is fine. Letting
// them drift is not, and drifting is silent in both directions:
//
//   · executor knows it, model never told   → the feature looks broken to a
//                                             customer who asks for it
//   · model told, executor cannot run it    → refused every single time, which
//                                             looks exactly the same
//
// Neither throws. Neither shows up in any other test. Hence this file.

import { describe, it, expect } from 'vitest';
import { COMMAND_NAMES, RESPONSE_SCHEMA } from './edit-agent';
import { AGENT_OPS, AGENT_SYSTEM } from '../../server/src/edit-agent-prompt.js';

describe('the model is offered exactly what the browser can run', () => {
  it('the two lists match', () => {
    expect([...AGENT_OPS].sort()).toEqual([...COMMAND_NAMES].sort());
  });

  it('every command is actually SPELLED OUT in the prompt, not just listed', () => {
    // A name in AGENT_OPS that never appears in the prompt text is a command
    // the model has no idea exists — the array would agree and the feature
    // still would not work.
    const missing = AGENT_OPS.filter((op) => !AGENT_SYSTEM.includes(`"op":"${op}"`));
    expect(missing, `not described to the model: ${missing.join(', ')}`).toEqual([]);
  });

  it('the JSON schema the browser validates against agrees too', () => {
    expect(RESPONSE_SCHEMA.properties.commands.items.properties.op.enum.sort())
      .toEqual([...AGENT_OPS].sort());
  });

  it('the prompt tells the model the one thing it cannot work out for itself', () => {
    // It cannot reference a clip a previous command created — the id does not
    // exist until the batch runs. Without this line the model reaches for
    // split-then-delete, which is the natural spelling and always fails.
    expect(AGENT_SYSTEM).toMatch(/CANNOT split and then\s+refer to the new piece/);
  });

  it('the prompt forbids inventing ids', () => {
    expect(AGENT_SYSTEM).toMatch(/Never invent one/i);
  });
});
