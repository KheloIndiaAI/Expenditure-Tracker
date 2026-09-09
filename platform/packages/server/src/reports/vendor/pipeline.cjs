'use strict';
/*
 * The processing core, shared by the CLI, the web server and the scheduler.
 * Nothing here writes to the console — callers decide how to report progress.
 */
const fs = require('fs');
const path = require('path');

const { parseRbiReport } = require('./rbi.cjs');
const { parseDscDetails, weeklyRegionalCentreLeaderboard } = require('./dsc.cjs');
const { componentWeeklySpend, saveSnapshot } = require('./snapshot.cjs');
const { readMaster, readAssignmentTab } = require('./sheet.cjs');
const { createResolver } = require('./agencies.cjs');
const { rollup } = require('./rollup.cjs');
const { buildDoc } = require('./docgen.cjs');
const { buildPdfAndHtml, buildWeeklyPdf, checkPageCount } = require('./pdfgen.cjs');
const { appendDailyLog } = require('./log.cjs');
const { refreshLiveSheet } = require('./gsheet.cjs');
const { dotDate, isoDate, norm, cr } = require('./util.cjs');

/*
 * The live sheet spells the state-infra division "MDSD Infra" (its own
 * naming), which does not normalise the same way as this project's
 * "MSD-INFRA" key — every other division matches by normalised name alone.
 */
const ASSIGNMENT_KEY_ALIASES = { mdsdinfra: 'msdinfra' };
const assignmentKey = name => {
  const n = norm(name);
  return ASSIGNMENT_KEY_ALIASES[n] || n;
};

/* VENDOR PATCH 1 of 6 — see reports/vendor/README.md.
   Upstream this is the project folder, because the pipeline runs from a checkout
   on someone's desktop. On the server it runs from a working directory built for
   the run and thrown away afterwards, so the root has to be told, not assumed.
   Unset, it behaves exactly as upstream.

   Resolved per call, not once at require time. The module is cached for the life
   of the process, so a constant would pin every later run to the first run's
   folder — which by then has been deleted. */
const ROOT = () => process.env.EFIP_REPORTS_HOME || path.join(__dirname, '..');
const abs = p => (path.isAbsolute(p) ? p : path.join(ROOT(), p));

function loadConfig() {
  return JSON.parse(fs.readFileSync(path.join(ROOT(), 'config', 'config.json'), 'utf8'));
}

function saveConfig(config) {
  const file = path.join(ROOT(), 'config', 'config.json');
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
  return config;
}

/** Newest .xlsx in a folder, ignoring Excel's ~$ lock files. */
function newestReport(dir) {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir)
    .filter(f => /\.(xlsx|xls)$/i.test(f) && !f.startsWith('~$'))
    .map(f => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  return files.length ? path.join(dir, files[0].f) : null;
}

/**
 * Get the master spreadsheet for this run: a fresh live download when
 * configured, falling back to the last successfully cached copy (and, after
 * that, the manually-placed file) if the fetch fails — a network hiccup must
 * never be the reason the morning run doesn't produce a document.
 */
async function resolveMasterFile(config, warnings) {
  const gs = config.googleSheets;
  if (!gs || !gs.enabled) {
    return abs(config.paths.testSheet2);
  }

  const cachePath = abs(gs.cachePath);
  try {
    const r = await refreshLiveSheet({ sheetId: gs.sheetId, cachePath, timeoutMs: gs.timeoutMs });
    return { file: r.path, live: true, fetchedAt: r.fetchedAt, bytes: r.bytes };
  } catch (err) {
    if (fs.existsSync(cachePath)) {
      warnings.push(
        `Could not refresh the live Google Sheet (${err.message}). Using the last successful download instead ` +
        `(${fs.statSync(cachePath).mtime.toLocaleString('en-IN')}).`
      );
      return { file: cachePath, live: false, stale: true };
    }
    const fallback = abs(config.paths.testSheet2);
    if (fs.existsSync(fallback)) {
      warnings.push(
        `Could not fetch the live Google Sheet (${err.message}), and no cached copy exists yet. ` +
        `Using the manually-placed file at paths.testSheet2 instead.`
      );
      return { file: fallback, live: false, stale: true };
    }
    throw new Error(`Could not fetch the live Google Sheet (${err.message}), and no fallback file exists at paths.testSheet2.`);
  }
}

