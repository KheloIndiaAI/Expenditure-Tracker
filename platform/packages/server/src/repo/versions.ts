/**
 * Version lifecycle — implements PRD `07_Upload_System.md §5–§6` and `03_Data_Model.md §9`.
 *
 * The lifecycle is: staged → submitted → published → superseded, with `rejected`
 * as the terminal branch. Only one version is ever `is_current = 1`.
 *
 * RI-4 (03 §8): a version is IMMUTABLE once published. `fact_transaction` rows of a
 * published version are never updated or deleted here; a correction is a NEW version.
 * That invariant is enforced by `assertStageable()`, not left to convention.
 */

import type { DB } from '../db/index.ts';
import { all, one, run, transact } from '../db/index.ts';
import type { PublishResult } from '../contracts.ts';
import type {
  BreakdownDim,
  BreakdownRow,
  DataQualityObservation,
  DatasetVersion,
  ExceptionQueue,
  HealthScore,
  InsightCard,
  Totals,
  Transaction,
  VersionStatus,
} from '@efip/shared';
import { BREAKDOWN_DIMS } from '@efip/shared';

const nowISO = (): string => new Date().toISOString();

/**
 * Run `fn` atomically, tolerating a caller that already opened a transaction —
 * `BEGIN` inside `BEGIN` is an error in SQLite, and the orchestrator legitimately
 * wraps several repository calls in one unit of work (07 §9, "no partial state").
 */
export function atomically<T>(db: DB, fn: () => T): T {
  const open = (db as unknown as { isTransaction?: boolean }).isTransaction === true;
  return open ? fn() : transact(db, fn);
}

// ─── Row shapes ──────────────────────────────────────────────────────────────

interface VersionRow {
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
  is_current: number;
  txn_count: number;
  net_amount: number;
  utilisation: number;
  balance_remaining: number;
  notes: string | null;
}

function mapVersion(r: VersionRow): DatasetVersion {
  return {
    version_id: Number(r.version_id),
    label: r.label,
    status: r.status,
    uploaded_by: r.uploaded_by,
    uploaded_at: r.uploaded_at,
    submitted_by: r.submitted_by,
    submitted_at: r.submitted_at,
    published_by: r.published_by,
    published_at: r.published_at,
    source_filename: r.source_filename,
    checksum: r.checksum,
    is_current: r.is_current === 1,
    txn_count: Number(r.txn_count),
    net_amount: Number(r.net_amount),
    utilisation: Number(r.utilisation),
    balance_remaining: Number(r.balance_remaining),
    notes: r.notes,
  };
}

const VERSION_COLUMNS = `version_id, label, status, uploaded_by, uploaded_at, submitted_by, submitted_at,
  published_by, published_at, source_filename, checksum, is_current, txn_count, net_amount,
  balance_remaining, utilisation, notes`;

// ─── Reads ───────────────────────────────────────────────────────────────────

export function getVersion(db: DB, versionId: number): DatasetVersion | null {
  const row = one<VersionRow>(db, `SELECT ${VERSION_COLUMNS} FROM dim_version WHERE version_id = ?`, [
    versionId,
  ]);
  return row ? mapVersion(row) : null;
}

/** The version every screen is served from — the dashboard is a pure function of it (07 §1). */
export function currentVersion(db: DB): DatasetVersion | null {
  const row = one<VersionRow>(
    db,
    `SELECT ${VERSION_COLUMNS} FROM dim_version WHERE is_current = 1 ORDER BY version_id DESC LIMIT 1`,
  );
  return row ? mapVersion(row) : null;
}

export function currentVersionId(db: DB): number | null {
  return currentVersion(db)?.version_id ?? null;
}

/** Full history, newest first — nothing is ever removed from it (07 §5). */
export function listVersions(db: DB): DatasetVersion[] {
  return all<VersionRow>(db, `SELECT ${VERSION_COLUMNS} FROM dim_version ORDER BY version_id DESC`).map(
    mapVersion,
  );
}

