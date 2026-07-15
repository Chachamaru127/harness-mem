/**
 * S154-310: deep freshness 3-metric bench library (report-only, real-system).
 *
 * All three metrics are computed by driving the REAL system:
 *   ① tense-rewrite accuracy — sends each case to real qwen3.5:9b via Ollama
 *   ② supersession precision/recall — directly inserts observations into DB,
 *      runs detectContradictions with adjudicator, reads DB valid_to
 *   ③ freshness lag — same as ②, measures wall-clock detect→valid_to-write latency
 *      (= LLM round-trip + adjudication + DB INSERT 全体の wall time。
 *       INSERT 単体ではなく detectContradictions の全行程を ms で測る — 154-311 で
 *       3-run 安定の前提として LLM 呼び出しの決定論 options を固定する)
 *
 * FIXTURE RULE: fixture files supply ONLY `id`, `older_content`/`newer_content`,
 * `concept_tag`, and ground-truth label fields.
 * Fields like `llm_changed`, `valid_to_written` are FORBIDDEN in fixtures — the
 * bench produces these values from real system outputs.
 *
 * Constraints:
 *   - Does NOT touch flagship-kpi.ts `depth:"shallow"` or green_threshold (D39).
 *   - Ollama unreachability → `status:"skipped"` with `skip_reason`.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Database } from "bun:sqlite";
import type { Config } from "../core/types.js";
import { HarnessMemCore } from "../core/harness-mem-core.js";
import { initSchema as initDbSchema } from "../db/schema.js";
import {
  detectContradictions,
  type ContradictionAdjudicator,
  type AdjudicatorVerdict,
} from "../consolidation/contradiction-detector.js";

// --------------------------------------------------------------------------
// Fixture input types (no system-output fields)
// --------------------------------------------------------------------------

/** Input for ③ freshness lag — one contradicting pair. */
export interface LagContradictionInput {
  id: string;
  older_content: string;
  newer_content: string;
  concept_tag: string;
}

/** Input for ② supersession precision/recall. */
export interface SupersessionInput {
  id: string;
  older_content: string;
  newer_content: string;
  concept_tag: string;
  /** Ground-truth human label: should the older obs be superseded? */
  label_should_supersede: boolean;
}

/** Input for ① tense-rewrite accuracy. */
export interface TenseRewriteInput {
  id: string;
  /** The original planned/future-tense statement. */
  original: string;
  /** Evidence observed after the plan. Empty string = no completion evidence. */
  evidence: string;
  /** Ground-truth: should the LLM rewrite this as completed? */
  expected_changed: boolean;
}

// --------------------------------------------------------------------------
// Result types
// --------------------------------------------------------------------------

export interface FreshnessLagMeasured {
  status: "measured";
  n: number;
  p50_ms: number;
  p95_ms: number;
}

export interface FreshnessLagSkipped {
  status: "skipped";
  skip_reason: string;
  n?: undefined;
  p50_ms?: undefined;
  p95_ms?: undefined;
}

export type FreshnessLagResult = FreshnessLagMeasured | FreshnessLagSkipped;

export interface SupersessionMeasured {
  status: "measured";
  n: number;
  precision: number;
  recall: number;
  f1: number;
}

export interface SupersessionSkipped {
  status: "skipped";
  skip_reason: string;
  n?: undefined;
  precision?: undefined;
  recall?: undefined;
  f1?: undefined;
}

export type SupersessionResult = SupersessionMeasured | SupersessionSkipped;

export interface TenseRewriteMeasured {
  status: "measured";
  n: number;
  accuracy: number;
  false_positive_rate: number;
}

export interface TenseRewriteSkipped {
  status: "skipped";
  skip_reason: string;
  n?: undefined;
  accuracy?: undefined;
  false_positive_rate?: undefined;
}

