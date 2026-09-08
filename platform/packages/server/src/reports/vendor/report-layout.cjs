'use strict';
/*
 * The "report" Word layout — a direct rendering of the Expenditure Summary
 * Report PDF: header block + yesterday's distribution grid, KI-1 and KI-2 side
 * by side with their stat cards and component panels, SAI-INFRA beneath, and a
 * Regional Centre page.
 *
 * Word cannot draw the PDF's rounded icon cards, so a "card" here is a shaded,
 * hairline-bordered table cell and a "progress bar" is a two-cell table shaded
 * to the right proportions. Everything else — the figures, the groupings, the
 * badges, the colour coding — is reproduced as-is.
 */
const {
  Paragraph, TextRun, ImageRun, Table, TableRow, TableCell,
  WidthType, BorderStyle, AlignmentType, VerticalAlign, ShadingType, TableLayoutType,
} = require('docx');
const { toCr, toNum, cr, crOrLakh } = require('./util.cjs');
const { iconImage } = require('./icons.cjs');

/* ---------- palette (hex, no #) ---------- */
const INK = '111827';
const MUTED = '6B7280';
const GREEN = '15803D';
const RED = 'B91C1C';
const CARD_BG = 'F7F8FA';
const HEAD_BG = 'F1F5F9';
const HILITE = 'FFF176';
const LINE = 'D8DEE7';
const BAR_USED = '17803D';
const BAR_FREE = 'E8734A';
const BRAND = '2A5BD7';    // the dashboard's blue — utilisation %, section rules
const FONT = 'Calibri';

/* Component dot colours — the categorical palette validated earlier. */
const DOTS = ['2A78D6', 'EB6834', '1BAF7A', 'EDA100', 'E87BA4', '4A3AA7', 'E34948', '008300'];

/* ---------- small helpers ---------- */
const txt = (text, o = {}) => new TextRun({
  text: String(text),
  font: FONT,
  size: o.size || 18,          // half-points: 18 = 9pt
  bold: !!o.bold,
  italics: !!o.italics,
  color: o.color || INK,
  highlight: o.highlight,
});

const para = (children, o = {}) => new Paragraph({
  children: Array.isArray(children) ? children : [children],
  alignment: o.align,
  pageBreakBefore: !!o.pageBreakBefore,
  spacing: { before: o.before || 0, after: o.after == null ? 0 : o.after, line: 240 },
});

const line = (text, o = {}) => para(txt(text, o), o);
const blank = (after = 60) => para([], { after });

const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const NO_BORDERS = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder,
                     insideHorizontal: noBorder, insideVertical: noBorder };
const hair = { style: BorderStyle.SINGLE, size: 2, color: LINE };
const BOX = { top: hair, bottom: hair, left: hair, right: hair,
              insideHorizontal: hair, insideVertical: hair };
/*
 * A clean row-separator style — a bottom hairline only, no verticals and no
 * outer frame. Word's default full grid (BOX, above) reads as a spreadsheet;
 * the dashboard's own component lists have no vertical rules at all, just a
 * line between rows, so this is what the component tables use instead.
 */
const ROW_LINE = { top: noBorder, bottom: hair, left: noBorder, right: noBorder,
                    insideHorizontal: noBorder, insideVertical: noBorder };
const CAP_BG = 'EEF2FC';   // the tinted bar behind "Components of KI 1"

function cell(children, o = {}) {
  return new TableCell({
    children: children.length ? children : [para([])],
    width: o.width ? { size: o.width, type: o.type || WidthType.PERCENTAGE } : undefined,
    columnSpan: o.span,
    verticalAlign: o.valign || VerticalAlign.TOP,
    shading: o.fill ? { type: ShadingType.CLEAR, fill: o.fill, color: 'auto' } : undefined,
    borders: o.borders,
    margins: o.margins || { top: 60, bottom: 60, left: 90, right: 90 },
  });
}

const table = (rows, o = {}) => new Table({
  rows,
  width: { size: o.width == null ? 100 : o.width, type: o.type || WidthType.PERCENTAGE },
  borders: o.borders || NO_BORDERS,
  columnWidths: o.columnWidths,
  layout: o.layout,
});

/* ---------- building blocks ---------- */

/*
 * Pale icon-badge tints, one per card kind — the dashboard's own colour
 * coding — each paired with the pictogram that card carries.
 */