export function listPublishedVersions(db: DB): DatasetVersion[] {
  return all<VersionRow>(
    db,
    `SELECT ${VERSION_COLUMNS} FROM dim_version
     WHERE published_at IS NOT NULL AND status IN ('published','superseded')
     ORDER BY version_id DESC`,
  ).map(mapVersion);
}

/**
 * Idempotency (07 §9): re-uploading an identical file is detected by checksum and
 * must not create a duplicate version. Rejected versions are excluded so a corrected
 * re-upload of a previously rejected file can legitimately be staged again.
 */
export function findVersionByChecksum(db: DB, checksum: string): DatasetVersion | null {
  const row = one<VersionRow>(
    db,
    `SELECT ${VERSION_COLUMNS} FROM dim_version
     WHERE checksum = ? AND status <> 'rejected'
     ORDER BY is_current DESC, version_id DESC LIMIT 1`,
    [checksum],
  );
  return row ? mapVersion(row) : null;
}

// ─── Candidate creation & staging ────────────────────────────────────────────

export interface CreateCandidateInput {
  filename: string;
  checksum: string;
  uploadedBy: string | null;
  label?: string;
  notes?: string | null;
}

/** 07 §3.7 — persist a candidate version, fully isolated from the live Published store. */
export function createCandidate(db: DB, input: CreateCandidateInput): number {
  return atomically(db, () => {
    run(
      db,
      `INSERT INTO dim_version
         (label, status, uploaded_by, uploaded_at, source_filename, checksum,
          is_current, txn_count, net_amount, utilisation, balance_remaining, notes)
       VALUES (?, 'staged', ?, ?, ?, ?, 0, 0, 0, 0, 0, ?)`,
      [input.label ?? '', input.uploadedBy, nowISO(), input.filename, input.checksum, input.notes ?? null],
    );
    const id = Number(one<{ id: number }>(db, 'SELECT last_insert_rowid() AS id')!.id);
    if (!input.label) {
      run(db, 'UPDATE dim_version SET label = ? WHERE version_id = ?', [`Version ${id}`, id]);
    }
    return id;
  });
}

/** 07 §3.1 — the raw workbook is retained as the version's immutable evidence artifact. */
export function recordUploadArtifact(
  db: DB,
  versionId: number,
  artifact: { filename: string; checksum: string; sizeBytes: number; storedPath: string },
): void {
  run(
    db,
    `INSERT INTO upload_artifact (version_id, filename, checksum, size_bytes, stored_path, uploaded_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(version_id) DO UPDATE SET
       filename = excluded.filename, checksum = excluded.checksum,
       size_bytes = excluded.size_bytes, stored_path = excluded.stored_path`,
    [versionId, artifact.filename, artifact.checksum, artifact.sizeBytes, artifact.storedPath, nowISO()],
  );
}

/** Ingestion may carry the classification audit trail, which the shared type does not model. */
export type StagedTransaction = Transaction & {
  classification_rule_id?: string;
  classification_evidence?: string;
};

function assertStageable(db: DB, versionId: number): DatasetVersion {
  const v = getVersion(db, versionId);
  if (!v) throw new Error(`Version ${versionId} does not exist`);
  // RI-4 — published/superseded snapshots are immutable; corrections create a new version.
  if (v.status !== 'staged') {
    throw new Error(
      `Version ${versionId} is '${v.status}' and cannot be re-staged. RI-4: a version is immutable once published — create a new version instead.`,
    );
  }
  return v;
}

