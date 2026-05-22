import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

type TelemetryExporterMode = "disabled" | "local" | "otlp_http";

export interface TelemetryInitOptions {
  serviceName: string;
  serviceVersion?: string;
  component?: string;
  resourceAttributes?: Record<string, string | number | boolean>;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export interface TelemetryStatus {
  initialized: boolean;
  service_name: string;
  service_version: string;
  sdk_disabled: boolean;
  exporter: {
    mode: TelemetryExporterMode;
    endpoint: string | null;
    explicit_endpoint: boolean;
    pending_spans: number;
    flushed_spans: number;
    last_flush_ok: boolean | null;
    last_flush_error: string | null;
    shutdown: boolean;
  };
  resource: Record<string, string | number | boolean>;
}

interface LifecycleSpan {
  traceId: string;
  spanId: string;
  name: string;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: Record<string, string | number | boolean>;
}

interface ExporterConfig {
  mode: TelemetryExporterMode;
  endpoint: string | null;
  explicitEndpoint: boolean;
  headers: Record<string, string>;
  timeoutMs: number;
}

const DEFAULT_NAMESPACE = "harness-mem";
const LOCAL_ONLY_EXPORTER = "local";
const DEFAULT_FLUSH_TIMEOUT_MS = 5_000;
const MAX_LOCAL_SPANS = 128;

let activeRuntime: OpenTelemetryRuntime | null = null;

export function initializeTelemetry(options: TelemetryInitOptions): OpenTelemetryRuntime {
  if (activeRuntime && !activeRuntime.isShutdown()) {
    return activeRuntime;
  }
  activeRuntime = new OpenTelemetryRuntime(options);
  activeRuntime.recordLifecycleSpan("telemetry.sdk.init", {
    "telemetry.component": options.component || "unknown",
  });
  return activeRuntime;
}

export function getTelemetryStatus(): TelemetryStatus {
  return activeRuntime?.status() ?? {
    initialized: false,
    service_name: "",
    service_version: "",
    sdk_disabled: false,
    exporter: {
      mode: LOCAL_ONLY_EXPORTER,
      endpoint: null,
      explicit_endpoint: false,
      pending_spans: 0,
      flushed_spans: 0,
      last_flush_ok: null,
      last_flush_error: null,
      shutdown: false,
    },
    resource: {},
  };
}

export async function shutdownTelemetry(reason: string): Promise<TelemetryStatus> {
  if (!activeRuntime) {
    return getTelemetryStatus();
  }
  return activeRuntime.shutdown(reason);
}

export function resetTelemetryForTests(): void {
  activeRuntime = null;
}

export function resolveHarnessMemVersion(cwd = process.cwd()): string {
  const candidates = [
    resolve(cwd, "package.json"),
    resolve(cwd, "..", "package.json"),
    resolve(cwd, "..", "..", "package.json"),
  ];
  let fallback: string | null = null;
  for (const path of candidates) {
    try {
      if (!existsSync(path)) continue;
      const parsed = JSON.parse(readFileSync(path, "utf8")) as { name?: unknown; version?: unknown };
      if (typeof parsed.version === "string" && parsed.version.trim()) {
        if (parsed.name === "@chachamaru127/harness-mem") {
          return parsed.version.trim();
        }
        fallback ??= parsed.version.trim();
      }
    } catch {
      // best effort only
    }
  }
  return fallback ?? "0.0.0";
}

export class OpenTelemetryRuntime {
  private readonly env: Record<string, string | undefined>;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly serviceName: string;
  private readonly serviceVersion: string;
  private readonly resource: Record<string, string | number | boolean>;
  private readonly exporter: ExporterConfig;
  private readonly spans: LifecycleSpan[] = [];
  private flushedSpans = 0;
  private lastFlushOk: boolean | null = null;
  private lastFlushError: string | null = null;
  private shutdownComplete = false;

  constructor(options: TelemetryInitOptions) {
    this.env = options.env ?? process.env;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
    const envResource = parseResourceAttributes(this.env.OTEL_RESOURCE_ATTRIBUTES);
    this.serviceName = resolveServiceName(options.serviceName, envResource, this.env);
    this.serviceVersion = String(
      envResource["service.version"] ?? options.serviceVersion ?? resolveHarnessMemVersion(),
    );
    const mergedResource = {
      "service.namespace": DEFAULT_NAMESPACE,
      "service.name": this.serviceName,
      "service.version": this.serviceVersion,
      "process.pid": process.pid,
      "process.runtime.name": typeof Bun !== "undefined" ? "bun" : "node",
      ...(options.component ? { "harness.component": options.component } : {}),
      ...(options.resourceAttributes ?? {}),
      ...envResource,
    };
    mergedResource["service.name"] = this.serviceName;
    mergedResource["service.version"] = this.serviceVersion;
    this.resource = sanitizeResourceAttributes(mergedResource);
    this.exporter = resolveExporterConfig(this.env);
  }

