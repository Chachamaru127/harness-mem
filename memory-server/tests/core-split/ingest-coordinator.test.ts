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

import { beforeEach, describe, expect, mock, test } from "bun:test";
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
