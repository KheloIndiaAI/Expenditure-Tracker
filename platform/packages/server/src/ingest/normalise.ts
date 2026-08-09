/**
 * Ingestion normalisation — implements PRD `07_Upload_System.md` §3.3 (harmonise)
 * and §3.4 (the TOTAL-row guard), against the mapping in `03_Data_Model.md` §6.
 *
 * Two principles drive every function here:
 *   1. **Surface, never guess.** An unrecognised header returns `null` so the
 *      caller can report it (07 §3.3: "New variants are surfaced, not silently
 *      guessed"). A non-numeric amount returns NaN so VR-04 can block it.
 *   2. **Record, don't alter.** `cleanText` only trims and collapses whitespace;
 *      spelling, casing and content are untouched (03 §3, 06 VR-24 — narration
 *      is NEVER altered, typos are logged instead).
 */

// ─── Canonical schema (03 §3, 03 §6) ────────────────────────────────────────

export const CANONICAL_FIELDS = [
  's_no',
  'payment_date',
  'voucher_no',
  'sanction_no',
  'head',
  'subvertical',
  'regional_centre',
  'grantee',
  'expenditure_type',
  'narration',
  'net_amount',
  'amt_general',
  'amt_sc',
  'amt_st',
  'utilisation',
  'balance_remaining',
  'sub_category',
  'source_sheet',
  'source_row',
  'sub_category_group',
  'utilisation_pct',
] as const;

export type CanonicalField = (typeof CANONICAL_FIELDS)[number];

/** A source row keyed by canonical field, values still raw (unparsed) cells. */
export type RawCellRow = Partial<Record<CanonicalField, unknown>>;

/**
 * The header text each canonical field carries on a *standard* tab. A tab whose
 * header differs from this is a harmonisation and must be reported (06 VR-03) —
 * the known baseline case is Guwahati's `NER-General / NER-SC / NER-ST`.
 */
export const STANDARD_SOURCE_HEADER: Record<CanonicalField, string> = {
  s_no: 'S.NO.',
  payment_date: 'Payment Date',
  voucher_no: 'Voucher No.',
  sanction_no: 'Sanction No.',
  head: 'Head',
  subvertical: 'Subvertical',
  regional_centre: 'Regional Centre',
  grantee: 'Name of Grantee',
  expenditure_type: 'Type of Expenditure',
  narration: 'Detailed Narration',
  net_amount: 'NET AMOUNT',
  amt_general: 'General',
  amt_sc: 'SC',
  amt_st: 'ST',
  utilisation: 'Utilization by RC',
  balance_remaining: 'Balance Remaining with the RC',
  sub_category: 'SUB CATEGORY',
  source_sheet: 'Source Sheet',
  source_row: 'Source Row',
  sub_category_group: 'SUB CATEGORY GROUP',
  utilisation_pct: 'Utilization %',
};

/**
 * Lookup key for a header: case-, whitespace- and punctuation-insensitive, so
 * `S.NO.`, `S No` and `s_no` all collapse to `sno` (07 §3.3 "trim, standardise
 * casing"). `%` is kept because it is the only meaningful symbol in a header.
 */
function headerKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9% ]+/g, '')
    .replace(/ /g, '');
}

/**
 * Every header variant the platform accepts. Anything not listed returns `null`
 * from `canonicalHeader` and is reported as an unknown header, never guessed.
 */
