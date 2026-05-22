#!/usr/bin/env bun
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  HarnessMemCore,
  type Config,
  type EventEnvelope,
} from "../memory-server/src/core/harness-mem-core";
import {
  getTelemetryLocalExport,
  initializeTelemetry,
  resetTelemetryForTests,
  shutdownTelemetry,
} from "../memory-server/src/telemetry/otel";

type GateMode = "warn" | "enforce";
type GateStatus = "pass" | "warn";

export interface RecallRuntimeGateThresholds {
  recall_p95_ms: number;
  ready_latency_ms: number;
  fallback_rate: number;
  repeat_recall_cache_hit_rate: number;
  adr_precision: number;
}

export interface RecallRuntimeGateOptions {
  fixtureSize?: number;
  project?: string;
  mode?: GateMode;
  out?: string | null;
  now?: () => string;
}

interface NumericMetric {
  value: number;
  threshold: number;
  comparator: "<=" | ">=";
  status: GateStatus;
}

interface BooleanMetric {
  passed: boolean;
  status: GateStatus;
}

export interface RecallRuntimeGateManifest {
  schema: "harness_mem.recall_runtime_gate.v1";
  task_id: "S128-013";
  generated_at: string;
  mode: GateMode;
  fixture: {
    event_count: number;
    adr_count: number;
    query_count: number;
  };
  thresholds: RecallRuntimeGateThresholds;
  metrics: {
    recall_p95: NumericMetric;
    ready_latency: NumericMetric;
    fallback_rate: NumericMetric;
    projection_freshness: BooleanMetric & {
      projected_recall_ok: boolean;
      stale_fallback_detected: boolean;
    };
    repeat_recall_cache_hit_rate: NumericMetric;
    cache_invalidation_correctness: BooleanMetric;
    adr_precision: NumericMetric & {
      hits: number;
      total: number;
    };
    otel_redaction: BooleanMetric;
    sessionstart_non_displacement: BooleanMetric & {
      ready_latency_ms: number;
    };
    core_search_compatibility: BooleanMetric;
  };
  summary: {
    status: GateStatus;
    warnings: string[];
    value_signal: "positive" | "needs_followup";
  };
}

const DEFAULT_THRESHOLDS: RecallRuntimeGateThresholds = {
  recall_p95_ms: 250,
  ready_latency_ms: 75,
  fallback_rate: 0,
  repeat_recall_cache_hit_rate: 1,
  adr_precision: 1,
};

const DEFAULT_FIXTURE_SIZE = 180;
const DEFAULT_QUERY_COUNT = 8;
const DEFAULT_PROJECT = "s128-recall-runtime-gate";
const RAW_SENTINEL = "S128_RAW_SECRET_DO_NOT_EXPORT";

function config(dbPath: string): Config {
  return {
    dbPath,
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
    opencodeIngestEnabled: false,
    cursorIngestEnabled: false,
    antigravityIngestEnabled: false,
    backgroundWorkersEnabled: false,
  };
}

function event(project: string, index: number, content: string): EventEnvelope {
  return {
    event_id: `s128-gate-${index}`,
    platform: "codex",
    project,
    session_id: `s128-session-${index % 9}`,
    event_type: "user_prompt",
    ts: new Date(Date.UTC(2026, 4, 22, 0, 0, index % 60)).toISOString(),
    payload: { content },
    tags: ["recall-runtime", `bucket:${index % 7}`],
    privacy_tags: [],
  };
}

function adrContent(): string {
  return [
    "# ADR-128: Recall Runtime Gate",
    "",
    "Date: 2026-05-22",
    "Status: Accepted",
    "Source Plans Section: Plans.md §128 S128-013",
    "",
    "## Status",
    "Accepted",
    "",
    "## Source Plans Section",
    "Plans.md §128 S128-013",
    "",
    "## Evidence",
    "- .claude/memory/decisions.md#D13",
    "",
    "## Options",
    "- SQLite projection",
    "- Local telemetry inspect",
    "",
    "## Decision",
    "Use a warn-mode recall runtime gate before release enforcement.",
    "",
    "## Consequences",
    "- Repeat recall cache value can be measured",
    "- ADR recall precision can be measured",
    "",
    "## Supersedes",
    "- ADR-003",
  ].join("\n");
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Number(sorted[index].toFixed(2));
}

function statusForNumber(
  value: number,
  threshold: number,
  comparator: NumericMetric["comparator"],
): GateStatus {
  return comparator === "<=" ? value <= threshold ? "pass" : "warn" : value >= threshold ? "pass" : "warn";
}

function numericMetric(
  value: number,
  threshold: number,
  comparator: NumericMetric["comparator"],
): NumericMetric {
  return {
    value: Number(value.toFixed(4)),
    threshold,
    comparator,
    status: statusForNumber(value, threshold, comparator),
  };
}

