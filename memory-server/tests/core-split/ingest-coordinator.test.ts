/**
 * IMP-004a: 取り込み調整モジュール境界テスト（ユニットテスト版）
 *
 * IngestCoordinator を直接インスタンス化し、モック deps を使って
 * 各メソッドが正しく動作することを検証する。
 *
 * 対象 API:
 *   ingestCodexHistory / ingestOpencodeHistory / ingestCursorHistory /
 *   ingestAntigravityHistory / ingestGeminiHistory /
 *   startClaudeMemImport / getImportJobStatus / verifyClaudeMemImport
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  IngestCoordinator,
  type IngestCoordinatorDeps,
} from "../../src/core/ingest-coordinator";
import type { ApiResponse } from "../../src/core/types";
import { createTestDb, createTestConfig } from "./test-helpers";

// ---------------------------------------------------------------------------
// ヘルパー
// ---------------------------------------------------------------------------

function makeOkResponse(extra?: Partial<ApiResponse>): ApiResponse {
  return {
    ok: true,
    source: "core",
    items: [],
    meta: { count: 0, latency_ms: 1, sla_latency_ms: 200, filters: {}, ranking: "none" },
    ...extra,
  };
}

function makeErrResponse(error: string): ApiResponse {
  return {
    ok: false,
    source: "core",
    items: [],
    meta: { count: 0, latency_ms: 1, sla_latency_ms: 200, filters: {}, ranking: "none" },
    error,
  };
}

/** すべてのモック関数を持つデフォルト deps を生成する */
function makeDeps(overrides: Partial<IngestCoordinatorDeps> = {}): IngestCoordinatorDeps {
  const db = createTestDb();
  const config = createTestConfig({
    codexHistoryEnabled: false,
    opencodeIngestEnabled: false,
    cursorIngestEnabled: false,
    antigravityIngestEnabled: false,
    geminiIngestEnabled: false,
  });
  return {
    db,
    config,
    recordEvent: mock(() => makeOkResponse()),
    visibilityFilterSql: mock(() => ""),
    upsertSessionSummary: mock(() => undefined),
    normalizeProject: mock((p: string) => p),
    isShuttingDown: mock(() => false),
    processRetryQueue: mock(() => undefined),
    runConsolidation: mock(async () => undefined),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// ingestCodexHistory
// ---------------------------------------------------------------------------

describe("ingest-coordinator: ingestCodexHistory", () => {
  let deps: IngestCoordinatorDeps;
  let coordinator: IngestCoordinator;

  beforeEach(() => {
    deps = makeDeps();
    coordinator = new IngestCoordinator(deps);
  });

  test("正常応答を返す（実データなしでも ok=true）", () => {
    const res = coordinator.ingestCodexHistory();
    expect(res.ok).toBe(true);
  });

  test("無効なパスでもクラッシュしない", () => {
    const res = coordinator.ingestCodexHistory();
    expect(typeof res.ok).toBe("boolean");
  });

  test("レスポンスに meta が含まれる", () => {
    const res = coordinator.ingestCodexHistory();
    expect(res.meta).toBeTruthy();
  });

  test("does not advance Codex rollout offset past a failed event write", () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-mem-ingest-coordinator-"));
    const sessionsRoot = join(dir, "codex-sessions");
    const dayDir = join(sessionsRoot, "2026", "03", "14");
    mkdirSync(dayDir, { recursive: true });

    const rolloutPath = join(
      dayDir,
      "rollout-2026-03-14T18-00-00-55555555-5555-5555-5555-555555555555.jsonl"
    );
    writeFileSync(
      rolloutPath,
      [
        JSON.stringify({
          timestamp: "2026-03-14T18:00:00.000Z",
          type: "session_meta",
          payload: {
            id: "55555555-5555-5555-5555-555555555555",
            cwd: "/Users/example/Desktop/Code/CC-harness/harness-mem",
          },
        }),
        JSON.stringify({
          timestamp: "2026-03-14T18:00:01.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "保存に失敗したら再試行してほしい" }],
          },
        }),
        JSON.stringify({
          timestamp: "2026-03-14T18:00:02.000Z",
          type: "event_msg",
          payload: {
            type: "agent_message",
            message: "了解しました。次回 ingest で拾い直します。",
          },
        }),
      ].join("\n") + "\n",
      "utf8"
    );

    const db = createTestDb();
    let callCount = 0;
    const failingDeps = makeDeps({
      db,
      config: createTestConfig({
        codexHistoryEnabled: true,
        codexProjectRoot: dir,
        codexSessionsRoot: sessionsRoot,
      }),
      recordEvent: mock(() => {
        callCount += 1;
        return callCount === 1 ? makeErrResponse("temporary write failure") : makeOkResponse();
      }),
    });
    const failingCoordinator = new IngestCoordinator(failingDeps);

    try {
      const first = failingCoordinator.ingestCodexHistory();
      expect(first.ok).toBe(true);
      expect(first.items[0]?.events_imported).toBe(0);

      const sourceKey = `codex_rollout:${rolloutPath}`;
      const offsetAfterFailure = db
        .query(`SELECT offset FROM mem_ingest_offsets WHERE source_key = ?`)
        .get(sourceKey) as { offset: number } | null;
      expect(offsetAfterFailure).not.toBeNull();
      expect(offsetAfterFailure?.offset).toBeLessThan(statSync(rolloutPath).size);

      failingDeps.recordEvent = mock(() => makeOkResponse());
      const retryCoordinator = new IngestCoordinator(failingDeps);
      const second = retryCoordinator.ingestCodexHistory();
      expect(second.ok).toBe(true);
      expect(second.items[0]?.events_imported).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// ingestLegacyCodexHistoryFile (§160-005b)
//
// legacy codex history (`~/.codex/history.jsonl`) は本番実測で 1 tick 173,528ms
// event loop を塞いだ。readFileSync の全文読みと無制限 entry ループが原因で、
// codex rollouts (§159-003c) と同じ「スライス読み + budget 付き entry ループ」に
// 揃える。private メソッドは型キャストで直接呼び、budgetMs を注入して決定的に
// 検証する。
// ---------------------------------------------------------------------------

describe("ingest-coordinator: ingestLegacyCodexHistoryFile (§160-005b)", () => {
  type LegacyCoordinator = {
    ingestLegacyCodexHistoryFile: (options?: { budgetMs?: number; maxBytesPerFile?: number }) => {
      eventsImported: number;
      historyEventsImported: number;
    };
  };

  const ORIGINAL_READ_SLICE = process.env.HARNESS_MEM_INGEST_READ_SLICE_BYTES;

  afterEach(() => {
    if (ORIGINAL_READ_SLICE === undefined) delete process.env.HARNESS_MEM_INGEST_READ_SLICE_BYTES;
    else process.env.HARNESS_MEM_INGEST_READ_SLICE_BYTES = ORIGINAL_READ_SLICE;
  });

  function historyLine(fields: Record<string, unknown>): string {
    return JSON.stringify(fields);
  }

  function setupHistoryFile(dir: string, content: string): string {
    const codexDir = join(dir, ".codex");
    mkdirSync(codexDir, { recursive: true });
    const historyPath = join(codexDir, "history.jsonl");
    writeFileSync(historyPath, content, "utf8");
    return historyPath;
  }

  test("読み込み上限より大きいファイルでも statSync の実サイズを基準に最後まで進む", () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-mem-legacy-codex-history-"));
    try {
      const lines = Array.from({ length: 8 }, (_, i) =>
        historyLine({ role: i % 2 === 0 ? "user" : "assistant", session_id: "s1", ts: `2026-07-29T00:00:0${i}.000Z`, content: `line-${i}` }),
      );
      const historyPath = setupHistoryFile(dir, lines.join("\n") + "\n");
      const fileSize = statSync(historyPath).size;

      // 既定 64KB よりずっと小さいスライス幅を強制し、複数スライスにまたがる読み込みを
      // 1 回の呼び出し内で発生させる。budgetMs は Infinity にして完走させ、
      // 「readSliceBytes を超えた分は二度と読まれない」旧バグが再発していないことを見る。
      process.env.HARNESS_MEM_INGEST_READ_SLICE_BYTES = "40";

      const db = createTestDb();
      const deps = makeDeps({
        db,
        config: createTestConfig({ codexHistoryEnabled: true, codexProjectRoot: dir, codexSessionsRoot: join(dir, "codex-sessions") }),
      });
      const coordinator = new IngestCoordinator(deps) as unknown as LegacyCoordinator;

      const summary = coordinator.ingestLegacyCodexHistoryFile({ budgetMs: Infinity });
      expect(summary.historyEventsImported).toBe(8);

      const sourceKey = `codex_history:${dir}`;
      const offsetRow = db.query(`SELECT offset FROM mem_ingest_offsets WHERE source_key = ?`).get(sourceKey) as {
        offset: number;
      } | null;
      expect(offsetRow?.offset).toBe(fileSize);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("recordEvent が失敗した行より先へ offset を進めず、再試行で拾い直す", () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-mem-legacy-codex-history-fail-"));
    try {
      const lines = [
        historyLine({ role: "user", session_id: "s1", ts: "2026-07-29T00:00:00.000Z", content: "first" }),
        historyLine({ role: "assistant", session_id: "s1", ts: "2026-07-29T00:00:01.000Z", content: "second" }),
        historyLine({ role: "user", session_id: "s1", ts: "2026-07-29T00:00:02.000Z", content: "third" }),
      ];
      const historyPath = setupHistoryFile(dir, lines.join("\n") + "\n");
      const fileSize = statSync(historyPath).size;

      const db = createTestDb();
      let callCount = 0;
      const deps = makeDeps({
        db,
        config: createTestConfig({ codexHistoryEnabled: true, codexProjectRoot: dir, codexSessionsRoot: join(dir, "codex-sessions") }),
        recordEvent: mock(() => {
          callCount += 1;
          return callCount === 1 ? makeErrResponse("temporary write failure") : makeOkResponse();
        }),
      });

      const first = new IngestCoordinator(deps).ingestCodexHistory();
      expect(first.ok).toBe(true);
      expect(first.items[0]?.history_events_imported).toBe(0);

      const sourceKey = `codex_history:${dir}`;
      const offsetAfterFailure = db.query(`SELECT offset FROM mem_ingest_offsets WHERE source_key = ?`).get(sourceKey) as {
        offset: number;
      } | null;
      expect(offsetAfterFailure).not.toBeNull();
      expect(offsetAfterFailure?.offset ?? -1).toBeLessThan(fileSize);

      deps.recordEvent = mock(() => makeOkResponse());
      const second = new IngestCoordinator(deps).ingestCodexHistory();
      expect(second.ok).toBe(true);
      expect(second.items[0]?.history_events_imported).toBe(3);

      const offsetAfterRetry = db.query(`SELECT offset FROM mem_ingest_offsets WHERE source_key = ?`).get(sourceKey) as {
        offset: number;
      } | null;
      expect(offsetAfterRetry?.offset).toBe(fileSize);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("budget 超過で打ち切った次の tick が続きから再開する (取りこぼしも重複もしない)", () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-mem-legacy-codex-history-budget-"));
    try {
      const lines = [
        historyLine({ role: "user", session_id: "s1", ts: "2026-07-29T00:00:00.000Z", content: "one" }),
        historyLine({ role: "assistant", session_id: "s1", ts: "2026-07-29T00:00:01.000Z", content: "two" }),
        historyLine({ role: "user", session_id: "s1", ts: "2026-07-29T00:00:02.000Z", content: "three" }),
        historyLine({ role: "assistant", session_id: "s1", ts: "2026-07-29T00:00:03.000Z", content: "four" }),
      ];
      const historyPath = setupHistoryFile(dir, lines.join("\n") + "\n");
      const fileSize = statSync(historyPath).size;

      const db = createTestDb();
      const recordedHashes: string[] = [];
      const deps = makeDeps({
        db,
        config: createTestConfig({ codexHistoryEnabled: true, codexProjectRoot: dir, codexSessionsRoot: join(dir, "codex-sessions") }),
        recordEvent: mock((event: { dedupe_hash?: string }) => {
          // recordEvent 自体を意図的に遅くし、budgetMs 判定を wall-clock で確実に
          // 超過させる (Date.now() の 1ms 解像度に依存すると flaky になるため)。
          const until = Date.now() + 5;
          while (Date.now() < until) {
            /* busy-wait */
          }
          recordedHashes.push(event.dedupe_hash ?? "");
          return makeOkResponse();
        }),
      });
      const coordinator = new IngestCoordinator(deps) as unknown as LegacyCoordinator;

      const firstTick = coordinator.ingestLegacyCodexHistoryFile({ budgetMs: 1 });
      expect(firstTick.historyEventsImported).toBe(1);

      const sourceKey = `codex_history:${dir}`;
      const offsetAfterFirstTick = db.query(`SELECT offset FROM mem_ingest_offsets WHERE source_key = ?`).get(sourceKey) as {
        offset: number;
      } | null;
      expect(offsetAfterFirstTick?.offset ?? -1).toBeGreaterThan(0);
      expect(offsetAfterFirstTick?.offset ?? -1).toBeLessThan(fileSize);

      const secondTick = coordinator.ingestLegacyCodexHistoryFile({ budgetMs: Infinity });
      expect(secondTick.historyEventsImported).toBe(3);

      const offsetAfterSecondTick = db.query(`SELECT offset FROM mem_ingest_offsets WHERE source_key = ?`).get(sourceKey) as {
        offset: number;
      } | null;
      expect(offsetAfterSecondTick?.offset).toBe(fileSize);

      // 4 行それぞれ厳密に 1 回だけ recordEvent が呼ばれている (取りこぼしも重複もない)
      expect(recordedHashes.length).toBe(4);
      expect(new Set(recordedHashes).size).toBe(4);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("offset がファイルサイズを超えていたら 0 にリセットして先頭から取り込み直す", () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-mem-legacy-codex-history-truncate-"));
    try {
      const longLines = Array.from({ length: 5 }, (_, i) =>
        historyLine({ role: "user", session_id: "s1", ts: `2026-07-29T00:00:0${i}.000Z`, content: `pre-truncate-${i}` }),
      );
      const historyPath = setupHistoryFile(dir, longLines.join("\n") + "\n");

      const db = createTestDb();
      const deps = makeDeps({
        db,
        config: createTestConfig({ codexHistoryEnabled: true, codexProjectRoot: dir, codexSessionsRoot: join(dir, "codex-sessions") }),
      });

      const before = new IngestCoordinator(deps).ingestCodexHistory();
      expect(before.items[0]?.history_events_imported).toBe(5);

      const sourceKey = `codex_history:${dir}`;
      const offsetBeforeTruncate = db.query(`SELECT offset FROM mem_ingest_offsets WHERE source_key = ?`).get(sourceKey) as {
        offset: number;
      } | null;
      const sizeBeforeTruncate = statSync(historyPath).size;
      expect(offsetBeforeTruncate?.offset).toBe(sizeBeforeTruncate);

      // ファイルを短い内容で上書き (ローテーション/切り詰めを模す): 永続化済み offset > 新しい fileSize
      const shortLine = historyLine({ role: "user", session_id: "s2", ts: "2026-07-29T01:00:00.000Z", content: "post-truncate" });
      writeFileSync(historyPath, shortLine + "\n", "utf8");
      const sizeAfterTruncate = statSync(historyPath).size;
      expect(sizeAfterTruncate).toBeLessThan(sizeBeforeTruncate);

      const after = new IngestCoordinator(deps).ingestCodexHistory();
      expect(after.items[0]?.history_events_imported).toBe(1);

      const offsetAfterTruncate = db.query(`SELECT offset FROM mem_ingest_offsets WHERE source_key = ?`).get(sourceKey) as {
        offset: number;
      } | null;
      expect(offsetAfterTruncate?.offset).toBe(sizeAfterTruncate);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("明示 API (ingestCodexHistory) は budget / read slice を極小に設定していても legacy を完走させる", () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-mem-legacy-codex-history-explicit-"));
    const ORIGINAL_BUDGET = process.env.HARNESS_MEM_INGEST_TICK_BUDGET_MS;
    try {
      const lines = Array.from({ length: 6 }, (_, i) =>
        historyLine({ role: i % 2 === 0 ? "user" : "assistant", session_id: "s1", ts: `2026-07-29T00:00:0${i}.000Z`, content: `entry-number-${i}` }),
      );
      const historyPath = setupHistoryFile(dir, lines.join("\n") + "\n");
      const fileSize = statSync(historyPath).size;

      // tick 用の既定値を極小にしても、明示 API は budgetMs: Infinity / maxBytesPerFile:
      // Infinity で呼ぶため readSliceBytes が小さいだけでは完走を妨げないことを確認する。
      process.env.HARNESS_MEM_INGEST_TICK_BUDGET_MS = "1";
      process.env.HARNESS_MEM_INGEST_READ_SLICE_BYTES = "10";

      const db = createTestDb();
      const deps = makeDeps({
        db,
        config: createTestConfig({ codexHistoryEnabled: true, codexProjectRoot: dir, codexSessionsRoot: join(dir, "codex-sessions") }),
      });

      const res = new IngestCoordinator(deps).ingestCodexHistory();
      expect(res.ok).toBe(true);
      expect(res.items[0]?.history_events_imported).toBe(6);

      const sourceKey = `codex_history:${dir}`;
      const offsetRow = db.query(`SELECT offset FROM mem_ingest_offsets WHERE source_key = ?`).get(sourceKey) as {
        offset: number;
      } | null;
      expect(offsetRow?.offset).toBe(fileSize);
    } finally {
      if (ORIGINAL_BUDGET === undefined) delete process.env.HARNESS_MEM_INGEST_TICK_BUDGET_MS;
      else process.env.HARNESS_MEM_INGEST_TICK_BUDGET_MS = ORIGINAL_BUDGET;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// ingestOpencodeHistory
// ---------------------------------------------------------------------------

describe("ingest-coordinator: ingestOpencodeHistory", () => {
  let deps: IngestCoordinatorDeps;
  let coordinator: IngestCoordinator;

  beforeEach(() => {
    deps = makeDeps();
    coordinator = new IngestCoordinator(deps);
  });

  test("正常応答を返す（opencodeIngestEnabled=false でもクラッシュしない）", () => {
    const res = coordinator.ingestOpencodeHistory();
    expect(typeof res.ok).toBe("boolean");
  });

  test("存在しないパスでもクラッシュしない", () => {
    const res = coordinator.ingestOpencodeHistory();
    expect(typeof res.ok).toBe("boolean");
  });
});

// ---------------------------------------------------------------------------
// ingestCursorHistory
// ---------------------------------------------------------------------------

describe("ingest-coordinator: ingestCursorHistory", () => {
  let deps: IngestCoordinatorDeps;
  let coordinator: IngestCoordinator;

  beforeEach(() => {
    deps = makeDeps();
    coordinator = new IngestCoordinator(deps);
  });

  test("cursorIngestEnabled=false でもクラッシュしない", () => {
    const res = coordinator.ingestCursorHistory();
    expect(typeof res.ok).toBe("boolean");
  });

  test("レスポンスが ApiResponse 構造を持つ", () => {
    const res = coordinator.ingestCursorHistory();
    expect(res).toHaveProperty("ok");
    expect(res).toHaveProperty("items");
    expect(res).toHaveProperty("meta");
  });
});

// ---------------------------------------------------------------------------
// ingestAntigravityHistory
// ---------------------------------------------------------------------------

describe("ingest-coordinator: ingestAntigravityHistory", () => {
  let deps: IngestCoordinatorDeps;
  let coordinator: IngestCoordinator;

  beforeEach(() => {
    deps = makeDeps();
    coordinator = new IngestCoordinator(deps);
  });

  test("antigravityIngestEnabled=false でもクラッシュしない", () => {
    const res = coordinator.ingestAntigravityHistory();
    expect(typeof res.ok).toBe("boolean");
  });

  test("レスポンスが ApiResponse 構造を持つ", () => {
    const res = coordinator.ingestAntigravityHistory();
    expect(res).toHaveProperty("ok");
    expect(res).toHaveProperty("items");
    expect(res).toHaveProperty("meta");
  });
});

// ---------------------------------------------------------------------------
// ingestGeminiHistory
// ---------------------------------------------------------------------------

describe("ingest-coordinator: ingestGeminiHistory", () => {
  let deps: IngestCoordinatorDeps;
  let coordinator: IngestCoordinator;

  beforeEach(() => {
    deps = makeDeps();
    coordinator = new IngestCoordinator(deps);
  });

  test("正常応答を返す", () => {
    const res = coordinator.ingestGeminiHistory();
    expect(typeof res.ok).toBe("boolean");
  });

  test("レスポンスが ApiResponse 構造を持つ", () => {
    const res = coordinator.ingestGeminiHistory();
    expect(res).toHaveProperty("ok");
    expect(res).toHaveProperty("items");
    expect(res).toHaveProperty("meta");
  });
});

describe("ingest-coordinator: Claude Code timer startup", () => {
  test("delays Claude Code ingest startup until the configured interval", () => {
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    const timeoutDelays: number[] = [];
    const intervalDelays: number[] = [];

    try {
      globalThis.setTimeout = (((fn: (...args: unknown[]) => void, delay?: number) => {
        timeoutDelays.push(Number(delay ?? 0));
        fn();
        return 1 as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout);
      globalThis.clearTimeout = ((() => undefined) as typeof clearTimeout);
      globalThis.setInterval = (((_fn: (...args: unknown[]) => void, delay?: number) => {
        intervalDelays.push(Number(delay ?? 0));
        return 1 as unknown as ReturnType<typeof setInterval>;
      }) as typeof setInterval);
      globalThis.clearInterval = ((() => undefined) as typeof clearInterval);

      const deps = makeDeps({
        config: createTestConfig({
          claudeCodeIngestEnabled: true,
          claudeCodeIngestIntervalMs: 12345,
        }),
      });
      const coordinator = new IngestCoordinator(deps);
      const ingestSpy = mock(() => makeOkResponse());
      (coordinator as unknown as { ingestClaudeCodeSessions: () => ApiResponse }).ingestClaudeCodeSessions = ingestSpy;

      coordinator.startTimers();

      expect(timeoutDelays).toContain(12345);
      expect(timeoutDelays).not.toContain(0);
      expect(intervalDelays).toContain(12345);
      expect(ingestSpy).toHaveBeenCalledTimes(1);
      coordinator.stopTimers();
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
      globalThis.setInterval = originalSetInterval;
      globalThis.clearInterval = originalClearInterval;
    }
  });
});

// ---------------------------------------------------------------------------
// startClaudeMemImport
// ---------------------------------------------------------------------------

describe("ingest-coordinator: startClaudeMemImport", () => {
  test("source_db_path なしはエラーを返す", () => {
    const deps = makeDeps();
    const coordinator = new IngestCoordinator(deps);

    const res = coordinator.startClaudeMemImport({ source_db_path: "" });
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
  });

  test("存在しないパスはエラーを返す", () => {
    const deps = makeDeps();
    const coordinator = new IngestCoordinator(deps);

    const res = coordinator.startClaudeMemImport({
      source_db_path: "/tmp/nonexistent-claude-mem-12345.db",
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
  });

  test("source_db_path が自分自身の DB パスの場合エラーを返す", () => {
    const selfPath = "/some/dir/harness-mem.db";
    const deps = makeDeps({
      config: createTestConfig({ dbPath: selfPath }),
    });
    const coordinator = new IngestCoordinator(deps);

    const res = coordinator.startClaudeMemImport({ source_db_path: selfPath });
    expect(res.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getImportJobStatus
// ---------------------------------------------------------------------------

describe("ingest-coordinator: getImportJobStatus", () => {
  test("存在しないジョブ ID はエラーを返す", () => {
    const deps = makeDeps();
    const coordinator = new IngestCoordinator(deps);

    const res = coordinator.getImportJobStatus({ job_id: "nonexistent-job-id-12345" });
    expect(res.ok).toBe(false);
  });

  test("job_id なしはエラーを返す", () => {
    const deps = makeDeps();
    const coordinator = new IngestCoordinator(deps);

    const res = coordinator.getImportJobStatus({ job_id: "" });
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// verifyClaudeMemImport
// ---------------------------------------------------------------------------

describe("ingest-coordinator: verifyClaudeMemImport", () => {
  test("存在しないジョブ ID はエラーを返す", () => {
    const deps = makeDeps();
    const coordinator = new IngestCoordinator(deps);

    const res = coordinator.verifyClaudeMemImport({ job_id: "nonexistent-verify-job-12345" });
    expect(res.ok).toBe(false);
  });

  test("job_id なしはエラーを返す", () => {
    const deps = makeDeps();
    const coordinator = new IngestCoordinator(deps);

    const res = coordinator.verifyClaudeMemImport({ job_id: "" });
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
  });
});
