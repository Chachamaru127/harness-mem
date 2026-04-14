/**
 * S81-B02: Low-value eviction policy.
 *
 * Produces a deterministic ranking over observations that are candidates for
 * soft-delete, based on three factors:
 *
 *   1. access_count        — how often retrieval surfaced the row
 *   2. signal_score         — keyword-based importance (0..1)
 *   3. age_days             — time since `created_at`
 *
 * Each factor is normalised to 0..1 (0 = "worth keeping", 1 = "worth
 * forgetting") and combined with tunable weights. The resulting composite
 * score is also 0..1; anything at or above `score_threshold` is evicted in
 * "wet" mode (sets `archived_at`) or merely reported in "dry" mode.
 *
 * Design notes:
 *   - Pure function of the rows + options. Tests pass a literal fixture so
 *     the maths is exercised without needing a full core instance.
 *   - Dry vs wet return the **same** target list — the only difference is
 *     whether the UPDATE runs. This is exactly the invariant the DoD asks
 *     for: "dry_run と wet で結果一致 test PASS".
 *   - The wet path gates on `HARNESS_MEM_AUTO_FORGET=1`. If the env guard
 *     is not set, a wet-mode request degrades gracefully to dry-mode with
 *     an explicit reason — we never silently archive data.
 *   - "Archive" here means soft-delete: we flip `archived_at`. Hard delete
 *     is not exposed; if operators want to reclaim space they must run a
 *     follow-up vacuum job. §81 explicitly scopes B02 to soft-delete only.
 */

import { type Database } from "bun:sqlite";

export interface ForgetPolicyWeights {
  access: number;
  signal: number;
  age: number;
}

export const DEFAULT_FORGET_WEIGHTS: ForgetPolicyWeights = {
  access: 0.4,
  signal: 0.3,
  age: 0.3,
};

export interface ForgetPolicyOptions {
  /** When true, do not mutate the DB — only report candidates. Defaults to true. */
  dry_run?: boolean;
  /** 0..1 threshold above which a row is considered low-value. Default 0.7. */
  score_threshold?: number;
  /** Component weights — must be non-negative and sum > 0. */
  weights?: Partial<ForgetPolicyWeights>;
  /** Optional project filter — only evict rows under this project. */
  project?: string;
  /** Max rows to evict per call. Default 100. Safety valve for big DBs. */
  limit?: number;
  /** Ignores access_count > 0 rows (never forget something that was used). Default true. */
  protect_accessed?: boolean;
  /**
   * Time reference for age normalisation. Injectable so tests pin the clock.
   * Defaults to Date.now().
   */
  now?: () => Date;
}

export interface ForgetPolicyCandidate {
  observation_id: string;
  project: string;
  score: number;
  factors: {
    access: number;
    signal: number;
    age: number;
  };
  age_days: number;
  access_count: number;
  signal_score: number;
}

export interface ForgetPolicyResult {
  dry_run: boolean;
  evicted: number;
  candidates: ForgetPolicyCandidate[];
  skipped_reason?: string;
  score_threshold: number;
  weights: ForgetPolicyWeights;
  scanned: number;
}

