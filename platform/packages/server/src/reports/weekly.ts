/**
 * The weekly Regional Centre report — the two-page document.
 *
 * Page 1, the Regional Centre leaderboard, and page 2, component spending over
 * the same week, both already exist in the vendored pipeline as PDF pages, and
 * page 1 exists there as a Word page too (written upstream, never called — see
 * vendor patch 6). What did not exist anywhere is a Word rendering of page 2,
 * or any way to produce the pair on a day that is not a Monday. Both are here.
 *
 * WHY THIS IS BUILT HERE RATHER THAN LEFT TO THE PIPELINE. The pipeline emits
 * the weekly PDF itself, but only on Mondays, and it works page 2 out as
 * "everything since the last snapshot" — which on a Monday is exactly one week
 * and on a Wednesday is two days still captioned as a week. A report produced
 * on demand has to say the same thing whichever day it is asked for, so both
 * pages are built here from one decision about which week is being reported:
 * the last COMPLETED Monday-Sunday week, the same one page 1 has always used.
 * The PDF and the Word file are then rendered from that single set of figures,
 * which is what stops them ever disagreeing.
 */

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require_ = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

/* Required lazily and by absolute path, exactly as service.ts does: these are
   CommonJS, and the working directory they read is only set up around a run. */
const layout = (): any => require_(join(__dirname, 'vendor', 'report-layout.cjs'));
const snapshotMod = (): any => require_(join(__dirname, 'vendor', 'snapshot.cjs'));
const dscMod = (): any => require_(join(__dirname, 'vendor', 'dsc.cjs'));
const pdfgen = (): any => require_(join(__dirname, 'vendor', 'pdfgen.cjs'));
/* docx through createRequire too, rather than an ESM import: the vendored
   layout this file composes with loads it the same way, and both must end up
   with the SAME module instance or the class checks inside docx fail. */
const docxLib = (): any => require_('docx');

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ── the week being reported ──────────────────────────────────────────────────