const TXN_INSERT = `INSERT INTO fact_transaction (
  transaction_id, version_id, s_no, source_sheet, source_row, payment_date, voucher_no, sanction_no,
  head, subvertical, regional_centre, grantee, expenditure_type, narration, sub_category,
  sub_category_group, classification_basis, classification_rule_id, classification_evidence,
  net_amount, amt_general, amt_sc, amt_st, utilisation, balance_remaining,
  utilisation_pct, balance_pct, is_idle, is_fully_utilised
) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;

/**
 * Bulk-load the candidate's rows. Transactional: a mid-pipeline failure leaves no
 * partial state (07 §9, VR-FAIL-04 "no half-loaded store").
 */
export function stageTransactions(db: DB, versionId: number, txns: StagedTransaction[]): void {
  assertStageable(db, versionId);
  atomically(db, () => {
    // Re-staging replaces the candidate wholesale; only a `staged` version can reach here.
    run(db, 'DELETE FROM fact_transaction WHERE version_id = ?', [versionId]);
    for (const t of txns) {
      run(db, TXN_INSERT, [
        t.transaction_id,
        versionId,
        t.s_no,
        t.source_sheet,
        t.source_row,
        t.payment_date,
        t.voucher_no,
        t.sanction_no,
        t.head,
        t.subvertical,
        t.regional_centre,
        t.grantee,
        t.expenditure_type,
        t.narration,
        t.sub_category,
        t.sub_category_group,
        t.classification_basis,
        t.classification_rule_id ?? '',
        t.classification_evidence ?? '',
        t.net_amount,
        t.amt_general,
        t.amt_sc,
        t.amt_st,
        t.utilisation,
        t.balance_remaining,
        t.utilisation_pct,
        t.balance_pct,
        t.is_idle ? 1 : 0,
        t.is_fully_utilised ? 1 : 0,
      ]);
    }
    // Header figures so the candidate is describable before analytics run.
    const sum = (pick: (t: StagedTransaction) => number): number =>
      Math.round(txns.reduce((a, t) => a + pick(t), 0) * 100) / 100;
    run(
      db,
      `UPDATE dim_version SET txn_count = ?, net_amount = ?, utilisation = ?, balance_remaining = ?
       WHERE version_id = ?`,
      [txns.length, sum((t) => t.net_amount), sum((t) => t.utilisation), sum((t) => t.balance_remaining), versionId],
    );
  });
}

/** Budget layer (03 §5) — loaded alongside the candidate, same version key. */
export function stageBudget(
  db: DB,
  versionId: number,
  rows: Array<{
    component: string;
    sub_component: string | null;
    head: string;
    be_allocation_cr: number | null;
    assigned_to_sai_cr: number | null;
    balance_cr: number | null;
    expenditure_to_date_cr: number | null;
    week: string | null;
  }>,
): void {
  assertStageable(db, versionId);
  atomically(db, () => {
    run(db, 'DELETE FROM fact_budget_allocation WHERE version_id = ?', [versionId]);
    for (const r of rows) {
      run(
        db,
        `INSERT INTO fact_budget_allocation
           (version_id, component, sub_component, head, be_allocation_cr, assigned_to_sai_cr,
            balance_cr, expenditure_to_date_cr, week)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [
          versionId,
          r.component,
          r.sub_component,
          r.head,
          r.be_allocation_cr,
          r.assigned_to_sai_cr,
          r.balance_cr,
          r.expenditure_to_date_cr,
          r.week,
        ],
      );
    }
  });
}

// ─── Maker–checker workflow (07 §4) ──────────────────────────────────────────

/** Maker hands the candidate to a checker. A maker may never publish their own upload. */
export function submitForApproval(db: DB, versionId: number, userId: string): DatasetVersion {
  const v = getVersion(db, versionId);
  if (!v) throw new Error(`Version ${versionId} does not exist`);
  if (v.status !== 'staged') {
    throw new Error(`Version ${versionId} is '${v.status}'; only a staged candidate can be submitted.`);
  }
  run(
    db,
    `UPDATE dim_version SET status = 'submitted', submitted_by = ?, submitted_at = ? WHERE version_id = ?`,
    [userId, nowISO(), versionId],
  );
  return getVersion(db, versionId)!;
}

/**
 * Checker returns the candidate to the maker. VR-FAIL-02: the last good version keeps
 * serving every screen, unchanged — so this never touches `is_current`.
 */
export function reject(db: DB, versionId: number, userId: string, reason: string): DatasetVersion {
  const v = getVersion(db, versionId);
  if (!v) throw new Error(`Version ${versionId} does not exist`);
  if (v.status !== 'staged' && v.status !== 'submitted') {
    throw new Error(`Version ${versionId} is '${v.status}' and cannot be rejected.`);
  }
  run(db, `UPDATE dim_version SET status = 'rejected', notes = ? WHERE version_id = ?`, [reason, versionId]);
  return getVersion(db, versionId)!;
}

