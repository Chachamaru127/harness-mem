import { createHash } from "node:crypto";

const DEFAULT_OLLAMA_HOST = "http://127.0.0.1:11434";
const DEFAULT_MODEL = "qwen3.5:9b";
const DEFAULT_TIMEOUT_MS = 1_200;
const MAX_QUERY_CHARS = 480;
const MAX_ADDED_TOKENS = 24;
const QUERY_REWRITE_STOPWORDS = new Set([
  "the", "user", "asking", "about", "they", "want", "with", "just", "query",
  "first", "need", "understand", "really", "looking", "for", "since", "this",
  "that", "which", "what", "when", "where", "maybe", "however", "return",
  "json", "format", "compact", "only", "okay", "wait", "refers", "means",
]);

export interface QueryRewriteResult {
  originalQuery: string;
  query: string;
  enabled: boolean;
  applied: boolean;
  provider: "ollama";
  model: string;
  latencyMs: number;
  addedTokenCount: number;
  originalQueryHash: string;
  rewrittenQueryHash?: string;
  degradedReason?: string;
}

export interface QueryRewriteOptions {
  safeMode?: boolean;
  fetchImpl?: typeof fetch;
}

function envFlag(name: string): boolean {
  const raw = process.env[name];
  if (raw === undefined) return false;
  return /^(1|true|yes|on)$/i.test(raw.trim());
}

function sha256Short(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function resolveTimeoutMs(): number {
  const parsed = Number(process.env.HARNESS_MEM_QUERY_REWRITE_TIMEOUT_MS || "");
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(5_000, Math.max(100, Math.floor(parsed)));
}

function normalizeHost(): string {
  return (process.env.HARNESS_MEM_QUERY_REWRITE_OLLAMA_HOST || process.env.HARNESS_MEM_OLLAMA_HOST || DEFAULT_OLLAMA_HOST)
    .trim()
    .replace(/\/+$/, "");
}

function isLoopbackHost(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1")
    );
  } catch {
    return false;
  }
}

function parseRewrite(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      if (typeof record.query === "string") return record.query.trim();
      if (Array.isArray(record.queries)) {
        return record.queries.filter((q): q is string => typeof q === "string").join(" ").trim();
      }
      if (Array.isArray(record.expansions)) {
        return record.expansions.filter((q): q is string => typeof q === "string").join(" ").trim();
      }
    }
  } catch {
    // Ollama JSON mode can still return a quoted fragment in older models; fall through.
  }
  return trimmed.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
}

function tokenizeForMerge(value: string): string[] {
  return value
    .normalize("NFKC")
    .split(/[^\p{L}\p{N}_#./:-]+/u)
    .map((token) => token.trim())
    .filter((token) => {
      if (token.length === 0 || token.length > 80) return false;
      if (QUERY_REWRITE_STOPWORDS.has(token.toLowerCase())) return false;
      return true;
    });
}

function mergeQueries(original: string, rewrite: string): { query: string; addedTokenCount: number } {
  const originalTokens = new Set(tokenizeForMerge(original).map((token) => token.toLowerCase()));
  const added: string[] = [];
  for (const token of tokenizeForMerge(rewrite)) {
    const key = token.toLowerCase();
    if (originalTokens.has(key)) continue;
    originalTokens.add(key);
    added.push(token);
    if (added.length >= MAX_ADDED_TOKENS) break;
  }
  if (added.length === 0) {
    return { query: original.trim(), addedTokenCount: 0 };
  }
  const query = `${original.trim()} ${added.join(" ")}`.replace(/\s+/g, " ").slice(0, MAX_QUERY_CHARS).trim();
  return { query, addedTokenCount: added.length };
}

function baseResult(originalQuery: string, model: string, startedAt: number): QueryRewriteResult {
  return {
    originalQuery,
    query: originalQuery,
    enabled: envFlag("HARNESS_MEM_QUERY_REWRITE"),
    applied: false,
    provider: "ollama",
    model,
    latencyMs: Math.round((performance.now() - startedAt) * 100) / 100,
    addedTokenCount: 0,
    originalQueryHash: sha256Short(originalQuery),
  };
}

export async function rewriteSearchQueryIfEnabled(
  query: string,
  options: QueryRewriteOptions = {},
): Promise<QueryRewriteResult> {
  const startedAt = performance.now();
  const originalQuery = query.trim();
  const model = (process.env.HARNESS_MEM_QUERY_REWRITE_MODEL || process.env.HARNESS_MEM_FACT_LLM_MODEL || DEFAULT_MODEL).trim();
  const result = baseResult(originalQuery, model, startedAt);
  if (!result.enabled) return result;
  if (options.safeMode) {
    return { ...result, degradedReason: "safe_mode" };
  }
  if (!originalQuery) {
    return { ...result, degradedReason: "empty_query" };
  }

  const endpoint = normalizeHost();
  if (!isLoopbackHost(endpoint)) {
    return { ...result, degradedReason: "non_loopback_ollama_host" };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), resolveTimeoutMs());
  try {
    const response = await (options.fetchImpl || fetch)(`${endpoint}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        format: "json",
        options: { temperature: 0, num_predict: 128 },
        messages: [
          {
            role: "system",
            content:
              "/no_think\nRewrite the user search query for retrieval only. Return compact JSON {\"query\":\"...\"}. Keep code identifiers and proper nouns. Add English and Japanese synonyms when useful. Do not answer the question.",
          },
          { role: "user", content: `/no_think\n${originalQuery}` },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ...result, degradedReason: `ollama_http_${response.status}` };
    }
    const parsed = await response.json() as { message?: { content?: unknown; thinking?: unknown } };
    const content =
      typeof parsed.message?.content === "string" && parsed.message.content.trim()
        ? parsed.message.content
        : typeof parsed.message?.thinking === "string"
          ? parsed.message.thinking
          : "";
    if (!content.trim()) {
      const latencyMs = Math.round((performance.now() - startedAt) * 100) / 100;
      return { ...result, latencyMs, degradedReason: "empty_content" };
    }
    const rewrite = parseRewrite(content);
    const merged = mergeQueries(originalQuery, rewrite);
    const latencyMs = Math.round((performance.now() - startedAt) * 100) / 100;
    if (merged.addedTokenCount === 0 || merged.query === originalQuery) {
      return { ...result, latencyMs, degradedReason: "no_added_terms" };
    }
    return {
      ...result,
      query: merged.query,
      applied: true,
      latencyMs,
      addedTokenCount: merged.addedTokenCount,
      rewrittenQueryHash: sha256Short(merged.query),
    };
  } catch (error) {
    const latencyMs = Math.round((performance.now() - startedAt) * 100) / 100;
    const name = error instanceof Error && error.name ? error.name : "error";
    return { ...result, latencyMs, degradedReason: `ollama_${name}` };
  } finally {
    clearTimeout(timeoutId);
  }
}

export function queryRewriteMeta(result: QueryRewriteResult): Record<string, unknown> {
  return {
    enabled: result.enabled,
    applied: result.applied,
    provider: result.provider,
    model: result.model,
    latency_ms: result.latencyMs,
    added_token_count: result.addedTokenCount,
    original_query_hash: result.originalQueryHash,
    rewritten_query_hash: result.rewrittenQueryHash ?? null,
    degraded_reason: result.degradedReason ?? null,
  };
}