function booleanMetric(passed: boolean): BooleanMetric {
  return { passed, status: passed ? "pass" : "warn" };
}

function collectWarnings(metrics: RecallRuntimeGateManifest["metrics"]): string[] {
  const warnings: string[] = [];
  for (const [name, metric] of Object.entries(metrics)) {
    if (metric.status === "warn") warnings.push(name);
  }
  return warnings;
}

function safeMetaNumber(meta: Record<string, unknown>, key: string): number {
  const value = meta[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function metricStatus(metric: NumericMetric | BooleanMetric): GateStatus {
  return metric.status;
}

export async function runRecallRuntimeGate(
  options: RecallRuntimeGateOptions = {},
): Promise<RecallRuntimeGateManifest> {
  const fixtureSize = Math.max(24, Math.trunc(options.fixtureSize ?? DEFAULT_FIXTURE_SIZE));
  const project = options.project ?? DEFAULT_PROJECT;
  const mode = options.mode ?? "warn";
  const oldTtl = process.env.HARNESS_MEM_RECALL_CACHE_TTL_MS;
  process.env.HARNESS_MEM_RECALL_CACHE_TTL_MS = "60000";
  resetTelemetryForTests();
  initializeTelemetry({
    serviceName: "harness-mem-memory-daemon",
    serviceVersion: "0.24.1",
    component: "memory-daemon",
  });

  const dir = join(tmpdir(), `harness-mem-s128-gate-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  const core = new HarnessMemCore(config(join(dir, "harness-mem.db")));
  try {
    const readyStart = performance.now();
    const readiness = core.readiness();
    const readyLatencyMs = Number((performance.now() - readyStart).toFixed(2));
    const readinessOk = readiness.ok === true;

    for (let i = 0; i < fixtureSize; i += 1) {
      const topic = i % DEFAULT_QUERY_COUNT;
      const content = [
        `Recall runtime topic-${topic} fact-${i}`,
        `projection gate payload bucket-${i % 13}`,
        i === 0 ? RAW_SENTINEL : "safe synthetic fixture",
      ].join(" ");
      const response = core.recordEvent(event(project, i, content));
      if (!response.ok) throw new Error(`failed to seed event ${i}: ${response.error ?? "unknown"}`);
    }

    const adr = core.ingestKnowledgeFile({
      file_path: "docs/adr/ADR-128-recall-runtime-gate.md",
      kind: "adr",
      project,
      content: adrContent(),
    });
    if (!adr.ok) throw new Error(`failed to seed ADR: ${adr.error ?? "unknown"}`);

    const projection = core.refreshRecallProjection({ project, limit: fixtureSize + 16 });
    const projectedRecallOk = projection.ok === true && safeMetaNumber(projection.meta, "writes") > 0;

    const recallLatencies: number[] = [];
    let degradedCount = 0;
    for (let i = 0; i < DEFAULT_QUERY_COUNT; i += 1) {
      const response = await core.recallPrepared({
        query: `topic-${i}`,
        project,
        limit: 5,
        safe_mode: true,
      });
      recallLatencies.push(safeMetaNumber(response.meta, "latency_ms"));
      if (response.meta.recall_degraded === true) degradedCount += 1;
    }

    const cacheFirst = await core.searchPrepared({
      query: "topic-1 projection gate",
      project,
      limit: 5,
      safe_mode: true,
    });
    const cacheSecond = await core.searchPrepared({
      query: "topic-1 projection gate",
      project,
      limit: 5,
      safe_mode: true,
    });
    const adrQueries = ["Accepted", "Local telemetry inspect", "ADR-003"];
    let adrHits = 0;
    for (const query of adrQueries) {
      const response = await core.recallPrepared({ query, project, limit: 3, safe_mode: true });
      const top = response.items[0] as Record<string, unknown> | undefined;
      if (top?.source_type === "adr" && top?.recall_type === "decision") adrHits += 1;
    }
    const adrPrecision = adrHits / adrQueries.length;

    core.recordEvent(event(project, fixtureSize + 1, "Recall runtime cache invalidation fresh item"));
    const cacheAfterChange = await core.searchPrepared({
      query: "topic-1 projection gate",
      project,
      limit: 5,
      safe_mode: true,
    });
    const repeatHitRate = cacheSecond.meta.recall_cache_hit === true ? 1 : 0;
    const cacheInvalidationCorrect =
      cacheFirst.meta.recall_cache_hit === false &&
      cacheSecond.meta.recall_cache_hit === true &&
      cacheAfterChange.meta.recall_cache_hit === false;

    const staleRecall = await core.recallPrepared({
      query: "cache invalidation fresh item",
      project,
      limit: 5,
      safe_mode: true,
    });
    const staleFallbackDetected =
      staleRecall.meta.recall_degraded === true &&
      staleRecall.meta.recall_degraded_reason === "projection_stale";

    const coreSearch = await core.searchPrepared({
      query: "topic-2 projection gate",
      project,
      limit: 5,
      safe_mode: true,
    });
    const coreSearchCompatibility = coreSearch.ok === true && coreSearch.items.length > 0;

    const telemetry = getTelemetryLocalExport({ limit: 128 });
    const telemetryJson = JSON.stringify(telemetry);
    const otelRedaction =
      !telemetryJson.includes(RAW_SENTINEL) &&
      !telemetryJson.includes(project) &&
      !telemetryJson.includes("topic-1 projection gate") &&
      telemetry.summary.span_counts["recall.search"] >= 1;

    const fallbackRate = degradedCount / DEFAULT_QUERY_COUNT;
    const thresholds = DEFAULT_THRESHOLDS;
    const metrics: RecallRuntimeGateManifest["metrics"] = {
      recall_p95: numericMetric(percentile(recallLatencies, 95), thresholds.recall_p95_ms, "<="),
      ready_latency: numericMetric(readyLatencyMs, thresholds.ready_latency_ms, "<="),
      fallback_rate: numericMetric(fallbackRate, thresholds.fallback_rate, "<="),
      projection_freshness: {
        ...booleanMetric(projectedRecallOk && staleFallbackDetected),
        projected_recall_ok: projectedRecallOk,
        stale_fallback_detected: staleFallbackDetected,
      },
      repeat_recall_cache_hit_rate: numericMetric(
        repeatHitRate,
        thresholds.repeat_recall_cache_hit_rate,
        ">=",
      ),
      cache_invalidation_correctness: booleanMetric(cacheInvalidationCorrect),
      adr_precision: {
        ...numericMetric(adrPrecision, thresholds.adr_precision, ">="),
        hits: adrHits,
        total: adrQueries.length,
      },
      otel_redaction: booleanMetric(otelRedaction),
      sessionstart_non_displacement: {
        ...booleanMetric(readinessOk && readyLatencyMs <= thresholds.ready_latency_ms),
        ready_latency_ms: readyLatencyMs,
      },
      core_search_compatibility: booleanMetric(coreSearchCompatibility),
    };
    const warnings = collectWarnings(metrics);
    return {
      schema: "harness_mem.recall_runtime_gate.v1",
      task_id: "S128-013",
      generated_at: options.now?.() ?? new Date().toISOString(),
      mode,
      fixture: {
        event_count: fixtureSize,
        adr_count: 1,
        query_count: DEFAULT_QUERY_COUNT,
      },
      thresholds,
      metrics,
      summary: {
        status: warnings.length === 0 ? "pass" : "warn",
        warnings,
        value_signal: warnings.length === 0 ||
          ["fallback_rate", "projection_freshness", "repeat_recall_cache_hit_rate", "adr_precision"].every((key) =>
            metricStatus(metrics[key as keyof typeof metrics]) === "pass"
          )
          ? "positive"
          : "needs_followup",
      },
    };
  } finally {
    core.shutdown("s128-gate");
    await shutdownTelemetry("s128-gate");
    resetTelemetryForTests();
    rmSync(dir, { recursive: true, force: true });
    if (oldTtl === undefined) {
      delete process.env.HARNESS_MEM_RECALL_CACHE_TTL_MS;
    } else {
      process.env.HARNESS_MEM_RECALL_CACHE_TTL_MS = oldTtl;
    }
  }
}

function parseArgs(argv: string[]): RecallRuntimeGateOptions & { json: boolean } {
  const options: RecallRuntimeGateOptions & { json: boolean } = { json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--fixture-size":
        options.fixtureSize = Number(argv[++i]);
        break;
      case "--project":
        options.project = argv[++i];
        break;
      case "--out":
        options.out = argv[++i];
        break;
      case "--json":
        options.json = true;
        break;
      case "--enforce":
        options.mode = "enforce";
        break;
      case "--help":
      case "-h":
        console.log("Usage: bun scripts/s128-recall-runtime-gate.ts [--json] [--out <path>] [--fixture-size <n>] [--enforce]");
        process.exit(0);
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const manifest = await runRecallRuntimeGate(options);
  if (options.out) {
    const outPath = resolve(options.out);
    mkdirSync(resolve(outPath, ".."), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  if (options.json) {
    console.log(JSON.stringify(manifest, null, 2));
  } else {
    console.log(`[s128-013] status=${manifest.summary.status} value=${manifest.summary.value_signal} warnings=${manifest.summary.warnings.join(",") || "none"}`);
    if (options.out) console.log(`[s128-013] artifact: ${resolve(options.out)}`);
  }
  if (manifest.mode === "enforce" && manifest.summary.status === "warn") {
    process.exit(1);
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("[s128-013] error:", error instanceof Error ? error.message : String(error));
    process.exit(2);
  });
}
