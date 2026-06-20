/**
 * branch-merge.ts — §F-2 (S78-E02b) admin branch merge workflow
 *
 * Promote observations from a feature branch (`source_branch`) to a target
 * branch (typically `main`). This is the merge-time companion to §78-E02's
 * branch-scoped storage + search filter.
 *
 * Conflict policy:
 *   - "skip"      → if target branch already has a row with identical
 *                   content_redacted, leave source row on source_branch.
 *   - "overwrite" → delete the conflicting target row, then promote source.
 *   - "append"    → always promote source (allow duplicates).
 *
 * Safety contract:
 *   - default dry_run=true; nothing is mutated unless caller sets
 *     both `apply: true` AND `dry_run: false`. If `dry_run` is left unset
 *     OR set to true, dry_run wins regardless of `apply`.
 *   - Every invocation writes a summary row to mem_audit_log; mutating
 *     invocations also write per-conflict resolution rows.
 *   - "Promote" = `UPDATE mem_observations SET branch = ? WHERE id = ?` on
 *     the source row's id. We never copy data — branch labels are
 *     retargeted in place, so vector/FTS rows remain valid.
 *
 * Conflict detection key: (project, content_redacted). We deliberately do
 * not match on `id` (always unique) or `session_id` (sessions are
 * branch-local). content_redacted is the post-PII-scrub form already used
 * as the FTS column and is the closest thing to "same observation".
 */

import type { Database } from "bun:sqlite";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BranchMergeMode = "overwrite" | "append" | "skip";

export interface BranchMergeRequest {
  source_branch: string;
  target_branch: string;
  mode: BranchMergeMode;
  /** Default true. If true, no mutation occurs. dry_run wins over apply. */
  dry_run?: boolean;
  /** Must be explicitly true (and dry_run explicitly false) to mutate. */
  apply?: boolean;
  /** Optional actor recorded in mem_audit_log (default "system"). */
  actor?: string;
  /** Optional project filter — restrict merge to a single project. */
  project?: string;
}

export interface BranchMergeConflict {
  source_id: string;
  target_id: string;
  resolution: "promoted" | "skipped" | "removed_target_then_promoted";
}

