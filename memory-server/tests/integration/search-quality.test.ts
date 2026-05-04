import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HarnessMemCore, type ApiResponse, type Config, type EventEnvelope } from "../../src/core/harness-mem-core";
import { removeDirWithRetry } from "../fs-cleanup";

function createCore(name: string): { core: HarnessMemCore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), `harness-mem-search-${name}-`));
  const config: Config = {
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
  return { core: new HarnessMemCore(config), dir };
}

function makeEvent(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    platform: "codex",
    project: "search-quality",
    session_id: "sq-session-1",
    event_type: "user_prompt",
    ts: "2026-02-14T00:00:00.000Z",
    payload: { content: "default event content" },
    tags: ["quality"],
    privacy_tags: [],
    ...overrides,
  };
}

function asItems(response: ApiResponse): Array<Record<string, unknown>> {
  return response.items as Array<Record<string, unknown>>;
}

const IS_WINDOWS_SHELL =
  process.platform === "win32" || /^(msys|mingw|cygwin)/i.test(process.env.OSTYPE ?? "");
const MEDIUM_CORPUS_LATENCY_BUDGET_MS = process.env.CI === "true" ? 1500 : IS_WINDOWS_SHELL ? 900 : 500;

describe("search quality integration", () => {
  test("hybrid scoring formula remains consistent and recency affects rank", () => {
    const { core, dir } = createCore("scoring");
    try {
      core.recordEvent(
        makeEvent({
          event_id: "sq-old",
          ts: "2025-01-01T00:00:00.000Z",
          payload: { content: "release checklist automation baseline" },
        })
      );
      core.recordEvent(
        makeEvent({
          event_id: "sq-new",
          ts: "2026-02-14T00:00:00.000Z",
          payload: { content: "release checklist automation baseline" },
        })
      );

      const result = core.search({
        query: "release checklist automation baseline",
        project: "search-quality",
        limit: 5,
        include_private: true,
      });

      expect(result.ok).toBe(true);
      const items = asItems(result);
      expect(items.length).toBeGreaterThanOrEqual(2);
      expect(String(items[0].id)).toContain("sq-new");
      expect((result.meta as Record<string, unknown>).latest_interaction).toBeDefined();

      // RQ-006: RRF 実装後は rank-based スコアのため、固定ウェイトによる再計算は不適切。
      // final スコアが正の値であることと decay_tier が設定されていることを確認する。
      for (const item of items) {
        const scores = (item.scores || {}) as Record<string, unknown>;
        const final = Number(scores.final ?? 0);
        expect(final).toBeGreaterThan(0);
        const decayTier = (item as Record<string, unknown>).decay_tier as string | undefined;
        expect(["hot", "warm", "cold"]).toContain(decayTier);
      }
    } finally {
      core.shutdown("test");
      removeDirWithRetry(dir);
    }
  });

  test("generic recent query prioritizes latest project interaction across CLIs", () => {
    const { core, dir } = createCore("latest-interaction");
    try {
      core.recordEvent(
        makeEvent({
          event_id: "latest-codex-prompt",
          platform: "codex",
          session_id: "codex-session",
          ts: "2026-02-14T00:00:00.000Z",
          payload: { content: "older codex prompt" },
        })
      );
      core.recordEvent(
        makeEvent({
          event_id: "latest-codex-response",
          platform: "codex",
          session_id: "codex-session",
          event_type: "checkpoint",
          ts: "2026-02-14T00:01:00.000Z",
          payload: { title: "assistant_response", content: "older codex answer" },
        })
      );
      core.recordEvent(
        makeEvent({
          event_id: "latest-claude-prompt",
          platform: "claude",
          session_id: "claude-session",
          ts: "2026-02-14T00:02:00.000Z",
          payload: { content: "latest claude prompt" },
        })
      );
      core.recordEvent(
        makeEvent({
          event_id: "latest-claude-response",
          platform: "claude",
          session_id: "claude-session",
          event_type: "checkpoint",
          ts: "2026-02-14T00:03:00.000Z",
          payload: { title: "assistant_response", content: "latest claude answer" },
        })
      );

      const result = core.search({
        query: "直近を調べて",
        project: "search-quality",
        limit: 5,
        include_private: true,
      });

      expect(result.ok).toBe(true);
      const meta = result.meta as Record<string, unknown>;
      const latestInteraction = meta.latest_interaction as Record<string, unknown>;
      expect(latestInteraction).toBeDefined();
      expect(latestInteraction.platform).toBe("claude");
      expect(latestInteraction.session_id).toBe("claude-session");
      expect((latestInteraction.prompt as Record<string, unknown>).content).toBe("latest claude prompt");
      expect((latestInteraction.response as Record<string, unknown>).content).toBe("latest claude answer");

      const items = asItems(result);
      expect(String(items[0]?.content || "")).toContain("latest claude answer");
      expect(String(items[1]?.content || "")).toContain("latest claude prompt");
    } finally {
      core.shutdown("test");
      removeDirWithRetry(dir);
    }
  });

  test("latest interaction ignores wrapper prompts and prefers the latest completed user-visible exchange", () => {
    const { core, dir } = createCore("latest-visible-exchange");
    try {
      core.recordEvent(
        makeEvent({
          event_id: "ignored-summary-prompt",
          platform: "claude",
          session_id: "claude-session",
          ts: "2026-02-13T23:59:00.000Z",
          payload: {
            content:
              "This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.",
          },
        })
      );
      core.recordEvent(
        makeEvent({
          event_id: "visible-claude-prompt",
          platform: "claude",
          session_id: "claude-session",
          ts: "2026-02-14T00:00:00.000Z",
          payload: { content: "shared last user prompt" },
        })
      );
      core.recordEvent(
        makeEvent({
          event_id: "visible-claude-response",
          platform: "claude",
          session_id: "claude-session",
          event_type: "checkpoint",
          ts: "2026-02-14T00:01:00.000Z",
          payload: { title: "assistant_response", content: "shared last assistant answer" },
        })
      );
      core.recordEvent(
        makeEvent({
          event_id: "ignored-turn-aborted",
          platform: "codex",
          session_id: "codex-session",
          ts: "2026-02-14T00:02:00.000Z",
          payload: { content: "<turn_aborted>\nThe user interrupted the previous turn on purpose.\n</turn_aborted>" },
        })
      );
      core.recordEvent(
        makeEvent({
          event_id: "ignored-agents-wrapper",
          platform: "codex",
          session_id: "codex-session",
          ts: "2026-02-14T00:03:00.000Z",
          payload: { content: "# AGENTS.md instructions for /repo\n\n<INSTRUCTIONS>..." },
        })
      );
      core.recordEvent(
        makeEvent({
          event_id: "ignored-skill-wrapper",
          platform: "codex",
          session_id: "codex-session",
          ts: "2026-02-14T00:04:00.000Z",
          payload: {
            content:
              "<skill>\n<name>harness-review</name>\n<path>/Users/example/.codex/skills/harness-review/SKILL.md</path>\n---",
          },
        })
      );
      core.recordEvent(
        makeEvent({
          event_id: "ignored-local-command-caveat",
          platform: "claude",
          session_id: "claude-wrapper-session",
          ts: "2026-02-14T00:05:00.000Z",
          payload: {
            content:
              "<local-command-caveat>Caveat: The messages below were generated by the user while running local commands. DO NOT respond to these messages or otherwise consider them in your response unless the user explicitly asks you to.</local-command-caveat>",
          },
        })
      );
      core.recordEvent(
        makeEvent({
          event_id: "ignored-plugin-command",
          platform: "claude",
          session_id: "claude-wrapper-session",
          ts: "2026-02-14T00:06:00.000Z",
          payload: {
            content:
              "<command-name>/plugin</command-name>\n<command-message>plugin</command-message>\n<command-args></command-args>",
          },
        })
      );

      const result = core.search({
        query: "直近を調べて",
        project: "search-quality",
        limit: 5,
        include_private: true,
      });

      expect(result.ok).toBe(true);
      const latestInteraction = (result.meta as Record<string, unknown>).latest_interaction as Record<string, unknown>;
      expect(latestInteraction).toBeDefined();
      expect(latestInteraction.platform).toBe("claude");
      expect(latestInteraction.session_id).toBe("claude-session");
      expect(latestInteraction.incomplete).toBe(false);
      expect((latestInteraction.prompt as Record<string, unknown>).content).toBe("shared last user prompt");
      expect((latestInteraction.response as Record<string, unknown>).content).toBe("shared last assistant answer");

      const items = asItems(result);
      expect(String(items[0]?.content || "")).toContain("shared last assistant answer");
      expect(String(items[1]?.content || "")).toContain("shared last user prompt");
    } finally {
      core.shutdown("test");
      removeDirWithRetry(dir);
    }
  });

  test("private observations stay hidden by default and appear when requested", () => {
    const { core, dir } = createCore("privacy");
    try {
      core.recordEvent(
        makeEvent({
          event_id: "sq-public",
          payload: { content: "deployment note public visibility" },
          privacy_tags: [],
        })
      );
      core.recordEvent(
        makeEvent({
          event_id: "sq-private",
          payload: { content: "deployment note private visibility" },
          privacy_tags: ["private"],
        })
      );

      const hidden = core.search({
        query: "deployment note visibility",
        project: "search-quality",
        limit: 10,
        include_private: false,
        strict_project: true,
      });
      expect(hidden.ok).toBe(true);

      for (const item of asItems(hidden)) {
        const privacyTags = (item.privacy_tags || []) as string[];
        expect(privacyTags.includes("private")).toBe(false);
      }

      const visible = core.search({
        query: "deployment note visibility",
        project: "search-quality",
        limit: 10,
        include_private: true,
        strict_project: true,
      });
      expect(visible.ok).toBe(true);
      const privateHits = asItems(visible).filter((item) =>
        ((item.privacy_tags || []) as string[]).includes("private")
      );
      expect(privateHits.length).toBeGreaterThan(0);
    } finally {
      core.shutdown("test");
      removeDirWithRetry(dir);
    }
  });

  test(`search latency p95 stays below ${MEDIUM_CORPUS_LATENCY_BUDGET_MS}ms on medium synthetic corpus`, () => {
    const { core, dir } = createCore("latency");
    try {
      const baseTs = Date.parse("2026-01-01T00:00:00.000Z");
      const total = 600;
      for (let i = 0; i < total; i += 1) {
        const ts = new Date(baseTs + i * 60_000).toISOString();
        core.recordEvent(
          makeEvent({
            event_id: `sq-bulk-${i}`,
            session_id: `sq-session-${i % 5}`,
            ts,
            payload: {
              content: `feature-${i % 30} migration note ${i} search quality benchmark`,
            },
            tags: ["quality", `feature-${i % 30}`],
          })
        );
      }

      const latencies: number[] = [];
      for (let i = 0; i < 24; i += 1) {
        const query = `feature-${i % 30} migration note`;
        const response = core.search({
          query,
          project: "search-quality",
          limit: 15,
          include_private: false,
        });
        expect(response.ok).toBe(true);
        expect(response.items.length).toBeGreaterThan(0);
        const latencyMs = Number(response.meta.latency_ms);
        expect(Number.isFinite(latencyMs)).toBe(true);
        latencies.push(latencyMs);
      }

      const sorted = [...latencies].sort((a, b) => a - b);
      const idx = Math.floor((sorted.length - 1) * 0.95);
      const p95 = sorted[idx];
      expect(p95).toBeLessThan(MEDIUM_CORPUS_LATENCY_BUDGET_MS);
    } finally {
      core.shutdown("test");
      removeDirWithRetry(dir);
    }
  }, 120_000);

  const heavyTest = process.env.HARNESS_MEM_RUN_HEAVY_SEARCH_BENCH === "1" ? test : test.skip;
  heavyTest("search latency p95 stays below 650ms on 30k corpus with link expansion", () => {
    const { core, dir } = createCore("latency-heavy");
    try {
      const baseTs = Date.parse("2026-01-01T00:00:00.000Z");
      const total = 30000;
      for (let i = 0; i < total; i += 1) {
        const ts = new Date(baseTs + i * 1_000).toISOString();
        core.recordEvent(
          makeEvent({
            event_id: `sq-heavy-${i}`,
            session_id: `sq-heavy-session-${i % 30}`,
            project: `heavy-project-${i % 5}`,
            ts,
            payload: {
              content: `heavy feature-${i % 300} migration note ${i} search quality benchmark`,
            },
            tags: ["quality", `feature-${i % 300}`],
          })
        );
      }

      const latencies: number[] = [];
      for (let i = 0; i < 60; i += 1) {
        const query = `feature-${i % 300} migration note`;
        const response = core.search({
          query,
          project: `heavy-project-${i % 5}`,
          limit: 20,
          include_private: false,
          expand_links: true,
          strict_project: true,
        });
        expect(response.ok).toBe(true);
        expect(response.items.length).toBeGreaterThan(0);
        latencies.push(Number(response.meta.latency_ms));
      }

      const sorted = [...latencies].sort((a, b) => a - b);
      const idx = Math.floor((sorted.length - 1) * 0.95);
      const p95 = sorted[idx];
      expect(p95).toBeLessThan(650);
    } finally {
      core.shutdown("test");
      removeDirWithRetry(dir);
    }
  });

  test("strict_project=true keeps graph expansion inside project", () => {
    const { core, dir } = createCore("strict-project");
    try {
      core.recordEvent(
        makeEvent({
          event_id: "strict-a1",
          project: "project-a",
          session_id: "session-a",
          payload: { content: "touch src/index.ts and update parser" },
        })
      );
      core.recordEvent(
        makeEvent({
          event_id: "strict-b1",
          project: "project-b",
          session_id: "session-b",
          payload: { content: "touch src/index.ts and update parser" },
        })
      );
      core.recordEvent(
        makeEvent({
          event_id: "strict-a2",
          project: "project-a",
          session_id: "session-a",
          event_type: "tool_use",
          payload: { content: "follow-up changes for src/index.ts in project-a" },
        })
      );

      const result = core.search({
        query: "src/index.ts parser",
        project: "project-a",
        strict_project: true,
        include_private: true,
        limit: 20,
      });
      expect(result.ok).toBe(true);
      const items = asItems(result);
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        expect(item.project).toBe("project-a");
      }
    } finally {
      core.shutdown("test");
      removeDirWithRetry(dir);
    }
  });

  test("vector search ignores mismatched model/dimension rows", () => {
    const { core, dir } = createCore("vector-model");
    const dbPath = join(dir, "harness-mem.db");
    try {
      core.recordEvent(
        makeEvent({
          event_id: "vector-good",
          project: "search-quality",
          payload: { content: "typescript dependency migration plan" },
        })
      );
      core.recordEvent(
        makeEvent({
          event_id: "vector-old",
          project: "search-quality",
          payload: { content: "typescript dependency migration old strategy" },
        })
      );

      const db = new Database(dbPath);
      try {
        db.query(`
          UPDATE mem_vectors
          SET model = 'local-hash-v1', dimension = 64
          WHERE observation_id = 'obs_vector-old'
        `).run();
      } finally {
        db.close();
      }

      const result = core.search({
        query: "typescript dependency migration",
        project: "search-quality",
        strict_project: true,
        include_private: true,
        limit: 10,
        debug: true,
      });
      expect(result.ok).toBe(true);
      const debug = (result.meta.debug || {}) as Record<string, unknown>;
      const coverage = Number(debug.vector_backend_coverage ?? 0);
      expect(coverage).toBeLessThanOrEqual(1);
      const items = asItems(result);
      const oldItem = items.find((item) => item.id === "obs_vector-old");
      if (oldItem) {
        const scores = (oldItem.scores || {}) as Record<string, unknown>;
        expect(Number(scores.vector ?? 0)).toBe(0);
      }
    } finally {
      core.shutdown("test");
      removeDirWithRetry(dir);
    }
  });

  test("vector_coverage below threshold disables vector weight", () => {
    const { core, dir } = createCore("vector-coverage-threshold");
    const dbPath = join(dir, "harness-mem.db");
    try {
      core.recordEvent(
        makeEvent({
          event_id: "coverage-1",
          payload: { content: "coverage threshold test one" },
        })
      );
      core.recordEvent(
        makeEvent({
          event_id: "coverage-2",
          payload: { content: "coverage threshold test two" },
        })
      );

      const db = new Database(dbPath);
      try {
        db.query(`UPDATE mem_vectors SET model = 'legacy-model'`).run();
      } finally {
        db.close();
      }

      const result = core.search({
        query: "coverage threshold test",
        project: "search-quality",
        include_private: true,
        strict_project: true,
        debug: true,
      });
      expect(result.ok).toBe(true);
      expect(Number(result.meta.vector_coverage)).toBeLessThan(0.2);
      const debug = (result.meta.debug || {}) as Record<string, unknown>;
      const weights = (debug.weights || {}) as Record<string, unknown>;
      expect(Number(weights.vector ?? 1)).toBe(0);
    } finally {
      core.shutdown("test");
      removeDirWithRetry(dir);
    }
  });

  test("privacy filter keeps semi-private visible and private hidden", () => {
    const { core, dir } = createCore("privacy-strict-json");
    try {
      core.recordEvent(
        makeEvent({
          event_id: "semi-private-tag",
          payload: { content: "semi-private note should remain visible" },
          privacy_tags: ["semi-private"],
        })
      );
      core.recordEvent(
        makeEvent({
          event_id: "strict-private-tag",
          payload: { content: "private note should be hidden by default" },
          privacy_tags: ["private"],
        })
      );

      const hidden = core.search({
        query: "note should",
        project: "search-quality",
        include_private: false,
        strict_project: true,
        limit: 20,
      });
      const hiddenItems = asItems(hidden);
      const ids = hiddenItems.map((item) => String(item.id));
      expect(ids.includes("obs_semi-private-tag")).toBe(true);
      expect(ids.includes("obs_strict-private-tag")).toBe(false);
    } finally {
      core.shutdown("test");
      removeDirWithRetry(dir);
    }
  });
});
