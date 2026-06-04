import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSummary } from "../lib/summarize";
import type { ScoredCaseResult } from "../lib/types";
import { writeReportPack } from "../scripts/render-dashboard";

// Write to an isolated temp dir so the test never overwrites the shared
// reports/latest/ pack with fixture data.
const REPORT = mkdtempSync(join(tmpdir(), "internal-mem-dashboard-pack-"));

afterAll(() => {
  rmSync(REPORT, { recursive: true, force: true });
});

const fixtureResults: ScoredCaseResult[] = [
  {
    case_id: "ja-req-001",
    layer: "ja_coding",
    category: "ja_requirements",
    language_profile: "ja",
    competitor_id: "harness-mem",
    status: "ok",
    recall_at_5: 1,
    recall_at_10: 1,
    mrr: 1,
    ndcg_at_10: 1,
    latency_ms: 20,
    retrieved_ids: ["obs_ja-req-001-m1"],
  },
  {
    case_id: "mix-sym-001",
    layer: "mixed_coding",
    category: "mixed_symbol",
    language_profile: "mixed",
    competitor_id: "harness-mem",
    status: "ok",
    recall_at_5: 0.5,
    recall_at_10: 0.5,
    mrr: 0.5,
    ndcg_at_10: 0.5,
    latency_ms: 25,
    retrieved_ids: ["obs_mix-sym-001-m1"],
    substring_grounding_score: 1,
  },
  {
    case_id: "cr-001",
    layer: "ja_coding",
    category: "conflict_resolution",
    competency: "CR",
    language_profile: "ja",
    competitor_id: "harness-mem",
    status: "ok",
    recall_at_5: 1,
    recall_at_10: 1,
    mrr: 1,
    ndcg_at_10: 1,
    latency_ms: 22,
    retrieved_ids: ["obs_cr-001-new"],
    substring_grounding_score: 1,
  },
  {
    case_id: "ttl-001",
    layer: "ja_coding",
    category: "test_time_learning",
    competency: "TTL",
    language_profile: "ja",
    competitor_id: "harness-mem",
    status: "ok",
    recall_at_5: 1,
    recall_at_10: 1,
    mrr: 0.5,
    ndcg_at_10: 0.63,
    latency_ms: 18,
    retrieved_ids: ["obs_ttl-001-m2"],
    llm_grounding_score: 0.9,
    llm_judge_model: "google/gemini-2.5-flash-lite",
  },
  {
    case_id: "pub-001",
    layer: "public_compatible",
    category: "english_fact",
    language_profile: "en",
    competitor_id: "agentmemory",
    status: "skipped_missing_credentials",
    recall_at_5: 0,
    recall_at_10: 0,
    mrr: 0,
    ndcg_at_10: 0,
    latency_ms: 0,
    skip_reason: "AGENTMEMORY_BASE_URL is not set",
    retrieved_ids: [],
  },
];

describe("internal-memory dashboard pack", () => {
  test("writes summary, scorecard, dashboard, and reproducibility artifacts", () => {
    const summary = buildSummary({
      run_id: "fixture-run",
      git_sha: "fixture",
      dataset_ids: ["coding-memory-ja-mixed-v1.jsonl"],
      results: fixtureResults,
    });
    writeReportPack(summary, fixtureResults, REPORT);

    expect(existsSync(join(REPORT, "summary.json"))).toBe(true);
    expect(existsSync(join(REPORT, "scorecard.md"))).toBe(true);
    expect(existsSync(join(REPORT, "dashboard.html"))).toBe(true);
    expect(existsSync(join(REPORT, "reproducibility.md"))).toBe(true);

    const scorecard = readFileSync(join(REPORT, "scorecard.md"), "utf8");
    expect(scorecard).toContain("harness-mem");
    expect(scorecard).toContain("Claim safety");
  });

  test("scorecard separates AR/CR substring from TTL/LRU llm grounding", () => {
    const summary = buildSummary({
      run_id: "fixture-run-tiers",
      git_sha: "fixture",
      dataset_ids: ["coding-memory-ja-mixed-v1.jsonl"],
      results: fixtureResults,
    });
    writeReportPack(summary, fixtureResults, REPORT);

    const scorecard = readFileSync(join(REPORT, "scorecard.md"), "utf8");
    expect(scorecard).toContain("Competency tiers");
    expect(scorecard).toContain("Substring grounding");
    expect(scorecard).toContain("LLM grounding");
    // AR/CR rows carry a substring tier; TTL carries an llm_judge tier.
    expect(scorecard).toMatch(/\| CR \| substring \|/);
    expect(scorecard).toMatch(/\| TTL \| llm_judge \|/);
    // Substring-only rows must not invent an LLM grounding number (and vice versa).
    expect(scorecard).toMatch(/\| CR \| substring \| \d+ \| 1\.000 \| — \|/);
    expect(scorecard).toMatch(/\| TTL \| llm_judge \| \d+ \| — \| 0\.900 \|/);
  });
});
