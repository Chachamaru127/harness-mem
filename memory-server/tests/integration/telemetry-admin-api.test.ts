import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessMemCore, type Config, type EventEnvelope } from "../../src/core/harness-mem-core";
import { startHarnessMemServer } from "../../src/server";
import { resetTelemetryForTests } from "../../src/telemetry/otel";

const dirs: string[] = [];
const oldEnv = {
  adminToken: process.env.HARNESS_MEM_ADMIN_TOKEN,
  otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  otlpTracesEndpoint: process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
  otelTracesExporter: process.env.OTEL_TRACES_EXPORTER,
  otelSdkDisabled: process.env.OTEL_SDK_DISABLED,
  otelResourceAttributes: process.env.OTEL_RESOURCE_ATTRIBUTES,
};

interface Runtime {
  core: HarnessMemCore;
  server: ReturnType<typeof startHarnessMemServer>;
  baseUrl: string;
}

function clearTelemetryEnv(): void {
  delete process.env.HARNESS_MEM_ADMIN_TOKEN;
  delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  delete process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
  delete process.env.OTEL_TRACES_EXPORTER;
  delete process.env.OTEL_SDK_DISABLED;
  delete process.env.OTEL_RESOURCE_ATTRIBUTES;
}

function restoreEnv(): void {
  const restore = (key: keyof typeof process.env, value: string | undefined) => {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  };
  restore("HARNESS_MEM_ADMIN_TOKEN", oldEnv.adminToken);
  restore("OTEL_EXPORTER_OTLP_ENDPOINT", oldEnv.otlpEndpoint);
  restore("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", oldEnv.otlpTracesEndpoint);
  restore("OTEL_TRACES_EXPORTER", oldEnv.otelTracesExporter);
  restore("OTEL_SDK_DISABLED", oldEnv.otelSdkDisabled);
  restore("OTEL_RESOURCE_ATTRIBUTES", oldEnv.otelResourceAttributes);
}

function makeRuntime(label: string): Runtime {
  clearTelemetryEnv();
  resetTelemetryForTests();
  const dir = mkdtempSync(join(tmpdir(), `hmem-telemetry-admin-${label}-`));
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
  const core = new HarnessMemCore(config);
  const server = startHarnessMemServer(core, config);
  return { core, server, baseUrl: `http://127.0.0.1:${server.port}` };
}

function event(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    event_id: `evt-${Math.random().toString(36).slice(2)}`,
    platform: "codex",
    project: "proj-admin-telemetry",
    session_id: "session-admin-telemetry",
    event_type: "user_prompt",
    ts: new Date().toISOString(),
    payload: { content: "Admin telemetry raw content must stay out" },
    tags: ["recall-runtime"],
    privacy_tags: [],
    ...overrides,
  };
}

afterEach(() => {
  resetTelemetryForTests();
  restoreEnv();
  while (dirs.length > 0) {
    rmSync(dirs.pop()!, { recursive: true, force: true });
  }
});

describe("S128-009 telemetry admin API", () => {
  test("returns local span and metric summaries without raw query/content/project", async () => {
    const runtime = makeRuntime("api");
    try {
      runtime.core.recordEvent(event({ event_id: "evt-telemetry-admin" }));

      const recallRes = await fetch(`${runtime.baseUrl}/v1/recall`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: "admin telemetry query",
          project: "proj-admin-telemetry",
          limit: 5,
          safe_mode: true,
        }),
      });
      expect(recallRes.status).toBe(200);

      const statusRes = await fetch(`${runtime.baseUrl}/v1/admin/telemetry/status`);
      expect(statusRes.status).toBe(200);
      const statusJson = await statusRes.json() as Record<string, unknown>;
      expect(statusJson.schema).toBe("harness_mem.telemetry.status.v1");

      const exportRes = await fetch(`${runtime.baseUrl}/v1/admin/telemetry/export?limit=16`);
      expect(exportRes.status).toBe(200);
      const exported = await exportRes.json() as {
        schema: string;
        summary: { span_counts: Record<string, number>; metrics: Array<{ name: string; count: number }> };
        spans: Array<{ name: string; attributes: Record<string, unknown> }>;
      };

      expect(exported.schema).toBe("harness_mem.telemetry.export.v1");
      expect(exported.summary.span_counts["recall.search"]).toBeGreaterThanOrEqual(1);
      expect(exported.summary.metrics.some((metric) => metric.name === "recall_latency_ms")).toBe(true);
      expect(exported.spans.some((span) => span.name === "recall.search")).toBe(true);

      const serialized = JSON.stringify(exported);
      expect(serialized).not.toContain("admin telemetry query");
      expect(serialized).not.toContain("Admin telemetry raw content must stay out");
      expect(serialized).not.toContain("proj-admin-telemetry");
    } finally {
      runtime.server.stop(true);
      runtime.core.shutdown("test");
    }
  });
});
