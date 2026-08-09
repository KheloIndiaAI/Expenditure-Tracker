/**
 * Aggregation & analytics core — the Analytics Engine of `02 §3`, serving the
 * catalogue in `05 §4` (Pareto, treemap/sunburst, heat map, waterfall,
 * decomposition, concentration) and the KPI/breakdown contracts in `03`.
 *
 * Compute-on-publish, read-on-demand (02 §6): everything here is a PURE function
 * of a transaction array, so a publish can materialise it once into `agg_totals`
 * / `agg_breakdown` and every subsequent read is a table scan, not a re-compute.
 *
 * No DB access, no side effects, no I/O.
 */

import type { BreakdownDim, BreakdownRow, Totals, Transaction } from '@efip/shared';
import { colourSlotFor, formatDate, safeRatio } from '@efip/shared';
import { utilisationBandOf } from './filters.ts';

/** Money is stored as REAL — never test it with `===` (00 §6 conventions). */
const MONEY_EPSILON = 0.005;

/** Used when a dimension value is absent. Blank sub-categories are a Blocker
 *  (06 VR-17), but a breakdown must never silently drop a row's money. */
export const UNSPECIFIED = '(Unspecified)';

// ─── Grouping primitives ─────────────────────────────────────────────────────

/** The member key a transaction contributes to, for each supported dimension. */
export function memberKeyOf(t: Transaction, dim: BreakdownDim): string {
  switch (dim) {
    case 'head':
      return t.head || UNSPECIFIED;
    case 'subvertical':
      return t.subvertical || UNSPECIFIED;
    case 'sub_category':
      return t.sub_category || UNSPECIFIED;
    case 'sub_category_group':
      return t.sub_category_group || UNSPECIFIED;
    case 'regional_centre':
      return t.regional_centre || UNSPECIFIED;
    case 'grantee':
      return t.grantee || UNSPECIFIED;
    case 'sanction':
      return t.sanction_no || UNSPECIFIED;
    case 'payment_date':
      return (t.payment_date || '').slice(0, 10) || UNSPECIFIED;
    case 'expenditure_type':
      return t.expenditure_type || UNSPECIFIED;
    case 'classification_basis':
      return t.classification_basis || UNSPECIFIED;
    case 'utilisation_band':
      return utilisationBandOf(t.utilisation_pct);
  }
}

/** Display label. The key stays canonical so it can be fed straight back into a
 *  filter; only the label is humanised (09 §9 formatting standards). */
function labelFor(dim: BreakdownDim, key: string): string {
  if (key === UNSPECIFIED) return key;
  if (dim === 'payment_date') return formatDate(key);
  if (dim === 'classification_basis') return key === 'explicit' ? 'Explicit' : 'Contextual';
  return key;
}

/** Group transactions by a dimension, preserving first-seen order. */
export function groupBy(txns: Transaction[], dim: BreakdownDim): Map<string, Transaction[]> {
  const groups = new Map<string, Transaction[]>();
  for (const t of txns) {
    const key = memberKeyOf(t, dim);
    const bucket = groups.get(key);
    if (bucket) bucket.push(t);
    else groups.set(key, [t]);
  }
  return groups;
}

// ─── Measures ────────────────────────────────────────────────────────────────

interface Sums {
  net_amount: number;
  utilisation: number;
  balance_remaining: number;
  txn_count: number;
  idle_count: number;
  idle_amount: number;
  fully_utilised_count: number;
  fully_utilised_amount: number;
  amt_general: number;
  amt_sc: number;
  amt_st: number;
}

/** 03 §3.1 `is_idle = (utilisation = 0)` — 61 rows in the baseline. Derived from
 *  the measure itself rather than the stored flag so an aggregate is always
 *  reproducible from `fact_transaction`'s money columns alone (FR-INS-01). */
function isIdle(t: Transaction): boolean {
  return Math.abs(t.utilisation) < MONEY_EPSILON;
}

/** 03 §3.1 `is_fully_utilised = (utilisation_pct = 1)` — 23 rows in the baseline.
 *  A zero-value release is idle, never "fully utilised". */
function isFullyUtilised(t: Transaction): boolean {
  return t.net_amount > MONEY_EPSILON && Math.abs(t.net_amount - t.utilisation) < MONEY_EPSILON;
}

