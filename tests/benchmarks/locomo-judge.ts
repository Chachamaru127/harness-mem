import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { LocomoBenchmarkRecord, LocomoBenchmarkResult } from "./run-locomo-benchmark";

type JudgeLabel = "CORRECT" | "WRONG";

interface JudgeMetricSummary {
  count: number;
  correct: number;
  wrong: number;
  accuracy: number;
}

interface JudgeUsageSummary {
  calls: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

interface JudgeItem {
  sample_id: string;
  question_id: string;
  category: string;
  label: JudgeLabel;
  reasoning: string;
}

interface LocomoJudgeResult {
  schema_version: "locomo-judge-v1";
  generated_at: string;
  source_result_path: string;
  judge: {
    provider: "openai_chat_completions";
    model: string;
    api_base: string;
    prompt_version: "backboard-like-v1";
  };
  filters: {
    categories: string[];
    max_records: number | null;
  };
  metrics: {
    overall: JudgeMetricSummary;
    by_category: Record<string, JudgeMetricSummary>;
  };
  usage: JudgeUsageSummary;
  items?: JudgeItem[];
}

interface JudgeOptions {
  resultPath: string;
  outputPath?: string;
  model: string;
  apiBase: string;
  apiKey: string;
  categories: string[];
  maxRecords: number | null;
  includeItems: boolean;
  timeoutMs: number;
}

interface OpenAiJudgeResult {
  label: JudgeLabel;
  reasoning: string;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

function parseArgs(argv: string[]): JudgeOptions {
  let resultPath = "";
  let outputPath: string | undefined;
  let model = "gpt-4.1";
  let apiBase = "https://api.openai.com/v1";
  let categories = ["cat-1", "cat-2", "cat-3", "cat-4"];
  let maxRecords: number | null = null;
  let includeItems = false;
  let timeoutMs = 30_000;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--result" && i + 1 < argv.length) {
      resultPath = argv[i + 1] || "";
      i += 1;
      continue;
    }
    if (token === "--output" && i + 1 < argv.length) {
      outputPath = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--model" && i + 1 < argv.length) {
      model = argv[i + 1] || model;
      i += 1;
      continue;
    }
    if (token === "--api-base" && i + 1 < argv.length) {
      apiBase = argv[i + 1] || apiBase;
      i += 1;
      continue;
    }
    if (token === "--categories" && i + 1 < argv.length) {
      categories = String(argv[i + 1] || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      i += 1;
      continue;
    }
    if (token === "--max" && i + 1 < argv.length) {
      const parsed = Number(argv[i + 1] || "");
      if (Number.isFinite(parsed) && parsed > 0) {
        maxRecords = Math.floor(parsed);
      }
      i += 1;
      continue;
    }
    if (token === "--include-items") {
      includeItems = true;
      continue;
    }
    if (token === "--timeout-ms" && i + 1 < argv.length) {
      const parsed = Number(argv[i + 1] || "");
      if (Number.isFinite(parsed) && parsed > 0) {
        timeoutMs = Math.floor(parsed);
      }
      i += 1;
      continue;
    }
  }

  if (!resultPath) {
    throw new Error("--result is required");
  }
  if (categories.length === 0) {
    throw new Error("--categories must not be empty");
  }

  const apiKey = (process.env.HARNESS_MEM_OPENAI_API_KEY || process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error("OpenAI API key is required (HARNESS_MEM_OPENAI_API_KEY or OPENAI_API_KEY)");
  }

