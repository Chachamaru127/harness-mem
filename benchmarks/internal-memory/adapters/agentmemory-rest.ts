import type { AdapterQueryResult, BenchmarkCase, RetrievalHit } from "../lib/types";

export interface AgentmemoryRestConfig {
  baseUrl: string;
  secret?: string;
  fetchImpl?: typeof fetch;
  agentId?: string;
}

const DEFAULT_BASE_URL = "http://127.0.0.1:3111";

export function resolveAgentmemoryConfig(): { baseUrl: string; secret?: string } {
  const raw = process.env.AGENTMEMORY_URL?.trim() || DEFAULT_BASE_URL;
  const baseUrl = raw.replace(/\/$/, "");
  assertLocalhostOnly(baseUrl);
  const secret = process.env.AGENTMEMORY_SECRET?.trim() || undefined;
  return { baseUrl, secret };
}

export function assertLocalhostOnly(baseUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error(`AGENTMEMORY_URL is not a valid URL: ${baseUrl}`);
  }
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(
      `AGENTMEMORY_URL must be localhost-only for internal benchmark live runs (got ${host})`,
    );
  }
}

function authHeaders(secret?: string): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret) {
    headers.authorization = `Bearer ${secret}`;
  }
  return headers;
}

export async function agentmemoryHealthCheck(config: AgentmemoryRestConfig): Promise<boolean> {
  const fetchImpl = config.fetchImpl ?? fetch;
  const response = await fetchImpl(`${config.baseUrl}/agentmemory/health`, {
    method: "GET",
    headers: authHeaders(config.secret),
  });
  return response.ok;
}

export function normalizeAgentmemoryHits(payload: unknown): RetrievalHit[] {
  const body = payload as {
    items?: Array<Record<string, unknown>>;
    results?: Array<Record<string, unknown>>;
    memories?: Array<Record<string, unknown>>;
  };
  const rows = body.items ?? body.results ?? body.memories ?? [];
  return rows.map((row, index) => ({
    id: String(row.id ?? row.memory_id ?? row.memoryId ?? `rank-${index + 1}`),
    rank: index + 1,
    content: String(row.content ?? row.text ?? row.summary ?? row.title ?? ""),
    score: typeof row.score === "number" ? row.score : undefined,
  }));
}

export async function agentmemoryRememberMemories(
  config: AgentmemoryRestConfig,
  caseRow: BenchmarkCase,
  project: string,
): Promise<void> {
  const fetchImpl = config.fetchImpl ?? fetch;
  const headers = authHeaders(config.secret);
  const agentId = config.agentId ?? "internal-memory-bench";

  for (const memory of caseRow.memories) {
    const response = await fetchImpl(`${config.baseUrl}/agentmemory/remember`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        project,
        title: memory.id,
        content: memory.content,
        agentId,
        metadata: {
          external_id: memory.id,
          benchmark_case_id: caseRow.case_id,
          ...(memory.metadata ?? {}),
        },
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `agentmemory remember failed: HTTP ${response.status}${detail ? ` — ${detail.slice(0, 200)}` : ""}`,
      );
    }
  }
}

export async function agentmemorySmartSearch(
  config: AgentmemoryRestConfig,
  caseRow: BenchmarkCase,
  project: string,
): Promise<AdapterQueryResult> {
  const fetchImpl = config.fetchImpl ?? fetch;
  const started = performance.now();
  const response = await fetchImpl(`${config.baseUrl}/agentmemory/smart-search`, {
    method: "POST",
    headers: authHeaders(config.secret),
    body: JSON.stringify({
      project,
      query: caseRow.query,
      limit: 10,
    }),
  });
  const latency_ms = performance.now() - started;

  if (response.status === 401 || response.status === 403) {
    return {
      status: "error",
      hits: [],
      latency_ms,
      error: `HTTP ${response.status} (check AGENTMEMORY_SECRET)`,
    };
  }

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
    hits: normalizeAgentmemoryHits(payload),
    latency_ms,
    metadata: { endpoint: `${config.baseUrl}/agentmemory/smart-search` },
  };
}