const ICON = {
  assign: { bg: 'E4EFFC', fg: '2A78D6', icon: 'card' },
  spend:  { bg: 'E1F6E9', fg: '15803D', icon: 'database' },
  balance:{ bg: 'FCE9DE', fg: 'E8734A', icon: 'scale' },
  count:  { bg: '2A78D6', fg: 'FFFFFF', icon: 'layers' },
};

/**
 * A small square icon badge standing in for the dashboard's SVG icon.
 *
 * The tint has to live on a *nested* fixed-width table, not on this outer
 * cell: cells in a row all stretch to the tallest one, so shading the outer
 * cell painted a full-height colour bar down the side of the card (and left
 * the glyph floating beside the value like a stray bullet). Nesting keeps the
 * colour confined to a compact chip, top-aligned beside the label — which is
 * where the dashboard puts its icon.
 */
const BADGE_SIZE = 300;   // dxa; ~a line tall, so the chip reads square
function iconBadge(kind) {
  const c = ICON[kind] || ICON.assign;
  const chip = table([new TableRow({ cantSplit: true, children: [
    new TableCell({
      children: [para(new ImageRun(iconImage(c.icon, c.fg, 11)), { align: AlignmentType.CENTER })],
      width: { size: BADGE_SIZE, type: WidthType.DXA },
      shading: { type: ShadingType.CLEAR, fill: c.bg, color: 'auto' },
      verticalAlign: VerticalAlign.CENTER,
      margins: { top: 40, bottom: 40, left: 0, right: 0 },
    }),
  ] })], { width: BADGE_SIZE, type: WidthType.DXA });

  return new TableCell({
    children: [chip],
    width: { size: BADGE_SIZE + 40, type: WidthType.DXA },
    verticalAlign: VerticalAlign.TOP,
    margins: { top: 20, bottom: 0, left: 0, right: 0 },
  });
}

/**
 * A stat card: icon badge, small caps label, large value, muted sub-caption.
 * These sit two-up (full page width) on the Regional Centre page but three-up
 * inside a half-width division column, so the value size has to survive the
 * narrower case — kept small enough that "₹160.80 Cr" never wraps.
 */
function statCard(label, value, sub, valueColor, iconKind) {
  const body = cell([
    // Title case, not caps — the dashboard labels these "KI 1 Assignment".
    line(label, { size: 13, color: MUTED, after: 40 }),
    line(value, { size: 24, bold: true, color: valueColor || INK, after: 30 }),
    ...(sub ? [line(sub, { size: 12, color: MUTED })] : []),
  ], { borders: NO_BORDERS, valign: VerticalAlign.CENTER, margins: { top: 0, bottom: 0, left: 90, right: 0 } });

  const inner = table([new TableRow({ cantSplit: true, children: [iconBadge(iconKind), body] })], { borders: NO_BORDERS });
  return cell([inner], { fill: CARD_BG, borders: BOX, valign: VerticalAlign.CENTER });
}

/** A row of stat cards, evenly split. */
function cardRow(cards) {
  const w = Math.floor(100 / cards.length);
  return table([new TableRow({ cantSplit: true,
    children: cards.map(c => { c.options.width = { size: w, type: WidthType.PERCENTAGE }; return c; }),
  })]);
}

/**
 * A utilisation bar: one table, two shaded cells sized to the split. Word has
 * no progress-bar primitive, so the proportion *is* the cell width.
 */
function barTable(pct) {
  const used = Math.max(0, Math.min(100, Math.round(pct)));
  const free = 100 - used;
  const seg = (size, fill, label) => new TableCell({
    children: [para(txt(label || '', { size: 12, bold: true, color: 'FFFFFF' }), { align: AlignmentType.CENTER })],
    width: { size: Math.max(size, 1), type: WidthType.PERCENTAGE },
    shading: { type: ShadingType.CLEAR, fill, color: 'auto' },
    margins: { top: 20, bottom: 20, left: 20, right: 20 },
  });
  const cells = [];
  if (used > 0) cells.push(seg(used, BAR_USED, used >= 22 ? `${used}% Used` : ''));
  if (free > 0) cells.push(seg(free, BAR_FREE, free >= 22 ? `${free}% Balance` : ''));
  return table(cells.length ? [new TableRow({ cantSplit: true, children: cells })] : [new TableRow({ cantSplit: true, children: [seg(100, BAR_FREE, '')] })]);
}

/**
 * The leading percentage pill beside a utilisation bar. High utilisation is
 * green here (a Regional Centre is drawing down what it was given — good);
 * low utilisation is amber (released funds sitting unspent).
 */
