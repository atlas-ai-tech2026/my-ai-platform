# Tech debt

Known-stale dependencies and deferred cleanups. Recorded during the
28 Jul 2026 security audit remediation (finding M6) so they are tracked
rather than forgotten. **Nothing here is urgent** — none of it is an active
exploit path. Reassess when touching the relevant area.

---

## 1. `xlsx` (SheetJS) 0.18.5 — unfixed advisories, and it IS used ⚠️

**Status:** high-severity advisories (prototype pollution, ReDoS) with
**`fixAvailable: false`** — the npm-registry copy of SheetJS is no longer
updated; upstream moved to their own CDN.

**Where it's used:** `src/components/admin/BulkTab.jsx:62`, lazily imported
to parse an uploaded `.xlsx`/`.csv` and pull email addresses out of it for
bulk user provisioning. That's the only usage — it is NOT used anywhere on
the customer-facing path.

**Why it wasn't removed:** it's load-bearing for a real admin feature.

**Risk in practice:** the parser only ever runs in the admin's own browser,
on a file the admin chose. To exploit it, an attacker would have to get the
admin to upload a malicious spreadsheet. Real, but narrow.

**Recommended fix (≈1–2 hours):** `exceljs` is now a declared dependency
anyway (the export scripts use it) and can *read* xlsx as well as write it.
Porting `BulkTab.onFile` to exceljs would drop `xlsx` entirely and remove
the advisory. The parsing loop is ~15 lines; the shapes differ
(`worksheet.eachRow` instead of `sheet_to_json`), so it needs a quick test
with a real sheet.

**Alternative (≈30 min):** accept `.csv` only and parse it with plain
JavaScript — no spreadsheet library at all. This loses `.xlsx` upload,
which the admin may rely on.

---

## 2. `moment` 2.30.1 — unmaintained, and unused

**Status:** moment is in legacy maintenance mode; the maintainers recommend
against it for new work. It's ~70 KB gzipped.

**Where it's used:** **nowhere.** A repo-wide search finds no `import`
of the package — the only "moment" matches are the English word inside
error strings. It appears to be a leftover from the original scaffold.

**Recommended fix (≈5 minutes):** remove it from `package.json`. Left in
place for now only because the Phase 3 brief explicitly said not to touch
it in this pass. If anything later needs date formatting, use `dayjs`
(same API, ~2 KB) or `Intl.DateTimeFormat`.

---

## 3. `react-quill` 2.0.0 — unmaintained, and unused

**Status:** carries a moderate advisory via its `quill` dependency, and
npm's only "fix" is a downgrade to `react-quill@0.0.2` — i.e. there is no
real fix.

**Where it's used:** **nowhere.** No source file imports it.

**Recommended fix (≈5 minutes):** remove it from `package.json`. Same
reason as moment for leaving it this pass. If a rich-text editor is ever
needed, use a maintained one (TipTap, Lexical, or Plate).

---

## 4. Other advisories worth a maintenance pass

`npm audit` reports several issues in **build/test tooling** rather than
shipped runtime code (vite, vitest, esbuild, postcss, concurrently,
shell-quote, js-yaml). These don't run in production, but they do run on
developer machines and in CI, so they're worth clearing:

```bash
npm audit fix            # the non-breaking ones
npm audit                # then review what's left
```

The `vitest`/`vite` chain needs a semver-major bump, so do it deliberately
and re-run the suite (251 tests) rather than as part of another change.

`axios` and `react-router-dom` have straightforward fixes available and DO
ship to production — those are the highest priority in this group.

---

## 5. `server/src/index.js` size

Now past 4,700 lines. `CLAUDE.md` says it stays one file until ~1,500 lines
or auth arrives — both thresholds have now passed, and the audit added
several more modules around it (`pricing.js`, `download-guard.js`,
`upload-guard.js`, `provider-deadline.js`, `video-charges.js`, `totp.js`,
`admin-session.js`, `audit-redact.js`, `client-ip.js`).

The natural next split is by concern: routes for generation, admin, and
auth. Not urgent, but the file is now hard to navigate and every audit
finding referenced line numbers that had already shifted.
