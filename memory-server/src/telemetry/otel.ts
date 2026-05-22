import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

type TelemetryExporterMode = "disabled" | "local" | "otlp_http";
type TelemetryAttributeValue = string | number | boolean;

export const RECALL_TELEMETRY_SCHEMA_VERSION = "s128-008";

export const RECALL_TELEMETRY_SPAN_NAMES = [
  "recall.search",
  "recall.project",
  "recall.projection.build",
  "recall.worker",
  "recall.inject",
  "adr.ingest",
] as const;

export type RecallTelemetrySpanName = (typeof RECALL_TELEMETRY_SPAN_NAMES)[number];

export const RECALL_TELEMETRY_METRIC_NAMES = [
  "recall_latency_ms",
  "fallback_count",
  "projection_staleness_ms",
  "worker_queue_depth",
  "recall_cache_hit_count",
  "recall_cache_miss_count",
  "adr_recall_count",
] as const;

export type RecallTelemetryMetricName = (typeof RECALL_TELEMETRY_METRIC_NAMES)[number];

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

export interface TelemetryLocalSpan {
  name: string;
  start_time_unix_nano: string;
  end_time_unix_nano: string;
  attributes: Record<string, TelemetryAttributeValue>;
}

export interface TelemetryMetricSummary {
  name: string;
  count: number;
  sum: number;
  min: number;
  max: number;
  latest: number;
}

export interface TelemetryLocalSummary {
  span_count_total: number;
  span_counts: Record<string, number>;
  metrics: TelemetryMetricSummary[];
  truncated: boolean;
  limit: number;
  max_local_spans: number;
}

export interface TelemetryLocalExport {
  ok: true;
  schema: "harness_mem.telemetry.export.v1";
  generated_at: string;
  status: TelemetryStatus;
  summary: TelemetryLocalSummary;
  spans: TelemetryLocalSpan[];
}

export interface TelemetryExportOptions {
  limit?: number;
}

