/**
 * Canonical data-model types — implements PRD `03_Data_Model.md`.
 *
 * LAW DOCUMENT. If a build decision conflicts with this file, this file wins.
 * Every KPI, filter, chart, drill-path and validation rule refers to entities defined here.
 */

// ─── 03 §1 · The canonical hierarchy ────────────────────────────────────────
// HEAD → SUBVERTICAL → SUB CATEGORY → REGIONAL CENTRE → GRANTEE → TRANSACTION

export const HIERARCHY_LEVELS = [
  'head',
  'subvertical',
  'sub_category',
  'regional_centre',
  'grantee',
  'transaction',
] as const;
export type HierarchyLevel = (typeof HIERARCHY_LEVELS)[number];

/** Dimensions a breakdown can be grouped by. Superset of hierarchy levels. */
export const BREAKDOWN_DIMS = [
  'head',
  'subvertical',
  'sub_category',
  'sub_category_group',
  'regional_centre',
  'grantee',
  'sanction',
  'payment_date',
  'expenditure_type',
  'classification_basis',
  'utilisation_band',
] as const;
export type BreakdownDim = (typeof BREAKDOWN_DIMS)[number];

export const MEASURES = ['net_amount', 'utilisation', 'balance_remaining', 'txn_count'] as const;
export type Measure = (typeof MEASURES)[number];

// ─── 03 §3 · Fact table ──────────────────────────────────────────────────────

/** `classification_basis` — 03 §3, 07 §3.5. 84 explicit / 4 contextual in baseline. */
export type ClassificationBasis = 'explicit' | 'contextual';

/** One row of `fact_transaction` = one voucher-level fund release (03 §2.1 grain). */
export interface Transaction {
  transaction_id: string;
  version_id: number;
  s_no: number;
  source_sheet: string;
  source_row: number;
  payment_date: string; // ISO yyyy-mm-dd
  voucher_no: string;
  sanction_no: string;
  head: string;
  subvertical: string;
  regional_centre: string;
  grantee: string;
  expenditure_type: string;
  /** NEVER altered. Corrections are logged, not edited (03 §3, 06 VR-24). */
  narration: string;
  sub_category: string;
  sub_category_group: string;
  classification_basis: ClassificationBasis;
  net_amount: number;
  amt_general: number;
  amt_sc: number;
  amt_st: number;
  utilisation: number;
  balance_remaining: number;
  // 03 §3.1 derived measures (computed on publish)
  utilisation_pct: number;
  balance_pct: number;
  is_idle: boolean;
  is_fully_utilised: boolean;
}

// ─── 03 §4 · Dimensions ──────────────────────────────────────────────────────

export type TaxonomyStatus = 'In Use' | 'Reserved';

export interface SubCategory {
  name: string;
  group_name: string;
  definition: string;
  classification_rule: string;
  /** Derived automatically from whether the current version has transactions (03 §7). */
  status: TaxonomyStatus;
  ordinal: number;
}

export interface RegionalCentre {
  name: string;
  city: string;
  is_hq: boolean;
  region: string;
  /** North Eastern Region — Guwahati/Imphal use NER-prefixed community columns (00 §5). */
  is_ner: boolean;
  source_sheet: string;
}

export interface Grantee {
  name: string;
  type: 'Regional Centre' | 'HQ' | 'Academy' | 'KIC' | 'NCOE' | 'Foundation' | 'State Body';
}

export interface Subvertical {
  name: string;
  code: string;
}

export type VersionStatus = 'staged' | 'submitted' | 'published' | 'rejected' | 'superseded';

/** 03 §4 dim_version · 07 §5 versioning. */
export interface DatasetVersion {
  version_id: number;
  label: string;
  status: VersionStatus;
  uploaded_by: string | null;
  uploaded_at: string;
  submitted_by: string | null;
  submitted_at: string | null;
  published_by: string | null;
  published_at: string | null;
  source_filename: string;
  checksum: string;
  is_current: boolean;
  txn_count: number;
  net_amount: number;
  utilisation: number;
  balance_remaining: number;
  notes: string | null;
}

// ─── 03 §5 · Budget / allocation layer ───────────────────────────────────────

export interface BudgetAllocation {
  component: string;
  sub_component: string | null;
  head: 'Recurring' | 'Non-Recurring';
  be_allocation_cr: number | null;
  assigned_to_sai_cr: number | null;
  balance_cr: number | null;
  expenditure_to_date_cr: number | null;
  week: string | null;
}

