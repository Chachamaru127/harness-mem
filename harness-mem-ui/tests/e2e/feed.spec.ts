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
  items: [
    { project: "alpha", observations: 8, sessions: 2, updated_at: "2026-02-14T00:00:00.000Z" },
    { project: "beta", observations: 4, sessions: 1, updated_at: "2026-02-13T00:00:00.000Z" },
  ],
  meta: { count: 2, latency_ms: 4, filters: {}, ranking: "projects_stats_v1" },
};

const feedResponse = {
  ok: true,
  source: "core",
  items: [
    {
      id: "obs-101",
      event_id: "evt-101",
      platform: "claude",
      project: "alpha",
      session_id: "sess-1",
      event_type: "user_prompt",
      card_type: "user_prompt",
      title: "Initial prompt",
      content: "Need deployment checklist",
      created_at: "2026-02-14T00:00:00.000Z",
      tags: ["deploy"],
      privacy_tags: [],
    },
  ],
  meta: {
    count: 1,
    latency_ms: 5,
    filters: {},
    ranking: "feed_v1",
    next_cursor: null,
    has_more: false,
  },
};

test.beforeEach(async ({ page }) => {
  await page.route("**/api/health", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(healthResponse),
    });
  });

  await page.route("**/api/context", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, default_project: "alpha" }),
    });
  });

  await page.route("**/api/projects/stats**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(projectsResponse),
    });
  });

  await page.route("**/api/feed**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(feedResponse),
    });
  });

  await page.route("**/api/stream**", async (route) => {
    const body = [
      "event: ready",
      'data: {"ts":"2026-02-14T00:00:00.000Z"}',
      "",
    ].join("\n");

    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
      },
      body,
    });
  });
});

test("renders simplified feed", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("Harness Memory Viewer")).toBeVisible();
  await expect(page.getByText("Project memory feed")).toBeVisible();
  await expect(page.getByRole("tab", { name: "Feed" })).toBeVisible();
  await expect(page.getByText("PROMPT", { exact: true })).toBeVisible();
  await expect(page.locator(".platform-chip.claude")).toContainText("Claude Code");
  await expect(page.getByText("Initial prompt")).toBeVisible();
});

test("supports clean project switching", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "beta" }).click();
  await expect(page.getByRole("button", { name: "beta" })).toHaveClass(/active/);
  await expect(page.getByText("Initial prompt")).toBeVisible();
});

test("opens settings modal and saves", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await expect(dialog).toBeVisible();

  await page.getByLabel("Theme").selectOption("dark");
  await page.getByRole("spinbutton", { name: "Observations" }).fill("25");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(dialog).toBeHidden();
});

test("switches to japanese mode", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await expect(dialog).toBeVisible();

  await page.getByLabel("Language").selectOption("ja");
  await page.getByRole("button", { name: "保存" }).click();

  await expect(page.getByText("Harness メモリビューア")).toBeVisible();
  await expect(page.getByRole("button", { name: "設定" })).toBeVisible();
});
