/**
 * The FY 2026–27 baseline — PRD `00_README.md §4` "Ground truth".
 *
 * Every figure here was verified directly against
 * `RC_DETAIL_FOR_RECO_GOOGLE_SHEET_26-27_CLASSIFIED.xlsx`.
 * The build's own reconciliation MUST reproduce these figures exactly
 * (10 §2 Phase 2 exit criteria — the correctness gate for everything downstream).
 */

export const BASELINE = {
  source_file: 'RC_DETAIL_FOR_RECO_GOOGLE_SHEET_26-27_CLASSIFIED.xlsx',
  reporting_period: { from: '2026-05-13', to: '2026-05-19' },
  /** 88 loaded. A 89th `TOTAL` artifact row exists in the sheet and MUST be excluded. */
  txn_count: 88,
  net_amount: 277_781_215,
  utilisation: 47_117_007,
  balance_remaining: 230_664_208,
  utilisation_pct: 0.169619126,
  balance_pct: 0.830380874,
  idle_count: 61,
  idle_amount: 195_751_621,
  fully_utilised_count: 23,
  fully_utilised_amount: 43_506_171,
  largest_transaction: { net_amount: 22_006_750, sanction_no: 'KITD/12', sub_category: 'Athlete Training Support (NCOE)' },
  community: { general: 207_962_198, sc: 41_093_044, st: 28_725_973 },
  regional_centre_count: 13,
  subvertical_count: 5,
  head_count: 2,
  sub_categories_in_use: 14,
  sub_categories_defined: 40,
  classification: { explicit: 84, contextual: 4 },
  data_quality_observations: 12,
} as const;

/** 03 §1 — Head level, live baseline figures. */
export const BASELINE_HEADS = [
  { name: 'Recurring', net_amount: 199_523_693, txn_count: 71 },
  { name: 'Non-Recurring', net_amount: 78_257_522, txn_count: 17 },
] as const;

/** 03 §1 — Subvertical level. */
export const BASELINE_SUBVERTICALS = [
  { name: 'Talent Identification and Development', code: 'TID', net_amount: 116_265_998, txn_count: 30 },
  { name: 'Khelo India Centres', code: 'KIC', net_amount: 73_585_827, txn_count: 35 },
  { name: 'Support to Academies', code: 'SA', net_amount: 65_497_337, txn_count: 16 },
  { name: 'Sports for Peace and Development', code: 'SPD', net_amount: 21_787_500, txn_count: 4 },
  { name: 'Khelo India Games', code: 'KIG', net_amount: 644_553, txn_count: 3 },
] as const;

/** 03 §4.1 — Regional Centres reference table. */
export const BASELINE_REGIONAL_CENTRES = [
  { name: 'SAI RC Kolkata', sheet: 'KOLKATA', net_amount: 49_813_461, txn_count: 13 },
  { name: 'SAI RC Imphal', sheet: 'IMPHAL', net_amount: 32_069_141, txn_count: 7 },
  { name: 'SAI RC Trivandrum', sheet: 'TRIVANDRUM', net_amount: 30_431_622, txn_count: 14 },
  { name: 'SAI RC Sonepat', sheet: 'SONEPAT', net_amount: 27_762_482, txn_count: 8 },
  { name: 'SAI RC Guwahati', sheet: 'GUWAHATI', net_amount: 23_306_985, txn_count: 11 },
  { name: 'DDO HQ', sheet: 'DDO HQ', net_amount: 22_194_166, txn_count: 2 },
  { name: 'SAI RC Gandhinagar', sheet: 'GANDHINAGAR', net_amount: 20_838_395, txn_count: 8 },
  { name: 'SAI RC Bhopal', sheet: 'BHOPAL', net_amount: 17_754_183, txn_count: 4 },
  { name: 'SAI RC Bangalore', sheet: 'BANGALORE', net_amount: 16_456_460, txn_count: 4 },
  { name: 'SAI RC Mumbai', sheet: 'MUMBAI', net_amount: 14_378_500, txn_count: 4 },
  { name: 'SAI RC Patiala', sheet: 'PATIALA', net_amount: 10_842_350, txn_count: 1 },
  { name: 'SAI RC Lucknow', sheet: 'LUCKNOW', net_amount: 6_782_294, txn_count: 5 },
  { name: 'SAI RC Chandigarh', sheet: 'CHANDIGARH', net_amount: 5_151_176, txn_count: 7 },
] as const;