// ─── 06 · Validation ─────────────────────────────────────────────────────────

export type Severity = 'Blocker' | 'Warning' | 'Info';

export type ValidationLayer =
  | 'Schema'
  | 'Business rules'
  | 'Referential integrity'
  | 'Financial reconciliation'
  | 'Classification'
  | 'Data quality';

export interface ValidationFinding {
  rule_id: string; // VR-01 … VR-26
  layer: ValidationLayer;
  severity: Severity;
  title: string;
  passed: boolean;
  /** Human-readable statement of what was checked and what was found. */
  detail: string;
  /** How to fix it at source (VR-FAIL-03). */
  remedy?: string;
  observed?: string | number;
  expected?: string | number;
  /** Offending rows: sheet + row references so the uploader can find them. */
  offenders?: Array<{ sheet: string; row: number; note: string }>;
  count?: number;
}

export interface ReconciliationPanel {
  master_total: number;
  rc_tabs_total: number;
  sub_category_master_total: number;
  difference: number;
  ties_out: boolean;
  utilisation_total: number;
  balance_total: number;
  net_equals_util_plus_balance: boolean;
}

export interface ValidationReport {
  candidate_version_id: number;
  ran_at: string;
  passed: boolean;
  blockers: number;
  warnings: number;
  infos: number;
  findings: ValidationFinding[];
  reconciliation: ReconciliationPanel;
  data_quality_log: DataQualityObservation[];
}

/** The workbook's own DATA QUALITY LOG, elevated to a live control (04.13, 06 L6). */
export interface DataQualityObservation {
  id: number;
  sheet: string;
  row: number;
  issue_type: string;
  observation: string;
  severity: Severity;
  rule_id: string;
}

/** 07 §3.8 — diff vs current, shown to the checker before approval. */
export interface VersionDiff {
  from_version_id: number | null;
  to_version_id: number;
  rows_added: number;
  rows_removed: number;
  rows_changed: number;
  net_amount_delta: number;
  utilisation_delta: number;
  balance_delta: number;
  txn_count_delta: number;
  changed_samples: Array<{
    transaction_key: string;
    field: string;
    before: string | number | null;
    after: string | number | null;
  }>;
}

// ─── 05 · Intelligence ───────────────────────────────────────────────────────

export type HealthBand = 'Critical' | 'Weak' | 'Fair' | 'Strong';

/** FR-HS · 05 §2.2. Never presented without its breakdown (FR-HS-02). */
export interface HealthScore {
  score: number; // 0–100
  band: HealthBand;
  components: Array<{
    key: 'utilisation' | 'idle_control' | 'concentration' | 'data_quality' | 'classification';
    label: string;
    weight: number; // 0–1
    sub_score: number; // 0–100
    contribution: number; // weight * sub_score
    explanation: string;
  }>;
}

export type InsightKind =
  | 'largest_exposure'
  | 'lowest_utilisation'
  | 'biggest_idle_balance'
  | 'fastest_mover'
  | 'concentration'
  | 'community_equity'
  | 'data_quality';

/** FR-INS · 05 §2.3. Rule-generated and auditable — never free-form model output. */
export interface InsightCard {
  id: string;
  kind: InsightKind;
  severity: Severity | 'Good';
  /** One-sentence statement, composed from computed figures only. */
  statement: string;
  figure: number;
  figure_label: string;
  entity: string | null;
  /** Materiality rank — cards are ordered by this (FR-CC-02). */
  materiality: number;
  drill: DrillTarget | null;
}

export interface DrillTarget {
  page: string;
  filters: FilterState;
  dim?: BreakdownDim;
}

export type ExceptionType =
  | 'idle_balance'
  | 'low_utilisation'
  | 'large_release'
  | 'duplicate'
  | 'missing_information'
  | 'unknown_category'
  | 'concentration'
  | 'community_equity';

/** FR-XC · 05 §6. */
export interface ExceptionItem {
  id: string;
  type: ExceptionType;
  rule_id: string; // FR-XC-01 …
  severity: 'High' | 'Medium' | 'Info' | 'Blocker';
  amount: number;
  regional_centre: string | null;
  grantee: string | null;
  sub_category: string | null;
  /** Age of the release in days at the reporting date. */
  age_days: number | null;
  reason: string;
  transaction_ids: string[];
}

