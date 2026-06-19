#!/usr/bin/env bun
/**
 * S154-710: 順序感応 rerank gate (stage 分離).
 *
 * retrieval 段 (recall@10) と rerank 段 (top1 / MRR@10 の ON/OFF delta) を分離
 * して固定 schema artifact に記録する gate script。D41 Review Condition 準拠で
 * NDCG@10 は不採用 (CJK_GATE_METRICS の "recall" / "top1" / "mrr" 流用)。
 *
 * 設計 (TeamAgent Architecture 助言反映):
 *   - 単一 entry / artifact schema: "s154-rerank-order-gate.v1"
 *   - `retrieval_stage` (recall@10 per-slice) と `rerank_stage` (top1/MRR delta
 *     per-slice, ON vs OFF) を分離フィールド = recall@10 を rerank 採否判定に
 *     使わないことを schema レベルで可視化
 *   - precondition check: rerank なしの top1=false 件数 ≥20 を script 起動時に
 *     fixture loader 直後で機械検証 (未達なら exit 1、測定開始しない)
 *   - provider identity assert + fallback fail-closed:
 *     LLM rerank variant で HARNESS_MEM_LLM_RERANK 未セット → exit 1
 *     (cross-encoder の silent simple-v1 fallback は onnx-cross-encoder の
 *      新 `isReady()` getter で別途検出。本 script では LLM rerank baseline
 *      のみ実装、cross-encoder は 154-711 で接続)
 *   - safe_mode 離脱混入なしの negative control:
 *     baseline と candidate で同一 fixture + 同一 retrieval (recall@10 不変)
 *     を確認 (top1/MRR は rerank で並べ替えられて変わる)
 *
 * Usage:
 *   bun run scripts/s154-rerank-order-gate.ts [--artifact-dir <dir>] [--no-write]
 *
 * Exit codes:
 *   0: gate passed (precondition met, fail-closed checks passed)
 *   1: exit 1 conditions:
 *      - fixture v2 で rank2 以下 (top1=false) 件数 < 20
 *      - HARNESS_MEM_LLM_RERANK 未セット (provider identity assert 失敗)
 *      - retrieval_stage が rerank_stage と意図せず連動 (schema assertion 違反)
 *      - Ollama 接続失敗 (sample 後でなくここで先行 check)
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  createEmbeddingProviderRegistry,
  type EmbeddingProvider,
} from "../memory-server/src/embedding/registry.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROOT_DIR = resolve(import.meta.dir, "..");
const DEFAULT_ARTIFACT_DIR = join(ROOT_DIR, "docs/benchmarks/artifacts/s154-rerank-order-gate");
const BILINGUAL_V2_PATH = join(ROOT_DIR, "tests/benchmarks/fixtures/bilingual-v2.json");
// dev-workflow-v2 fixture は本 gate の scope 外 (DoD は bilingual-only)。
// 必要になったら 154-711 で取り込む。

const TOP_K = 10;
const PRECONDITION_MIN_RANK_BELOW_TOP1 = 20;
const OLLAMA_HOST = process.env["HARNESS_MEM_OLLAMA_HOST"] ?? "http://127.0.0.1:11434";
const OLLAMA_MODEL = process.env["HARNESS_MEM_FACT_LLM_MODEL"] ?? "qwen3.5:9b";
const OLLAMA_TIMEOUT_MS = 15_000;
const BASELINE_EMBEDDING_MODEL = "multilingual-e5-small";

// D41 規律: metric は CJK_GATE_METRICS の "recall" / "top1" / "mrr" のみ流用 (新規禁止)
export const RERANK_GATE_METRICS = ["recall_at_10", "top1", "mrr_at_10"] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BilingualSample {
  id: string;
  cluster: string;
  pattern: string;
  content: string;
  query: string;
  relevant_ids: string[];
}

interface BilingualFixture {
  schema_version: string;
  samples: BilingualSample[];
  distractors: Array<{ id: string; content: string }>;
}

interface QueryScore {
  recall_at_10: number;
  top1: number;
  rr_at_10: number;
}

interface SliceMetrics {
  recall_at_10: number;
  top1: number;
  mrr_at_10: number;
  n: number;
}

interface RetrievalStage {
  baseline_path: "embedding-only";
  embedding_model: string;
  per_slice: Record<string, SliceMetrics>;
}

interface RerankStage {
  baseline_path: "embedding-only";
  candidate_path: "ollama-llm-rerank";
  provider_identity: { provider: string; model: string; host: string };
  per_slice: Record<string, { top1_delta: number; mrr_at_10_delta: number; n: number }>;
}

interface PreconditionCheck {
  rank_below_top1_count: number;
  required_min: number;
  passed: boolean;
}

interface OrderGateReport {
  schema_version: "s154-rerank-order-gate.v1";
  task_id: "S154-710";
  generated_at: string;
  fixtures: Array<{ name: string; schema_version: string; samples_count: number }>;
  retrieval_stage: RetrievalStage;
  rerank_stage: RerankStage | { status: "skipped"; skip_reason: string };
  precondition: PreconditionCheck;
  exit_code: 0 | 1;
  exit_reason?: string;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}

function rankByScore<T extends { score: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => b.score - a.score);
}

function scoreFromRanking(
  ranked: Array<{ id: string }>,
  relevantIds: string[],
): QueryScore {
  if (relevantIds.length === 0) return { recall_at_10: 1, top1: 1, rr_at_10: 1 };
  const top10 = ranked.slice(0, TOP_K).map((r) => r.id);
  const relSet = new Set(relevantIds);
  const hits = top10.filter((id) => relSet.has(id)).length;
  let firstRank = 0;
  for (let i = 0; i < ranked.length; i += 1) {
    if (relSet.has(ranked[i].id)) {
      firstRank = i + 1;
      break;
    }
  }
  return {
    recall_at_10: hits / relevantIds.length,
    top1: firstRank === 1 ? 1 : 0,
    rr_at_10: firstRank > 0 && firstRank <= TOP_K ? 1 / firstRank : 0,
  };
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((s, v) => s + v, 0) / values.length;
}

function buildSliceMetrics(scores: QueryScore[]): SliceMetrics {
  return {
    recall_at_10: mean(scores.map((s) => s.recall_at_10)),
    top1: mean(scores.map((s) => s.top1)),
    mrr_at_10: mean(scores.map((s) => s.rr_at_10)),
    n: scores.length,
  };
}

// ---------------------------------------------------------------------------
// Embedding provider (baseline retrieval)
// ---------------------------------------------------------------------------

function resolveEmbeddingProvider(): EmbeddingProvider {
  const registry = createEmbeddingProviderRegistry({
    provider: "local",
    model: BASELINE_EMBEDDING_MODEL,
  });
  return registry.provider;
}

async function embedTexts(provider: EmbeddingProvider, texts: string[], mode: "passage" | "query"): Promise<number[][]> {
  const primeBatch = (provider as unknown as {
    primeBatch?: (texts: string[], mode: "passage" | "query") => Promise<number[][]>;
  }).primeBatch;
  if (typeof primeBatch !== "function") {
    throw new Error(`[s154-710] provider ${provider.model} does not expose primeBatch (D40 規律違反)`);
  }
  return await primeBatch.call(provider, texts, mode);
}

// ---------------------------------------------------------------------------
// LLM rerank candidate path
// ---------------------------------------------------------------------------

interface LlmRerankResponse {
  ranking: string[]; // ordered ids, most relevant first
}

/**
 * §154-710 Codex review fix: fail-closed (silent fallback 禁止)。
 * LLM call が失敗 (HTTP / parse / empty / abort) すると caller は exit 1。
 * silent に baseline 順序を返して exit 0 を blessing するのは Skeptic [3] と
 * D40 規律 (測定時の fallback 混入禁止) に反する。
 */
