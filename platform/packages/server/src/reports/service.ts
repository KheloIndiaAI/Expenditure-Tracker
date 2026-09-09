/**
 * Report automation — running it.
 *
 * This is the only place the vendored pipeline is called. It builds the folder
 * that pipeline expects, points it there, runs it, stores what it produced and
 * throws the folder away. The pipeline is not adapted to the platform; the
 * platform is adapted to the pipeline, which is what keeps the figures its own.
 */

import { createRequire } from 'node:module';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as store from './store.ts';
import * as weekly from './weekly.ts';

const require_ = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

type PipelineModule = {
  processReport: (o: Record<string, unknown>) => Promise<any>;
};
type PdfModule = {
  htmlToPdf: (html: string, outDir: string, baseName: string, skipPdf?: boolean) => Promise<{
    htmlFile: string; pdfFile: string | null; bytes?: number; warning?: string;
  }>;
  pdfPageCount: (file: string) => number | null;
  findBrowser: () => string | null;
};

const pipeline = (): PipelineModule => require_(join(__dirname, 'vendor', 'pipeline.cjs'));
const pdfgen = (): PdfModule => require_(join(__dirname, 'vendor', 'pdfgen.cjs'));
const snapshotMod = (): any => require_(join(__dirname, 'vendor', 'snapshot.cjs'));

/**
 * The weekly Regional Centre report, built for the last COMPLETED week.
 *
 * The pipeline emits this pair of pages itself, but only on a Monday, and it
 * works the component page out as "everything since the last snapshot" — which
 * on a Wednesday is two days captioned as a week. So it is built here instead,
 * for whichever day the report is asked for, from one decision about which
 * week is being reported. Both files come from that single set of figures, so
 * the Word copy and the PDF can never state different numbers.
 *
 * These entries are appended AFTER the pipeline's own, and report_doc is keyed
 * on (run, format) — so on a Monday, when the pipeline has produced its own
 * weekly HTML, this simply replaces it rather than fighting over the row.
 */
async function buildWeekly(
  work: store.WorkDir,
  detail: any,
  result: any,
): Promise<Array<{ format: string; name: string; path: string }>> {
  const out: Array<{ format: string; name: string; path: string }> = [];
  const warn = (m: string) => { (result.warnings ??= []).push(m); };
  /* Which week this is, read in IST — the sheet's own dates are Indian, and a
     server in another zone must not decide the week is a day out. istDMY()
     already does this for the manual figures; this is the same shift. */
  const istNow = new Date(Date.now() + IST_OFFSET_MIN * 60000);
  const p = (n: number) => String(n).padStart(2, '0');
  const todayISO = `${istNow.getUTCFullYear()}-${p(istNow.getUTCMonth() + 1)}-${p(istNow.getUTCDate())}`;
  /* A local-component Date for the vendored leaderboard, whose own previousWeekRange
     reads local date fields. Built from the IST calendar day, not the server's. */
  const today = new Date(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate());

  let leaderboard: any = null;
  let componentWeek: any = null;
  try {
    leaderboard = weekly.leaderboardForCompletedWeek(detail?.master?.file, today);
    if (!leaderboard) {
      warn('No Regional Centre claims fell in last week, so the weekly report has no leaderboard page.');
    }
  } catch (err) {
    warn(`Could not build the weekly leaderboard (${(err as Error).message}).`);
  }

  try {
    componentWeek = weekly.componentWeekForCompletedWeek(todayISO);
    if (!componentWeek) {
      warn(
        'Component spending was left out of the weekly report: it is the difference between two ' +
        'Monday snapshots of Sheet3, and this week\'s Monday has none yet. One is being recorded ' +
        'now, so the page appears from the next report onwards.',
      );
    }
  } catch (err) {
    warn(`Could not work out component spending (${(err as Error).message}).`);
  }

  if (leaderboard || componentWeek) {
    const stamp = detail?.stamp || 'latest';
    const base = `WEEKLY LEADERBOARD - ${stamp}`;
    const input = { leaderboard, componentWeek, asOn: detail?.asOn, stamp };
    try {
      const html = weekly.buildWeeklyHtml(input);
      if (html) {
        const file = join(work.outDir, `${base}.html`);
        mkdirSync(work.outDir, { recursive: true });
        writeFileSync(file, html, 'utf8');
        out.push({ format: 'weekly-html', name: basename(file), path: file });
      }
    } catch (err) {
      warn(`Could not lay out the weekly report (${(err as Error).message}).`);
    }
    try {
      const buf = await weekly.buildWeeklyDocx(input);
      if (buf) {
        const file = join(work.outDir, `${base}.docx`);
        mkdirSync(work.outDir, { recursive: true });
        writeFileSync(file, buf);
        out.push({ format: 'weekly-report', name: basename(file), path: file });
      }
    } catch (err) {
      warn(`Could not build the Word copy of the weekly report (${(err as Error).message}).`);
    }
  }

  /* Keep the Monday series going. Recorded only when this week's Monday has
     none: the imported history and any snapshot a real Monday run wrote are
     never overwritten by a later, fuller reading of the same week. */
  try {
    const snap = snapshotMod();
    const monday = weekly.mondayOfISO(todayISO);
    const have = (snap.readAll() as any[]).some((s) => s.takenOn === monday);
    if (!have && (result.divisions ?? []).length) {
      const [y, m, d] = monday.split('-').map(Number);
      snap.saveSnapshot(new Date(y!, m! - 1, d!), result.divisions);
    }
  } catch (err) {
    warn(`Could not record this week's component snapshot (${(err as Error).message}).`);
  }

  return out;
}