/**
 * Separation of duties (07 §4). Returned as a reason string rather than thrown so the
 * API layer can render it; the role matrix itself is enforced at the route boundary.
 */
export function publishBlockReason(db: DB, versionId: number, userId: string): string | null {
  const v = getVersion(db, versionId);
  if (!v) return `Version ${versionId} does not exist`;
  if (v.status !== 'staged' && v.status !== 'submitted') {
    return `Version ${versionId} is '${v.status}' and is not publishable`;
  }
  if (v.uploaded_by && v.uploaded_by === userId) {
    return 'A maker cannot publish their own upload — a checker must approve (07 §4)';
  }
  const run_ = one<{ passed: number; blockers: number }>(
    db,
    'SELECT passed, blockers FROM validation_run WHERE version_id = ? ORDER BY run_id DESC LIMIT 1',
    [versionId],
  );
  if (run_ && (run_.passed !== 1 || Number(run_.blockers) > 0)) {
    return `Validation reported ${run_.blockers} blocker(s); publishing is impossible until they are cleared (06 §7)`;
  }
  return null;
}

// ─── Publish (the critical path) ─────────────────────────────────────────────

/**
 * Everything the publish materialises. Supplied by the caller so this module stays
 * free of analytics logic — the repository stores, it does not compute (02 §3 coupling rule).
 */
export interface PublishArtifacts {
  totals: Totals;
  /** One entry per BreakdownDim, or a factory called once per dim (compute-on-publish, 02 §6). */
  breakdowns: Record<BreakdownDim, BreakdownRow[]> | ((dim: BreakdownDim) => BreakdownRow[]);
  health: HealthScore;
  insights: InsightCard[];
  exceptions: ExceptionQueue[];
  dataQuality?: DataQualityObservation[];
}

export interface PublishOptions {
  /**
   * Separation of duties (07 §4) is a workflow rule owned by the API layer, which
   * calls `publishBlockReason()` before offering the action. Set this when a caller
   * wants the repository to refuse a self-approval outright as well.
   */
  enforceMakerChecker?: boolean;
  /**
   * Escape hatch for single-operator / seed scenarios where the same identity
   * both uploads and publishes (e.g. loading the baseline). Off by default, so
   * the maker-checker guard below refuses a self-approval unless explicitly set.
   */
  allowSelfApproval?: boolean;
}

/**
 * Promote a candidate to current. ONE transaction: either the whole version goes live
 * with all of its materialisations, or nothing changes (VR-FAIL-04, 07 §9).
 */