/** 03 §1 — the 14 sub-categories carrying FY 2026–27 data. */
export const BASELINE_SUB_CATEGORIES = [
  { name: 'Athlete Training Support (NCOE)', net_amount: 98_168_650, txn_count: 13 },
  { name: 'Sports Equipment', net_amount: 63_701_612, txn_count: 10 },
  { name: 'Coach Salary (PCA)', net_amount: 28_874_784, txn_count: 15 },
  { name: 'Manpower Remuneration (KISCE)', net_amount: 19_890_206, txn_count: 9 },
  { name: 'Marathons & Mass Participation Events', net_amount: 17_700_000, txn_count: 2 },
  { name: 'Accredited Academy Support', net_amount: 15_376_278, txn_count: 7 },
  { name: 'Sports Science Equipment', net_amount: 14_555_910, txn_count: 7 },
  { name: 'Sports Consumables Grant', net_amount: 11_859_868, txn_count: 7 },
  { name: 'Sports Events & Tournaments', net_amount: 4_087_500, txn_count: 2 },
  { name: 'Programme Workforce Salary', net_amount: 1_283_555, txn_count: 1 },
  { name: 'Talent Assessment Camps', net_amount: 1_250_099, txn_count: 8 },
  { name: 'Athlete Travel Grant', net_amount: 644_553, txn_count: 3 },
  { name: 'Capacity Building Programme', net_amount: 200_784, txn_count: 3 },
  { name: 'Boarding, Lodging & Travel', net_amount: 187_416, txn_count: 1 },
] as const;

/** The 13 Regional-Centre worksheet tabs, in workbook order (06 VR-01). */
export const RC_SHEET_NAMES = [
  'DDO HQ',
  'PATIALA',
  'BANGALORE',
  'BHOPAL',
  'CHANDIGARH',
  'GANDHINAGAR',
  'GUWAHATI',
  'IMPHAL',
  'KOLKATA',
  'LUCKNOW',
  'MUMBAI',
  'SONEPAT',
  'TRIVANDRUM',
] as const;

/**
 * The centres a login can be assigned to, for the purpose of commenting on its
 * own vouchers.
 *
 * Every worksheet tab except DDO HQ. That tab does hold vouchers, but the
 * Regional Centres panel pins `inclHQ:false` in its own filter preset, so DDO HQ
 * rows never appear there and a login assigned to it would hold a right it could
 * never exercise. It is also not a regional centre in this platform's own
 * vocabulary — `isRegionalCentre()` excludes it — and these comments are a
 * centre's query TO headquarters.
 *
 * One list, read by all three of: the server's validation, the Administration
 * dropdown, and the boot-time backfill. They must not be able to disagree about
 * which centres exist.
 */
export const ASSIGNABLE_CENTRES = RC_SHEET_NAMES.filter((n) => n !== 'DDO HQ');

export function isAssignableCentre(name: string): boolean {
  return (ASSIGNABLE_CENTRES as readonly string[]).includes(name);
}

/**
 * Derive a centre from a login name following the `RC_<Centre>` convention,
 * or '' when it does not resolve to exactly one centre.
 *
 * Used ONLY to fill an unset column — at first boot after the column is added,
 * and by the centres:assign script. Never at request time: authorisation reads
 * the stored column, because a rule parsed out of a display string fails on a
 * typo and cannot be reviewed. Exact matches only, and no fuzzy fallback: a name
 * that does not resolve is left unset for a person to decide.
 */
export function centreFromUsername(username: string): string {
  const m = /^rc[_.\-\s]+(.+)$/i.exec(String(username || '').trim());
  if (!m) return '';
  const guess = m[1].replace(/[_.\-\s]+/g, ' ').trim().toUpperCase();
  return isAssignableCentre(guess) ? guess : '';
}

export const MASTER_SHEET = 'MASTER DATA';
export const SUB_CATEGORY_MASTER_SHEET = 'SUB CATEGORY MASTER';
export const CLASSIFICATION_AUDIT_SHEET = 'CLASSIFICATION AUDIT';
export const DATA_QUALITY_LOG_SHEET = 'DATA QUALITY LOG';

/** Per-RC net totals, used by VR-13's three-way tie-out. */
export const BASELINE_RC_TAB_TOTALS: Record<string, number> = {
  'DDO HQ': 22_194_166,
  PATIALA: 10_842_350,
  BANGALORE: 16_456_460,
  BHOPAL: 17_754_183,
  CHANDIGARH: 5_151_176,
  GANDHINAGAR: 20_838_395,
  GUWAHATI: 23_306_985,
  IMPHAL: 32_069_141,
  KOLKATA: 49_813_461,
  LUCKNOW: 6_782_294,
  MUMBAI: 14_378_500,
  SONEPAT: 27_762_482,
  TRIVANDRUM: 30_431_622,
};

