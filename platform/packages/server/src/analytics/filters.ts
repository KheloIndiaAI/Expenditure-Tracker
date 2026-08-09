/**
 * Filter engine + URL state codec — implements the `FilterState` contract (03)
 * and `04 §3` "State in the URL": filter + drill state is encoded in the URL so
 * any view is shareable and bookmarkable (05 §3, FR-EX-07).
 *
 * The encoded string is also the filter half of the cache key mandated by
 * `02 §6` (`version_id` + filter state) — it is deterministic for a given
 * FilterState, so two identical views always produce the same key.
 *
 * PURE: no DB access, no side effects.
 */

import type { FilterState, Transaction, UtilisationBand } from '@efip/shared';
import { UTILISATION_BANDS } from '@efip/shared';

// ─── Utilisation banding ─────────────────────────────────────────────────────

/**
 * 03 §3.1 / `UTILISATION_BANDS` — the six bands are contiguous and exhaustive.
 * `0%` is the idle band and means *exactly* nothing moved; `100%` means fully
 * utilised. `utilisation_pct` is `utilisation / net_amount`, so a fully utilised
 * row yields exactly 1 in IEEE-754 (x/x === 1) — no epsilon is needed here.
 *
 * The `!(pct > 0)` form is a defensive floor: a negative or NaN ratio (blocked
 * upstream by 06 VR-08) lands in `0%` rather than silently in `1-25%`.
 */
export function utilisationBandOf(pct: number): UtilisationBand {
  if (pct >= 1) return '100%';
  if (!(pct > 0)) return '0%';
  if (pct <= 0.25) return '1-25%';
  if (pct <= 0.5) return '25-50%';
  if (pct <= 0.75) return '50-75%';
  return '75-99%';
}

// ─── Filtering ───────────────────────────────────────────────────────────────

/** Fields FR-SRCH-03 free-text search scans. Narration is included verbatim. */
const SEARCH_FIELDS = ['voucher_no', 'sanction_no', 'narration', 'grantee', 'sub_category'] as const;

/** An array filter is OR-within; a null selection means "not filtered". */
function selectionOf(values: readonly string[] | undefined): Set<string> | null {
  if (!values || values.length === 0) return null;
  const set = new Set<string>();
  for (const v of values) {
    if (typeof v === 'string' && v.length > 0) set.add(v);
  }
  return set.size > 0 ? set : null;
}

function matchesSearch(t: Transaction, needle: string): boolean {
  for (const field of SEARCH_FIELDS) {
    const value = t[field];
    if (typeof value === 'string' && value.toLowerCase().includes(needle)) return true;
  }
  return false;
}

/**
 * Apply a FilterState to a transaction set.
 *
 * Semantics (04 §3): array fields are **OR within** a field and **AND across**
 * fields; `date_from`/`date_to` are **inclusive**; `search` is a case-insensitive
 * substring match across voucher, sanction, narration, grantee and sub-category.
 */
export function applyFilters(txns: Transaction[], f: FilterState): Transaction[] {
  const head = selectionOf(f.head);
  const subvertical = selectionOf(f.subvertical);
  const subCategory = selectionOf(f.sub_category);
  const subCategoryGroup = selectionOf(f.sub_category_group);
  const regionalCentre = selectionOf(f.regional_centre);
  const grantee = selectionOf(f.grantee);
  const sanction = selectionOf(f.sanction_no);
  const bands = selectionOf(f.utilisation_band);
  const basis = selectionOf(f.classification_basis);

  // ISO `yyyy-mm-dd` compares correctly lexicographically — no Date allocation.
  const from = f.date_from ? f.date_from.slice(0, 10) : null;
  const to = f.date_to ? f.date_to.slice(0, 10) : null;
  const needle = f.search ? f.search.trim().toLowerCase() : '';

  return txns.filter((t) => {
    if (head && !head.has(t.head)) return false;
    if (subvertical && !subvertical.has(t.subvertical)) return false;
    if (subCategory && !subCategory.has(t.sub_category)) return false;
    if (subCategoryGroup && !subCategoryGroup.has(t.sub_category_group)) return false;
    if (regionalCentre && !regionalCentre.has(t.regional_centre)) return false;
    if (grantee && !grantee.has(t.grantee)) return false;
    if (sanction && !sanction.has(t.sanction_no)) return false;
    if (basis && !basis.has(t.classification_basis)) return false;
    if (from || to) {
      const d = t.payment_date.slice(0, 10);
      if (from && d < from) return false;
      if (to && d > to) return false;
    }
    if (bands && !bands.has(utilisationBandOf(t.utilisation_pct))) return false;
    if (needle && !matchesSearch(t, needle)) return false;
    return true;
  });
}

