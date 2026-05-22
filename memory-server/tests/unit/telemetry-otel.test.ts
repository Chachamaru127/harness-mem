import { afterEach, describe, expect, test } from "bun:test";
import {
  getTelemetryLocalExport,
  initializeTelemetry,
  recallTelemetryAllowedAttributes,
  recordRecallTelemetry,
  RECALL_TELEMETRY_METRIC_NAMES,
  RECALL_TELEMETRY_SPAN_NAMES,
  resetTelemetryForTests,
  sanitizeRecallTelemetryAttributes,
  shutdownTelemetry,
} from "../../src/telemetry/otel";

afterEach(() => {
  resetTelemetryForTests();
});

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

describe("S128-007 OpenTelemetry plumbing", () => {
  test("defaults to local-only exporter with service resource attributes", async () => {
    let fetchCalls = 0;
    const runtime = initializeTelemetry({
      serviceName: "harness-mem-memory-daemon",
      serviceVersion: "0.24.1",
      component: "memory-daemon",
      env: {},
      fetchImpl: async () => {
        fetchCalls += 1;
        return new Response(null, { status: 204 });
      },
    });

    const status = await runtime.flush("test");

    expect(fetchCalls).toBe(0);
    expect(status.service_name).toBe("harness-mem-memory-daemon");
    expect(status.service_version).toBe("0.24.1");
    expect(status.exporter.mode).toBe("local");
    expect(status.exporter.explicit_endpoint).toBe(false);
    expect(status.resource["service.name"]).toBe("harness-mem-memory-daemon");
    expect(status.resource["service.version"]).toBe("0.24.1");
    expect(status.resource["harness.component"]).toBe("memory-daemon");
  });

  test("uses OTEL env overrides and exports only when endpoint is explicit", async () => {
    const calls: Array<{ url: string; body: unknown; headers: HeadersInit | undefined }> = [];
    const runtime = initializeTelemetry({
      serviceName: "harness-mem-memory-daemon",
      serviceVersion: "0.24.1",
      component: "memory-daemon",
      env: {
        OTEL_SERVICE_NAME: "custom-daemon",
        OTEL_RESOURCE_ATTRIBUTES: "deployment.environment=test,secret.token=redacted,service.version=9.9.9",
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:4318",
        OTEL_EXPORTER_OTLP_HEADERS: "x-test=ok,authorization=Bearer explicit",
      },
      fetchImpl: async (url, init) => {
        calls.push({
          url: String(url),
          body: JSON.parse(String(init?.body)),
          headers: init?.headers,
        });
        return new Response(null, { status: 204 });
      },
      now: () => 1_700_000_000_000,
    });

    runtime.recordLifecycleSpan("telemetry.test", { "test.attr": "ok", "api_key": "nope" });
    const status = await runtime.flush("test");

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("http://127.0.0.1:4318/v1/traces");
    expect(status.service_name).toBe("custom-daemon");
    expect(status.service_version).toBe("9.9.9");
    expect(status.exporter.mode).toBe("otlp_http");
    expect(status.exporter.explicit_endpoint).toBe(true);
    expect(status.exporter.last_flush_ok).toBe(true);
    expect(status.resource["secret.token"]).toBeUndefined();

    const payload = calls[0]!.body as { resourceSpans: Array<{ resource: { attributes: Array<{ key: string }> } }> };
    const attrs = payload.resourceSpans[0]!.resource.attributes.map((attr) => attr.key);
    expect(attrs).toContain("service.name");
    expect(attrs).toContain("service.version");
    expect(attrs).toContain("deployment.environment");
    expect(attrs).not.toContain("secret.token");
  });

  test("shutdown flushes and marks exporter shutdown", async () => {
    let fetchCalls = 0;
    initializeTelemetry({
      serviceName: "harness-mem-search-worker",
      serviceVersion: "0.24.1",
      component: "search-worker",
      env: {
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "http://collector.test/v1/traces",
      },
      fetchImpl: async () => {
        fetchCalls += 1;
        return new Response(null, { status: 204 });
      },
    });

    const status = await shutdownTelemetry("SIGTERM");

    expect(fetchCalls).toBe(1);
    expect(status.service_name).toBe("harness-mem-search-worker");
    expect(status.exporter.shutdown).toBe(true);
    expect(status.exporter.last_flush_ok).toBe(true);
    expect(status.exporter.pending_spans).toBe(0);
  });
});

