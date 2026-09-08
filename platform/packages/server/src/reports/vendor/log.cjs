'use strict';
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { dotDate } = require('./util.cjs');

const HEADERS = ['Date', 'Time', 'Type', 'Child Agency Name', 'Total Claim Amount',
                 'Component', 'Old Value', 'New Value', 'Fund Transfer ID', 'Txn Count'];

const TYPE_LABEL = {
  RC: 'Regional Centre',
  STATE: 'Infra MDSD (States/UT)',
  INFRA_VENDOR: 'Infra SAI',
  DDO_KI: 'DDO KI (Direct Exp.)',
  UNKNOWN: 'Unmapped',
};

/**
 * Append one day's agency totals to the running log, keeping whatever is
 * already there. Re-running for a date replaces that date's rows rather than
 * duplicating them, so a rerun after a corrected report is safe.
 */
function appendDailyLog(logPath, result) {
  const { day } = result;
  const dateStr = dotDate(day.date || new Date());
  const timeStr = day.time || '';

  let existing = [];
  if (fs.existsSync(logPath)) {
    const wb = XLSX.readFile(logPath, { cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    existing = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, blankrows: false, defval: null });
    if (existing.length && String(existing[0][0]).trim() === 'Date') existing = existing.slice(1);
    const before = existing.length;
    existing = existing.filter(r => String(r[0] || '').trim() !== dateStr);
    if (before !== existing.length) {
      console.log(`  (replaced ${before - existing.length} existing row(s) for ${dateStr})`);
    }
  }

  const rows = day.agencies.map(a => ([
    dateStr,
    a.time || timeStr,
    TYPE_LABEL[a.type] || a.type || 'Regional Centre',
    a.raw || a.name,
    a.amount,
    a.component || '',
    a.oldValue != null ? a.oldValue : '',
    a.newValue != null ? a.newValue : '',
    day.fundTransferId || '',
    a.count || 1,
  ]));

  const all = [HEADERS, ...existing, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(all);
  ws['!cols'] = [{ wch: 12 }, { wch: 10 }, { wch: 24 }, { wch: 34 }, { wch: 18 },
                 { wch: 28 }, { wch: 16 }, { wch: 16 }, { wch: 18 }, { wch: 10 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Daily Expenditure');

  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  XLSX.writeFile(wb, logPath);
  return { added: rows.length, total: all.length - 1 };
}

module.exports = { appendDailyLog, HEADERS, TYPE_LABEL };
