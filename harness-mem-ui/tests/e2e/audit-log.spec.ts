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

const auditItems = [
  {
    id: "audit-1",
    created_at: "2026-04-20T12:00:00.000Z",
    action: "read.search",
    actor: "codex-ui",
    target_type: "observation",
    target_id: "obs-visible-123",
    details: { project: "alpha", result_count: 2 },
  },
  {
    id: "audit-2",
    created_at: "2026-04-20T12:01:00.000Z",
    action: "privacy_filter",
    actor: "memory-daemon",
    target_type: "observation",
    target_id: "obs-private-999",
    details: { project: "alpha", reason: "privacy_tag" },
  },
];

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
      body: 'event: ready\ndata: {"ts":"2026-04-20T12:00:00.000Z"}\n\n',
    });
  });
});

test("loads audit log entries and filters them client-side", async ({ page }) => {
  await page.route("**/api/audit-log**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        source: "core",
        items: auditItems,
        meta: { count: auditItems.length, latency_ms: 3, filters: {}, ranking: "audit_log_v1" },
      }),
    });
  });

  await page.goto("/");
  await page.getByRole("tab", { name: "Audit Log" }).click();

  const auditPanel = page.locator(".audit-log-view");
  const auditEntries = page.getByRole("region", { name: "Audit log entries" });

  await expect(page.getByRole("heading", { name: "Audit Log" })).toBeVisible();
  await expect(auditEntries).toBeVisible();
  await expect(auditEntries.getByText("read.search")).toBeVisible();
  await expect(auditEntries.getByText("privacy_filter")).toBeVisible();
  await expect(auditPanel.getByText("2 / 2 entries shown")).toBeVisible();

  await page.getByLabel("Search by actor or target id").fill("private");

  await expect(auditEntries.getByText("read.search")).toBeHidden();
  await expect(auditEntries.getByText("privacy_filter")).toBeVisible();
  await expect(auditPanel.getByText("1 / 2 entries shown")).toBeVisible();
});

test("refreshes audit log with selected action filter", async ({ page }) => {
  const auditRequests: string[] = [];

  await page.route("**/api/audit-log**", async (route) => {
    const url = new URL(route.request().url());
    auditRequests.push(url.toString());
    const action = url.searchParams.get("action");
    const items = action ? auditItems.filter((item) => item.action === action) : auditItems;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        source: "core",
        items,
        meta: { count: items.length, latency_ms: 3, filters: { action }, ranking: "audit_log_v1" },
      }),
    });
  });

  await page.goto("/");
  await page.getByRole("tab", { name: "Audit Log" }).click();
  const auditPanel = page.locator(".audit-log-view");
  const auditEntries = page.getByRole("region", { name: "Audit log entries" });

  await expect(auditPanel.getByText("2 / 2 entries shown")).toBeVisible();

  await page.getByLabel("Filter by action").selectOption("privacy_filter");
  await auditPanel.getByRole("button", { name: "refresh" }).click();

  await expect(auditEntries.getByText("privacy_filter")).toBeVisible();
  await expect(auditEntries.getByText("read.search")).toBeHidden();
  await expect(auditPanel.getByText("1 / 1 entries shown")).toBeVisible();
  expect(auditRequests.some((url) => new URL(url).searchParams.get("action") === "privacy_filter")).toBe(true);
});