describe("S128-008 recall semantic telemetry", () => {
  test("publishes fixed recall span and metric names", () => {
    expect(RECALL_TELEMETRY_SPAN_NAMES).toEqual([
      "recall.search",
      "recall.project",
      "recall.projection.build",
      "recall.worker",
      "recall.inject",
      "adr.ingest",
    ]);
    expect(RECALL_TELEMETRY_METRIC_NAMES).toEqual([
      "recall_latency_ms",
      "fallback_count",
      "projection_staleness_ms",
      "worker_queue_depth",
      "recall_cache_hit_count",
      "recall_cache_miss_count",
      "adr_recall_count",
    ]);
    expect(recallTelemetryAllowedAttributes()).toContain("metric.recall_latency_ms");
    expect(recallTelemetryAllowedAttributes()).toContain("recall.cache.key_hash");
  });

  test("allowlist strips raw content, prompts, paths, and secrets from semantic spans", async () => {
    const calls: Array<{ body: unknown }> = [];
    const runtime = initializeTelemetry({
      serviceName: "harness-mem-memory-daemon",
      serviceVersion: "0.24.1",
      component: "memory-daemon",
      env: {
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "http://collector.test/v1/traces",
      },
      fetchImpl: async (_url, init) => {
        calls.push({ body: JSON.parse(String(init?.body)) });
        return new Response(null, { status: 204 });
      },
      now: () => 1_700_000_000_000,
    });

    recordRecallTelemetry(
      "recall.search",
      {
        "recall.scope": "project",
        "recall.project_present": true,
        "recall.session_present": false,
        "recall.cache.hit": true,
        "recall.cache.key_hash": "abc123",
        "query": "raw user prompt must not leave process",
        "project": "raw-project-name",
        "content": "raw observation content",
        "authorization": "Bearer nope",
        "api_key": "nope",
      },
      {
        recall_latency_ms: 12.5,
        recall_cache_hit_count: 1,
        fallback_count: 0,
      },
    );
    await runtime.flush("test");

    const span = collectSpans(calls[0]!.body).find((candidate) => candidate.name === "recall.search");
    expect(span).toBeDefined();
    const attrs = plainAttributes(span!);
    expect(attrs["recall.scope"]).toBe("project");
    expect(attrs["recall.cache.key_hash"]).toBe("abc123");
    expect(attrs["metric.recall_latency_ms"]).toBe(12.5);
    expect(attrs["metric.recall_cache_hit_count"]).toBe(1);
    expect(attrs.query).toBeUndefined();
    expect(attrs.project).toBeUndefined();
    expect(attrs.content).toBeUndefined();
    expect(attrs.authorization).toBeUndefined();
    expect(attrs.api_key).toBeUndefined();
  });

  test("semantic sanitizer keeps only scalar allowlisted attributes", () => {
    expect(sanitizeRecallTelemetryAttributes({
      "recall.items_count": 3,
      "recall.safe_mode": true,
      "recall.cache.key_hash": "cache-key",
      "recall.cache": { raw: "object" },
      "raw_prompt": "drop",
      "secret.token": "drop",
    })).toEqual({
      "recall.items_count": 3,
      "recall.safe_mode": true,
      "recall.cache.key_hash": "cache-key",
    });
  });
});

describe("S128-009 local telemetry inspect/export", () => {
  test("summarizes recent spans and strips raw prompt/content/project path keys", () => {
    const runtime = initializeTelemetry({
      serviceName: "harness-mem-memory-daemon",
      serviceVersion: "0.24.1",
      component: "memory-daemon",
      env: {
        OTEL_RESOURCE_ATTRIBUTES: "deployment.environment=test,project.path=/private/project,service.version=0.24.1",
      },
      now: () => 1_700_000_000_000,
    });

    runtime.recordLifecycleSpan("telemetry.test", {
      "safe.attr": "ok",
      "prompt": "drop this prompt",
      "content": "drop this content",
      "project.path": "/private/project",
      "api_key": "drop",
    });
    recordRecallTelemetry(
      "recall.search",
      {
        "recall.scope": "project",
        "recall.project_present": true,
        "recall.cache.hit": true,
      },
      {
        recall_latency_ms: 11,
        recall_cache_hit_count: 1,
      },
    );

    const exported = getTelemetryLocalExport({ limit: 10 });
    expect(exported.schema).toBe("harness_mem.telemetry.export.v1");
    expect(exported.status.exporter.mode).toBe("local");
    expect(exported.status.resource["project.path"]).toBeUndefined();
    expect(exported.summary.span_counts["recall.search"]).toBe(1);
    expect(exported.summary.metrics.find((metric) => metric.name === "recall_latency_ms")?.latest).toBe(11);

    const serialized = JSON.stringify(exported);
    expect(serialized).not.toContain("drop this prompt");
    expect(serialized).not.toContain("drop this content");
    expect(serialized).not.toContain("/private/project");
    expect(serialized).not.toContain("api_key");
  });

  test("OTLP exporter failure is inspectable and leaves recall spans local", async () => {
    const runtime = initializeTelemetry({
      serviceName: "harness-mem-memory-daemon",
      serviceVersion: "0.24.1",
      component: "memory-daemon",
      env: {
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "http://collector.test/v1/traces?token=secret",
      },
      fetchImpl: async () => {
        throw new Error("collector unavailable");
      },
    });

    recordRecallTelemetry("recall.search", { "recall.scope": "project" }, { recall_latency_ms: 12 });
    const status = await runtime.flush("test");
    const exported = getTelemetryLocalExport({ limit: 5 });

    expect(status.exporter.last_flush_ok).toBe(false);
    expect(status.exporter.pending_spans).toBeGreaterThan(0);
    expect(exported.status.exporter.endpoint).toBe("http://collector.test/v1/traces");
    expect(exported.status.exporter.last_flush_error).toContain("collector unavailable");
    expect(exported.summary.span_counts["recall.search"]).toBe(1);
  });
});
