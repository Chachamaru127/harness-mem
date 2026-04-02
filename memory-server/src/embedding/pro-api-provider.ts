import { spawnSync } from "node:child_process";
import {
  type EmbeddingCacheStats,
  type EmbeddingHealth,
  type EmbeddingProvider,
} from "./types";

const DEFAULT_PRO_API_CACHE_SIZE = 256;
const DEFAULT_PRO_API_TIMEOUT_MS = 5000;

type EmbeddingMode = "query" | "passage";

interface ProApiSyncResponse {
  status: number;
  body: string;
}

interface ProApiProviderOptions {
  dimension: number;
  apiKey?: string;
  apiUrl?: string;
  baseUrl?: string;
  model?: string;
  cacheSize?: number;
  timeoutMs?: number;
  fallback?: EmbeddingProvider;
  fetchImpl?: typeof fetch;
  syncRequestImpl?: (url: string, init: { headers: Record<string, string>; body: string }) => ProApiSyncResponse;
}

function normalizeVector(vector: number[], dimension: number): number[] {
  if (vector.length === dimension) {
    return [...vector];
  }
  if (vector.length > dimension) {
    return vector.slice(0, dimension);
  }
  return [...vector, ...new Array<number>(dimension - vector.length).fill(0)];
}

function parseEmbeddingResponse(payload: unknown): number[] | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const directEmbedding = (payload as { embedding?: unknown }).embedding;
  if (Array.isArray(directEmbedding)) {
    return directEmbedding.filter((value): value is number => typeof value === "number");
  }

  const directEmbeddings = (payload as { embeddings?: unknown }).embeddings;
  if (Array.isArray(directEmbeddings)) {
    const first = directEmbeddings[0];
    if (Array.isArray(first)) {
      return first.filter((value): value is number => typeof value === "number");
    }
  }

  const data = (payload as { data?: unknown }).data;
  if (Array.isArray(data)) {
    const first = data[0];
    if (first && typeof first === "object" && Array.isArray((first as { embedding?: unknown }).embedding)) {
      return (first as { embedding: unknown[] }).embedding.filter(
        (value): value is number => typeof value === "number"
      );
    }
  }

  return null;
}

