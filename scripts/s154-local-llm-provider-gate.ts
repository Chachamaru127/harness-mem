#!/usr/bin/env bun
/**
 * S154-210: local LLM provider smoke gate.
 *
 * Runs four small generation tasks against local Ollama with JSON Schema
 * forced via the Ollama `format` field. The gate is local-only: non-loopback
 * hosts are rejected before fetch.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { redactSecrets, stripPrivateBlocks } from "../memory-server/src/core/privacy-tags";

export type LocalLlmTaskId = "fact_extraction" | "summary" | "contradiction" | "tense_rewrite";

export interface LocalLlmProviderGateOptions {
  models?: string[];
  host?: string;
  timeoutMs?: number;
  tenseFalsePositiveMax?: number;
  artifactDir?: string;
  writeArtifacts?: boolean;
  /**
   * S154-211: installed-model override for tests. When unset, the gate asks the
   * Ollama host (/api/tags) and records uninstalled models as skipped instead
   * of failing the whole matrix run.
   */
  installedModels?: string[];
}

export interface LocalLlmTaskResult {
  task_id: LocalLlmTaskId;
  schema_valid: boolean;
  task_passed: boolean;
  latency_ms: number;
  parse_error?: string;
  tense_false_positive?: boolean;
}

export interface LocalLlmModelResult {
  model: string;
  // S154-211: uninstalled matrix models are recorded, not failed.
  status: "measured" | "skipped";
  skip_reason: string | null;
  tasks: LocalLlmTaskResult[];
  metrics: {
    json_schema_valid_rate: number;
    task_pass_rate: number;
    tense_false_positive_rate: number;
    p50_latency_ms: number;
    p95_latency_ms: number;
  } | null;
  passed: boolean | null;
}

export interface LocalLlmProviderGateReport {
  schema_version: "s154-local-llm-provider-gate.v1";
  generated_at: string;
  task_id: "S154-210";
  provider: "ollama";
  host: string;
  thresholds: {
    json_schema_valid_rate: 1;
    tense_false_positive_rate_max: number;
  };
  models: LocalLlmModelResult[];
  overall_passed: boolean;
}

interface TaskSpec {
  id: LocalLlmTaskId;
  systemPrompt: string;
  prompt: string;
  schema: Record<string, unknown>;
  validate: (value: unknown) => { schemaValid: boolean; taskPassed: boolean; tenseFalsePositive?: boolean };
}

const DEFAULT_MODEL = "qwen3.5:9b";
const DEFAULT_HOST = "http://127.0.0.1:11434";
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_TENSE_FP_MAX = 0;

function safeText(text: string): string {
  return redactSecrets(stripPrivateBlocks(text) ?? "").replace(/\s+/g, " ").trim();
}

const OBJECT_ONLY = "Return JSON only. No markdown. No explanation.";

