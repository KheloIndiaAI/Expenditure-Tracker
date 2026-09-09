# Vendored report pipeline

This folder is the daily-report automation, copied in and run **unmodified**
except for the five patches listed below. Every figure in every document the
platform serves is computed by this code, not by anything written for the
platform — that is the whole point of vendoring it rather than reimplementing
it.

**Upstream:** `SAI expenditure sheet auto` (a standalone Node/Express project).
**Copied:** 2026-09-08.

## Why it is a copy and not a rewrite

The Expenditure Summary reproduces a published PDF page for page — its cards,
its badges, its exact wording, its two-page layout. A second implementation of
that in the platform's own idiom would be two things to keep identical forever,
and the first divergence would be a figure in a government report. So the code
comes across whole.

## Files

`pipeline` `rbi` `dsc` `snapshot` `sheet` `agencies` `rollup` `docgen`
`pdfgen` `log` `gsheet` `util` `report-layout` `icons` `png`

Renamed `.js` → `.cjs` because `@efip/server` is `"type": "module"` and these
are CommonJS; the extension is what tells Node so. Internal `require('./x')`
calls were rewritten to `require('./x.cjs')` mechanically. Nothing else about
them changed.

`scheduler.js` and `store.js` were deliberately **not** copied. `store.js`
persists to JSON files on disk, which a stateless container cannot do, so the
platform supplies its own — see `../store.ts`. `scheduler.js` has no
replacement at all: on the platform a report is produced only when somebody
presses Process now, so there is nothing to schedule. `pipeline.cjs` never
required either of them.

## The patches

Each is marked in the source with `VENDOR PATCH n`.

1. **`pipeline.cjs` — `ROOT` is configurable, and resolved per call.** Upstream
   it is the project folder, because the pipeline runs from a checkout. Here it
   runs from a working directory built for the run and deleted afterwards, so
   the root has to be told: `EFIP_REPORTS_HOME`. Unset, behaviour is identical
   to upstream. It is a function rather than a constant because `require` caches
   the module for the life of the process: read once, the first run of a
   container would pin every later run to a folder that no longer exists, so
   only the first report after a deploy would succeed.

2. **`snapshot.cjs` — same.** The Monday snapshots live in Postgres and are
   written into the working directory before a run. `FILE` is likewise a
   function, because the working directory does not exist yet when the module is
   first required.

3. **`pdfgen.cjs` — `findBrowser()` knows Linux.** Upstream looks only where
   Edge and Chrome install on Windows. On Debian it would have found nothing and
   silently produced no PDF. `CHROME_PATH` wins if set; the Windows paths are
   kept, so this file still works unchanged on the desktop it came from.
   `browserArgs()` appends `CHROME_FLAGS`, which the container uses to pass
   `--no-sandbox --disable-dev-shm-usage`. Unset, the switches are upstream's.

4. **`pipeline.cjs` / `pdfgen.cjs` — `skipPdf`.** The PDF costs a Chromium
   launch per document and most runs are never downloaded as one, so scheduled
   runs write DOCX and HTML only and the PDF is rendered when someone asks.
   It reuses the "no browser found" path upstream already had, which every
   caller already handled. Unset, behaviour is upstream's.

5. **`pdfgen.cjs` — `htmlToPdf` is exported.** So the on-demand PDF prints the
   HTML that run already stored, reproducing that run rather than re-reading the
   sheet.

6. **`report-layout.cjs` — the Word layout pieces are exported.** Exports only;
   `reportLayout()` itself is untouched. `leaderboardPage()` is this file's own
   Word rendering of the weekly leaderboard, written upstream but never called
   there — the desktop tool only ever produced that page as a PDF. The platform
   produces a Word copy of the weekly report as well, and building it from that
   page rather than a second one written from scratch is what keeps the Word and
   PDF versions the same document. The card, table and bar helpers go with it
   because the component-spending page has no Word rendering anywhere upstream,
   so the platform writes one (see `../weekly.ts`) and draws it with these
   rather than a parallel set of its own.

## Updating

Re-copy the files, re-apply the six patches, then run the pipeline against the
live sheet and compare `result.totals`, `result.divisions` and the document byte
counts with the run before. A change in any of them is a change to a published
figure and wants explaining, not accepting.

## One dependency note

`xlsx` is installed from `https://cdn.sheetjs.com/xlsx-0.20.3/...`, SheetJS's
own distribution, not from the npm registry. The registry copy is frozen at
0.18.5 and carries two HIGH advisories with no fix available, which CI's
`npm audit --audit-level=high` refuses. 0.20.3 audits clean and was verified to
parse the live workbook **byte-identically** to 0.18.5 across all 13 components,
the KI Infra table, the Assignment tab, DSC_Details and the weekly leaderboard.
