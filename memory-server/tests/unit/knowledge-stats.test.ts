/**
 * TEAM-010: ナレッジマップ + 利用統計 テスト
 *
 * テストケース:
 * 1. 正常: knowledgeStats がファクト分布を返す
 * 2. 正常: ファクト分布に fact_type 別カウントが含まれる
 * 3. 正常: プロジェクト別の観察数が返される
 * 4. 正常: 利用統計（検索/記録カウント）が返される
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HarnessMemCore, type Config, type EventEnvelope } from "../../src/core/harness-mem-core";

const cleanupPaths: string[] = [];

afterEach(() => {
  while (cleanupPaths.length > 0) {
    const dir = cleanupPaths.pop();
    if (!dir) continue;
    rmSync(dir, { recursive: true, force: true });
  }
});

function createConfig(name: string): Config {
  const dir = mkdtempSync(join(tmpdir(), `harness-mem-kstats-${name}-`));
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
    localModelsEnabled: false,
    antigravityEnabled: false,
  };
}

function makeEvent(title: string, content: string, project = "proj-a", session = "sess-1"): EventEnvelope {
  return {
    event_type: "observation",
    platform: "claude",
    project,
    session_id: session,
    payload: { title, content, observation_type: "context" },
    metadata: {},
  };
}

describe("TEAM-010: ナレッジマップ + 利用統計", () => {
  test("正常: knowledgeStats がファクト分布を返す", async () => {
    const core = new HarnessMemCore(createConfig("basic"));
    await core.recordEvent(makeEvent("観察1", "Bun を採用した"));
    await core.recordEvent(makeEvent("観察2", "PostgreSQL を使用する"));

    const result = core.knowledgeStats({});
    expect(result.ok).toBe(true);
    expect(result.items.length).toBeGreaterThan(0);
    const stats = result.items[0] as Record<string, unknown>;
    expect(stats).toHaveProperty("facts_by_type");
    expect(stats).toHaveProperty("observations_by_project");
    expect(stats).toHaveProperty("total_facts");
    expect(stats).toHaveProperty("total_observations");
  });

  test("正常: ファクト分布に fact_type 別カウントが含まれる", async () => {
    const core = new HarnessMemCore(createConfig("dist"));
    await core.recordEvent(makeEvent("観察1", "Content 1"));

    const result = core.knowledgeStats({});
    const stats = result.items[0] as Record<string, unknown>;
    const factsByType = stats.facts_by_type as unknown[];
    expect(Array.isArray(factsByType)).toBe(true);
    // 各要素が fact_type と count を持つ
    for (const item of factsByType) {
      const entry = item as Record<string, unknown>;
      expect(entry).toHaveProperty("fact_type");
      expect(entry).toHaveProperty("count");
      expect(typeof entry.count).toBe("number");
    }
  });

  test("正常: プロジェクト別の観察数が返される", async () => {
    const core = new HarnessMemCore(createConfig("projects"));
    await core.recordEvent(makeEvent("Obs A1", "Content A1", "proj-alpha"));
    await core.recordEvent(makeEvent("Obs A2", "Content A2", "proj-alpha"));
    await core.recordEvent(makeEvent("Obs B1", "Content B1", "proj-beta"));

    const result = core.knowledgeStats({});
    const stats = result.items[0] as Record<string, unknown>;
    const obsByProject = stats.observations_by_project as unknown[];
    expect(Array.isArray(obsByProject)).toBe(true);
    expect(obsByProject.length).toBeGreaterThanOrEqual(2);

    const alphaEntry = obsByProject.find(
      (e) => (e as Record<string, unknown>).project === "proj-alpha"
    ) as Record<string, unknown> | undefined;
    expect(alphaEntry).toBeDefined();
    expect(Number(alphaEntry?.count)).toBe(2);
  });

  test("正常: 利用統計に total_observations が含まれる", async () => {
    const core = new HarnessMemCore(createConfig("usage"));
    await core.recordEvent(makeEvent("Obs1", "Content1"));
    await core.recordEvent(makeEvent("Obs2", "Content2"));
    await core.recordEvent(makeEvent("Obs3", "Content3"));

    const result = core.knowledgeStats({});
    const stats = result.items[0] as Record<string, unknown>;
    expect(Number(stats.total_observations)).toBeGreaterThanOrEqual(3);
    expect(typeof stats.total_facts).toBe("number");
  });
});