interface ObsRow {
  id: string;
  project: string;
  created_at: string | null;
  access_count: number | null;
  signal_score: number | null;
  archived_at: string | null;
  privacy_tags_json: string | null;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function normaliseWeights(input: Partial<ForgetPolicyWeights> | undefined): ForgetPolicyWeights {
  const merged = { ...DEFAULT_FORGET_WEIGHTS, ...(input ?? {}) };
  const access = Math.max(0, merged.access);
  const signal = Math.max(0, merged.signal);
  const age = Math.max(0, merged.age);
  const sum = access + signal + age;
  if (sum <= 0) {
    // fall back to equal weights so we never divide by zero
    return { access: 1 / 3, signal: 1 / 3, age: 1 / 3 };
  }
  return { access: access / sum, signal: signal / sum, age: age / sum };
}

/**
 * Normalise factor values to 0..1 where 1 means "worth forgetting".
 *
 *   - access_count: 1 when zero, decays toward 0 at >= 5 hits. A single
 *     retrieval is already strong evidence the row is useful.
 *   - signal_score: direct inverse (low signal → high eviction factor).
 *     Clamped to [0,1] to stay robust against fallout from legacy rows
 *     that predate signal extraction.
 *   - age_days: rises from 0 at 30d to 1 at 180d. Rows younger than 30d
 *     are always protected by the age axis to avoid churning fresh data.
 */
function scoreFactors(row: {
  access_count: number;
  signal_score: number;
  age_days: number;
}): ForgetPolicyCandidate["factors"] {
  const accessRaw = Math.max(0, row.access_count);
  const access = accessRaw === 0 ? 1 : clamp01(Math.max(0, 1 - accessRaw / 5));

  const signal = clamp01(1 - clamp01(row.signal_score));

  const age = clamp01((row.age_days - 30) / 150);

  return { access, signal, age };
}

function compositeScore(
  factors: ForgetPolicyCandidate["factors"],
  weights: ForgetPolicyWeights
): number {
  const s =
    weights.access * factors.access + weights.signal * factors.signal + weights.age * factors.age;
  return Math.round(s * 10000) / 10000;
}

function parsePrivacyTags(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function daysBetween(fromIso: string | null, now: Date): number {
  if (!fromIso) return 0;
  const t = Date.parse(fromIso);
  if (!Number.isFinite(t)) return 0;
  const diffMs = now.getTime() - t;
  return Math.max(0, diffMs / (24 * 3600 * 1000));
}

/** Env check is centralised so tests can override via process.env. */
export function isAutoForgetEnabled(): boolean {
  const v = process.env.HARNESS_MEM_AUTO_FORGET;
  return typeof v === "string" && v.trim() === "1";
}

/**
 * Pure scoring pass — does NOT touch the DB. Used by both dry and wet
 * modes to produce the identical candidate list.
 */
export function collectForgetCandidates(
  db: Database,
  options: ForgetPolicyOptions = {}
): { candidates: ForgetPolicyCandidate[]; scanned: number; weights: ForgetPolicyWeights } {
  const weights = normaliseWeights(options.weights);
  const threshold = typeof options.score_threshold === "number" ? options.score_threshold : 0.7;
  const limit = Math.max(1, Math.min(1000, Math.floor(options.limit ?? 100)));
  const protectAccessed = options.protect_accessed !== false;
  const now = (options.now ?? (() => new Date()))();

  const params: unknown[] = [];
  let sql = `
    SELECT id, project, created_at, access_count, signal_score, archived_at, privacy_tags_json
    FROM mem_observations
    WHERE archived_at IS NULL
  `;
  if (options.project) {
    sql += ` AND project = ?`;
    params.push(options.project);
  }

  const rows = db.query(sql).all(...(params as never[])) as ObsRow[];
  const scanned = rows.length;
  const candidates: ForgetPolicyCandidate[] = [];

  // S81-B02 hardening (Codex round 3 P2.2): scoreFactors' `age` factor
  // rises from 0 at 30d, but the access/signal factors can still push
  // the composite score over 0.7 for a brand-new row (age=0, access=1,
  // signal=1 → 0.7 with default weights). That is the opposite of the
  // "protect freshly-ingested data" promise in the design doc. Enforce
  // a hard minimum-age gate before candidates are even scored.
  const MIN_AGE_DAYS_FOR_EVICTION = 30;

  for (const row of rows) {
    // Never auto-archive privacy-sensitive rows.
    const tags = parsePrivacyTags(row.privacy_tags_json);
    if (tags.includes("private") || tags.includes("legal_hold")) continue;

    const accessCount = row.access_count ?? 0;
    if (protectAccessed && accessCount > 0) continue;

    const signalScore = row.signal_score ?? 0;
    const ageDays = daysBetween(row.created_at, now);

    // Protect anything younger than the minimum age, regardless of how
    // the other two axes score.
    if (ageDays < MIN_AGE_DAYS_FOR_EVICTION) continue;

    const factors = scoreFactors({
      access_count: accessCount,
      signal_score: signalScore,
      age_days: ageDays,
    });
    const score = compositeScore(factors, weights);
    if (score < threshold) continue;

    candidates.push({
      observation_id: row.id,
      project: row.project,
      score,
      factors,
      age_days: Math.round(ageDays * 100) / 100,
      access_count: accessCount,
      signal_score: signalScore,
    });
  }

  // Highest score first so limit drops the least-damaging evictions.
  candidates.sort((a, b) => b.score - a.score);
  return { candidates: candidates.slice(0, limit), scanned, weights };
}

export interface WriteAuditFn {
  (action: string, details: Record<string, unknown>): void;
}

/**
 * Runs the forget policy. Returns the same candidate list in both dry and
 * wet modes; the only difference is whether `archived_at` is set on the
 * candidate rows.
 */
export function runForgetPolicy(
  db: Database,
  options: ForgetPolicyOptions = {},
  writeAudit?: WriteAuditFn
): ForgetPolicyResult {
  const dryRequested = options.dry_run !== false;
  const { candidates, scanned, weights } = collectForgetCandidates(db, options);
  const scoreThreshold =
    typeof options.score_threshold === "number" ? options.score_threshold : 0.7;

  let effectiveDryRun = dryRequested;
  let skippedReason: string | undefined;
  if (!dryRequested && !isAutoForgetEnabled()) {
    // Gracefully degrade wet → dry when the env gate is off.
    effectiveDryRun = true;
    skippedReason = "HARNESS_MEM_AUTO_FORGET=1 not set; downgraded to dry_run";
  }

  let evicted = 0;
  if (!effectiveDryRun && candidates.length > 0) {
    const ts = new Date().toISOString();
    const placeholders = candidates.map(() => "?").join(", ");
    const stmt = db.prepare(
      `UPDATE mem_observations SET archived_at = ?, updated_at = ? WHERE id IN (${placeholders}) AND archived_at IS NULL`
    );
    const result = stmt.run(ts, ts, ...candidates.map((c) => c.observation_id)) as {
      changes?: number;
    };
    evicted = Number(result.changes ?? candidates.length);
  }

  if (writeAudit) {
    writeAudit("admin.forget_policy.run", {
      dry_run: effectiveDryRun,
      requested_dry_run: dryRequested,
      skipped_reason: skippedReason,
      evicted,
      scanned,
      score_threshold: scoreThreshold,
      weights,
      candidate_ids: candidates.map((c) => c.observation_id),
      project: options.project,
    });
  }

  return {
    dry_run: effectiveDryRun,
    evicted,
    candidates,
    skipped_reason: skippedReason,
    score_threshold: scoreThreshold,
    weights,
    scanned,
  };
}
