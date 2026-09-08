'use strict';
const { Document, Packer, Paragraph, TextRun, PageOrientation } = require('docx');
const { toCr, dotDate } = require('./util.cjs');
const { reportLayout } = require('./report-layout.cjs');

const MONO = 'Consolas';
/** A rule exactly as wide as the table it sits under. */
const rule = width => '━'.repeat(width);

/** "₹100.86 Cr" right-aligned into a fixed width. */
const money = (rs, width) => `₹${toCr(rs).toFixed(2)} Cr`.padStart(width || 0);
const plain = (rs, width) => toCr(rs).toFixed(2).padStart(width || 0);

function line(text, opts = {}) {
  return new Paragraph({
    spacing: { after: opts.after == null ? 0 : opts.after, line: 240 },
    children: [new TextRun({
      text,
      font: MONO,
      size: opts.size || 20,          // half-points: 20 = 10pt
      bold: !!opts.bold,
      color: opts.color,
    })],
  });
}

const blank = () => line('');

/** Layout 1 — the EXPENDITURE SUMMARY.docx division table. */
function divisionLayout(data) {
  const { divisions, totals, day, asOn } = data;
  const NAME = Math.max(18, ...divisions.map(d => d.label.length + 2));
  const COL = 13;
  const RULE = rule(NAME + COL * 3);
  const out = [];

  out.push(line(`EXPENDITURE SUMMARY (as on ${asOn})`, { bold: true, size: 24, after: 160 }));
  out.push(line(`${'Total Assigned'.padEnd(32)}${money(totals.assigned, 12)}`));
  out.push(line(`${'Total Expenditure'.padEnd(32)}${money(totals.expenditure, 12)}`));
  out.push(line(`${'BALANCE'.padEnd(32)}${money(totals.balance, 12)}`, { bold: true }));
  out.push(line(`${"Yesterday's Total Expenditure".padEnd(32)}${money(day.total, 12)}`, { after: 160 }));

  out.push(line(`${'DIVISION'.padEnd(NAME)}${'ASSIGNMENT'.padStart(COL)}${'EXPENDITURE'.padStart(COL)}${'BALANCE'.padStart(COL)}`, { bold: true }));
  out.push(line(RULE));
  for (const d of divisions) {
    out.push(line(`${d.label.padEnd(NAME)}${money(d.assigned, COL)}${money(d.expenditure, COL)}${money(d.balance, COL)}`));
  }
  out.push(line(RULE));
  out.push(line(`${'TOTAL'.padEnd(NAME)}${money(totals.assigned, COL)}${money(totals.expenditure, COL)}${money(totals.balance, COL)}`, { bold: true }));
  return out;
}

/** Layout 2 — the EXPENDITURE SUMMARY2.docx balance view. */
function balanceLayout(data) {
  const { divisions, totals, day, asOn } = data;
  const NAME = Math.max(22, ...divisions.map(d => d.label.length + 2));
  const HEAD = 'BALANCE(₹ in Crore)';
  const THIN = rule(NAME + HEAD.length);
  const out = [];

  out.push(line(`EXPENDITURE SUMMARY (as on: ${asOn})`, { bold: true, size: 24, after: 160 }));
  out.push(line(`Total Assigned: ${money(totals.assigned)}`));
  out.push(line(`Total Expenditure: ${money(totals.expenditure)}`));
  out.push(line(THIN));
  out.push(line(`BALANCE: ${money(totals.balance)} (Incl. RC = ${money(totals.rcUnutilised)})`, { bold: true }));
  out.push(line(THIN));
  out.push(line(`${'DIVISION'.padEnd(NAME)}${HEAD}`, { bold: true }));
  out.push(line(THIN));
  for (const d of divisions) {
    out.push(line(`${d.label.padEnd(NAME)}${plain(d.balance, HEAD.length)}`));
  }
  out.push(line(THIN));
  out.push(line(`${'TOTAL'.padEnd(NAME)}${plain(totals.balance, HEAD.length)}`, { bold: true, after: 160 }));

  out.push(line(`YESTERDAY EXPENDITURE: Total=${money(day.total)}`, { bold: true }));
  out.push(line(`Regional Center = ${money(day.byStream.RC || 0)}`));
  return out;
}

const LAYOUTS = { division: divisionLayout, balance: balanceLayout, report: reportLayout };

/* The report layout puts two divisions side by side — it needs the width. */
const LANDSCAPE = new Set(['report']);

/** Build a .docx buffer for one layout. */
async function buildDoc(format, result, opts = {}) {
  const layout = LAYOUTS[format];
  if (!layout) throw new Error(`Unknown Word format "${format}". Known: ${Object.keys(LAYOUTS).join(', ')}`);

  const asOn = opts.asOn || dotDate(result.day.date || new Date());
  const children = layout({
    ...result, asOn,
    rcDisplayOrder: opts.rcDisplayOrder,
    leaderboard: opts.leaderboard,
  });

  if (opts.includeNotes && result.warnings.length) {
    children.push(blank());
    children.push(line('Notes', { bold: true, size: 16 }));
    for (const w of result.warnings) children.push(line(`• ${w}`, { size: 16, color: '888888' }));
  }

  const page = { margin: { top: 620, right: 620, bottom: 620, left: 620 } };
  if (LANDSCAPE.has(format)) {
    page.size = { orientation: PageOrientation.LANDSCAPE };
  }

  const doc = new Document({
    creator: 'SAI Expenditure Automation',
    title: `Expenditure Summary ${asOn}`,
    sections: [{ properties: { page }, children }],
  });
  return Packer.toBuffer(doc);
}

module.exports = { buildDoc, LAYOUTS };