function pctPill(pct) {
  const good = pct >= 70;
  const bg = good ? 'DCFCE7' : 'FEF3C7';
  const fg = good ? '15803D' : '92400E';
  return new TableCell({
    children: [para(txt(`${Math.round(pct)}%`, { size: 13, bold: true, color: fg }), { align: AlignmentType.CENTER })],
    width: { size: 620, type: WidthType.DXA },
    shading: { type: ShadingType.CLEAR, fill: bg, color: 'auto' },
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 20, bottom: 20, left: 0, right: 0 },
  });
}

/** Pill beside the bar, exactly as the dashboard renders a centre's row. */
function utilisationOverview(pct) {
  return table([new TableRow({ cantSplit: true, children: [
    pctPill(pct),
    new TableCell({ children: [barTable(pct)], margins: { top: 0, bottom: 0, left: 90, right: 0 } }),
  ] })], { borders: NO_BORDERS });
}

/**
 * "Recurring" / "Non-Recurring" chip under a component name. Run-level shading
 * gives a real tinted pill (the dashboard's own treatment) rather than the
 * plain grey caption this used to be — recurring blue, non-recurring violet.
 */
const SECTION_PILL = {
  'NON-RECURRING': { label: 'Non-Recurring', bg: 'EDE9FE', fg: '5B21B6' },
  INFRASTRUCTURE:  { label: 'Infrastructure', bg: 'E2E8F0', fg: '334155' },
  RECURRING:       { label: 'Recurring', bg: 'E4EFFC', fg: '1D4ED8' },
};
const badge = section => {
  const p = SECTION_PILL[section] || SECTION_PILL.RECURRING;
  return para(new TextRun({
    text: ` ${p.label} `,
    font: FONT,
    size: 12,
    bold: true,
    color: p.fg,
    shading: { type: ShadingType.CLEAR, fill: p.bg, color: 'auto' },
  }), { before: 20 });
};

/* ---------- page 1 blocks ---------- */

function headerSummary(d) {
  const rowOf = (label, value, o = {}) => new TableRow({ cantSplit: true,
    children: [
      cell([line(label, { bold: true, size: 19, italics: o.italics })], { width: 62, borders: BOX }),
      cell([line(value, { bold: true, size: 19, color: o.color })], { width: 38, borders: BOX }),
    ],
  });
  return table([
    rowOf('Total Assigned', cr(d.totals.assigned)),
    rowOf('Total Expenditure', cr(d.totals.expenditure), { color: GREEN }),
    rowOf('  BALANCE', cr(d.totals.balance), { color: RED }),
    rowOf("Yesterday's Total Expenditure", cr(d.day.total), { italics: true }),
  ], { borders: BOX });
}

/**
 * The day's claims as the PDF lays them out: a compact grid of name/amount
 * pairs, three pairs per row, amounts in lakhs below a crore.
 */
function distributionGrid(d) {
  const items = (d.day.agencies || []).filter(a => a.amount > 0);
  if (!items.length) {
    return [line('No claims settled in this report.', { size: 16, color: MUTED })];
  }
  // Construction agencies carry long legal names ("National Buildings
  // Construction Corporation Limited [NBCC]") that would wrap this compact
  // grid into a mess — shorten to the recognisable part.
  const shortName = n => {
    const s = String(n).replace(/\s+/g, ' ').trim();
    const bracketed = s.match(/\[([A-Z]{2,8})\]/);        // "... [NBCC]" -> NBCC
    if (bracketed) return bracketed[1];
    return s.length > 26 ? `${s.slice(0, 24).trimEnd()}…` : s;
  };

  const PAIRS = 3;
  const rows = [];
  for (let i = 0; i < items.length; i += PAIRS) {
    const slice = items.slice(i, i + PAIRS);
    const cells = [];
    for (let j = 0; j < PAIRS; j++) {
      const a = slice[j];
      cells.push(cell([line(a ? shortName(a.name) : '', { bold: true, size: 17 })], { width: 20, borders: BOX }));
      cells.push(cell([line(a ? crOrLakh(a.amount) : '', { size: 17, color: a ? GREEN : INK })], { width: 13, borders: BOX }));
    }
    rows.push(new TableRow({ cantSplit: true, children: cells }));
  }
  return [
    line(`Yesterday's Expenditure Distribution   ( ${cr(d.day.total)} )`, { size: 19, after: 80 }),
    table(rows, { borders: BOX }),
  ];
}

