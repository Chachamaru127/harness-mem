import type { AdapterQueryResult, BenchmarkCase, RetrievalHit } from "../lib/types";

export interface HttpSearchAdapterOptions {
  competitorId: string;
  baseUrl: string;
  token?: string;
  searchPath?: string;
  ingestPath?: string;
  fetchImpl?: typeof fetch;
  projectField?: string;
}

function pickHits(payload: unknown): RetrievalHit[] {
  const body = payload as {
    items?: Array<{ id?: string; content?: string; summary?: string; title?: string; score?: number }>;
    results?: Array<{ id?: string; content?: string; text?: string; score?: number }>;
  };
  const rows = body.items ?? body.results ?? [];
  return rows.map((row, index) => ({
    id: String(row.id ?? `rank-${index + 1}`),
    rank: index + 1,
    content: String(row.content ?? row.text ?? row.summary ?? row.title ?? ""),
    score: typeof row.score === "number" ? row.score : undefined,
  }));
}

export async function httpSearchQuery(
  options: HttpSearchAdapterOptions,
  caseRow: BenchmarkCase,
  project: string,
): Promise<AdapterQueryResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const started = performance.now();
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.token) {
    headers.authorization = `Bearer ${options.token}`;
    headers["x-harness-mem-token"] = options.token;
  }

  const base = options.baseUrl.replace(/\/$/, "");
  const searchPath = options.searchPath ?? "/v1/search";
  const projectField = options.projectField ?? "project";

  const response = await fetchImpl(`${base}${searchPath}`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      query: caseRow.query,
      [projectField]: project,
      include_private: true,
      strict_project: true,
      limit: 10,
    }),
  });

  const latency_ms = performance.now() - started;
  if (!response.ok) {
    return {
      status: "error",
      hits: [],
      latency_ms,
      error: `HTTP ${response.status}`,
    };
  }

  const payload = await response.json();
  return {
    status: "ok",
    hits: pickHits(payload),
    latency_ms,
    metadata: { endpoint: `${base}${searchPath}` },
  };
}

export async function httpIngestMemories(
  options: HttpSearchAdapterOptions,
  caseRow: BenchmarkCase,
  project: string,
): Promise<void> {
  const ingestPath = options.ingestPath;
  if (!ingestPath) return;

  const fetchImpl = options.fetchImpl ?? fetch;
  const base = options.baseUrl.replace(/\/$/, "");
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.token) {
    headers.authorization = `Bearer ${options.token}`;
  }

  for (const memory of caseRow.memories) {
    await fetchImpl(`${base}${ingestPath}`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        project,
        content: memory.content,
        external_id: memory.id,
        metadata: memory.metadata,
      }),
    });
  }
}
