'use strict';
const XLSX = require('xlsx');
const { toNum, norm } = require('./util.cjs');

const isTotalLabel = s => /^total\b|^grand\s*total\b/i.test(String(s || '').trim());
/* Trailing annotation rows under the Grand Total — not components. */
const NON_COMPONENT = new Set(['incr', 'inrs', 'balance', 'rbi']);
const isNonComponent = s => NON_COMPONENT.has(norm(s));
/*
 * In the S.N. column, sub-components are lettered (a, b, c) and group captions
 * are numbered (1, 2, 4). A numbered row with no figures is a caption, so only
 * a letter marks a genuine zero-spend component worth keeping.
 */
const isComponentMarker = s => {
  const t = norm(s);
  return t.length === 1 && t >= 'a' && t <= 'z';
};

const SECTION_HEADERS = [
  [/verticals\s*recurring/i, 'RECURRING'],
  [/^\s*infrastructure\s*$/i, 'INFRASTRUCTURE'],
  [/verticals\s*non-?recurring/i, 'NON-RECURRING'],
];

/** Read Sheet3 of Test sheet 2 — the cumulative DSC expenditure master. */
function readMaster(file, opts = {}) {
  const tab = opts.masterTab || 'Sheet3';
  const wb = XLSX.readFile(file, { cellDates: true });
  const ws = wb.Sheets[tab];
  if (!ws) throw new Error(`Tab "${tab}" not found in ${file}. Tabs: ${wb.SheetNames.join(', ')}`);
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, blankrows: true, defval: null });

  const C = c => XLSX.utils.decode_col(c);
  const at = (r, c) => (rows[r] ? rows[r][C(c)] : null);

  // --- locate the header row ("COMPONENTS" in column B) ---
  let hdr = -1;
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    if (norm(at(i, 'B')) === 'components') { hdr = i; break; }
  }
  if (hdr < 0) throw new Error(`Could not find the "COMPONENTS" header row in ${tab}.`);

  // --- map columns by header text, never by fixed letter ---
  // This sheet is live-edited by its owners; columns get inserted and removed
  // (an unused "Assignment from Ministry" column was deleted upstream between
  // one snapshot and the next, shifting every later column left by two). RC
  // columns already survive that because they are matched by the centre's own
  // name; the totals below previously did not, because they were read by
  // fixed letter (AH/AI/AJ) — resolve those by header text too.
  const rcColumns = [];
  let directExpCol = -1;
  let limitUtilCol = -1, actualUtilCol = -1;     // "TOTAL Limit Utilisation" pair
  let totalExpRsCol = -1;                        // "TOTAL EXPENDITURE" -> "(in Rs. )"
  const hdrRow = rows[hdr] || [];
  const subRow = rows[hdr + 1] || [];

  // A top-row label sits in a cell merged across its 2-column span, so only
  // the FIRST of the pair carries text — the second reads back empty. Every
  // paired header below is therefore resolved from that first column alone
  // (name at j, values at j and j+1), the same way the RC columns already were.
  for (let j = 0; j < hdrRow.length; j++) {
    const name = String(hdrRow[j] || '').trim();
    const sub = norm(subRow[j]);

    if (directExpCol < 0 && sub.startsWith('directexp')) { directExpCol = j; continue; }

    if (!name) continue;
    const n = norm(name);
    if (['components', 'targetallocation', 'sn'].includes(n)) continue;
    if (n.startsWith('assignmentfromministry')) continue;

    if (n.startsWith('totallimitutilisation')) {
      limitUtilCol = j;
      actualUtilCol = j + 1;
      continue;
    }
    if (n.startsWith('totalexpenditure')) {
      // The sub-label ("(in Rs.)" vs "(in Cr.)") can land in either column of
      // the pair depending on the sheet's own layout — read whichever one says Rs.
      totalExpRsCol = sub.startsWith('inrs') ? j : (norm(subRow[j + 1]).startsWith('inrs') ? j + 1 : j);
      continue;
    }

    const nextSub = norm(subRow[j + 1]);
    if (sub.startsWith('limitassigned') && nextSub.startsWith('actualexp')) {
      rcColumns.push({ name, limitCol: j, actualCol: j + 1 });
    }
  }
  if (directExpCol < 0) throw new Error(`Could not find the "Direct Exp." column in ${tab} — the sheet's layout may have changed.`);
  if (limitUtilCol < 0 || actualUtilCol < 0) throw new Error(`Could not find the "TOTAL Limit Utilisation" columns in ${tab} — the sheet's layout may have changed.`);
  if (totalExpRsCol < 0) throw new Error(`Could not find the "TOTAL EXPENDITURE (in Rs.)" column in ${tab} — the sheet's layout may have changed.`);

  const atCol = (r, col) => (rows[r] ? rows[r][col] : null);

  // --- read component rows ---
  const components = [];
  const totals = {};
  let section = 'RECURRING';
  let kiInfraStart = -1;

  for (let i = hdr + 2; i < rows.length; i++) {
    const label = String(at(i, 'B') || '').trim();
    const snCell = String(at(i, 'A') || '').trim();

    if (/ki\s*infra/i.test(label)) { kiInfraStart = i; break; }

    if (label) {
      const sec = SECTION_HEADERS.find(([re]) => re.test(label));
      if (sec) { section = sec[1]; continue; }
    }

    const totalLabel = isTotalLabel(snCell) ? snCell : (isTotalLabel(label) ? label : null);
    if (totalLabel) {
      totals[totalLabel] = {
        label: totalLabel,
        directExp: toNum(atCol(i, directExpCol)),
        limitAssigned: toNum(atCol(i, limitUtilCol)),
        actualExp: toNum(atCol(i, actualUtilCol)),
        totalExp: toNum(atCol(i, totalExpRsCol)),
      };
      continue;
    }

    if (!label || isNonComponent(label)) continue;

    const directExp = toNum(atCol(i, directExpCol));
    const limitAssigned = toNum(atCol(i, limitUtilCol));
    const actualExp = toNum(atCol(i, actualUtilCol));
    const totalExp = toNum(atCol(i, totalExpRsCol));
    // Keep a genuine zero-spend component (it has an S.N. marker); drop group
    // captions like "Sports Competitions and Talent Development", which have neither.
    const hasFigures = directExp || limitAssigned || actualExp || totalExp;
    if (!hasFigures && !isComponentMarker(snCell)) continue;

    const byRc = {};
    for (const rc of rcColumns) {
      byRc[rc.name] = {
        limitAssigned: toNum(rows[i] ? rows[i][rc.limitCol] : 0),
        actualExp: toNum(rows[i] ? rows[i][rc.actualCol] : 0),
      };
    }

    components.push({ row: i, sn: snCell, name: label, section, directExp, limitAssigned, actualExp, totalExp, byRc });
  }

  // --- KI Infra (States/UTs) table ---
  // Column layout here has changed over time too (a "Limit Assigned" column
  // was dropped from a later version, leaving just Expenditure + Unspent) —
  // resolve by the header row directly under the "KI Infra" caption, and
  // derive Limit Assigned from the other two when it isn't present.
  const kiInfraStates = [];
  let kiInfraTotal = null;
  if (kiInfraStart >= 0) {
    const kiHdr = rows[kiInfraStart] || [];
    let limitCol = -1, expCol = -1, unspentCol = -1;
    for (let j = 0; j < kiHdr.length; j++) {
      const n = norm(kiHdr[j]);
      if (n.startsWith('limitassigned')) limitCol = j;
      else if (n.startsWith('expenditure')) expCol = j;
      else if (n.startsWith('limitunspent') || n === 'unspent') unspentCol = j;
    }
    if (expCol < 0 || unspentCol < 0) {
      throw new Error(`Could not find "Expenditure" / "Unspent" columns in the KI Infra (States/UTs) table of ${tab} — the sheet's layout may have changed.`);
    }
    for (let i = kiInfraStart + 1; i < rows.length; i++) {
      const name = String(at(i, 'B') || '').trim();
      if (!name) continue;
      if (norm(name) === 'limitassigned') continue;
      const expenditure = toNum(atCol(i, expCol));
      const unspent = toNum(atCol(i, unspentCol));
      const limitAssigned = limitCol >= 0 ? toNum(atCol(i, limitCol)) : expenditure + unspent;
      if (isTotalLabel(name)) { kiInfraTotal = { limitAssigned, expenditure, unspent }; break; }
      if (!limitAssigned && !expenditure && !unspent) continue;
      kiInfraStates.push({ name, limitAssigned, expenditure, unspent });
    }
  }
  if (!kiInfraTotal && kiInfraStates.length) {
    kiInfraTotal = kiInfraStates.reduce((a, s) => ({
      limitAssigned: a.limitAssigned + s.limitAssigned,
      expenditure: a.expenditure + s.expenditure,
      unspent: a.unspent + s.unspent,
    }), { limitAssigned: 0, expenditure: 0, unspent: 0 });
  }

  return { file, tab, headerRow: hdr, rcColumns, components, totals, kiInfraStates, kiInfraTotal };
}