/**
 * One run at a time in this process.
 *
 * EFIP_REPORTS_HOME is process-wide, so two runs overlapping would have the
 * second one's folder silently become the first one's too. The database check
 * in runReport guards across containers; this guards within one, and does it
 * without a race because a promise is stored before anything awaits.
 */
let inFlight: Promise<RunResult> | null = null;

export interface RunResult {
  ok: boolean;
  runId: string;
  asOn?: string;
  stamp?: string;
  docs?: Array<{ format: string; name: string; bytes: number }>;
  warnings?: string[];
  error?: string;
}

export interface RunOptions {
  /** Only ever 'manual'. Nothing else starts a run — there is no scheduler. */
  trigger: 'manual';
  triggeredBy?: string | null;
  /**
   * Off by default, and left off: a run writes the DOCX and the HTML, and the
   * PDF is printed from that HTML when somebody actually asks for one. Most
   * runs are never downloaded as a PDF, and each one costs a headless browser.
   */
  writePdf?: boolean;
}

export function isRunning(): boolean {
  return inFlight !== null;
}

export async function runReport(opts: RunOptions): Promise<RunResult> {
  if (inFlight) return inFlight;
  inFlight = execute(opts).finally(() => { inFlight = null; });
  return inFlight;
}

async function execute(opts: RunOptions): Promise<RunResult> {
  const runId = await store.startRun(opts.trigger, opts.triggeredBy ?? null);
  const work = await store.hydrate();
  const prevHome = process.env.EFIP_REPORTS_HOME;
  process.env.EFIP_REPORTS_HOME = work.home;

  try {
    const detail = await pipeline().processReport({
      writeDocs: true,
      writeLog: true,
      /* Default false: most runs are never downloaded as a PDF, and a run
         should not pay for a Chromium launch nobody asked for. The HTML it
         writes is what the PDF prints from when somebody does. */
      writePdf: opts.writePdf === true,
    });

    const result = detail.result ?? {};
    const outputs = [...(detail.outputs ?? [])];
    outputs.push(...(await buildWeekly(work, detail, result)));
    const stored = await store.persist(work, runId, outputs);

    await store.finishRun(runId, {
      status: 'success',
      asOn: detail.asOn ?? null,
      stamp: detail.stamp ?? null,
      claims: detail.daily?.claims ?? null,
      agencies: detail.daily?.agencies ?? null,
      totals: result.totals ?? null,
      divisions: (result.divisions ?? []).map((d: any) => ({
        key: d.key, label: d.label, assigned: d.assigned,
        expenditure: d.expenditure, balance: d.balance,
      })),
      warnings: result.warnings ?? [],
    });

    return {
      ok: true, runId,
      asOn: detail.asOn, stamp: detail.stamp,
      docs: stored, warnings: result.warnings ?? [],
    };
  } catch (err) {
    const message = (err as Error)?.message ?? String(err);
    await store.finishRun(runId, { status: 'failed', error: message, warnings: [] });
    return { ok: false, runId, error: message };
  } finally {
    if (prevHome === undefined) delete process.env.EFIP_REPORTS_HOME;
    else process.env.EFIP_REPORTS_HOME = prevHome;
    store.discard(work);
  }
}