/**
 * Override each division's assigned figure from the live sheet's Assignment
 * tab, when present — that tab is the one place division targets are hand
 * maintained, so it beats whatever number was last typed into config.json.
 * A division the tab doesn't mention keeps its config value untouched.
 */
function applyAssignmentTab(config, masterFile, warnings) {
  let table;
  try {
    table = readAssignmentTab(masterFile, (config.googleSheets && config.googleSheets.assignmentTab) || 'Assignment');
  } catch {
    return null;   // a read failure here must not fail the whole run — config values still apply
  }
  if (!table) return null;

  // Re-key through the same alias function on both sides, so a sheet-side
  // spelling ("MDSD Infra") and a config-side key ("MSD-INFRA") land on the
  // same lookup key even though their raw normalised forms differ.
  const aliased = new Map();
  for (const row of table.values()) aliased.set(assignmentKey(row.name), row);

  const matchedKeys = new Set();
  for (const d of config.divisions) {
    const row = aliased.get(assignmentKey(d.key)) || aliased.get(assignmentKey(d.label));
    if (row) { d.assigned = row.assigned; matchedKeys.add(assignmentKey(row.name)); }
  }

  for (const row of table.values()) {
    if (!matchedKeys.has(assignmentKey(row.name))) {
      warnings.push(
        `The Assignment tab has a division ("${row.name}") that doesn't match any division in config.json — its target was not applied.`
      );
    }
  }
  return aliased;
}

/**
 * The Assignment tab also carries its own Expenditure figure per division —
 * maintained independently of the component mapping this project infers. The
 * two agreeing is a live, ongoing check that the KI-1/KI-2 component split
 * (never confirmed against an authoritative source — see config's
 * _divisionsNote) is actually correct, not just self-consistent.
 */
function crossCheckAssignmentExpenditure(divisions, aliased, warnings) {
  if (!aliased) return;
  const TOLERANCE = 5e5;   // ₹5 lakh — below this is rounding/timing noise, not a mapping problem
  for (const d of divisions) {
    const row = aliased.get(assignmentKey(d.key)) || aliased.get(assignmentKey(d.label));
    if (!row || row.expenditure == null) continue;
    const diff = d.expenditure - row.expenditure;
    if (Math.abs(diff) > TOLERANCE) {
      warnings.push(
        `${d.label}: this report computes expenditure as ${cr(d.expenditure)}, but the Assignment tab lists ${cr(row.expenditure)} ` +
        `for the same division (${diff > 0 ? 'over' : 'under'} by ${cr(Math.abs(diff))}). ` +
        `Since the totals across all divisions still match, this points at a component still mapped to the wrong division — ` +
        `check config.json's KI-1/KI-2 component lists (or the Divisions page) against the source you use for that split.`
      );
    }
  }
}

/**
 * Run the full pipeline for one RBI report.
 *
 * @param {object}  o
 * @param {string}  o.reportFile   path to the RBI .xlsx
 * @param {object} [o.config]      defaults to config/config.json
 * @param {string} [o.asOn]        override the heading date (dd.mm.yyyy)
 * @param {boolean}[o.writeLog]    append to the daily log (default true)
 * @param {boolean}[o.writeDocs]   write the Word files (default true)
 */
