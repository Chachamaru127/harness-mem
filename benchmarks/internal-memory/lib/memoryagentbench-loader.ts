import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assertBenchmarkCase } from "./schema";
import type { BenchmarkCase, BenchmarkDatasetManifest, Competency, OfficialMetricSpec } from "./types";

export const MEMORY_AGENT_BENCH_DATASET_ID = "ai-hyz/MemoryAgentBench";
export const MEMORY_AGENT_BENCH_SOURCE_URL = "https://huggingface.co/datasets/ai-hyz/MemoryAgentBench";
export const MEMORY_AGENT_BENCH_REVISION = "00d1946269e29b41eed74511997afa8171b91e08";
export const MEMORY_AGENT_BENCH_TRANSFORM_VERSION = "memoryagentbench-transform-v3";

export const MEMORY_AGENT_BENCH_SPLITS = [
  "Accurate_Retrieval",
  "Test_Time_Learning",
  "Long_Range_Understanding",
  "Conflict_Resolution",
] as const;

export type MemoryAgentBenchSplit = (typeof MEMORY_AGENT_BENCH_SPLITS)[number];

export interface MemoryAgentBenchLoadOptions {
  datasetId?: string;
  split?: MemoryAgentBenchSplit;
  splits?: MemoryAgentBenchSplit[];
  /** Smoke gate: caps benchmark cases and enables 4KB / 8-chunk transform. */
  limit?: number;
  /** Medium/full gate: caps upstream HF rows while keeping full 64KB chunking. */
  rowLimit?: number;
  cacheDir?: string;
  revision?: string;
  rows?: MemoryAgentBenchRawRow[];
  fetchImpl?: typeof fetch;
}

export interface MemoryAgentBenchLoadResult {
  cases: BenchmarkCase[];
  manifest: BenchmarkDatasetManifest;
}

export type MemoryAgentBenchRawRow = Record<string, unknown>;

interface HuggingFaceRowsResponse {
  rows?: Array<{ row_idx?: number; row?: MemoryAgentBenchRawRow }>;
  num_rows_total?: number;
}

const ROOT = join(import.meta.dir, "..");
const DEFAULT_CACHE_DIR = join(ROOT, ".cache", "memoryagentbench");

const SPLIT_TO_COMPETENCY: Record<MemoryAgentBenchSplit, Competency> = {
  Accurate_Retrieval: "AR",
  Test_Time_Learning: "TTL",
  Long_Range_Understanding: "LRU",
  Conflict_Resolution: "CR",
};

const SPLIT_TO_LAYER: Record<MemoryAgentBenchSplit, BenchmarkCase["layer"]> = {
  Accurate_Retrieval: "public_compatible",
  Test_Time_Learning: "mixed_coding",
  Long_Range_Understanding: "resume",
  Conflict_Resolution: "mixed_coding",
};

const SPLIT_TO_CATEGORY: Record<MemoryAgentBenchSplit, string> = {
  Accurate_Retrieval: "memoryagentbench_accurate_retrieval",
  Test_Time_Learning: "memoryagentbench_test_time_learning",
  Long_Range_Understanding: "memoryagentbench_long_range_understanding",
  Conflict_Resolution: "memoryagentbench_conflict_resolution",
};

export function parseMemoryAgentBenchSplit(value: string): MemoryAgentBenchSplit {
  if (MEMORY_AGENT_BENCH_SPLITS.includes(value as MemoryAgentBenchSplit)) {
    return value as MemoryAgentBenchSplit;
  }
  throw new Error(
    `invalid MemoryAgentBench split ${value}; expected one of ${MEMORY_AGENT_BENCH_SPLITS.join(", ")}`,
  );
}

function stableFilePart(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]+/g, "_");
}

