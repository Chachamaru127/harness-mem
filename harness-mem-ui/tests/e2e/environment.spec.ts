import { expect, test } from "@playwright/test";

const healthResponse = {
  ok: true,
  source: "core",
  items: [
    {
      status: "ok",
      vector_engine: "js-fallback",
      fts_enabled: true,
      counts: { sessions: 3, observations: 12 },
    },
  ],
  meta: { count: 1, latency_ms: 2, filters: {}, ranking: "health_v1" },
};

const projectsResponse = {
  ok: true,
  source: "core",
  items: [{ project: "alpha", observations: 8, sessions: 2, updated_at: "2026-02-14T00:00:00.000Z" }],
  meta: { count: 1, latency_ms: 4, filters: {}, ranking: "projects_stats_v1" },
};

const feedResponse = {
  ok: true,
  source: "core",
  items: [],
  meta: {
    count: 0,
    latency_ms: 5,
    filters: {},
    ranking: "feed_v1",
    next_cursor: null,
    has_more: false,
  },
};

const environmentResponse = {
  ok: true,
  source: "core",
  items: [
    {
      snapshot_id: "env_demo",
      generated_at: "2026-02-23T12:00:00.000Z",
      summary: {
        total: 8,
        ok: 5,
        warning: 2,
        missing: 1,
        servers: 2,
        languages: 2,
        cli_tools: 2,
        ai_tools: 2,
      },
      servers: [
        {
          id: "daemon",
          name: "Harness Memory Daemon",
          description: "Core API",
          status: "ok",
          last_checked_at: "2026-02-23T12:00:00.000Z",
          pid: 12345,
          port: 37888,
          protocol: "http",
          bind_address: "127.0.0.1",
          process_name: "bun",
          message: null,
        },
      ],
      languages: [
        {
          id: "node",
          name: "Node.js",
          description: "runtime",
          status: "ok",
          last_checked_at: "2026-02-23T12:00:00.000Z",
          installed: true,
          version: "v22.10.0",
          message: null,
        },
      ],
      cli_tools: [
        {
          id: "git",
          name: "git",
          description: "cli",
          status: "ok",
          last_checked_at: "2026-02-23T12:00:00.000Z",
          installed: true,
          version: "git version 2.47.0",
          message: null,
        },
      ],
      ai_tools: [
        {
          id: "codex",
          name: "Codex CLI",
          description: "ai",
          status: "warning",
          last_checked_at: "2026-02-23T12:00:00.000Z",
          installed: true,
          version: "codex-cli 0.104.0",
          message: "needs review",
        },
      ],
      errors: [],
    },
  ],
  meta: { count: 1, latency_ms: 3, filters: {}, ranking: "environment_v1" },
};

test.beforeEach(async ({ page }) => {
  await page.route("**/api/health", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(healthResponse) });
  });
  await page.route("**/api/context", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, default_project: "alpha" }),
    });
  });
  await page.route("**/api/projects/stats**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(projectsResponse) });
  });
  await page.route("**/api/feed**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(feedResponse) });
  });
  await page.route("**/api/environment", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(environmentResponse) });
  });
  await page.route("**/api/stream**", async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
      },
      body: 'event: ready\ndata: {"ts":"2026-02-14T00:00:00.000Z"}\n\n',
    });
  });
});

test("switches to Environment tab and shows section cards", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("tab", { name: "Environment" }).click();
  await expect(page.getByText("Environment status")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Internal servers" })).toBeVisible();
  await expect(page.getByText("Node.js")).toBeVisible();
  await expect(page.getByText("Codex CLI")).toBeVisible();
});

test("keeps Environment tab readable in Japanese", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "settings" }).click();
  await page.getByLabel("Language").selectOption("ja");
  await page.getByRole("button", { name: "保存" }).click();

  await page.getByRole("tab", { name: "環境" }).click();
  await expect(page.getByText("環境ステータス")).toBeVisible();
  await expect(page.getByRole("heading", { name: "内部サーバー" })).toBeVisible();
  await expect(page.getByText("非専門家向け FAQ")).toBeVisible();
});
