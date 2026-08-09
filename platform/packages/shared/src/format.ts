/**
 * India-specific data formatting — implements PRD `09_Design_System.md §9`.
 *
 * `formatINR` is the single source of currency formatting across the platform.
 * Crore = 10,000,000. Lakh = 100,000.
 *
 * Large-number safety (09 §9): these helpers assume clean, validated data only.
 * Never sum a column that may contain a TOTAL artifact row (06 VR-11).
 */

const CRORE = 10_000_000;
const LAKH = 100_000;

export type INRUnit = 'auto' | 'crore' | 'lakh' | 'rupee';

export interface INROptions {
  /** `auto` (default): ≥ ₹1 Cr → Cr; ₹1 L–1 Cr → L; below → full rupees. */
  unit?: INRUnit;
  decimals?: number;
  /** Prefix with the ₹ symbol. Default true. */
  symbol?: boolean;
  /** Render a signed value with an explicit +/−. */
  signed?: boolean;
}

/** Indian digit grouping: last three digits, then pairs. 27781215 → 2,77,81,215 */
export function groupIndian(n: number): string {
  const neg = n < 0;
  const s = Math.round(Math.abs(n)).toString();
  let out: string;
  if (s.length <= 3) {
    out = s;
  } else {
    const last3 = s.slice(-3);
    const rest = s.slice(0, -3);
    out = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3;
  }
  return (neg ? '-' : '') + out;
}

function trimZeros(s: string): string {
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

/**
 * The single currency helper (09 §9).
 *   formatINR(277781215)                     → "₹27.78 Cr"
 *   formatINR(277781215, { unit: 'rupee' })  → "₹27,77,81,215"
 *   formatINR(187416)                        → "₹1.87 L"
 */
export function formatINR(value: number | null | undefined, opts: INROptions = {}): string {
  const { unit = 'auto', symbol = true, signed = false } = opts;
  if (value === null || value === undefined || Number.isNaN(value)) return '—';

  const abs = Math.abs(value);
  let resolved: Exclude<INRUnit, 'auto'>;
  if (unit === 'auto') {
    resolved = abs >= CRORE ? 'crore' : abs >= LAKH ? 'lakh' : 'rupee';
  } else {
    resolved = unit;
  }

  const sign = value < 0 ? '-' : signed && value > 0 ? '+' : '';
  const sym = symbol ? '₹' : '';
  let body: string;

  if (resolved === 'crore') {
    const d = opts.decimals ?? 2;
    body = `${(abs / CRORE).toFixed(d)} Cr`;
  } else if (resolved === 'lakh') {
    const d = opts.decimals ?? 2;
    body = `${(abs / LAKH).toFixed(d)} L`;
  } else {
    body = opts.decimals ? (abs).toFixed(opts.decimals) : groupIndian(abs);
  }

  return `${sign}${sym}${body}`;
}

/** Compact form for axis ticks — no symbol, tight units. 277781215 → "27.8Cr" */
export function formatINRCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= CRORE) return `${sign}${trimZeros((abs / CRORE).toFixed(1))}Cr`;
  if (abs >= LAKH) return `${sign}${trimZeros((abs / LAKH).toFixed(1))}L`;
  if (abs >= 1000) return `${sign}${trimZeros((abs / 1000).toFixed(1))}K`;
  return `${sign}${Math.round(abs)}`;
}

/** 09 §9 — whole or one-decimal. Utilisation is always shown with its rupee context. */
export function formatPercent(value: number | null | undefined, decimals = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const pct = value * 100;
  if (decimals === 0 || Math.abs(pct - Math.round(pct)) < 0.05) return `${Math.round(pct)}%`;
  return `${pct.toFixed(decimals)}%`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 09 §9 — `DD Mmm YYYY` ("19 May 2026"). */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${formatDate(d.toISOString().slice(0, 10))} · ${hh}:${mm} IST`;
}

/** Whole-number counts with Indian grouping. */
export function formatCount(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return groupIndian(n);
}

/** Days between two ISO dates (reporting-date aware, used for exception ageing). */
export function daysBetween(fromISO: string, toISO: string): number {
  const a = new Date(`${fromISO.slice(0, 10)}T00:00:00Z`).getTime();
  const b = new Date(`${toISO.slice(0, 10)}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

/** Guarded ratio — 03 §3.1 requires 0 when the denominator is 0. */
export function safeRatio(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return numerator / denominator;
}