export type TenseRewriteResult = TenseRewriteMeasured | TenseRewriteSkipped;

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (rank - lo);
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function createMinimalConfig(dbDir: string): Config {
  return {
    dbPath: join(dbDir, "harness-mem.db"),
    bindHost: "127.0.0.1",
    bindPort: 0,
    vectorDimension: 64,
    captureEnabled: true,
    retrievalEnabled: true,
    injectionEnabled: true,
    codexHistoryEnabled: false,
    codexProjectRoot: process.cwd(),
    codexSessionsRoot: process.cwd(),
    codexIngestIntervalMs: 5000,
    codexBackfillHours: 24,
    consolidationEnabled: false,
    backgroundWorkersEnabled: false,
  };
}

/**
 * Directly insert an observation + concept tag into the DB.
 * This bypasses the event-recorder to guarantee tag_type='concept'
 * is set exactly as detectContradictions expects.
 */
function insertObsWithConceptTag(
  db: Database,
  obsId: string,
  project: string,
  content: string,
  conceptTag: string,
  createdAt: string,
): void {
  const session = `bench-sess-${obsId}`;
  // Ensure session row exists
  db.query(
    `INSERT OR IGNORE INTO mem_sessions(session_id, platform, project, started_at, created_at, updated_at)
     VALUES (?, 'bench', ?, ?, ?, ?)`
  ).run(session, project, createdAt, createdAt, createdAt);

  // Insert observation directly with content_redacted = content
  db.query(
    `INSERT OR IGNORE INTO mem_observations(
       id, event_id, platform, project, session_id,
       title, content, content_redacted,
       observation_type, memory_type,
       tags_json, privacy_tags_json,
       user_id, team_id,
       created_at, updated_at
     ) VALUES (?, NULL, 'bench', ?, ?, ?, ?, ?, 'context', 'semantic', '[]', '[]', 'default', NULL, ?, ?)`
  ).run(obsId, project, session, content.slice(0, 80), content, content, createdAt, createdAt);

  // Insert concept tag
  db.query(
    `INSERT OR IGNORE INTO mem_tags(observation_id, tag, tag_type, created_at) VALUES (?, ?, 'concept', ?)`
  ).run(obsId, conceptTag, createdAt);
}

// --------------------------------------------------------------------------
// ③ Freshness lag — wall-clock measurement
// --------------------------------------------------------------------------

/**
 * Measures freshness lag by:
 * 1. Creating HarnessMemCore (for DB schema) in a temp dir
 * 2. Directly inserting each contradiction pair into DB with concept tags
 * 3. Running detectContradictions with a timing wrapper around the adjudicator
 * 4. Computing p50/p95 of wall-clock time from adjudicator-returns to valid_to written
 */
