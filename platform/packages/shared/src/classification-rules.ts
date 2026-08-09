/**
 * Classification rule engine — implements PRD `07_Upload_System.md §3.5`.
 *
 * Deterministic and ordered: the FIRST matching rule wins.
 *   1. EXPLICIT   — the expenditure purpose is stated verbatim in the narration.
 *   2. CONTEXTUAL — the narration omits the expense head; the purpose is derived
 *                   from scheme structure + grantee + sanction line.
 *
 * The engine NEVER invents a category and NEVER edits narration (06 VR-24).
 * Ambiguity becomes a Data Quality Log entry, not a guess.
 *
 * Every pattern below is derived from evidence in the workbook's own
 * CLASSIFICATION AUDIT sheet. Baseline expectation: 84 explicit / 4 contextual.
 */

import type { ClassificationBasis } from './types.js';

export interface ClassificationInput {
  narration: string;
  subvertical: string;
  grantee: string;
  sanction_no: string;
  source_sheet: string;
  source_row: number;
}

export interface ClassificationResult {
  sub_category: string;
  basis: ClassificationBasis;
  rule_id: string;
  /** The narration fragment that triggered the match — the audit evidence. */
  evidence: string;
  reason: string;
}

interface Rule {
  id: string;
  sub_category: string;
  basis: ClassificationBasis;
  /** All patterns must match (AND). */
  all: RegExp[];
  /** If present, at least one must match (OR). */
  any?: RegExp[];
  /** If present, none may match. */
  none?: RegExp[];
  /** Optional subvertical constraint. */
  subvertical?: string;
  reason: string;
}

/**
 * ORDER IS SIGNIFICANT. Rules are evaluated top to bottom and the first match wins.
 * Notable ordering constraints, each traceable to a real record:
 *   · Assessment-camp rules precede academy rules — camp narrations also say
 *     "REIMB OF EXP INCURRED".
 *   · Scientific-equipment precedes sports-equipment — both contain "EQUIPMENT".
 *   · Equipment rules precede the KISCE-manpower rule — KOLKATA r8 is a sports
 *     equipment grant that also names KISCE.
 *   · The PCA rule precedes the KISCE rule — a PCA release may mention both.
 */
const EXPLICIT_RULES: Rule[] = [
  {
    id: 'CR-E01',
    sub_category: 'Boarding, Lodging & Travel',
    basis: 'explicit',
    all: [/BOARDING[\s,&]+LODGING/i],
    reason: 'Narration cites boarding / lodging / travelling reimbursement.',
  },
  {
    id: 'CR-E02',
    sub_category: 'Athlete Training Support (NCOE)',
    basis: 'explicit',
    all: [/KIAS?\s+GETTING\s+TRAINED/i],
    reason: 'Narration names KIAs trained at SAI NCOE, released via RC to NCOE.',
  },
  {
    id: 'CR-E03',
    sub_category: 'Athlete Travel Grant',
    basis: 'explicit',
    all: [/TRAVEL\s+GRANT/i, /FINANCIAL\s+ASSISTANCE/i],
    reason: 'Narration cites financial assistance for travel grant linked to a Khelo India Games edition.',
  },
  {
    id: 'CR-E04',
    sub_category: 'Capacity Building Programme',
    basis: 'explicit',
    all: [/CAPACITY\s+BUILDING/i],
    reason: 'Narration cites a capacity building programme (including TA reimbursed against it).',
  },
  {
    id: 'CR-E05',
    sub_category: 'Talent Assessment Camps',
    basis: 'explicit',
    all: [/ASSESSMENT\s+CAMP/i],
    reason: 'Narration cites a Khelo India / performance assessment camp in a named discipline.',
  },
  {
    id: 'CR-E06',
    sub_category: 'Programme Workforce Salary',
    basis: 'explicit',
    all: [/WORKFORCE\s+ENGAGED/i],
    reason: 'Narration cites salary of workforce engaged on a named programme.',
  },
  {
    id: 'CR-E07',
    sub_category: 'Marathons & Mass Participation Events',
    basis: 'explicit',
    all: [/MARATHON|ROAD\s+RACE/i],
    reason: 'Narration cites organising a marathon, half marathon or road race.',
  },
  {
    id: 'CR-E08',
    sub_category: 'Sports Events & Tournaments',
    basis: 'explicit',
    all: [/ORGANI[SZ]ING/i],
    any: [/TOURNAMENT/i, /LEAGUE/i, /CHAMPIONSHIP/i],
    reason: 'Narration cites organising a league, tournament or championship.',
  },
  {
    id: 'CR-E09',
    sub_category: 'Sports Science Equipment',
    basis: 'explicit',
    all: [/SCIENTIFIC\s+EQUIPMENT/i],
    reason: 'Narration cites procurement of non-consumable scientific equipment.',
  },
  {
    id: 'CR-E10',
    sub_category: 'Sports Equipment',
    basis: 'explicit',
    all: [/SPORTS\s+EQUIPMENT/i],
    reason: 'Narration cites procurement of non-consumable sports equipment or a one-time equipment grant.',
  },
  {
    id: 'CR-E11',
    sub_category: 'Sports Consumables Grant',
    basis: 'explicit',
    all: [/GRANT\s+FOR\s+CONSUMABLE/i],
    reason: 'Narration cites annual recurring grant for consumables.',
  },
  {
    id: 'CR-E12',
    sub_category: 'Coach Salary (PCA)',
    basis: 'explicit',
    all: [/PCA\s+SALAR/i],
    reason: 'Narration cites PCA salary / remuneration for a stated number of KICs.',
  },
  {
    id: 'CR-E13',
    sub_category: 'Manpower Remuneration (KISCE)',
    basis: 'explicit',
    all: [/KISCE/i],
    any: [/MANPOWER/i, /REMUNERATION/i, /SALAR(Y|IES)\s+OF\s+MANPOWER/i],
    reason: 'Narration cites remuneration / salary of manpower engaged at a named KISCE.',
  },
  {
    id: 'CR-E14',
    sub_category: 'Accredited Academy Support',
    basis: 'explicit',
    all: [/FURTHER\s+RELEASE\s+TO/i, /REIMB\w*\s+(OF\s+)?EXP/i],
    subvertical: 'Talent Identification and Development',
    reason: 'Onward release to a named academy / club / school / foundation for expenditure incurred.',
  },
];

