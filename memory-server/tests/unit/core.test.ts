import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { HarnessMemCore, getConfig, type Config, type EventEnvelope } from "../../src/core/harness-mem-core";
import { removeDirWithRetry } from "../fs-cleanup";

const cleanupPaths: string[] = [];

afterEach(() => {
  while (cleanupPaths.length > 0) {
    const dir = cleanupPaths.pop();
    if (!dir) continue;
    removeDirWithRetry(dir);
  }
});

function createConfig(name: string): Config {
  const dir = mkdtempSync(join(tmpdir(), `harness-mem-${name}-`));
  cleanupPaths.push(dir);
  return {
    dbPath: join(dir, "harness-mem.db"),
    bindHost: "127.0.0.1",
    bindPort: 0,
    vectorDimension: 64,
    captureEnabled: true,
    retrievalEnabled: true,
    injectionEnabled: true,
    codexHistoryEnabled: false,
    codexProjectRoot: process.cwd(),
    codexSessionsRoot: process.cwd(),
    codexIngestIntervalMs: 5000,
    codexBackfillHours: 24,
    opencodeIngestEnabled: false,
    cursorIngestEnabled: false,
    antigravityIngestEnabled: false,
  };
}

function baseEvent(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    platform: "claude",
    project: "test-project",
    session_id: "session-1",
    event_type: "user_prompt",
    ts: "2026-02-14T00:00:00.000Z",
    payload: { prompt: "alpha task" },
    tags: [],
    privacy_tags: [],
    ...overrides,
  };
}

function createFakeRepo(name: string): string {
  const root = mkdtempSync(join(tmpdir(), `${name}-repo-`));
  cleanupPaths.push(root);
  mkdirSync(join(root, ".git"), { recursive: true });
  return root;
}

