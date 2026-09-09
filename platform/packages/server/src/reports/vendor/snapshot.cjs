'use strict';
/*
 * Weekly snapshots of Sheet3's component expenditure.
 *
 * Sheet3 carries running totals with no date dimension, so "what did this
 * component spend last week" cannot be read out of it directly — it has to be
 * differenced against a copy taken a week earlier. This module keeps those
 * copies: one per Monday, written on the Monday run and read by the next one.
 */
const fs = require('fs');
const path = require('path');

/* VENDOR PATCH 2 of 6 — see reports/vendor/README.md. Same reason as pipeline's:
   the Monday snapshots are held in Postgres on the server and written into the
   run's working directory beforehand, so this has to look where they were put.
   FILE is resolved per call rather than once at load, because the working
   directory does not exist yet when this module is first required. */
const ROOT = () => process.env.EFIP_REPORTS_HOME || path.join(__dirname, '..');
const FILE = () => path.join(ROOT(), 'data', 'weekly-snapshots.json');

function readAll() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE(), 'utf8'));
    return Array.isArray(raw.snapshots) ? raw.snapshots : [];
  } catch {
    return [];
  }
}

function writeAll(snapshots) {
  fs.mkdirSync(path.dirname(FILE()), { recursive: true });
  // Newest last, so the file reads chronologically when opened by hand.
  const sorted = [...snapshots].sort((a, b) => a.takenOn.localeCompare(b.takenOn));
  fs.writeFileSync(FILE(), JSON.stringify({ snapshots: sorted }, null, 2) + '\n');
}

/** 'yyyy-mm-dd' — sorts correctly as a plain string, unlike dd.mm.yyyy. */
function isoKey(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Flatten a run's divisions into the component rows worth snapshotting.
 * Keyed by division + component name so a rename in one division cannot
 * collide with a same-named component in another.
 */
function componentsFrom(divisions) {
  const out = [];
  for (const d of divisions || []) {
    for (const c of d.components || []) {
      out.push({
        key: `${d.key}::${c.name}`,
        division: d.key,
        divisionLabel: d.cardPrefix || d.label,
        name: c.name,
        label: c.label || c.name,
        section: c.section || '',
        expenditure: Number(c.expenditure) || 0,
      });
    }
  }
  return out;
}

/**
 * Store this run's component totals under `date`, replacing any copy already
 * held for that day — re-running a Monday report must not stack duplicates.
 */
function saveSnapshot(date, divisions) {
  const takenOn = isoKey(date);
  const rest = readAll().filter(s => s.takenOn !== takenOn);
  rest.push({ takenOn, components: componentsFrom(divisions) });
  writeAll(rest);
  return takenOn;
}

/** The most recent snapshot taken strictly before `date`, or null. */
function latestBefore(date) {
  const key = isoKey(date);
  const earlier = readAll().filter(s => s.takenOn < key);
  return earlier.length ? earlier[earlier.length - 1] : null;
}

/**
 * Component spend for the week ending at `date`: this run's totals minus the
 * previous snapshot's.
 *
 * A component the baseline does not carry is *skipped*, not counted from zero.
 * Counting from zero would report its entire running total as one week's
 * spend — for a component sitting at tens of crore that is not a small error,
 * it is a fabricated headline. Skipped components are counted and returned so
 * the omission is visible rather than silent, and they self-correct next week
 * once a baseline exists for them.
 *
 * Falls to null when there is no earlier snapshot at all, which is the honest
 * answer on the very first Monday.
 */
function componentWeeklySpend(date, divisions) {
  const base = latestBefore(date);
  if (!base) return null;

  const prior = new Map(base.components.map(c => [c.key, c.expenditure]));
  const rows = [];
  const unmeasured = [];
  let total = 0;

  for (const c of componentsFrom(divisions)) {
    if (!prior.has(c.key)) { unmeasured.push(c); continue; }
    const was = prior.get(c.key);
    const delta = c.expenditure - was;
    rows.push({ ...c, previous: was, current: c.expenditure, delta });
    total += delta;
  }

  const spent = rows
    .filter(r => r.delta > 0)
    .sort((a, b) => b.delta - a.delta || a.label.localeCompare(b.label))
    .map((r, i) => ({ ...r, rank: i + 1, share: total > 0 ? (r.delta / total) * 100 : 0 }));

  return {
    baselineOn: base.takenOn,
    takenOn: isoKey(date),
    rows: spent,
    /* Every component considered, spend or not — the page shows a count of the
     * quiet ones rather than pretending they do not exist. */
    considered: rows.length,
    idle: rows.filter(r => r.delta <= 0).length,
    /* The quiet components themselves, so the page can name them in one
     * collapsed row rather than only counting them. */
    idleRows: rows.filter(r => r.delta <= 0).sort((a, b) => a.name.localeCompare(b.name)),
    /* Weekly spend per division, for the split shown on the page's KPI row. */
    byDivision: (() => {
      const m = new Map();
      for (const r of rows) {
        if (r.delta <= 0) continue;
        const cur = m.get(r.division) || { division: r.division, label: r.divisionLabel, total: 0 };
        cur.total += r.delta;
        m.set(r.division, cur);
      }
      return [...m.values()].sort((a, b) => b.total - a.total);
    })(),
    unmeasured,
    total,
  };
}

module.exports = {
  FILE, isoKey, readAll, saveSnapshot, latestBefore, componentWeeklySpend, componentsFrom,
};
