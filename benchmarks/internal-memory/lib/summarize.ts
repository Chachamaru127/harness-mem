import { getPublishedReference } from "../adapters/import-published";
import { japaneseMixedScore, meanRecallForProfile } from "../scorers/multilingual";
import { mean, percentile } from "../scorers/operational";
import type {
  BenchmarkLayer,
  BenchmarkSummary,
  CompetitorSummary,
  LayerSummary,
  OpenRouterBudgetSummary,
  ScoredCaseResult,
} from "./types";
import type { OpenRouterBudget } from "./openrouter-budget";

function summarizeLayer(layer: BenchmarkLayer, rows: ScoredCaseResult[]): LayerSummary {
  const okRows = rows.filter((row) => row.status === "ok");
  const latencies = okRows.map((row) => row.latency_ms);
  return {
    layer,
    case_count: rows.length,
    ran_count: okRows.length,
    skipped_count: rows.length - okRows.length,
    recall_at_10_mean: mean(okRows.map((row) => row.recall_at_10)),
    mrr_mean: mean(okRows.map((row) => row.mrr)),
    ndcg_at_10_mean: mean(okRows.map((row) => row.ndcg_at_10)),
    latency_p50_ms: percentile(latencies, 50),
    latency_p95_ms: percentile(latencies, 95),
    ja_recall_at_10: meanRecallForProfile(okRows, "ja"),
    mixed_recall_at_10: meanRecallForProfile(okRows, "mixed"),
  };
}

function summarizeOpenRouterBudget(budget: OpenRouterBudget | null): OpenRouterBudgetSummary | undefined {
  if (!budget) return undefined;
  const history = budget.history;
  return {
    cap_usd: budget.cap,
    spent_usd: budget.spent,
    remaining_usd: budget.remaining,
    request_count: history.length,
    enabled: true,
  };
}

export function buildSummary(input: {
  run_id: string;
  git_sha?: string;
  dataset_ids: string[];
  results: ScoredCaseResult[];
  openrouter_budget?: OpenRouterBudget | null;
  env_files_loaded?: string[];
  reproduced_ids?: string[];
}): BenchmarkSummary {
  const competitorIds = [...new Set(input.results.map((row) => row.competitor_id))];
  // A competitor is published (reference-only) unless it was explicitly
  // reproduced (locally measured) this run. When reproduced_ids is not given,
  // fall back to "anything without a published reference frame is reproduced".
  const reproducedSet = input.reproduced_ids ? new Set(input.reproduced_ids) : undefined;
  const isReproduced = (id: string): boolean =>
    reproducedSet ? reproducedSet.has(id) : getPublishedReference(id) === undefined;

  const competitors: CompetitorSummary[] = competitorIds.map((competitorId) => {
    const rows = input.results.filter((row) => row.competitor_id === competitorId);
    const layers = [...new Set(rows.map((row) => row.layer))].map((layer) =>
      summarizeLayer(layer, rows.filter((row) => row.layer === layer)),
    );
    const ran = rows.filter((row) => row.status === "ok").length;
    const reproduced = isReproduced(competitorId);
    const published = reproduced ? undefined : getPublishedReference(competitorId);
    return {
      competitor_id: competitorId,
      measurement: reproduced ? "reproduced" : "published",
      status: ran === 0 ? "skipped" : ran === rows.length ? "completed" : "partial",
      layers,
      japanese_mixed_score: japaneseMixedScore(rows),
      ...(published
        ? {
            published_recall_at_10: published.recall_at_10,
            published_source: published.source,
            published_note: published.note,
          }
        : {}),
    };
  });

  return {
    schema_version: "internal-memory-summary-v1",
    generated_at: new Date().toISOString(),
    run_id: input.run_id,
    git_sha: input.git_sha,
    dataset_ids: input.dataset_ids,
    competitors,
    openrouter_budget: summarizeOpenRouterBudget(input.openrouter_budget ?? null),
    env_files_loaded: input.env_files_loaded,
    claim_safety: [
      "Internal benchmark only. Do not copy scores into README until reproduced on target hardware.",
      "Published competitor values are reference-only and stay in a separate table from reproduced local runs; never merge them into one ranking.",
      "Only harness-mem is reproduced by default. External competitors are published(reference-only) unless live-measured opt-in via --competitors.",
      "harness-mem seeds its own fixtures and retrieves them in-process, so high scores confirm the runner works end-to-end, NOT external competitive superiority.",
      "Scoring includes a content-substring recall fallback (score-case.ts) that can favor self-seeded adapters like harness-mem; treat reproduced harness-mem scores as implementation sanity, not competitive superiority.",
      "Real-data pilot cases (coding-memory-real-ja-mixed-v1.jsonl) are PII-masked and self-seeded; high scores confirm pipeline health on JA/EN mixed logs, NOT external competitive superiority unless competitors are live-measured on the same masked dataset.",
      "LoCoMo full is not the primary gate; see Plans.md section 78 domain mismatch decision.",
    ],
  };
}