function accumulate(txns: Transaction[]): Sums {
  const s: Sums = {
    net_amount: 0,
    utilisation: 0,
    balance_remaining: 0,
    txn_count: 0,
    idle_count: 0,
    idle_amount: 0,
    fully_utilised_count: 0,
    fully_utilised_amount: 0,
    amt_general: 0,
    amt_sc: 0,
    amt_st: 0,
  };
  for (const t of txns) {
    s.net_amount += t.net_amount;
    s.utilisation += t.utilisation;
    s.balance_remaining += t.balance_remaining;
    s.amt_general += t.amt_general;
    s.amt_sc += t.amt_sc;
    s.amt_st += t.amt_st;
    s.txn_count += 1;
    if (isIdle(t)) {
      s.idle_count += 1;
      s.idle_amount += t.net_amount;
    }
    if (isFullyUtilised(t)) {
      s.fully_utilised_count += 1;
      s.fully_utilised_amount += t.net_amount;
    }
  }
  return s;
}

/**
 * Headline measures for a transaction set (04 §4.2 KPI row).
 * Baseline: 88 txns · net ₹27,77,81,215 · utilised ₹4,71,17,007 (16.96%) ·
 * balance ₹23,06,64,208 · idle 61 (₹19,57,51,621) · fully utilised 23.
 */
export function computeTotals(txns: Transaction[]): Totals {
  const s = accumulate(txns);
  return {
    net_amount: s.net_amount,
    utilisation: s.utilisation,
    balance_remaining: s.balance_remaining,
    utilisation_pct: safeRatio(s.utilisation, s.net_amount),
    balance_pct: safeRatio(s.balance_remaining, s.net_amount),
    txn_count: s.txn_count,
    amt_general: s.amt_general,
    amt_sc: s.amt_sc,
    amt_st: s.amt_st,
    idle_count: s.idle_count,
    idle_amount: s.idle_amount,
    fully_utilised_count: s.fully_utilised_count,
    fully_utilised_amount: s.fully_utilised_amount,
  };
}

// ─── Breakdown ───────────────────────────────────────────────────────────────

/** Deterministic order: net desc, then txn count desc, then key — so two runs
 *  over the same version always assign the same ranks. */