function buildHeaders(apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
  };
  if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`;
    headers["x-api-key"] = apiKey;
  }
  return headers;
}

function buildBody(text: string, mode: EmbeddingMode, model: string): string {
  return JSON.stringify({
    model,
    input: text,
    text,
    mode,
  });
}

function buildCacheKey(text: string, mode: EmbeddingMode): string {
  return `${mode === "query" ? "q" : "p"}:${text}`;
}

export function createProApiEmbeddingProvider(options: ProApiProviderOptions): EmbeddingProvider {
  const dimension = Math.max(8, Math.floor(options.dimension));
  const apiKey = (options.apiKey || "").trim();
  const apiUrl = (options.apiUrl || options.baseUrl || "").trim();
  const fallback = options.fallback;
  const model = (options.model || "text-embedding-3-large").trim() || "text-embedding-3-large";
  const timeoutMs = Number.isFinite(options.timeoutMs)
    ? Math.max(250, Math.floor(Number(options.timeoutMs)))
    : DEFAULT_PRO_API_TIMEOUT_MS;
  const cacheCapacity = Number.isFinite(options.cacheSize)
    ? Math.max(1, Math.floor(Number(options.cacheSize)))
    : DEFAULT_PRO_API_CACHE_SIZE;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  let cacheHits = 0;
  let cacheMisses = 0;
  let cacheEvictions = 0;
  const embeddingCache = new Map<string, number[]>();
  const inflightComputations = new Map<string, Promise<number[]>>();
  let lastHealth: EmbeddingHealth = {
    status: apiUrl && apiKey ? "healthy" : "degraded",
    details:
      apiUrl && apiKey
        ? `pro api provider initialized: ${model}`
        : !apiUrl
          ? "HARNESS_MEM_PRO_API_URL is not set; pro embeddings unavailable"
          : "HARNESS_MEM_PRO_API_KEY is not set; pro embeddings unavailable",
  };

  function getCachedEmbedding(cacheKey: string): number[] | null {
    const cached = embeddingCache.get(cacheKey);
    if (!cached) {
      cacheMisses += 1;
      return null;
    }
    cacheHits += 1;
    embeddingCache.delete(cacheKey);
    embeddingCache.set(cacheKey, cached);
    return [...cached];
  }

  function setCachedEmbedding(cacheKey: string, embedding: number[]): void {
    if (embeddingCache.has(cacheKey)) {
      embeddingCache.delete(cacheKey);
    }
    embeddingCache.set(cacheKey, [...embedding]);
    while (embeddingCache.size > cacheCapacity) {
      const oldest = embeddingCache.keys().next().value;
      if (typeof oldest !== "string") {
        break;
      }
      embeddingCache.delete(oldest);
      cacheEvictions += 1;
    }
  }

  function ensureConfigured(): void {
    if (!apiUrl) {
      lastHealth = {
        status: "degraded",
        details: "HARNESS_MEM_PRO_API_URL is not set; pro embeddings unavailable",
      };
      throw new Error(lastHealth.details);
    }
    if (!apiKey) {
      lastHealth = {
        status: "degraded",
        details: "HARNESS_MEM_PRO_API_KEY is not set; pro embeddings unavailable",
      };
      throw new Error(lastHealth.details);
    }
  }

  function fallbackEmbedding(text: string): number[] {
    if (!fallback) {
      throw new Error(lastHealth.details);
    }
    return normalizeVector(fallback.embed(text), dimension);
  }

  function parseAndNormalizeEmbedding(rawBody: string): number[] {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      lastHealth = {
        status: "degraded",
        details: "pro api response parse failed",
      };
      throw new Error(lastHealth.details);
    }

    const embedding = parseEmbeddingResponse(parsed);
    if (!embedding || embedding.length === 0) {
      lastHealth = {
        status: "degraded",
        details: "pro api response did not include embedding",
      };
      throw new Error(lastHealth.details);
    }

    lastHealth = {
      status: "healthy",
      details: `pro api embeddings: ${model}`,
    };
    return normalizeVector(embedding, dimension);
  }

  function requestEmbeddingSync(text: string, mode: EmbeddingMode): number[] {
    ensureConfigured();
    const headers = buildHeaders(apiKey);
    const body = buildBody(text, mode, model);

    if (typeof options.syncRequestImpl === "function") {
      const response = options.syncRequestImpl(apiUrl, { headers, body });
      if (response.status < 200 || response.status >= 300) {
        lastHealth = {
          status: "degraded",
          details: `pro api request failed: HTTP ${response.status}`,
        };
        throw new Error(lastHealth.details);
      }
      return parseAndNormalizeEmbedding(response.body);
    }

    const curlArgs = [
      "-sS",
      "-X",
      "POST",
      "--max-time",
      String(Math.ceil(timeoutMs / 1000)),
      apiUrl,
      "-H",
      "content-type: application/json",
      "-H",
      "accept: application/json",
      "-H",
      `authorization: Bearer ${apiKey}`,
      "-H",
      `x-api-key: ${apiKey}`,
      "-d",
      body,
      "-w",
      "\n%{http_code}",
    ];
    const result = spawnSync("curl", curlArgs, { encoding: "utf8" });

    if (result.status !== 0) {
      lastHealth = {
        status: "degraded",
        details: `pro api request failed: ${result.stderr || "unknown error"}`,
      };
      throw new Error(lastHealth.details);
    }

    const stdout = result.stdout || "";
    const splitIndex = stdout.lastIndexOf("\n");
    const responseBody = splitIndex >= 0 ? stdout.slice(0, splitIndex) : stdout;
    const statusText = splitIndex >= 0 ? stdout.slice(splitIndex + 1).trim() : "";
    const status = Number.parseInt(statusText, 10);
    if (!Number.isFinite(status) || status < 200 || status >= 300) {
      lastHealth = {
        status: "degraded",
        details: `pro api request failed: HTTP ${Number.isFinite(status) ? status : "unknown"}`,
      };
      throw new Error(lastHealth.details);
    }

    return parseAndNormalizeEmbedding(responseBody);
  }

  async function requestEmbeddingAsync(text: string, mode: EmbeddingMode): Promise<number[]> {
    ensureConfigured();
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);

    try {
      const response = await fetchImpl(apiUrl, {
        method: "POST",
        headers: buildHeaders(apiKey),
        body: buildBody(text, mode, model),
        signal: controller.signal,
      });
      if (!response.ok) {
        lastHealth = {
          status: "degraded",
          details: `pro api request failed: HTTP ${response.status}`,
        };
        throw new Error(lastHealth.details);
      }
      return parseAndNormalizeEmbedding(await response.text());
    } catch (error) {
      const message =
        error instanceof Error && error.name === "AbortError"
          ? `pro api request timed out after ${timeoutMs}ms`
          : error instanceof Error
            ? error.message
            : String(error);
      lastHealth = {
        status: "degraded",
        details: message,
      };
      throw new Error(message);
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  function embedInternal(text: string, mode: EmbeddingMode): number[] {
    const normalizedText = text || "";
    const cacheKey = buildCacheKey(normalizedText, mode);
    const cached = getCachedEmbedding(cacheKey);
    if (cached) {
      return cached;
    }
    let embedding: number[];
    try {
      embedding = requestEmbeddingSync(normalizedText, mode);
    } catch {
      embedding = fallbackEmbedding(normalizedText);
    }
    setCachedEmbedding(cacheKey, embedding);
    return [...embedding];
  }

  async function primeInternal(text: string, mode: EmbeddingMode): Promise<number[]> {
    const normalizedText = text || "";
    const cacheKey = buildCacheKey(normalizedText, mode);
    const cached = getCachedEmbedding(cacheKey);
    if (cached) {
      return cached;
    }

    const inflight = inflightComputations.get(cacheKey);
    if (inflight) {
      return inflight;
    }

    const running = (async () => {
      let embedding: number[];
      try {
        embedding = await requestEmbeddingAsync(normalizedText, mode);
      } catch {
        embedding = fallbackEmbedding(normalizedText);
      }
      setCachedEmbedding(cacheKey, embedding);
      return [...embedding];
    })();

    inflightComputations.set(cacheKey, running);
    try {
      return await running;
    } finally {
      inflightComputations.delete(cacheKey);
    }
  }

  return {
    name: "pro-api",
    model,
    dimension,
    embed(text: string): number[] {
      return embedInternal(text, "passage");
    },
    embedQuery(text: string): number[] {
      return embedInternal(text, "query");
    },
    async prime(text: string): Promise<number[]> {
      return primeInternal(text, "passage");
    },
    async primeQuery(text: string): Promise<number[]> {
      return primeInternal(text, "query");
    },
    cacheStats(): EmbeddingCacheStats {
      return {
        entries: embeddingCache.size,
        capacity: cacheCapacity,
        hits: cacheHits,
        misses: cacheMisses,
        evictions: cacheEvictions,
        inflight: inflightComputations.size,
      };
    },
    health(): EmbeddingHealth {
      return { ...lastHealth };
    },
  };
}
