import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessMemCore, type Config, type EventEnvelope } from "../../src/core/harness-mem-core";
import { initializeTelemetry, resetTelemetryForTests, shutdownTelemetry } from "../../src/telemetry/otel";

const dirs: string[] = [];
const oldTtl = process.env.HARNESS_MEM_RECALL_CACHE_TTL_MS;

function makeCore(label: string): { core: HarnessMemCore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), `harness-mem-recall-telemetry-${label}-`));
  dirs.push(dir);
  const config: Config = {
    dbPath: join(dir, "harness-mem.db"),
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
  return { core: new HarnessMemCore(config), dir };
}

function event(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    event_id: `evt-${Math.random().toString(36).slice(2)}`,
    platform: "codex",
    project: "proj-telemetry",
    session_id: "session-telemetry",
    event_type: "user_prompt",
    ts: new Date().toISOString(),
    payload: { content: "Semantic telemetry alpha private sentinel" },
    tags: ["recall-runtime"],
    privacy_tags: [],
    ...overrides,
  };
}

function collectSpans(payload: unknown): Array<{ name: string; attributes: Array<{ key: string; value: Record<string, unknown> }> }> {
  const resourceSpans = (payload as { resourceSpans?: Array<{ scopeSpans?: Array<{ spans?: unknown[] }> }> }).resourceSpans ?? [];
  return resourceSpans.flatMap((resourceSpan) =>
    (resourceSpan.scopeSpans ?? []).flatMap((scopeSpan) =>
      (scopeSpan.spans ?? []) as Array<{ name: string; attributes: Array<{ key: string; value: Record<string, unknown> }> }>,
    ),
  );
}

function plainAttributes(span: { attributes: Array<{ key: string; value: Record<string, unknown> }> }): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const attr of span.attributes) {
    if ("stringValue" in attr.value) out[attr.key] = attr.value.stringValue;
    if ("intValue" in attr.value) out[attr.key] = Number(attr.value.intValue);
    if ("doubleValue" in attr.value) out[attr.key] = attr.value.doubleValue;
    if ("boolValue" in attr.value) out[attr.key] = attr.value.boolValue;
  }
  return out;
}

afterEach(() => {
  if (oldTtl === undefined) {
    delete process.env.HARNESS_MEM_RECALL_CACHE_TTL_MS;
  } else {
    process.env.HARNESS_MEM_RECALL_CACHE_TTL_MS = oldTtl;
  }
  resetTelemetryForTests();
  while (dirs.length > 0) {
    rmSync(dirs.pop()!, { recursive: true, force: true });
  }
});

describe("S128-008 recall semantic telemetry wiring", () => {
  test("records recall/projection/cache/ADR spans with safe attributes only", async () => {
    process.env.HARNESS_MEM_RECALL_CACHE_TTL_MS = "60000";
    const exported: unknown[] = [];
    initializeTelemetry({
      serviceName: "harness-mem-memory-daemon",
      serviceVersion: "0.24.1",
      component: "memory-daemon",
      env: {
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "http://collector.test/v1/traces",
      },
      fetchImpl: async (_url, init) => {
        exported.push(JSON.parse(String(init?.body)));
        return new Response(null, { status: 204 });
      },
    });

    const { core } = makeCore("core");
    try {
      core.recordEvent(event({ event_id: "evt-alpha" }));
      const projection = core.refreshRecallProjection({ project: "proj-telemetry", limit: 50 });
      expect(projection.ok).toBe(true);

      const recall = await core.recallPrepared({
        query: "telemetry alpha",
        project: "proj-telemetry",
        limit: 5,
        safe_mode: true,
      });
      expect(recall.ok).toBe(true);

      const firstSearch = await core.searchPrepared({
        query: "telemetry alpha",
        project: "proj-telemetry",
        limit: 5,
        safe_mode: true,
      });
      const secondSearch = await core.searchPrepared({
        query: "telemetry alpha",
        project: "proj-telemetry",
        limit: 5,
        safe_mode: true,
      });
      expect(firstSearch.meta.recall_cache_hit).toBe(false);
      expect(secondSearch.meta.recall_cache_hit).toBe(true);

      const adr = core.ingestKnowledgeFile({
        file_path: "docs/adr/ADR-004-semantic-telemetry.md",
        kind: "adr",
        project: "proj-telemetry",
        content: [
          "# ADR-004: Semantic Telemetry",
          "",
          "## Status",
          "Accepted",
          "",
          "## Context",
          "ADR body text must never be emitted as telemetry.",
        ].join("\n"),
      });
      expect(adr.ok).toBe(true);
    } finally {
      core.shutdown("test");
      await shutdownTelemetry("test");
    }

    const spans = exported.flatMap(collectSpans);
    const names = spans.map((span) => span.name);
    expect(names).toContain("recall.projection.build");
    expect(names).toContain("recall.project");
    expect(names).toContain("recall.search");
    expect(names).toContain("adr.ingest");

    const searchSpans = spans.filter((span) => span.name === "recall.search").map(plainAttributes);
    expect(searchSpans.some((attrs) => attrs["metric.recall_cache_miss_count"] === 1)).toBe(true);
    expect(searchSpans.some((attrs) => attrs["metric.recall_cache_hit_count"] === 1)).toBe(true);

    const projectionAttrs = plainAttributes(spans.find((span) => span.name === "recall.projection.build")!);
    expect(typeof projectionAttrs["metric.recall_latency_ms"]).toBe("number");
    expect(typeof projectionAttrs["recall.projection.source_watermark_hash"]).toBe("string");

    const serialized = JSON.stringify(spans);
    expect(serialized).not.toContain("Semantic telemetry alpha private sentinel");
    expect(serialized).not.toContain("telemetry alpha");
    expect(serialized).not.toContain("proj-telemetry");
    expect(serialized).not.toContain("ADR body text must never be emitted");
    for (const span of spans) {
      const attrs = plainAttributes(span);
      expect(attrs.query).toBeUndefined();
      expect(attrs.content).toBeUndefined();
      expect(attrs.project).toBeUndefined();
      expect(attrs.file_path).toBeUndefined();
    }
  });
});
