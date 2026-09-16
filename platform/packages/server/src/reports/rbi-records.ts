/**
 * RBI Official Records — the daily ledger of the four manually-entered
 * figures (Total Assigned, Total Expenditure, Balance, Yesterday's Total).
 *
 * These four numbers are what the scheme reports as its official position —
 * "RBI" names who they are ultimately reported to, the same way rbi.cjs's
 * daily claims workbook does elsewhere in this pipeline; the two are
 * unrelated files that happen to share a domain. Where manualOverrides
 * (service.ts) holds only whatever is CURRENTLY in force — each save
 * overwrites it — this is the history, kept forever (soft-deleted, never
 * dropped — see store.ts).
 *
 * WHAT A ROW MEANS: the state of the four figures as they were LAST SAVED on
 * that calendar day. One row per day, rewritten by each later save the same
 * day, so the day's row always shows what was finally in force for it.
 *
 * THIS REPLACED A CONDITIONAL RULE, AND THE REASON MATTERS. The first version
 * wrote a row only when the day-total differed from the stored one, to avoid
 * duplicates from saves that merely re-sent an unchanged box. That rule read
 * the very config value the same request had just advanced — two writes, not
 * atomic, the second one's trigger derived from the first one's result. When
 * the row write failed (an INTEGER column too narrow for a figure in the
 * billions, silently, on Postgres only), the config had ALREADY moved to the
 * new day-total. Re-entering the same figure then compared equal, decided
 * "nothing changed", and wrote nothing — so the one action a person would
 * naturally take to recover was the one action guaranteed not to. A rule that
 * can be poisoned by its own failure is not worth its saved duplicates.
 *
 * So there is no condition now. Every save carrying a figure writes that day's
 * row, and writing the same row twice is simply writing it twice. Nothing has
 * to be inferred, and nothing can be silently skipped.
 */

import { createRequire } from 'node:module';
import * as store from './store.ts';

const require_ = createRequire(import.meta.url);
const xlsxLib = (): any => require_('xlsx');

const CR = 1e7;

export interface RecordEntryInput {
  /** The cleaned dayTotal from this save, in rupees. Null and 0 are both
   *  ordinary values — 0 means a day on which nothing was spent, which is a
   *  fact worth recording, not an absence. */
  dayRupees: number | null;
  /** The Total Expenditure this same save leaves in force, in rupees. */
  totalExpenditureRupees: number | null;
  /** Total Assigned in force at save time — the fixed figure, or the computed
   *  one when nothing is fixed — in rupees. */
  totalAssignedRupees: number | null;
  balanceRupees: number | null;
  /** yyyy-mm-dd, IST calendar day of the save. */
  entryDate: string;
  recordedBy: string | null;
}

/**
 * Write this day's row. The only thing that stops it is having nothing to
 * write: a save that clears every figure (the Clear button) is the operator
 * saying no manual figure is in force, and a row of blanks records nothing.
 *
 * Anything else — including a day total of exactly 0, and including a figure
 * identical to yesterday's — is a row. See the header for why there is no
 * cleverer test than this one.
 */
export async function recordDailyEntry(input: RecordEntryInput): Promise<store.RbiRecordRow | null> {
  const { dayRupees, totalExpenditureRupees } = input;
  if (dayRupees == null && totalExpenditureRupees == null) return null;
  return store.upsertRbiRecord({
    entryDate: input.entryDate,
    totalAssigned: input.totalAssignedRupees,
    totalExpenditure: totalExpenditureRupees,
    balance: input.balanceRupees,
    dayTotal: dayRupees,
    recordedBy: input.recordedBy,
  });
}

export interface RbiRecordView {
  id: string;
  date: string;
  totalAssigned: number | null;
  totalExpenditure: number | null;
  balance: number | null;
  dayTotal: number | null;
  recordedBy: string | null;
  createdAt: string;
}

/** Rupees, exactly (dividing by CR and back), rather than a raw float divide —
 *  see the identical concern where the panel itself formats these (autoOvStr
 *  in index.html): 233.4277184 Cr is 2334277184 rupees exactly, and a plain
 *  `/1e7` leaves noise past the 7th decimal that a reader would have no way
 *  to know is not part of the figure. */
function toCrNum(rupees: number | null): number | null {
  if (rupees == null) return null;
  return Number((rupees / CR).toFixed(7));
}

/** What the panel's table and the Excel export both read. */
export async function listView(): Promise<RbiRecordView[]> {
  const rows = await store.listRbiRecords();
  return rows.map((r) => ({
    id: r.id,
    date: r.entryDate,
    totalAssigned: toCrNum(r.totalAssigned),
    totalExpenditure: toCrNum(r.totalExpenditure),
    balance: toCrNum(r.balance),
    dayTotal: toCrNum(r.dayTotal),
    recordedBy: r.recordedBy,
    createdAt: r.createdAt,
  }));
}

/** 'yyyy-mm-dd' -> 'dd.mm.yyyy', matching every other date on the platform. */
function dmy(iso: string): string {
  const p = String(iso).split('-');
  return p.length < 3 ? String(iso) : `${p[2]}.${p[1]}.${p[0]}`;
}

/** An ISO timestamp -> 'dd.mm.yyyy, hh:mm am/pm IST', for the audit columns —
 *  precise enough to tell two same-day entries apart. */
function istStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const ist = new Date(d.getTime() + 330 * 60000);
  const p = (n: number) => String(n).padStart(2, '0');
  let h = ist.getUTCHours();
  const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return `${p(ist.getUTCDate())}.${p(ist.getUTCMonth() + 1)}.${ist.getUTCFullYear()}, `
    + `${h}:${p(ist.getUTCMinutes())} ${ampm} IST`;
}

const HEADERS = ['Date', 'Total Assigned (Cr)', 'Total Expenditure (Cr)', 'Balance (Cr)',
  "Yesterday's Total (Cr)", 'Recorded By', 'Recorded At'];

/**
 * The workbook the panel's "Download as Excel" button hands over.
 *
 * Built fresh from the current rows every time it is asked for — never cached
 * — which is the entire mechanism behind "delete adjusts the Excel too": a
 * deleted row is absent from listRbiRecords() from the moment it is deleted,
 * so the very next download already reflects it. There is no separate file to
 * keep in step.
 */
export function buildXlsx(rows: RbiRecordView[]): Buffer {
  const XLSX = xlsxLib();
  const aoa = [
    HEADERS,
    ...rows.map((r) => [
      dmy(r.date), r.totalAssigned, r.totalExpenditure, r.balance, r.dayTotal,
      r.recordedBy || '', istStamp(r.createdAt),
    ]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 12 }, { wch: 16 }, { wch: 18 }, { wch: 14 }, { wch: 18 }, { wch: 16 }, { wch: 24 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'RBI Official Records');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