/**
 * RC identity metadata. The source's "Regional Centre" column is the constant
 * text "Regional Centre" — RC identity comes from the grantee / source tab (03 §3).
 */
export const RC_METADATA: Record<string, { name: string; city: string; is_hq: boolean; region: string; is_ner: boolean }> = {
  'DDO HQ': { name: 'DDO HQ', city: 'New Delhi', is_hq: true, region: 'North', is_ner: false },
  PATIALA: { name: 'SAI RC Patiala', city: 'Patiala', is_hq: false, region: 'North', is_ner: false },
  BANGALORE: { name: 'SAI RC Bangalore', city: 'Bengaluru', is_hq: false, region: 'South', is_ner: false },
  BHOPAL: { name: 'SAI RC Bhopal', city: 'Bhopal', is_hq: false, region: 'Central', is_ner: false },
  CHANDIGARH: { name: 'SAI RC Chandigarh', city: 'Chandigarh', is_hq: false, region: 'North', is_ner: false },
  GANDHINAGAR: { name: 'SAI RC Gandhinagar', city: 'Gandhinagar', is_hq: false, region: 'West', is_ner: false },
  GUWAHATI: { name: 'SAI RC Guwahati', city: 'Guwahati', is_hq: false, region: 'North East', is_ner: true },
  IMPHAL: { name: 'SAI RC Imphal', city: 'Imphal', is_hq: false, region: 'North East', is_ner: true },
  KOLKATA: { name: 'SAI RC Kolkata', city: 'Kolkata', is_hq: false, region: 'East', is_ner: false },
  LUCKNOW: { name: 'SAI RC Lucknow', city: 'Lucknow', is_hq: false, region: 'North', is_ner: false },
  MUMBAI: { name: 'SAI RC Mumbai', city: 'Mumbai', is_hq: false, region: 'West', is_ner: false },
  SONEPAT: { name: 'SAI RC Sonepat', city: 'Sonepat', is_hq: false, region: 'North', is_ner: false },
  TRIVANDRUM: { name: 'SAI RC Trivandrum', city: 'Thiruvananthapuram', is_hq: false, region: 'South', is_ner: false },
};

/** 03 §4 — subvertical short codes. */
export const SUBVERTICAL_CODES: Record<string, string> = {
  'Talent Identification and Development': 'TID',
  'Khelo India Centres': 'KIC',
  'Support to Academies': 'SA',
  'Sports for Peace and Development': 'SPD',
  'Khelo India Games': 'KIG',
};

/**
 * 03 §5 — the top-down budget layer, from `Expenditure Tracker_29May2026.xlsx`.
 *
 * HONEST NOTE (03 §5, 04 §4.9): in the supplied workbook only the scheme-level
 * TOTAL row carries figures; the per-component and weekly grain are blank. Per
 * `03 §5` we therefore load BE + assigned only and defer the weekly series,
 * and the UI states this rather than faking a breakdown.
 */
export const BUDGET_SCHEME_TOTALS = {
  be_allocation_recurring_cr: 385.35,
  be_allocation_non_recurring_cr: 534,
  be_allocation_total_cr: 919.35,
  assigned_to_sai_recurring_cr: 96.34,
  assigned_to_sai_non_recurring_cr: 53.95,
  assigned_to_sai_total_cr: 150.29,
  component_grain_populated: false,
  weekly_grain_populated: false,
} as const;

/** Scheme components listed in the tracker (structure only — no figures yet). */
export const BUDGET_COMPONENTS = [
  { component: 'Creation and Upgradation of Sports Infrastructure', sub_components: ['Sports Infra Projects', 'Playfield Development'] },
  { component: 'Sports Competitions and Talent Development', sub_components: ['Khelo India Games', 'Talent Identification & Development', 'Community Coaching Development'] },
  { component: 'Khelo India Centres and Sports Academies', sub_components: ['Khelo India Centres', 'Sports Academies'] },
  { component: 'Fit India Movement', sub_components: [] },
  { component: 'Promotion of Inclusiveness through Sports', sub_components: ['Sports for Peace and Development', 'Sports for Rural/Indigenous/Tribals', 'Sports for disabled sportspersons', 'Sports for Women'] },
  { component: 'Monitoring', sub_components: [] },
] as const;