const HEADER_ALIASES: Array<[string, CanonicalField]> = [
  // identity / audit
  ['S.NO.', 's_no'],
  ['S No', 's_no'],
  ['Sl. No.', 's_no'],
  ['Serial No.', 's_no'],
  ['s_no', 's_no'],
  ['Source Sheet', 'source_sheet'],
  ['source_sheet', 'source_sheet'],
  ['Source Tab', 'source_sheet'],
  ['Source Row', 'source_row'],
  ['source_row', 'source_row'],
  // voucher identity
  ['Payment Date', 'payment_date'],
  ['payment_date', 'payment_date'],
  ['Date of Payment', 'payment_date'],
  ['Voucher No.', 'voucher_no'],
  ['voucher_no', 'voucher_no'],
  ['Voucher Number', 'voucher_no'],
  ['Voucher', 'voucher_no'],
  ['Sanction No.', 'sanction_no'],
  ['sanction_no', 'sanction_no'],
  ['Sanction Number', 'sanction_no'],
  ['Sanction', 'sanction_no'],
  // hierarchy
  ['Head', 'head'],
  ['Subvertical', 'subvertical'],
  ['Sub Vertical', 'subvertical'],
  ['Sub-Vertical', 'subvertical'],
  ['Regional Centre', 'regional_centre'],
  ['Regional Center', 'regional_centre'],
  ['regional_centre', 'regional_centre'],
  ['Name of Grantee', 'grantee'],
  ['Grantee', 'grantee'],
  ['Grantee Name', 'grantee'],
  ['Type of Expenditure', 'expenditure_type'],
  ['Expenditure Type', 'expenditure_type'],
  ['expenditure_type', 'expenditure_type'],
  ['Detailed Narration', 'narration'],
  ['Narration', 'narration'],
  // amounts
  ['NET AMOUNT', 'net_amount'],
  ['net_amount', 'net_amount'],
  ['Net Amount (Rs)', 'net_amount'],
  ['Limit Assigned', 'net_amount'],
  ['General', 'amt_general'],
  ['NER-General', 'amt_general'], // 06 VR-03 · the Guwahati variance
  ['amt_general', 'amt_general'],
  ['SC', 'amt_sc'],
  ['NER-SC', 'amt_sc'],
  ['amt_sc', 'amt_sc'],
  ['ST', 'amt_st'],
  ['NER-ST', 'amt_st'],
  ['amt_st', 'amt_st'],
  ['Utilization by RC', 'utilisation'],
  ['Utilisation by RC', 'utilisation'],
  ['Utilization', 'utilisation'],
  ['Utilisation', 'utilisation'],
  ['utilisation', 'utilisation'],
  ['Balance Remaining with the RC', 'balance_remaining'],
  ['Balance Remaining', 'balance_remaining'],
  ['balance_remaining', 'balance_remaining'],
  ['Utilization %', 'utilisation_pct'],
  ['Utilisation %', 'utilisation_pct'],
  ['utilisation_pct', 'utilisation_pct'],
  // taxonomy
  ['SUB CATEGORY', 'sub_category'],
  ['Sub-Category', 'sub_category'],
  ['sub_category', 'sub_category'],
  ['SUB CATEGORY GROUP', 'sub_category_group'],
  ['Sub-Category Group', 'sub_category_group'],
  ['sub_category_group', 'sub_category_group'],
];

const ALIAS_INDEX = new Map<string, CanonicalField>();
for (const [text, field] of HEADER_ALIASES) {
  ALIAS_INDEX.set(headerKey(text), field);
}

/**
 * Map a source header to a canonical field name. Returns `null` for anything
 * unrecognised so the caller can surface it (07 §3.3) — the parser must never
 * silently guess a column's meaning.
 */
export function canonicalHeader(raw: string): CanonicalField | null {
  if (typeof raw !== 'string') return null;
  const key = headerKey(raw);
  if (!key) return null;
  return ALIAS_INDEX.get(key) ?? null;
}

/** True when `raw` is the standard header text for the field it maps to. */
export function isIdentityHeader(raw: string, field: CanonicalField): boolean {
  return headerKey(raw) === headerKey(STANDARD_SOURCE_HEADER[field]);
}

// ─── Type coercion (07 §3.3 "coerce types") ─────────────────────────────────

/** Accounting placeholders that mean "nil", not "not a number". */
const DASH_ZERO = /^[-–—]+$/;

