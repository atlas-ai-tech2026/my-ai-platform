// ─── projects-reachable.test.jsx ─────────────────────────────────────────────
// ☠ A NEW MODULE IS THE MOST LIKELY THING IN THIS CODEBASE TO BE UNREACHABLE.
//
// Three times this year a correct, tested piece of code shipped with nothing
// able to reach it: copyAndRecord() in the backup ledger, upsertTask() on the
// task board, acceptAdvisories() on the SOP tab. Each had passing unit tests.
//
// projects.js now has 29 of its own. This file asks the other question.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const web = (f) => readFileSync(join(here, '..', '..', f), 'utf8');
const server = (f) => readFileSync(join(here, '../../../server/src', f), 'utf8');

describe('☠ THE WHOLE CHAIN EXISTS', () => {
  it('1. the table is created by a migration', () => {
    const db = server('db.js');
    expect(db).toMatch(/CREATE TABLE IF NOT EXISTS projects/);
    // Before COMMIT, or it never runs.
    expect(db.indexOf('CREATE TABLE IF NOT EXISTS projects'))
      .toBeLessThan(db.indexOf("await client.query('COMMIT')"));
  });

  it('2. the routes are registered, and admin-gated', () => {
    const index = server('index.js');
    expect(index, 'registerProjectRoutes is imported but never called')
      .toMatch(/registerProjectRoutes\(app, \{ pool, dbReady, adminGate \}\)/);
    const routes = server('projects-routes.js');
    for (const verb of ['get', 'post', 'put', 'delete']) {
      expect(routes, `an ungated ${verb} route would show as CRITICAL on the SOP tab`)
        .toMatch(new RegExp(`app\\.${verb}\\('/api/admin/projects[^']*', adminGate`));
    }
  });

  it('3. the API client can call every one of them', () => {
    const api = web('lib/adminApi.js');
    for (const m of ['projects:', 'projectCreate:', 'projectUpdate:', 'projectArchive:', 'projectDelete:']) {
      expect(api, `${m} is missing — the screen cannot reach that route`).toMatch(m);
    }
  });

  it('4. ☠ AND THE TAB IS MOUNTED WHERE A PERSON CAN OPEN IT', () => {
    // The step every one of the three earlier bugs was missing.
    const panel = web('pages/AdminPanel.jsx');
    expect(panel, 'ProjectsTab is not imported').toMatch(/import ProjectsTab from/);
    expect(panel, "the tab is never rendered").toMatch(/tab === 'projects' && <ProjectsTab/);
    expect(panel, "there is no 'projects' entry in TABS, so no button exists")
      .toMatch(/\{ id: 'projects', label: 'Projects'/);
  });

  it('5. and it appears in the sidebar, not only in the registry', () => {
    // A tab absent from GROUPS falls through to "System", which is where you
    // look when a machine is wrong — not where you look for your own work.
    expect(web('components/admin/AdminNav.jsx')).toMatch(/'tasks', 'projects'/);
  });

  it('6. the tab actually calls the API rather than holding local state', () => {
    const tab = web('components/admin/ProjectsTab.jsx');
    expect(tab).toMatch(/adminApi\.projects\(/);
    expect(tab).toMatch(/adminApi\.projectCreate\(/);
    expect(tab).toMatch(/adminApi\.projectUpdate\(/);
    expect(tab).toMatch(/adminApi\.projectArchive\(/);
  });
});

describe('☠ IT IS NOT THE TASKS TABLE', () => {
  it('projects has its own table, and the seed never touches it', () => {
    // tasks is seeded from code and refreshed on every boot. Sharing a table
    // would mean my seed silently overwriting rows a person typed.
    expect(server('tasks-seed.js'), 'the task seed writes to projects')
      .not.toMatch(/INSERT INTO projects|UPDATE projects/);
  });

  it('and the board archives rather than deletes', () => {
    const tab = web('components/admin/ProjectsTab.jsx');
    // The row button must be Archive. Delete exists, but behind a confirmation
    // that explains the difference.
    expect(tab).toMatch(/\{p\.archived \? 'Restore' : 'Archive'\}/);
    expect(tab).toMatch(/Archive keeps it and can be undone/);
  });
});

describe('it wears this panel\'s clothes', () => {
  it('no colour from the sample survives — every one is a --crm token', () => {
    // The sample is oxblood on paper. A tab that looks like a different product
    // is one you stop trusting to tell you the truth about this one. (The
    // sweeping check is crmTheme.test.jsx; this is the specific one.)
    // Checked against the CODE, not the prose: the header comment names the
    // sample's palette on purpose, because why it is absent is the point.
    const code = web('components/admin/ProjectsTab.jsx')
      .split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
    expect(code).not.toMatch(/#600001|--oxblood|--paper|Iowan Old Style/);
  });
});