const TASKS: TaskSpec[] = [
  {
    id: "fact_extraction",
    systemPrompt: OBJECT_ONLY,
    prompt: [
      "Return exactly this JSON shape:",
      "{\"facts\":[{\"fact_type\":\"decision\",\"fact_key\":\"decision:default_embedding_provider\",\"fact_value\":\"keep multilingual-e5 as the default embedding provider\",\"confidence\":0.9}]}",
      "Extract stable memory facts from this coding note.",
      "Allowed fact_type values: decision, preference, lesson, pattern, action.",
      `note: ${safeText("Decision: keep multilingual-e5 as the default embedding provider. Action: add a local LLM provider gate before testing larger models.")}`,
    ].join("\n"),
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["facts"],
      properties: {
        facts: {
          type: "array",
          minItems: 1,
          maxItems: 5,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["fact_type", "fact_key", "fact_value", "confidence"],
            properties: {
              fact_type: { type: "string", enum: ["decision", "preference", "lesson", "pattern", "action"] },
              fact_key: { type: "string" },
              fact_value: { type: "string" },
              confidence: { type: "number" },
            },
          },
        },
      },
    },
    validate: (value) => {
      const facts = (value as { facts?: unknown }).facts;
      const schemaValid =
        Array.isArray(facts) &&
        facts.length > 0 &&
        facts.every((fact) => {
          const row = fact as Record<string, unknown>;
          return (
            typeof row.fact_type === "string" &&
            typeof row.fact_key === "string" &&
            typeof row.fact_value === "string" &&
            typeof row.confidence === "number"
          );
        });
      const text = JSON.stringify(value).toLowerCase();
      return { schemaValid, taskPassed: schemaValid && /e5|embedding|provider|local/.test(text) };
    },
  },
  {
    id: "summary",
    systemPrompt: OBJECT_ONLY,
    prompt: [
      "Return exactly this JSON shape:",
      "{\"summary\":\"short handoff summary\",\"key_points\":[\"point one\",\"point two\"]}",
      "Summarize this current state for an engineering handoff.",
      `state: ${safeText("The local LLM gate should run four tasks first: fact extraction, summary, contradiction judgment, and tense rewrite. The API key is sk-test-secret-1234567890 and must not appear in the output.")}`,
    ].join("\n"),
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["summary", "key_points"],
      properties: {
        summary: { type: "string" },
        key_points: { type: "array", minItems: 1, maxItems: 5, items: { type: "string" } },
      },
    },
    validate: (value) => {
      const row = value as { summary?: unknown; key_points?: unknown };
      const schemaValid =
        typeof row.summary === "string" &&
        Array.isArray(row.key_points) &&
        row.key_points.length > 0 &&
        row.key_points.every((item) => typeof item === "string");
      const text = JSON.stringify(value).toLowerCase();
      return { schemaValid, taskPassed: schemaValid && text.includes("local") && !text.includes("sk-test") };
    },
  },
  {
    id: "contradiction",
    systemPrompt: OBJECT_ONLY,
    prompt: [
      "Return exactly this JSON shape:",
      "{\"contradiction\":true,\"confidence\":0.9,\"reason\":\"short reason\"}",
      "Judge whether these two memory observations contradict each other.",
      "older: The default embedding provider is multilingual-e5.",
      "newer: The default embedding provider is now BGE-M3.",
    ].join("\n"),
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["contradiction", "confidence", "reason"],
      properties: {
        contradiction: { type: "boolean" },
        confidence: { type: "number" },
        reason: { type: "string" },
      },
    },
    validate: (value) => {
      const row = value as { contradiction?: unknown; confidence?: unknown; reason?: unknown };
      const schemaValid =
        typeof row.contradiction === "boolean" &&
        typeof row.confidence === "number" &&
        typeof row.reason === "string";
      return { schemaValid, taskPassed: schemaValid && row.contradiction === true };
    },
  },
  {
    id: "tense_rewrite",
    systemPrompt: [
      OBJECT_ONLY,
      "You are a conservative temporal rewrite judge.",
      "Never mark a planned item completed unless explicit completion evidence is present.",
    ].join(" "),
    prompt: [
      "Return exactly this JSON shape:",
      "{\"rewritten\":\"We will submit the GearChange API spec on Friday.\",\"changed\":false,\"false_positive\":false,\"reason\":\"No completion evidence is present.\"}",
      "Task: decide whether to rewrite the planned statement as completed.",
      "Original planned statement: We will submit the GearChange API spec on Friday.",
      "Evidence observed after the plan: There is no observation, log, message, or artifact showing the submission happened.",
      "Rule: absence of completion evidence means changed=false and false_positive=false.",
      "Do not infer completion from the date or from the plan itself.",
    ].join("\n"),
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["rewritten", "changed", "false_positive", "reason"],
      properties: {
        rewritten: { type: "string" },
        changed: { type: "boolean" },
        false_positive: { type: "boolean" },
        reason: { type: "string" },
      },
    },
    validate: (value) => {
      const row = value as { rewritten?: unknown; changed?: unknown; false_positive?: unknown; reason?: unknown };
      const schemaValid =
        typeof row.rewritten === "string" &&
        typeof row.changed === "boolean" &&
        typeof row.false_positive === "boolean" &&
        typeof row.reason === "string";
      const tenseFalsePositive = schemaValid && (row.changed === true || row.false_positive === true);
      return { schemaValid, taskPassed: schemaValid && !tenseFalsePositive, tenseFalsePositive };
    },
  },
];