/**
 * The PDF, rendered on request from the HTML that run already stored.
 *
 * Printing the stored HTML rather than re-running the pipeline is what makes
 * this the same report: a fresh run would re-read the sheet, and the sheet
 * moves. The rendered PDF is stored, so the second person to ask for it pays
 * nothing.
 */
export async function renderPdf(runId: string, weekly: boolean): Promise<{ name: string; content: Buffer } | { error: string }> {
  const pdfFormat = weekly ? 'weekly-pdf' : 'pdf';
  const htmlFormat = weekly ? 'weekly-html' : 'html';

  const cached = await store.getDoc(runId, pdfFormat);
  if (cached) return cached;

  const html = await store.getDoc(runId, htmlFormat);
  if (!html) {
    return { error: weekly
      ? 'That run produced no weekly leaderboard, so there is no PDF to render.'
      : 'That run stored no HTML, so its PDF cannot be rendered.' };
  }

  const gen = pdfgen();
  if (!gen.findBrowser()) {
    return { error: 'No browser is available on the server to render a PDF. The Word and HTML copies are unaffected.' };
  }

  /* The browser prints from a file, so the HTML has to touch the disk. It is
     swept up straight afterwards: the PDF is in the database from here on, and
     a container that lives for months should not accumulate a folder of report
     content per run. Same tmpdir() as the run path, so Windows development and
     the container agree on where that is. */
  const dir = join(tmpdir(), `efip-pdf-${runId}-${weekly ? 'w' : 'r'}`);
  mkdirSync(dir, { recursive: true });
  try {
    const base = html.name.replace(/\.html$/i, '');
    const res = await gen.htmlToPdf(html.content.toString('utf8'), dir, base);
    if (!res.pdfFile || !existsSync(res.pdfFile)) {
      return { error: res.warning || 'The PDF could not be rendered.' };
    }
    const content = readFileSync(res.pdfFile);
    const name = basename(res.pdfFile);
    await store.putDoc(runId, pdfFormat, name, content);
    return { name, content };
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* not worth failing a download over */ }
  }
}

/* ── manually entered figures ────────────────────────────────────────────────
 *
 * The page-1 summary table can have four of its cells typed rather than
 * computed. This is not a convenience: the sheet lags, and the Summary goes out
 * on a morning when the operator already knows the correct figure. The pipeline
 * has always supported it (config.manualOverrides, applied in pipeline.cjs);
 * what follows is only the reading and writing of those values.
 *
 * Stored in RUPEES because that is what the pipeline reads. Shown and accepted
 * in CRORE because that is what the operator has in front of them. The
 * conversion happens here, once, at the boundary — nowhere else in the platform
 * or the panel needs to know rupees exist.
 */
const CR = 1e7;
const toCrore = (v: unknown): number | null =>
  v === null || v === undefined || v === '' ? null : Number(v) / CR;

/** IST, because the sheet's own dates are. dd.mm.yyyy to match how the report
 *  and the sheet both write one (e.g. a run's own "asOn": "08.09.2026"). */
const IST_OFFSET_MIN = 330;
function istDMY(d = new Date(Date.now() + IST_OFFSET_MIN * 60000)): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
}

export interface OverrideView {
  totalExpenditure: number | null;
  balance: number | null;
  dayTotal: number | null;
  totalAssigned: number | null;
  totalAssignedFixed: boolean;
  /** The cumulative total a day's spend is added to, and the date it is good at. */
  baselineExpenditure: number | null;
  baselineAsOn: string | null;
  /** Assigned as the latest report stated it — what a balance is struck against. */
  computedAssigned: number | null;
}

function viewOverrides(config: store.ReportConfig, latest: { totals?: unknown } | null): OverrideView {
  const o = (config.manualOverrides ?? {}) as Record<string, unknown>;
  const base = (config.expenditureBaseline ?? {}) as Record<string, unknown>;
  const totals = (latest?.totals ?? null) as { assigned?: number } | null;
  return {
    totalExpenditure: toCrore(o.totalExpenditure),
    balance: toCrore(o.balance),
    dayTotal: toCrore(o.dayTotal),
    totalAssigned: toCrore(o.totalAssigned),
    totalAssignedFixed: !!o.totalAssignedFixed,
    baselineExpenditure: toCrore(base.amount),
    baselineAsOn: (base.asOn as string) ?? null,
    computedAssigned: totals?.assigned == null ? null : totals.assigned / CR,
  };
}

