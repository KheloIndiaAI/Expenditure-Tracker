'use strict';
const XLSX = require('xlsx');
const { toNum, norm, dotDate, toDate } = require('./util.cjs');

/**
 * Standardize an Excel cell date (serial number, Date object, or date string)
 * into a Date object and a 'dd.mm.yyyy' key string.
 */
function normalizeDate(val) {
  if (val == null || val === '') return null;
  if (val instanceof Date) {
    return { date: val, key: dotDate(val) };
  }
  if (typeof val === 'number') {
    // Excel serial date number
    const dateObj = new Date(Math.round((val - 25569) * 86400 * 1000));
    return { date: dateObj, key: dotDate(dateObj) };
  }
  const str = String(val).trim();
  // e.g. "02-09-2026" or "02/09/2026" or "02.09.2026"
  const m = str.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (m) {
    const d = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10) - 1;
    const y = parseInt(m[3], 10);
    const dateObj = new Date(Date.UTC(y, mo, d));
    const pad = n => String(n).padStart(2, '0');
    return { date: dateObj, key: `${pad(d)}.${pad(mo + 1)}.${y}` };
  }
  const parsed = toDate(str);
  if (parsed) {
    return { date: parsed, key: dotDate(parsed) };
  }
  return null;
}

/**
 * Standardize time string into 12-hour format e.g. "06:00 PM"
 */
function normalizeTime(val) {
  if (!val || val === '-') return '';
  if (typeof val === 'number') {
    const totalMinutes = Math.round(val * 24 * 60);
    const h24 = Math.floor(totalMinutes / 60) % 24;
    const mins = totalMinutes % 60;
    const ampm = h24 >= 12 ? 'PM' : 'AM';
    const h12 = h24 % 12 || 12;
    return `${String(h12).padStart(2, '0')}:${String(mins).padStart(2, '0')} ${ampm}`;
  }
  const str = String(val).trim();
  return str;
}

/**
 * Read the DSC_Details tab from the workbook.
 */
function readDscDetailsSheet(file, tabName = 'DSC_Details') {
  const wb = XLSX.readFile(file, { cellDates: false });
  const name = wb.SheetNames.find(n => norm(n) === norm(tabName));
  if (!name) return null;

  const ws = wb.Sheets[name];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  if (!rows.length) return [];

  // Find header row
  let hdrIdx = -1;
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const r = rows[i];
    if (r && r.some(c => norm(c) === 'childagencyname' || norm(c) === 'totalclaimamount')) {
      hdrIdx = i;
      break;
    }
  }
  if (hdrIdx < 0) return [];

  const hdr = rows[hdrIdx].map(norm);
  const colDate = hdr.findIndex(c => c === 'date');
  const colTime = hdr.findIndex(c => c === 'time');
  const colType = hdr.findIndex(c => c === 'type');
  const colAgency = hdr.findIndex(c => c === 'childagencyname' || c === 'agencyname');
  const colAmount = hdr.findIndex(c => c === 'totalclaimamount' || c === 'claimamount');
  const colComp = hdr.findIndex(c => c === 'component');
  const colOld = hdr.findIndex(c => c === 'oldvalue');
  const colNew = hdr.findIndex(c => c === 'newvalue');

  const records = [];
  for (let i = hdrIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.every(c => c == null || c === '')) continue;

    const rawDate = colDate >= 0 ? r[colDate] : null;
    const normD = normalizeDate(rawDate);
    if (!normD) continue;

    const rawAgency = colAgency >= 0 ? String(r[colAgency] || '').trim() : '';
    const rawAmt = colAmount >= 0 ? toNum(r[colAmount]) : 0;
    if (!rawAgency && !rawAmt) continue;

    const rawType = colType >= 0 ? String(r[colType] || '').trim() : '';
    const rawComp = colComp >= 0 ? String(r[colComp] || '').trim() : '';
    const rawOld = colOld >= 0 && r[colOld] !== '-' ? toNum(r[colOld]) : null;
    const rawNew = colNew >= 0 && r[colNew] !== '-' ? toNum(r[colNew]) : null;
    const rawTime = colTime >= 0 ? normalizeTime(r[colTime]) : '';

    records.push({
      dateObj: normD.date,
      dateKey: normD.key, // 'dd.mm.yyyy'
      time: rawTime,
      type: rawType || 'Regional Centre',
      agency: rawAgency,
      amount: rawAmt,
      component: rawComp === '-' ? '' : rawComp,
      oldValue: rawOld,
      newValue: rawNew,
    });
  }

  return records;
}

/**
 * Get sorted list of unique dates available in DSC_Details.
 */
