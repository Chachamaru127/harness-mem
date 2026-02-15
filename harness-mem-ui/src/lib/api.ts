import type { ApiResponse, FeedItem, ProjectsStatsItem, UiContext } from "./types";

async function parseJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text.trim()) {
    throw new Error("empty response");
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`invalid JSON response (${response.status}): ${text.slice(0, 120)}`);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const parsed = await parseJson<T>(response);
  if (!response.ok) {
    throw new Error(`request failed: ${response.status}`);
  }
  return parsed;
}

export async function fetchFeed(params: {
  cursor?: string;
  project?: string;
  limit?: number;
  includePrivate?: boolean;
  type?: string;
}): Promise<ApiResponse<FeedItem>> {
  const query = new URLSearchParams();
  if (params.cursor) query.set("cursor", params.cursor);
  if (params.project) query.set("project", params.project);
  if (params.type) query.set("type", params.type);
  if (typeof params.limit === "number") query.set("limit", String(params.limit));
  if (typeof params.includePrivate === "boolean") query.set("include_private", params.includePrivate ? "true" : "false");
  return request<ApiResponse<FeedItem>>(`/api/feed?${query.toString()}`);
}

export async function fetchProjectsStats(includePrivate: boolean): Promise<ApiResponse<ProjectsStatsItem>> {
  return request<ApiResponse<ProjectsStatsItem>>(`/api/projects/stats?include_private=${includePrivate ? "true" : "false"}`);
}

export async function fetchHealth(): Promise<ApiResponse<Record<string, unknown>>> {
  return request<ApiResponse<Record<string, unknown>>>("/api/health");
}

export async function fetchMetrics(): Promise<ApiResponse<Record<string, unknown>>> {
  return request<ApiResponse<Record<string, unknown>>>("/api/metrics");
}

export async function fetchUiContext(): Promise<UiContext> {
  return request<UiContext>("/api/context");
}

export async function runSearch(payload: Record<string, unknown>): Promise<ApiResponse<Record<string, unknown>>> {
  return request<ApiResponse<Record<string, unknown>>>("/api/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function runTimeline(payload: Record<string, unknown>): Promise<ApiResponse<Record<string, unknown>>> {
  return request<ApiResponse<Record<string, unknown>>>("/api/timeline", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function runObservations(payload: Record<string, unknown>): Promise<ApiResponse<Record<string, unknown>>> {
  return request<ApiResponse<Record<string, unknown>>>("/api/observations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function runResume(payload: Record<string, unknown>): Promise<ApiResponse<Record<string, unknown>>> {
  return request<ApiResponse<Record<string, unknown>>>("/api/resume", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function fetchSessionsList(params: {
  project?: string;
  limit?: number;
  includePrivate?: boolean;
}): Promise<ApiResponse<Record<string, unknown>>> {
  const query = new URLSearchParams();
  if (params.project) query.set("project", params.project);
  if (typeof params.limit === "number") query.set("limit", String(params.limit));
  if (typeof params.includePrivate === "boolean") query.set("include_private", params.includePrivate ? "true" : "false");
  return request<ApiResponse<Record<string, unknown>>>(`/api/sessions/list?${query.toString()}`);
}

export async function fetchSessionThread(params: {
  sessionId: string;
  project?: string;
  limit?: number;
  includePrivate?: boolean;
}): Promise<ApiResponse<Record<string, unknown>>> {
  const query = new URLSearchParams();
  query.set("session_id", params.sessionId);
  if (params.project) query.set("project", params.project);
  if (typeof params.limit === "number") query.set("limit", String(params.limit));
  if (typeof params.includePrivate === "boolean") query.set("include_private", params.includePrivate ? "true" : "false");
  return request<ApiResponse<Record<string, unknown>>>(`/api/sessions/thread?${query.toString()}`);
}

export async function fetchSearchFacets(params: {
  query?: string;
  project?: string;
  includePrivate?: boolean;
}): Promise<ApiResponse<Record<string, unknown>>> {
  const query = new URLSearchParams();
  if (params.query) query.set("query", params.query);
  if (params.project) query.set("project", params.project);
  if (typeof params.includePrivate === "boolean") query.set("include_private", params.includePrivate ? "true" : "false");
  return request<ApiResponse<Record<string, unknown>>>(`/api/search/facets?${query.toString()}`);
}