  isShutdown(): boolean {
    return this.shutdownComplete;
  }

  status(): TelemetryStatus {
    return {
      initialized: true,
      service_name: this.serviceName,
      service_version: this.serviceVersion,
      sdk_disabled: this.exporter.mode === "disabled",
      exporter: {
        mode: this.exporter.mode,
        endpoint: this.exporter.endpoint,
        explicit_endpoint: this.exporter.explicitEndpoint,
        pending_spans: this.spans.length,
        flushed_spans: this.flushedSpans,
        last_flush_ok: this.lastFlushOk,
        last_flush_error: this.lastFlushError,
        shutdown: this.shutdownComplete,
      },
      resource: { ...this.resource },
    };
  }

  recordLifecycleSpan(name: string, attributes: Record<string, string | number | boolean> = {}): void {
    if (this.exporter.mode === "disabled") {
      return;
    }
    const startedAt = this.now();
    const endedAt = this.now();
    this.spans.push({
      traceId: randomHex(16),
      spanId: randomHex(8),
      name,
      startTimeUnixNano: millisToNanos(startedAt),
      endTimeUnixNano: millisToNanos(endedAt),
      attributes: sanitizeResourceAttributes(attributes),
    });
    while (this.spans.length > MAX_LOCAL_SPANS) {
      this.spans.shift();
    }
  }

  async flush(reason = "manual"): Promise<TelemetryStatus> {
    if (this.exporter.mode === "disabled") {
      this.lastFlushOk = true;
      return this.status();
    }
    this.recordLifecycleSpan("telemetry.sdk.flush", {
      "telemetry.flush.reason": reason,
    });
    if (this.exporter.mode === "local") {
      this.flushedSpans += this.spans.length;
      this.spans.length = 0;
      this.lastFlushOk = true;
      this.lastFlushError = null;
      return this.status();
    }
    if (!this.exporter.endpoint) {
      this.lastFlushOk = false;
      this.lastFlushError = "OTLP endpoint missing";
      return this.status();
    }
    const spansToFlush = [...this.spans];
    if (spansToFlush.length === 0) {
      this.lastFlushOk = true;
      this.lastFlushError = null;
      return this.status();
    }
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.exporter.timeoutMs);
      try {
        const response = await this.fetchImpl(this.exporter.endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...this.exporter.headers,
          },
          body: JSON.stringify(buildOtlpTracePayload(this.resource, spansToFlush)),
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`OTLP exporter returned HTTP ${response.status}`);
        }
      } finally {
        clearTimeout(timer);
      }
      this.flushedSpans += spansToFlush.length;
      this.spans.splice(0, spansToFlush.length);
      this.lastFlushOk = true;
      this.lastFlushError = null;
    } catch (error) {
      this.lastFlushOk = false;
      this.lastFlushError = error instanceof Error ? error.message : String(error);
    }
    return this.status();
  }

  async shutdown(reason = "shutdown"): Promise<TelemetryStatus> {
    if (this.shutdownComplete) {
      return this.status();
    }
    this.recordLifecycleSpan("telemetry.sdk.shutdown", {
      "telemetry.shutdown.reason": reason,
    });
    const status = await this.flush(reason);
    this.shutdownComplete = true;
    return {
      ...status,
      exporter: {
        ...status.exporter,
        shutdown: true,
      },
    };
  }
}

function resolveServiceName(
  fallback: string,
  resourceAttributes: Record<string, string | number | boolean>,
  env: Record<string, string | undefined>,
): string {
  const fromEnv = env.OTEL_SERVICE_NAME?.trim();
  if (fromEnv) return fromEnv;
  const fromResource = resourceAttributes["service.name"];
  if (typeof fromResource === "string" && fromResource.trim()) return fromResource.trim();
  return fallback;
}