  return {
    resultPath,
    outputPath,
    model,
    apiBase,
    apiKey,
    categories,
    maxRecords,
    includeItems,
    timeoutMs,
  };
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidate = fenced ? (fenced[1] || "").trim() : trimmed;
  try {
    const parsed = JSON.parse(candidate) as unknown;
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function normalizeLabel(value: unknown): JudgeLabel | null {
  const raw = String(value || "").trim().toUpperCase();
  if (raw === "CORRECT") return "CORRECT";
  if (raw === "WRONG") return "WRONG";
  return null;
}

function buildPrompt(record: LocomoBenchmarkRecord): string {
  return [
    "Your task is to label an answer to a question as CORRECT or WRONG.",
    "Be generous with paraphrases and wording differences.",
    "For time questions, accept equivalent references (e.g. 'May 7' vs '7 May').",
    "Return strict JSON: {\"reasoning\":\"...\", \"label\":\"CORRECT|WRONG\"}.",
    "",
    `Question: ${record.question}`,
    `Gold answer: ${record.answer}`,
    `Generated answer: ${record.prediction}`,
  ].join("\n");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const withRetryable = error as Error & { retryable?: boolean };
  if (withRetryable.retryable) return true;
  if (error.name === "AbortError") return true;
  const message = error.message.toLowerCase();
  return (
    message.includes("fetch failed") ||
    message.includes("timed out") ||
    message.includes("timeout") ||
    message.includes("econnreset") ||
    message.includes("socket hang up")
  );
}

async function judgeRecord(record: LocomoBenchmarkRecord, options: JudgeOptions): Promise<OpenAiJudgeResult> {
  const maxAttempts = 5;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const response = await fetch(`${options.apiBase.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify({
          model: options.model,
          temperature: 0.1,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "You are a strict benchmark judge. Output JSON only with keys reasoning and label.",
            },
            {
              role: "user",
              content: buildPrompt(record),
            },
          ],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text();
        const error = new Error(`judge request failed: HTTP ${response.status} ${body.slice(0, 400)}`) as Error & {
          retryable?: boolean;
        };
        error.retryable = response.status === 429 || response.status >= 500;
        throw error;
      }

      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };
      const content = String(payload.choices?.[0]?.message?.content || "");
      const parsed = parseJsonObject(content);
      const label =
        normalizeLabel(parsed?.label) ||
        (/\bCORRECT\b/i.test(content) && !/\bWRONG\b/i.test(content) ? "CORRECT" : null) ||
        (/\bWRONG\b/i.test(content) && !/\bCORRECT\b/i.test(content) ? "WRONG" : null);

      if (!label) {
        throw new Error(`judge label parse failed for ${record.sample_id}:${record.question_id}`);
      }

      return {
        label,
        reasoning: String(parsed?.reasoning || "").trim(),
        usage: {
          prompt_tokens: Number(payload.usage?.prompt_tokens || 0),
          completion_tokens: Number(payload.usage?.completion_tokens || 0),
          total_tokens: Number(payload.usage?.total_tokens || 0),
        },
      };
    } catch (error) {
      lastError = error;
      if (!isRetryableError(error) || attempt === maxAttempts) {
        throw error;
      }
      const waitMs = Math.min(10_000, 500 * (2 ** (attempt - 1)));
      process.stderr.write(
        `retry ${attempt}/${maxAttempts} for ${record.sample_id}:${record.question_id} in ${waitMs}ms\n`
      );
      await sleep(waitMs);
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("judge failed");
}

function summarizeJudge(items: JudgeItem[]): JudgeMetricSummary {
  const count = items.length;
  const correct = items.filter((item) => item.label === "CORRECT").length;
  const wrong = count - correct;
  return {
    count,
    correct,
    wrong,
    accuracy: count > 0 ? correct / count : 0,
  };
}

async function runJudge(options: JudgeOptions): Promise<LocomoJudgeResult> {
  const resultPath = resolve(options.resultPath);
  const source = JSON.parse(readFileSync(resultPath, "utf8")) as LocomoBenchmarkResult;
  const categorySet = new Set(options.categories);
  const filtered = source.records.filter((record) => categorySet.has(record.category));
  const target = options.maxRecords ? filtered.slice(0, options.maxRecords) : filtered;

  const usage: JudgeUsageSummary = {
    calls: 0,
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
  };
  const judged: JudgeItem[] = [];

  for (let index = 0; index < target.length; index += 1) {
    const record = target[index]!;
    const judgedRecord = await judgeRecord(record, options);
    usage.calls += 1;
    usage.prompt_tokens += judgedRecord.usage.prompt_tokens;
    usage.completion_tokens += judgedRecord.usage.completion_tokens;
    usage.total_tokens += judgedRecord.usage.total_tokens;
    judged.push({
      sample_id: record.sample_id,
      question_id: record.question_id,
      category: record.category,
      label: judgedRecord.label,
      reasoning: judgedRecord.reasoning,
    });
    if ((index + 1) % 25 === 0 || index + 1 === target.length) {
      process.stdout.write(`judged ${index + 1}/${target.length}\n`);
    }
  }

  const byCategory: Record<string, JudgeMetricSummary> = {};
  for (const category of options.categories) {
    byCategory[category] = summarizeJudge(judged.filter((item) => item.category === category));
  }

  return {
    schema_version: "locomo-judge-v1",
    generated_at: new Date().toISOString(),
    source_result_path: resultPath,
    judge: {
      provider: "openai_chat_completions",
      model: options.model,
      api_base: options.apiBase,
      prompt_version: "backboard-like-v1",
    },
    filters: {
      categories: options.categories,
      max_records: options.maxRecords,
    },
    metrics: {
      overall: summarizeJudge(judged),
      by_category: byCategory,
    },
    usage,
    ...(options.includeItems ? { items: judged } : {}),
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const judged = await runJudge(options);
  if (options.outputPath) {
    const outputPath = resolve(options.outputPath);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(judged, null, 2)}\n`, "utf8");
  }
  process.stdout.write(`${JSON.stringify(judged, null, 2)}\n`);
}

if (import.meta.main) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