export interface ExceptionQueue {
  type: ExceptionType;
  rule_id: string;
  label: string;
  description: string;
  severity: 'High' | 'Medium' | 'Info' | 'Blocker';
  count: number;
  total_amount: number;
  items: ExceptionItem[];
}

// ─── Filters & API ───────────────────────────────────────────────────────────

/** Encoded into the URL so any view is shareable/bookmarkable (04 §3, FR-EX-07). */
export interface FilterState {
  head?: string[];
  subvertical?: string[];
  sub_category?: string[];
  sub_category_group?: string[];
  regional_centre?: string[];
  grantee?: string[];
  sanction_no?: string[];
  date_from?: string;
  date_to?: string;
  utilisation_band?: UtilisationBand[];
  classification_basis?: ClassificationBasis[];
  search?: string;
}

export const UTILISATION_BANDS = ['0%', '1-25%', '25-50%', '50-75%', '75-99%', '100%'] as const;
export type UtilisationBand = (typeof UTILISATION_BANDS)[number];

export interface Totals {
  net_amount: number;
  utilisation: number;
  balance_remaining: number;
  utilisation_pct: number;
  balance_pct: number;
  txn_count: number;
  amt_general: number;
  amt_sc: number;
  amt_st: number;
  idle_count: number;
  idle_amount: number;
  fully_utilised_count: number;
  fully_utilised_amount: number;
}

export interface BreakdownRow {
  key: string;
  label: string;
  net_amount: number;
  utilisation: number;
  balance_remaining: number;
  utilisation_pct: number;
  txn_count: number;
  idle_count: number;
  idle_amount: number;
  amt_general: number;
  amt_sc: number;
  amt_st: number;
  share_of_parent: number;
  rank: number;
  /** Stable colour slot so a filter that drops series never repaints survivors (09 §3). */
  colour_slot: number;
}

export interface OverviewResponse {
  version: DatasetVersion;
  totals: Totals;
  health: HealthScore;
  insights: InsightCard[];
  top_exceptions: ExceptionQueue[];
  regional_centres: BreakdownRow[];
  concentration: { top_n: number; share_of_balance: number; entities: string[] };
}

export interface BreakdownResponse {
  version_id: number;
  dim: BreakdownDim;
  measure: Measure;
  rows: BreakdownRow[];
  totals: Totals;
  filters: FilterState;
}

export interface TransactionsResponse {
  version_id: number;
  page: number;
  page_size: number;
  total: number;
  totals: Totals;
  rows: Transaction[];
}

export interface SearchHit {
  entity_type: 'regional_centre' | 'grantee' | 'transaction' | 'sub_category' | 'subvertical' | 'head' | 'sanction';
  key: string;
  label: string;
  sublabel: string;
  amount: number | null;
  score: number;
  drill: DrillTarget;
}

export interface SearchResponse {
  query: string;
  took_ms: number;
  groups: Array<{ entity_type: SearchHit['entity_type']; label: string; hits: SearchHit[] }>;
}

// ─── 07 §8 · Roles & RBAC ────────────────────────────────────────────────────

export const ROLES = [
  'minister',
  'secretary',
  'joint_secretary',
  'director',
  'finance_officer',
  'senior_finance',
  'analyst',
  'auditor',
  /** Administrator. Carries the same authority as Super Administrator — see ADMIN_ROLES. */
  'admin',
  /** Platform owner. */
  'super_admin',
] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: 'Super Administrator',
  minister: 'Minister',
  secretary: 'Secretary',
  joint_secretary: 'Joint Secretary',
  director: 'Director',
  finance_officer: 'Finance Officer (maker)',
  senior_finance: 'Senior Finance (checker)',
  analyst: 'Analyst',
  auditor: 'Auditor',
  admin: 'Administrator',
};

export const CAPABILITIES = [
  'view_dashboards',
  'search_explore',
  'export',
  'upload_validate',
  'submit_for_approval',
  'approve_publish',
  'rollback',
  'manage_taxonomy',
  'manage_thresholds',
  'manage_users',
  'view_audit',
  'view_full_audit',
] as const;
export type Capability = (typeof CAPABILITIES)[number];

