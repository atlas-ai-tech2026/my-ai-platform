// ─── points-at-the-right-screen.test.jsx ─────────────────────────────────────
// ☠ A SCREEN THAT SENDS YOU SOMEWHERE THE ENTRIES ARE NOT.
//
// The Bulk credit panels told the owner his reason was "what the Manual
// Credits screen and any invoice will show". It is not. Both Bulk paths record
// source 'bulk', and Manual Credits deliberately shows only source 'manual' —
// credits typed one at a time on the Users tab. He would have topped up 71
// accounts, gone to look, and found an empty table.
//
// I wrote that text AND said the same thing to him in chat, then found it by
// checking before he did. Wrong instructions in an interface are worse than in
// a message: a message is read once, a label is trusted forever.
//
// This checks the copy names the screen the entries actually land on.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (f) => readFileSync(resolve(process.cwd(), 'src/components/admin', f), 'utf8');
const server = readFileSync(resolve(process.cwd(), 'server/src/index.js'), 'utf8');

describe('☠ THE BULK PANELS NAME THE SCREEN THE ENTRIES REACH', () => {
  it('both bulk paths still record source bulk — the premise of this test', () => {
    // If either ever became 'manual', the copy below would need to change back.
    expect(server).toMatch(/source: 'bulk',/);                       // the top-up
    expect(server).toMatch(/'grant', \$3, \$4, 'bulk'\)/);           // provisioning
  });

  it('the Manual Credits screen shows only manual', () => {
    expect(read('ManualCreditsTab.jsx')).toMatch(/source: 'manual'/);
  });

  it.each(['BulkCreditsPanel.jsx', 'BulkTab.jsx'])(
    '%s does not promise Manual Credits without saying it is NOT there', (file) => {
      const src = read(file);
      for (const line of src.split('\n')) {
        if (!/Manual Credits/.test(line)) continue;
        expect(line,
          `${file} mentions Manual Credits without saying the entries are NOT on it. `
          + `Bulk writes source 'bulk'; that screen shows only 'manual'. Point at Logs instead.`)
          .toMatch(/not on Manual Credits|NOT Manual Credits/i);
      }
    });

  it('and they point at Logs, which is where a bulk batch actually appears', () => {
    expect(read('BulkCreditsPanel.jsx')).toMatch(/Logs/);
    expect(read('BulkTab.jsx')).toMatch(/SYSTEM \\u2192 Logs|SYSTEM → Logs/);
  });
});
