/**
 * Filter + drill state, encoded in the URL.
 *
 * 04 §3: "State in the URL. Filter + drill state is encoded in the URL so any
 * view is shareable and bookmarkable." This hook is the single owner of that
 * contract — no page keeps filter state in local component state.
 */

import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { FilterState } from '@efip/shared';
import { decodeFilters, encodeFilters } from './api.ts';

export interface Crumb {
  label: string;
  /** The filter state this crumb restores when clicked. */
  filters: FilterState;
  path?: string;
}

export function useFilters() {
  const [params, setParams] = useSearchParams();

  const filters = useMemo<FilterState>(() => decodeFilters(params.get('f')), [params]);

  const setFilters = useCallback(
    (next: FilterState | ((prev: FilterState) => FilterState)) => {
      const resolved = typeof next === 'function' ? next(decodeFilters(params.get('f'))) : next;
      const encoded = encodeFilters(resolved);
      const p = new URLSearchParams(params);
      if (encoded) p.set('f', encoded);
      else p.delete('f');
      setParams(p, { replace: false });
    },
    [params, setParams],
  );

  /** Drill one level: add a value to a dimension and push a breadcrumb (FR-EX-01). */
  const drill = useCallback(
    (dim: keyof FilterState, value: string) => {
      setFilters((prev) => {
        const current = (prev[dim] as string[] | undefined) ?? [];
        if (current.includes(value)) return prev;
        return { ...prev, [dim]: [...current, value] };
      });
    },
    [setFilters],
  );

  /** Cross-filter toggle: selecting a mark filters, selecting it again clears it (FR-EX-02). */
  const toggle = useCallback(
    (dim: keyof FilterState, value: string) => {
      setFilters((prev) => {
        const current = (prev[dim] as string[] | undefined) ?? [];
        const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
        const out = { ...prev, [dim]: next };
        if (next.length === 0) delete out[dim];
        return out;
      });
    },
    [setFilters],
  );

  /** FR-EX-04 — one control clears everything back to the page default. */
  const reset = useCallback(() => {
    const p = new URLSearchParams(params);
    p.delete('f');
    setParams(p, { replace: false });
  }, [params, setParams]);

  const activeCount = useMemo(
    () =>
      Object.entries(filters).reduce((n, [, v]) => {
        if (Array.isArray(v)) return n + v.length;
        if (v) return n + 1;
        return n;
      }, 0),
    [filters],
  );

  return { filters, setFilters, drill, toggle, reset, activeCount };
}

const DIM_LABELS: Partial<Record<keyof FilterState, string>> = {
  head: 'Head',
  subvertical: 'Subvertical',
  sub_category: 'Sub-category',
  sub_category_group: 'Group',
  regional_centre: 'Regional Centre',
  grantee: 'Grantee',
  sanction_no: 'Sanction',
  utilisation_band: 'Utilisation',
  classification_basis: 'Basis',
};

/** Human-readable chips for the filter bar (09 §7). */
export function filterChips(filters: FilterState): Array<{ dim: keyof FilterState; value: string; label: string }> {
  const chips: Array<{ dim: keyof FilterState; value: string; label: string }> = [];
  for (const [dim, value] of Object.entries(filters) as Array<[keyof FilterState, unknown]>) {
    const prefix = DIM_LABELS[dim];
    if (!prefix) continue;
    if (Array.isArray(value)) {
      for (const v of value) chips.push({ dim, value: String(v), label: `${prefix}: ${v}` });
    }
  }
  if (filters.date_from || filters.date_to) {
    chips.push({
      dim: 'date_from',
      value: '',
      label: `Date: ${filters.date_from ?? '…'} → ${filters.date_to ?? '…'}`,
    });
  }
  if (filters.search) chips.push({ dim: 'search', value: filters.search, label: `Search: ${filters.search}` });
  return chips;
}
