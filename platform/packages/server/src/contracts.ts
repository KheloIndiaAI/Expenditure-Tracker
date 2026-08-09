/**
 * Internal module contracts.
 *
 * Coupling rule (02 §3): a module may depend on the data-model contract and on
 * other modules' published APIs — never on their internal tables or code.
 * This file IS that published API surface for the server's internal modules.
 * Every module below is independently ownable, testable and replaceable.
 */

import type {
  Transaction,
  SubCategory,
  RegionalCentre,
  DataQualityObservation,
  ValidationReport,
  ReconciliationPanel,
  HealthScore,
  InsightCard,
  ExceptionQueue,
  Totals,
  BreakdownRow,
  BreakdownDim,
  FilterState,
  PlatformSettings,
  BudgetAllocation,
  SearchResponse,
  VersionDiff,
} from '@efip/shared';

// ─── Ingestion (07 §3) ───────────────────────────────────────────────────────

/** A row exactly as it appears on an RC tab, after header harmonisation only. */
export interface RawTransactionRow {
  source_sheet: string;
  /** 1-based row number on the source tab — the audit back-pointer (03 §3). */
  source_row: number;
  s_no: number | string | null;
  payment_date: string | null;
  voucher_no: string;
  sanction_no: string;
  head: string;
  subvertical: string;
  regional_centre: string;
  grantee: string;
  expenditure_type: string;
  narration: string;
  net_amount: number;
  amt_general: number;
  amt_sc: number;
  amt_st: number;
  utilisation: number;
  balance_remaining: number;
  /** Present when the source tab already carries a SUB CATEGORY column. */
  sub_category_source: string | null;
}

/** A row rejected before classification — a TOTAL/subtotal/blank artifact. */
export interface ArtifactRow {
  source_sheet: string;
  source_row: number;
  reason: string;
  raw_s_no: string | null;
  net_amount: number;
}

/** Header variance found and how it was resolved (06 VR-03). */
export interface HeaderHarmonisation {
  sheet: string;
  original: string;
  canonical: string;
}

export interface ParsedWorkbook {
  filename: string;
  checksum: string;
  /** Every data row from the 13 RC tabs, artifacts already excluded. */
  rows: RawTransactionRow[];
  /** Excluded artifact rows — the codified TOTAL-row guard (06 VR-11). */
  artifacts: ArtifactRow[];
  /** Per-tab net totals, used for the three-way tie-out (06 VR-13). */
  rcTabTotals: Record<string, number>;
  /** Present tabs, so VR-01 can assert all 13 are readable. */
  sheetsPresent: string[];
  missingSheets: string[];
  headerHarmonisations: HeaderHarmonisation[];
  /** Column names that could not be mapped — surfaced, never silently guessed. */
  unknownHeaders: Array<{ sheet: string; header: string }>;
  /** SUB CATEGORY MASTER — the controlled vocabulary (03 §7). */
  taxonomy: SubCategory[];
  /** SUB CATEGORY MASTER net total, the third leg of the tie-out. */
  taxonomyNetTotal: number;
  /** MASTER DATA net total, the first leg of the tie-out. */
  masterNetTotal: number;
  masterRowCount: number;
  /** DATA QUALITY LOG observations carried from the workbook (04.13). */
  dataQualityLog: DataQualityObservation[];
  /** Regional-centre dimension members derived from the tabs. */
  regionalCentres: RegionalCentre[];
  /** Parse-time problems that must become validation findings. */
  parseErrors: Array<{ sheet: string; row: number; message: string }>;
}

/** Fully classified + derived rows, ready to stage. */
export interface StagedDataset {
  transactions: Transaction[];
  /** Records the classifier could not place — never invented (07 §3.5). */
  unclassified: Array<{ sheet: string; row: number; narration: string }>;
  /** Contextual classifications, itemised for Finance confirmation (06 VR-20). */
  contextual: Array<{ sheet: string; row: number; sub_category: string; reason: string }>;
  budget: BudgetAllocation[];
}

export interface IngestModule {
  parseWorkbook(buffer: Buffer, filename: string): ParsedWorkbook;
  /** Classify + derive measures. Pure: no DB access. */
  buildDataset(parsed: ParsedWorkbook, versionId: number): StagedDataset;
}

// ─── Validation (06) ─────────────────────────────────────────────────────────

export interface ValidationContext {
  parsed: ParsedWorkbook;
  staged: StagedDataset;
  candidateVersionId: number;
  settings: PlatformSettings;
  /** Reporting date used for ageing; defaults to the max payment date. */
  asOf: string;
}

export interface ValidationModule {
  /** Runs all six layers in order; a Blocker at any layer fails the run (06 §2). */
  validate(ctx: ValidationContext): ValidationReport;
  reconcile(ctx: ValidationContext): ReconciliationPanel;
}

// ─── Analytics & intelligence (05) ───────────────────────────────────────────

export interface AnalyticsModule {
  computeTotals(txns: Transaction[]): Totals;
  /** Aggregate by a dimension. `colour_slot` must be entity-stable (09 §3). */
  breakdown(txns: Transaction[], dim: BreakdownDim): BreakdownRow[];
  applyFilters(txns: Transaction[], filters: FilterState): Transaction[];
}

export interface IntelligenceModule {
  /** FR-HS — score + explainable component breakdown. Never one without the other. */
  healthScore(
    txns: Transaction[],
    settings: PlatformSettings,
    quality: { reconciled: boolean; openIssues: number },
  ): HealthScore;
  /** FR-INS — every card's number reproducible from fact_transaction. */
  insights(txns: Transaction[], settings: PlatformSettings): InsightCard[];
  /** FR-XC — exception queues, computed on publish. */
  exceptions(txns: Transaction[], settings: PlatformSettings, asOf: string): ExceptionQueue[];
}

export interface SearchModule {
  search(txns: Transaction[], query: string, limit?: number): SearchResponse;
}

// ─── Versioning & repository ─────────────────────────────────────────────────

export interface PublishResult {
  version_id: number;
  published_at: string;
  totals: Totals;
}

export interface RepositoryModule {
  currentVersionId(): number | null;
  transactionsFor(versionId: number): Transaction[];
  diff(fromVersionId: number | null, toVersionId: number): VersionDiff;
}