function cachePath(input: {
  cacheDir: string;
  datasetId: string;
  split: MemoryAgentBenchSplit;
  revision: string;
  limit?: number;
  rowLimit?: number;
}): string {
  const limitPart =
    input.rowLimit !== undefined
      ? `row-${input.rowLimit}`
      : input.limit === undefined
        ? "all"
        : String(input.limit);
  return join(
    input.cacheDir,
    `${stableFilePart(input.datasetId)}__${input.split}__${stableFilePart(input.revision)}__limit-${limitPart}.json`,
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function flattenText(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    const text = String(value).trim();
    return text ? [text] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenText(item));
  }
  const record = asRecord(value);
  if (!record) return [];
  for (const key of ["content", "text", "utterance", "message", "event", "summary", "question", "answer"]) {
    if (record[key] !== undefined) return flattenText(record[key]);
  }
  const text = JSON.stringify(record);
  return text ? [text] : [];
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function flattenQuestionGroup(value: unknown, questionIndex: number, queryCount: number): string[] {
  if (!Array.isArray(value)) return flattenText(value);
  if (value.length === 0) return [];
  if (queryCount <= 1) return flattenText(value);
  const selected = value[questionIndex] ?? value[0];
  return flattenText(selected);
}

function rowMetadata(row: MemoryAgentBenchRawRow): Record<string, unknown> {
  return asRecord(row.metadata) ?? {};
}

export const MAX_CHUNK_CHARS = 64_000;
export const SMOKE_MAX_CHUNK_CHARS = 4_000;
export const SMOKE_MAX_MEMORY_CHUNKS = 8;
export const SMOKE_MAX_QUERY_CHARS = 2_000;

const CHUNK_MARKER_SPLITS: Array<{ pattern: RegExp }> = [
  { pattern: /(?=Document \d+:)/ },
  { pattern: /(?=Dialogue \d+:)/ },
  { pattern: /(?=Session \d+:)/ },
];

function splitByMarker(text: string, pattern: RegExp): string[] | null {
  const parts = text
    .split(pattern)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length >= 2 ? parts : null;
}

function splitNumberedFacts(text: string): string[] | null {
  const headerMatch = text.match(/^[\s\S]*?Here is a list of facts:\s*/i);
  const body = headerMatch ? text.slice(headerMatch[0].length) : text;
  const parts = body
    .split(/(?=^\d+\.\s)/m)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;
  const header = headerMatch ? headerMatch[0].trim() : "";
  return parts.map((part, index) => (index === 0 && header ? `${header}\n${part}` : part));
}

function maxChunkChars(sampleLimit?: number): number {
  return sampleLimit === undefined ? MAX_CHUNK_CHARS : SMOKE_MAX_CHUNK_CHARS;
}

function splitLargeTextByParagraphs(text: string, sampleLimit?: number): string[] {
  const chunkLimit = maxChunkChars(sampleLimit);
  if (text.length <= chunkLimit) return [text];
  const paragraphs = text
    .split(/\n\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (paragraphs.length <= 1) {
    const chunks: string[] = [];
    for (let offset = 0; offset < text.length; offset += chunkLimit) {
      const slice = text.slice(offset, offset + chunkLimit).trim();
      if (slice) chunks.push(slice);
    }
    return chunks.length > 0 ? chunks : [text];
  }
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if (paragraph.length > chunkLimit) {
      if (current.trim()) {
        chunks.push(...boundTextChunks(current.trim(), sampleLimit));
        current = "";
      }
      chunks.push(...boundTextChunks(paragraph, sampleLimit));
      continue;
    }
    const next = current ? `${current}\n\n${paragraph}` : paragraph;
    if (current && next.length > chunkLimit) {
      chunks.push(current.trim());
      current = paragraph;
    } else {
      current = next;
    }
  }
  if (current.trim()) chunks.push(...boundTextChunks(current.trim(), sampleLimit));
  return chunks.length > 0 ? chunks : [text];
}

function boundTextChunks(text: string, sampleLimit?: number): string[] {
  return splitLargeTextByParagraphs(text, sampleLimit);
}

export function chunkContextText(text: string, sampleLimit?: number): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  for (const { pattern } of CHUNK_MARKER_SPLITS) {
    const parts = splitByMarker(trimmed, pattern);
    if (parts) return parts.flatMap((part) => boundTextChunks(part, sampleLimit));
  }

  const facts = splitNumberedFacts(trimmed);
  if (facts) return facts.flatMap((part) => boundTextChunks(part, sampleLimit));

  return boundTextChunks(trimmed, sampleLimit);
}

function chunkContextValue(value: unknown, sampleLimit?: number): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (typeof item === "string") return chunkContextText(item, sampleLimit);
      return flattenText(item);
    });
  }
  if (typeof value === "string") return chunkContextText(value, sampleLimit);
  return flattenText(value);
}

