/**
 * V5-004: Memory Model テスト
 *
 * テストケース:
 * 1. classifyMemoryType: session_start → episodic
 * 2. classifyMemoryType: session_end → episodic
 * 3. classifyMemoryType: tool_use → procedural
 * 4. classifyMemoryType: "how to install" → procedural
 * 5. classifyMemoryType: "step by step procedure" → procedural
 * 6. classifyMemoryType: 一般テキスト → semantic
 * 7. classifyMemoryType: 日本語 "発生した" → episodic
 * 8. classifyMemoryType: 日本語 "手順" → procedural
 * 9. classifyMemoryType: コードブロックを含む → procedural
 * 10. recordEvent で memory_type が正しくレスポンスに含まれる
 * 11. recordEvent: session_start → memory_type = episodic
 * 12. search の memory_type フィルタテスト
 * 13. search: 複数 memory_type でのフィルタテスト
 * 14. feed の memory_type フィルタテスト
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HarnessMemCore, type Config, type EventEnvelope } from "../src/core/harness-mem-core";

const cleanupPaths: string[] = [];

afterEach(() => {
  while (cleanupPaths.length > 0) {
    const dir = cleanupPaths.pop();
    if (!dir) continue;
    rmSync(dir, { recursive: true, force: true });
  }
});

function createConfig(name: string): Config {
  const dir = mkdtempSync(join(tmpdir(), `harness-memtype-${name}-`));
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
    backgroundWorkersEnabled: false,
  };
}

function makeEvent(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    event_type: "checkpoint",
    session_id: "test-session",
    platform: "claude",
    project: "test-project",
    payload: { title: "Test Event", content: "test content" },
    tags: [],
    privacy_tags: [],
    ...overrides,
  };
}

/** recordEvent のレスポンスから memory_type を取得 */
function getMemoryType(res: ReturnType<HarnessMemCore["recordEvent"]>): string | undefined {
  const item = res.items[0] as Record<string, unknown> | undefined;
  return typeof item?.memory_type === "string" ? item.memory_type : undefined;
}

// ---------------------------------------------------------------------------
// 1-9. classifyMemoryType 分類テスト（recordEvent レスポンス経由）
// ---------------------------------------------------------------------------

describe("V5-004: classifyMemoryType 自動分類", () => {
  test("1. session_start イベントは episodic に分類される", () => {
    const core = new HarnessMemCore(createConfig("cls-session-start"));
    const res = core.recordEvent(makeEvent({
      event_type: "session_start",
      payload: { title: "Session started", content: "Starting new session" },
    }));
    expect(res.ok).toBe(true);
    expect(getMemoryType(res)).toBe("episodic");
  });

  test("2. session_end イベントは episodic に分類される", () => {
    const core = new HarnessMemCore(createConfig("cls-session-end"));
    core.recordEvent(makeEvent({
      event_type: "session_start",
      payload: { title: "Session started", content: "start" },
    }));
    const res = core.recordEvent(makeEvent({
      event_type: "session_end",
      payload: { title: "Session ended", content: "Ending the session" },
    }));
    expect(res.ok).toBe(true);
    expect(getMemoryType(res)).toBe("episodic");
  });

  test("3. tool_use イベントは procedural に分類される", () => {
    const core = new HarnessMemCore(createConfig("cls-tool-use"));
    const res = core.recordEvent(makeEvent({
      event_type: "tool_use",
      payload: { title: "Run test", content: "bun test" },
    }));
    expect(res.ok).toBe(true);
    expect(getMemoryType(res)).toBe("procedural");
  });

  test('4. "how to install" キーワードを含む場合は procedural に分類される', () => {
    const core = new HarnessMemCore(createConfig("cls-howto"));
    const res = core.recordEvent(makeEvent({
      payload: { title: "Setup guide", content: "how to install bun on macOS" },
    }));
    expect(res.ok).toBe(true);
    expect(getMemoryType(res)).toBe("procedural");
  });

  test('5. "step" キーワードを含む場合は procedural に分類される', () => {
    const core = new HarnessMemCore(createConfig("cls-steps"));
    const res = core.recordEvent(makeEvent({
      payload: { title: "Deployment steps", content: "Follow these steps to deploy: step 1 ..." },
    }));
    expect(res.ok).toBe(true);
    expect(getMemoryType(res)).toBe("procedural");
  });

  test("6. 一般的なテキストは semantic に分類される", () => {
    const core = new HarnessMemCore(createConfig("cls-semantic"));
    const res = core.recordEvent(makeEvent({
      payload: { title: "Project overview", content: "This project uses TypeScript and SQLite for the backend." },
    }));
    expect(res.ok).toBe(true);
    expect(getMemoryType(res)).toBe("semantic");
  });

  test('7. 日本語 "発生した" キーワードは episodic に分類される', () => {
    const core = new HarnessMemCore(createConfig("cls-ja-episodic"));
    const res = core.recordEvent(makeEvent({
      payload: { title: "バグ報告", content: "エラーが発生した。スタックトレースを確認する。" },
    }));
    expect(res.ok).toBe(true);
    expect(getMemoryType(res)).toBe("episodic");
  });

  test('8. 日本語 "手順" キーワードは procedural に分類される', () => {
    const core = new HarnessMemCore(createConfig("cls-ja-procedural"));
    const res = core.recordEvent(makeEvent({
      payload: { title: "デプロイ手順", content: "本番環境へのデプロイ手順を記録する。" },
    }));
    expect(res.ok).toBe(true);
    expect(getMemoryType(res)).toBe("procedural");
  });

  test("9. コードブロックを含むコンテンツは procedural に分類される", () => {
    const core = new HarnessMemCore(createConfig("cls-codeblock"));
    const res = core.recordEvent(makeEvent({
      payload: {
        title: "Code example",
        content: "Run the following:\n```bash\nbun install\nbun run build\n```",
      },
    }));
    expect(res.ok).toBe(true);
    expect(getMemoryType(res)).toBe("procedural");
  });
});

