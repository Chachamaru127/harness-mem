import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

const UI_PORT = Number(process.env.HARNESS_MEM_UI_PORT || 37901);
const MEM_HOST = process.env.HARNESS_MEM_HOST || "127.0.0.1";
const MEM_PORT = process.env.HARNESS_MEM_PORT || "37888";
const MEM_BASE = `http://${MEM_HOST}:${MEM_PORT}`;
const ADMIN_TOKEN = (process.env.HARNESS_MEM_ADMIN_TOKEN || "").trim();
const DEFAULT_PROJECT = detectDefaultProject();
const DEFAULT_PROJECTS_STATS_PROXY_TIMEOUT_MS = 1_500;

const staticDir = join(import.meta.dir, "static-parity");
const staticIndexPath = join(staticDir, "index.html");
let lastProjectsStatsJson: string | null = null;

if (!existsSync(staticIndexPath)) {
  throw new Error(
    `UI static bundle missing: ${staticIndexPath}. Run 'bun run --cwd harness-mem-ui build:web' before starting the UI server.`
  );
}

function detectDefaultProject(): string | null {
  const fromEnv = (process.env.HARNESS_MEM_UI_DEFAULT_PROJECT || "").trim();
  if (fromEnv.length > 0) {
    return fromEnv;
  }

  try {
    const result = Bun.spawnSync({
      cmd: ["git", "rev-parse", "--show-toplevel"],
      cwd: import.meta.dir,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.exitCode !== 0) {
      const fallback = basename(join(import.meta.dir, "..", ".."));
      return fallback || null;
    }
    const root = Buffer.from(result.stdout).toString("utf-8").trim();
    if (!root) {
      const fallback = basename(join(import.meta.dir, "..", ".."));
      return fallback || null;
    }
    return basename(root);
  } catch {
    const fallback = basename(join(import.meta.dir, "..", ".."));
    return fallback || null;
  }
}

function contentType(path: string): string {
  if (path.endsWith(".html")) return "text/html; charset=utf-8";
  if (path.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (path.endsWith(".css")) return "text/css; charset=utf-8";
  if (path.endsWith(".json")) return "application/json; charset=utf-8";
  if (path.endsWith(".svg")) return "image/svg+xml";
  return "text/plain; charset=utf-8";
}

function safePathname(pathname: string): string {
  const decoded = decodeURIComponent(pathname);
  if (decoded.includes("..")) {
    return "";
  }
  return decoded;
}

function projectsStatsProxyTimeoutMs(): number {
  const raw = Number(process.env.HARNESS_MEM_UI_PROJECTS_STATS_TIMEOUT_MS || DEFAULT_PROJECTS_STATS_PROXY_TIMEOUT_MS);
  if (!Number.isFinite(raw)) {
    return DEFAULT_PROJECTS_STATS_PROXY_TIMEOUT_MS;
  }
  return Math.max(250, Math.min(8_000, Math.floor(raw)));
}

async function proxyJson(
  path: string,
  method: "GET" | "POST",
  body?: Record<string, unknown>,
  options: { timeoutMs?: number } = {}
): Promise<Response> {
  const controller = typeof options.timeoutMs === "number" ? new AbortController() : null;
  const timer = controller && typeof options.timeoutMs === "number"
    ? setTimeout(() => controller.abort(), options.timeoutMs)
    : null;
  try {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (path.startsWith("/v1/admin/") && ADMIN_TOKEN) {
      headers["x-harness-mem-token"] = ADMIN_TOKEN;
    }

    const response = await fetch(`${MEM_BASE}${path}`, {
      method,
      headers,
      body: method === "POST" ? JSON.stringify(body || {}) : undefined,
      signal: controller?.signal,
    });
    const text = await response.text();
    const contentTypeHeader = (response.headers.get("content-type") || "").toLowerCase();
    if (!contentTypeHeader.includes("application/json")) {
      const fallback = JSON.stringify({
        ok: false,
        source: "core",
        items: [],
        meta: {
          count: 0,
          latency_ms: 0,
          filters: {},
          ranking: "proxy_v1",
        },
        error: `upstream returned non-json (${response.status}): ${text.slice(0, 200)}`,
      });
      return new Response(fallback, {
        status: response.ok ? 502 : response.status,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    }

    return new Response(text, {
      status: response.status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  } catch (errorInput) {
    const message = errorInput instanceof Error ? errorInput.message : String(errorInput);
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 502,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function jsonResponseFromText(text: string, status = 200): Response {
  return new Response(text, {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function withDefaultProjectScope(path: string): string {
  const scoped = new URL(path, "http://harness-mem.local");
  const project = scoped.searchParams.get("project");
  if ((!project || project.trim().length === 0) && DEFAULT_PROJECT) {
    scoped.searchParams.set("project", DEFAULT_PROJECT);
  }
  return `${scoped.pathname}${scoped.search}`;
}

function fallbackProjectsStatsJson(upstreamStatus: number, upstreamText: string): string {
  if (!DEFAULT_PROJECT) {
    return upstreamText;
  }
  return JSON.stringify({
    ok: true,
    source: "core",
    items: [
      {
        project: DEFAULT_PROJECT,
        canonical_project: basename(DEFAULT_PROJECT),
        observations: 0,
        sessions: 0,
        updated_at: null,
        member_projects: [DEFAULT_PROJECT],
        stale: true,
      },
    ],
    meta: {
      count: 1,
      latency_ms: 0,
      sla_latency_ms: 200,
      filters: {
        project: DEFAULT_PROJECT,
        stale: true,
      },
      ranking: "projects_stats_stale_fallback_v1",
      stale: true,
      upstream_status: upstreamStatus,
      upstream_error: upstreamText.slice(0, 200),
    },
  });
}

async function proxyProjectsStats(path: string): Promise<Response> {
  const upstream = await proxyJson(withDefaultProjectScope(path), "GET", undefined, {
    timeoutMs: projectsStatsProxyTimeoutMs(),
  });
  const text = await upstream.text();
  if (upstream.ok) {
    lastProjectsStatsJson = text;
    return jsonResponseFromText(text, upstream.status);
  }
  if (lastProjectsStatsJson) {
    return jsonResponseFromText(lastProjectsStatsJson);
  }
  if (DEFAULT_PROJECT) {
    return jsonResponseFromText(fallbackProjectsStatsJson(upstream.status, text));
  }
  return jsonResponseFromText(text, upstream.status);
}

async function proxyStream(path: string, request: Request): Promise<Response> {
  try {
    const upstream = await fetch(`${MEM_BASE}${path}`, {
      method: "GET",
      headers: {
        "cache-control": "no-store",
        "last-event-id": request.headers.get("last-event-id") || "",
      },
    });

    const contentType = upstream.headers.get("content-type") || "";
    if (!upstream.ok || !contentType.toLowerCase().includes("text/event-stream")) {
      const upstreamText = await upstream.text();
      return new Response(
        `event: error\ndata: ${JSON.stringify({
          message: `upstream stream unavailable (${upstream.status})`,
          body: upstreamText.slice(0, 200),
        })}\n\n`,
        {
          status: 200,
          headers: {
            "content-type": "text/event-stream; charset=utf-8",
            "cache-control": "no-store",
            connection: "keep-alive",
          },
        }
      );
    }

    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "content-type": contentType || "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        connection: "keep-alive",
      },
    });
  } catch (errorInput) {
    const message = errorInput instanceof Error ? errorInput.message : String(errorInput);
    return new Response(`event: error\ndata: ${JSON.stringify({ message })}\n\n`, {
      status: 502,
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }
}

async function parseBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const parsed = await request.json();
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignored
  }
  return {};
}

const server = Bun.serve({
  port: UI_PORT,
  idleTimeout: 255,
  fetch: async (request: Request): Promise<Response> => {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return proxyJson("/health", "GET");
    }
    if (url.pathname === "/api/context") {
      return new Response(
        JSON.stringify({
          ok: true,
          default_project: DEFAULT_PROJECT,
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
          },
        }
      );
    }
    if (url.pathname === "/api/metrics") {
      return proxyJson("/v1/admin/metrics", "GET");
    }
    if (url.pathname === "/api/environment") {
      return proxyJson("/v1/admin/environment", "GET");
    }
    if (url.pathname === "/api/feed") {
      return proxyJson(withDefaultProjectScope(`/v1/feed${url.search || ""}`), "GET");
    }
    if (url.pathname === "/api/projects/stats") {
      return proxyProjectsStats(`/v1/projects/stats${url.search || ""}`);
    }
    if (url.pathname === "/api/stream") {
      return proxyStream(`/v1/stream${url.search || ""}`, request);
    }
    if (url.pathname === "/api/sessions/list") {
      return proxyJson(`/v1/sessions/list${url.search || ""}`, "GET");
    }
    if (url.pathname === "/api/sessions/thread") {
      return proxyJson(`/v1/sessions/thread${url.search || ""}`, "GET");
    }
    if (url.pathname === "/api/search/facets") {
      return proxyJson(`/v1/search/facets${url.search || ""}`, "GET");
    }
    if (url.pathname === "/api/search" && request.method === "POST") {
      return proxyJson("/v1/search", "POST", await parseBody(request));
    }
    if (url.pathname === "/api/timeline" && request.method === "POST") {
      return proxyJson("/v1/timeline", "POST", await parseBody(request));
    }
    if (url.pathname === "/api/observations" && request.method === "POST") {
      return proxyJson("/v1/observations/get", "POST", await parseBody(request));
    }
    if (url.pathname === "/api/resume" && request.method === "POST") {
      return proxyJson("/v1/resume-pack", "POST", await parseBody(request));
    }
    if (url.pathname === "/api/audit-log" && request.method === "GET") {
      return proxyJson(`/v1/admin/audit-log${url.search || ""}`, "GET");
    }
    // V5-001: サブグラフ取得（認証不要）
    if (url.pathname === "/api/graph" && request.method === "GET") {
      return proxyJson(`/v1/graph${url.search || ""}`, "GET");
    }
    if (url.pathname === "/api/work/query" && request.method === "GET") {
      return proxyJson(`/v1/work/query${url.search || ""}`, "GET");
    }

    const safePath = safePathname(url.pathname);
    if (!safePath) {
      return new Response("Bad Request", { status: 400 });
    }

    const requestedPath = safePath === "/" ? "index.html" : safePath.slice(1);
    const fullPath = join(staticDir, requestedPath);

    if (existsSync(fullPath)) {
      const content = readFileSync(fullPath);
      return new Response(content, {
        headers: { "content-type": contentType(fullPath) },
      });
    }

    const content = readFileSync(staticIndexPath);
    return new Response(content, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  },
});

const keepAlive = setInterval(() => {}, 2_147_483_647);

function shutdown() {
  clearInterval(keepAlive);
  server.stop(true);
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

console.log(`harness-mem-ui running on ${server.url.href} (static=${staticDir})`);