/**
 * Coerce a cell to a number.
 *   · blank (`''`/`null`/`undefined`) → 0 — an empty amount cell is nil, not an error
 *   · strips `₹`, `Rs`, thousands separators and spaces; `(1,234)` → -1234
 *   · genuinely non-numeric text → **NaN**, so 06 VR-04 can block it
 */
export function toNumber(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return Number.NaN; // a flag is not an amount
  if (v instanceof Date) return Number.NaN; // a date is not an amount
  const s0 = String(v).trim();
  if (s0 === '') return 0;
  if (DASH_ZERO.test(s0)) return 0;

  const negativeByParens = /^\(.*\)$/.test(s0);
  const cleaned = s0
    .replace(/^\(|\)$/g, '')
    .replace(/[₹$]/g, '')
    .replace(/\bRs\.?/gi, '')
    .replace(/[,\s  ]/g, '')
    .replace(/%$/, '');

  if (cleaned === '' || !/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(cleaned)) return Number.NaN;
  const n = Number(cleaned);
  if (Number.isNaN(n)) return Number.NaN;
  return negativeByParens ? -Math.abs(n) : n;
}

const DAY_MS = 86_400_000;

/**
 * SheetJS's `cellDates` rebuilds a date from the Excel serial using the host
 * timezone, and historical LMT offsets (Asia/Kolkata was +5:53:20 in 1899) leave
 * the value a few seconds either side of local midnight. Snapping to the nearest
 * local day recovers the intended calendar date on any host timezone — without
 * it the baseline's 13–19 May 2026 window silently shifts by a day.
 */
function isoFromDate(d: Date): string | null {
  const t = d.getTime();
  if (!Number.isFinite(t)) return null;
  const localMs = t - d.getTimezoneOffset() * 60_000;
  const snapped = new Date(Math.round(localMs / DAY_MS) * DAY_MS);
  if (Number.isNaN(snapped.getTime())) return null;
  return snapped.toISOString().slice(0, 10);
}

/** Excel serial → ISO. Serial 1 = 1900-01-01; serials ≤ 59 predate Excel's phantom 1900-02-29. */
function isoFromSerial(serial: number): string | null {
  if (!Number.isFinite(serial) || serial <= 0 || serial > 2_958_465) return null;
  const corrected = serial < 60 ? serial + 1 : serial;
  const ms = Math.round((corrected - 25_569) * DAY_MS);
  const d = new Date(Math.round(ms / DAY_MS) * DAY_MS);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function isoFromParts(y: number, m: number, day: number): string | null {
  if (y < 1900 || y > 9999 || m < 1 || m > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(y, m - 1, day));
  // Rejects 31 Feb and friends — Date.UTC would silently roll them forward.
  if (d.getUTCFullYear() !== y || d.getUTCMonth() !== m - 1 || d.getUTCDate() !== day) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Coerce a cell to `YYYY-MM-DD`. Handles JS `Date` (SheetJS `cellDates`), Excel
 * serial numbers, ISO strings and the `DD.MM.YYYY` form used in narrations.
 * Returns `null` when the value cannot be read as a date, so VR-04 can block it.
 */
export function toISODate(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return isoFromDate(v);
  if (typeof v === 'number') return isoFromSerial(v);

  const s = String(v).trim();
  if (s === '') return null;

  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ]|$)/);
  if (iso) return isoFromParts(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  // Indian day-first convention — the only ambiguous form the source uses.
  const dmy = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/);
  if (dmy) {
    const yy = Number(dmy[3]);
    return isoFromParts(yy < 100 ? 2000 + yy : yy, Number(dmy[2]), Number(dmy[1]));
  }

  if (/^\d+(\.\d+)?$/.test(s)) return isoFromSerial(Number(s));
  return null;
}

/**
 * Trim and collapse internal whitespace. Nothing else: spelling, casing and
 * content are preserved verbatim, because narration is NEVER altered (03 §3) —
 * typographic anomalies are logged as VR-24 Info items, not corrected.
 */