export function publish(
  db: DB,
  versionId: number,
  publishedBy: string,
  artifacts: PublishArtifacts,
  opts: PublishOptions = {},
): PublishResult {
  const v = getVersion(db, versionId);
  if (!v) throw new Error(`Version ${versionId} does not exist`);
  if (v.status !== 'staged' && v.status !== 'submitted') {
    throw new Error(`Version ${versionId} is '${v.status}' and cannot be published.`);
  }
  if (!opts.allowSelfApproval && v.uploaded_by && v.uploaded_by === publishedBy) {
    throw new Error('A maker cannot publish their own upload — a checker must approve (07 §4).');
  }
  const lastRun = one<{ passed: number; blockers: number }>(
    db,
    'SELECT passed, blockers FROM validation_run WHERE version_id = ? ORDER BY run_id DESC LIMIT 1',
    [versionId],
  );
  // 06 §7 — a Blocker refuses the publish outright; the last good version keeps serving.
  if (lastRun && (lastRun.passed !== 1 || Number(lastRun.blockers) > 0)) {
    throw new Error(
      `Version ${versionId} has ${lastRun.blockers} unresolved blocker(s); publish refused (06 VR-FAIL-01).`,
    );
  }

  const breakdownOf =
    typeof artifacts.breakdowns === 'function'
      ? artifacts.breakdowns
      : (d: BreakdownDim) => (artifacts.breakdowns as Record<BreakdownDim, BreakdownRow[]>)[d];

  const published_at = nowISO();
  const t = artifacts.totals;

  atomically(db, () => {
    // 1 · Retire the outgoing current version. Nothing is destroyed (03 §9).
    run(
      db,
      `UPDATE dim_version SET is_current = 0, status = 'superseded'
       WHERE is_current = 1 AND version_id <> ? AND status = 'published'`,
      [versionId],
    );
    run(db, 'UPDATE dim_version SET is_current = 0 WHERE is_current = 1 AND version_id <> ?', [versionId]);

    // 2 · Promote this version.
    run(
      db,
      `UPDATE dim_version
         SET status = 'published', is_current = 1, published_by = ?, published_at = ?,
             txn_count = ?, net_amount = ?, utilisation = ?, balance_remaining = ?
       WHERE version_id = ?`,
      [
        publishedBy,
        published_at,
        t.txn_count,
        t.net_amount,
        t.utilisation,
        t.balance_remaining,
        versionId,
      ],
    );

    // 3 · agg_totals — VR-15: published totals equal the validated candidate's totals.
    run(db, 'DELETE FROM agg_totals WHERE version_id = ?', [versionId]);
    run(
      db,
      `INSERT INTO agg_totals (version_id, net_amount, utilisation, balance_remaining, utilisation_pct,
         balance_pct, txn_count, amt_general, amt_sc, amt_st, idle_count, idle_amount,
         fully_utilised_count, fully_utilised_amount)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        versionId,
        t.net_amount,
        t.utilisation,
        t.balance_remaining,
        t.utilisation_pct,
        t.balance_pct,
        t.txn_count,
        t.amt_general,
        t.amt_sc,
        t.amt_st,
        t.idle_count,
        t.idle_amount,
        t.fully_utilised_count,
        t.fully_utilised_amount,
      ],
    );

    // 4 · agg_breakdown for EVERY dimension — the expensive work happens once per version.
    run(db, 'DELETE FROM agg_breakdown WHERE version_id = ?', [versionId]);
    for (const dim of BREAKDOWN_DIMS) {
      const rows = breakdownOf(dim);
      if (!Array.isArray(rows)) {
        throw new Error(
          `publish: no breakdown supplied for dimension "${dim}". Compute-on-publish requires every BreakdownDim (02 §6).`,
        );
      }
      for (const r of rows) {
        run(
          db,
          `INSERT INTO agg_breakdown (version_id, dim, member_key, label, net_amount, utilisation,
             balance_remaining, utilisation_pct, txn_count, idle_count, idle_amount,
             amt_general, amt_sc, amt_st, share_of_parent, "rank", colour_slot)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            versionId,
            dim,
            r.key,
            r.label,
            r.net_amount,
            r.utilisation,
            r.balance_remaining,
            r.utilisation_pct,
            r.txn_count,
            r.idle_count,
            r.idle_amount,
            r.amt_general,
            r.amt_sc,
            r.amt_st,
            r.share_of_parent,
            r.rank,
            r.colour_slot,
          ],
        );
      }
    }

    // 5 · Health score — never stored without its explainable breakdown (FR-HS-02).
    run(db, 'DELETE FROM version_health WHERE version_id = ?', [versionId]);
    run(db, 'INSERT INTO version_health (version_id, score, band, components) VALUES (?,?,?,?)', [
      versionId,
      artifacts.health.score,
      artifacts.health.band,
      JSON.stringify(artifacts.health.components),
    ]);

    // 6 · Insights.
    run(db, 'DELETE FROM version_insight WHERE version_id = ?', [versionId]);
    for (const i of artifacts.insights) {
      run(
        db,
        `INSERT INTO version_insight (id, version_id, kind, severity, statement, figure, figure_label,
           entity, materiality, drill)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [
          i.id,
          versionId,
          i.kind,
          i.severity,
          i.statement,
          i.figure,
          i.figure_label,
          i.entity,
          i.materiality,
          i.drill ? JSON.stringify(i.drill) : null,
        ],
      );
    }

    // 7 · Exception queues, flattened to items (05 §6).
    run(db, 'DELETE FROM version_exception WHERE version_id = ?', [versionId]);
    for (const q of artifacts.exceptions) {
      for (const item of q.items) {
        run(
          db,
          `INSERT INTO version_exception (id, version_id, type, rule_id, severity, amount,
             regional_centre, grantee, sub_category, age_days, reason, transaction_ids)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            item.id,
            versionId,
            item.type,
            item.rule_id,
            item.severity,
            item.amount,
            item.regional_centre,
            item.grantee,
            item.sub_category,
            item.age_days,
            item.reason,
            JSON.stringify(item.transaction_ids),
          ],
        );
      }
    }

    // 8 · Data Quality Log — the workbook's own control, kept as a live artifact (04.13).
    run(db, 'DELETE FROM data_quality_observation WHERE version_id = ?', [versionId]);
    for (const o of artifacts.dataQuality ?? []) {
      run(
        db,
        `INSERT INTO data_quality_observation (id, version_id, sheet, row_no, issue_type, observation,
           severity, rule_id)
         VALUES (?,?,?,?,?,?,?,?)`,
        [o.id, versionId, o.sheet, o.row, o.issue_type, o.observation, o.severity, o.rule_id],
      );
    }
  });

  return { version_id: versionId, published_at, totals: t };
}

