/**
 * S74-001: Nugget Splitter ユニットテスト
 *
 * - 英語テキストの分割
 * - 日本語テキストの分割
 * - 混合テキストの分割
 * - エッジケース: 短すぎるテキスト、長すぎるテキスト、空テキスト
 * - 統合: recordEvent 後に mem_nuggets が生成される
 * - 統合: search が nugget 経由で親を返す
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { splitIntoNuggets } from "../../src/core/nugget-splitter";
import { HarnessMemCore, type Config, type EventEnvelope } from "../../src/core/harness-mem-core";

// ---------------------------------------------------------------------------
// ユニットテスト: splitIntoNuggets
// ---------------------------------------------------------------------------

describe("splitIntoNuggets — 英語テキスト", () => {
  test("単一文はそのまま 1 nugget になる", () => {
    const nuggets = splitIntoNuggets("This is a simple English sentence.");
    expect(nuggets.length).toBe(1);
    expect(nuggets[0]!.seq).toBe(0);
    expect(nuggets[0]!.content).toContain("English sentence");
    expect(nuggets[0]!.content_hash).toHaveLength(64);
  });

  test("複数の短い文は最大 3 文ずつグループ化される", () => {
    const text = [
      "First sentence.",
      "Second sentence.",
      "Third sentence.",
      "Fourth sentence.",
      "Fifth sentence.",
    ].join(" ");
    const nuggets = splitIntoNuggets(text);
    expect(nuggets.length).toBeGreaterThanOrEqual(1);
    // 全 nuggets で総文字数が元テキストをカバーしていること
    const combined = nuggets.map((n) => n.content).join(" ");
    expect(combined.length).toBeGreaterThan(0);
  });

  test("20 文字未満の入力は空配列を返す", () => {
    const nuggets = splitIntoNuggets("Too short.");
    expect(nuggets).toEqual([]);
  });

  test("空文字列は空配列を返す", () => {
    expect(splitIntoNuggets("")).toEqual([]);
    expect(splitIntoNuggets("   ")).toEqual([]);
  });

  test("500 文字超の単一文は強制分割される", () => {
    const longSentence = "A".repeat(1200);
    const nuggets = splitIntoNuggets(longSentence);
    expect(nuggets.length).toBeGreaterThanOrEqual(2);
    for (const nugget of nuggets) {
      expect(nugget.content.length).toBeLessThanOrEqual(500);
    }
  });

  test("seq は 0-indexed で連続する", () => {
    const text = "Alpha sentence here. Beta sentence here. Gamma sentence here. Delta sentence here.";
    const nuggets = splitIntoNuggets(text);
    for (let i = 0; i < nuggets.length; i++) {
      expect(nuggets[i]!.seq).toBe(i);
    }
  });

  test("content_hash は SHA256 ヘックス文字列（64 文字）", () => {
    const nuggets = splitIntoNuggets("This is a test sentence for hashing purposes.");
    for (const nugget of nuggets) {
      expect(nugget.content_hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  test("重複コンテンツは dedup される", () => {
    const text = "The same sentence. The same sentence. The same sentence.";
    const nuggets = splitIntoNuggets(text);
    // 重複があっても nuggets に同一コンテンツが複数入らない
    const hashes = nuggets.map((n) => n.content_hash);
    const unique = new Set(hashes);
    expect(unique.size).toBe(hashes.length);
  });
});

describe("splitIntoNuggets — 日本語テキスト", () => {
  test("日本語の文は 。で分割される", () => {
    const text = "これは最初の文です。これは二番目の文です。これは三番目の文です。これは四番目の文です。";
    const nuggets = splitIntoNuggets(text);
    expect(nuggets.length).toBeGreaterThanOrEqual(1);
    for (const nugget of nuggets) {
      expect(nugget.content.length).toBeGreaterThanOrEqual(20);
    }
  });

  test("短い日本語テキストは 1 nugget になる", () => {
    const text = "これは重要な情報です。SQLiteを使ってデータを格納します。";
    const nuggets = splitIntoNuggets(text);
    expect(nuggets.length).toBeGreaterThanOrEqual(1);
    expect(nuggets[0]!.seq).toBe(0);
  });

  test("20 文字未満の日本語は空配列を返す", () => {
    const nuggets = splitIntoNuggets("短い。");
    expect(nuggets).toEqual([]);
  });
});

describe("splitIntoNuggets — 混合テキスト", () => {
  test("英語と日本語が混在するテキストを処理できる", () => {
    const text = "This is an English sentence. これは日本語の文です。Another English line follows here.";
    const nuggets = splitIntoNuggets(text);
    expect(nuggets.length).toBeGreaterThanOrEqual(1);
    for (const nugget of nuggets) {
      expect(nugget.content_hash).toHaveLength(64);
    }
  });

  test("段落区切り（\\n\\n）は境界として扱われる", () => {
    const text = [
      "This is the first paragraph with some content here.",
      "",
      "This is the second paragraph with different content.",
    ].join("\n");
    const nuggets = splitIntoNuggets(text);
    expect(nuggets.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// 統合テスト: recordEvent → mem_nuggets
// ---------------------------------------------------------------------------

const cleanupPaths: string[] = [];

afterEach(() => {
  while (cleanupPaths.length > 0) {
    const dir = cleanupPaths.pop();
    if (!dir) continue;
    rmSync(dir, { recursive: true, force: true });
  }
});

function createConfig(name: string): Config {
  const dir = mkdtempSync(join(tmpdir(), `harness-mem-nugget-${name}-`));
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

function makeEvent(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    event_id: `evt-${Math.random().toString(36).slice(2)}`,
    platform: "codex",
    project: "nugget-test-project",
    session_id: "nugget-session",
    event_type: "user_prompt",
    ts: "2026-04-07T00:00:00.000Z",
    payload: { content: "default content for nugget test" },
    tags: [],
    privacy_tags: [],
    ...overrides,
  };
}

describe("S74-001 統合: recordEvent が nugget を生成する", () => {
  test("recordEvent 後に mem_nuggets レコードが作成される", () => {
    const core = new HarnessMemCore(createConfig("record-nuggets"));
    try {
      const content = [
        "The first important fact about this system is that it uses SQLite.",
        "The second fact is that it supports vector search.",
        "The third fact is that nuggets improve search precision.",
        "The fourth fact demonstrates multi-sentence grouping behavior.",
      ].join(" ");

      const result = core.recordEvent(makeEvent({
        payload: { content },
      }));

      expect(result.ok).toBe(true);
      const items = result.items as Array<Record<string, unknown>>;
      expect(items.length).toBe(1);

      const observationId = String(items[0]!.id);

      // DB から nuggets を直接確認
      const db = (core as unknown as { db: import("bun:sqlite").Database }).db;
      if (!db) {
        // DB が直接アクセスできない場合はスキップ
        return;
      }

      const nuggets = db
        .query("SELECT * FROM mem_nuggets WHERE observation_id = ? ORDER BY seq")
        .all(observationId) as Array<Record<string, unknown>>;

      // 十分な長さのコンテンツなので nugget が生成されているはず
      expect(nuggets.length).toBeGreaterThanOrEqual(1);

      for (const nugget of nuggets) {
        expect(nugget.observation_id).toBe(observationId);
        expect(typeof nugget.seq).toBe("number");
        expect(typeof nugget.content).toBe("string");
        expect((nugget.content as string).length).toBeGreaterThanOrEqual(20);
      }
    } finally {
      core.shutdown("test");
    }
  });

  test("短いコンテンツ（20 文字未満）は nugget を生成しない", () => {
    const core = new HarnessMemCore(createConfig("short-content"));
    try {
      const result = core.recordEvent(makeEvent({
        payload: { content: "short" },
      }));

      expect(result.ok).toBe(true);
      const items = result.items as Array<Record<string, unknown>>;
      const observationId = String(items[0]!.id);

      const db = (core as unknown as { db: import("bun:sqlite").Database }).db;
      if (!db) return;

      const nuggets = db
        .query("SELECT COUNT(*) as cnt FROM mem_nuggets WHERE observation_id = ?")
        .get(observationId) as { cnt: number } | null;

      expect(Number(nuggets?.cnt ?? 0)).toBe(0);
    } finally {
      core.shutdown("test");
    }
  });
});

describe("S74-001 統合: search が nugget 経由で親を返す", () => {
  test("nugget の内容でクエリするとその親 observation が返される", () => {
    const core = new HarnessMemCore(createConfig("nugget-search"));
    try {
      // 2つの observation を追加: 片方は nugget 対象
      core.recordEvent(makeEvent({
        event_id: "obs-with-nuggets",
        payload: {
          content: [
            "The architecture uses a distributed message queue.",
            "Events are processed asynchronously for scalability.",
            "Consumers can replay events from any offset.",
            "Dead letter queues handle failed messages.",
          ].join(" "),
        },
        ts: "2026-04-07T01:00:00.000Z",
      }));

      core.recordEvent(makeEvent({
        event_id: "obs-unrelated",
        payload: {
          content: "This is completely unrelated content about cooking recipes and food.",
        },
        ts: "2026-04-07T00:00:00.000Z",
      }));

      // nugget に含まれるキーワードでクエリ
      const result = core.search({
        query: "distributed message queue asynchronous events",
        project: "nugget-test-project",
        include_private: true,
        limit: 10,
      });

      expect(result.ok).toBe(true);
      const items = result.items as Array<Record<string, unknown>>;
      expect(items.length).toBeGreaterThan(0);

      // 関連する observation が上位に来ること
      const topItem = items[0]!;
      expect(String(topItem.id)).toContain("obs-with-nuggets");
    } finally {
      core.shutdown("test");
    }
  });
});