/**
 * Read the live sheet's "Assignment" tab — the authoritative division-level
 * targets (Division | Assigned | Expenditure | Balance), maintained by hand
 * alongside the DSC data rather than derived from it. Returns a map keyed by
 * a normalised division name ("ki1", "saiinfra", ...) so callers can match it
 * against their own division keys regardless of spacing/hyphenation.
 */
function readAssignmentTab(file, tabName = 'Assignment') {
  const wb = XLSX.readFile(file, { cellDates: true });
  const ws = wb.Sheets[tabName];
  if (!ws) return null;   // absent tab is not an error — callers fall back to config
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, blankrows: true, defval: null });

  let hdr = -1;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    if (norm(rows[i] && rows[i][0]) === 'division') { hdr = i; break; }
  }
  if (hdr < 0) return null;

  const cols = { assigned: -1, expenditure: -1, balance: -1 };
  (rows[hdr] || []).forEach((c, j) => {
    const n = norm(c);
    if (n === 'assigned') cols.assigned = j;
    else if (n === 'expenditure') cols.expenditure = j;
    else if (n === 'balance') cols.balance = j;
  });
  if (cols.assigned < 0) return null;

  const byDivision = new Map();
  for (let i = hdr + 1; i < rows.length; i++) {
    const name = rows[i] && rows[i][0];
    if (!name || isTotalLabel(name)) continue;
    byDivision.set(norm(name), {
      name: String(name).trim(),
      assigned: toNum(rows[i][cols.assigned]),
      expenditure: cols.expenditure >= 0 ? toNum(rows[i][cols.expenditure]) : null,
      balance: cols.balance >= 0 ? toNum(rows[i][cols.balance]) : null,
    });
  }
  return byDivision.size ? byDivision : null;
}

module.exports = { readMaster, readAssignmentTab };