/**
 * Roll "current" back to an earlier published version (07 §6). Nothing is destroyed:
 * the rolled-past version stays in history as `superseded` with its original stamps,
 * so its exact figures remain reproducible. The caller writes the audit event.
 */
export function rollback(db: DB, targetVersionId: number, _userId: string): DatasetVersion {
  const target = getVersion(db, targetVersionId);
  if (!target) throw new Error(`Version ${targetVersionId} does not exist`);
  if (!target.published_at || (target.status !== 'published' && target.status !== 'superseded')) {
    throw new Error(`Version ${targetVersionId} was never published; only a published version can be restored.`);
  }
  atomically(db, () => {
    run(
      db,
      `UPDATE dim_version SET is_current = 0, status = 'superseded'
       WHERE is_current = 1 AND version_id <> ? AND status = 'published'`,
      [targetVersionId],
    );
    run(db, 'UPDATE dim_version SET is_current = 0 WHERE is_current = 1 AND version_id <> ?', [
      targetVersionId,
    ]);
    // published_by / published_at are deliberately untouched — the restored version keeps
    // its original "as-of" stamp (07 §6 AC).
    run(db, `UPDATE dim_version SET is_current = 1, status = 'published' WHERE version_id = ?`, [
      targetVersionId,
    ]);
  });
  return getVersion(db, targetVersionId)!;
}

// ─── Validation runs (06) ────────────────────────────────────────────────────

/** Persists a validation report against its candidate. Append-only per run. */
export function recordValidationRun(
  db: DB,
  versionId: number,
  report: { ran_at: string; passed: boolean; blockers: number; warnings: number; infos: number },
  fullReportJson: string,
): number {
  run(
    db,
    `INSERT INTO validation_run (version_id, ran_at, passed, blockers, warnings, infos, report)
     VALUES (?,?,?,?,?,?,?)`,
    [versionId, report.ran_at, report.passed ? 1 : 0, report.blockers, report.warnings, report.infos, fullReportJson],
  );
  return Number(one<{ id: number }>(db, 'SELECT last_insert_rowid() AS id')!.id);
}

export function latestValidationReport(db: DB, versionId: number): string | null {
  const row = one<{ report: string }>(
    db,
    'SELECT report FROM validation_run WHERE version_id = ? ORDER BY run_id DESC LIMIT 1',
    [versionId],
  );
  return row?.report ?? null;
}

export function dataQualityFor(db: DB, versionId: number): DataQualityObservation[] {
  return all<{
    id: number;
    sheet: string;
    row_no: number;
    issue_type: string;
    observation: string;
    severity: DataQualityObservation['severity'];
    rule_id: string;
  }>(
    db,
    `SELECT id, sheet, row_no, issue_type, observation, severity, rule_id
     FROM data_quality_observation WHERE version_id = ? ORDER BY id`,
    [versionId],
  ).map((r) => ({
    id: Number(r.id),
    sheet: r.sheet,
    row: Number(r.row_no),
    issue_type: r.issue_type,
    observation: r.observation,
    severity: r.severity,
    rule_id: r.rule_id,
  }));
}