/** 07 §8.1 role matrix — enforced at the data layer, not merely hidden in the UI (NFR-9). */
export const ROLE_MATRIX: Record<Role, Capability[]> = {
  minister: ['view_dashboards', 'search_explore', 'export', 'view_audit'],
  secretary: ['view_dashboards', 'search_explore', 'export', 'view_audit'],
  joint_secretary: ['view_dashboards', 'search_explore', 'export', 'view_audit'],
  director: ['view_dashboards', 'search_explore', 'export', 'view_audit'],
  finance_officer: [
    'view_dashboards',
    'search_explore',
    'export',
    'upload_validate',
    'submit_for_approval',
    'view_audit',
  ],
  senior_finance: [
    'view_dashboards',
    'search_explore',
    'export',
    'upload_validate',
    'submit_for_approval',
    'approve_publish',
    'rollback',
    'manage_taxonomy',
    'manage_thresholds',
    'view_audit',
  ],
  analyst: ['view_dashboards', 'search_explore', 'export', 'view_audit'],
  auditor: ['view_dashboards', 'search_explore', 'export', 'view_audit', 'view_full_audit'],
  admin: [...CAPABILITIES],
  super_admin: [...CAPABILITIES],
};

/**
 * The roles that administer the platform.
 *
 * `admin` and `super_admin` are one authority, not two tiers. They already held
 * identical capabilities in ROLE_MATRIX above — every one of them — so an
 * Administrator who could not open the administration area was not a narrower
 * permission but a contradiction: full rights, no door. This is the single
 * definition of who holds that authority, and every gate in the platform reads
 * it, so the server, the admin SPA and the dashboard can never drift apart on
 * the question.
 *
 * Widening this list widens what /api/admin/* accepts. It governs user
 * creation, role changes, password resets and per-user module access, so a role
 * added here can administer every account on the platform.
 */
export const ADMIN_ROLES = ['admin', 'super_admin'] as const satisfies readonly Role[];

export function isAdminRole(role: Role | null | undefined): boolean {
  return !!role && (ADMIN_ROLES as readonly string[]).includes(role);
}

// ─── Dashboard modules · the unit of per-user access ─────────────────────────

/**
 * The panels a user can be granted or denied, keyed by the dashboard's own view
 * name so a grant maps 1:1 onto what the UI renders. The dashboard's remaining
 * hidden views (`sv`, `trend`, `detail`) are deliberately absent: they are
 * unreachable, so granting them would be a permission that means nothing. A
 * panel must appear in BOTH places to be governable - listed here, and out of
 * HIDDEN_VIEWS in the dashboard.
 */
export const MODULES = [
  { key: 'command', label: 'Financial Overview' },
  { key: 'tracker', label: 'Component Tracker' },
  { key: 'kigroups', label: 'SAI KI 1, KI 2 & Infra' },
  { key: 'saifmt', label: 'SAI Format Summary' },
  { key: 'mdsd', label: 'KI Infra (States/UTs)' },
  { key: 'rc', label: 'Regional Centres' },
  { key: 'exceptions', label: 'Attention Centre' },
  { key: 'yday', label: "Yesterday's Expenditure" },
] as const;

export type ModuleKey = (typeof MODULES)[number]['key'];
export const MODULE_KEYS: readonly ModuleKey[] = MODULES.map((m) => m.key);

/**
 * Modules nobody holds until an administrator says so.
 *
 * Every other module works the other way round: a user with no stored decision
 * gets it, because the absence of a decision is not a denial and that is what
 * kept logins predating the access table working unchanged. Adding a panel to
 * MODULES therefore hands it to the whole platform on the day it ships, which
 * is the right default for a panel that merely re-cuts figures people can
 * already see — and the wrong one for a panel that should start closed.
 *
 * Listing a key here inverts the default for that key alone: denied unless a
 * row explicitly allows it. Administrators are unaffected, as everywhere else.
 * Both halves matter and both live in users.ts — getModuleAccess must not grant
 * it by default, and setModuleAccess must not read a missing key as a grant.
 */
export const RESTRICTED_MODULES = ['saifmt', 'yday'] as const satisfies readonly ModuleKey[];

export function isRestrictedModule(key: ModuleKey): boolean {
  return (RESTRICTED_MODULES as readonly string[]).includes(key);
}

/**
 * A user with no rows in `user_module_access` gets every module except those in
 * RESTRICTED_MODULES — see users.ts.
 */
export type ModuleAccess = Record<ModuleKey, boolean>;

export function can(role: Role, capability: Capability): boolean {
  return ROLE_MATRIX[role].includes(capability);
}

