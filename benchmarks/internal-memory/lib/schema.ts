import type { BenchmarkCase } from "./types";

const LAYERS = new Set([
  "public_compatible",
  "ja_coding",
  "mixed_coding",
  "isolation",
  "resume",
]);

const LANG = new Set(["ja", "en", "mixed"]);
const COMPETENCIES = new Set(["AR", "TTL", "LRU", "CR"]);

export function assertBenchmarkCase(raw: unknown, lineNumber: number): BenchmarkCase {
  if (!raw || typeof raw !== "object") {
    throw new Error(`dataset line ${lineNumber}: expected object`);
  }
  const row = raw as Record<string, unknown>;
  const required = ["case_id", "layer", "category", "language_profile", "project", "memories", "query", "relevant_ids"];
  for (const key of required) {
    if (!(key in row)) {
      throw new Error(`dataset line ${lineNumber}: missing ${key}`);
    }
  }
  if (!LAYERS.has(String(row.layer))) {
    throw new Error(`dataset line ${lineNumber}: invalid layer ${String(row.layer)}`);
  }
  if (!LANG.has(String(row.language_profile))) {
    throw new Error(`dataset line ${lineNumber}: invalid language_profile`);
  }
  if (row.competency !== undefined && !COMPETENCIES.has(String(row.competency))) {
    throw new Error(`dataset line ${lineNumber}: invalid competency ${String(row.competency)}`);
  }
  if (!Array.isArray(row.memories) || row.memories.length === 0) {
    throw new Error(`dataset line ${lineNumber}: memories must be non-empty array`);
  }
  if (!Array.isArray(row.relevant_ids) || row.relevant_ids.length === 0) {
    throw new Error(`dataset line ${lineNumber}: relevant_ids must be non-empty array`);
  }

  const memories = row.memories.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`dataset line ${lineNumber}: memory[${index}] invalid`);
    }
    const mem = entry as Record<string, unknown>;
    if (!mem.id || !mem.content) {
      throw new Error(`dataset line ${lineNumber}: memory[${index}] needs id and content`);
    }
    return {
      id: String(mem.id),
      content: String(mem.content),
      timestamp: mem.timestamp ? String(mem.timestamp) : undefined,
      workspace_id: mem.workspace_id ? String(mem.workspace_id) : undefined,
      metadata: mem.metadata as Record<string, string> | undefined,
    };
  });

  return {
    case_id: String(row.case_id),
    layer: row.layer as BenchmarkCase["layer"],
    category: String(row.category),
    competency: row.competency ? (String(row.competency) as BenchmarkCase["competency"]) : undefined,
    language_profile: row.language_profile as BenchmarkCase["language_profile"],
    project: String(row.project),
    workspace_id: row.workspace_id ? String(row.workspace_id) : undefined,
    forbidden_project: row.forbidden_project ? String(row.forbidden_project) : undefined,
    memories,
    query: String(row.query),
    relevant_ids: row.relevant_ids.map((id) => String(id)),
    expected_keywords: Array.isArray(row.expected_keywords)
      ? row.expected_keywords.map((k) => String(k))
      : undefined,
    resume_must_include: Array.isArray(row.resume_must_include)
      ? row.resume_must_include.map((k) => String(k))
      : undefined,
  };
}