function chunkHaystackSessions(haystack: unknown, sampleLimit?: number): string[] {
  if (!haystack) return [];
  if (!Array.isArray(haystack)) return flattenText(haystack);

  const chunks: string[] = [];
  for (const item of haystack) {
    if (Array.isArray(item)) {
      const firstRecord = asRecord(item[0]);
      if (firstRecord && ("content" in firstRecord || "role" in firstRecord)) {
        const sessionText = item
          .map((message) => {
            const record = asRecord(message);
            if (!record) return flattenText(message).join("\n");
            const role = record.role ? `${String(record.role)}: ` : "";
            const content = flattenText(record.content ?? record).join(" ");
            return content ? `${role}${content}` : "";
          })
          .filter(Boolean)
          .join("\n");
        if (sessionText.trim()) chunks.push(...boundTextChunks(sessionText.trim(), sampleLimit));
        continue;
      }
      chunks.push(...chunkHaystackSessions(item, sampleLimit));
      continue;
    }
    if (typeof item === "string") {
      chunks.push(...chunkContextText(item, sampleLimit));
      continue;
    }
    const record = asRecord(item);
    if (record) {
      const content = flattenText(record.content ?? record).join("\n");
      if (content.trim()) chunks.push(...boundTextChunks(content.trim(), sampleLimit));
      continue;
    }
    chunks.push(...flattenText(item));
  }
  return chunks;
}

function rowAnswerHints(row: MemoryAgentBenchRawRow): string[] {
  return unique(flattenText(row.answers ?? row.answer));
}

function truncateChunkForSmoke(text: string, answerHints: string[], maxChars: number): string {
  if (text.length <= maxChars) return text;
  const needles = answerHints
    .map((value) => value.toLowerCase())
    .filter((value) => value.length >= 3);
  for (const needle of needles) {
    const index = text.toLowerCase().indexOf(needle);
    if (index < 0) continue;
    const start = Math.max(0, index - Math.floor((maxChars - needle.length) / 2));
    return text.slice(start, start + maxChars).trim();
  }
  return text.slice(0, maxChars).trim();
}

function truncateQueryForSmoke(query: string, sampleLimit?: number): string {
  if (sampleLimit === undefined || query.length <= SMOKE_MAX_QUERY_CHARS) return query;
  return query.slice(-SMOKE_MAX_QUERY_CHARS).trim();
}

function capMemoryChunksForSmoke(
  texts: string[],
  answerHints: string[],
  sampleLimit?: number,
): string[] {
  if (sampleLimit === undefined) return texts;

  const bounded = texts.map((text) => truncateChunkForSmoke(text, answerHints, SMOKE_MAX_CHUNK_CHARS));
  if (bounded.length <= SMOKE_MAX_MEMORY_CHUNKS) return bounded;

  const needles = answerHints
    .map((value) => value.toLowerCase())
    .filter((value) => value.length >= 3);
  const required = bounded.filter((text) => {
    const haystack = text.toLowerCase();
    return needles.some((needle) => haystack.includes(needle));
  });
  if (required.length >= SMOKE_MAX_MEMORY_CHUNKS) {
    return required.slice(0, SMOKE_MAX_MEMORY_CHUNKS);
  }
  const requiredSet = new Set(required);
  const optional = bounded.filter((text) => !requiredSet.has(text));
  return [
    ...optional.slice(0, SMOKE_MAX_MEMORY_CHUNKS - required.length),
    ...required,
  ];
}

function buildMemoryTexts(row: MemoryAgentBenchRawRow, sampleLimit?: number): string[] {
  const metadata = rowMetadata(row);
  const haystack = metadata.haystack_sessions ?? row.haystack_sessions;
  const chunks: string[] = [];

  chunks.push(...chunkContextValue(row.context, sampleLimit));
  chunks.push(...chunkHaystackSessions(haystack, sampleLimit));

  const previousEvents = row.previous_events ?? metadata.previous_events;
  if (Array.isArray(previousEvents)) {
    for (const event of previousEvents) {
      chunks.push(...flattenText(event).map((text) => text.trim()).filter(Boolean));
    }
  } else {
    chunks.push(...flattenText(previousEvents));
  }

  const texts = unique(chunks.flatMap((chunk) => boundTextChunks(chunk, sampleLimit)));
  if (texts.length > 0) return texts;
  return unique(flattenText(row).flatMap((chunk) => boundTextChunks(chunk, sampleLimit)));
}