export function cleanText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return isoFromDate(v) ?? '';
  return String(v).replace(/\s+/g, ' ').trim();
}

// ─── The TOTAL-row guard (06 VR-11, 07 §3.4) ────────────────────────────────

/**
 * Reason codes for excluded rows. Exported so validation can classify artifacts
 * without string-matching prose — VR-11 cares specifically about `TOTAL_LABEL`.
 */
export const ARTIFACT_REASONS = {
  TOTAL_LABEL:
    'S.NO. carries a TOTAL/subtotal label — a spreadsheet total row, never a transaction (06 VR-11).',
  TOTAL_NARRATION:
    'Narration is a row count ("N transactions"), the signature of a totals footer (06 VR-11).',
  ALL_BLANK: 'Every mapped field is blank — spreadsheet padding, not a record (07 §3.4).',
  SERIAL_ONLY:
    'Serial number only: no payment date, voucher, narration or amount — an empty numbered line (07 §3.4).',
  NO_IDENTITY:
    'Head, subvertical and grantee are all blank while an amount is present — a subtotal line, not a release (06 VR-11).',
} as const;

const TOTAL_LABEL = /^(grand[\s-]*)?(sub[\s-]*)?total$/i;
const COUNT_NARRATION = /^\d+\s+transactions?$/i;

const AMOUNT_FIELDS: CanonicalField[] = [
  'net_amount',
  'amt_general',
  'amt_sc',
  'amt_st',
  'utilisation',
  'balance_remaining',
];

/** Every canonical field except `s_no` — a bare serial carries no information. */
const CONTENT_FIELDS: CanonicalField[] = CANONICAL_FIELDS.filter((f) => f !== 's_no');

function isBlank(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (v instanceof Date) return Number.isNaN(v.getTime());
  if (typeof v === 'string') return v.trim() === '';
  return false;
}

/** Money tolerance: REAL storage means equality is always ±0.005 (03 §3.2). */
function carriesAmount(row: RawCellRow): boolean {
  return AMOUNT_FIELDS.some((f) => {
    const n = toNumber(row[f]);
    return Number.isFinite(n) && Math.abs(n) >= 0.005;
  });
}

/**
 * The codified fix for the ₹27.78 Cr → ₹55.56 Cr doubling (06 §1, VR-11).
 *
 * A row is an artifact when any of these hold. The checks are deliberately
 * narrow — a genuine release always carries a narration and an amount, so none
 * of them can swallow real data.
 */
export function isArtifactRow(row: RawCellRow): { artifact: boolean; reason: string } {
  const sNo = cleanText(row.s_no);
  if (sNo !== '' && TOTAL_LABEL.test(sNo)) {
    return { artifact: true, reason: ARTIFACT_REASONS.TOTAL_LABEL };
  }

  const narration = cleanText(row.narration);
  if (COUNT_NARRATION.test(narration)) {
    return { artifact: true, reason: ARTIFACT_REASONS.TOTAL_NARRATION };
  }

  const contentBlank = CONTENT_FIELDS.every((f) => isBlank(row[f]));
  if (contentBlank && isBlank(row.s_no)) {
    return { artifact: true, reason: ARTIFACT_REASONS.ALL_BLANK };
  }
  // A leftover serial with nothing beside it is scaffolding, not a record.
  // 43 such lines exist across the 13 RC tabs of the baseline workbook.
  if (contentBlank) {
    return { artifact: true, reason: ARTIFACT_REASONS.SERIAL_ONLY };
  }

  const noIdentity = isBlank(row.head) && isBlank(row.subvertical) && isBlank(row.grantee);
  if (noIdentity && carriesAmount(row)) {
    return { artifact: true, reason: ARTIFACT_REASONS.NO_IDENTITY };
  }

  return { artifact: false, reason: '' };
}