// ─── URL codec (FR-EX-07) ────────────────────────────────────────────────────

/**
 * Wire form: `key:value[,value…];key:value…`
 *
 * Short keys keep the URL readable in a browser bar and an email. Every atomic
 * value is percent-encoded, so a member name containing the delimiters — e.g.
 * "Boarding, Lodging & Travel" — round-trips intact.
 */
interface FieldCodec {
  field: keyof FilterState;
  short: string;
  /** Multi-select (OR-within) field. */
  list: boolean;
  encodeValue?: (v: string) => string;
  /** Returns null for a value outside the controlled set — a hand-edited URL
   *  must not be able to inject a member that does not exist. */
  decodeValue?: (v: string) => string | null;
}

const BASIS_SHORT: Record<string, string> = { explicit: 'e', contextual: 'c' };

function encodeBand(v: string): string {
  const i = (UTILISATION_BANDS as readonly string[]).indexOf(v);
  return i >= 0 ? String(i) : v;
}

function decodeBand(v: string): string | null {
  if (/^[0-9]$/.test(v)) {
    const i = Number(v);
    return i < UTILISATION_BANDS.length ? UTILISATION_BANDS[i] : null;
  }
  return (UTILISATION_BANDS as readonly string[]).includes(v) ? v : null;
}

function encodeBasis(v: string): string {
  return BASIS_SHORT[v] ?? v;
}

function decodeBasis(v: string): string | null {
  if (v === 'e' || v === 'explicit') return 'explicit';
  if (v === 'c' || v === 'contextual') return 'contextual';
  return null;
}

/** Fixed order — the encoding must be deterministic to be usable as a cache key. */
const FIELDS: FieldCodec[] = [
  { field: 'head', short: 'h', list: true },
  { field: 'subvertical', short: 'v', list: true },
  { field: 'sub_category', short: 'c', list: true },
  { field: 'sub_category_group', short: 'g', list: true },
  { field: 'regional_centre', short: 'r', list: true },
  { field: 'grantee', short: 'e', list: true },
  { field: 'sanction_no', short: 'n', list: true },
  { field: 'date_from', short: 'f', list: false },
  { field: 'date_to', short: 't', list: false },
  { field: 'utilisation_band', short: 'u', list: true, encodeValue: encodeBand, decodeValue: decodeBand },
  { field: 'classification_basis', short: 'b', list: true, encodeValue: encodeBasis, decodeValue: decodeBasis },
  { field: 'search', short: 'q', list: false },
];

function dec(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v; // tolerate a truncated / hand-edited link rather than throwing at the user
  }
}

/** Compact, deterministic, round-trip-safe encoding of a filter state. */
export function encodeFilters(f: FilterState): string {
  const parts: string[] = [];
  for (const spec of FIELDS) {
    const raw = f[spec.field];
    if (raw === undefined || raw === null) continue;

    if (spec.list) {
      const values = (Array.isArray(raw) ? raw : [raw]) as string[];
      const kept = values.filter((v) => typeof v === 'string' && v.length > 0);
      if (kept.length === 0) continue;
      const encoded = kept.map((v) => encodeURIComponent(spec.encodeValue ? spec.encodeValue(v) : v));
      parts.push(`${spec.short}:${encoded.join(',')}`);
    } else {
      const value = String(raw);
      if (value.length === 0) continue;
      parts.push(`${spec.short}:${encodeURIComponent(value)}`);
    }
  }
  return parts.join(';');
}

/** Inverse of `encodeFilters`. Unknown keys and out-of-vocabulary values are dropped. */
export function decodeFilters(s: string): FilterState {
  const out: FilterState = {};
  if (!s) return out;

  // Accept a bare state, `?state`, `#state` or a `state=` query fragment.
  const body = s.replace(/^[?#]/, '');
  // Assignment goes through a widened view: `keyof FilterState` spans string and
  // string[] members, which TypeScript cannot narrow from a table-driven loop.
  const sink = out as Record<string, string | string[]>;

  for (const part of body.split(';')) {
    if (!part) continue;
    const i = part.indexOf(':');
    if (i <= 0) continue;
    const spec = FIELDS.find((x) => x.short === part.slice(0, i));
    if (!spec) continue;
    const rest = part.slice(i + 1);

    if (spec.list) {
      const values: string[] = [];
      for (const token of rest.split(',')) {
        if (!token) continue;
        const raw = dec(token);
        const value = spec.decodeValue ? spec.decodeValue(raw) : raw;
        if (value) values.push(value);
      }
      if (values.length > 0) sink[spec.field] = values;
    } else {
      const value = dec(rest);
      if (value.length > 0) sink[spec.field] = value;
    }
  }
  return out;
}
