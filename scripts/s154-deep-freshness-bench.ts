#!/usr/bin/env bun
/**
 * S154-310: deep freshness 3-metric bench script (report-only, real-system).
 *
 * Drives the real system for all 3 metrics:
 *   ① tense-rewrite accuracy — real qwen3.5:9b via Ollama
 *   ② supersession precision/recall — real detectContradictions + DB valid_to read
 *   ③ freshness lag — wall-clock detect→valid_to-write latency
 *
 * Fixture files supply input + ground-truth labels ONLY.
 * System outputs (valid_to, llm decisions) come from real execution.
 *
 * Usage:
 *   bun run scripts/s154-deep-freshness-bench.ts [--artifact-dir <dir>] [--fixture-dir <dir>]
 *   bun run scripts/s154-deep-freshness-bench.ts --no-write  # dry run
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  computeFreshnessLagReal,
  computeSupersessionReal,
  computeTenseRewriteReal,
  buildOllamaAdjudicator,
  buildDeepFreshnessReport,
  type LagContradictionInput,
  type SupersessionInput,
  type TenseRewriteInput,
} from "../memory-server/src/benchmark/deep-freshness-bench.js";
import {
  buildDeepFreshnessSubBlock,
  type DeepFreshnessSubBlock,
} from "../memory-server/src/benchmark/flagship-kpi.js";

const ROOT_DIR = resolve(import.meta.dir, "..");
const DEFAULT_FIXTURE_DIR = join(ROOT_DIR, "tests/benchmarks/fixtures");
const DEFAULT_ARTIFACT_DIR = join(ROOT_DIR, "docs/benchmarks/artifacts/s154-deep-freshness");

const OLLAMA_HOST = process.env["HARNESS_MEM_OLLAMA_HOST"] ?? "http://127.0.0.1:11434";
const OLLAMA_MODEL = process.env["HARNESS_MEM_FACT_LLM_MODEL"] ?? "qwen3.5:9b";
const OLLAMA_TIMEOUT_MS = 30_000;

// --------------------------------------------------------------------------
// CLI parsing
// --------------------------------------------------------------------------

interface ScriptOptions {
  fixtureDir: string;
  artifactDir: string;
  writeArtifacts: boolean;
  verbose: boolean;
}

function parseArgs(argv: string[]): ScriptOptions {
  const opts: ScriptOptions = {
    fixtureDir: DEFAULT_FIXTURE_DIR,
    artifactDir: DEFAULT_ARTIFACT_DIR,
    writeArtifacts: true,
    verbose: false,
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--fixture-dir" && argv[i + 1]) opts.fixtureDir = resolve(argv[++i]!);
    else if (argv[i] === "--artifact-dir" && argv[i + 1]) opts.artifactDir = resolve(argv[++i]!);
    else if (argv[i] === "--no-write") opts.writeArtifacts = false;
    else if (argv[i] === "--verbose") opts.verbose = true;
  }
  return opts;
}

function loadFixture<T>(path: string): T[] {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T[];
  } catch {
    return [];
  }
}

// --------------------------------------------------------------------------
// Markdown renderer
// --------------------------------------------------------------------------

function statusEmoji(s: string): string {
  return s === "measured" ? "✅" : "⏭️";
}

function renderReport(block: DeepFreshnessSubBlock): string {
  const { tense_rewrite, supersession, freshness_lag } = block;
  const lines: string[] = [
    "# S154-310 Deep Freshness Bench",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Metrics",
    "",
    "| Metric | Status | Value |",
    "|--------|--------|-------|",
  ];

  if (tense_rewrite.status === "measured") {
    lines.push(`| ① Tense-Rewrite Accuracy | ${statusEmoji("measured")} measured (n=${tense_rewrite.n}) | accuracy=${tense_rewrite.accuracy} fp_rate=${tense_rewrite.false_positive_rate} |`);
  } else {
    lines.push(`| ① Tense-Rewrite Accuracy | ${statusEmoji("skipped")} skipped | ${tense_rewrite.skip_reason} |`);
  }

  if (supersession.status === "measured") {
    lines.push(`| ② Supersession P/R | ${statusEmoji("measured")} measured (n=${supersession.n}) | precision=${supersession.precision} recall=${supersession.recall} f1=${supersession.f1} |`);
  } else {
    lines.push(`| ② Supersession P/R | ${statusEmoji("skipped")} skipped | ${supersession.skip_reason} |`);
  }

  if (freshness_lag.status === "measured") {
    lines.push(`| ③ Freshness Lag | ${statusEmoji("measured")} measured (n=${freshness_lag.n}) | p50=${freshness_lag.p50_ms}ms p95=${freshness_lag.p95_ms}ms |`);
  } else {
    lines.push(`| ③ Freshness Lag | ${statusEmoji("skipped")} skipped | ${freshness_lag.skip_reason} |`);
  }

  lines.push("", "## Notes", "", "- All metrics computed from real system execution.", "- No fixture-value theater: `llm_changed`, `valid_to_written`, timestamps come from live runs.");
  return lines.join("\n");
}

// --------------------------------------------------------------------------
// Main
// --------------------------------------------------------------------------

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.verbose) {
    console.log(`[deep-freshness-bench] fixture_dir=${opts.fixtureDir}`);
    console.log(`[deep-freshness-bench] artifact_dir=${opts.artifactDir}`);
    console.log(`[deep-freshness-bench] ollama=${OLLAMA_HOST} model=${OLLAMA_MODEL}`);
  }

  const lagInputs = loadFixture<LagContradictionInput>(join(opts.fixtureDir, "deep-freshness-lag.json"));
  const supInputs = loadFixture<SupersessionInput>(join(opts.fixtureDir, "deep-freshness-supersession.json"));
  const trInputs = loadFixture<TenseRewriteInput>(join(opts.fixtureDir, "deep-freshness-tense-rewrite.json"));

  if (opts.verbose) {
    console.log(`[deep-freshness-bench] loaded lag=${lagInputs.length} sup=${supInputs.length} tr=${trInputs.length}`);
  }

  const ollamaOpts = { ollamaHost: OLLAMA_HOST, model: OLLAMA_MODEL, timeoutMs: OLLAMA_TIMEOUT_MS };
  const ollamaAdjudicator = buildOllamaAdjudicator(ollamaOpts);

  console.log("[deep-freshness-bench] ③ measuring freshness lag...");
  const freshness_lag = await computeFreshnessLagReal(lagInputs, ollamaAdjudicator);
  console.log(`[deep-freshness-bench]   lag: ${freshness_lag.status}${freshness_lag.status === "measured" ? ` p50=${freshness_lag.p50_ms}ms p95=${freshness_lag.p95_ms}ms n=${freshness_lag.n}` : ` (${freshness_lag.skip_reason})`}`);

  console.log("[deep-freshness-bench] ② measuring supersession...");
  const supersession = await computeSupersessionReal(supInputs, ollamaAdjudicator, undefined, ollamaOpts);
  console.log(`[deep-freshness-bench]   supersession: ${supersession.status}${supersession.status === "measured" ? ` precision=${supersession.precision} recall=${supersession.recall} f1=${supersession.f1} n=${supersession.n}` : ` (${supersession.skip_reason})`}`);

  console.log("[deep-freshness-bench] ① measuring tense-rewrite...");
  const tense_rewrite = await computeTenseRewriteReal(trInputs, ollamaOpts);
  console.log(`[deep-freshness-bench]   tense_rewrite: ${tense_rewrite.status}${tense_rewrite.status === "measured" ? ` accuracy=${tense_rewrite.accuracy} fp_rate=${tense_rewrite.false_positive_rate} n=${tense_rewrite.n}` : ` (${tense_rewrite.skip_reason})`}`);

  const subBlock = buildDeepFreshnessSubBlock({ tense_rewrite, supersession, freshness_lag });
  const report = buildDeepFreshnessReport(freshness_lag, supersession, tense_rewrite);

  console.log(`\n[deep-freshness-bench] overall_measured_count=${report.overall_measured_count}/3`);

  if (opts.writeArtifacts) {
    mkdirSync(opts.artifactDir, { recursive: true });
    const jsonPath = join(opts.artifactDir, "report.json");
    const mdPath = join(opts.artifactDir, "report.md");
    writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    writeFileSync(mdPath, `${renderReport(subBlock)}\n`, "utf8");
    console.log(`[deep-freshness-bench] artifacts written: ${jsonPath}`);
  }

  // Exit 0 even with skipped metrics (skip is not a failure)
  process.exit(0);
}

main().catch((err) => {
  console.error("[deep-freshness-bench] fatal:", err);
  process.exit(1);
});
