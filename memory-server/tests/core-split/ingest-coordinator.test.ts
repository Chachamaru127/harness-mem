/**
 * IMP-004a: 取り込み調整モジュール境界テスト
 *
 * 分割後の ingest-coordinator.ts が担当する API を TDD で定義する。
 * ingestCodexHistory / ingestOpencodeHistory / ingestCursorHistory /
 * ingestAntigravityHistory / ingestGeminiHistory /
 * startClaudeMemImport / getImportJobStatus / verifyClaudeMemImport を対象とする。
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  HarnessMemCore,
  type Config,
} from "../../src/core/harness-mem-core";

const cleanupPaths: string[] = [];

afterEach(() => {
  while (cleanupPaths.length > 0) {
    const dir = cleanupPaths.pop();
    if (!dir) continue;
    rmSync(dir, { recursive: true, force: true });
  }
});

function createConfig(name: string, overrides: Partial<Config> = {}): Config {
  const dir = mkdtempSync(join(tmpdir(), `ingest-coord-${name}-`));
  cleanupPaths.push(dir);
  return {
    dbPath: join(dir, "harness-mem.db"),
    bindHost: "127.0.0.1",
    bindPort: 37888,
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
    ...overrides,
  };
}

describe("ingest-coordinator: ingestCodexHistory", () => {
  test("正常応答を返す（実データなしでも ok=true）", () => {
    const core = new HarnessMemCore(createConfig("codex-no-history", {
      codexHistoryEnabled: true,
      codexSessionsRoot: "/tmp/nonexistent-codex-sessions",
    }));
    try {
      const res = core.ingestCodexHistory();
      expect(res.ok).toBe(true);
    } finally {
      core.shutdown("test");
    }
  });

  test("無効なパスでもクラッシュしない", () => {
    const core = new HarnessMemCore(createConfig("codex-invalid-path", {
      codexHistoryEnabled: true,
      codexSessionsRoot: "/completely/nonexistent/path/12345",
    }));
    try {
      const res = core.ingestCodexHistory();
      expect(typeof res.ok).toBe("boolean");
    } finally {
      core.shutdown("test");
    }
  });

  test("レスポンスに meta が含まれる", () => {
    const core = new HarnessMemCore(createConfig("codex-meta"));
    try {
      const res = core.ingestCodexHistory();
      expect(res.meta).toBeTruthy();
    } finally {
      core.shutdown("test");
    }
  });
});

describe("ingest-coordinator: ingestOpencodeHistory", () => {
  test("正常応答を返す（opencodeIngestEnabled=false でもクラッシュしない）", () => {
    const core = new HarnessMemCore(createConfig("opencode-disabled"));
    try {
      const res = core.ingestOpencodeHistory();
      expect(typeof res.ok).toBe("boolean");
    } finally {
      core.shutdown("test");
    }
  });

  test("存在しないパスでもクラッシュしない", () => {
    const core = new HarnessMemCore(createConfig("opencode-no-path", {
      opencodeIngestEnabled: true,
    }));
    try {
      const res = core.ingestOpencodeHistory();
      expect(typeof res.ok).toBe("boolean");
    } finally {
      core.shutdown("test");
    }
  });
});

describe("ingest-coordinator: ingestCursorHistory", () => {
  test("cursorIngestEnabled=false でもクラッシュしない", () => {
    const core = new HarnessMemCore(createConfig("cursor-disabled"));
    try {
      const res = core.ingestCursorHistory();
      expect(typeof res.ok).toBe("boolean");
    } finally {
      core.shutdown("test");
    }
  });

  test("レスポンスが ApiResponse 構造を持つ", () => {
    const core = new HarnessMemCore(createConfig("cursor-response-shape"));
    try {
      const res = core.ingestCursorHistory();
      expect(res).toHaveProperty("ok");
      expect(res).toHaveProperty("items");
      expect(res).toHaveProperty("meta");
    } finally {
      core.shutdown("test");
    }
  });
});

describe("ingest-coordinator: ingestAntigravityHistory", () => {
  test("antigravityIngestEnabled=false でもクラッシュしない", () => {
    const core = new HarnessMemCore(createConfig("antigravity-disabled"));
    try {
      const res = core.ingestAntigravityHistory();
      expect(typeof res.ok).toBe("boolean");
    } finally {
      core.shutdown("test");
    }
  });

  test("レスポンスが ApiResponse 構造を持つ", () => {
    const core = new HarnessMemCore(createConfig("antigravity-response-shape"));
    try {
      const res = core.ingestAntigravityHistory();
      expect(res).toHaveProperty("ok");
      expect(res).toHaveProperty("items");
      expect(res).toHaveProperty("meta");
    } finally {
      core.shutdown("test");
    }
  });
});

describe("ingest-coordinator: ingestGeminiHistory", () => {
  test("正常応答を返す", () => {
    const core = new HarnessMemCore(createConfig("gemini-basic"));
    try {
      const res = core.ingestGeminiHistory();
      expect(typeof res.ok).toBe("boolean");
    } finally {
      core.shutdown("test");
    }
  });

  test("レスポンスが ApiResponse 構造を持つ", () => {
    const core = new HarnessMemCore(createConfig("gemini-response-shape"));
    try {
      const res = core.ingestGeminiHistory();
      expect(res).toHaveProperty("ok");
      expect(res).toHaveProperty("items");
      expect(res).toHaveProperty("meta");
    } finally {
      core.shutdown("test");
    }
  });
});

describe("ingest-coordinator: startClaudeMemImport", () => {
  test("source_db_path なしはエラーを返す", () => {
    const core = new HarnessMemCore(createConfig("import-no-path"));
    try {
      const res = core.startClaudeMemImport({ source_db_path: "" });
      expect(res.ok).toBe(false);
      expect(res.error).toBeTruthy();
    } finally {
      core.shutdown("test");
    }
  });

  test("存在しないパスはエラーを返す", () => {
    const core = new HarnessMemCore(createConfig("import-nonexistent"));
    try {
      const res = core.startClaudeMemImport({
        source_db_path: "/tmp/nonexistent-claude-mem-12345.db",
      });
      expect(res.ok).toBe(false);
      expect(res.error).toBeTruthy();
    } finally {
      core.shutdown("test");
    }
  });

  test("source_db_path が自分自身の DB パスの場合エラーを返す", () => {
    const dir = mkdtempSync(join(tmpdir(), "ingest-coord-self-import-"));
    cleanupPaths.push(dir);
    const dbPath = join(dir, "harness-mem.db");
    const config: Config = {
      dbPath,
      bindHost: "127.0.0.1",
      bindPort: 37888,
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
    const core = new HarnessMemCore(config);
    try {
      // 自己インポートはエラーになるはず
      const res = core.startClaudeMemImport({ source_db_path: dbPath });
      expect(res.ok).toBe(false);
    } finally {
      core.shutdown("test");
    }
  });
});

describe("ingest-coordinator: getImportJobStatus", () => {
  test("存在しないジョブ ID はエラーを返す", () => {
    const core = new HarnessMemCore(createConfig("import-status-nonexistent"));
    try {
      const res = core.getImportJobStatus({ job_id: "nonexistent-job-id-12345" });
      expect(res.ok).toBe(false);
    } finally {
      core.shutdown("test");
    }
  });
});

describe("ingest-coordinator: verifyClaudeMemImport", () => {
  test("存在しないジョブ ID はエラーを返す", () => {
    const core = new HarnessMemCore(createConfig("import-verify-nonexistent"));
    try {
      const res = core.verifyClaudeMemImport({ job_id: "nonexistent-verify-job-12345" });
      expect(res.ok).toBe(false);
    } finally {
      core.shutdown("test");
    }
  });
});