async function processReport(o = {}) {
  let config = o.config || loadConfig();

  const sourceWarnings = [];
  const source = await resolveMasterFile(config, sourceWarnings);
  const masterFile = typeof source === 'string' ? source : source.file;
  const liveSheet = typeof source === 'string' ? { live: false } : source;
  if (!fs.existsSync(masterFile)) {
    throw new Error(`Master spreadsheet not found: ${masterFile}. Update paths.testSheet2 (or googleSheets) in config/config.json.`);
  }

  // A clone: the Assignment-tab override below must not persist back into
  // the caller's config object across runs.
  config = { ...config, divisions: config.divisions.map(d => ({ ...d })) };
  const assignmentAliased = applyAssignmentTab(config, masterFile, sourceWarnings);
  const master = readMaster(masterFile, { masterTab: config.testSheet2.masterTab });

  const resolver = createResolver(
    config.testSheet2.rcTabs,
    master.kiInfraStates.map(s => s.name),
    config.agencyAliases
  );

  // The day's claims always come from the DSC_Details tab of the live SAI
  // Expenditure SYNC sheet — that tab is the system of record for them. A file
  // dropped into the input folder still *triggers* a run, but no longer
  // supplies the figures: doing so built the distribution table out of
  // whatever sample workbook happened to be sitting in input/.
  let reportFile = o.reportFile ? abs(o.reportFile) : null;
  const dailyData = parseDscDetails(masterFile, o.asOn);
  if (!reportFile) reportFile = masterFile;

  const result = rollup({ master, dsc: dailyData, rbi: dailyData, config, resolver });
  crossCheckAssignmentExpenditure(result.divisions, assignmentAliased, result.warnings);
  result.warnings.unshift(...sourceWarnings);
  /*
   * The report is dated the day it is produced — heading, filename and
   * de-duplication key all the same date.
   *
   * It was previously headed with the DSC_Details claim date instead. That
   * left three different dates in play at once (claim date in the heading,
   * run date on the file), which is what made the manual-figures panel ask
   * "applies to report dated" and then silently ignore anything typed, because
   * the date an operator would naturally enter was today and the heading said
   * something else. One date removes that whole class of mismatch.
   *
   * The claims themselves are still whatever the sheet last recorded — that is
   * `claimsDate` below, kept for the daily log, which is a record of claims
   * rather than of the report.
   */
  const runDate = o.now instanceof Date ? o.now : new Date();
  const claimsDate = dailyData.reportDate || runDate;
  const reportDate = runDate;
  const asOn = o.asOn || dotDate(runDate);
  const stamp = isoDate(runDate);
  const fileStamp = stamp;

  // Surface a stated-vs-computed mismatch rather than silently trusting either.
  if (Math.abs(dailyData.grandTotal - dailyData.computedTotal) > 1) {
    result.warnings.unshift(
      `The report's Grand Total (₹${(dailyData.grandTotal / 1e7).toFixed(2)} Cr) does not match the sum of its rows ` +
      `(₹${(dailyData.computedTotal / 1e7).toFixed(2)} Cr). Figures below use the row sum.`
    );
  }

  /*
   * Hand-entered figures for the page-1 summary table.
   *
   * These are deliberately scoped to a single as-on date. A blanket override
   * would keep applying to every future report, so one figure corrected today
   * would quietly falsify next week's — the failure would be invisible,
   * because an overridden report looks exactly like a computed one. Tying the
   * override to the date it was entered for means it lapses on its own.
   *
   * Only the three cells the operator can set are touched; division and
   * Regional Centre figures stay as computed, so nothing downstream inherits a
   * hand-typed number without it being visible in that table.
   */
  const ov = config.manualOverrides || {};
  const num = v => (v === null || v === undefined || v === '' ? null : Number(v));
  const applied = [];

  /*
   * Total Assigned is deliberately NOT date-scoped. It is a standing figure —
   * the scheme's sanctioned total, which changes only when the Ministry
   * revises it — so pinning it to one as-on date would mean re-entering it
   * every day. Once fixed it holds until someone fixes a different number.
   */
  const assignedOv = num(ov.totalAssigned);
  if (ov.totalAssignedFixed && assignedOv != null && isFinite(assignedOv)) {
    result.totals.assigned = assignedOv;
    // The computed balance was struck against the computed assigned, so it has
    // to be restated against the fixed one or the table stops adding up.
    result.totals.balance = assignedOv - result.totals.expenditure;
    applied.push(`Total Assigned = ${cr(assignedOv)} (fixed)`);
  }

  /*
   * A typed figure is used, full stop — on this report and every one after,
   * until it is cleared.
   *
   * These were briefly scoped to a single as-on date, so that a figure
   * corrected once could not keep applying afterwards. That backfired: the
   * as-on date comes from the sheet's claim dates and lags behind today, so an
   * operator entering figures naturally dated them today, the two never
   * matched, and the entries were silently ignored while the report showed
   * computed values. A guard whose failure mode is "your input vanished
   * without a word" is worse than the staleness it was guarding against, so
   * the visibility below carries that job instead: the dashboard flags
   * whenever figures are in force, and every run records which were used.
   */
  const expOv = num(ov.totalExpenditure);
  const balOv = num(ov.balance);
  const dayOv = num(ov.dayTotal);

  if (expOv != null && isFinite(expOv)) {
    result.totals.expenditure = expOv;
    applied.push(`Total Expenditure = ${cr(expOv)}`);
    // Keep the table adding up: unless the balance is itself overridden it
    // follows from the figure above it, exactly as the computed one does.
    if (balOv == null) result.totals.balance = result.totals.assigned - expOv;
  }
  if (balOv != null && isFinite(balOv)) {
    result.totals.balance = balOv;
    applied.push(`Balance = ${cr(balOv)}`);
  }
  if (dayOv != null && isFinite(dayOv)) {
    result.day.total = dayOv;
    applied.push(`Yesterday's Total Expenditure = ${cr(dayOv)}`);
  }

  if (applied.length) {
    result.warnings.unshift(
      `Manually entered figures were used: ${applied.join('; ')}. ` +
      `Clear them on the dashboard to go back to the computed values.`
    );
  }
  result.manualFigures = applied;

  /*
   * The Monday leaderboard: last week's Regional Centre spend, added as an
   * extra page on the Monday report only.
   *
   * The trigger is the day the report is *produced*, not the as-on date — a
   * "Monday report" is the one that lands on Monday morning, and the as-on
   * date trails the sheet's own claim dates, so it cannot be relied on to fall
   * on a Monday at all. Regenerating later in the same week still reports the
   * same Mon..Sun block (see previousWeekRange), so a re-run is reproducible.
   */
  const lbCfg = config.weeklyLeaderboard || {};
  const runDay = o.now instanceof Date ? o.now : new Date();
  const wantLeaderboard = lbCfg.enabled !== false
    && (lbCfg.onlyOnMonday === false || runDay.getDay() === 1);
  let leaderboard = null;
  let componentWeek = null;
  if (wantLeaderboard) {
    try {
      leaderboard = weeklyRegionalCentreLeaderboard(masterFile, runDay);
      if (!leaderboard.rows.length) {
        result.warnings.push(
          'No Regional Centre claims fell in last week, so the weekly leaderboard page was left out.'
        );
        leaderboard = null;
      }
    } catch (err) {
      result.warnings.push(`Could not build the weekly leaderboard (${err.message}).`);
    }

    /*
     * Component spend is the difference between this Monday's Sheet3 totals
     * and last Monday's, so it is computed *before* today's snapshot is
     * written — otherwise the baseline would be today's own figures and every
     * delta would come out zero.
     */
    try {
      componentWeek = componentWeeklySpend(runDay, result.divisions);
      if (!componentWeek) {
        result.warnings.push(
          'No earlier Sheet3 snapshot exists yet, so component spending could not be worked out. ' +
          'One has been stored now — the figures will appear from next Monday.'
        );
      } else if (!componentWeek.rows.length) {
        result.warnings.push('No component moved last week, so the component page was left out.');
        componentWeek = null;
      } else if (componentWeek.unmeasured.length) {
        result.warnings.push(
          `Not measured this week (absent from the ${componentWeek.baselineOn} snapshot): ` +
          `${componentWeek.unmeasured.map(u => `${u.divisionLabel} — ${u.label}`).join('; ')}. ` +
          'They are included from next week.'
        );
      }
      saveSnapshot(runDay, result.divisions);
    } catch (err) {
      result.warnings.push(`Could not work out component spending (${err.message}).`);
    }
  }

  const outputs = [];
  if (o.writeDocs !== false) {
    const outDir = abs(config.paths.outputDir);
    fs.mkdirSync(outDir, { recursive: true });
    const single = config.output.formats.length === 1;
    for (const format of config.output.formats) {
      const buf = await buildDoc(format, result, {
        asOn, includeNotes: false,
        rcDisplayOrder: config.testSheet2.rcDisplayOrder,
      });
      // With one format configured (the normal case), the filename doesn't
      // need to say which — it's just the report.
      const name = single
        ? `EXPENDITURE SUMMARY - ${fileStamp}.docx`
        : `EXPENDITURE SUMMARY - ${format} - ${fileStamp}.docx`;
      const dest = path.join(outDir, name);
      fs.writeFileSync(dest, buf);
      outputs.push({ format, name, path: dest, bytes: buf.length });
    }

    /* VENDOR PATCH 4 of 6 — see reports/vendor/README.md.
       On the server the PDF is rendered when somebody asks for it, not on every
       scheduled run: it costs a Chromium launch per document, and most runs are
       never downloaded as PDF. The HTML written here is the very same file the
       PDF is printed from, so rendering it later reproduces this run's PDF
       exactly rather than re-reading the sheet. Unset, it behaves as upstream. */
    // Generate exact matching PDF and standalone HTML report
    try {
      const pdfRes = await buildPdfAndHtml(result, {
        asOn, stamp: fileStamp, outDir,
        rcDisplayOrder: config.testSheet2.rcDisplayOrder,
        leaderboard,
        skipPdf: o.writePdf === false,
      });
      if (pdfRes.pdfFile) {
        outputs.push({ format: 'pdf', name: path.basename(pdfRes.pdfFile), path: pdfRes.pdfFile, bytes: pdfRes.bytes });
        // Every page is laid out to fill exactly one sheet; more pages than
        // that means something overflowed, which the figures never reveal.
        checkPageCount(pdfRes.pdfFile, 2, 'The Expenditure Summary', result.warnings);
      }
      if (pdfRes.htmlFile) {
        outputs.push({ format: 'html', name: path.basename(pdfRes.htmlFile), path: pdfRes.htmlFile });
      }
    } catch (err) {
      result.warnings.push(`Could not generate PDF report (${err.message}). Word document was generated successfully.`);
    }

    // The weekly leaderboard is its own document, produced only on Mondays.
    if (leaderboard || componentWeek) {
      try {
        const wk = await buildWeeklyPdf({ asOn, stamp: fileStamp, outDir, leaderboard, componentWeek,
          skipPdf: o.writePdf === false });
        if (wk && wk.pdfFile) {
          outputs.push({ format: 'weekly-pdf', name: path.basename(wk.pdfFile), path: wk.pdfFile, bytes: wk.bytes });
          const expected = (leaderboard ? 1 : 0) + (componentWeek ? 1 : 0);
          checkPageCount(wk.pdfFile, expected, 'The Weekly Leaderboard', result.warnings);
        }
        if (wk && wk.htmlFile) {
          outputs.push({ format: 'weekly-html', name: path.basename(wk.htmlFile), path: wk.htmlFile });
        }
        if (wk && wk.warning) result.warnings.push(`Weekly leaderboard: ${wk.warning}`);
      } catch (err) {
        result.warnings.push(`Could not generate the weekly leaderboard PDF (${err.message}).`);
      }
    }
  }

  let logInfo = null;
  if (o.writeLog !== false) {
    logInfo = appendDailyLog(abs(config.paths.dailyLog), result);
  }

  const claimsCount = dailyData.claims ? dailyData.claims.length : 0;
  const agenciesCount = dailyData.byAgency ? Object.keys(dailyData.byAgency).length : 0;

  return {
    reportFile,
    reportName: path.basename(reportFile),
    asOn,
    stamp,
    reportDate,
    source: dailyData.source || 'file',
    daily: {
      claims: claimsCount,
      agencies: agenciesCount,
      grandTotal: dailyData.grandTotal,
      computedTotal: dailyData.computedTotal,
      fundTransferId: dailyData.fundTransferId,
      reportTime: dailyData.reportTime,
    },
    rbi: {
      claims: claimsCount,
      agencies: agenciesCount,
      grandTotal: dailyData.grandTotal,
      computedTotal: dailyData.computedTotal,
      fundTransferId: dailyData.fundTransferId,
      reportTime: dailyData.reportTime,
    },
    master: {
      components: master.components.length,
      states: master.kiInfraStates.length,
      file: masterFile,
    },
    liveSheet,
    result,
    outputs,
    logInfo,
  };
}

module.exports = { processReport, loadConfig, saveConfig, newestReport, abs, ROOT, assignmentKey };
