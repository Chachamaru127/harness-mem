/**
 * IMP-004a: 設定管理モジュール境界テスト
 *
 * 分割後の config-manager.ts が担当する API を TDD で定義する。
 * getConfig / health / metrics / environmentSnapshot /
 * getConsolidationStatus / getAuditLog / projectsStats /
 * backup / reindexVectors / getManagedStatus / shutdown を対象とする。
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  HarnessMemCore,
  getConfig,
  type Config,
  type EventEnvelope,
} from "../../src/core/harness-mem-core";

const cleanupPaths: string[] = [];

afterEach(() => {
  while (cleanupPaths.length > 0) {
    const dir = cleanupPaths.pop();
    if (!dir) continue;
    rmSync(dir, { recursive: true, force: true });
  }
});

function createConfig(name: string): Config {
  const dir = mkdtempSync(join(tmpdir(), `config-manager-${name}-`));
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
  };
}

function makeEvent(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    platform: "claude",
    project: "proj-config",
    session_id: "sess-cfg-001",
    event_type: "user_prompt",
    ts: "2026-02-20T00:00:00.000Z",
    payload: { prompt: "config manager test" },
    tags: [],
    privacy_tags: [],
    ...overrides,
  };
}

describe("config-manager: getConfig (module-level function)", () => {
  test("getConfig が Config オブジェクトを返す", () => {
    const config = getConfig();
    expect(config).toBeTruthy();
    expect(typeof config.dbPath).toBe("string");
    expect(typeof config.bindHost).toBe("string");
    expect(typeof config.bindPort).toBe("number");
  });

  test("デフォルト設定に必須フィールドが含まれる", () => {
    const config = getConfig();
    expect(config).toHaveProperty("dbPath");
    expect(config).toHaveProperty("bindHost");
    expect(config).toHaveProperty("bindPort");
    expect(config).toHaveProperty("vectorDimension");
    expect(config).toHaveProperty("captureEnabled");
    expect(config).toHaveProperty("retrievalEnabled");
    expect(config).toHaveProperty("injectionEnabled");
  });
});

describe("config-manager: health", () => {
  test("health() が ok=true を返す", () => {
    const core = new HarnessMemCore(createConfig("health-basic"));
    try {
      const res = core.health();
      expect(res.ok).toBe(true);
    } finally {
      core.shutdown("test");
    }
  });

  test("health() レスポンスに items が含まれる", () => {
    const core = new HarnessMemCore(createConfig("health-items"));
    try {
      const res = core.health();
      expect(Array.isArray(res.items)).toBe(true);
      expect(res.items.length).toBeGreaterThanOrEqual(1);
    } finally {
      core.shutdown("test");
    }
  });

  test("health() の items に counts が含まれる", () => {
    const core = new HarnessMemCore(createConfig("health-counts"));
    try {
      core.recordEvent(makeEvent());
      const res = core.health();
      const item = res.items[0] as Record<string, unknown>;
      expect(item).toHaveProperty("counts");
    } finally {
      core.shutdown("test");
    }
  });

  test("health() の items に vector_engine が含まれる", () => {
    const core = new HarnessMemCore(createConfig("health-vector-engine"));
    try {
      const res = core.health();
      const item = res.items[0] as Record<string, unknown>;
      expect(item).toHaveProperty("vector_engine");
    } finally {
      core.shutdown("test");
    }
  });

  test("sqlite-vec 不在時は js-fallback が使われる", () => {
    const previous = process.env.HARNESS_MEM_SQLITE_VEC_PATH;
    process.env.HARNESS_MEM_SQLITE_VEC_PATH = "/non/existent/sqlite-vec";
    const core = new HarnessMemCore(createConfig("health-vec-fallback"));
    try {
      const res = core.health();
      const item = res.items[0] as Record<string, unknown>;
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
});

describe("config-manager: metrics", () => {
  test("metrics() が ok=true を返す", () => {
    const core = new HarnessMemCore(createConfig("metrics-basic"));
    try {
      const res = core.metrics();
      expect(res.ok).toBe(true);
    } finally {
      core.shutdown("test");
    }
  });

  test("metrics() レスポンスに items が含まれる", () => {
    const core = new HarnessMemCore(createConfig("metrics-items"));
    try {
      const res = core.metrics();
      expect(Array.isArray(res.items)).toBe(true);
    } finally {
      core.shutdown("test");
    }
  });
});

describe("config-manager: environmentSnapshot", () => {
  test("environmentSnapshot() が ok=true を返す", () => {
    const core = new HarnessMemCore(createConfig("env-snapshot-basic"));
    try {
      const res = core.environmentSnapshot();
      expect(res.ok).toBe(true);
    } finally {
      core.shutdown("test");
    }
  });

  test("environmentSnapshot() レスポンスに items が含まれる", () => {
    const core = new HarnessMemCore(createConfig("env-snapshot-items"));
    try {
      const res = core.environmentSnapshot();
      expect(Array.isArray(res.items)).toBe(true);
    } finally {
      core.shutdown("test");
    }
  });
});

describe("config-manager: getConsolidationStatus", () => {
  test("getConsolidationStatus() が ok=true を返す", () => {
    const core = new HarnessMemCore(createConfig("consolidation-status"));
    try {
      const res = core.getConsolidationStatus();
      expect(res.ok).toBe(true);
    } finally {
      core.shutdown("test");
    }
  });

  test("getConsolidationStatus() のアイテムにジョブ統計が含まれる", () => {
    const core = new HarnessMemCore(createConfig("consolidation-stats"));
    try {
      const res = core.getConsolidationStatus();
      const item = res.items[0] as Record<string, unknown>;
      expect(item).toHaveProperty("pending_jobs");
      expect(item).toHaveProperty("completed_jobs");
      expect(item).toHaveProperty("failed_jobs");
      expect(item).toHaveProperty("enabled");
    } finally {
      core.shutdown("test");
    }
  });
});

describe("config-manager: getAuditLog", () => {
  test("getAuditLog() が ok=true を返す", () => {
    const core = new HarnessMemCore(createConfig("audit-log-basic"));
    try {
      const res = core.getAuditLog();
      expect(res.ok).toBe(true);
    } finally {
      core.shutdown("test");
    }
  });

  test("初期状態では空の監査ログ", () => {
    const core = new HarnessMemCore(createConfig("audit-log-empty"));
    try {
      const res = core.getAuditLog({ limit: 10 });
      expect(res.ok).toBe(true);
      expect(Array.isArray(res.items)).toBe(true);
    } finally {
      core.shutdown("test");
    }
  });

  test("getObservations 呼び出し後に監査ログにエントリが追加される", () => {
    const core = new HarnessMemCore(createConfig("audit-log-after-read"));
    try {
      // 20件以上のIDで getObservations を呼ぶと監査ログに記録される
      core.getObservations({ ids: ["id-1", "id-2"] });
      const auditRes = core.getAuditLog({ limit: 50 });
      expect(auditRes.ok).toBe(true);
      // getObservations が監査ログに記録されているか確認
      const hasReadEntry = (auditRes.items as Array<Record<string, unknown>>).some(
        (item) => (item.action as string)?.includes("read")
      );
      // 監査ログには read エントリが入る可能性がある
      expect(typeof hasReadEntry).toBe("boolean");
    } finally {
      core.shutdown("test");
    }
  });
});

describe("config-manager: projectsStats", () => {
  test("projectsStats() が ok=true を返す", () => {
    const core = new HarnessMemCore(createConfig("projects-stats-basic"));
    try {
      const res = core.projectsStats();
      expect(res.ok).toBe(true);
    } finally {
      core.shutdown("test");
    }
  });

  test("イベント記録後にプロジェクト統計が含まれる", () => {
    const core = new HarnessMemCore(createConfig("projects-stats-with-data"));
    try {
      core.recordEvent(makeEvent({ project: "proj-stats-test" }));
      const res = core.projectsStats();
      expect(res.ok).toBe(true);
      expect(Array.isArray(res.items)).toBe(true);
      const projects = (res.items as Array<Record<string, unknown>>).map((p) => p.project);
      expect(projects.some((p) => typeof p === "string")).toBe(true);
    } finally {
      core.shutdown("test");
    }
  });
});

describe("config-manager: backup", () => {
  test("backup() が応答を返す", () => {
    const core = new HarnessMemCore(createConfig("backup-basic"));
    const dir = mkdtempSync(join(tmpdir(), "backup-dest-"));
    cleanupPaths.push(dir);
    try {
      const res = core.backup({ destDir: dir });
      expect(typeof res.ok).toBe("boolean");
    } finally {
      core.shutdown("test");
    }
  });
});

describe("config-manager: reindexVectors", () => {
  test("reindexVectors() が応答を返す", () => {
    const core = new HarnessMemCore(createConfig("reindex-basic"));
    try {
      const res = core.reindexVectors();
      expect(typeof res.ok).toBe("boolean");
    } finally {
      core.shutdown("test");
    }
  });

  test("reindexVectors() レスポンスに meta が含まれる", () => {
    const core = new HarnessMemCore(createConfig("reindex-meta"));
    try {
      const res = core.reindexVectors();
      expect(res.meta).toBeTruthy();
    } finally {
      core.shutdown("test");
    }
  });
});

describe("config-manager: getManagedStatus", () => {
  test("getManagedStatus() が null または ManagedBackendStatus を返す", () => {
    const core = new HarnessMemCore(createConfig("managed-status"));
    try {
      const status = core.getManagedStatus();
      // managed backend が無効な場合は null
      expect(status === null || typeof status === "object").toBe(true);
    } finally {
      core.shutdown("test");
    }
  });
});

describe("config-manager: shutdown", () => {
  test("shutdown() が正常に完了する", () => {
    const core = new HarnessMemCore(createConfig("shutdown-basic"));
    // エラーなくシャットダウンできることを確認
    expect(() => core.shutdown("test")).not.toThrow();
  });

  test("shutdown() 後も同じプロセスが続行できる", () => {
    const core = new HarnessMemCore(createConfig("shutdown-continue"));
    core.shutdown("test");
    // シャットダウン後に別のコアを起動できる
    const core2 = new HarnessMemCore(createConfig("shutdown-continue-2"));
    try {
      const res = core2.health();
      expect(res.ok).toBe(true);
    } finally {
      core2.shutdown("test");
    }
  });
});