interface LifecycleSpan {
  traceId: string;
  spanId: string;
  name: string;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: Record<string, TelemetryAttributeValue>;
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
const RECALL_TELEMETRY_SPAN_NAME_SET = new Set<string>(RECALL_TELEMETRY_SPAN_NAMES);
const RECALL_TELEMETRY_METRIC_NAME_SET = new Set<string>(RECALL_TELEMETRY_METRIC_NAMES);
const RECALL_TELEMETRY_ALLOWED_ATTRIBUTE_SET = new Set<string>([
  "telemetry.schema.version",
  "harness.operation",
  "harness.result",
  "harness.error_code",
  "recall.scope",
  "recall.project_present",
  "recall.session_present",
  "recall.include_private",
  "recall.safe_mode",
  "recall.forensic",
  "recall.limit",
  "recall.items_count",
  "recall.degraded",
  "recall.degraded_reason",
  "recall.cache.hit",
  "recall.cache.key_hash",
  "recall.cache.knobs_hash",
  "recall.cache.ttl_ms",
  "recall.cache.age_ms",
  "recall.cache.data_watermark_hash",
  "recall.projection.generation",
  "recall.projection.status",
  "recall.projection.source_watermark_hash",
  "recall.projection.current_watermark_hash",
  "recall.projection.candidate_count",
  "recall.projection.planned_count",
  "recall.projection.skipped_count",
  "recall.projection.writes",
  "recall.worker.mode",
  "recall.worker.fallback",
  "recall.worker.ready",
  "recall.worker.warmup_complete",
  "recall.worker.warmup_pending",
  "recall.worker.queue_depth",
  "recall.worker.timeout_ms",
  "recall.inject.kind",
  "recall.inject.count",
  "adr.status",
  "adr.has_supersedes",
  "adr.entries_imported",
  "adr.entries_skipped",
  "adr.parse_error_count",
  ...RECALL_TELEMETRY_METRIC_NAMES.map((name) => `metric.${name}`),
]);

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

export function getTelemetryLocalExport(options: TelemetryExportOptions = {}): TelemetryLocalExport {
  return activeRuntime?.localExport(options) ?? emptyTelemetryLocalExport(options);
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

export function hashTelemetryValue(value: unknown, length = 16): string {
  return createHash("sha256").update(String(value ?? "")).digest("hex").slice(0, length);
}

export function recallTelemetryAllowedAttributes(): string[] {
  return [...RECALL_TELEMETRY_ALLOWED_ATTRIBUTE_SET].sort();
}

export function sanitizeRecallTelemetryAttributes(
  attrs: Record<string, unknown> = {},
): Record<string, TelemetryAttributeValue> {
  const sanitized: Record<string, TelemetryAttributeValue> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (!RECALL_TELEMETRY_ALLOWED_ATTRIBUTE_SET.has(key)) continue;
    if (isSensitiveKey(key)) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

export function recordRecallTelemetry(
  name: RecallTelemetrySpanName,
  attributes: Record<string, unknown> = {},
  metrics: Partial<Record<RecallTelemetryMetricName, number | undefined>> = {},
): void {
  if (!RECALL_TELEMETRY_SPAN_NAME_SET.has(name)) {
    return;
  }
  const metricAttributes: Record<string, number> = {};
  for (const [metricName, value] of Object.entries(metrics)) {
    if (!RECALL_TELEMETRY_METRIC_NAME_SET.has(metricName)) continue;
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    metricAttributes[`metric.${metricName}`] = value;
  }
  activeRuntime?.recordLifecycleSpan(name, {
    "telemetry.schema.version": RECALL_TELEMETRY_SCHEMA_VERSION,
    ...sanitizeRecallTelemetryAttributes(attributes),
    ...sanitizeRecallTelemetryAttributes(metricAttributes),
  });
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

  localExport(options: TelemetryExportOptions = {}): TelemetryLocalExport {
    const limit = normalizeExportLimit(options.limit);
    const recent = limit === 0 ? [] : this.spans.slice(-limit);
    return {
      ok: true,
      schema: "harness_mem.telemetry.export.v1",
      generated_at: new Date(this.now()).toISOString(),
      status: sanitizeTelemetryStatusForExport(this.status()),
      summary: summarizeLocalSpans(this.spans, limit),
      spans: recent.map((span) => ({
        name: span.name,
        start_time_unix_nano: span.startTimeUnixNano,
        end_time_unix_nano: span.endTimeUnixNano,
        attributes: sanitizeTelemetryExportAttributes(span.attributes),
      })),
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

function emptyTelemetryLocalExport(options: TelemetryExportOptions): TelemetryLocalExport {
  const limit = normalizeExportLimit(options.limit);
  return {
    ok: true,
    schema: "harness_mem.telemetry.export.v1",
    generated_at: new Date().toISOString(),
    status: sanitizeTelemetryStatusForExport(getTelemetryStatus()),
    summary: {
      span_count_total: 0,
      span_counts: {},
      metrics: [],
      truncated: false,
      limit,
      max_local_spans: MAX_LOCAL_SPANS,
    },
    spans: [],
  };
}

function normalizeExportLimit(limit: number | undefined): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) return 32;
  return Math.max(0, Math.min(MAX_LOCAL_SPANS, Math.trunc(limit)));
}

function summarizeLocalSpans(spans: LifecycleSpan[], limit: number): TelemetryLocalSummary {
  const spanCounts: Record<string, number> = {};
  const metrics = new Map<string, TelemetryMetricSummary>();
  for (const span of spans) {
    spanCounts[span.name] = (spanCounts[span.name] ?? 0) + 1;
    for (const [key, value] of Object.entries(span.attributes)) {
      if (!key.startsWith("metric.") || typeof value !== "number" || !Number.isFinite(value)) {
        continue;
      }
      const name = key.slice("metric.".length);
      const current = metrics.get(name);
      if (!current) {
        metrics.set(name, { name, count: 1, sum: value, min: value, max: value, latest: value });
        continue;
      }
      current.count += 1;
      current.sum += value;
      current.min = Math.min(current.min, value);
      current.max = Math.max(current.max, value);
      current.latest = value;
    }
  }
  return {
    span_count_total: spans.length,
    span_counts: Object.fromEntries(Object.entries(spanCounts).sort(([a], [b]) => a.localeCompare(b))),
    metrics: [...metrics.values()].sort((a, b) => a.name.localeCompare(b.name)),
    truncated: spans.length > limit,
    limit,
    max_local_spans: MAX_LOCAL_SPANS,
  };
}

function sanitizeTelemetryStatusForExport(status: TelemetryStatus): TelemetryStatus {
  return {
    ...status,
    exporter: {
      ...status.exporter,
      endpoint: sanitizeEndpointForExport(status.exporter.endpoint),
      last_flush_error: sanitizeTelemetryError(status.exporter.last_flush_error),
    },
    resource: sanitizeTelemetryExportAttributes(status.resource),
  };
}

function sanitizeEndpointForExport(endpoint: string | null): string | null {
  if (!endpoint) return null;
  try {
    const parsed = new URL(endpoint);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return endpoint.replace(/[?#].*$/, "");
  }
}

function sanitizeTelemetryError(error: string | null): string | null {
  if (!error) return null;
  return error.replace(/(authorization|token|api[_-]?key|password)=([^,\s]+)/gi, "$1=<redacted>");
}

function sanitizeTelemetryExportAttributes(
  attrs: Record<string, string | number | boolean>,
): Record<string, TelemetryAttributeValue> {
  const sanitized: Record<string, TelemetryAttributeValue> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (!isTelemetryExportSafeKey(key)) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

function isTelemetryExportSafeKey(key: string): boolean {
  if (!key || isSensitiveKey(key)) return false;
  return !/(^|[._-])(query|prompt|content|body|file|path|cwd|home|session_id)($|[._-])/i.test(key) &&
    !/(^|[._-])project($|[._-])(?!present)/i.test(key);
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
