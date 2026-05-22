import { describe, expect, test } from "bun:test";
import { runRecallRuntimeGate, type RecallRuntimeGateManifest } from "./s128-recall-runtime-gate";

const REQUIRED_METRICS = [
  "recall_p95",
  "ready_latency",
  "fallback_rate",
  "projection_freshness",
  "repeat_recall_cache_hit_rate",
  "cache_invalidation_correctness",
  "adr_precision",
  "otel_redaction",
  "sessionstart_non_displacement",
  "core_search_compatibility",
] as const;

function metricStatus(manifest: RecallRuntimeGateManifest, key: (typeof REQUIRED_METRICS)[number]): string {
  return manifest.metrics[key].status;
}

describe("S128-013 recall runtime gate", () => {
  test("emits warn-mode manifest with the required value signals", async () => {
    const manifest = await runRecallRuntimeGate({
      fixtureSize: 36,
      project: "s128-recall-runtime-gate-test",
      now: () => "2026-05-22T00:00:00.000Z",
    });

    expect(manifest.schema).toBe("harness_mem.recall_runtime_gate.v1");
    expect(manifest.task_id).toBe("S128-013");
    expect(manifest.mode).toBe("warn");
    expect(manifest.generated_at).toBe("2026-05-22T00:00:00.000Z");
    expect(Object.keys(manifest.metrics).sort()).toEqual([...REQUIRED_METRICS].sort());
    expect(manifest.fixture.event_count).toBe(36);

    expect(metricStatus(manifest, "fallback_rate")).toBe("pass");
    expect(metricStatus(manifest, "projection_freshness")).toBe("pass");
    expect(metricStatus(manifest, "repeat_recall_cache_hit_rate")).toBe("pass");
    expect(metricStatus(manifest, "cache_invalidation_correctness")).toBe("pass");
    expect(metricStatus(manifest, "adr_precision")).toBe("pass");
    expect(metricStatus(manifest, "otel_redaction")).toBe("pass");
    expect(metricStatus(manifest, "core_search_compatibility")).toBe("pass");
    expect(manifest.summary.value_signal).toBe("positive");
  });

  test("does not leak raw fixture content or project names into the manifest", async () => {
    const project = "s128-private-project-name";
    const manifest = await runRecallRuntimeGate({ fixtureSize: 24, project });
    const serialized = JSON.stringify(manifest);

    expect(serialized).not.toContain("S128_RAW_SECRET_DO_NOT_EXPORT");
    expect(serialized).not.toContain(project);
    expect(serialized).not.toContain("topic-1 projection gate");
  });
});
