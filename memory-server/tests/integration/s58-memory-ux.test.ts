/**
 * S58-010: §58 統合テストスイート
 *
 * §58 全変更（reason / no_memory / team_share / shared_label / LLM enhance）の
 * 回帰テストを網羅する。
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  HarnessMemCore,
  type ApiResponse,
  type Config,
  type EventEnvelope,
} from "../../src/core/harness-mem-core";

// ---------------------------------------------------------------------------
// テストユーティリティ
// ---------------------------------------------------------------------------

function createCore(name: string): { core: HarnessMemCore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), `harness-mem-s58-${name}-`));
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
    project: "s58-test",
    session_id: "s58-session",
    event_type: "user_prompt",
    ts: "2026-03-01T00:00:00.000Z",
    payload: { content: "default s58 test content" },
    tags: [],
    privacy_tags: [],
    ...overrides,
  };
}

function asItems(response: ApiResponse): Array<Record<string, unknown>> {
  return response.items as Array<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// 1. reason フィールド統合テスト
// ---------------------------------------------------------------------------

describe("S58: reason フィールド統合テスト", () => {
  test("search 結果の全アイテムに reason が非空文字列で含まれる", () => {
    const { core, dir } = createCore("reason-field");
    try {
      core.recordEvent(
        makeEvent({
          event_id: "reason-1",
          payload: { content: "TypeScript migration strategy for the auth module" },
          tags: ["typescript", "auth"],
        })
      );
      core.recordEvent(
        makeEvent({
          event_id: "reason-2",
          payload: { content: "database schema changes for the user table migration" },
          tags: ["database", "migration"],
        })
      );
      core.recordEvent(
        makeEvent({
          event_id: "reason-3",
          payload: { content: "deployment checklist for production release" },
          tags: ["deployment"],
        })
      );

      const result = core.search({
        query: "migration strategy",
        project: "s58-test",
        limit: 10,
        include_private: true,
        strict_project: true,
      });

      expect(result.ok).toBe(true);
      const items = asItems(result);
      expect(items.length).toBeGreaterThan(0);

      for (const item of items) {
        expect(typeof item.reason).toBe("string");
        expect((item.reason as string).length).toBeGreaterThan(0);
      }
    } finally {
      core.shutdown("test");
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("reason の内容がスコアリング次元の説明を含む", () => {
    const { core, dir } = createCore("reason-content");
    try {
      // 明確なキーワードマッチを持つ observation を挿入
      core.recordEvent(
        makeEvent({
          event_id: "reason-keyword",
          payload: { content: "keyword matching exact phrase lexical search" },
          tags: [],
        })
      );

      const result = core.search({
        query: "keyword matching exact phrase lexical search",
        project: "s58-test",
        limit: 5,
        include_private: true,
        strict_project: true,
      });

      expect(result.ok).toBe(true);
      const items = asItems(result);
      expect(items.length).toBeGreaterThan(0);

      // reason が定義済みの説明文マップのいずれかから生成されていることを確認
      const knownReasonPrefixes = [
        "Title or content matches query keywords",
        "Semantically similar to query",
        "Recently recorded memory",
        "Tag matches query",
        "High-importance memory",
        "Expanded from related memory",
        "Contains relevant facts",
        "Matched by broad retrieval",
      ];
      const topReason = items[0].reason as string;
      const hasKnownReason = knownReasonPrefixes.some((prefix) => topReason.includes(prefix));
      expect(hasKnownReason).toBe(true);
    } finally {
      core.shutdown("test");
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 2. no_memory 統合テスト
// ---------------------------------------------------------------------------

describe("S58: no_memory 統合テスト", () => {
  test("空 DB で search すると no_memory: true が返る", () => {
    const { core, dir } = createCore("no-memory-empty");
    try {
      const result = core.search({
        query: "anything at all",
        project: "s58-test",
        limit: 10,
        include_private: true,
        strict_project: true,
      });

      expect(result.ok).toBe(true);
      expect((result as Record<string, unknown>).no_memory).toBe(true);
    } finally {
      core.shutdown("test");
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("全く関係ないクエリに対して no_memory: true が返る", () => {
    const { core, dir } = createCore("no-memory-unrelated");
    try {
      // 特定トピックの observation を挿入
      core.recordEvent(
        makeEvent({
          event_id: "unrelated-obs",
          payload: { content: "TypeScript compiler configuration tsconfig paths" },
          tags: ["typescript"],
        })
      );

      // まったく無関係な検索
      // 新規プロジェクトで strict_project=true にして他プロジェクトを除外
      const result = core.search({
        query: "quantum physics superconductor thermodynamics",
        project: "s58-unrelated-project",
        limit: 10,
        include_private: true,
        strict_project: true,
      });

      expect(result.ok).toBe(true);
      expect((result as Record<string, unknown>).no_memory).toBe(true);
    } finally {
      core.shutdown("test");
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("正常マッチ時は no_memory が false or undefined", () => {
    const { core, dir } = createCore("no-memory-match");
    try {
      // 複数の関連 observation を挿入して十分なスコアを確保
      for (let i = 0; i < 5; i++) {
        core.recordEvent(
          makeEvent({
            event_id: `match-obs-${i}`,
            payload: { content: `authentication login password security JWT token validation ${i}` },
            tags: ["auth", "security"],
          })
        );
      }

      const result = core.search({
        query: "authentication login JWT token",
        project: "s58-test",
        limit: 10,
        include_private: true,
        strict_project: true,
      });

      expect(result.ok).toBe(true);
      const noMemory = (result as Record<string, unknown>).no_memory;
      // no_memory は false または未定義であること
      expect(noMemory === false || noMemory === undefined).toBe(true);
    } finally {
      core.shutdown("test");
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 3. team share 統合テスト
// ---------------------------------------------------------------------------

describe("S58: team share 統合テスト", () => {
  test("observation を team に share すると成功レスポンスが返る", () => {
    const { core, dir } = createCore("team-share-success");
    try {
      // team を事前に作成（直接 DB 操作）
      const db = core.getRawDb();
      const now = new Date().toISOString();
      db.query(
        `INSERT INTO mem_teams(team_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
      ).run("team-s58-001", "S58 Test Team", "test team for s58", now, now);

      // observation を挿入
      core.recordEvent(
        makeEvent({
          event_id: "share-target",
          payload: { content: "shared observation for team collaboration test" },
        })
      );

      const result = core.shareObservationToTeam({
        observation_id: "obs_share-target",
        team_id: "team-s58-001",
        user_id: "user-001",
      });

      expect(result.ok).toBe(true);
      const items = asItems(result);
      expect(items.length).toBeGreaterThan(0);
      const item = items[0] as Record<string, unknown>;
      expect(item.observation_id).toBe("obs_share-target");
      expect(item.team_id).toBe("team-s58-001");
    } finally {
      core.shutdown("test");
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("share 後の search で shared_by と shared_at フィールドが含まれる", () => {
    const { core, dir } = createCore("team-share-fields");
    try {
      // team を作成
      const db = core.getRawDb();
      const now = new Date().toISOString();
      db.query(
        `INSERT INTO mem_teams(team_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
      ).run("team-s58-002", "S58 Fields Team", null, now, now);

      // observation を挿入
      core.recordEvent(
        makeEvent({
          event_id: "share-fields-obs",
          payload: { content: "team shared content with fields verification alpha beta" },
          tags: ["team", "shared"],
        })
      );

      // team に share
      const shareResult = core.shareObservationToTeam({
        observation_id: "obs_share-fields-obs",
        team_id: "team-s58-002",
        user_id: "user-fields-001",
      });
      expect(shareResult.ok).toBe(true);

      // search して shared_by / shared_at を確認
      const searchResult = core.search({
        query: "team shared content fields verification",
        project: "s58-test",
        limit: 10,
        include_private: true,
        strict_project: true,
      });

      expect(searchResult.ok).toBe(true);
      const items = asItems(searchResult);
      expect(items.length).toBeGreaterThan(0);

      const sharedItem = items.find((item) => item.id === "obs_share-fields-obs");
      expect(sharedItem).toBeDefined();
      if (sharedItem) {
        expect(typeof sharedItem.shared_by).toBe("string");
        expect((sharedItem.shared_by as string).length).toBeGreaterThan(0);
        expect(typeof sharedItem.shared_at).toBe("string");
        expect((sharedItem.shared_at as string).length).toBeGreaterThan(0);
      }
    } finally {
      core.shutdown("test");
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("share 操作の冪等性: 同じ team に 2 回 share しても成功する", () => {
    const { core, dir } = createCore("team-share-idempotent");
    try {
      const db = core.getRawDb();
      const now = new Date().toISOString();
      db.query(
        `INSERT INTO mem_teams(team_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
      ).run("team-s58-003", "S58 Idempotent Team", null, now, now);

      core.recordEvent(
        makeEvent({
          event_id: "idempotent-obs",
          payload: { content: "idempotent share test observation" },
        })
      );

      const first = core.shareObservationToTeam({
        observation_id: "obs_idempotent-obs",
        team_id: "team-s58-003",
      });
      expect(first.ok).toBe(true);

      const second = core.shareObservationToTeam({
        observation_id: "obs_idempotent-obs",
        team_id: "team-s58-003",
      });
      expect(second.ok).toBe(true);

      const secondItems = asItems(second);
      expect(secondItems[0]).toBeDefined();
      expect((secondItems[0] as Record<string, unknown>).already_shared).toBe(true);
    } finally {
      core.shutdown("test");
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 4. LLM enhance スキップ確認テスト
// ---------------------------------------------------------------------------

describe("S58: LLM enhance スキップ確認テスト", () => {
  test("HARNESS_MEM_LLM_ENHANCE 未設定時は search レスポンスに llm_rerank: false が含まれる", async () => {
    const { core, dir } = createCore("llm-skip");
    try {
      // HARNESS_MEM_LLM_ENHANCE が設定されていないことを前提とする
      const originalEnv = process.env.HARNESS_MEM_LLM_ENHANCE;
      const originalRerankEnv = process.env.HARNESS_MEM_LLM_RERANK;
      delete process.env.HARNESS_MEM_LLM_ENHANCE;
      delete process.env.HARNESS_MEM_LLM_RERANK;

      try {
        core.recordEvent(
          makeEvent({
            event_id: "llm-skip-obs",
            payload: { content: "LLM rerank skip verification test observation" },
          })
        );

        // searchPrepared を使用すると llm_rerank フラグがメタデータに追記される
        const result = await core.searchPrepared({
          query: "LLM rerank skip verification",
          project: "s58-test",
          limit: 5,
          include_private: true,
          strict_project: true,
        });

        expect(result.ok).toBe(true);
        // LLM enhance が無効の場合 llm_rerank: false が設定される
        const meta = result.meta as Record<string, unknown>;
        expect(meta.llm_rerank).toBe(false);
      } finally {
        if (originalEnv !== undefined) {
          process.env.HARNESS_MEM_LLM_ENHANCE = originalEnv;
        }
        if (originalRerankEnv !== undefined) {
          process.env.HARNESS_MEM_LLM_RERANK = originalRerankEnv;
        }
      }
    } finally {
      core.shutdown("test");
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("通常 search（非 prepared）は llm_rerank フィールドを持たない", () => {
    const { core, dir } = createCore("llm-skip-plain");
    try {
      core.recordEvent(
        makeEvent({
          event_id: "plain-search-obs",
          payload: { content: "plain search without LLM rerank test" },
        })
      );

      const result = core.search({
        query: "plain search without LLM",
        project: "s58-test",
        limit: 5,
        include_private: true,
        strict_project: true,
      });

      expect(result.ok).toBe(true);
      // 通常 search では llm_rerank は設定されない
      const meta = result.meta as Record<string, unknown>;
      expect(meta.llm_rerank).toBeUndefined();
    } finally {
      core.shutdown("test");
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("S154-702: local LLM rerank integration", () => {
  let originalFetch: typeof globalThis.fetch;
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalEnv = {
      HARNESS_MEM_LLM_RERANK: process.env.HARNESS_MEM_LLM_RERANK,
      HARNESS_MEM_LLM_RERANK_TOP_K: process.env.HARNESS_MEM_LLM_RERANK_TOP_K,
      HARNESS_MEM_LLM_RERANK_OLLAMA_HOST: process.env.HARNESS_MEM_LLM_RERANK_OLLAMA_HOST,
      HARNESS_MEM_LLM_ENHANCE: process.env.HARNESS_MEM_LLM_ENHANCE,
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  test("HARNESS_MEM_LLM_RERANK=1 で searchPrepared が top-k のみ local Ollama に渡して並べ替える", async () => {
    const { core, dir } = createCore("local-rerank");
    try {
      delete process.env.HARNESS_MEM_LLM_ENHANCE;
      process.env.HARNESS_MEM_LLM_RERANK = "1";
      process.env.HARNESS_MEM_LLM_RERANK_TOP_K = "2";
      process.env.HARNESS_MEM_LLM_RERANK_OLLAMA_HOST = "http://127.0.0.1:11434";

      let prompt = "";
      globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(init?.body as string) as { messages: Array<{ content: string }> };
        prompt = body.messages.at(-1)?.content ?? "";
        return {
          ok: true,
          json: async () => ({
            message: {
              content: JSON.stringify([
                { index: 0, score: 0.1 },
                { index: 1, score: 0.99 },
              ]),
            },
          }),
        } as Response;
      });

      core.recordEvent(
        makeEvent({
          event_id: "rerank-a",
          payload: { content: "alpha rerank candidate A parser note" },
        })
      );
      core.recordEvent(
        makeEvent({
          event_id: "rerank-b",
          payload: { content: "alpha rerank candidate B parser note" },
        })
      );
      core.recordEvent(
        makeEvent({
          event_id: "rerank-c",
          payload: { content: "alpha rerank candidate C parser note" },
        })
      );

      delete process.env.HARNESS_MEM_LLM_RERANK;
      const baseline = core.search({
        query: "alpha rerank parser",
        project: "s58-test",
        limit: 3,
        vector_search: false,
        include_private: true,
        strict_project: true,
      });
      const baselineTop1Hit = asItems(baseline)[0]?.id === "obs_rerank-b" ? 1 : 0;
      expect(baselineTop1Hit).toBe(0);

      process.env.HARNESS_MEM_LLM_RERANK = "1";
      const result = await core.searchPrepared({
        query: "alpha rerank parser",
        project: "s58-test",
        limit: 3,
        vector_search: false,
        include_private: true,
        strict_project: true,
      });

      expect(result.ok).toBe(true);
      const rerankedTop1Hit = asItems(result)[0]?.id === "obs_rerank-b" ? 1 : 0;
      expect(rerankedTop1Hit).toBe(1);
      expect((result.meta as Record<string, unknown>).llm_rerank).toBe(true);
      expect((result.meta as Record<string, unknown>).llm_rerank_provider).toBe("ollama");
      expect((result.meta as Record<string, unknown>).llm_rerank_top_k).toBe(2);
      expect(prompt).toContain("[0]");
      expect(prompt).toContain("[1]");
      expect(prompt).not.toContain("[2]");
      const items = asItems(result);
      expect(items[0]?.id).toBe("obs_rerank-b");
    } finally {
      core.shutdown("test");
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("safe_mode=true では HARNESS_MEM_LLM_RERANK=1 でも local LLM を呼ばない", async () => {
    const { core, dir } = createCore("local-rerank-safe-mode");
    try {
      process.env.HARNESS_MEM_LLM_RERANK = "1";
      process.env.HARNESS_MEM_LLM_RERANK_TOP_K = "2";
      process.env.HARNESS_MEM_LLM_RERANK_OLLAMA_HOST = "http://127.0.0.1:11434";
      globalThis.fetch = mock(async () => {
        throw new Error("safe_mode should skip local LLM rerank");
      });

      core.recordEvent(
        makeEvent({
          event_id: "safe-rerank-a",
          payload: { content: "safe mode rerank candidate A parser note" },
        })
      );

      const result = await core.searchPrepared({
        query: "safe mode rerank parser",
        project: "s58-test",
        limit: 3,
        vector_search: false,
        include_private: true,
        strict_project: true,
        safe_mode: true,
      });

      expect(result.ok).toBe(true);
      expect((result.meta as Record<string, unknown>).llm_rerank).toBe(false);
      expect((globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(0);
    } finally {
      core.shutdown("test");
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 5. 全フィールド複合テスト
// ---------------------------------------------------------------------------

describe("S58: 全フィールド複合テスト", () => {
  test("observation 挿入 + team share + search で reason と shared_by が両方含まれ no_memory が false", () => {
    const { core, dir } = createCore("composite");
    try {
      // team を作成
      const db = core.getRawDb();
      const now = new Date().toISOString();
      db.query(
        `INSERT INTO mem_teams(team_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
      ).run("team-s58-composite", "S58 Composite Team", null, now, now);

      // 複数 observation を挿入（スコアを確保するため）
      for (let i = 0; i < 4; i++) {
        core.recordEvent(
          makeEvent({
            event_id: `composite-obs-${i}`,
            payload: {
              content: `composite integration test observation with shared team content deployment pipeline ${i}`,
            },
            tags: ["composite", "integration", "team"],
          })
        );
      }

      // 最初の observation を team に share
      const shareResult = core.shareObservationToTeam({
        observation_id: "obs_composite-obs-0",
        team_id: "team-s58-composite",
        user_id: "composite-user-001",
      });
      expect(shareResult.ok).toBe(true);

      // search 実行
      const searchResult = core.search({
        query: "composite integration test shared team deployment",
        project: "s58-test",
        limit: 10,
        include_private: true,
        strict_project: true,
      });

      expect(searchResult.ok).toBe(true);
      const items = asItems(searchResult);
      expect(items.length).toBeGreaterThan(0);

      // no_memory は false または undefined
      const noMemory = (searchResult as Record<string, unknown>).no_memory;
      expect(noMemory === false || noMemory === undefined).toBe(true);

      // 全アイテムに reason が含まれる
      for (const item of items) {
        expect(typeof item.reason).toBe("string");
        expect((item.reason as string).length).toBeGreaterThan(0);
      }

      // shared item に shared_by が含まれる
      const sharedItem = items.find((item) => item.id === "obs_composite-obs-0");
      expect(sharedItem).toBeDefined();
      if (sharedItem) {
        expect(typeof sharedItem.shared_by).toBe("string");
        expect((sharedItem.shared_by as string).length).toBeGreaterThan(0);
        expect(typeof sharedItem.shared_at).toBe("string");
      }

      // non-shared items に shared_by が含まれない
      const nonSharedItem = items.find(
        (item) => item.id !== "obs_composite-obs-0" && typeof item.id === "string"
      );
      if (nonSharedItem) {
        expect(nonSharedItem.shared_by).toBeUndefined();
        expect(nonSharedItem.shared_at).toBeUndefined();
      }
    } finally {
      core.shutdown("test");
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
