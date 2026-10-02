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

test("Environment tab points to the RouteCLI dashboard", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("tab", { name: "Environment" }).click();
  await expect(page.getByRole("heading", { name: "Environment list moved" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open the RouteCLI dashboard" })).toHaveAttribute(
    "href",
    "http://127.0.0.1:8765/"
  );
});

test("keeps the Environment notice readable in Japanese", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "settings" }).click();
  await page.getByLabel("Language").selectOption("ja");
  await page.getByRole("button", { name: "保存" }).click();

  await page.getByRole("tab", { name: "環境" }).click();
  await expect(page.getByRole("heading", { name: "環境の一覧は RouteCLI へ移りました" })).toBeVisible();
  await expect(page.getByText("harness-mem versions")).toBeVisible();
});