export async function computeFreshnessLagReal(
  inputs: LagContradictionInput[],
  adjudicator: ContradictionAdjudicator,
  configOverride?: Config,
): Promise<FreshnessLagResult> {
  if (inputs.length === 0) {
    return { status: "skipped", skip_reason: "no lag inputs provided" };
  }

  const dbDir = mkdtempSync(join(tmpdir(), "harness-mem-dfb-lag-"));
  const config = configOverride ?? createMinimalConfig(dbDir);
  let core: HarnessMemCore | null = null;

  try {
    core = new HarnessMemCore(config);
    const db = (core as unknown as { db: Database }).db;
    const lagMs: number[] = [];

    for (const input of inputs) {
      const project = `dfb-lag-${input.id}`;
      const t1 = new Date(Date.now() - 2000).toISOString();
      const t2 = new Date(Date.now() - 100).toISOString();

      insertObsWithConceptTag(db, `old-${input.id}`, project, input.older_content, input.concept_tag, t1);
      insertObsWithConceptTag(db, `new-${input.id}`, project, input.newer_content, input.concept_tag, t2);

      const wallStart = performance.now();
      await detectContradictions(db, {
        adjudicator,
        project,
        jaccard_threshold: 0.0, // accept all pairs within the same concept group
      });
      const wallEnd = performance.now();

      // Check if valid_to was written for the older observation
      const row = db.query(
        `SELECT valid_to FROM mem_observations WHERE id = ?`
      ).get(`old-${input.id}`) as { valid_to: string | null } | null;

      if (row?.valid_to) {
        lagMs.push(wallEnd - wallStart);
      }
    }

    if (lagMs.length === 0) {
      return {
        status: "skipped",
        skip_reason: "adjudicator returned no contradictions for any input pair",
      };
    }

    const sorted = [...lagMs].sort((a, b) => a - b);
    return {
      status: "measured",
      n: sorted.length,
      p50_ms: round3(percentile(sorted, 50)),
      p95_ms: round3(percentile(sorted, 95)),
    };
  } finally {
    try { core?.shutdown("dfb-lag"); } catch { /* ignore */ }
    if (!configOverride) {
      try { rmSync(dbDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }
}

// --------------------------------------------------------------------------
// ② Supersession precision/recall — reads DB valid_to
// --------------------------------------------------------------------------

/**
 * Measures supersession precision/recall by:
 * 1. Inserting both positive (should supersede) and negative (should NOT) pairs into DB
 * 2. Running detectContradictions with the provided adjudicator
 * 3. Reading DB valid_to for each older observation (NOT from fixture field)
 * 4. Computing TP/FP/FN from ground-truth labels vs actual DB state
 *
 * Negatives are essential for meaningful precision — without them precision
 * cannot be falsified (no FP cases possible).
 */
export async function computeSupersessionReal(
  inputs: SupersessionInput[],
  adjudicator: ContradictionAdjudicator,
  configOverride?: Config,
  ollamaOpts?: OllamaOptions,
): Promise<SupersessionResult> {
  if (inputs.length === 0) {
    return { status: "skipped", skip_reason: "no supersession inputs provided" };
  }

  // S154-FU02 fail-open contract: when the adjudicator LLM is absent the gate
  // must go yellow (skipped), not "measured 0/0/0" (which reads as red).
  // Callers using a real Ollama adjudicator pass ollamaOpts to enable the
  // probe; fake-adjudicator tests omit it and measure as before.
  if (ollamaOpts) {
    const unreachable = await ollamaUnreachableReason(ollamaOpts);
    if (unreachable) {
      return { status: "skipped", skip_reason: unreachable };
    }
  }

  const dbDir = mkdtempSync(join(tmpdir(), "harness-mem-dfb-sup-"));
  const config = configOverride ?? createMinimalConfig(dbDir);
  let core: HarnessMemCore | null = null;

  try {
    core = new HarnessMemCore(config);
    const db = (core as unknown as { db: Database }).db;

    for (const input of inputs) {
      const project = `dfb-sup-${input.id}`;
      const t1 = new Date(Date.now() - 2000).toISOString();
      const t2 = new Date(Date.now() - 100).toISOString();

      insertObsWithConceptTag(db, `old-${input.id}`, project, input.older_content, input.concept_tag, t1);
      insertObsWithConceptTag(db, `new-${input.id}`, project, input.newer_content, input.concept_tag, t2);
    }

    // Run detectContradictions for all pairs
    for (const input of inputs) {
      const project = `dfb-sup-${input.id}`;
      await detectContradictions(db, {
        adjudicator,
        project,
        jaccard_threshold: 0.0,
      });
    }

    // Compute TP/FP/FN by reading actual DB valid_to (NOT fixture field)
    let tp = 0;
    let fp = 0;
    let fn = 0;

    for (const input of inputs) {
      const row = db.query(
        "SELECT valid_to FROM mem_observations WHERE id = ?"
      ).get(`old-${input.id}`) as { valid_to: string | null } | null;

      const actuallySuperseded = Boolean(row?.valid_to);
      const shouldSupersede = input.label_should_supersede;

      if (shouldSupersede && actuallySuperseded) tp++;
      else if (!shouldSupersede && actuallySuperseded) fp++;
      else if (shouldSupersede && !actuallySuperseded) fn++;
      // TN: !shouldSupersede && !actuallySuperseded → not counted in precision/recall
    }

    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

    return {
      status: "measured",
      n: inputs.length,
      precision: round3(precision),
      recall: round3(recall),
      f1: round3(f1),
    };
  } finally {
    try { core?.shutdown("dfb-sup"); } catch { /* ignore */ }
    if (!configOverride) {
      try { rmSync(dbDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }
}

// --------------------------------------------------------------------------
// ① Tense-rewrite accuracy — real Ollama call
// --------------------------------------------------------------------------

export interface OllamaOptions {
  ollamaHost: string;
  model: string;
  timeoutMs: number;
}

const TENSE_REWRITE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["rewritten", "changed", "false_positive", "reason"],
  properties: {
    rewritten: { type: "string" },
    changed: { type: "boolean" },
    false_positive: { type: "boolean" },
    reason: { type: "string" },
  },
};

async function callOllamaTenseRewrite(
  input: TenseRewriteInput,
  opts: OllamaOptions,
): Promise<{ changed: boolean; false_positive: boolean } | null> {
  const evidenceText = input.evidence.trim()
    ? `Evidence observed after the plan: ${input.evidence}`
    : "Evidence observed after the plan: There is no observation, log, message, or artifact showing completion.";

  const systemPrompt = [
    "Return JSON only. No markdown. No explanation.",
    "You are a conservative temporal rewrite judge.",
    "Never mark a planned item completed unless explicit completion evidence is present.",
  ].join(" ");

  const userPrompt = [
    `Return exactly this JSON shape:`,
    `{"rewritten":"<possibly rewritten>","changed":false,"false_positive":false,"reason":"<short reason>"}`,
    `Task: decide whether to rewrite the planned statement as completed.`,
    `Original planned statement: ${input.original}`,
    evidenceText,
    `Rule: absence of completion evidence means changed=false and false_positive=false.`,
    `Do not infer completion from the date or from the plan itself.`,
  ].join("\n");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);

  try {
    const url = new URL("/api/chat", opts.ollamaHost);
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: opts.model,
        stream: false,
        format: TENSE_REWRITE_SCHEMA,
        think: false,
        // §154-311 Skeptic: temperature/seed/num_predict を固定して LLM 出力を
        // 決定論的にし、3-run 安定 (run 間分散 <0.05) の前提を成立させる。
        // 固定なしでは Ollama default で temperature が 0 ではなく run 毎に
        // ばらつくため「3-run 安定」が嘘になる。
        options: { temperature: 0, seed: 42, num_predict: 256 },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!resp.ok) return null;
    const body = await resp.json() as { message?: { content?: string } };
    const content = body?.message?.content;
    if (!content) return null;
    const parsed = JSON.parse(content) as { changed?: boolean; false_positive?: boolean };
    if (typeof parsed.changed !== "boolean") return null;
    return {
      changed: parsed.changed,
      false_positive: typeof parsed.false_positive === "boolean" ? parsed.false_positive : false,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Measures tense-rewrite accuracy by sending each case to real qwen3.5:9b.
 * Skips if Ollama is unreachable.
 */
/**
 * Probes Ollama /api/tags. Returns a skip reason string when unreachable,
 * or null when the host responds. Shared by the tense-rewrite and
 * supersession benches so both degrade to "skipped" (yellow, fail-open)
 * instead of mis-measuring 0 when the adjudicator LLM is absent.
 */
async function ollamaUnreachableReason(opts: OllamaOptions): Promise<string | null> {
  try {
    const tagUrl = new URL("/api/tags", opts.ollamaHost);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
      const resp = await fetch(tagUrl, { signal: controller.signal });
      if (!resp.ok) {
        return `ollama_unreachable: HTTP ${resp.status}`;
      }
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    return `ollama_unreachable: ${String(err)}`;
  }
  return null;
}

export async function computeTenseRewriteReal(
  inputs: TenseRewriteInput[],
  opts: OllamaOptions,
): Promise<TenseRewriteResult> {
  if (inputs.length === 0) {
    return { status: "skipped", skip_reason: "no tense-rewrite inputs provided" };
  }

  const unreachable = await ollamaUnreachableReason(opts);
  if (unreachable) {
    return { status: "skipped", skip_reason: unreachable };
  }

  const results: Array<{ correct: boolean; is_fp: boolean }> = [];

  for (const input of inputs) {
    const llmOut = await callOllamaTenseRewrite(input, opts);
    if (llmOut === null) continue; // individual failure: skip case, continue

    const correct = llmOut.changed === input.expected_changed;
    results.push({ correct, is_fp: llmOut.false_positive });
  }

  if (results.length === 0) {
    return { status: "skipped", skip_reason: "all tense-rewrite LLM calls failed" };
  }

  const correct = results.filter((r) => r.correct).length;
  const falsePositives = results.filter((r) => r.is_fp).length;

  return {
    status: "measured",
    n: results.length,
    accuracy: round3(correct / results.length),
    false_positive_rate: round3(falsePositives / results.length),
  };
}

// --------------------------------------------------------------------------
// Top-level report builder
// --------------------------------------------------------------------------

export interface DeepFreshnessReport {
  schema_version: "s154-deep-freshness.v1";
  task_id: "S154-310";
  generated_at: string;
  metrics: {
    freshness_lag: FreshnessLagResult;
    supersession: SupersessionResult;
    tense_rewrite: TenseRewriteResult;
  };
  overall_measured_count: number;
}

/**
 * Build an Ollama-based adjudicator for real contradiction detection.
 */
export function buildOllamaAdjudicator(opts: OllamaOptions): ContradictionAdjudicator {
  const CONTRADICTION_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["contradiction", "confidence", "reason"],
    properties: {
      contradiction: { type: "boolean" },
      confidence: { type: "number" },
      reason: { type: "string" },
    },
  };

  return async (a, b): Promise<AdjudicatorVerdict> => {
    const userPrompt = [
      `Return exactly this JSON shape:`,
      `{"contradiction":true,"confidence":0.9,"reason":"short reason"}`,
      `Judge whether these two memory observations contradict each other.`,
      `older: ${a.content}`,
      `newer: ${b.content}`,
    ].join("\n");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    try {
      const url = new URL("/api/chat", opts.ollamaHost);
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: opts.model,
          stream: false,
          format: CONTRADICTION_SCHEMA,
          think: false,
          // §154-311 Skeptic: callOllamaTenseRewrite と同じ理由で temperature/seed/
          // num_predict を固定。adjudicator は detectContradictions 経由で全 input
          // ペアに対して呼ばれ、3-run 安定の前提を担う。
          options: { temperature: 0, seed: 42, num_predict: 256 },
          messages: [
            { role: "system", content: "Return JSON only. No markdown. No explanation." },
            { role: "user", content: userPrompt },
          ],
        }),
      });
      if (!resp.ok) return { contradiction: false, confidence: 0 };
      const body = await resp.json() as { message?: { content?: string } };
      const rawContent = body?.message?.content;
      if (!rawContent) return { contradiction: false, confidence: 0 };
      const parsed = JSON.parse(rawContent) as { contradiction?: boolean; confidence?: number; reason?: string };
      return {
        contradiction: Boolean(parsed.contradiction),
        confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
        reason: typeof parsed.reason === "string" ? parsed.reason : undefined,
      };
    } catch {
      return { contradiction: false, confidence: 0 };
    } finally {
      clearTimeout(timer);
    }
  };
}

export function buildDeepFreshnessReport(
  freshness_lag: FreshnessLagResult,
  supersession: SupersessionResult,
  tense_rewrite: TenseRewriteResult,
): DeepFreshnessReport {
  const measured = [freshness_lag, supersession, tense_rewrite].filter(
    (m) => m.status === "measured"
  ).length;
  return {
    schema_version: "s154-deep-freshness.v1",
    task_id: "S154-310",
    generated_at: new Date().toISOString(),
    metrics: { freshness_lag, supersession, tense_rewrite },
    overall_measured_count: measured,
  };
}