async function llmRerankTop10(query: string, top10: Array<{ id: string; content: string }>): Promise<string[]> {
  const itemsText = top10.map((it, i) => `[${i + 1}] id=${it.id}: ${it.content.slice(0, 280)}`).join("\n");
  const systemPrompt = "Return JSON only. No markdown. No explanation.";
  const userPrompt = [
    `Rank these 10 passages by relevance to the query. Return JSON {"ranking":["<id1>", "<id2>", ...]}.`,
    `Query: ${query}`,
    `Passages:`,
    itemsText,
  ].join("\n");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);
  try {
    const resp = await fetch(new URL("/api/chat", OLLAMA_HOST), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,
        think: false,
        // §154-710: 決定論 options (Skeptic 指摘 — 3-run 安定の前提)
        options: { temperature: 0, seed: 42, num_predict: 256 },
        format: {
          type: "object",
          required: ["ranking"],
          properties: { ranking: { type: "array", items: { type: "string" } } },
        },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });
    if (!resp.ok) throw new Error(`llm_rerank_http_${resp.status}`);
    const body = await resp.json() as { message?: { content?: string } };
    const raw = body?.message?.content;
    if (!raw) throw new Error("llm_rerank_empty_response");
    const parsed = JSON.parse(raw) as LlmRerankResponse;
    if (!Array.isArray(parsed.ranking)) throw new Error("llm_rerank_malformed_ranking");
    // §154-710 Codex re-review fix: partial/empty ranking は silent baseline 化を
    // 防ぐため補完前に reject する。LLM が完全 10 件をカバーしない応答は
    // 「rerank 不完全」= measurement 汚染と扱い、tail 補完で隠蔽しない。
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const id of parsed.ranking) {
      if (typeof id === "string" && top10.some((t) => t.id === id) && !seen.has(id)) {
        ordered.push(id); seen.add(id);
      }
    }
    if (ordered.length !== top10.length) {
      throw new Error(
        `llm_rerank_partial_coverage (returned ${ordered.length}/${top10.length} valid ids — fail-closed: refuses silent tail completion to preserve baseline order)`,
      );
    }
    return ordered;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * §154-710 Codex fix: HARNESS_MEM_LLM_RERANK の presence-only から enabled パースへ。
 * production の llm-reranker.ts:42 と同じセマンティクスを使用 (drift 防止)。
 */