/** One division block: highlighted heading, three stat cards, component panel. */
function divisionBlock(div, schemeTotal) {
  const pctOfScheme = schemeTotal ? (div.assigned / schemeTotal) * 100 : 0;
  const funded = div.fundedCount;
  const noSpend = div.noSpendCount || 0;

  const assignSub = funded != null
    ? `${funded} funded component${funded === 1 ? '' : 's'} · ${pctOfScheme.toFixed(1)}% of scheme`
    : `${(div.components || []).length} components · ${pctOfScheme.toFixed(1)}% of scheme`;
  const expSub = `${cr(div.fromCentres)} centres + ${cr(div.fromDirect)} DDO KI Direct`;
  const balPct = div.assigned ? (div.balance / div.assigned) * 100 : 0;

  const heading = div.reportHeading || div.label;
  const prefix = div.cardPrefix || div.label;
  const utilPct = div.assigned ? (div.expenditure / div.assigned) * 100 : 0;

  const out = [];
  if (div.tagline) {
    // KI-1 / KI-2 get the full header card: name + tagline on the left, a
    // prominent utilisation percentage on the right — as the dashboard shows it.
    const left = cell([
      para(txt(` ${heading} `, { bold: true, size: 22, highlight: 'yellow' }), { after: 40 }),
      line(div.tagline, { size: 13, color: MUTED }),
    ], { width: 68, borders: NO_BORDERS, valign: VerticalAlign.CENTER });
    const right = cell([
      para(txt(`${utilPct.toFixed(1)}%`, { bold: true, size: 24, color: BRAND }), { align: AlignmentType.RIGHT }),
      para(txt('utilised', { size: 13, color: MUTED }), { align: AlignmentType.RIGHT }),
    ], { width: 32, borders: NO_BORDERS, valign: VerticalAlign.CENTER });
    out.push(table([new TableRow({ cantSplit: true, children: [left, right] })], { borders: NO_BORDERS }));
    out.push(blank(80));
  } else {
    out.push(para(txt(` ${heading} `, { bold: true, size: 22, highlight: 'yellow' }), { align: AlignmentType.CENTER, after: 100 }));
  }

  out.push(
    cardRow([
      statCard(`${prefix} Assignment`, cr(div.assigned), assignSub, null, 'assign'),
      statCard(`${prefix} Expenditure`, cr(div.expenditure), expSub, GREEN, 'spend'),
      statCard(`${prefix} Balance`, cr(div.balance), `${balPct.toFixed(1)}% still unspent`, RED, 'balance'),
    ]),
    blank(100),
  );

  // A single-component division (SAI-INFRA) gets cards only — a one-row table
  // would just restate them, and the report PDF omits it for the same reason.
  const comps = div.components || [];
  if (comps.length > 1) {
    const header = new TableRow({ cantSplit: true,
      children: [
        cell([line('COMPONENT', { size: 13, bold: true, color: MUTED })], { width: 40, fill: HEAD_BG, borders: ROW_LINE }),
        cell([para(txt('ASSIGNMENT', { size: 13, bold: true, color: MUTED }), { align: AlignmentType.RIGHT })], { width: 20, fill: HEAD_BG, borders: ROW_LINE }),
        cell([para(txt('EXPENDITURE', { size: 13, bold: true, color: MUTED }), { align: AlignmentType.RIGHT })], { width: 20, fill: HEAD_BG, borders: ROW_LINE }),
        cell([para(txt('BALANCE', { size: 13, bold: true, color: MUTED }), { align: AlignmentType.RIGHT })], { width: 20, fill: HEAD_BG, borders: ROW_LINE }),
      ],
    });

    const body = comps.map((c, i) => new TableRow({ cantSplit: true,
      children: [
        cell([
          para([
            txt('● ', { size: 16, color: DOTS[i % DOTS.length] }),
            txt(c.label, { size: 17 }),
          ]),
          badge(c.section),
        ], { borders: ROW_LINE }),
        cell([para(txt(c.target != null ? cr(c.target) : '—', { size: 17 }), { align: AlignmentType.RIGHT })], { borders: ROW_LINE }),
        cell([para(txt(cr(c.expenditure), { size: 17 }), { align: AlignmentType.RIGHT })], { borders: ROW_LINE }),
        cell([para(txt(c.balance != null ? cr(c.balance) : '—', {
          size: 17, color: c.balance != null && c.balance < 0 ? RED : INK,
        }), { align: AlignmentType.RIGHT })], { borders: ROW_LINE }),
      ],
    }));

    const totalRow = new TableRow({ cantSplit: true,
      children: [
        cell([line(`${heading} total`, { bold: true, size: 17 })], { fill: HEAD_BG, borders: NO_BORDERS }),
        cell([para(txt(cr(div.assigned), { bold: true, size: 17 }), { align: AlignmentType.RIGHT })], { fill: HEAD_BG, borders: NO_BORDERS }),
        cell([para(txt(cr(div.expenditure), { bold: true, size: 17 }), { align: AlignmentType.RIGHT })], { fill: HEAD_BG, borders: NO_BORDERS }),
        cell([para(txt(cr(div.balance), { bold: true, size: 17, color: RED }), { align: AlignmentType.RIGHT })], { fill: HEAD_BG, borders: NO_BORDERS }),
      ],
    });

    // "▼ Components of KI 1  ·  N with no spend  ·  (count)" — the dashboard's
    // collapsible-section header, with a trailing count badge, on its own
    // tinted bar (matching the dashboard's section-header treatment).
    const capLeft = cell([line(`▾ Components of ${heading}`, { size: 15, bold: true, color: MUTED })],
      { width: 60, fill: CAP_BG, borders: NO_BORDERS, valign: VerticalAlign.CENTER });
    const capMid = cell(noSpend ? [para(txt(`•  ${noSpend} with no spend`, { size: 13, bold: true, color: 'B45309' }), { align: AlignmentType.RIGHT })] : [],
      { width: 30, fill: CAP_BG, borders: NO_BORDERS, valign: VerticalAlign.CENTER });
    // The blue count badge keeps its own fill (staying a distinct badge, not
    // blending into the bar); a wrapper cell around it carries the bar's own
    // tint so there's no gap of plain white on either side of the badge.
    const countBadge = table([new TableRow({ cantSplit: true, children: [
      new TableCell({
        children: [para(txt(String(comps.length), { size: 13, bold: true, color: ICON.count.fg }), { align: AlignmentType.CENTER })],
        width: { size: 400, type: WidthType.DXA },
        shading: { type: ShadingType.CLEAR, fill: ICON.count.bg, color: 'auto' },
        verticalAlign: VerticalAlign.CENTER,
        margins: { top: 20, bottom: 20, left: 0, right: 0 },
      }),
    ] })], { borders: NO_BORDERS });
    const capRight = cell([countBadge], { fill: CAP_BG, borders: NO_BORDERS, valign: VerticalAlign.CENTER, margins: { top: 40, bottom: 40, left: 0, right: 90 } });
    out.push(table([new TableRow({ cantSplit: true, children: [capLeft, capMid, capRight] })], { borders: NO_BORDERS }));
    out.push(blank(60));
    out.push(table([header, ...body, totalRow], { borders: BOX }));
  }
  return out;
}

