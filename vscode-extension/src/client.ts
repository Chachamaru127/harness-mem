/**
 * harness-mem HTTP Client for VS Code Extension
 *
 * Minimal HTTP client (no external dependencies) for calling the harness-mem API.
 * Based on @harness-mem/sdk but bundled inline to avoid VSIX dependency issues.
 */

export interface SearchItem {
  id: string;
  title?: string;
  content: string;
  created_at?: string;
  tags?: string[];
  scores?: { final: number };
}

export interface ObservationItem {
  id: string;
  title?: string;
  content: string;
  created_at?: string;
}

export interface ApiResponse<T = unknown> {
  ok: boolean;
  items: T[];
  meta: Record<string, unknown>;
  error?: string;
}

export class HarnessMemApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly timeout: number = 8000
  ) {}

  async search(params: {
    query: string;
    project?: string;
    limit?: number;
    include_private?: boolean;
    exclude_updated?: boolean;
  }): Promise<ApiResponse<SearchItem>> {
    return this.post<SearchItem>("/v1/search", params);
  }

  async timeline(params: {
    id: string;
    before?: number;
    after?: number;
    include_private?: boolean;
  }): Promise<ApiResponse<ObservationItem>> {
    return this.post<ObservationItem>("/v1/timeline", params);
  }

  async health(): Promise<ApiResponse<Record<string, unknown>>> {
    return this.get<Record<string, unknown>>("/v1/health");
  }

  private async post<T>(path: string, body: unknown): Promise<ApiResponse<T>> {
    return this.request<T>("POST", path, body);
  }

  private async get<T>(path: string): Promise<ApiResponse<T>> {
    return this.request<T>("GET", path);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const resp = await fetch(url, {
        method,
        headers: body ? { "content-type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const data = await resp.json() as ApiResponse<T>;
      return data;
    } catch (err) {
      return {
        ok: false,
        items: [],
        meta: {},
        error: (err as Error).name === "AbortError"
          ? `Request timed out after ${this.timeout}ms`
          : String(err),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