function isLoopbackHost(rawHost: string): boolean {
  try {
    const url = new URL(rawHost);
    const hostname = url.hostname.toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

function p95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[index] ?? 0;
}

function p50(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? 0;
}

async function callOllamaJson(task: TaskSpec, model: string, host: string, timeoutMs: number): Promise<unknown> {
  if (!isLoopbackHost(host)) {
    throw new Error(`non_loopback_ollama_host: ${host}`);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(new URL("/api/chat", host), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        format: task.schema,
        think: false,
        messages: [
          { role: "system", content: task.systemPrompt },
          { role: "user", content: task.prompt },
        ],
        options: { temperature: 0, num_predict: 256 },
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`ollama_http_${response.status}: ${text.slice(0, 120)}`);
    }
    const data = (await response.json()) as { message?: { content?: string; thinking?: string }; response?: string };
    const content = data.message?.content ?? data.message?.thinking ?? data.response ?? "";
    return JSON.parse(content);
  } finally {
    clearTimeout(timer);
  }
}

async function listInstalledModels(host: string): Promise<string[]> {
  if (!isLoopbackHost(host)) {
    throw new Error(`non_loopback_ollama_host: ${host}`);
  }
  const response = await fetch(new URL("/api/tags", host));
  if (!response.ok) {
    throw new Error(`ollama_tags_http_${response.status}`);
  }
  const data = (await response.json()) as { models?: Array<{ name?: string }> };
  return (data.models ?? []).map((model) => String(model.name ?? "")).filter(Boolean);
}