/* ---------- weekly leaderboard (Mondays only) ---------- */

/**
 * Leaderboard amounts: three decimals once a figure reaches a crore, against
 * the two decimals used everywhere else in the report. At two, a week's spend
 * showed Kolkata and Trivandrum both as "₹1.33 Cr" with ~₹14,000 between them,
 * which reads as a tie in a table that exists to rank them. Sub-crore figures
 * stay in lakhs, where two decimals already separate them.
 */
function lbAmount(rs) {
  const n = toNum(rs);
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(3)} Cr`;
  return `${sign}₹${(abs / 1e5).toFixed(2)} Lakhs`;
}

/**
 * Last week's Regional Centre spend, as a league table. Built from the same
 * pieces as the Regional Centre page below so the two match; returns [] on
 * days with no leaderboard so nothing is emitted at all.
 */
function leaderboardPage(lb) {
  if (!lb || !lb.rows || !lb.rows.length) return [];

  const D = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dayLabel = x => `${D[x.getDay()]} ${String(x.getDate()).padStart(2, '0')} ${M[x.getMonth()]}`;

  const top = lb.rows[0];
  const maxAmount = top.amount || 1;
  const totalClaims = lb.rows.reduce((s, r) => s + r.claims, 0);

  const out = [
    line('Weekly Leaderboard — Regional Centres', { bold: true, size: 26, after: 60 }),
    line(`Previous week · ${dayLabel(lb.start)} – ${dayLabel(lb.end)} ${lb.end.getFullYear()}`,
      { size: 15, color: MUTED, after: 140 }),
    cardRow([
      statCard('Total Spent Last Week', lbAmount(lb.total),
        `${totalClaims} claims across ${lb.centres} centre${lb.centres === 1 ? '' : 's'}`, GREEN, 'spend'),
      statCard('Highest Spending Centre', top.name,
        `${lbAmount(top.amount)} · ${top.share.toFixed(1)}% of the week`, null, 'assign'),
      statCard('Average per Centre', lbAmount(lb.total / lb.centres),
        'across centres that claimed last week', RED, 'balance'),
    ]),
    blank(160),
    line('Spending by centre', { bold: true, size: 20, after: 80 }),
  ];

  const th = (t, right) => cell(
    [para(txt(t, { size: 13, bold: true, color: MUTED }), right ? { align: AlignmentType.RIGHT } : {})],
    { fill: HEAD_BG, borders: ROW_LINE }
  );
  const header = new TableRow({ cantSplit: true, children: [
    th('RANK'), th('REGIONAL CENTRE'), th('SHARE OF WEEK'), th('TOTAL SPENT', true),
  ] });

  const rows = lb.rows.map(r => new TableRow({ cantSplit: true, children: [
    cell([para(txt(String(r.rank), { size: 17, bold: true, color: r.rank <= 3 ? INK : MUTED }))],
      { width: 8, borders: ROW_LINE, valign: VerticalAlign.CENTER }),
    cell([para([
      new ImageRun(iconImage('building', MUTED, 9)),
      txt('  ', { size: 17 }),
      txt(r.name, { bold: true, size: 17 }),
    ])], { width: 22, borders: ROW_LINE, valign: VerticalAlign.CENTER }),
    cell([shareOverview(r.share, (r.amount / maxAmount) * 100)],
      { width: 42, borders: ROW_LINE, valign: VerticalAlign.CENTER, margins: { top: 40, bottom: 40, left: 90, right: 90 } }),
    cell([para(txt(lbAmount(r.amount), { size: 17, bold: true, color: GREEN }), { align: AlignmentType.RIGHT })],
      { width: 26, borders: ROW_LINE, valign: VerticalAlign.CENTER }),
  ] }));

  const totalRow = new TableRow({ cantSplit: true, children: [
    cell([], { fill: HEAD_BG, borders: NO_BORDERS }),
    cell([line('Total', { bold: true, size: 17 })], { fill: HEAD_BG, borders: NO_BORDERS }),
    cell([], { fill: HEAD_BG, borders: NO_BORDERS }),
    cell([para(txt(lbAmount(lb.total), { bold: true, size: 17, color: GREEN }), { align: AlignmentType.RIGHT })],
      { fill: HEAD_BG, borders: NO_BORDERS }),
  ] });

  out.push(table([header, ...rows, totalRow], { borders: NO_BORDERS }));
  return out;
}

/** Share pill plus a single-fill bar — no "balance" half, this is one week's spend. */
function shareOverview(sharePct, barPct) {
  const used = Math.max(1, Math.min(100, Math.round(barPct)));
  const seg = (size, fill) => new TableCell({
    children: [para([])],
    width: { size: Math.max(size, 1), type: WidthType.PERCENTAGE },
    shading: { type: ShadingType.CLEAR, fill, color: 'auto' },
    margins: { top: 20, bottom: 20, left: 20, right: 20 },
  });
  const cells = [seg(used, BAR_USED)];
  if (used < 100) cells.push(seg(100 - used, 'F1F5F9'));

  return table([new TableRow({ cantSplit: true, children: [
    new TableCell({
      children: [para(txt(`${sharePct.toFixed(1)}%`, { size: 13, bold: true, color: GREEN }), { align: AlignmentType.CENTER })],
      width: { size: 700, type: WidthType.DXA },
      shading: { type: ShadingType.CLEAR, fill: 'DCFCE7', color: 'auto' },
      verticalAlign: VerticalAlign.CENTER,
      margins: { top: 20, bottom: 20, left: 0, right: 0 },
    }),
    new TableCell({
      children: [table([new TableRow({ cantSplit: true, children: cells })])],
      margins: { top: 0, bottom: 0, left: 90, right: 0 },
    }),
  ] })], { borders: NO_BORDERS });
}

/* ---------- page 2 ---------- */

function regionalCentrePage(d, o = {}) {
  let rcs = d.regionalCentres || [];
  // A fixed presentation order, confirmed against the live dashboard's own
  // export — it is not a numeric sort, so it has to be stated explicitly.
  const order = d.rcDisplayOrder;
  if (order && order.length) {
    const rank = new Map(order.map((n, i) => [n.toUpperCase(), i]));
    rcs = [...rcs].sort((a, b) => {
      const ra = rank.has(a.name.toUpperCase()) ? rank.get(a.name.toUpperCase()) : 999;
      const rb = rank.has(b.name.toUpperCase()) ? rank.get(b.name.toUpperCase()) : 999;
      return ra - rb;
    });
  }
  const t = d.rcTotals || { limitAssigned: 0, actualExp: 0, unspent: 0 };
  const drawn = t.limitAssigned ? (t.actualExp / t.limitAssigned) * 100 : 0;

  const out = [
    line('Regional Centre Dashboard', { bold: true, size: 26, after: 120, pageBreakBefore: o.pageBreakBefore }),
    cardRow([
      statCard('Assignment to Centres', cr(t.limitAssigned), 'limit released to centres · not expenditure', null, 'assign'),
      statCard('Actual Expenditure by Centres', cr(t.actualExp), `${drawn.toFixed(1)}% of centre limit drawn · centres only`, GREEN, 'spend'),
      statCard('Unspent by Centre', cr(t.unspent), `${(100 - drawn).toFixed(1)}% of limit released, not spent`, RED, 'balance'),
    ]),
    blank(160),
    line('Centre utilisation', { bold: true, size: 20, after: 80 }),
  ];

  const colHead = t => para(txt(`${t}  ⇅`, { size: 13, bold: true, color: MUTED }), { align: t === 'REGIONAL CENTRE' || t === 'UTILISATION OVERVIEW' ? undefined : AlignmentType.RIGHT });
  const header = new TableRow({ cantSplit: true,
    children: [
      cell([colHead('REGIONAL CENTRE')], { width: 20, fill: HEAD_BG, borders: ROW_LINE }),
      cell([line('UTILISATION OVERVIEW', { size: 13, bold: true, color: MUTED })], { width: 28, fill: HEAD_BG, borders: ROW_LINE }),
      cell([colHead('LIMIT ASSIGNED')], { width: 13, fill: HEAD_BG, borders: ROW_LINE }),
      cell([colHead('ACTUAL EXP.')], { width: 13, fill: HEAD_BG, borders: ROW_LINE }),
      cell([colHead('UNSPENT')], { width: 13, fill: HEAD_BG, borders: ROW_LINE }),
      cell([colHead('UTILISATION')], { width: 13, fill: HEAD_BG, borders: ROW_LINE }),
    ],
  });

  const rows = rcs.map(rc => new TableRow({ cantSplit: true,
    children: [
      cell([para([
        new ImageRun(iconImage('building', MUTED, 9)),
        txt('  ', { size: 17 }),
        txt(rc.name, { bold: true, size: 17 }),
      ])], { borders: ROW_LINE, valign: VerticalAlign.CENTER }),
      cell([utilisationOverview(rc.utilisation)], { borders: ROW_LINE, valign: VerticalAlign.CENTER, margins: { top: 40, bottom: 40, left: 90, right: 90 } }),
      cell([para(txt(cr(rc.limitAssigned), { size: 17 }), { align: AlignmentType.RIGHT })], { borders: ROW_LINE, valign: VerticalAlign.CENTER }),
      cell([para(txt(cr(rc.actualExp), { size: 17, color: GREEN }), { align: AlignmentType.RIGHT })], { borders: ROW_LINE, valign: VerticalAlign.CENTER }),
      cell([para(txt(crOrLakh(rc.unspent), { size: 17, color: RED }), { align: AlignmentType.RIGHT })], { borders: ROW_LINE, valign: VerticalAlign.CENTER }),
      cell([para(txt(`${rc.utilisation.toFixed(0)}%`, { size: 17, bold: true }), { align: AlignmentType.RIGHT })], { borders: ROW_LINE, valign: VerticalAlign.CENTER }),
    ],
  }));

  out.push(table([header, ...rows], { borders: NO_BORDERS }));
  out.push(blank(80));
  // Legend, with the bar's own two colours as swatches — as the dashboard
  // prints it beneath the utilisation table.
  out.push(para([
    txt('● ', { size: 14, color: BAR_USED }),
    txt('Used (Utilised)    ', { size: 13, color: MUTED }),
    txt('● ', { size: 14, color: BAR_FREE }),
    txt('Balance (Unutilised)    ', { size: 13, color: MUTED }),
    txt('Amounts in ₹ (Indian Rupees)', { size: 13, color: MUTED }),
  ]));
  return out;
}

/* ---------- the layout itself ---------- */

function reportLayout(data) {
  const { divisions, asOn } = data;
  const byKey = k => divisions.find(d => d.key === k);
  const ki1 = byKey('KI-1');
  const ki2 = byKey('KI-2');
  const infra = byKey('SAI-INFRA');
  const scheme = divisions.filter(d => !d.source).reduce((s, d) => s + d.assigned, 0);

  const out = [];

  // --- title ---
  out.push(new Paragraph({
    children: [
      new TextRun({ text: 'EXPENDITURE SUMMARY', font: FONT, size: 26, bold: true, underline: {} }),
      new TextRun({ text: ` (as on ${asOn})`, font: FONT, size: 26 }),
    ],
    spacing: { after: 200 },
  }));

  // --- header summary beside the distribution grid ---
  // These two large wrapper rows must NOT be cantSplit: they hold everything
  // below them (in the KI-1/KI-2 case, entire component tables), and forcing
  // such a tall row to stay whole makes Word's page-break estimate for it
  // wildly conservative — it was reserving an extra blank page rather than
  // ever risk splitting a row that size. The rows *inside* each column (the
  // individual cards, component lines, table rows) keep cantSplit, which is
  // what actually prevents an ugly mid-card split.
  out.push(table([new TableRow({
    children: [
      cell([headerSummary(data)], { width: 40, margins: { top: 0, bottom: 0, left: 0, right: 260 } }),
      cell(distributionGrid(data), { width: 60, margins: { top: 0, bottom: 0, left: 0, right: 0 } }),
    ],
  })]));
  out.push(blank(240));

  // --- KI-1 and KI-2 side by side ---
  if (ki1 || ki2) {
    out.push(table([new TableRow({
      children: [
        cell(ki1 ? divisionBlock(ki1, scheme) : [], { width: 50, margins: { top: 0, bottom: 0, left: 0, right: 200 } }),
        cell(ki2 ? divisionBlock(ki2, scheme) : [], { width: 50, margins: { top: 0, bottom: 0, left: 200, right: 0 } }),
      ],
    })]));
    // The dashboard closes the KI pair with a full-width arrow rule before
    // dropping into SAI-INFRA. Built as a bordered cell between two arrow
    // glyphs rather than a run of "─" — a character rule's width depends on
    // the glyph metrics and never reliably spans the page.
    const rule = { style: BorderStyle.SINGLE, size: 6, color: BRAND };
    const arrow = g => new TableCell({
      children: [para(txt(g, { size: 16, color: BRAND }), { align: AlignmentType.CENTER })],
      width: { size: 3, type: WidthType.PERCENTAGE },
      borders: NO_BORDERS,
      verticalAlign: VerticalAlign.CENTER,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    });
    out.push(table([new TableRow({ cantSplit: true, children: [
      arrow('◄'),
      new TableCell({
        children: [para([])],
        width: { size: 94, type: WidthType.PERCENTAGE },
        borders: { ...NO_BORDERS, bottom: rule },
        verticalAlign: VerticalAlign.CENTER,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      }),
      arrow('►'),
    ] })], { layout: TableLayoutType.FIXED }));
    out.push(blank(120));
  }

  // --- SAI-INFRA, centred beneath ---
  if (infra) {
    for (const p of divisionBlock(infra, scheme)) out.push(p);
  }

  // --- Regional Centre section ---
  // The forced break is applied only when the leaderboard precedes this: that
  // page ends part-way down, so a break there lands on real content. Without a
  // leaderboard, page 1 already runs to its own natural boundary, and forcing
  // a second break puts a blank page in front of this section (the bug the
  // note below describes) — so the flag has to stay conditional.
  // No explicit page break: an earlier version forced one before this
  // heading, which reliably produced a fully blank page ahead of it (page 1
  // already runs right up to its own natural boundary, so a *second* forced
  // break landed on an empty page of its own). Left to flow naturally, this
  // section simply starts wherever page 1 actually ends — which in practice
  // is the top of page 2, cleanly, with no forced break needed at all.
  for (const p of regionalCentrePage(data)) out.push(p);

  return out;
}

module.exports = { reportLayout };