describe("HarnessMemCore unit", () => {
  test("vector provider falls back when sqlite-vec extension is unavailable", () => {
    const previous = process.env.HARNESS_MEM_SQLITE_VEC_PATH;
    process.env.HARNESS_MEM_SQLITE_VEC_PATH = "/non/existent/sqlite-vec";

    const core = new HarnessMemCore(createConfig("vector-fallback"));
    try {
      const health = core.health();
      const item = health.items[0] as { vector_engine: string };
      expect(item.vector_engine).toBe("js-fallback");
    } finally {
      core.shutdown("test");
      if (previous === undefined) {
        delete process.env.HARNESS_MEM_SQLITE_VEC_PATH;
      } else {
        process.env.HARNESS_MEM_SQLITE_VEC_PATH = previous;
      }
    }
  });

  test("dedupe hash uniqueness is enforced", () => {
    const core = new HarnessMemCore(createConfig("dedupe"));
    try {
      const first = core.recordEvent(baseEvent());
      const second = core.recordEvent(baseEvent());

      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      expect((second.meta as Record<string, unknown>).deduped).toBe(true);

      const health = core.health();
      const counts = (health.items[0] as { counts: { events: number } }).counts;
      expect(counts.events).toBe(1);
    } finally {
      core.shutdown("test");
    }
  });

  test("privacy tags block/private/redact behave correctly", () => {
    const core = new HarnessMemCore(createConfig("privacy"));
    try {
      const blocked = core.recordEvent(
        baseEvent({
          payload: { content: "should not persist" },
          privacy_tags: ["block"],
        })
      );
      expect((blocked.meta as Record<string, unknown>).skipped).toBe(true);

      const privateEvent = core.recordEvent(
        baseEvent({
          event_id: "event-private",
          payload: { content: "private secret phrase" },
          privacy_tags: ["private"],
        })
      );
      expect(privateEvent.ok).toBe(true);

      const redacted = core.recordEvent(
        baseEvent({
          event_id: "event-redact",
          payload: { content: "mail me at alice@example.com api_key=sk_abcdefghijklmnop" },
          privacy_tags: ["redact"],
        })
      );
      const redactedObsId = (redacted.items[0] as { id: string }).id;

      const hiddenSearch = core.search({ query: "private secret phrase", include_private: false });
      for (const item of hiddenSearch.items as Array<{ privacy_tags?: string[] }>) {
        expect((item.privacy_tags || []).includes("private")).toBe(false);
      }

      const visibleSearch = core.search({ query: "private secret phrase", include_private: true });
      expect(visibleSearch.items.length).toBeGreaterThan(0);

      const details = core.getObservations({ ids: [redactedObsId], include_private: true, compact: false });
      const content = (details.items[0] as { content: string }).content;
      expect(content.includes("[REDACTED_EMAIL]")).toBe(true);
      expect(content.includes("[REDACTED_SECRET]")).toBe(true);
    } finally {
      core.shutdown("test");
    }
  });

  test("hybrid ranking includes recency influence", () => {
    const core = new HarnessMemCore(createConfig("ranking"));
    try {
      core.recordEvent(
        baseEvent({
          event_id: "old-event",
          ts: "2025-01-01T00:00:00.000Z",
          payload: { content: "alpha old note" },
        })
      );
      core.recordEvent(
        baseEvent({
          event_id: "new-event",
          ts: "2026-02-14T00:00:00.000Z",
          payload: { content: "alpha new note" },
        })
      );

      const search = core.search({ query: "alpha note", limit: 2, include_private: true });
      const firstId = (search.items[0] as { id: string }).id;
      expect(firstId).toContain("new-event");
    } finally {
      core.shutdown("test");
    }
  });

  test("feed cursor returns stable non-overlapping pages", () => {
    const core = new HarnessMemCore(createConfig("feed-cursor"));
    try {
      for (let i = 0; i < 3; i += 1) {
        core.recordEvent(
          baseEvent({
            event_id: `feed-${i}`,
            ts: `2026-02-14T00:00:0${i}.000Z`,
            payload: { content: `feed item ${i}` },
          })
        );
      }

      const first = core.feed({ project: "test-project", limit: 2, include_private: true });
      expect(first.ok).toBe(true);
      expect(first.items.length).toBe(2);
      const firstIds = new Set((first.items as Array<{ id: string }>).map((item) => item.id));
      const nextCursor = String((first.meta as Record<string, unknown>).next_cursor || "");
      expect(nextCursor.length).toBeGreaterThan(0);

      const second = core.feed({ project: "test-project", limit: 2, cursor: nextCursor, include_private: true });
      expect(second.ok).toBe(true);
      expect(second.items.length).toBeGreaterThanOrEqual(1);
      for (const item of second.items as Array<{ id: string }>) {
        expect(firstIds.has(item.id)).toBe(false);
      }
    } finally {
      core.shutdown("test");
    }
  });

  test("project stats respect include_private filter", () => {
    const core = new HarnessMemCore(createConfig("project-stats-privacy"));
    try {
      core.recordEvent(
        baseEvent({
          event_id: "stats-public",
          payload: { content: "public stats event" },
          privacy_tags: [],
        })
      );
      core.recordEvent(
        baseEvent({
          event_id: "stats-private",
          payload: { content: "private stats event" },
          privacy_tags: ["private"],
        })
      );

      const hidden = core.projectsStats({ include_private: false });
      const visible = core.projectsStats({ include_private: true });
      const hiddenProject = (hidden.items as Array<{ project: string; observations: number }>).find(
        (item) => item.project === "test-project"
      );
      const visibleProject = (visible.items as Array<{ project: string; observations: number }>).find(
        (item) => item.project === "test-project"
      );

      expect(hiddenProject?.observations).toBe(1);
      expect(visibleProject?.observations).toBe(2);
    } finally {
      core.shutdown("test");
    }
  });

  test("project stats hide synthetic and hidden-directory projects", () => {
    const core = new HarnessMemCore(createConfig("project-stats-noise"));
    const hiddenRoot = mkdtempSync(join(tmpdir(), "harness-mem-hidden-project-"));
    cleanupPaths.push(hiddenRoot);
    const hiddenProject = join(hiddenRoot, ".codex");
    mkdirSync(hiddenProject, { recursive: true });
    try {
      core.recordEvent(
        baseEvent({
          event_id: "stats-visible",
          project: "visible-project",
          payload: { content: "visible stats event" },
        })
      );
      core.recordEvent(
        baseEvent({
          event_id: "stats-shadow",
          project: `/shadow-perf-${Date.now()}`,
          payload: { content: "shadow stats event" },
        })
      );
      core.recordEvent(
        baseEvent({
          event_id: "stats-hidden-dir",
          project: hiddenProject,
          payload: { content: "hidden directory stats event" },
        })
      );

      const stats = core.projectsStats({ include_private: true });
      const projects = (stats.items as Array<{ project: string }>).map((item) => item.project);

      expect(projects).toContain("visible-project");
      expect(projects.some((project) => project.includes("shadow-"))).toBe(false);
      expect(projects).not.toContain(hiddenProject);
    } finally {
      core.shutdown("test");
    }
  });

  test("project stats group repo path and scoped projects under canonical repo name", () => {
    const core = new HarnessMemCore(createConfig("project-stats-canonical"));
    const repoRoot = createFakeRepo("grouped-project");
    const repoName = basename(repoRoot) || "grouped-project";
    try {
      core.recordEvent(
        baseEvent({
          event_id: "grouped-repo-path",
          session_id: "grouped-session-path",
          project: repoRoot,
          payload: { content: "repo rooted event" },
        })
      );
      core.recordEvent(
        baseEvent({
          event_id: "grouped-repo-scope",
          session_id: "grouped-session-scope",
          project: `${repoName}::line`,
          payload: { content: "repo scoped event" },
        })
      );

      const stats = core.projectsStats({ include_private: true });
      const grouped = (stats.items as Array<{
        project: string;
        observations: number;
        sessions: number;
        member_projects?: string[];
      }>).find((item) => item.project === repoName);

      expect(grouped).toBeDefined();
      expect(grouped?.observations).toBe(2);
      expect(grouped?.sessions).toBe(2);
      expect((grouped?.member_projects || []).some((project) => project.endsWith(`/${repoName}`))).toBe(true);
      expect(grouped?.member_projects).toContain(`${repoName}::line`);
    } finally {
      core.shutdown("test");
    }
  });

  test("canonical project filter fans out to repo members in feed and search", () => {
    const core = new HarnessMemCore(createConfig("project-filter-canonical"));
    const repoRoot = createFakeRepo("filter-project");
    const repoName = basename(repoRoot) || "filter-project";
    try {
      core.recordEvent(
        baseEvent({
          event_id: "filter-repo-path",
          session_id: "filter-session-path",
          project: repoRoot,
          payload: { content: "shared alpha repo path" },
        })
      );
      core.recordEvent(
        baseEvent({
          event_id: "filter-repo-scope",
          session_id: "filter-session-scope",
          project: `${repoName}::line`,
          payload: { content: "shared alpha repo scope" },
        })
      );

      const feed = core.feed({ project: repoName, limit: 10, include_private: true });
      expect(feed.ok).toBe(true);
      expect(feed.items.length).toBe(2);
      for (const item of feed.items as Array<{ canonical_project?: string }>) {
        expect(item.canonical_project).toBe(repoName);
      }

      const search = core.search({ query: "shared alpha", project: repoName, strict_project: true, include_private: true });
      expect(search.ok).toBe(true);
      const candidateCounts = (search.meta as Record<string, unknown>).candidate_counts as Record<string, unknown>;
      expect(Number(candidateCounts.lexical || 0)).toBe(2);
      expect(Number(candidateCounts.vector || 0)).toBe(2);
    } finally {
      core.shutdown("test");
    }
  });

  test("non-repo absolute paths stay grouped by folder name even when an ancestor has .git", () => {
    const core = new HarnessMemCore(createConfig("non-repo-folder-fallback"));
    const ancestorRoot = mkdtempSync(join(tmpdir(), "ancestor-git-root-"));
    cleanupPaths.push(ancestorRoot);
    mkdirSync(join(ancestorRoot, ".git"), { recursive: true });
    const workspaceOne = join(ancestorRoot, "workspace-one");
    const workspaceTwo = join(ancestorRoot, "workspace-two");
    mkdirSync(workspaceOne, { recursive: true });
    mkdirSync(workspaceTwo, { recursive: true });
    try {
      core.recordEvent(
        baseEvent({
          event_id: "folder-fallback-1",
          project: workspaceOne,
          session_id: "folder-session-1",
          payload: { content: "workspace one note" },
        })
      );
      core.recordEvent(
        baseEvent({
          event_id: "folder-fallback-2",
          project: workspaceTwo,
          session_id: "folder-session-2",
          payload: { content: "workspace two note" },
        })
      );

      const stats = core.projectsStats({ include_private: true });
      const items = stats.items as Array<{ project: string; member_projects?: string[] }>;
      const workspaceOneStats = items.find((item) => item.project === "workspace-one");
      const workspaceTwoStats = items.find((item) => item.project === "workspace-two");
      const ancestorStats = items.find((item) => item.project === basename(ancestorRoot));
      const workspaceOneFeed = core.feed({ project: workspaceOne, limit: 10, include_private: true });

      expect(workspaceOneStats?.member_projects).toHaveLength(1);
      expect(workspaceTwoStats?.member_projects).toHaveLength(1);
      expect((workspaceOneStats?.member_projects || [])[0]?.endsWith("/workspace-one")).toBe(true);
      expect((workspaceTwoStats?.member_projects || [])[0]?.endsWith("/workspace-two")).toBe(true);
      expect(ancestorStats).toBeUndefined();
      expect(workspaceOneFeed.items).toHaveLength(1);
      expect(((workspaceOneFeed.items[0] as { project: string }).project || "").endsWith("/workspace-one")).toBe(true);
    } finally {
      core.shutdown("test");
    }
  });

  test("HARNESS_MEM_VECTOR_DIM supports 1536 and caps at 4096", () => {
    const previous = process.env.HARNESS_MEM_VECTOR_DIM;
    try {
      process.env.HARNESS_MEM_VECTOR_DIM = "1536";
      expect(getConfig().vectorDimension).toBe(1536);

      process.env.HARNESS_MEM_VECTOR_DIM = "99999";
      expect(getConfig().vectorDimension).toBe(4096);
    } finally {
      if (previous === undefined) {
        delete process.env.HARNESS_MEM_VECTOR_DIM;
      } else {
        process.env.HARNESS_MEM_VECTOR_DIM = previous;
      }
    }
  });

  test("workspace boundary: different projects do not mix", () => {
    const core = new HarnessMemCore(createConfig("boundary"));
    try {
      core.recordEvent(baseEvent({ project: "project-a", payload: { prompt: "alpha secret" } }));
      core.recordEvent(baseEvent({ project: "project-b", payload: { prompt: "beta secret" } }));

      const searchA = core.search({ query: "secret", project: "project-a", strict_project: true });
      const searchB = core.search({ query: "secret", project: "project-b", strict_project: true });

      // project-a の検索結果に project-b のデータが混入しないこと
      for (const item of searchA.items as any[]) {
        expect(item.project).toBe("project-a");
      }
      for (const item of searchB.items as any[]) {
        expect(item.project).toBe("project-b");
      }
    } finally {
      core.shutdown("test");
    }
  });

  test("workspace boundary: empty project name is rejected", () => {
    const core = new HarnessMemCore(createConfig("empty-project"));
    try {
      const result = core.recordEvent(baseEvent({ project: "" }));
      expect(result.ok).toBe(false);
    } finally {
      core.shutdown("test");
    }
  });
});