export interface BranchMergeResult {
  ok: boolean;
  error?: string;
  dry_run: boolean;
  mode: BranchMergeMode;
  source_branch: string;
  target_branch: string;
  candidate_count: number;
  promoted: number;
  conflicts: number;
  skipped: number;
  removed_target: number;
  conflict_details: BranchMergeConflict[];
  audit_log_rows: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ALLOWED_MODES: ReadonlySet<BranchMergeMode> = new Set(["overwrite", "append", "skip"]);

function nowIso(): string {
  return new Date().toISOString();
}

function writeAudit(
  db: Database,
  actor: string,
  targetId: string,
  details: Record<string, unknown>,
): void {
  db.query(
    `INSERT INTO mem_audit_log(action, actor, target_type, target_id, details_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run("branch_merge", actor, "observation", targetId, JSON.stringify(details), nowIso());
}

interface ObsRow {
  id: string;
  project: string;
  content_redacted: string;
}

function selectSourceRows(
  db: Database,
  sourceBranch: string,
  project: string | undefined,
): ObsRow[] {
  if (project) {
    return db
      .query<ObsRow, [string, string]>(
        `SELECT id, project, content_redacted
           FROM mem_observations
          WHERE branch = ? AND project = ?`,
      )
      .all(sourceBranch, project);
  }
  return db
    .query<ObsRow, [string]>(
      `SELECT id, project, content_redacted
         FROM mem_observations
        WHERE branch = ?`,
    )
    .all(sourceBranch);
}

function findTargetConflict(
  db: Database,
  targetBranch: string,
  project: string,
  contentRedacted: string,
): string | null {
  const row = db
    .query<{ id: string }, [string, string, string]>(
      `SELECT id FROM mem_observations
        WHERE branch = ? AND project = ? AND content_redacted = ?
        LIMIT 1`,
    )
    .get(targetBranch, project, contentRedacted);
  return row?.id ?? null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function branchMerge(
  db: Database,
  req: BranchMergeRequest,
): Promise<BranchMergeResult> {
  // ---- Input validation --------------------------------------------------
  const baseResult: BranchMergeResult = {
    ok: false,
    dry_run: true,
    mode: (req?.mode ?? "skip") as BranchMergeMode,
    source_branch: req?.source_branch ?? "",
    target_branch: req?.target_branch ?? "",
    candidate_count: 0,
    promoted: 0,
    conflicts: 0,
    skipped: 0,
    removed_target: 0,
    conflict_details: [],
    audit_log_rows: 0,
  };

  if (!req || typeof req.source_branch !== "string" || req.source_branch.length === 0) {
    return { ...baseResult, error: "source_branch is required" };
  }
  if (typeof req.target_branch !== "string" || req.target_branch.length === 0) {
    return { ...baseResult, error: "target_branch is required" };
  }
  if (req.source_branch === req.target_branch) {
    return { ...baseResult, error: "source_branch and target_branch must not be the same" };
  }
  if (!ALLOWED_MODES.has(req.mode)) {
    return { ...baseResult, error: `mode must be one of: ${[...ALLOWED_MODES].join(", ")}` };
  }

  // dry_run wins: only mutate when caller explicitly sets dry_run=false AND apply=true
  const dryRun = req.dry_run === false && req.apply === true ? false : true;
  const actor = typeof req.actor === "string" && req.actor.length > 0 ? req.actor : "system";

  const sourceRows = selectSourceRows(db, req.source_branch, req.project);
  const conflicts: BranchMergeConflict[] = [];
  let promoted = 0;
  let skipped = 0;
  let removedTarget = 0;
  let auditRows = 0;

  // Determine plan first (so dry_run produces an accurate preview).
  type Action = "promote" | "skip" | "remove_then_promote";
  const plan: Array<{ row: ObsRow; action: Action; targetConflictId: string | null }> = [];

  for (const row of sourceRows) {
    const conflictId = findTargetConflict(db, req.target_branch, row.project, row.content_redacted);
    if (!conflictId) {
      plan.push({ row, action: "promote", targetConflictId: null });
      continue;
    }
    switch (req.mode) {
      case "append":
        plan.push({ row, action: "promote", targetConflictId: conflictId });
        break;
      case "skip":
        plan.push({ row, action: "skip", targetConflictId: conflictId });
        break;
      case "overwrite":
        plan.push({ row, action: "remove_then_promote", targetConflictId: conflictId });
        break;
    }
  }

  const updateBranchStmt = dryRun
    ? null
    : db.query<unknown, [string, string, string]>(
        `UPDATE mem_observations SET branch = ?, updated_at = ? WHERE id = ?`,
      );
  const deleteStmt = dryRun
    ? null
    : db.query<unknown, [string]>(`DELETE FROM mem_observations WHERE id = ?`);

  for (const step of plan) {
    if (step.action === "promote") {
      if (step.targetConflictId) {
        // append-mode conflict: still promote, but record it
        conflicts.push({
          source_id: step.row.id,
          target_id: step.targetConflictId,
          resolution: "promoted",
        });
        if (!dryRun) {
          writeAudit(db, actor, step.row.id, {
            source_branch: req.source_branch,
            target_branch: req.target_branch,
            mode: req.mode,
            resolution: "promoted",
            target_conflict_id: step.targetConflictId,
            dry_run: false,
          });
          auditRows += 1;
        }
      }
      if (!dryRun && updateBranchStmt) {
        updateBranchStmt.run(req.target_branch, nowIso(), step.row.id);
      }
      promoted += 1;
    } else if (step.action === "skip") {
      conflicts.push({
        source_id: step.row.id,
        target_id: step.targetConflictId!,
        resolution: "skipped",
      });
      skipped += 1;
      if (!dryRun) {
        writeAudit(db, actor, step.row.id, {
          source_branch: req.source_branch,
          target_branch: req.target_branch,
          mode: req.mode,
          resolution: "skipped",
          target_conflict_id: step.targetConflictId,
          dry_run: false,
        });
        auditRows += 1;
      }
    } else {
      // remove_then_promote (overwrite mode with conflict)
      conflicts.push({
        source_id: step.row.id,
        target_id: step.targetConflictId!,
        resolution: "removed_target_then_promoted",
      });
      if (!dryRun) {
        if (deleteStmt && step.targetConflictId) deleteStmt.run(step.targetConflictId);
        writeAudit(db, actor, step.row.id, {
          source_branch: req.source_branch,
          target_branch: req.target_branch,
          mode: req.mode,
          resolution: "removed_target_then_promoted",
          target_conflict_id: step.targetConflictId,
          dry_run: false,
        });
        auditRows += 1;
        if (updateBranchStmt) updateBranchStmt.run(req.target_branch, nowIso(), step.row.id);
      }
      promoted += 1;
      removedTarget += 1;
    }
  }

  // Summary audit row — always written, including dry_run, so the action is observable.
  writeAudit(db, actor, "", {
    source_branch: req.source_branch,
    target_branch: req.target_branch,
    mode: req.mode,
    dry_run: dryRun,
    project: req.project ?? null,
    candidate_count: sourceRows.length,
    promoted,
    conflicts: conflicts.length,
    skipped,
    removed_target: removedTarget,
  });
  auditRows += 1;

  return {
    ok: true,
    dry_run: dryRun,
    mode: req.mode,
    source_branch: req.source_branch,
    target_branch: req.target_branch,
    candidate_count: sourceRows.length,
    promoted: dryRun ? promoted : promoted,
    conflicts: conflicts.length,
    skipped,
    removed_target: removedTarget,
    conflict_details: conflicts,
    audit_log_rows: auditRows,
  };
}