function officialMetricSpec(split: MemoryAgentBenchSplit, answers: string[]): OfficialMetricSpec {
  const competency = SPLIT_TO_COMPETENCY[split];
  const family =
    competency === "AR" || competency === "CR"
      ? "substring_exact_match"
      : "exact_match";
  return {
    family,
    name:
      competency === "AR" || competency === "CR"
        ? "memoryagentbench_retrieval_proxy_substring_exact_match"
        : "memoryagentbench_retrieval_proxy_exact_match_llm_judge_opt_in",
    expected_answers: answers,
    source_url: MEMORY_AGENT_BENCH_SOURCE_URL,
  };
}

function relevantMemoryIds(memories: BenchmarkCase["memories"], answers: string[]): string[] {
  const needles = answers.map((answer) => answer.toLowerCase()).filter(Boolean);
  const matched = memories
    .filter((memory) => needles.some((needle) => memory.content.toLowerCase().includes(needle)))
    .map((memory) => memory.id);
  return matched.length > 0 ? matched : [memories[0]?.id ?? "m1"].filter(Boolean);
}

export function transformMemoryAgentBenchRows(input: {
  rows: MemoryAgentBenchRawRow[];
  split: MemoryAgentBenchSplit;
  datasetId?: string;
  revision?: string;
  /** Smoke gate case cap; also enables smoke chunking when set. */
  limit?: number;
  /** When true without limit, use full chunking only (medium gate). */
  rowLimit?: number;
}): BenchmarkCase[] {
  const datasetId = input.datasetId ?? MEMORY_AGENT_BENCH_DATASET_ID;
  const revision = input.revision ?? MEMORY_AGENT_BENCH_REVISION;
  const competency = SPLIT_TO_COMPETENCY[input.split];
  const smokeMode = input.limit !== undefined;
  const sampleLimit = smokeMode ? input.limit : undefined;

  const cases = input.rows.flatMap((row, rowIndex) => {
    const questions = flattenText(row.questions ?? row.question);
    const queryCount = Math.max(questions.length, 1);
    const memoryTexts = capMemoryChunksForSmoke(
      buildMemoryTexts(row, sampleLimit),
      rowAnswerHints(row),
      sampleLimit,
    );
    const memories = memoryTexts.map((content, memoryIndex) => ({
      id: `mab-${input.split}-${rowIndex + 1}-m${memoryIndex + 1}`,
      content,
      metadata: {
        source_dataset: datasetId,
        source_split: input.split,
      },
    }));

    return Array.from({ length: queryCount }, (_, questionIndex) => {
      const query = truncateQueryForSmoke(
        questions[questionIndex] ?? questions[0] ?? "",
        sampleLimit,
      );
      const answerGroup = flattenQuestionGroup(row.answers ?? row.answer, questionIndex, queryCount);
      const keypointGroup = flattenQuestionGroup(row.keypoints, questionIndex, queryCount);
      const expectedKeywordGroup = flattenQuestionGroup(row.expected_keywords, questionIndex, queryCount);
      const expectedAnswers = unique([...answerGroup, ...keypointGroup, ...expectedKeywordGroup]);
      const caseRow = assertBenchmarkCase(
        {
          case_id: `mab-${input.split}-${rowIndex + 1}-${questionIndex + 1}`,
          layer: SPLIT_TO_LAYER[input.split],
          category: SPLIT_TO_CATEGORY[input.split],
          competency,
          language_profile: "en",
          project: `memoryagentbench-${input.split.toLowerCase()}`,
          memories,
          query: query || expectedAnswers[0] || `MemoryAgentBench ${input.split} query`,
          relevant_ids: relevantMemoryIds(memories, expectedAnswers),
          expected_keywords: expectedAnswers.length > 0 ? expectedAnswers : undefined,
          resume_must_include: competency === "LRU" ? expectedAnswers : undefined,
        },
        rowIndex + 1,
      );
      return {
        ...caseRow,
        source_dataset: datasetId,
        source_split: input.split,
        dataset_revision: revision,
        sample_limit: input.limit,
        official_metric: officialMetricSpec(input.split, expectedAnswers),
      };
    });
  });
  return input.limit === undefined ? cases : cases.slice(0, input.limit);
}