export interface OverrideInput {
  totalExpenditure?: unknown;
  balance?: unknown;
  dayTotal?: unknown;
  totalAssigned?: unknown;
  totalAssignedFixed?: unknown;
}

const FIELD_LABEL: Record<string, string> = {
  totalExpenditure: 'Total Expenditure',
  balance: 'Balance',
  dayTotal: "Yesterday's Total",
  totalAssigned: 'Total Assigned',
};

/**
 * Save what was typed. Blank means "work it out", so every field is optional
 * and a missing one is cleared rather than left alone — the form always sends
 * all four, and a partial save that silently kept an old figure would be the
 * worst kind of wrong here.
 *
 * Throws with a message meant for the operator; the route turns that into a 400.
 */
export async function saveOverrides(input: OverrideInput): Promise<{
  applied: string[];
  overrides: OverrideView;
}> {
  const clean = (key: keyof OverrideInput): number | null => {
    const v = input[key];
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(`"${FIELD_LABEL[key]}" must be a number in crore, or left blank.`);
    if (n < 0) throw new Error(`"${FIELD_LABEL[key]}" cannot be negative.`);
    /* Rounded to the rupee: crore-to-rupee is a multiply by 1e7, and a plain
       float multiply leaves noise past that (209.116 * 1e7 = 2091160000.0000002,
       which is exactly the drift already sitting in the seed config). Money
       does not carry fractions of a rupee, so there is nothing lost in rounding
       and nothing gained in keeping the noise. */
    return Math.round(n * CR);
  };

  const assigned = clean('totalAssigned');
  const config = await store.getConfig();
  const totalExpenditure = clean('totalExpenditure');
  const next = {
    ...((config.manualOverrides ?? {}) as Record<string, unknown>),
    totalExpenditure,
    balance: clean('balance'),
    dayTotal: clean('dayTotal'),
    totalAssigned: assigned,
    /* Fixing is what makes Total Assigned stick. Without the flag the figure is
       remembered but not applied, so clearing the tick goes back to the computed
       total without losing what was typed. */
    totalAssignedFixed: assigned != null && !!input.totalAssignedFixed,
  };
  config.manualOverrides = next;

  /*
   * Total Expenditure is a running total, not a one-off correction: whatever
   * figure is in force after this save becomes tomorrow's starting point, the
   * way the operator actually works — "yesterday's total" is added to the LAST
   * figure that was fixed, not to a number left over from whenever the config
   * was first seeded. Advancing the baseline here, on every save that leaves an
   * expenditure figure in force, is what makes that automatic: the next time a
   * day's figure is entered, autoOvRecalc on the panel adds it to this value,
   * because that is what /api/reports/status will now report back as
   * baselineExpenditure.
   *
   * Only forward, and only while there is a figure. A save that CLEARS Total
   * Expenditure (going back to the sheet's own figure) leaves the baseline
   * exactly where it stood — clearing means "this report doesn't need an
   * override," not "forget what the running total was," and the next manual
   * entry should still be able to pick up where the last one left off.
   */
  if (totalExpenditure != null) {
    config.expenditureBaseline = {
      ...((config.expenditureBaseline ?? {}) as Record<string, unknown>),
      asOn: istDMY(),
      amount: totalExpenditure,
    };
  }

  await store.saveConfig(config);

  const applied = (['totalAssigned', 'totalExpenditure', 'balance', 'dayTotal'] as const)
    .filter((k) => (k === 'totalAssigned' ? next.totalAssignedFixed : next[k] != null))
    .map((k) => FIELD_LABEL[k] as string);
  return { applied, overrides: viewOverrides(config, null) };
}

/** Everything the panel needs in one call. */
export async function status(): Promise<Record<string, unknown>> {
  const [config, latest, running, runs] = await Promise.all([
    store.getConfig(),
    store.latestSuccess(),
    store.runningRun(),
    store.listRuns(12),
  ]);
  return {
    overrides: viewOverrides(config, latest),
    running: !!running || isRunning(),
    runningSince: running?.at ?? null,
    latest,
    runs,
    pdf: { available: !!pdfgen().findBrowser() },
    source: {
      sheetId: (config.googleSheets as Record<string, unknown>)?.sheetId ?? null,
      live: (config.googleSheets as Record<string, unknown>)?.enabled !== false,
    },
  };
}
