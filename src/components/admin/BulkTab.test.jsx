// ─── BulkTab.test.jsx ────────────────────────────────────────────────────────
// This file exists because the Bulk upload had NO test coverage at all, and it
// is the one path on the platform that parses a file somebody else made.
//
// That is exactly what the SheetJS advisories were about — prototype pollution
// and a ReDoS, both while parsing. The library was replaced with exceljs on
// 2026-08-21, and until this file the parsing was trusted rather than verified.
// Security-relevant code with no tests is a promise, not a property.
//
// The realistic scenario is not an attacker: it is the owner being sent a
// spreadsheet by a partner and uploading it. That is still an untrusted file.

import { describe, it, expect, vi } from 'vitest';
import ExcelJS from 'exceljs';
import { extractEmails } from './BulkTab';

/** A File built from bytes, the way the browser hands one to the component. */
const fileOf = (name, bytes) => ({
  name,
  arrayBuffer: async () => bytes,
});

/** A real .xlsx, produced by exceljs itself — not a fixture that drifts. */
async function xlsxWith(rows, { hyperlink = false } = {}) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Attendees');
  rows.forEach((r, i) => {
    const row = ws.getRow(i + 1);
    r.forEach((v, j) => {
      const cell = row.getCell(j + 1);
      // Excel turns a pasted email into a HYPERLINK object, which is the case
      // that happens most often and the one a naive .value read would miss.
      if (hyperlink && typeof v === 'string' && v.includes('@')) {
        cell.value = { text: v, hyperlink: `mailto:${v}` };
      } else {
        cell.value = v;
      }
    });
    row.commit();
  });
  return wb.xlsx.writeBuffer();
}

describe('reading emails out of an uploaded sheet', () => {
  it('finds them in a real .xlsx', async () => {
    const buf = await xlsxWith([
      ['Name', 'Email'],
      ['Sara', 'sara@company.com'],
      ['Ahmed', 'ahmed@company.com'],
    ]);
    const { found } = await extractEmails(fileOf('attendees.xlsx', buf));
    expect(found).toEqual(['sara@company.com', 'ahmed@company.com']);
  });

  // THE CASE THAT ACTUALLY HAPPENS. Paste an address into Excel and it becomes
  // a hyperlink object; reading cell.value alone would return [object Object]
  // and the sheet would appear to contain no addresses at all.
  it('finds them when Excel has turned them into hyperlinks', async () => {
    const buf = await xlsxWith([['Email'], ['sara@company.com']], { hyperlink: true });
    const { found } = await extractEmails(fileOf('attendees.xlsx', buf));
    expect(found, 'a pasted email became a hyperlink and was missed').toEqual(['sara@company.com']);
  });

  it('reads every sheet in the workbook, not just the first', async () => {
    const wb = new ExcelJS.Workbook();
    const a = wb.addWorksheet('Day 1');
    a.getCell('A1').value = 'day1@company.com';
    const b = wb.addWorksheet('Day 2');
    b.getCell('A1').value = 'day2@company.com';
    const { found } = await extractEmails(fileOf('two.xlsx', await wb.xlsx.writeBuffer()));
    expect(found.sort()).toEqual(['day1@company.com', 'day2@company.com']);
  });

  it('ignores everything that is not an address', async () => {
    const buf = await xlsxWith([
      ['Name', 'Email', 'Credits'],
      ['Sara', 'sara@company.com', 100],
      ['not an email', 'also-not', ''],
    ]);
    const { found } = await extractEmails(fileOf('mixed.xlsx', buf));
    expect(found).toEqual(['sara@company.com']);
  });
});

describe('CSV needs no parser at all', () => {
  // Not reaching for a library here removes a parser from the attack surface
  // entirely — a separated-values file yields its cells to a split().
  const enc = (t) => new TextEncoder().encode(t).buffer;

  it('reads a comma-separated list', async () => {
    const { found } = await extractEmails(
      fileOf('list.csv', enc('Name,Email\nSara,sara@company.com\nAhmed,ahmed@company.com\n')));
    expect(found).toEqual(['sara@company.com', 'ahmed@company.com']);
  });

  it.each([[';'], ['\t']])('handles a %s separator too', async (sep) => {
    const { found } = await extractEmails(fileOf('list.csv', enc(`Name${sep}sara@company.com`)));
    expect(found).toEqual(['sara@company.com']);
  });

  it('strips the quotes a spreadsheet adds', async () => {
    const { found } = await extractEmails(fileOf('list.csv', enc('"sara@company.com",100')));
    expect(found).toEqual(['sara@company.com']);
  });

  it('never loads a parser for a csv', async () => {
    const loadExcelJS = vi.fn();
    await extractEmails(fileOf('list.csv', enc('sara@company.com')), { loadExcelJS });
    expect(loadExcelJS, 'a csv pulled in the spreadsheet parser it does not need')
      .not.toHaveBeenCalled();
  });
});

describe('the format that was dropped', () => {
  // exceljs cannot read the 2003 binary format. Decided with the owner on
  // 2026-08-21: carrying an unfixable vulnerability to support it was the worse
  // trade. What matters is that it is REFUSED WITH AN INSTRUCTION — a silent
  // failure would send someone hunting for a problem that is not theirs.
  it('refuses a .xls and says exactly what to do', async () => {
    const { error, found } = await extractEmails(fileOf('old.xls', new ArrayBuffer(8)));
    expect(found).toBeUndefined();
    expect(error).toMatch(/old \.xls file/);
    expect(error).toMatch(/Save As/);
    expect(error).toMatch(/\.xlsx/);
  });

  it('does not try to parse it anyway', async () => {
    const loadExcelJS = vi.fn();
    await extractEmails(fileOf('old.xls', new ArrayBuffer(8)), { loadExcelJS });
    expect(loadExcelJS).not.toHaveBeenCalled();
  });

  // A file merely CONTAINING ".xls" is not a .xls — refusing it would be a
  // different bug in the opposite direction.
  it('does not mistake attendees.xlsx for the old format', async () => {
    const buf = await xlsxWith([['sara@company.com']]);
    const { found, error } = await extractEmails(fileOf('attendees.xlsx', buf));
    expect(error).toBeUndefined();
    expect(found).toEqual(['sara@company.com']);
  });
});

describe('a file that will not open', () => {
  it('throws rather than reporting an empty sheet', async () => {
    // Reporting "no emails found" for a corrupt file would send someone
    // checking their spreadsheet instead of the file.
    await expect(extractEmails(fileOf('broken.xlsx', new ArrayBuffer(16))))
      .rejects.toThrow();
  });
});