function byNetDesc(a: BreakdownRow, b: BreakdownRow): number {
  if (b.net_amount !== a.net_amount) return b.net_amount - a.net_amount;
  if (b.txn_count !== a.txn_count) return b.txn_count - a.txn_count;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/**
 * Aggregate by a dimension: sorted descending by net amount, ranked 1..n, with
 * each row's share of the set it was computed from.
 *
 * COLOUR (09 §3, non-negotiable): `colour_slot` comes from `colourSlotFor(key)`
 * — a stable hash of the ENTITY — never from the array index. A filter that
 * drops series must not repaint the survivors, so Kolkata keeps its hue whether
 * it ranks 1st or 9th, and on every page it appears.
 *
 * For `utilisation_band` the slot is still entity-stable, but the renderer
 * should use the sequential ramp (`utilisationRamp`) — bands are intensity,
 * not identity (09 §3).
 */
export function breakdown(txns: Transaction[], dim: BreakdownDim): BreakdownRow[] {
  const groups = groupBy(txns, dim);
  let total = 0;
  const rows: BreakdownRow[] = [];

  for (const [key, members] of groups) {
    const s = accumulate(members);
    total += s.net_amount;
    rows.push({
      key,
      label: labelFor(dim, key),
      net_amount: s.net_amount,
      utilisation: s.utilisation,
      balance_remaining: s.balance_remaining,
      utilisation_pct: safeRatio(s.utilisation, s.net_amount),
      txn_count: s.txn_count,
      idle_count: s.idle_count,
      idle_amount: s.idle_amount,
      amt_general: s.amt_general,
      amt_sc: s.amt_sc,
      amt_st: s.amt_st,
      share_of_parent: 0,
      rank: 0,
      colour_slot: colourSlotFor(key),
    });
  }

  rows.sort(byNetDesc);
  for (let i = 0; i < rows.length; i++) {
    rows[i].rank = i + 1;
    rows[i].share_of_parent = safeRatio(rows[i].net_amount, total);
  }
  return rows;
}

// ─── Pareto (05 §4 · "What is the 80/20 of spend?") ──────────────────────────

export type ParetoRow = BreakdownRow & { cumulative_pct: number };

/**
 * Running cumulative share, largest first — the 80/20 view of `04 §4.6`.
 * Re-sorts defensively so the cumulative curve is monotonic even if the caller
 * handed rows back in a table's sort order.
 */
export function pareto(rows: BreakdownRow[]): ParetoRow[] {
  const sorted = [...rows].sort(byNetDesc);
  let total = 0;
  for (const r of sorted) total += r.net_amount;

  let running = 0;
  return sorted.map((r) => {
    running += r.net_amount;
    return { ...r, cumulative_pct: safeRatio(running, total) };
  });
}

// ─── Heat map (05 §4 · "Where is utilisation weak?") ─────────────────────────

export interface HeatmapCell {
  row: string;
  col: string;
  net_amount: number;
  utilisation_pct: number;
  txn_count: number;
}

export interface HeatmapResult {
  rows: string[];
  cols: string[];
  cells: HeatmapCell[];
}

const CELL_SEP = '\u0000';

/**
 * RC × subvertical utilisation matrix (04 §4.5, §4.7). Axes are ordered by net
 * amount descending so the matrix reads as a ranked grid.
 *
 * The result is SPARSE: a combination with no releases emits no cell. An absent
 * cell means "no data", which is not the same as 0% utilisation — 04 §6 requires
 * the empty state to be distinguishable from a populated one.
 */
export function heatmap(txns: Transaction[], rowDim: BreakdownDim, colDim: BreakdownDim): HeatmapResult {
  const rows = breakdown(txns, rowDim).map((r) => r.key);
  const cols = breakdown(txns, colDim).map((r) => r.key);

  const buckets = new Map<string, Transaction[]>();
  for (const t of txns) {
    const key = `${memberKeyOf(t, rowDim)}${CELL_SEP}${memberKeyOf(t, colDim)}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(t);
    else buckets.set(key, [t]);
  }

  const cells: HeatmapCell[] = [];
  for (const row of rows) {
    for (const col of cols) {
      const members = buckets.get(`${row}${CELL_SEP}${col}`);
      if (!members) continue;
      const s = accumulate(members);
      cells.push({
        row,
        col,
        net_amount: s.net_amount,
        utilisation_pct: safeRatio(s.utilisation, s.net_amount),
        txn_count: s.txn_count,
      });
    }
  }
  return { rows, cols, cells };
}

// ─── Waterfall (05 §4 · Sanctioned → Utilised → Balance) ─────────────────────

export interface WaterfallStep {
  label: string;
  value: number;
  kind: 'total' | 'decrease' | 'result';
}

/**
 * The three-step waterfall of `04 §4.3`. The middle step carries a SIGNED
 * (negative) value so `total + decrease = result` holds exactly — the same
 * invariant the data model asserts per row (03 §3.2.1).
 */
export function waterfall(totals: Totals): WaterfallStep[] {
  return [
    { label: 'Sanctioned', value: totals.net_amount, kind: 'total' },
    { label: 'Utilised by RC', value: -totals.utilisation, kind: 'decrease' },
    { label: 'Balance remaining', value: totals.balance_remaining, kind: 'result' },
  ];
}

// ─── Treemap / sunburst (04 §4.3) ────────────────────────────────────────────

export interface TreeNode {
  name: string;
  /** The measure the mark is sized by — net amount. */
  value: number;
  children?: TreeNode[];
  utilisation: number;
  balance_remaining: number;
  utilisation_pct: number;
  txn_count: number;
  /** Tooltip requirement: exact figure + share of parent + utilisation% (FR-EX-03). */
  share_of_parent: number;
  colour_slot: number;
  depth: number;
}

/** Head → Subvertical → Sub-category, the hierarchy of 03 §1 down to purpose. */
const TREEMAP_PATH: BreakdownDim[] = ['head', 'subvertical', 'sub_category'];

function buildTree(
  txns: Transaction[],
  path: BreakdownDim[],
  depth: number,
  name: string,
  parentNet: number,
): TreeNode {
  const s = accumulate(txns);
  const node: TreeNode = {
    name,
    value: s.net_amount,
    utilisation: s.utilisation,
    balance_remaining: s.balance_remaining,
    utilisation_pct: safeRatio(s.utilisation, s.net_amount),
    txn_count: s.txn_count,
    share_of_parent: safeRatio(s.net_amount, parentNet),
    colour_slot: colourSlotFor(name), // 09 §3 — colour follows the entity
    depth,
  };
  if (depth < path.length) {
    const dim = path[depth];
    const children: TreeNode[] = [];
    for (const [key, members] of groupBy(txns, dim)) {
      children.push(buildTree(members, path, depth + 1, key, s.net_amount));
    }
    children.sort((a, b) => b.value - a.value || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    if (children.length > 0) node.children = children;
  }
  return node;
}

/**
 * Nested tree for the sunburst / treemap of `04 §4.3`: root → Head →
 * Subvertical → Sub-category. Leaves carry no `children` key so a d3 hierarchy
 * treats them as terminal marks.
 */
export function treemapData(txns: Transaction[], path: BreakdownDim[] = TREEMAP_PATH): TreeNode {
  const total = accumulate(txns).net_amount;
  return buildTree(txns, path, 0, 'Total', total);
}

// ─── Concentration (05 §2.5 · "top N centres hold X% of idle balance") ───────

export type ConcentrationMeasure =
  | 'net_amount'
  | 'utilisation'
  | 'balance_remaining'
  | 'idle_amount'
  | 'txn_count'
  | 'idle_count';

export interface ConcentrationResult {
  /** How many entities were actually taken (≤ requested, ≤ rows available). */
  top_n: number;
  /** Their combined share of the measure across all rows, 0–1. */
  share: number;
  /** Their labels, largest first — named so the insight card can quote them. */
  entities: string[];
}

/**
 * Pareto concentration for a single measure (FR-VAR, FR-XC-07, and the
 * concentration-risk component of the health score, 05 §2.2 — top-3 RC share of
 * balance). Defaults to the top 3 that `05 §2.2` scores against.
 */
export function concentration(
  rows: BreakdownRow[],
  measure: ConcentrationMeasure,
  topN = 3,
): ConcentrationResult {
  const sorted = [...rows].sort((a, b) => {
    const d = b[measure] - a[measure];
    if (d !== 0) return d;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });

  const take = Math.max(0, Math.min(topN, sorted.length));
  const head = sorted.slice(0, take);

  let total = 0;
  for (const r of sorted) total += r[measure];
  let top = 0;
  for (const r of head) top += r[measure];

  return { top_n: take, share: safeRatio(top, total), entities: head.map((r) => r.label) };
}

// ─── Decomposition tree (05 §4 · "Breakdown of one number") ──────────────────

export interface DecompositionNode extends BreakdownRow {
  /** `root` for the total node; otherwise the dimension this level splits by. */
  dim: BreakdownDim | 'root';
  depth: number;
  /** The drill path that reproduces this node — every crumb is clickable (FR-EX-05). */
  path: Array<{ dim: BreakdownDim; key: string }>;
  children: DecompositionNode[];
}

function decomposeLevel(
  txns: Transaction[],
  path: BreakdownDim[],
  depth: number,
  parentPath: Array<{ dim: BreakdownDim; key: string }>,
): DecompositionNode[] {
  if (depth >= path.length) return [];
  const dim = path[depth];
  const groups = groupBy(txns, dim);
  // `breakdown` is computed on the PARENT's subset, so share_of_parent is
  // genuinely the share of this branch, not of the grand total.
  return breakdown(txns, dim).map((row) => {
    const members = groups.get(row.key) ?? [];
    const nodePath = [...parentPath, { dim, key: row.key }];
    return {
      ...row,
      dim,
      depth: depth + 1,
      path: nodePath,
      children: decomposeLevel(members, path, depth + 1, nodePath),
    };
  });
}

/**
 * Decomposition tree for any drill (`05 §4`): one number split successively by
 * the dimensions in `path`. Each node restates its own measures and its share of
 * its immediate parent, so the visual explains a number rather than just
 * displaying it.
 */
export function decomposition(txns: Transaction[], path: BreakdownDim[]): DecompositionNode {
  const s = accumulate(txns);
  return {
    key: 'total',
    label: 'Total',
    dim: 'root',
    depth: 0,
    path: [],
    net_amount: s.net_amount,
    utilisation: s.utilisation,
    balance_remaining: s.balance_remaining,
    utilisation_pct: safeRatio(s.utilisation, s.net_amount),
    txn_count: s.txn_count,
    idle_count: s.idle_count,
    idle_amount: s.idle_amount,
    amt_general: s.amt_general,
    amt_sc: s.amt_sc,
    amt_st: s.amt_st,
    share_of_parent: 1,
    rank: 1,
    colour_slot: colourSlotFor('total'),
    children: decomposeLevel(txns, path, 0, []),
  };
}