/**
 * CONTEXTUAL fallback — reached only when no explicit rule matched.
 * Each match is recorded with basis `contextual` and itemised for Finance
 * confirmation (06 VR-19, VR-20). Baseline: exactly 4 records.
 */
const CONTEXTUAL_RULES: Rule[] = [
  {
    id: 'CR-C01',
    sub_category: 'Manpower Remuneration (KISCE)',
    basis: 'contextual',
    all: [/HIRED\s+AT\s+KISCE/i],
    reason:
      "Narration omits the expense head but ends 'HIRED AT KISCE'; 'hired' indicates engaged manpower, hence Manpower Remuneration (KISCE).",
  },
  {
    id: 'CR-C02',
    sub_category: 'Coach Salary (PCA)',
    basis: 'contextual',
    all: [/\d+\s*KICS/i, /RELEASE\s+OF\s+ADV|ADV\s+FOR\s+THE\s+PERIOD/i],
    subvertical: 'Khelo India Centres',
    reason:
      'Narration states only an advance for a stated number of KICs with no expense head. Classified as Coach Salary (PCA) — the standard per-KIC quarterly recurring component; the consumables component is always stated verbatim elsewhere in this dataset.',
  },
  {
    id: 'CR-C03',
    sub_category: 'Accredited Academy Support',
    basis: 'contextual',
    all: [/FURTHER\s+RELEASE\s+TO/i, /ADV\s+FOR\s+THE\s+PERIOD|RELEASE\s+OF\s+ADV/i],
    subvertical: 'Talent Identification and Development',
    reason:
      'Narration gives only the grantee and an advance period. The named body is a Khelo India accredited academy under the TID subvertical, hence Accredited Academy Support.',
  },
];

export const ALL_CLASSIFICATION_RULES = [...EXPLICIT_RULES, ...CONTEXTUAL_RULES];

function matches(rule: Rule, input: ClassificationInput): RegExp | null {
  if (rule.subvertical && input.subvertical.trim() !== rule.subvertical) return null;
  for (const p of rule.all) {
    if (!p.test(input.narration)) return null;
  }
  if (rule.none) {
    for (const p of rule.none) if (p.test(input.narration)) return null;
  }
  if (rule.any) {
    const hit = rule.any.find((p) => p.test(input.narration));
    if (!hit) return null;
    return hit;
  }
  return rule.all[0];
}

function evidenceFor(pattern: RegExp, narration: string): string {
  const m = narration.match(pattern);
  if (!m) return '';
  const idx = m.index ?? 0;
  const start = Math.max(0, idx - 30);
  const end = Math.min(narration.length, idx + m[0].length + 40);
  return `${start > 0 ? '…' : ''}${narration.slice(start, end).trim()}${end < narration.length ? '…' : ''}`;
}

/**
 * Classify one transaction. Returns `null` when nothing matches — the caller
 * must then raise it as an unclassified record rather than inventing a category.
 */
export function classify(input: ClassificationInput): ClassificationResult | null {
  for (const rule of ALL_CLASSIFICATION_RULES) {
    const hit = matches(rule, input);
    if (hit) {
      return {
        sub_category: rule.sub_category,
        basis: rule.basis,
        rule_id: rule.id,
        evidence: evidenceFor(hit, input.narration),
        reason: rule.reason,
      };
    }
  }
  return null;
}