export interface User {
  id: string;
  /** Login identifier — a short username such as `RC_Kolkata` (not an email). */
  username: string;
  name: string;
  role: Role;
  designation: string;
  /** Contact detail only. Login is still by username, never by email. */
  email: string;
  phone: string;
  /** A deactivated user keeps their record but is refused at login. */
  is_active: boolean;
  /**
   * The Regional Centre whose vouchers this user may comment on, or '' for
   * none. One of RC_SHEET_NAMES — the worksheet tab names, which are what the
   * dashboard stamps onto every transaction's `rc`.
   *
   * Explicit, and never inferred from the username. `RC_Kolkata` is a
   * convention nothing enforces; usernames are stored lower-cased and cannot
   * contain the space in "DDO HQ"; and a rule parsed out of a display string at
   * request time fails silently on a typo. Only a Super Admin may set it — it
   * is absent from the self-service profile patch for the same reason `role`
   * is, because a field a user can change on themselves is a field they can use
   * to grant themselves someone else's centre.
   */
  regional_centre: string;
}

export interface AuthedUser extends User {
  capabilities: Capability[];
  /** Which dashboard panels this user may open, resolved server-side. */
  modules: ModuleAccess;
}

// ─── Voucher comments · a centre's note to HQ about one release ──────────────

/**
 * A comment is identified by `CENTRE|VOUCHER` — the same identity the change log
 * uses, and deliberately free of any amount, so a comment survives the figures
 * moving. Both halves must be non-empty and neither may contain the separator,
 * or the key cannot be split back apart unambiguously.
 */
export const TX_KEY_RE = /^[^|]+\|[^|]+$/;

export function txCommentKey(centre: string, voucher: string): string {
  return `${centre}|${voucher}`;
}

/** The centre half of a key, or '' when the key is malformed. */
export function centreOfTxKey(key: string): string {
  if (!TX_KEY_RE.test(key)) return '';
  return key.slice(0, key.indexOf('|'));
}

export interface TransactionComment {
  tx_key: string;
  centre: string;
  voucher: string;
  body: string;
  author_id: string;
  author_name: string;
  /** Latched when the balance is reported nil; never cleared. */
  locked: boolean;
  created_at: string;
  updated_at: string;
}

/** The longest comment the store accepts. Long enough for a real explanation. */
export const COMMENT_MAX = 2000;

// ─── 07 §7 · Audit ───────────────────────────────────────────────────────────

export type AuditAction =
  | 'login'
  | 'logout'
  | 'upload'
  | 'validate'
  | 'submit'
  | 'approve'
  | 'publish'
  | 'reject'
  | 'rollback'
  | 'taxonomy_change'
  | 'threshold_change'
  | 'export'
  | 'view_transaction';

export interface AuditEvent {
  event_id: number;
  action: AuditAction;
  actor_id: string;
  actor_name: string;
  actor_role: Role;
  occurred_at: string;
  version_id: number | null;
  entity: string | null;
  summary: string;
  detail: string | null;
}

// ─── Settings ────────────────────────────────────────────────────────────────

/** All exception thresholds and health weights are configurable (05 §6, FR-HS). */
export interface PlatformSettings {
  thresholds: {
    idle_age_days: number;
    low_utilisation_pct: number;
    low_utilisation_age_days: number;
    large_release_amount: number;
    large_release_sigma: number;
    concentration_share: number;
    community_equity_tolerance: number;
    expected_utilisation_pace: number;
  };
  health_weights: {
    utilisation: number;
    idle_control: number;
    concentration: number;
    data_quality: number;
    classification: number;
  };
  formatting: {
    crore_threshold: number;
    lakh_threshold: number;
    percent_decimals: number;
  };
}

export const DEFAULT_SETTINGS: PlatformSettings = {
  thresholds: {
    idle_age_days: 15,
    low_utilisation_pct: 0.25,
    low_utilisation_age_days: 15,
    large_release_amount: 10_000_000, // ₹1 Cr (FR-XC-03)
    large_release_sigma: 2,
    concentration_share: 0.2, // FR-XC-07
    community_equity_tolerance: 0.1,
    expected_utilisation_pace: 0.5,
  },
  health_weights: {
    utilisation: 0.3,
    idle_control: 0.25,
    concentration: 0.15,
    data_quality: 0.2,
    classification: 0.1,
  },
  formatting: {
    crore_threshold: 10_000_000,
    lakh_threshold: 100_000,
    percent_decimals: 1,
  },
};
