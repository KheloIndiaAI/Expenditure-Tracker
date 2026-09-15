/**
 * RBI Official Records — the daily ledger of the four manually-entered
 * figures (Total Assigned, Total Expenditure, Balance, Yesterday's Total).
 *
 * These four numbers are what the scheme reports as its official position —
 * "RBI" names who they are ultimately reported to, the same way rbi.cjs's
 * daily claims workbook does elsewhere in this pipeline; the two are
 * unrelated files that happen to share a domain. Where manualOverrides
 * (service.ts) holds only whatever is CURRENTLY in force — each save
 * overwrites it — this is the history: one row for every day an operator
 * actually entered a new "Yesterday's Total", kept forever (soft-deleted,
 * never dropped — see store.ts).
 *
 * THE ONE RULE THAT MATTERS: a row is written only when the day-total value
 * being saved is NEW, not merely present. The manual-figures form re-sends
 * whatever is currently in the Yesterday's Total box on every save — including
 * a save that only changed Total Assigned, or that unfixes something else — so
 * "the field is non-empty" is not "it was just entered". Comparing against
 * what was already stored before this save is what tells the two apart, and
 * getting it wrong either floods the ledger with duplicate same-day rows from
 * unrelated saves, or (worse for an official record) silently drops a genuine
 * entry. See maybeRecordEntry.
 */

import { createRequire } from 'node:module';
import * as store from './store.ts';

const require_ = createRequire(import.meta.url);
const xlsxLib = (): any => require_('xlsx');

const CR = 1e7;

export interface MaybeRecordInput {
  /** config.manualOverrides.dayTotal as it stood BEFORE this save, in rupees. */
  prevDayRupees: number | null;
  /** The cleaned dayTotal from THIS save, in rupees. */
  nextDayRupees: number | null;
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
 * Record one day's entry, but only if a day-total genuinely changed.
 *
 * Equal-to-what-was-already-stored (including both null, the ordinary case of
 * a save that never touched Yesterday's Total) is not an entry and writes
 * nothing. A missing Total Expenditure would mean the day figure was typed but
 * never actually applied — the frontend always derives one from it, so this
 * only guards against a malformed request reaching here some other way.
 */
export async function maybeRecordEntry(input: MaybeRecordInput): Promise<store.RbiRecordRow | null> {
  const { nextDayRupees, totalExpenditureRupees } = input;
  const entered = nextDayRupees != null && nextDayRupees !== input.prevDayRupees;
  if (!entered || totalExpenditureRupees == null) return null;
  return store.addRbiRecord({
    entryDate: input.entryDate,
    totalAssigned: input.totalAssignedRupees,
    totalExpenditure: totalExpenditureRupees,
    balance: input.balanceRupees,
    dayTotal: nextDayRupees,
    recordedBy: input.recordedBy,
  });
}

export interface RbiRecordView {
  id: string;
  date: string;
  totalAssigned: number | null;
  totalExpenditure: number;
  balance: number | null;
  dayTotal: number;
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
    totalExpenditure: toCrNum(r.totalExpenditure) as number,
    balance: toCrNum(r.balance),
    dayTotal: toCrNum(r.dayTotal) as number,
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