async function runTask(task: TaskSpec, model: string, host: string, timeoutMs: number): Promise<LocalLlmTaskResult> {
  const started = performance.now();
  try {
    const value = await callOllamaJson(task, model, host, timeoutMs);
    const latencyMs = performance.now() - started;
    const validation = task.validate(value);
    return {
      task_id: task.id,
      schema_valid: validation.schemaValid,
      task_passed: validation.taskPassed,
      latency_ms: Number(latencyMs.toFixed(1)),
      tense_false_positive: validation.tenseFalsePositive,
    };
  } catch (error) {
    const latencyMs = performance.now() - started;
    return {
      task_id: task.id,
      schema_valid: false,
      task_passed: false,
      latency_ms: Number(latencyMs.toFixed(1)),
      parse_error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runLocalLlmProviderGate(
  options: LocalLlmProviderGateOptions = {},
): Promise<LocalLlmProviderGateReport> {
  const envModels = (process.env.HARNESS_MEM_LOCAL_LLM_MODELS ?? "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  const models = options.models && options.models.length > 0
    ? options.models
    : envModels.length > 0
      ? envModels
      : [process.env.HARNESS_MEM_LOCAL_LLM_DEFAULT_MODEL?.trim() || DEFAULT_MODEL];
  const host =
    options.host ??
    process.env.HARNESS_MEM_LOCAL_LLM_OLLAMA_HOST ??
    process.env.HARNESS_MEM_OLLAMA_HOST ??
    DEFAULT_HOST;
  const envTimeoutMs = Number(process.env.HARNESS_MEM_LOCAL_LLM_TIMEOUT_MS ?? "");
  const timeoutMs = options.timeoutMs ?? (Number.isFinite(envTimeoutMs) && envTimeoutMs > 0 ? envTimeoutMs : DEFAULT_TIMEOUT_MS);
  const tenseFpMax = options.tenseFalsePositiveMax ?? DEFAULT_TENSE_FP_MAX;
  const modelResults: LocalLlmModelResult[] = [];
  // Non-loopback hosts are rejected per-task (existing guard); only consult
  // /api/tags when the host is a valid loopback target.
  const installedModels =
    options.installedModels ?? (isLoopbackHost(host) ? await listInstalledModels(host) : null);

  for (const model of models) {
    if (installedModels !== null && !installedModels.includes(model)) {
      modelResults.push({
        model,
        status: "skipped",
        skip_reason: `model_not_installed:${model}`,
        tasks: [],
        metrics: null,
        passed: null,
      });
      continue;
    }
    const tasks: LocalLlmTaskResult[] = [];
    for (const task of TASKS) {
      tasks.push(await runTask(task, model, host, timeoutMs));
    }
    const validCount = tasks.filter((task) => task.schema_valid).length;
    const passCount = tasks.filter((task) => task.task_passed).length;
    const tenseTasks = tasks.filter((task) => task.task_id === "tense_rewrite");
    const tenseFpCount = tenseTasks.filter((task) => task.tense_false_positive === true).length;
    const metrics = {
      json_schema_valid_rate: validCount / tasks.length,
      task_pass_rate: passCount / tasks.length,
      tense_false_positive_rate: tenseTasks.length === 0 ? 0 : tenseFpCount / tenseTasks.length,
      p50_latency_ms: Number(p50(tasks.map((task) => task.latency_ms)).toFixed(1)),
      p95_latency_ms: Number(p95(tasks.map((task) => task.latency_ms)).toFixed(1)),
    };
    modelResults.push({
      model,
      status: "measured",
      skip_reason: null,
      tasks,
      metrics,
      passed: metrics.json_schema_valid_rate === 1 && metrics.tense_false_positive_rate <= tenseFpMax,
    });
  }

  const report: LocalLlmProviderGateReport = {
    schema_version: "s154-local-llm-provider-gate.v1",
    generated_at: new Date().toISOString(),
    task_id: "S154-210",
    provider: "ollama",
    host,
    thresholds: {
      json_schema_valid_rate: 1,
      tense_false_positive_rate_max: tenseFpMax,
    },
    models: modelResults,
    overall_passed: modelResults
      .filter((model) => model.status === "measured")
      .every((model) => model.passed === true),
  };

  if (options.writeArtifacts !== false) {
    const artifactDir = resolve(options.artifactDir ?? "docs/benchmarks/artifacts/s154-local-llm-provider-gate");
    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(join(artifactDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  }

  return report;
}

export function parseLocalLlmProviderGateArgs(argv: string[]): LocalLlmProviderGateOptions {
  const options: LocalLlmProviderGateOptions = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = argv[i + 1];
    if (token === "--model" && next) {
      options.models = [...(options.models ?? []), next];
      i += 1;
    } else if (token === "--host" && next) {
      options.host = next;
      i += 1;
    } else if (token === "--timeout-ms" && next) {
      options.timeoutMs = Number(next);
      i += 1;
    } else if (token === "--tense-fp-max" && next) {
      options.tenseFalsePositiveMax = Number(next);
      i += 1;
    } else if (token === "--artifact-dir" && next) {
      options.artifactDir = next;
      i += 1;
    } else if (token === "--no-write") {
      options.writeArtifacts = false;
    } else if (token === "--help" || token === "-h") {
      process.stdout.write(
        "Usage: bun run scripts/s154-local-llm-provider-gate.ts [--model MODEL ...] [--host URL] [--timeout-ms N] [--tense-fp-max N] [--artifact-dir DIR] [--no-write]\n",
      );
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${token}`);
    }
  }
  return options;
}

if (import.meta.main) {
  runLocalLlmProviderGate(parseLocalLlmProviderGateArgs(process.argv.slice(2)))
    .then((report) => {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      process.exitCode = report.overall_passed ? 0 : 1;
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[s154-local-llm-provider-gate] ${message}\n`);
      process.exitCode = 2;
    });
}