function getAvailableDates(file, tabName = 'DSC_Details') {
  const records = readDscDetailsSheet(file, tabName);
  if (!records || !records.length) return [];
  const map = new Map();
  for (const r of records) {
    if (!map.has(r.dateKey)) map.set(r.dateKey, r.dateObj);
  }
  return [...map.entries()]
    .map(([key, date]) => ({ key, date }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

/**
 * Parse DSC_Details for a given date (defaults to the latest date available).
 */
function parseDscDetails(file, targetDateStr = null, tabName = 'DSC_Details') {
  const records = readDscDetailsSheet(file, tabName);
  if (!records || !records.length) {
    throw new Error(`Tab "${tabName}" in ${file} contains no valid transaction rows.`);
  }

  const availableDates = getAvailableDates(file, tabName);
  let chosenKey = null;

  if (targetDateStr) {
    const reqNorm = normalizeDate(targetDateStr);
    chosenKey = reqNorm ? reqNorm.key : targetDateStr;
  } else {
    // Default to the latest available date
    chosenKey = availableDates[availableDates.length - 1].key;
  }

  const dayRecords = records.filter(r => r.dateKey === chosenKey);
  if (!dayRecords.length) {
    const datesList = availableDates.map(d => d.key).join(', ');
    throw new Error(`No records found in ${tabName} for date "${chosenKey}". Available dates: ${datesList}`);
  }

  const chosenDateObj = dayRecords[0].dateObj;
  let latestTime = '';
  for (const r of dayRecords) {
    if (r.time) latestTime = r.time;
  }

  // Aggregate into agencies / components
  const byAgency = {};
  const byStream = {
    RC: 0,
    STATE: 0,
    INFRA_VENDOR: 0,
    DDO_KI: 0,
    UNKNOWN: 0,
  };

  let totalAmount = 0;
  const claims = [];

  for (const r of dayRecords) {
    totalAmount += r.amount;

    // Stream classification
    const tLower = r.type.toLowerCase();
    let stream = 'RC';
    if (tLower.includes('ddo ki') || tLower.includes('direct exp')) {
      stream = 'DDO_KI';
    } else if (tLower.includes('infra sai') || tLower.includes('sai infra') || tLower.includes('construction')) {
      stream = 'INFRA_VENDOR';
    } else if (tLower.includes('state') || tLower.includes('mdsd') || tLower.includes('msd')) {
      stream = 'STATE';
    } else if (tLower.includes('regional centre') || tLower.includes('rc')) {
      stream = 'RC';
    } else {
      stream = 'UNKNOWN';
    }

    byStream[stream] = (byStream[stream] || 0) + r.amount;

    claims.push({
      date: r.dateKey,
      time: r.time,
      type: r.type,
      stream,
      childAgency: r.agency,
      claimAmount: r.amount,
      component: r.component,
      oldValue: r.oldValue,
      newValue: r.newValue,
    });

    const key = `${r.type}::${r.agency}::${r.component}`;
    if (!byAgency[key]) {
      byAgency[key] = {
        name: r.agency,
        type: r.type,
        stream,
        component: r.component,
        oldValue: r.oldValue,
        newValue: r.newValue,
        amount: 0,
        count: 0,
      };
    }
    byAgency[key].amount += r.amount;
    byAgency[key].count++;
  }

  return {
    source: 'DSC_Details',
    sourceFile: file,
    tabName,
    reportDate: chosenDateObj,
    dateKey: chosenKey,
    reportTime: latestTime || '06:00 PM',
    fundTransferId: null,
    grandTotal: totalAmount,
    computedTotal: totalAmount,
    claims,
    byAgency,
    byStream,
    availableDates: availableDates.map(d => d.key),
  };
}

/**
 * The Monday..Sunday block immediately before the week containing `ref`.
 * Regenerating Monday's report on the Wednesday still returns the same week,
 * so a re-run never silently reports a different set of days.
 */
function previousWeekRange(ref) {
  const d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  // getDay(): 0 = Sunday. Shift so Monday is 0, which is where the week starts.
  const offsetToMonday = (d.getDay() + 6) % 7;
  const thisMonday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - offsetToMonday);
  const start = new Date(thisMonday.getFullYear(), thisMonday.getMonth(), thisMonday.getDate() - 7);
  const end = new Date(thisMonday.getFullYear(), thisMonday.getMonth(), thisMonday.getDate() - 1);
  return { start, end };
}

/* A record's own dd.mm.yyyy key, re-read as a local midnight Date.
 * readDscDetailsSheet() builds `dateObj` through several paths — one of which
 * is Date.UTC — so comparing those directly against locally-built bounds can
 * slip a day either side of midnight. The key is written consistently, so
 * going back through it keeps every comparison local-to-local. */
function dayFromKey(key) {
  const [dd, mm, yyyy] = String(key).split('.').map(Number);
  return new Date(yyyy, mm - 1, dd);
}

/**
 * Previous-week spend per Regional Centre, for the Monday leaderboard.
 *
 * Only rows typed "Regional Centre" count, and DDO desks are always dropped:
 * DDO Head Office is filed under that type in the sheet but is not a centre,
 * so leaving it in would put a head-office row in a league table of centres.
 *
 * @param {string} file     workbook holding the DSC_Details tab
 * @param {Date}   refDate  any day in the week *after* the one being reported
 */
function weeklyRegionalCentreLeaderboard(file, refDate, tabName = 'DSC_Details') {
  const records = readDscDetailsSheet(file, tabName) || [];
  const { start, end } = previousWeekRange(refDate);

  const byAgency = new Map();
  let total = 0;

  for (const r of records) {
    if (norm(r.type) !== 'regionalcentre') continue;
    if (norm(r.agency).includes('ddo')) continue;
    if (!(r.amount > 0)) continue;

    const day = dayFromKey(r.dateKey);
    if (day < start || day > end) continue;

    const name = String(r.agency).trim().toUpperCase();
    const cur = byAgency.get(name) || { name, amount: 0, claims: 0 };
    cur.amount += r.amount;
    cur.claims += 1;
    byAgency.set(name, cur);
    total += r.amount;
  }

  const rows = [...byAgency.values()]
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name))
    .map((r, i) => ({ ...r, rank: i + 1, share: total ? (r.amount / total) * 100 : 0 }));

  return { start, end, rows, total, centres: rows.length };
}

module.exports = {
  readDscDetailsSheet,
  getAvailableDates,
  parseDscDetails,
  normalizeDate,
  normalizeTime,
  previousWeekRange,
  weeklyRegionalCentreLeaderboard,
};