function parseEnabled(raw: string | undefined): boolean {
  if (!raw) return false;
  const v = raw.trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(v);
}

async function ollamaReachable(): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3_000);
    const resp = await fetch(new URL("/api/tags", OLLAMA_HOST), { signal: ctrl.signal });
    clearTimeout(timer);
    return resp.ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Slice partitioning
// ---------------------------------------------------------------------------

function partitionBilingualBySlice(samples: BilingualSample[]): Record<string, BilingualSample[]> {
  const mixed = samples.filter((s) => s.pattern === "ja-content_en-query" || s.pattern === "en-content_ja-query");
  const ja = samples.filter((s) => s.pattern === "ja-content_ja-query");
  const bilingual = samples;
  return { mixed, ja, bilingual };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const noWrite = argv.includes("--no-write");
  const artifactDir = (() => {
    const i = argv.indexOf("--artifact-dir");
    return i !== -1 && argv[i + 1] ? resolve(argv[i + 1]) : DEFAULT_ARTIFACT_DIR;
  })();

  // 1. Load fixtures (bilingual-v2 のみ — dev-workflow は本 gate scope 外)
  const bilingual = JSON.parse(readFileSync(BILINGUAL_V2_PATH, "utf8")) as BilingualFixture;
  process.stderr.write(`[rerank-order-gate] fixtures loaded: bilingual=${bilingual.samples.length}\n`);

  // 2. Provider identity assert (LLM rerank candidate path)
  // §154-710 Codex fix: presence-only ではなく enabled パース (production parity)
  if (!parseEnabled(process.env["HARNESS_MEM_LLM_RERANK"])) {
    const report: OrderGateReport = {
      schema_version: "s154-rerank-order-gate.v1",
      task_id: "S154-710",
      generated_at: new Date().toISOString(),
      fixtures: [{ name: bilingual.schema_version ?? "bilingual-v2", schema_version: bilingual.schema_version ?? "?", samples_count: bilingual.samples.length }],
      retrieval_stage: { baseline_path: "embedding-only", embedding_model: BASELINE_EMBEDDING_MODEL, per_slice: {} },
      rerank_stage: { status: "skipped", skip_reason: "HARNESS_MEM_LLM_RERANK not enabled (parseEnabled: 1/true/yes/on のいずれかが必要)" },
      precondition: { rank_below_top1_count: 0, required_min: PRECONDITION_MIN_RANK_BELOW_TOP1, passed: false },
      exit_code: 1,
      exit_reason: "HARNESS_MEM_LLM_RERANK not enabled (set 1/true/yes/on) — provider identity assert failed",
    };
    if (!noWrite) writeArtifact(artifactDir, report);
    process.stderr.write(`[rerank-order-gate] exit 1: ${report.exit_reason}\n`);
    process.exit(1);
  }

  // 3. Ollama reachability
  if (!(await ollamaReachable())) {
    process.stderr.write(`[rerank-order-gate] exit 1: Ollama unreachable at ${OLLAMA_HOST}\n`);
    process.exit(1);
  }

  // 4. Baseline retrieval (embedding + cosine)
  const provider = resolveEmbeddingProvider();
  await embedTexts(provider, ["__warmup__"], "query");

  const poolItems = [
    ...bilingual.samples.map((s) => ({ id: s.id, content: s.content })),
    ...bilingual.distractors.map((d) => ({ id: d.id, content: d.content })),
  ];
  process.stderr.write(`[rerank-order-gate] embedding pool=${poolItems.length}...\n`);
  const poolVectors = await embedTexts(provider, poolItems.map((p) => p.content), "passage");
  const pool = poolItems.map((p, i) => ({ id: p.id, vector: poolVectors[i] }));

  process.stderr.write(`[rerank-order-gate] embedding queries=${bilingual.samples.length}...\n`);
  const queryVectors = await embedTexts(provider, bilingual.samples.map((s) => s.query), "query");

  // 5. Baseline (rerank OFF) per-sample retrieval + slice metrics
  const baselineRanked: Array<{ sampleId: string; ranked: Array<{ id: string; score: number }>; top10: Array<{ id: string; content: string }>; baseline_score: QueryScore }> = [];
  for (let i = 0; i < bilingual.samples.length; i += 1) {
    const sample = bilingual.samples[i];
    const qvec = queryVectors[i];
    const scored = pool.map((p) => ({ id: p.id, score: cosine(qvec, p.vector) }));
    const ranked = rankByScore(scored);
    const top10 = ranked.slice(0, TOP_K).map((r) => {
      const item = poolItems.find((it) => it.id === r.id)!;
      return { id: item.id, content: item.content };
    });
    const baseline_score = scoreFromRanking(ranked, sample.relevant_ids);
    baselineRanked.push({ sampleId: sample.id, ranked, top10, baseline_score });
  }

  // 6. Precondition check: rank2 以下に正解が落ちる query 数 (top1=0) ≥ 20
  const rankBelowTop1 = baselineRanked.filter((r) => r.baseline_score.top1 === 0).length;
  const preconditionPassed = rankBelowTop1 >= PRECONDITION_MIN_RANK_BELOW_TOP1;
  process.stderr.write(`[rerank-order-gate] precondition: rank_below_top1=${rankBelowTop1} (required ≥${PRECONDITION_MIN_RANK_BELOW_TOP1}) ${preconditionPassed ? "PASS" : "FAIL"}\n`);

  if (!preconditionPassed) {
    const baselineSlices = computeBaselineSlices(bilingual.samples, baselineRanked);
    const report: OrderGateReport = {
      schema_version: "s154-rerank-order-gate.v1",
      task_id: "S154-710",
      generated_at: new Date().toISOString(),
      fixtures: [{ name: "bilingual-v2", schema_version: bilingual.schema_version, samples_count: bilingual.samples.length }],
      retrieval_stage: { baseline_path: "embedding-only", embedding_model: BASELINE_EMBEDDING_MODEL, per_slice: baselineSlices },
      rerank_stage: { status: "skipped", skip_reason: `precondition failed: rank_below_top1=${rankBelowTop1} < ${PRECONDITION_MIN_RANK_BELOW_TOP1}` },
      precondition: { rank_below_top1_count: rankBelowTop1, required_min: PRECONDITION_MIN_RANK_BELOW_TOP1, passed: false },
      exit_code: 1,
      exit_reason: "fixture v2 で rank2 以下に落ちる query が ≥20 未達 (易問 fixture では rerank の判別力ゼロ)",
    };
    if (!noWrite) writeArtifact(artifactDir, report);
    process.exit(1);
  }

  // 7. Candidate (LLM rerank ON): top-10 を qwen3.5:9b で並べ替え、metrics 再計算
  process.stderr.write(`[rerank-order-gate] LLM rerank on top-10 for ${bilingual.samples.length} queries...\n`);
  const candidateScores: QueryScore[] = [];
  for (let i = 0; i < bilingual.samples.length; i += 1) {
    const sample = bilingual.samples[i];
    const entry = baselineRanked[i];
    let rerankedIds: string[];
    try {
      rerankedIds = await llmRerankTop10(sample.query, entry.top10);
    } catch (err) {
      // §154-710 Codex fix: silent fallback 禁止。LLM call 失敗 = exit 1 で
      // measurement の汚染を防ぐ (D40 規律: silent fallback は帰属汚染源)。
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[rerank-order-gate] exit 1: LLM rerank failed at sample=${sample.id} (${msg}) — fail-closed (no silent baseline fallback)\n`);
      process.exit(1);
    }
    // Build a ranked list with rerank order then the rest (rank > 10 unchanged)
    const top10Set = new Set(rerankedIds);
    const tail = entry.ranked.slice(TOP_K).filter((r) => !top10Set.has(r.id));
    const combinedRanked = [...rerankedIds.map((id) => ({ id })), ...tail];
    candidateScores.push(scoreFromRanking(combinedRanked, sample.relevant_ids));
  }

  // 8. Build per-slice metrics
  const sliceMap = partitionBilingualBySlice(bilingual.samples);
  const baselineSlices: Record<string, SliceMetrics> = {};
  const candidateSlices: Record<string, SliceMetrics> = {};
  const deltaSlices: Record<string, { top1_delta: number; mrr_at_10_delta: number; n: number }> = {};
  for (const [slice, samples] of Object.entries(sliceMap)) {
    const idxs = samples.map((s) => bilingual.samples.findIndex((x) => x.id === s.id));
    const baseSlice = idxs.map((i) => baselineRanked[i].baseline_score);
    const candSlice = idxs.map((i) => candidateScores[i]);
    baselineSlices[slice] = buildSliceMetrics(baseSlice);
    candidateSlices[slice] = buildSliceMetrics(candSlice);
    deltaSlices[slice] = {
      top1_delta: candidateSlices[slice].top1 - baselineSlices[slice].top1,
      mrr_at_10_delta: candidateSlices[slice].mrr_at_10 - baselineSlices[slice].mrr_at_10,
      n: baseSlice.length,
    };
  }

  // 9. Schema assertion: retrieval_stage と rerank_stage の recall@10 不変を確認
  //    (rerank は top-10 内 並び替えのみ → recall@10 は数学的に不変)
  for (const slice of Object.keys(sliceMap)) {
    const baselineRecall = baselineSlices[slice].recall_at_10;
    const candRecall = candidateSlices[slice].recall_at_10;
    if (Math.abs(baselineRecall - candRecall) > 1e-9) {
      process.stderr.write(`[rerank-order-gate] exit 1: schema assertion 違反 — slice=${slice} recall@10 が rerank で変化 (baseline=${baselineRecall} candidate=${candRecall})\n`);
      process.exit(1);
    }
  }

  // 10. Build report
  const report: OrderGateReport = {
    schema_version: "s154-rerank-order-gate.v1",
    task_id: "S154-710",
    generated_at: new Date().toISOString(),
    fixtures: [{ name: "bilingual-v2", schema_version: bilingual.schema_version, samples_count: bilingual.samples.length }],
    retrieval_stage: { baseline_path: "embedding-only", embedding_model: BASELINE_EMBEDDING_MODEL, per_slice: baselineSlices },
    rerank_stage: {
      baseline_path: "embedding-only",
      candidate_path: "ollama-llm-rerank",
      provider_identity: { provider: "ollama", model: OLLAMA_MODEL, host: OLLAMA_HOST },
      per_slice: deltaSlices,
    },
    precondition: { rank_below_top1_count: rankBelowTop1, required_min: PRECONDITION_MIN_RANK_BELOW_TOP1, passed: true },
    exit_code: 0,
  };

  if (!noWrite) writeArtifact(artifactDir, report);
  process.stderr.write(`[rerank-order-gate] exit 0\n`);
  process.exit(0);
}

function computeBaselineSlices(
  samples: BilingualSample[],
  baselineRanked: Array<{ baseline_score: QueryScore }>,
): Record<string, SliceMetrics> {
  const sliceMap = partitionBilingualBySlice(samples);
  const out: Record<string, SliceMetrics> = {};
  for (const [slice, sliceSamples] of Object.entries(sliceMap)) {
    const idxs = sliceSamples.map((s) => samples.findIndex((x) => x.id === s.id));
    out[slice] = buildSliceMetrics(idxs.map((i) => baselineRanked[i].baseline_score));
  }
  return out;
}

function writeArtifact(dir: string, report: OrderGateReport): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const file = join(dir, "report.json");
  writeFileSync(file, JSON.stringify(report, null, 2) + "\n", "utf8");
  process.stderr.write(`[rerank-order-gate] artifact: ${file}\n`);
}

void main().catch((err) => {
  process.stderr.write(`[rerank-order-gate] fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
