'use strict';
const XLSX = require('xlsx');
const { toNum, norm, toDate } = require('./util.cjs');

/* Column synonyms. The RBI export has drifted before, so match loosely. */
const FIELDS = {
  consolidationId: ['consolidationid', 'consolidationno', 'consolidation'],
  transactionId:   ['transactionid', 'transactionno', 'txnid', 'transaction'],
  childAgency:     ['childagencyname', 'childagency', 'agencyname', 'agency'],
  claimAmount:     ['claimamount', 'totalclaimamount', 'amount', 'netamount'],
};

function matchField(cell) {
  const n = norm(cell);
  if (!n) return null;
  for (const [field, keys] of Object.entries(FIELDS)) {
    if (keys.some(k => n === k || n.startsWith(k))) return field;
  }
  return null;
}

/** Locate the header row and which column each field sits in. */
function findHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 60); i++) {
    const map = {};
    rows[i].forEach((cell, j) => {
      const f = matchField(cell);
      if (f && map[f] === undefined) map[f] = j;
    });
    // A real header names the agency and the amount at minimum.
    if (map.childAgency !== undefined && map.claimAmount !== undefined) {
      return { row: i, map };
    }
  }
  return null;
}

/** Pull the report date/time out of the "Date | <date> | Time | <time>" banner above the table. */
function findDateTime(rows, headerRow) {
  let date = null, time = null;
  for (let i = 0; i < headerRow; i++) {
    for (let j = 0; j < rows[i].length; j++) {
      const n = norm(rows[i][j]);
      if (n === 'date' && date == null) date = toDate(rows[i][j + 1]);
      if (n === 'time' && time == null) {
        const t = rows[i][j + 1];
        time = t instanceof Date
          ? t.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
          : (t == null ? null : String(t).trim());
      }
    }
  }
  return { date, time };
}

/**
 * Parse one RBI daily report workbook.
 * Returns { reportDate, reportTime, fundTransferId, grandTotal, claims[], byAgency{} }.
 */
function parseRbiReport(file) {
  const wb = XLSX.readFile(file, { cellDates: true });
  const sheetName = wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
    header: 1, raw: true, blankrows: true, defval: null,
  });

  const header = findHeader(rows);
  if (!header) {
    throw new Error(
      `Could not find a claims table in "${file}" (sheet "${sheetName}").\n` +
      `Expected a header row naming at least "Child Agency Name" and "Claim Amount".`
    );
  }
  const { map } = header;
  const { date, time } = findDateTime(rows, header.row);

  const claims = [];
  const fundTransferIds = [];
  const grandTotals = [];

  for (let i = header.row + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every(c => c == null || c === '')) continue;

    const joined = row.map(norm).join('|');

    // "Fund Transfer ID | C0526... | Grand Total | 33,99,335.00"
    if (joined.includes('fundtransferid')) {
      const idx = row.findIndex(c => norm(c).startsWith('fundtransferid'));
      if (idx >= 0 && row[idx + 1] != null) fundTransferIds.push(String(row[idx + 1]).trim());
    }
    if (joined.includes('grandtotal')) {
      const idx = row.findIndex(c => norm(c).includes('grandtotal'));
      if (idx >= 0) grandTotals.push(toNum(row[idx + 1]));
      continue;
    }
    // A repeated "Date | <date> | Time | <time>" banner between daily blocks.
    if (row.some(c => norm(c) === 'date') || row.some(c => norm(c) === 'time')) continue;
    // Per-consolidation and report-level roll-up rows ("Total", "All Total",
    // "Sub Total", "Grand Total" already handled above) — recomputed, so skip.
    // Matched by suffix, not equality: real exports use "All Total" as well as
    // a bare "Total".
    if (row.some(c => /total$/.test(norm(c)))) continue;
    // A repeated header (multi-block exports sometimes restate it).
    if (matchField(row[map.childAgency]) || matchField(row[map.claimAmount])) continue;

    const agency = row[map.childAgency];
    const amount = toNum(row[map.claimAmount]);
    if (!agency || !String(agency).trim() || !amount) continue;

    claims.push({
      consolidationId: map.consolidationId !== undefined && row[map.consolidationId] != null
        ? String(row[map.consolidationId]).trim() : '',
      transactionId: map.transactionId !== undefined && row[map.transactionId] != null
        ? String(row[map.transactionId]).trim() : '',
      childAgency: String(agency).trim(),
      claimAmount: amount,
    });
  }

  if (!claims.length) {
    throw new Error(`Found a header in "${file}" but no claim rows beneath it.`);
  }

  const byAgency = {};
  for (const c of claims) {
    if (!byAgency[c.childAgency]) byAgency[c.childAgency] = { agency: c.childAgency, total: 0, count: 0 };
    byAgency[c.childAgency].total += c.claimAmount;
    byAgency[c.childAgency].count++;
  }

  const computed = claims.reduce((s, c) => s + c.claimAmount, 0);
  // A single day's report has one Grand Total; an accumulated file has one per block.
  const statedTotal = grandTotals.length ? grandTotals.reduce((a, b) => a + b, 0) : null;

  return {
    sourceFile: file,
    sheetName,
    reportDate: date,
    reportTime: time,
    fundTransferId: fundTransferIds[fundTransferIds.length - 1] || null,
    fundTransferIds,
    grandTotal: statedTotal == null ? computed : statedTotal,
    computedTotal: computed,
    blockCount: grandTotals.length,
    claims,
    byAgency,
  };
}

module.exports = { parseRbiReport };