function resolveExporterConfig(env: Record<string, string | undefined>): ExporterConfig {
  if (envTruthy(env.OTEL_SDK_DISABLED)) {
    return {
      mode: "disabled",
      endpoint: null,
      explicitEndpoint: false,
      headers: {},
      timeoutMs: DEFAULT_FLUSH_TIMEOUT_MS,
    };
  }
  const tracesExporter = (env.OTEL_TRACES_EXPORTER || "").trim().toLowerCase();
  if (tracesExporter === "none") {
    return {
      mode: "disabled",
      endpoint: null,
      explicitEndpoint: false,
      headers: {},
      timeoutMs: DEFAULT_FLUSH_TIMEOUT_MS,
    };
  }
  const tracesEndpoint = firstNonEmpty(env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT);
  const baseEndpoint = firstNonEmpty(env.OTEL_EXPORTER_OTLP_ENDPOINT);
  const endpoint = tracesEndpoint || (baseEndpoint ? appendOtlpTracePath(baseEndpoint) : null);
  if (!endpoint) {
    return {
      mode: LOCAL_ONLY_EXPORTER,
      endpoint: null,
      explicitEndpoint: false,
      headers: {},
      timeoutMs: DEFAULT_FLUSH_TIMEOUT_MS,
    };
  }
  return {
    mode: "otlp_http",
    endpoint,
    explicitEndpoint: true,
    headers: {
      ...parseHeaders(env.OTEL_EXPORTER_OTLP_HEADERS),
      ...parseHeaders(env.OTEL_EXPORTER_OTLP_TRACES_HEADERS),
    },
    timeoutMs: parseTimeoutMs(env.OTEL_EXPORTER_OTLP_TRACES_TIMEOUT || env.OTEL_EXPORTER_OTLP_TIMEOUT),
  };
}

function parseResourceAttributes(raw: string | undefined): Record<string, string | number | boolean> {
  const attrs: Record<string, string | number | boolean> = {};
  if (!raw) return attrs;
  for (const part of splitCommaList(raw)) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key || isSensitiveKey(key)) continue;
    attrs[key] = value;
  }
  return attrs;
}

function parseHeaders(raw: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  if (!raw) return headers;
  for (const part of splitCommaList(raw)) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key || !value) continue;
    headers[key] = value;
  }
  return headers;
}

function splitCommaList(raw: string): string[] {
  const parts: string[] = [];
  let current = "";
  let escaping = false;
  for (const char of raw) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }
    if (char === "\\") {
      escaping = true;
      continue;
    }
    if (char === ",") {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current) parts.push(current);
  return parts;
}

function parseTimeoutMs(raw: string | undefined): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_FLUSH_TIMEOUT_MS;
  return Math.max(100, Math.min(60_000, Math.round(parsed)));
}

function appendOtlpTracePath(endpoint: string): string {
  const trimmed = endpoint.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/v1/traces")) {
    return trimmed;
  }
  return `${trimmed}/v1/traces`;
}

function firstNonEmpty(...values: Array<string | undefined>): string | null {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function envTruthy(raw: string | undefined): boolean {
  const normalized = raw?.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function sanitizeResourceAttributes(
  attrs: Record<string, string | number | boolean>,
): Record<string, string | number | boolean> {
  const sanitized: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (!key || isSensitiveKey(key)) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

function isSensitiveKey(key: string): boolean {
  return /(secret|token|password|passwd|api[_-]?key|authorization|credential)/i.test(key);
}

function randomHex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

function millisToNanos(ms: number): string {
  return String(Math.round(ms * 1_000_000));
}

function buildOtlpTracePayload(
  resource: Record<string, string | number | boolean>,
  spans: LifecycleSpan[],
): Record<string, unknown> {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: toOtlpAttributes(resource),
        },
        scopeSpans: [
          {
            scope: {
              name: "harness-mem.telemetry",
              version: "s128-007",
            },
            spans: spans.map((span) => ({
              traceId: span.traceId,
              spanId: span.spanId,
              name: span.name,
              kind: 1,
              startTimeUnixNano: span.startTimeUnixNano,
              endTimeUnixNano: span.endTimeUnixNano,
              attributes: toOtlpAttributes(span.attributes),
            })),
          },
        ],
      },
    ],
  };
}

function toOtlpAttributes(attrs: Record<string, string | number | boolean>): Array<Record<string, unknown>> {
  return Object.entries(attrs).map(([key, value]) => ({
    key,
    value: toOtlpValue(value),
  }));
}

function toOtlpValue(value: string | number | boolean): Record<string, unknown> {
  if (typeof value === "boolean") return { boolValue: value };
  if (typeof value === "number") return Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value };
  return { stringValue: value };
}