async function fetchRows(input: {
  datasetId: string;
  split: MemoryAgentBenchSplit;
  revision: string;
  limit?: number;
  rowLimit?: number;
  fetchImpl: typeof fetch;
}): Promise<MemoryAgentBenchRawRow[]> {
  const rows: MemoryAgentBenchRawRow[] = [];
  const rowCap = input.rowLimit ?? input.limit;
  const pageSize = Math.min(rowCap ?? 100, 100);
  let offset = 0;
  while (rowCap === undefined || rows.length < rowCap) {
    const length = Math.min(pageSize, (rowCap ?? Number.POSITIVE_INFINITY) - rows.length);
    const url = new URL("https://datasets-server.huggingface.co/rows");
    url.searchParams.set("dataset", input.datasetId);
    url.searchParams.set("config", "default");
    url.searchParams.set("split", input.split);
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("length", String(length));
    url.searchParams.set("revision", input.revision);
    const response = await input.fetchImpl(url);
    if (!response.ok) {
      throw new Error(`MemoryAgentBench fetch failed: ${response.status} ${response.statusText}`);
    }
    const payload = (await response.json()) as HuggingFaceRowsResponse;
    const page = (payload.rows ?? []).map((entry) => entry.row).filter(Boolean) as MemoryAgentBenchRawRow[];
    rows.push(...page);
    offset += page.length;
    if (page.length < length || (payload.num_rows_total !== undefined && rows.length >= payload.num_rows_total)) {
      break;
    }
  }
  return rowCap === undefined ? rows : rows.slice(0, rowCap);
}

async function loadSplit(input: {
  datasetId: string;
  split: MemoryAgentBenchSplit;
  limit?: number;
  rowLimit?: number;
  cacheDir: string;
  revision: string;
  rows?: MemoryAgentBenchRawRow[];
  fetchImpl: typeof fetch;
}): Promise<MemoryAgentBenchRawRow[]> {
  if (input.rows) return input.rows;
  const path = cachePath(input);
  if (existsSync(path)) {
    const cached = JSON.parse(readFileSync(path, "utf8")) as { rows: MemoryAgentBenchRawRow[] };
    return cached.rows;
  }
  mkdirSync(input.cacheDir, { recursive: true });
  const rows = await fetchRows(input);
  writeFileSync(
    path,
    `${JSON.stringify(
      {
        dataset_id: input.datasetId,
        split: input.split,
        revision: input.revision,
        source_url: MEMORY_AGENT_BENCH_SOURCE_URL,
        downloaded_at: new Date().toISOString(),
        transform_version: MEMORY_AGENT_BENCH_TRANSFORM_VERSION,
        rows,
      },
      null,
      2,
    )}\n`,
  );
  return rows;
}

export async function loadMemoryAgentBenchDataset(
  options: MemoryAgentBenchLoadOptions = {},
): Promise<MemoryAgentBenchLoadResult> {
  const datasetId = options.datasetId ?? MEMORY_AGENT_BENCH_DATASET_ID;
  const revision = options.revision ?? MEMORY_AGENT_BENCH_REVISION;
  const cacheDir = options.cacheDir ?? DEFAULT_CACHE_DIR;
  const splits = options.splits ?? [options.split ?? "Accurate_Retrieval"];
  const fetchImpl = options.fetchImpl ?? fetch;
  const allCases: BenchmarkCase[] = [];
  let upstreamRowCount = 0;
  let memoryChunkCount = 0;

  for (const split of splits) {
    const rows = await loadSplit({
      datasetId,
      split,
      limit: options.limit,
      rowLimit: options.rowLimit,
      cacheDir,
      revision,
      rows: options.rows,
      fetchImpl,
    });
    upstreamRowCount += rows.length;
    const splitCases = transformMemoryAgentBenchRows({
      rows,
      split,
      datasetId,
      revision,
      limit: options.limit,
      rowLimit: options.rowLimit,
    });
    memoryChunkCount = Math.max(memoryChunkCount, splitCases[0]?.memories.length ?? 0);
    allCases.push(...splitCases);
  }

  const gateMode =
    options.limit !== undefined ? "smoke" : options.rowLimit !== undefined ? "medium" : "full";

  return {
    cases: allCases,
    manifest: {
      dataset: "memoryagentbench",
      dataset_id: datasetId,
      source_url: MEMORY_AGENT_BENCH_SOURCE_URL,
      revision,
      splits,
      sample_limit: options.limit,
      row_limit: options.rowLimit,
      gate_mode: gateMode,
      upstream_row_count: upstreamRowCount,
      memory_chunk_count: memoryChunkCount,
      transform_version: MEMORY_AGENT_BENCH_TRANSFORM_VERSION,
      cache_dir: cacheDir,
      downloaded_at: new Date().toISOString(),
    },
  };
}