/** Monday of the week containing this ISO date. */
export function mondayOfISO(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  const shift = (dt.getUTCDay() + 6) % 7;          // Monday = 0
  dt.setUTCDate(dt.getUTCDate() - shift);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`;
}

/** A stored snapshot turned back into the division shape componentsFrom reads.
 *  Round-trips exactly: the snapshot rows carry every field it keys on. */
function divisionsFromSnapshot(snap: any): any[] {
  const by = new Map<string, any>();
  for (const c of snap?.components ?? []) {
    let d = by.get(c.division);
    if (!d) {
      d = { key: c.division, label: c.divisionLabel, cardPrefix: c.divisionLabel, components: [] };
      by.set(c.division, d);
    }
    d.components.push({
      name: c.name,
      label: c.label ?? c.name,
      section: c.section ?? '',
      expenditure: Number(c.expenditure) || 0,
    });
  }
  return [...by.values()];
}

/**
 * Component movement across the last COMPLETED week — this week's Monday
 * snapshot minus the one before it.
 *
 * Snapshot against snapshot, never against today's live figures: today's
 * figures include days that belong to the week now in progress, and folding
 * those into a page captioned "Last Week" would overstate it by however many
 * days have passed since Monday. Returns null when this week's Monday has no
 * snapshot yet, and the caller falls back to the pipeline's own reading.
 */
export function componentWeekForCompletedWeek(todayISO: string): any | null {
  const snap = snapshotMod();
  const monday = mondayOfISO(todayISO);
  const here = (snap.readAll() as any[]).find((s) => s.takenOn === monday);
  if (!here) return null;
  const [y, m, d] = monday.split('-').map(Number);
  /* Local-component Date, because isoKey() inside the vendored module reads
     local date fields - a UTC-built date can land a day either side. */
  return snap.componentWeeklySpend(new Date(y!, m! - 1, d!), divisionsFromSnapshot(here));
}

/** Last completed Monday-Sunday Regional Centre spend, from the run's own workbook. */
export function leaderboardForCompletedWeek(masterFile: string, today: Date): any | null {
  const lb = dscMod().weeklyRegionalCentreLeaderboard(masterFile, today);
  return lb && lb.rows && lb.rows.length ? lb : null;
}

// ── page 2, in Word ──────────────────────────────────────────────────────────

function dayLabel(iso: string): string {
  const [y, m, d] = String(iso).split('-').map(Number);
  if (!y || !m || !d) return String(iso);
  return `${String(d).padStart(2, '0')} ${MON[m - 1]} ${y}`;
}

/** "Khelo India Centres NR" reads as "(Non-Recurring)" on the page, as in the PDF. */
const fullName = (r: any): string => String(r.name).replace(/\s+NR$/i, ' (Non-Recurring)');

/**
 * Component spending, page 2, drawn with the same cards, rules and bars the
 * vendored Word layout uses for every other page — a division tag beside the
 * component name, a share pill and single-fill bar, the running total beside
 * the week's own movement. The quiet components are named in one collapsed
 * row rather than left out, exactly as the PDF does it.
 */
export function componentWeekPage(cw: any): any[] {
  const L = layout();
  const { TableRow, TableCell, WidthType, ShadingType, AlignmentType, VerticalAlign } = docxLib();
  const { INK, MUTED, GREEN, RED, HEAD_BG } = L.PALETTE;
  const { NO_BORDERS, ROW_LINE } = L.BORDERS;

  const top = cw.rows[0];
  const maxDelta = (top && top.delta) || 1;
  const idle = cw.idleRows ?? [];

  const tagFill = (division: string) =>
    division === 'KI-1' ? '2A78D6' : division === 'KI-2' ? '4A3AA7' : 'EB6834';

  /* The division tag and the component name, as the PDF sets them: a filled
     pill then the name. Word has no pill, so the pill is a shaded cell. */
  const compCell = (r: any) => L.table([new TableRow({
    cantSplit: true,
    children: [
      new TableCell({
        children: [L.para(L.txt(r.divisionLabel, { size: 12, bold: true, color: 'FFFFFF' }),
          { align: AlignmentType.CENTER })],
        width: { size: 620, type: WidthType.DXA },
        shading: { type: ShadingType.CLEAR, fill: tagFill(r.division), color: 'auto' },
        borders: NO_BORDERS,
        margins: { top: 20, bottom: 20, left: 40, right: 40 },
        verticalAlign: VerticalAlign.CENTER,
      }),
      new TableCell({
        children: [L.para(L.txt(fullName(r), { size: 17, bold: true }))],
        borders: NO_BORDERS,
        margins: { top: 0, bottom: 0, left: 90, right: 0 },
        verticalAlign: VerticalAlign.CENTER,
      }),
    ],
  })], { borders: NO_BORDERS });

  /* The division split card carries two figures, one per division, where every
     other card carries one. The larger division leads and the rest follow in
     the sub-caption, so the card keeps the shape of its neighbours. */
  const split = (cw.byDivision ?? []) as any[];
  const splitLead = split.length ? `${split[0].label} ${L.lbAmount(split[0].total)}` : '—';
  const splitRest = split.slice(1).map((s) => `${s.label} ${L.lbAmount(s.total)}`).join(' · ');

  const out: any[] = [
    L.line('Component Spending — Last Week', { bold: true, size: 26, after: 60, pageBreakBefore: true }),
    L.line(`Movement between ${dayLabel(cw.baselineOn)} and ${dayLabel(cw.takenOn)}`,
      { size: 15, color: MUTED, after: 140 }),
    L.cardRow([
      L.statCard('Total Component Spend', L.lbAmount(cw.total),
        `${cw.rows.length} of ${cw.considered} components moved`, GREEN, 'spend'),
      L.statCard('Division Split This Week', splitLead, splitRest || 'one division moved', null, 'assign'),
      L.statCard('Fastest Moving Component', top ? fullName(top) : '—',
        top ? `${L.lbAmount(top.delta)} · ${top.share.toFixed(1)}% of the week` : '', null, 'spend'),
      L.statCard('No Movement', String(cw.idle),
        `component${cw.idle === 1 ? '' : 's'} unchanged all week`, RED, 'balance'),
    ]),
    L.blank(160),
    L.line('Spending by component', { bold: true, size: 20, after: 80 }),
  ];

  const th = (t: string, right?: boolean) => L.cell(
    [L.para(L.txt(t, { size: 13, bold: true, color: MUTED }), right ? { align: AlignmentType.RIGHT } : {})],
    { fill: HEAD_BG, borders: ROW_LINE },
  );
  const header = new TableRow({
    cantSplit: true,
    children: [th('RANK'), th('COMPONENT'), th('SHARE OF WEEK'), th('TOTAL TO DATE', true), th('SPENT THIS WEEK', true)],
  });

  const rows = cw.rows.map((r: any) => new TableRow({
    cantSplit: true,
    children: [
      L.cell([L.para(L.txt(String(r.rank), { size: 17, bold: true, color: r.rank <= 3 ? INK : MUTED }))],
        { width: 6, borders: ROW_LINE, valign: VerticalAlign.CENTER }),
      L.cell([compCell(r)], { width: 34, borders: ROW_LINE, valign: VerticalAlign.CENTER }),
      L.cell([L.shareOverview(r.share, (r.delta / maxDelta) * 100)],
        { width: 28, borders: ROW_LINE, valign: VerticalAlign.CENTER, margins: { top: 40, bottom: 40, left: 90, right: 90 } }),
      L.cell([L.para(L.txt(L.lbAmount(r.current), { size: 16, color: MUTED }), { align: AlignmentType.RIGHT })],
        { width: 16, borders: ROW_LINE, valign: VerticalAlign.CENTER }),
      L.cell([L.para(L.txt(L.lbAmount(r.delta), { size: 17, bold: true, color: GREEN }), { align: AlignmentType.RIGHT })],
        { width: 16, borders: ROW_LINE, valign: VerticalAlign.CENTER }),
    ],
  }));

  if (idle.length) {
    rows.push(new TableRow({
      cantSplit: true,
      children: [
        L.cell([L.para(L.txt('—', { size: 17, color: MUTED }))], { borders: ROW_LINE, valign: VerticalAlign.CENTER }),
        L.cell(idle.map((r: any) => compCell(r)), { borders: ROW_LINE, valign: VerticalAlign.CENTER }),
        L.cell([L.line('no spend this week', { size: 13, italics: true, color: MUTED })],
          { borders: ROW_LINE, valign: VerticalAlign.CENTER }),
        L.cell([], { borders: ROW_LINE }),
        L.cell([L.para(L.txt('₹0', { size: 17, bold: true, color: MUTED }), { align: AlignmentType.RIGHT })],
          { borders: ROW_LINE, valign: VerticalAlign.CENTER }),
      ],
    }));
  }

  rows.push(new TableRow({
    cantSplit: true,
    children: [
      L.cell([], { fill: HEAD_BG, borders: NO_BORDERS }),
      L.cell([L.line('Total', { bold: true, size: 17 })], { fill: HEAD_BG, borders: NO_BORDERS }),
      L.cell([], { fill: HEAD_BG, borders: NO_BORDERS }),
      L.cell([], { fill: HEAD_BG, borders: NO_BORDERS }),
      L.cell([L.para(L.txt(L.lbAmount(cw.total), { bold: true, size: 17, color: GREEN }), { align: AlignmentType.RIGHT })],
        { fill: HEAD_BG, borders: NO_BORDERS }),
    ],
  }));

  out.push(L.table([header, ...rows], { borders: NO_BORDERS }));
  return out;
}

// ── the documents ────────────────────────────────────────────────────────────

export interface WeeklyInput {
  leaderboard: any | null;
  componentWeek: any | null;
  asOn?: string;
  stamp?: string;
}

/**
 * The Word copy. Page 1 is the vendored layout's own leaderboard page, so the
 * Word and PDF versions of it are the same design by construction rather than
 * by two people keeping two files in step; page 2 is the one above. Landscape,
 * because the PDF's own @page rule is A4 landscape and a five-column table
 * with a bar in it does not fit portrait.
 */
export async function buildWeeklyDocx(input: WeeklyInput): Promise<Buffer | null> {
  const { Document, Packer, PageOrientation } = docxLib();
  const L = layout();

  const children: any[] = [];
  if (input.leaderboard) children.push(...L.leaderboardPage(input.leaderboard));
  if (input.componentWeek) children.push(...componentWeekPage(input.componentWeek));
  if (!children.length) return null;

  const doc = new Document({
    creator: 'SAI Expenditure Automation',
    title: `Weekly Leaderboard ${input.asOn ?? ''}`.trim(),
    sections: [{
      properties: { page: { size: { orientation: PageOrientation.LANDSCAPE }, margin: { top: 620, right: 620, bottom: 620, left: 620 } } },
      children,
    }],
  });
  return Packer.toBuffer(doc);
}

/** The HTML the weekly PDF prints from — the vendored generator, unchanged. */
export function buildWeeklyHtml(input: WeeklyInput): string | null {
  return pdfgen().generateWeeklyHtml({
    leaderboard: input.leaderboard,
    componentWeek: input.componentWeek,
    asOn: input.asOn,
  });
}
