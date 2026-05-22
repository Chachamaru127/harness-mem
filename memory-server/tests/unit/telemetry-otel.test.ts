import { afterEach, describe, expect, test } from "bun:test";
import {
  initializeTelemetry,
  resetTelemetryForTests,
  shutdownTelemetry,
} from "../../src/telemetry/otel";

afterEach(() => {
  resetTelemetryForTests();
});

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