// ---------------------------------------------------------------------------
// 10-11. recordEvent で memory_type が正しくレスポンスに含まれる
// ---------------------------------------------------------------------------

describe("V5-004: recordEvent での memory_type 保存", () => {
  test("10. checkpoint イベントで semantic が返される", () => {
    const core = new HarnessMemCore(createConfig("save-semantic"));
    const res = core.recordEvent(makeEvent({
      payload: { title: "Architecture note", content: "The system uses a microservices architecture." },
    }));
    expect(res.ok).toBe(true);
    expect(getMemoryType(res)).toBe("semantic");
  });

  test("11. session_start イベントで episodic が返される", () => {
    const core = new HarnessMemCore(createConfig("save-episodic"));
    const res = core.recordEvent(makeEvent({
      event_type: "session_start",
      payload: { title: "New session", content: "Starting work on feature X" },
    }));
    expect(res.ok).toBe(true);
    expect(getMemoryType(res)).toBe("episodic");
  });
});

// ---------------------------------------------------------------------------
// 12-13. search の memory_type フィルタテスト
// ---------------------------------------------------------------------------

describe("V5-004: search の memory_type フィルタ", () => {
  test("12. memory_type=semantic フィルタで semantic のみ返る", () => {
    const core = new HarnessMemCore(createConfig("search-filter-semantic"));

    // semantic な観察
    core.recordEvent(makeEvent({
      session_id: "s1",
      payload: { title: "TypeScript fact", content: "TypeScript is a typed superset of JavaScript knowledge base." },
    }));

    // episodic な観察（session_start）
    core.recordEvent(makeEvent({
      event_type: "session_start",
      session_id: "s2",
      payload: { title: "Session started", content: "Session started today morning" },
    }));

    const res = core.search({
      query: "TypeScript",
      project: "test-project",
      memory_type: "semantic",
      limit: 10,
      strict_project: true,
    });

    expect(res.ok).toBe(true);
    const items = res.items as Array<Record<string, unknown>>;
    // 返ったアイテムがすべて semantic であること
    for (const item of items) {
      expect(item.memory_type).toBe("semantic");
    }
  });

  test("13. 複数 memory_type フィルタ [episodic, procedural] で semantic が除外される", () => {
    const core = new HarnessMemCore(createConfig("search-filter-multi"));
    const uniqueKey = `multifilter-${Date.now()}`;

    // semantic な観察
    core.recordEvent(makeEvent({
      session_id: "sm1",
      payload: { title: `${uniqueKey} Semantic fact`, content: `${uniqueKey} This is a fact about the system.` },
    }));

    // procedural な観察
    core.recordEvent(makeEvent({
      event_type: "tool_use",
      session_id: "sm2",
      payload: { title: `${uniqueKey} Procedural action`, content: `${uniqueKey} Executed build command` },
    }));

    const res = core.search({
      query: uniqueKey,
      project: "test-project",
      memory_type: ["episodic", "procedural"],
      limit: 20,
      strict_project: true,
    });

    expect(res.ok).toBe(true);
    const items = res.items as Array<Record<string, unknown>>;
    // 返ったアイテムに semantic が含まれないこと
    for (const item of items) {
      expect(item.memory_type).not.toBe("semantic");
    }
    // procedural な観察が含まれること
    const hasProc = items.some((item) => item.memory_type === "procedural");
    expect(hasProc).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 14. feed の memory_type フィルタテスト
// ---------------------------------------------------------------------------

describe("V5-004: feed の memory_type フィルタ", () => {
  test("14. feed で memory_type=procedural フィルタが正しく動作する", () => {
    const core = new HarnessMemCore(createConfig("feed-filter"));

    // procedural な観察
    core.recordEvent(makeEvent({
      event_type: "tool_use",
      session_id: "f1",
      payload: { title: "Tool execution", content: "bun run build" },
    }));

    // semantic な観察
    core.recordEvent(makeEvent({
      session_id: "f2",
      payload: { title: "System info", content: "The database uses SQLite WAL mode." },
    }));

    const res = core.feed({
      project: "test-project",
      memory_type: "procedural",
      limit: 20,
    });

    expect(res.ok).toBe(true);
    const items = res.items as Array<Record<string, unknown>>;
    // 全アイテムが procedural であること
    for (const item of items) {
      expect(item.memory_type).toBe("procedural");
    }
    // procedural な観察が少なくとも1件含まれること
    expect(items.length).toBeGreaterThanOrEqual(1);
  });
});
