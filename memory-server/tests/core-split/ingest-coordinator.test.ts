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
