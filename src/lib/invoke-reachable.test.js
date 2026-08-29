// ─── invoke-reachable.test.js ────────────────────────────────────────────────
// EVERY ROUTE THE APP CALLS THROUGH `invoke` MUST ACCEPT POST.
//
// ── THE BUG, WHICH HAPPENED TODAY ──────────────────────────────────────────
// base44Client's `functions.invoke` is the browser's only way to call an API
// function, and it ALWAYS posts:
//
//     const res = await api.post(`/api/${funcName}`, params);
//
// /api/history/models was registered as a GET. So the call 404'd, the client
// swallowed the failure into an empty list, the model dropdown rendered
// disabled — and it looked like the customer had used no models rather than
// like a broken route. Amr found it by trying to open the dropdown.
//
// That is the SIXTH time in one day that "built and deployed" meant
// "unreachable": five admin endpoints with no button, a thumbnail field
// nothing read, and now a verb mismatch. The pattern is always the same — two
// halves that are each correct and were never checked together.
//
// So this reads both halves. Every `invoke('x')` in the front end must find a
// route in the server that accepts POST on `/api/x`.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '../..');
const server = fs.readFileSync(path.join(root, 'server/src/index.js'), 'utf8');

/** Every function name the front end calls through invoke(). */
function invoked() {
  const names = new Set();
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!/\.(js|jsx)$/.test(e.name) || e.name.includes('.test.')) continue;
      const src = fs.readFileSync(full, 'utf8');
      for (const m of src.matchAll(/invoke\(\s*['"]([^'"]+)['"]/g)) names.add(m[1]);
    }
  };
  walk(path.join(root, 'src'));
  return [...names];
}

/** Does the server accept POST on this path? */
function acceptsPost(name) {
  const p = `/api/${name}`;
  // app.post('/api/x'  — or  app.all(['/api/x']  with a POST branch.
  if (server.includes(`app.post('${p}'`)) return true;
  const all = server.indexOf(`app.all(['${p}']`);
  if (all >= 0) return /req\.method !== 'POST'|'POST'/.test(server.slice(all, all + 300));
  return false;
}

describe('the client only knows how to POST', () => {
  it('and that is still true — if invoke changes, this test must too', () => {
    const client = fs.readFileSync(path.join(root, 'src/api/base44Client.js'), 'utf8');
    const at = client.indexOf('async invoke(');
    expect(at, 'invoke is gone or renamed').toBeGreaterThan(0);
    expect(client.slice(at, at + 200)).toMatch(/api\.post\(/);
  });
});

describe('every invoked function exists as a POST route', () => {
  const names = invoked();

  it('finds the call sites at all', () => {
    expect(names.length, 'nothing calls invoke — this guard is watching nothing').toBeGreaterThan(2);
  });

  it.each(names.map((n) => [n]))('invoke("%s") reaches a route that accepts POST', (name) => {
    expect(
      acceptsPost(name),
      `The app calls invoke('${name}') — which POSTs to /api/${name} — and no route accepts POST there. `
      + 'The call will 404 and the failure will be swallowed into an empty result, which reads as '
      + '"no data" rather than "broken". Register app.post, or app.all with a POST branch.',
    ).toBe(true);
  });
});

describe('the three that shipped unreachable today stay reachable', () => {
  it.each([
    ['the model list — found disabled by Amr', 'history/models'],
    ['history search', 'history/search'],
    ['recently deleted', 'history/deleted'],
  ])('%s', (_label, name) => {
    expect(acceptsPost(name)).toBe(true);
  });
});
