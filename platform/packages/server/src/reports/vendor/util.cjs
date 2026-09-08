'use strict';

/** Parse a number that may be a JS number, or an Indian-formatted string like "27,56,860.00". */
function toNum(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  const cleaned = String(v).replace(/[₹,\s]/g, '').replace(/[()]/g, m => (m === '(' ? '-' : ''));
  const n = parseFloat(cleaned);
  return isFinite(n) ? n : 0;
}

/** Rupees -> crore, rounded to 2dp. */
const toCr = rs => Math.round((toNum(rs) / 1e7) * 100) / 100;

/** Format a crore value the way the Word files do: "₹100.86 Cr". */
function cr(rs, opts = {}) {
  const v = toCr(rs);
  // The minus sign reads before the currency symbol ("-₹3.27 Cr"), not after
  // it ("₹-3.27 Cr") — toFixed() alone puts it wherever the number's sign
  // lands, which is after a leading "₹".
  const sign = v < 0 ? '-' : '';
  const symbol = opts.noSymbol ? '' : '₹';
  return `${sign}${symbol}${Math.abs(v).toFixed(2)}${opts.bare ? '' : ' Cr'}`;
}

/** Loose text key: lowercase, strip everything but letters and digits. */
const norm = s => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');

/** Strip the SAI / RC / NSNIS decoration off an agency name so "SAI RC KOLKATA" ~ "Kolkata". */
function agencyKey(name) {
  return norm(String(name || '').replace(/\b(sai|rc|regional\s*centre|regional\s*center|nsnis)\b/gi, ''));
}

/** dd.mm.yyyy — the form used in the Word headings. */
function dotDate(d) {
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/** yyyy-mm-dd, for filenames. */
function isoDate(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Coerce whatever a spreadsheet gives us for a date into a Date.
 * Handles real Dates, Excel serials, and common dd-mm-yyyy / dd/mm/yyyy text.
 */
function toDate(v) {
  if (v instanceof Date && !isNaN(v)) return v;
  if (typeof v === 'number' && v > 20000 && v < 60000) {
    return new Date(Date.UTC(1899, 11, 30) + v * 86400000);
  }
  const s = String(v || '').trim();
  const m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) {
    let [, d, mo, y] = m;
    y = +y < 100 ? 2000 + +y : +y;
    const dt = new Date(y, +mo - 1, +d);
    if (!isNaN(dt)) return dt;
  }
  const dt = new Date(s);
  return isNaN(dt) ? null : dt;
}

/**
 * Amounts below a crore read better in lakhs — the report's own convention
 * (its distribution grid shows "₹25.7 Lakhs" beside "1.96 Cr").
 */
function crOrLakh(rs) {
  const n = toNum(rs);
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2)} Cr`;
  // Drop a trailing ".0" so "16 Lakhs" doesn't render as "16.0 Lakhs".
  return `${sign}₹${(abs / 1e5).toFixed(1).replace(/\.0$/, '')} Lakhs`;
}

module.exports = { toNum, toCr, cr, crOrLakh, norm, agencyKey, dotDate, isoDate, toDate };
